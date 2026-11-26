import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import * as Analytics from "./Analytics.ts"

/**
 * Analytics feature RPC group. Imported only by `GetAnalytics` (Analytics
 * chunk) and its server handler/route (`POST /rpc/analytics`).
 */
export class AnalyticsRpcs extends RpcGroup.make(
  Rpc.make("getAnalytics", {
    payload: { metric: Analytics.Metric },
    success: Schema.Array(Analytics.SeriesPoint)
  })
) {}
