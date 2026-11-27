import { Query } from "@effect/ui"
import { Effect, Layer, Schema } from "effect"
import { RpcClient, RpcClientError } from "effect/rpc"
import * as ApiError from "../../rpc/domain/ApiError.ts"
import * as Order from "../domain/Order.ts"
import * as OrderRpcs from "../domain/OrderRpcs.ts"

/** Marker proving this page-only query lands in the Order chunk (see scripts/verify-bundles.ts). */
export const VALIDATE_PROMO_CODE_QUERY_CHUNK = "SENTINEL:validate-promo-code-query"

/**
 * Validates an optional promo code via `OrderRpcs` at `POST /rpc/order`.
 * Returns discount metadata used both for validation and live pricing totals.
 */
export class ValidatePromoCode extends Query.Service<ValidatePromoCode>()("order/ValidatePromoCode", {
  args: { code: Schema.String },
  success: Order.PromoValidationResult,
  error: Schema.Union([ApiError.ApiError, RpcClientError.RpcClientError]),
  staleTime: "30 seconds"
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(OrderRpcs.OrderRpcs)
      return ({ code }) => client.validatePromoCode({ code })
    })
  ).pipe(Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc/order" })))
}
