import { Effect, Option, Schema, Stream, Tracer } from "effect"

/**
 * Schema-serializable OTel span coordinates so MVU state can continue follow-up
 * Commands under the same unified `traceId` across human confirmation or
 * recovery pauses without keeping a span open during idle user think-time.
 */
export const SpanPointer = Schema.Struct({
  traceId: Schema.String,
  spanId: Schema.String
})
export type SpanPointer = typeof SpanPointer.Type

/** Returns the active Effect span coordinates, or `null` when tracing is absent. */
export const captureSpanPointer: Effect.Effect<SpanPointer | null> = Effect.option(Effect.currentSpan).pipe(
  Effect.map(
    Option.match({
      onNone: () => null,
      onSome: (span) => ({ traceId: span.traceId, spanId: span.spanId })
    })
  )
)

/** Runs `effect` and captures the active span coordinates for downstream continuation. */
export const captureCommandOutcome = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
  const value = yield* effect
  const span = yield* captureSpanPointer
  return { value, span }
})

/** Returns a short reference token suitable for UI error banners. */
export const shortTraceRef = (span: SpanPointer | null | undefined): string | undefined =>
  span === null || span === undefined ? undefined : span.traceId.slice(0, 8)

const annotateOuterCommandSpan = (parent: SpanPointer): Effect.Effect<void> =>
  Effect.option(Effect.currentSpan).pipe(
    Effect.tap(
      Option.match({
        onNone: () => Effect.void,
        onSome: (current) =>
          Effect.sync(() => {
            if (current.traceId !== parent.traceId) {
              current.attribute("workflow.trace_id", parent.traceId)
              current.attribute("workflow.parent_span_id", parent.spanId)
            }
          })
      })
    ),
    Effect.asVoid
  )

const workflowSpanOptions = (
  phaseName: string,
  parent: SpanPointer | null,
  extraAttributes?: Readonly<Record<string, unknown>> | undefined
) => ({
  ...(parent === null ? {} : { parent: Tracer.externalSpan({ traceId: parent.traceId, spanId: parent.spanId }) }),
  attributes: {
    "workflow.phase": phaseName,
    ...(parent === null
      ? {}
      : {
          "workflow.origin_trace_id": parent.traceId,
          "workflow.parent_span_id": parent.spanId
        }),
    ...extraAttributes
  }
})

/**
 * Runs `effect` inside a workflow span, continuing `parent`'s `traceId` via
 * `Tracer.externalSpan` when provided so multi-phase MVU workflows share one
 * unified trace without holding any span open across human think-time.
 */
export const withWorkflowSpan =
  (phaseName: string, parent: SpanPointer | null, extraAttributes?: Readonly<Record<string, unknown>> | undefined) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
    const spanned = Effect.withSpan(effect, phaseName, workflowSpanOptions(phaseName, parent, extraAttributes))
    return parent === null ? spanned : annotateOuterCommandSpan(parent).pipe(Effect.andThen(spanned))
  }

/**
 * Runs `stream` inside a workflow span, continuing `parent`'s `traceId` via
 * `Tracer.externalSpan` so all stream steps execute as child spans in the same
 * unified trace and close cleanly on completion, failure, or interruption.
 */
export const withWorkflowSpanStream =
  (phaseName: string, parent: SpanPointer | null, extraAttributes?: Readonly<Record<string, unknown>> | undefined) =>
  <A, E, R>(stream: Stream.Stream<A, E, R>): Stream.Stream<A, E, Exclude<R, Tracer.ParentSpan>> => {
    const wrapped = stream.pipe(Stream.withSpan(phaseName, workflowSpanOptions(phaseName, parent, extraAttributes)))
    return parent === null ? wrapped : Stream.unwrap(annotateOuterCommandSpan(parent).pipe(Effect.as(wrapped)))
  }
