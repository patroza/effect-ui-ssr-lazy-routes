import { Context, Effect, Layer, Ref } from "effect"
import type * as I18n from "../../i18n/I18n.ts"
import * as Order from "../../order/domain/Order.ts"
import * as ApiError from "../../rpc/domain/ApiError.ts"

interface OrderStoreState {
  readonly nextOrderNumber: number
  readonly takenCodes: ReadonlySet<string>
  readonly receipts: ReadonlyArray<Order.OrderReceipt>
}

const initialTakenCodes: ReadonlyArray<string> = ["taken-code", "legacy-01"]

const validPromos: ReadonlyMap<string, { readonly discountPercent: number; readonly en: string; readonly de: string }> =
  new Map([
    ["STUDIO15", { discountPercent: 15, en: "15% studio discount", de: "15 % Studio-Rabatt" }],
    ["WHOLESALE25", { discountPercent: 25, en: "25% wholesale discount", de: "25 % Großhandelsrabatt" }]
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
 * submission claiming, typed field-level `OrderValidationError`, localized
 * server messages via `Accept-Language`, and simulated `ApiError` failure for `"server-error"`.
 */
export class OrderStore extends Context.Service<OrderStore>()("effect-ui-ssr-lazy-routes/server/services/OrderStore", {
  make: Effect.gen(function* () {
    const stateRef = yield* Ref.make<OrderStoreState>({
      nextOrderNumber: 1,
      takenCodes: new Set(initialTakenCodes),
      receipts: []
    })

    const checkOrderCode = Effect.fn("OrderStore.checkOrderCode")(function* (
      code: string,
      locale: I18n.AppLocale = "en"
    ) {
      const state = yield* Ref.get(stateRef)
      const trimmed = code.trim()
      if (state.takenCodes.has(trimmed)) {
        return {
          available: false,
          reason:
            locale === "de"
              ? `Projektcode „${trimmed}“ ist bereits vergeben`
              : `Project code "${trimmed}" is already taken`,
          suggestion: nextAvailableSuggestion(trimmed, state.takenCodes)
        } satisfies Order.OrderCodeCheckResult
      }
      return {
        available: true,
        reason: null,
        suggestion: null
      } satisfies Order.OrderCodeCheckResult
    })

    const validatePromoCode = Effect.fn("OrderStore.validatePromoCode")(function* (
      code: string,
      locale: I18n.AppLocale = "en"
    ) {
      const trimmed = code.trim().toUpperCase()
      const promo = validPromos.get(trimmed)
      if (promo !== undefined) {
        return {
          valid: true,
          discountPercent: promo.discountPercent,
          description: locale === "de" ? promo.de : promo.en
        } satisfies Order.PromoValidationResult
      }
      return {
        valid: false,
        discountPercent: 0,
        description:
          locale === "de"
            ? `Aktionscode „${code.trim()}“ ist nicht bekannt`
            : `Promo code "${code.trim()}" is not recognized`
      } satisfies Order.PromoValidationResult
    })

    const submitOrder = Effect.fn("OrderStore.submitOrder")(function* (
      order: Order.OrderSubmission,
      locale: I18n.AppLocale = "en"
    ) {
      if (order.projectCode === "server-error") {
        return yield* new ApiError.ApiError({
          message:
            locale === "de"
              ? "Bestelldienst vorübergehend nicht erreichbar. Bitte erneut versuchen."
              : "Order service temporarily unavailable. Please retry."
        })
      }

      const fieldErrors: Record<string, ReadonlyArray<string>> = {}
      if (order.contactEmail.toLowerCase().endsWith("@blocked.test")) {
        fieldErrors["contactEmail"] = [
          locale === "de"
            ? "Bestellungen von @blocked.test-Domains erfordern eine manuelle Freigabe"
            : "Orders from @blocked.test domains require manual approval"
        ]
      }
      if (order.billing._tag === "Invoice" && order.billing.poNumber === "PO-REJECTED") {
        fieldErrors["billing.poNumber"] = [
          locale === "de"
            ? "Bestellung PO-REJECTED hat das Kreditlimit überschritten"
            : "Purchase order PO-REJECTED has exceeded its credit limit"
        ]
      }
      let discountPercent = 0
      if (order.promoCode !== "") {
        const promo = validPromos.get(order.promoCode.trim().toUpperCase())
        if (promo === undefined) {
          fieldErrors["promoCode"] = [
            locale === "de"
              ? `Aktionscode „${order.promoCode}“ ist unbekannt oder abgelaufen`
              : `Promo code "${order.promoCode}" is unknown or expired`
          ]
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
              reason:
                locale === "de"
                  ? `Projektcode „${order.projectCode}“ wurde vor Abschluss vergeben`
                  : `Order code "${order.projectCode}" was claimed before submission completed`
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
        message:
          locale === "de"
            ? "Bitte prüfen Sie die markierten Serverfehler."
            : "Please review the highlighted server errors.",
        fieldErrors,
        formErrors: []
      })
    })

    return { checkOrderCode, validatePromoCode, submitOrder } as const
  })
}) {
  static readonly layer = Layer.effect(this, this.make)
}
