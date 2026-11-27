import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Layer, Option, Schema, Stream, Tracer } from "effect"
import { RpcClient } from "effect/rpc"
import { TestClock } from "effect/testing"
import * as JsonString from "../src/lib/jsonString.ts"
import * as Rpc from "../src/server/rpc.ts"
import * as WarehouseRpcs from "../src/warehouse/domain/WarehouseRpcs.ts"
import * as CommandFlow from "../src/workflow/CommandFlow.ts"
import * as CommandTrace from "../src/workflow/CommandTrace.ts"

const TestIntent = Schema.TaggedStruct("Dispatch", { cartId: Schema.String })
const TestDraft = Schema.Struct({ auditNote: Schema.String })
const TestResult = Schema.Struct({ batchId: Schema.String })
const TestError = Schema.Struct({ code: Schema.String, message: Schema.String })

const Flow = CommandFlow.makeCommandFlow({
  intent: TestIntent,
  draft: TestDraft,
  progress: CommandFlow.ProgressSnapshot,
  result: TestResult,
  error: TestError
})

const PreservedPromptFlow = CommandFlow.makeCommandFlow({
  intent: TestIntent,
  draft: TestDraft,
  progress: CommandFlow.ProgressSnapshot,
  result: TestResult,
  error: TestError,
  preservePromptOnRestore: true
})

describe("CommandFlow state machine", () => {
  it("transitions cleanly across Idle -> Prompting -> Running -> Succeeded", () => {
    const origin = { traceId: "trace-origin-001", spanId: "span-origin-001" }
    const intent = { _tag: "Dispatch" as const, cartId: "cart-101" }

    const prompted = Flow.openPrompt(intent, { auditNote: "" }, origin)
    expect(prompted._tag).toBe("Prompting")

    const edited = Flow.updateDraft(prompted, () => ({ auditNote: "Checked fragile box" }))
    expect(edited._tag).toBe("Prompting")
    if (edited._tag === "Prompting") {
      expect(edited.draft.auditNote).toBe("Checked fragile box")
    }

    const running = Flow.startFromPrompt(edited, { completed: 0, total: 4, stepKey: "validate" })
    expect(running._tag).toBe("Running")
    if (running._tag === "Running") {
      expect(running.attempt).toBe(1)
      expect(running.originSpan).toEqual(origin)
    }

    const step2 = Flow.progressed(running, { completed: 2, total: 4, stepKey: "reserve" })
    if (step2._tag === "Running") {
      expect(step2.progress?.completed).toBe(2)
      expect(step2.progress?.stepKey).toBe("reserve")
    }

    const done = Flow.succeeded(step2, intent, { batchId: "BATCH-0001" })
    expect(done).toEqual({
      _tag: "Succeeded",
      intent,
      result: { batchId: "BATCH-0001" },
      span: origin
    })
  })

  it("preserves draft, originSpan, and increments attempt across failures", () => {
    const origin = { traceId: "trace-1234", spanId: "span-1234" }
    const failSpan = { traceId: "trace-5678", spanId: "span-5678" }
    const intent = { _tag: "Dispatch" as const, cartId: "cart-102" }

    const prompted = Flow.openPrompt(intent, { auditNote: "Keep this draft" }, origin)
    const failed = Flow.failed(prompted, {
      intent,
      error: { code: "CONFLICT", message: "Cart busy" },
      failureSpan: failSpan
    })
    expect(failed._tag).toBe("Failed")
    if (failed._tag === "Failed") {
      expect(failed.draft).toEqual({ auditNote: "Keep this draft" })
      expect(failed.originSpan).toEqual(origin)
      expect(failed.failureSpan).toEqual(failSpan)
      expect(failed.attempt).toBe(1)
    }

    const retried = Flow.start(failed, intent, failSpan)
    expect(retried._tag).toBe("Running")
    if (retried._tag === "Running") {
      expect(retried.attempt).toBe(2)
    }

    expect(Flow.cancelPrompt(prompted)).toEqual(Flow.idle)
    expect(Flow.cancelRunning(retried)).toEqual(Flow.idle)
    expect(Flow.dismiss()).toEqual(Flow.idle)
  })

  it("round-trips Schema states through JsonString and cleans transient states on restore", () => {
    const codec = JsonString.jsonString(Flow.State)
    const intent = { _tag: "Dispatch" as const, cartId: "cart-204" }
    const origin = { traceId: "t-1", spanId: "s-1" }

    const prompting = Flow.openPrompt(intent, { auditNote: "Restored note" }, origin)
    const decodedPrompt = Schema.decodeSync(codec)(Schema.encodeSync(codec)(prompting))
    expect(decodedPrompt).toEqual(prompting)
    expect(Flow.restore(decodedPrompt)).toEqual(Flow.idle)
    expect(PreservedPromptFlow.restore(decodedPrompt)).toEqual(prompting)

    const running = Flow.start(Flow.idle, intent, origin, { completed: 1, total: 4, stepKey: "validate" })
    expect(Flow.restore(running)).toEqual(Flow.idle)

    const succeeded = Flow.succeeded(running, intent, { batchId: "BATCH-0009" })
    const decodedSuccess = Schema.decodeSync(codec)(Schema.encodeSync(codec)(succeeded))
    expect(Flow.restore(decodedSuccess)).toEqual(succeeded)

    const failed = Flow.failed(running, {
      intent,
      error: { code: "TIMEOUT", message: "Timeout" },
      draft: { auditNote: "Keep" }
    })
    const decodedFailure = Schema.decodeSync(codec)(Schema.encodeSync(codec)(failed))
    expect(Flow.restore(decodedFailure)).toEqual(failed)
  })
})

const makeRecordingTracer = () => {
  const spans: Array<Tracer.NativeSpan> = []
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    }
  })
  return { spans, tracer }
}

describe("CommandTrace unified workflow trace parenting", () => {
  it.effect(
    "continues one traceId across preflight, human pause, execute, and streaming phases without SpanLinks or duration inflation",
    () =>
      Effect.gen(function* () {
        const { spans, tracer } = makeRecordingTracer()

        const origin = yield* Effect.gen(function* () {
          // Phase 1: Preflight runs with no parent and captures its SpanPointer before closing.
          const preflightFiber = yield* CommandTrace.withWorkflowSpan(
            "warehouse.dispatch_preflight",
            null
          )(CommandTrace.captureCommandOutcome(Effect.sleep("10 millis"))).pipe(
            Effect.withSpan("Command: PreflightDispatchCart"),
            Effect.forkChild
          )
          yield* TestClock.adjust("10 millis")
          const preflight = yield* Fiber.join(preflightFiber)
          expect(preflight.span).not.toBeNull()
          const originSpan = preflight.span
          if (originSpan === null) return undefined

          // Human reads AlertDialog/Dialog for 30 seconds — zero workflow spans stay open.
          yield* TestClock.adjust("30 seconds")

          // Phase 2: User confirms under a fresh outer @effect/ui Command span; inner work reparents to originSpan.
          const executeFiber = yield* CommandTrace.withWorkflowSpan("warehouse.dispatch_execute", originSpan, {
            "warehouse.cart_id": "cart-101"
          })(
            CommandTrace.captureCommandOutcome(Effect.sleep("15 millis").pipe(Effect.withSpan("rpc.dispatchCartStep")))
          ).pipe(Effect.withSpan("Command: DispatchCartBatch"), Effect.forkChild)
          yield* TestClock.adjust("15 millis")
          const executed = yield* Fiber.join(executeFiber)
          expect(executed.span?.traceId).toBe(originSpan.traceId)
          expect(executed.span?.spanId).not.toBe(originSpan.spanId)

          // Streaming phase reparents onto originSpan and keeps stream step children inside the unified trace.
          const streamed = yield* CommandTrace.withWorkflowSpanStream(
            "warehouse.dispatch_stream",
            originSpan
          )(
            Stream.fromIterable(["validate", "erp"]).pipe(
              Stream.mapEffect((step) => Effect.succeed(step).pipe(Effect.withSpan(`stream.step.${step}`)))
            )
          ).pipe(Stream.runCollect, Effect.withSpan("Command: StreamDispatchBatch"))
          expect(streamed).toEqual(["validate", "erp"])

          return originSpan
        }).pipe(Effect.withTracer(tracer))

        expect(origin).not.toBeNull()
        if (origin === undefined) return

        const preflightSpan = spans.find((s) => s.name === "warehouse.dispatch_preflight")
        const outerExecuteSpan = spans.find((s) => s.name === "Command: DispatchCartBatch")
        const executePhaseSpan = spans.find((s) => s.name === "warehouse.dispatch_execute")
        const childRpcSpan = spans.find((s) => s.name === "rpc.dispatchCartStep")
        const streamPhaseSpan = spans.find((s) => s.name === "warehouse.dispatch_stream")
        const streamStepSpan = spans.find((s) => s.name === "stream.step.erp")

        expect(preflightSpan?.status._tag).toBe("Ended")
        expect(outerExecuteSpan?.status._tag).toBe("Ended")
        expect(executePhaseSpan?.status._tag).toBe("Ended")
        expect(childRpcSpan?.status._tag).toBe("Ended")
        expect(streamPhaseSpan?.status._tag).toBe("Ended")
        expect(streamStepSpan?.status._tag).toBe("Ended")

        if (
          preflightSpan?.status._tag !== "Ended" ||
          outerExecuteSpan?.status._tag !== "Ended" ||
          executePhaseSpan?.status._tag !== "Ended" ||
          childRpcSpan?.status._tag !== "Ended" ||
          streamPhaseSpan?.status._tag !== "Ended" ||
          streamStepSpan?.status._tag !== "Ended"
        ) {
          return
        }

        // 1. Neither phase span absorbs the 30-second human think-time pause.
        const preflightDuration = preflightSpan.status.endTime - preflightSpan.status.startTime
        const executeDuration = executePhaseSpan.status.endTime - executePhaseSpan.status.startTime
        const pauseGap = executePhaseSpan.status.startTime - preflightSpan.status.endTime
        expect(pauseGap >= 30_000_000_000n).toBe(true)
        expect(preflightDuration < 1_000_000_000n).toBe(true)
        expect(executeDuration < 1_000_000_000n).toBe(true)

        // 2. Execute phase, child RPC, and stream steps all belong to origin.traceId with zero SpanLinks.
        expect(executePhaseSpan.traceId).toBe(origin.traceId)
        expect(Option.getOrNull(executePhaseSpan.parent)?.traceId).toBe(origin.traceId)
        expect(Option.getOrNull(executePhaseSpan.parent)?.spanId).toBe(origin.spanId)
        expect(executePhaseSpan.attributes.get("workflow.phase")).toBe("warehouse.dispatch_execute")
        expect(executePhaseSpan.attributes.get("workflow.origin_trace_id")).toBe(origin.traceId)
        expect(executePhaseSpan.attributes.get("workflow.parent_span_id")).toBe(origin.spanId)
        expect(executePhaseSpan.attributes.get("warehouse.cart_id")).toBe("cart-101")

        expect(childRpcSpan.traceId).toBe(origin.traceId)
        expect(Option.getOrNull(childRpcSpan.parent)?.spanId).toBe(executePhaseSpan.spanId)

        expect(streamPhaseSpan.traceId).toBe(origin.traceId)
        expect(Option.getOrNull(streamPhaseSpan.parent)?.spanId).toBe(origin.spanId)
        expect(streamStepSpan.traceId).toBe(origin.traceId)
        expect(Option.getOrNull(streamStepSpan.parent)?.spanId).toBe(streamPhaseSpan.spanId)
        expect(spans.flatMap((s) => s.links)).toEqual([])

        // 3. Outer @effect/ui Command span stays decoupled on click trace while carrying bridge attributes.
        expect(outerExecuteSpan.traceId).not.toBe(origin.traceId)
        expect(outerExecuteSpan.attributes.get("workflow.trace_id")).toBe(origin.traceId)
        expect(outerExecuteSpan.attributes.get("workflow.parent_span_id")).toBe(origin.spanId)

        expect(CommandTrace.shortTraceRef(origin)).toBe(origin.traceId.slice(0, 8))
        expect(CommandTrace.shortTraceRef(null)).toBeUndefined()
      })
  )

  it.effect(
    "propagates unified workflow traceId end-to-end across InProcessRpcClientLayer to WarehouseStore server spans",
    () =>
      Effect.gen(function* () {
        const { spans, tracer } = makeRecordingTracer()

        const origin = yield* Effect.gen(function* () {
          const serverLayer = RpcClient.layerProtocolHttp({ url: "/rpc/warehouse" }).pipe(
            Layer.provide(
              Rpc.InProcessRpcClientLayer.pipe(
                Layer.provide(Rpc.HandlersLayer.pipe(Layer.provide(Layer.fresh(Rpc.ServerStoresLayer))))
              )
            )
          )
          return yield* Effect.scoped(
            Effect.gen(function* () {
              const client = yield* RpcClient.make(WarehouseRpcs.WarehouseRpcs)

              const preflight = yield* CommandTrace.withWorkflowSpan(
                "warehouse.release_preflight",
                null
              )(
                CommandTrace.captureCommandOutcome(
                  client.preflightReleaseCart({ cartId: "cart-101", simulateExpired: false })
                )
              ).pipe(Effect.withSpan("Command: PreflightReleaseCart"))
              const originSpan = preflight.span
              if (originSpan === null) return undefined

              yield* TestClock.adjust("5 seconds")

              const executed = yield* CommandTrace.withWorkflowSpan(
                "warehouse.release_execute",
                originSpan
              )(
                CommandTrace.captureCommandOutcome(client.releaseCart({ cartId: "cart-101", simulateExpired: false }))
              ).pipe(Effect.withSpan("Command: ReleaseCart"))
              expect(executed.span?.traceId).toBe(originSpan.traceId)
              expect(executed.span?.spanId).not.toBe(originSpan.spanId)

              return originSpan
            }).pipe(Effect.provide(serverLayer))
          )
        }).pipe(Effect.withTracer(tracer))

        expect(origin).toBeDefined()
        if (origin === undefined) return

        const preflightPhase = spans.find((s) => s.name === "warehouse.release_preflight")
        const serverPreflight = spans.find((s) => s.name === "WarehouseStore.preflightReleaseCart")
        const executePhase = spans.find((s) => s.name === "warehouse.release_execute")
        const serverExecute = spans.find((s) => s.name === "WarehouseStore.releaseCart")

        expect(preflightPhase?.status._tag).toBe("Ended")
        expect(serverPreflight?.status._tag).toBe("Ended")
        expect(executePhase?.status._tag).toBe("Ended")
        expect(serverExecute?.status._tag).toBe("Ended")
        if (
          preflightPhase?.status._tag !== "Ended" ||
          serverPreflight?.status._tag !== "Ended" ||
          executePhase?.status._tag !== "Ended" ||
          serverExecute?.status._tag !== "Ended"
        ) {
          return
        }

        expect(serverPreflight.traceId).toBe(origin.traceId)
        expect(executePhase.traceId).toBe(origin.traceId)
        expect(serverExecute.traceId).toBe(origin.traceId)
        expect(serverExecute.spanId).not.toBe(executePhase.spanId)
        expect(executePhase.status.startTime - preflightPhase.status.endTime >= 5_000_000_000n).toBe(true)
        expect(spans.flatMap((s) => s.links)).toEqual([])
      })
  )

  it.effect("preserves one unified traceId across failure, RefreshSession, and replay recovery without SpanLinks", () =>
    Effect.gen(function* () {
      const { spans, tracer } = makeRecordingTracer()

      const outcome = yield* Effect.gen(function* () {
        const attempt1Fiber = yield* CommandTrace.withWorkflowSpan(
          "warehouse.block",
          null
        )(
          Effect.gen(function* () {
            yield* Effect.sleep("5 millis")
            const failureSpan = yield* CommandTrace.captureSpanPointer
            return yield* Effect.fail({ _tag: "SessionExpiredError" as const, failureSpan })
          }).pipe(Effect.catch((err) => Effect.succeed(err.failureSpan)))
        ).pipe(Effect.withSpan("Command: BlockCart"), Effect.forkChild)
        yield* TestClock.adjust("5 millis")
        const failureSpan = yield* Fiber.join(attempt1Fiber)
        if (failureSpan === null) return undefined

        yield* TestClock.adjust("12 seconds")

        const refreshFiber = yield* CommandTrace.withWorkflowSpan(
          "warehouse.refresh_session",
          failureSpan
        )(CommandTrace.captureCommandOutcome(Effect.sleep("8 millis").pipe(Effect.as({ renewed: true })))).pipe(
          Effect.withSpan("Command: RefreshSession"),
          Effect.forkChild
        )
        yield* TestClock.adjust("8 millis")
        const refreshOutcome = yield* Fiber.join(refreshFiber)
        const refreshSpan = refreshOutcome.span
        if (refreshSpan === null) return undefined

        const replayFiber = yield* CommandTrace.withWorkflowSpan(
          "warehouse.block",
          refreshSpan
        )(CommandTrace.captureCommandOutcome(Effect.sleep("10 millis").pipe(Effect.as("blocked")))).pipe(
          Effect.withSpan("Command: BlockCart"),
          Effect.forkChild
        )
        yield* TestClock.adjust("10 millis")
        const replayOutcome = yield* Fiber.join(replayFiber)
        const replaySpan = replayOutcome.span
        if (replaySpan === null) return undefined

        return { failureSpan, refreshSpan, replaySpan }
      }).pipe(Effect.withTracer(tracer))

      expect(outcome).toBeDefined()
      if (outcome === undefined) return

      expect(outcome.refreshSpan.traceId).toBe(outcome.failureSpan.traceId)
      expect(outcome.replaySpan.traceId).toBe(outcome.failureSpan.traceId)
      expect(new Set([outcome.failureSpan.spanId, outcome.refreshSpan.spanId, outcome.replaySpan.spanId]).size).toBe(3)

      const refreshPhase = spans.find((s) => s.name === "warehouse.refresh_session")
      const blockPhases = spans.filter((s) => s.name === "warehouse.block")
      const replayPhase = blockPhases[1]
      const outerRefresh = spans.find((s) => s.name === "Command: RefreshSession")

      expect(refreshPhase?.traceId).toBe(outcome.failureSpan.traceId)
      expect(Option.getOrNull(refreshPhase?.parent ?? Option.none())?.spanId).toBe(outcome.failureSpan.spanId)
      expect(replayPhase?.traceId).toBe(outcome.failureSpan.traceId)
      expect(Option.getOrNull(replayPhase?.parent ?? Option.none())?.spanId).toBe(outcome.refreshSpan.spanId)
      expect(outerRefresh?.attributes.get("workflow.trace_id")).toBe(outcome.failureSpan.traceId)
      expect(spans.flatMap((s) => s.links)).toEqual([])
    })
  )
})
