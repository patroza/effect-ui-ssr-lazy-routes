import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber, Option, Schema, Stream, Tracer } from "effect"
import { TestClock } from "effect/testing"
import * as JsonString from "../src/lib/jsonString.ts"
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

describe("CommandTrace OTel SpanLinks", () => {
  it.effect(
    "links follow-up Command root and child spans across simulated human think-time without duration inflation",
    () =>
      Effect.gen(function* () {
        const spans: Array<Tracer.NativeSpan> = []
        const recordingTracer = Tracer.make({
          span: (options) => {
            const span = new Tracer.NativeSpan(options)
            spans.push(span)
            return span
          }
        })

        const origin = yield* Effect.gen(function* () {
          // Phase 1: Preflight Command captures SpanPointer and ends immediately.
          const preflightFiber = yield* CommandTrace.captureCommandOutcome(Effect.sleep("10 millis")).pipe(
            Effect.withSpan("warehouse.dispatch_preflight"),
            Effect.forkChild
          )
          yield* TestClock.adjust("10 millis")
          const preflight = yield* Fiber.join(preflightFiber)
          expect(preflight.originSpan).not.toBeNull()
          const originSpan = preflight.originSpan
          if (originSpan === null) return undefined

          // Human reads AlertDialog/Dialog for 30 seconds — zero spans remain open!
          yield* TestClock.adjust("30 seconds")

          // Phase 2: User confirms; downstream Command + child RPC spans link to origin.
          const executeFiber = yield* CommandTrace.withOriginSpanLink(originSpan, "warehouse.dispatch_execute", {
            "warehouse.cart_id": "cart-101"
          })(Effect.sleep("15 millis").pipe(Effect.withSpan("rpc.dispatchCartStep"))).pipe(
            Effect.withSpan("warehouse.dispatch_execute"),
            Effect.forkChild
          )
          yield* TestClock.adjust("15 millis")
          yield* Fiber.join(executeFiber)

          // Streaming variant links child stream phases too.
          const streamed = yield* CommandTrace.withOriginSpanLinkStream(
            originSpan,
            "warehouse.dispatch_stream"
          )(
            Stream.fromIterable(["validate", "erp"]).pipe(
              Stream.mapEffect((step) => Effect.succeed(step).pipe(Effect.withSpan(`stream.step.${step}`)))
            )
          ).pipe(Stream.runCollect, Effect.withSpan("warehouse.dispatch_stream_root"))
          expect(streamed).toEqual(["validate", "erp"])

          return originSpan
        }).pipe(Effect.withTracer(recordingTracer))

        expect(origin).not.toBeNull()
        if (origin === undefined) return

        const preflightSpan = spans.find((s) => s.name === "warehouse.dispatch_preflight")
        const executeRootSpan = spans.find((s) => s.name === "warehouse.dispatch_execute")
        const childRpcSpan = spans.find((s) => s.name === "rpc.dispatchCartStep")
        const streamStepSpan = spans.find((s) => s.name === "stream.step.erp")

        expect(preflightSpan?.status._tag).toBe("Ended")
        expect(executeRootSpan?.status._tag).toBe("Ended")
        expect(childRpcSpan?.status._tag).toBe("Ended")
        expect(streamStepSpan?.status._tag).toBe("Ended")

        if (
          preflightSpan?.status._tag !== "Ended" ||
          executeRootSpan?.status._tag !== "Ended" ||
          childRpcSpan?.status._tag !== "Ended"
        ) {
          return
        }

        // 1. Neither span absorbs the 30-second human think-time pause.
        const preflightDuration = preflightSpan.status.endTime - preflightSpan.status.startTime
        const executeDuration = executeRootSpan.status.endTime - executeRootSpan.status.startTime
        const pauseGap = executeRootSpan.status.startTime - preflightSpan.status.endTime
        expect(pauseGap >= 30_000_000_000n).toBe(true)
        expect(preflightDuration < 1_000_000_000n).toBe(true)
        expect(executeDuration < 1_000_000_000n).toBe(true)

        // 2. Execute root span records origin trace attributes & explicit SpanLink.
        expect(executeRootSpan.attributes.get("workflow.origin_trace_id")).toBe(origin.traceId)
        expect(executeRootSpan.attributes.get("workflow.origin_span_id")).toBe(origin.spanId)
        const execLink = executeRootSpan.links.find(
          (link) => link.span.traceId === origin.traceId && link.span.spanId === origin.spanId
        )
        expect(execLink?.attributes["workflow.relationship"]).toBe("warehouse.dispatch_execute")
        expect(execLink?.attributes["warehouse.cart_id"]).toBe("cart-101")

        // 3. Downstream child RPC & stream spans inherit the SpanLink via Effect.linkSpans.
        const childLink = childRpcSpan.links.find(
          (link) => link.span.traceId === origin.traceId && link.span.spanId === origin.spanId
        )
        expect(childLink?.attributes["workflow.relationship"]).toBe("warehouse.dispatch_execute")

        const streamLink = streamStepSpan?.links.find(
          (link) => link.span.traceId === origin.traceId && link.span.spanId === origin.spanId
        )
        expect(streamLink?.attributes["workflow.relationship"]).toBe("warehouse.dispatch_stream")

        expect(CommandTrace.shortTraceRef(origin)).toBe(origin.traceId.slice(0, 8))
        expect(CommandTrace.shortTraceRef(null)).toBeUndefined()
        expect(Option.getOrNull(Option.none())).toBeNull()
      })
  )
})
