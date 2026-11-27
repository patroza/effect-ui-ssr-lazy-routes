import { Effect } from "effect"
import * as OrderRpcs from "../../order/domain/OrderRpcs.ts"
import * as OrderStore from "../services/OrderStore.ts"

/** Live RPC handlers for `OrderRpcs` — yields only `OrderStore`. */
export const OrderHandlersLayer = OrderRpcs.OrderRpcs.toLayer(
  Effect.gen(function* () {
    const orders = yield* OrderStore.OrderStore
    return {
      checkOrderCode: ({ code }) => orders.checkOrderCode(code),
      validatePromoCode: ({ code }) => orders.validatePromoCode(code),
      submitOrder: ({ order }) => orders.submitOrder(order)
    }
  })
)
