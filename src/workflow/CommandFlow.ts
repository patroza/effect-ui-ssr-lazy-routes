import { Schema } from "effect"
import * as CommandTrace from "./CommandTrace.ts"

/** Schema-serializable step progress snapshot carried in `Running` flow state. */
export const ProgressSnapshot = Schema.Struct({
  completed: Schema.Finite,
  total: Schema.Finite,
  stepKey: Schema.String
})
export type ProgressSnapshot = typeof ProgressSnapshot.Type

/**
 * Explicit MVU state machine union for multi-step Command workflows
 * (`Idle -> Prompting -> Running -> Succeeded | Failed`) preserving drafts,
 * attempt counters, and OTel `SpanPointer` correlation across human pauses.
 */
export type CommandFlowState<Intent, Draft, Prog, Res, Err> =
  | { readonly _tag: "Idle" }
  | {
      readonly _tag: "Prompting"
      readonly intent: Intent
      readonly draft: Draft
      readonly originSpan: CommandTrace.SpanPointer | null
    }
  | {
      readonly _tag: "Running"
      readonly intent: Intent
      readonly attempt: number
      readonly originSpan: CommandTrace.SpanPointer | null
      readonly progress: Prog | null
    }
  | {
      readonly _tag: "Succeeded"
      readonly intent: Intent
      readonly result: Res
      readonly span: CommandTrace.SpanPointer | null
    }
  | {
      readonly _tag: "Failed"
      readonly intent: Intent
      readonly draft: Draft | null
      readonly error: Err
      readonly attempt: number
      readonly originSpan: CommandTrace.SpanPointer | null
      readonly failureSpan: CommandTrace.SpanPointer | null
    }

const previousAttempt = <Intent, Draft, Prog, Res, Err>(
  flow: CommandFlowState<Intent, Draft, Prog, Res, Err>
): number => {
  switch (flow._tag) {
    case "Running":
    case "Failed":
      return flow.attempt
    case "Idle":
    case "Prompting":
    case "Succeeded":
      return 0
  }
}

/**
 * Builds a Schema-serializable, `restore`-safe Command workflow state machine
 * helper parameterized by the workflow's `intent`, `draft`, `progress`,
 * `result`, and `error` schemas.
 */
export const makeCommandFlow = <
  SIntent extends Schema.Top & { readonly DecodingServices: never; readonly EncodingServices: never },
  SDraft extends Schema.Top & { readonly DecodingServices: never; readonly EncodingServices: never },
  SProg extends Schema.Top & { readonly DecodingServices: never; readonly EncodingServices: never },
  SRes extends Schema.Top & { readonly DecodingServices: never; readonly EncodingServices: never },
  SErr extends Schema.Top & { readonly DecodingServices: never; readonly EncodingServices: never }
>(options: {
  readonly intent: SIntent
  readonly draft: SDraft
  readonly progress: SProg
  readonly result: SRes
  readonly error: SErr
  readonly preservePromptOnRestore?: boolean | undefined
}) => {
  type Intent = SIntent["Type"]
  type Draft = SDraft["Type"]
  type Prog = SProg["Type"]
  type Res = SRes["Type"]
  type Err = SErr["Type"]
  type Flow = CommandFlowState<Intent, Draft, Prog, Res, Err>

  const State = Schema.Union([
    Schema.TaggedStruct("Idle", {}),
    Schema.TaggedStruct("Prompting", {
      intent: options.intent,
      draft: options.draft,
      originSpan: Schema.NullOr(CommandTrace.SpanPointer)
    }),
    Schema.TaggedStruct("Running", {
      intent: options.intent,
      attempt: Schema.Finite,
      originSpan: Schema.NullOr(CommandTrace.SpanPointer),
      progress: Schema.NullOr(options.progress)
    }),
    Schema.TaggedStruct("Succeeded", {
      intent: options.intent,
      result: options.result,
      span: Schema.NullOr(CommandTrace.SpanPointer)
    }),
    Schema.TaggedStruct("Failed", {
      intent: options.intent,
      draft: Schema.NullOr(options.draft),
      error: options.error,
      attempt: Schema.Finite,
      originSpan: Schema.NullOr(CommandTrace.SpanPointer),
      failureSpan: Schema.NullOr(CommandTrace.SpanPointer)
    })
  ])

  const idle: Flow = { _tag: "Idle" }

  const openPrompt = (intent: Intent, draft: Draft, originSpan: CommandTrace.SpanPointer | null = null): Flow => ({
    _tag: "Prompting",
    intent,
    draft,
    originSpan
  })

  const updateDraft = (flow: Flow, updater: (draft: Draft) => Draft): Flow =>
    flow._tag === "Prompting" ? { ...flow, draft: updater(flow.draft) } : flow

  const cancelPrompt = (flow: Flow): Flow => (flow._tag === "Prompting" ? idle : flow)

  const start = (
    flow: Flow,
    intent: Intent,
    originSpan: CommandTrace.SpanPointer | null = null,
    initialProgress: Prog | null = null
  ): Flow => ({
    _tag: "Running",
    intent,
    attempt: previousAttempt(flow) + 1,
    originSpan,
    progress: initialProgress
  })

  const startFromPrompt = (flow: Flow, initialProgress: Prog | null = null): Flow =>
    flow._tag === "Prompting"
      ? {
          _tag: "Running",
          intent: flow.intent,
          attempt: 1,
          originSpan: flow.originSpan,
          progress: initialProgress
        }
      : flow

  const progressed = (flow: Flow, progress: Prog): Flow => (flow._tag === "Running" ? { ...flow, progress } : flow)

  const succeeded = (flow: Flow, intent: Intent, result: Res, span: CommandTrace.SpanPointer | null = null): Flow => ({
    _tag: "Succeeded",
    intent,
    result,
    span: span ?? (flow._tag === "Running" ? flow.originSpan : null)
  })

  const failed = (
    flow: Flow,
    params: {
      readonly intent: Intent
      readonly error: Err
      readonly draft?: Draft | null | undefined
      readonly originSpan?: CommandTrace.SpanPointer | null | undefined
      readonly failureSpan?: CommandTrace.SpanPointer | null | undefined
    }
  ): Flow => ({
    _tag: "Failed",
    intent: params.intent,
    draft: params.draft ?? (flow._tag === "Prompting" ? flow.draft : null),
    error: params.error,
    attempt: Math.max(1, previousAttempt(flow)),
    originSpan:
      params.originSpan !== undefined
        ? params.originSpan
        : flow._tag === "Running" || flow._tag === "Prompting" || flow._tag === "Failed"
          ? flow.originSpan
          : null,
    failureSpan: params.failureSpan ?? null
  })

  const cancelRunning = (flow: Flow): Flow => (flow._tag === "Running" ? idle : flow)

  const dismiss = (): Flow => idle

  /** History `restore` resets live in-flight fibers cleanly (and transient prompts unless preserved). */
  const restore = (flow: Flow): Flow => {
    if (flow._tag === "Running") return idle
    if (flow._tag === "Prompting" && options.preservePromptOnRestore !== true) return idle
    return flow
  }

  const isRunning = (flow: Flow): boolean => flow._tag === "Running"

  const isPrompting = (flow: Flow): boolean => flow._tag === "Prompting"

  return {
    State,
    idle,
    openPrompt,
    updateDraft,
    cancelPrompt,
    start,
    startFromPrompt,
    progressed,
    succeeded,
    failed,
    cancelRunning,
    dismiss,
    restore,
    isRunning,
    isPrompting
  }
}
