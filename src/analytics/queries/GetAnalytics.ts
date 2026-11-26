import { Query } from "@effect/ui"
import { Effect, Schema } from "effect"
import * as Dataset from "../domain/Analytics.ts"

/** Marker proving this page-only query lands in the Analytics chunk (see scripts/verify-bundles.ts). */
export const GET_ANALYTICS_QUERY_CHUNK = "SENTINEL:get-analytics-query"

/**
 * One metric's monthly series. Only `AnalyticsPage` imports it and provides
 * `GetAnalytics.layer` with `Component.provide`, so the query, its Layer and
 * the dataset all ship in the Analytics chunk and nowhere else.
 */
export class GetAnalytics extends Query.Service<GetAnalytics>()("analytics/GetAnalytics", {
  args: { metric: Dataset.Metric },
  success: Schema.Array(Dataset.SeriesPoint),
  error: Schema.Never,
  staleTime: "5 minutes"
}) {
  static readonly layer = this.toLayer(
    Effect.fnUntraced(function* ({ metric }) {
      yield* Effect.sleep("5 millis")
      Dataset.analyticsReads.getAnalytics += 1
      return Dataset.metricSeries(metric)
    })
  )
}
