import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import * as ApiError from "../../rpc/domain/ApiError.ts"
import * as Order from "./Order.ts"

/**
 * Custom order form RPC group: debounced async field validations and order
 * submission. Imported only by the Order chunk and the server handler/route
 * (`POST /rpc/order`).
 */
export class OrderRpcs extends RpcGroup.make(
  Rpc.make("checkOrderCode", {
    payload: { code: Schema.String },
    success: Order.OrderCodeCheckResult,
    error: ApiError.ApiError
  }),
  Rpc.make("validatePromoCode", {
    payload: { code: Schema.String },
    success: Order.PromoValidationResult,
    error: ApiError.ApiError
  }),
  Rpc.make("submitOrder", {
    payload: { order: Order.OrderSubmission },
    success: Order.OrderReceipt,
    error: Schema.Union([Order.OrderValidationError, ApiError.ApiError])
  })
) {}
