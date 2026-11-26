import { Query } from "@effect/ui"
import { Effect, Schema } from "effect"
import { RpcClient } from "effect/rpc"
import * as ApiError from "../../rpc/domain/ApiError.ts"
import * as Analytics from "../domain/Analytics.ts"
import * as AnalyticsRpcs from "../domain/AnalyticsRpcs.ts"

/** Marker proving this page-only query lands in the Analytics chunk (see scripts/verify-bundles.ts). */
export const GET_ANALYTICS_QUERY_CHUNK = "SENTINEL:get-analytics-query"

/**
 * One metric's monthly series, fetched via `AnalyticsRpcs`. Only `AnalyticsPage`
 * imports it and provides `GetAnalytics.layer` with `Component.provide`, so the
 * query, its RPC group and its schemas all ship in the Analytics chunk and
 * nowhere else.
 */
export class GetAnalytics extends Query.Service<GetAnalytics>()("analytics/GetAnalytics", {
  args: { metric: Analytics.Metric },
  success: Schema.Array(Analytics.SeriesPoint),
  error: ApiError.ApiError,
  staleTime: "5 minutes"
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(AnalyticsRpcs.AnalyticsRpcs)
      return ({ metric }) =>
        client
          .getAnalytics({ metric })
          .pipe(
            Effect.catchTag("RpcClientError", (error) => Effect.fail(new ApiError.ApiError({ message: error.message })))
          )
    })
  )
}
