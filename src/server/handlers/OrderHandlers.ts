import { Effect, Option } from "effect"
import { HttpServerRequest } from "effect/http"
import * as I18n from "../../i18n/I18n.ts"
import * as OrderRpcs from "../../order/domain/OrderRpcs.ts"
import * as OrderStore from "../services/OrderStore.ts"

const requestLocale = Effect.map(
  Effect.serviceOption(HttpServerRequest.HttpServerRequest),
  Option.match({
    onNone: (): I18n.AppLocale => "en",
    onSome: (req) => I18n.parseLocale(req.headers["accept-language"])
  })
)

/** Live RPC handlers for `OrderRpcs`, forwarding `Accept-Language` to `OrderStore`. */
export const OrderHandlersLayer = OrderRpcs.OrderRpcs.toLayer(
  Effect.gen(function* () {
    const orders = yield* OrderStore.OrderStore
    return {
      checkOrderCode: ({ code }) => Effect.flatMap(requestLocale, (locale) => orders.checkOrderCode(code, locale)),
      validatePromoCode: ({ code }) =>
        Effect.flatMap(requestLocale, (locale) => orders.validatePromoCode(code, locale)),
      submitOrder: ({ order }) => Effect.flatMap(requestLocale, (locale) => orders.submitOrder(order, locale))
    }
  })
)
