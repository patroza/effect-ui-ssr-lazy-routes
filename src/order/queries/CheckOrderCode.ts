import { Query } from "@effect/ui"
import { Effect, Layer, Schema } from "effect"
import { RpcClient, RpcClientError } from "effect/rpc"
import * as ApiError from "../../rpc/domain/ApiError.ts"
import * as Order from "../domain/Order.ts"
import * as OrderRpcs from "../domain/OrderRpcs.ts"

/** Marker proving this page-only query lands in the Order chunk (see scripts/verify-bundles.ts). */
export const CHECK_ORDER_CODE_QUERY_CHUNK = "SENTINEL:check-order-code-query"

/**
 * Checks whether a project order code is available via `OrderRpcs` at `POST /rpc/order`.
 * Keyed and cached by `code`; invalidated when an order is submitted.
 */
export class CheckOrderCode extends Query.Service<CheckOrderCode>()("order/CheckOrderCode", {
  args: { code: Schema.String },
  success: Order.OrderCodeCheckResult,
  error: Schema.Union([ApiError.ApiError, RpcClientError.RpcClientError]),
  staleTime: "30 seconds"
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(OrderRpcs.OrderRpcs)
      return ({ code }) => client.checkOrderCode({ code })
    })
  ).pipe(Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc/order" })))
}
