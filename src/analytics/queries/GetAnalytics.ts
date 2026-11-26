import { Query } from "@effect/ui"
import { Effect, Schema } from "effect"
import * as AnalyticsPort from "../services/AnalyticsPort.ts"
import * as Dataset from "../domain/Analytics.ts"

/** Marker proving this page-only query lands in the Analytics chunk (see scripts/verify-bundles.ts). */
export const GET_ANALYTICS_QUERY_CHUNK = "SENTINEL:get-analytics-query"

/**
 * One metric's monthly series, read through `AnalyticsPort`. Only
 * `AnalyticsPage` imports it and provides `GetAnalytics.layer` (plus the port)
 * with `Component.provide`, so the query, the port and the dataset all ship in
 * the Analytics chunk and nowhere else.
 */
export class GetAnalytics extends Query.Service<GetAnalytics>()("analytics/GetAnalytics", {
  args: { metric: Dataset.Metric },
  success: Schema.Array(Dataset.SeriesPoint),
  error: Schema.Never,
  staleTime: "5 minutes"
}) {
  /** Requires `AnalyticsPort`. */
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const port = yield* AnalyticsPort.AnalyticsPort
      return ({ metric }) => port.series(metric)
    })
  )
}
