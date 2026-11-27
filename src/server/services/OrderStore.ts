import { Context, Effect, Layer, Ref } from "effect"
import * as Order from "../../order/domain/Order.ts"
import * as ApiError from "../../rpc/domain/ApiError.ts"

interface OrderStoreState {
  readonly nextOrderNumber: number
  readonly takenCodes: ReadonlySet<string>
  readonly receipts: ReadonlyArray<Order.OrderReceipt>
}

const initialTakenCodes: ReadonlyArray<string> = ["taken-code", "legacy-01"]

const validPromos: ReadonlyMap<string, { readonly discountPercent: number; readonly description: string }> = new Map([
  ["STUDIO15", { discountPercent: 15, description: "15% studio discount" }],
  ["WHOLESALE25", { discountPercent: 25, description: "25% wholesale discount" }]
])

const nextAvailableSuggestion = (code: string, takenCodes: ReadonlySet<string>): string => {
  for (let suffix = 2; suffix < 100; suffix++) {
    const candidate = `${code}-${suffix}`
    if (!takenCodes.has(candidate)) return candidate
  }
  return `${code}-alt`
}

/**
 * `Ref`-backed store for `/order` and `POST /rpc/order`.
 * Supports live order-code availability checks, promo validation, atomic
 * submission claiming, typed field-level `OrderValidationError`, and simulated
 * `ApiError` failure for `"server-error"`.
 */
export class OrderStore extends Context.Service<
  OrderStore,
  {
    readonly checkOrderCode: (code: string) => Effect.Effect<Order.OrderCodeCheckResult>
    readonly validatePromoCode: (code: string) => Effect.Effect<Order.PromoValidationResult>
    readonly submitOrder: (
      order: Order.OrderSubmission
    ) => Effect.Effect<Order.OrderReceipt, Order.OrderValidationError | ApiError.ApiError>
  }
>()("server/OrderStore") {
  static readonly layer = Layer.effect(
    OrderStore,
    Effect.gen(function* () {
      const stateRef = yield* Ref.make<OrderStoreState>({
        nextOrderNumber: 1,
        takenCodes: new Set(initialTakenCodes),
        receipts: []
      })

      return OrderStore.of({
        checkOrderCode: (code) =>
          Effect.map(Ref.get(stateRef), (state) => {
            const trimmed = code.trim()
            if (state.takenCodes.has(trimmed)) {
              return {
                available: false,
                reason: `Project code "${trimmed}" is already taken`,
                suggestion: nextAvailableSuggestion(trimmed, state.takenCodes)
              }
            }
            return {
              available: true,
              reason: null,
              suggestion: null
            }
          }),

        validatePromoCode: (code) =>
          Effect.sync(() => {
            const trimmed = code.trim().toUpperCase()
            const promo = validPromos.get(trimmed)
            if (promo !== undefined) {
              return {
                valid: true,
                discountPercent: promo.discountPercent,
                description: promo.description
              }
            }
            return {
              valid: false,
              discountPercent: 0,
              description: `Promo code "${code.trim()}" is not recognized`
            }
          }),

        submitOrder: (order) =>
          Effect.gen(function* () {
            if (order.projectCode === "server-error") {
              return yield* new ApiError.ApiError({
                message: "Order service temporarily unavailable. Please retry."
              })
            }

            const fieldErrors: Record<string, ReadonlyArray<string>> = {}
            if (order.contactEmail.toLowerCase().endsWith("@blocked.test")) {
              fieldErrors["contactEmail"] = ["Orders from @blocked.test domains require manual approval"]
            }
            if (order.billing._tag === "Invoice" && order.billing.poNumber === "PO-REJECTED") {
              fieldErrors["billing.poNumber"] = ["Purchase order PO-REJECTED has exceeded its credit limit"]
            }
            let discountPercent = 0
            if (order.promoCode !== "") {
              const promo = validPromos.get(order.promoCode.trim().toUpperCase())
              if (promo === undefined) {
                fieldErrors["promoCode"] = [`Promo code "${order.promoCode}" is unknown or expired`]
              } else {
                discountPercent = promo.discountPercent
              }
            }

            type ModifyOutcome =
              | { readonly _tag: "Conflict"; readonly reason: string }
              | { readonly _tag: "FieldErrors" }
              | { readonly _tag: "Accepted"; readonly receipt: Order.OrderReceipt }

            const hasOtherErrors = Object.keys(fieldErrors).length > 0
            const outcome = yield* Ref.modify(stateRef, (state): readonly [ModifyOutcome, OrderStoreState] => {
              const codeUnavailable = state.takenCodes.has(order.projectCode) || order.projectCode === "race-conflict"
              if (codeUnavailable) {
                return [
                  {
                    _tag: "Conflict",
                    reason: `Order code "${order.projectCode}" was claimed before submission completed`
                  },
                  state
                ]
              }
              if (hasOtherErrors) {
                return [{ _tag: "FieldErrors" }, state]
              }
              const orderNumber = state.nextOrderNumber
              const totals = Order.calculateOrderTotals(order, discountPercent)
              const receipt: Order.OrderReceipt = {
                orderId: `ORD-${String(orderNumber).padStart(4, "0")}`,
                projectCode: order.projectCode,
                totalCents: totals.totalCents,
                discountPercent
              }
              const nextTaken = new Set(state.takenCodes)
              nextTaken.add(order.projectCode)
              return [
                { _tag: "Accepted", receipt },
                {
                  nextOrderNumber: orderNumber + 1,
                  takenCodes: nextTaken,
                  receipts: [...state.receipts, receipt]
                }
              ]
            })

            if (outcome._tag === "Accepted") {
              return outcome.receipt
            }
            if (outcome._tag === "Conflict") {
              fieldErrors["projectCode"] = [outcome.reason]
            }
            return yield* new Order.OrderValidationError({
              message: "Please review the highlighted server errors.",
              fieldErrors,
              formErrors: []
            })
          })
      })
    })
  )
}
