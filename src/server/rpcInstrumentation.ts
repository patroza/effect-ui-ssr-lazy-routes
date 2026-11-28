import { Cause, Clock, Duration, Effect, Exit, Layer, Metric } from "effect"
import { type RpcGroup, RpcMiddleware } from "effect/rpc"
import type * as AnalyticsRpcs from "../analytics/domain/AnalyticsRpcs.ts"
import type * as OrderRpcs from "../order/domain/OrderRpcs.ts"
import type * as ProductRpcs from "../product/domain/ProductRpcs.ts"
import type * as SearchRpcs from "../search/domain/SearchRpcs.ts"
import type * as StatusRpcs from "../status/domain/StatusRpcs.ts"
import type * as WarehouseRpcs from "../warehouse/domain/WarehouseRpcs.ts"

export type SampleRpcGroup = "search" | "product" | "analytics" | "status" | "order" | "warehouse"

export type SampleRpcMethod =
  | RpcGroup.Rpcs<typeof SearchRpcs.SearchRpcs>["_tag"]
  | RpcGroup.Rpcs<typeof ProductRpcs.ProductRpcs>["_tag"]
  | RpcGroup.Rpcs<typeof AnalyticsRpcs.AnalyticsRpcs>["_tag"]
  | RpcGroup.Rpcs<typeof StatusRpcs.StatusRpcs>["_tag"]
  | RpcGroup.Rpcs<typeof OrderRpcs.OrderRpcs>["_tag"]
  | RpcGroup.Rpcs<typeof WarehouseRpcs.WarehouseRpcs>["_tag"]

/** Compile-time exhaustive mapping from every RPC method tag to its feature group. */
export const SAMPLE_RPC_GROUP_BY_METHOD = {
  searchProducts: "search",
  getProduct: "product",
  bookmarkProduct: "product",
  getAnalytics: "analytics",
  getStatus: "status",
  checkOrderCode: "order",
  validatePromoCode: "order",
  submitOrder: "order",
  getWarehouseCarts: "warehouse",
  unblockCart: "warehouse",
  blockCart: "warehouse",
  preflightReleaseCart: "warehouse",
  releaseCart: "warehouse",
  preflightDispatchCart: "warehouse",
  dispatchCartStep: "warehouse",
  refreshSession: "warehouse"
} as const satisfies Readonly<Record<SampleRpcMethod, SampleRpcGroup>>

const rpcGroupByMethod: ReadonlyMap<string, SampleRpcGroup> = new Map(Object.entries(SAMPLE_RPC_GROUP_BY_METHOD))

export type RpcOutcome = "success" | "failure" | "interrupt"

/** Monotonic request counter across server RPC executions, tagged by method, group, and exit outcome. */
export const sampleRpcRequestsTotal = Metric.counter("sample_rpc_requests_total", {
  description: "Total server RPC requests handled across feature groups.",
  incremental: true
})

/** Server RPC execution latency timer in milliseconds, tagged by method, group, and exit outcome. */
export const sampleRpcRequestDuration = Metric.timer("sample_rpc_request_duration_ms", {
  description: "Server RPC handler execution duration in milliseconds."
})

const outcomeOfExit = <A, E>(exit: Exit.Exit<A, E>): RpcOutcome => {
  if (Exit.isSuccess(exit)) return "success"
  return Cause.hasInterruptsOnly(exit.cause) ? "interrupt" : "failure"
}

/**
 * Server-only RPC instrumentation middleware recording `rpc.<method>` tracing
 * spans with closed attributes and Effect monotonic exit metrics.
 */
export class RpcInstrumentation extends RpcMiddleware.Service<RpcInstrumentation>()(
  "effect-ui-ssr-lazy-routes/server/rpcInstrumentation/RpcInstrumentation"
) {
  static readonly layer = Layer.succeed(RpcInstrumentation, (effect, options) => {
    const method = options.rpc._tag
    const rpcGroup = rpcGroupByMethod.get(method) ?? "unknown"
    const spanAttributes = {
      "rpc.system": "effect-rpc",
      "rpc.transport": "http",
      "rpc.method": method,
      "rpc.group": rpcGroup
    }

    return Effect.gen(function* () {
      const startedNanos = yield* Clock.monotonicTimeNanos
      return yield* effect.pipe(
        Effect.onExit((exit) =>
          Effect.gen(function* () {
            const endedNanos = yield* Clock.monotonicTimeNanos
            const elapsedNanos = endedNanos > startedNanos ? endedNanos - startedNanos : 0n
            const outcome = outcomeOfExit(exit)
            const metricAttributes = {
              rpc_method: method,
              rpc_group: rpcGroup,
              outcome
            }
            yield* Metric.update(Metric.withAttributes(sampleRpcRequestsTotal, metricAttributes), 1)
            yield* Metric.update(
              Metric.withAttributes(sampleRpcRequestDuration, metricAttributes),
              Duration.nanos(elapsedNanos)
            )
          })
        ),
        Effect.withSpan(`rpc.${method}`, {
          kind: "server",
          attributes: spanAttributes
        })
      )
    })
  })
}
