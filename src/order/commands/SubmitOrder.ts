import { Command } from "@effect/ui"
import { Effect, Layer, Schema } from "effect"
import { RpcClient, RpcClientError } from "effect/rpc"
import * as ApiError from "../../rpc/domain/ApiError.ts"
import * as Order from "../domain/Order.ts"
import * as OrderRpcs from "../domain/OrderRpcs.ts"
import * as CheckOrderCode from "../queries/CheckOrderCode.ts"

/**
 * Submits a decoded `OrderSubmission` through `POST /rpc/order` and invalidates
 * the `CheckOrderCode` query entry for the claimed code.
 */
export class SubmitOrder extends Command.Service<SubmitOrder>()("order/SubmitOrder", {
  args: { order: Order.OrderSubmission },
  success: Order.OrderReceipt,
  error: Schema.Union([Order.OrderValidationError, ApiError.ApiError, RpcClientError.RpcClientError]),
  invalidates: ({ order }) => [CheckOrderCode.CheckOrderCode.entry({ code: order.projectCode })]
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(OrderRpcs.OrderRpcs)
      return ({ order }) => client.submitOrder({ order })
    })
  ).pipe(Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc/order" })))
}
