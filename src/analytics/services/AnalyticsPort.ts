import { Context, Effect } from "effect"
import * as Analytics from "../domain/Analytics.ts"

export interface AnalyticsPortService {
  readonly series: (metric: Analytics.Metric) => Effect.Effect<ReadonlyArray<Analytics.SeriesPoint>>
}

/** The production implementation: a stand-in for a network round trip on the Effect clock. */
export const live: AnalyticsPortService = {
  series: Effect.fn("AnalyticsPort.series")(function* (metric: Analytics.Metric) {
    yield* Effect.sleep("5 millis")
    return Analytics.metricSeries(metric)
  })
}

/**
 * The analytics dataset's I/O. `GetAnalytics` captures it. Every operation is
 * an `Effect.fn`, so each call is a span.
 *
 * A `Context.Reference` carries `live` as its default, so it stays in the
 * Analytics chunk while tests can override it cleanly in any layer order.
 */
export const AnalyticsPort = Context.Reference<AnalyticsPortService>("analytics/AnalyticsPort", {
  defaultValue: () => live
})
