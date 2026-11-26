import { Effect } from "effect"
import * as AnalyticsRpcs from "../../analytics/domain/AnalyticsRpcs.ts"
import * as AnalyticsStore from "../services/AnalyticsStore.ts"

/** Live RPC handlers for `AnalyticsRpcs` — yields only `AnalyticsStore`. */
export const AnalyticsHandlersLayer = AnalyticsRpcs.AnalyticsRpcs.toLayer(
  Effect.gen(function* () {
    const analytics = yield* AnalyticsStore.AnalyticsStore
    return {
      getAnalytics: ({ metric }) => analytics.series(metric)
    }
  })
)
