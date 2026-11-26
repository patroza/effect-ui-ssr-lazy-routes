import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import * as ApiError from "../../rpc/domain/ApiError.ts"
import * as Analytics from "./Analytics.ts"

/**
 * Analytics feature RPC group. Imported only by `GetAnalytics` (Analytics
 * chunk) and the server's merged `AppRpcs`.
 */
export class AnalyticsRpcs extends RpcGroup.make(
  Rpc.make("getAnalytics", {
    payload: { metric: Analytics.Metric },
    success: Schema.Array(Analytics.SeriesPoint),
    error: ApiError.ApiError
  })
) {}
