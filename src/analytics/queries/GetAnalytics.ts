import { Query } from "@effect/ui"
import { Effect, Layer, Schema } from "effect"
import { RpcClient, RpcClientError } from "effect/rpc"
import * as Analytics from "../domain/Analytics.ts"
import * as AnalyticsRpcs from "../domain/AnalyticsRpcs.ts"

/** Marker proving this page-only query lands in the Analytics chunk (see scripts/verify-bundles.ts). */
export const GET_ANALYTICS_QUERY_CHUNK = "SENTINEL:get-analytics-query"

/**
 * One metric's monthly series, fetched via `AnalyticsRpcs` at
 * `POST /rpc/analytics`. Only `AnalyticsPage` imports it and provides
 * `GetAnalytics.layer` with `Component.provide`, so the query, its RPC group,
 * its protocol and its schemas all ship in the Analytics chunk and nowhere else.
 */
export class GetAnalytics extends Query.Service<GetAnalytics>()("analytics/GetAnalytics", {
  args: { metric: Analytics.Metric },
  success: Schema.Array(Analytics.SeriesPoint),
  error: RpcClientError.RpcClientError,
  staleTime: "5 minutes"
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(AnalyticsRpcs.AnalyticsRpcs)
      return ({ metric }) => client.getAnalytics({ metric })
    })
  ).pipe(Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc/analytics" })))
}
