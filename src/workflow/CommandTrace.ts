import { Effect, Option, Schema, Stream, Tracer } from "effect"

/**
 * Schema-serializable OTel span coordinates so MVU state and logs can link
 * follow-up Commands across human confirmation pauses without keeping a span
 * open during idle user think-time.
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

/** Runs `effect` and captures the active span coordinates for downstream linking. */
export const captureCommandOutcome = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
  const value = yield* effect
  const originSpan = yield* captureSpanPointer
  return { value, originSpan }
})

/** Returns a short reference token suitable for UI error banners. */
export const shortTraceRef = (span: SpanPointer | null | undefined): string | undefined =>
  span === null || span === undefined ? undefined : span.traceId.slice(0, 8)

/**
 * Links both the currently running Command root span (if any) AND any child
 * spans opened inside `effect` to an originating `SpanPointer`.
 */
export const withOriginSpanLink =
  (origin: SpanPointer | null, relationship: string, extraAttributes?: Readonly<Record<string, unknown>> | undefined) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
    if (origin === null) return effect
    const external = Tracer.externalSpan({ traceId: origin.traceId, spanId: origin.spanId })
    const linkAttrs: Record<string, unknown> = {
      "workflow.relationship": relationship,
      ...extraAttributes
    }
    return Effect.gen(function* () {
      const current = yield* Effect.option(Effect.currentSpan)
      if (Option.isSome(current)) {
        current.value.addLinks([{ span: external, attributes: linkAttrs }])
        current.value.attribute("workflow.origin_trace_id", origin.traceId)
        current.value.attribute("workflow.origin_span_id", origin.spanId)
      }
      return yield* Effect.linkSpans(effect, external, linkAttrs)
    })
  }

/** Stream variant of `withOriginSpanLink` for multi-phase streaming Commands. */
export const withOriginSpanLinkStream =
  (origin: SpanPointer | null, relationship: string, extraAttributes?: Readonly<Record<string, unknown>> | undefined) =>
  <A, E, R>(stream: Stream.Stream<A, E, R>): Stream.Stream<A, E, R> =>
    origin === null
      ? stream
      : Stream.unwrap(
          withOriginSpanLink(
            origin,
            relationship,
            extraAttributes
          )(Effect.context<R>()).pipe(Effect.map((ctx) => Stream.provideContext(stream, ctx)))
        )
