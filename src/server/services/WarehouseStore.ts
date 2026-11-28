import { Context, Effect, Layer, Ref } from "effect"
import * as ApiError from "../../rpc/domain/ApiError.ts"
import * as Warehouse from "../../warehouse/domain/Warehouse.ts"

interface WarehouseStoreState {
  readonly carts: ReadonlyArray<Warehouse.WarehouseCart>
  readonly nextBatchNumber: number
}

const seedCarts: ReadonlyArray<Warehouse.WarehouseCart> = [
  {
    id: "cart-101",
    code: "CART-101",
    station: null,
    status: "Free",
    pickCount: 6,
    valueCents: 14_500,
    warningCount: 0,
    blockReason: null,
    blockNote: null,
    lastBatchId: null
  },
  {
    id: "cart-102",
    code: "CART-102",
    station: null,
    status: "Free",
    pickCount: 4,
    valueCents: 8_900,
    warningCount: 2,
    blockReason: null,
    blockNote: null,
    lastBatchId: null
  },
  {
    id: "cart-204",
    code: "CART-204",
    station: "Packstation B",
    status: "InUse",
    pickCount: 8,
    valueCents: 21_200,
    warningCount: 0,
    blockReason: null,
    blockNote: null,
    lastBatchId: null
  },
  {
    id: "cart-309",
    code: "CART-309",
    station: null,
    status: "Blocked",
    pickCount: 0,
    valueCents: 0,
    warningCount: 0,
    blockReason: "maintenance",
    blockNote: "Caster inspection",
    lastBatchId: null
  }
]

const stepOrder: ReadonlyArray<Warehouse.DispatchStepKey> = ["validate", "reserve", "print", "erp"]

/**
 * `Ref`-backed warehouse state for `/warehouse` and `POST /rpc/warehouse`.
 * Exercises conflict errors (`ResourceCheckoutConflictError`), busy cart errors
 * (`CartInUseError`), simulated session expiry (`SessionExpiredError`),
 * optimistic unblocking, blocking forms, release confirmations, and 4-step
 * dispatch commits cleanly in-process and over HTTP.
 */
export class WarehouseStore extends Context.Service<WarehouseStore>()(
  "effect-ui-ssr-lazy-routes/server/services/WarehouseStore",
  {
    make: Effect.gen(function* () {
      const stateRef = yield* Ref.make<WarehouseStoreState>({
        carts: seedCarts,
        nextBatchNumber: 1
      })

      const findCart = (state: WarehouseStoreState, cartId: string): Warehouse.WarehouseCart | undefined =>
        state.carts.find((cart) => cart.id === cartId)

      const listCarts = Ref.get(stateRef).pipe(Effect.map((state) => state.carts))

      const unblockCart = Effect.fn("WarehouseStore.unblockCart")(function* (params: {
        readonly cartId: string
        readonly simulateConflict: boolean
        readonly simulateExpired: boolean
      }) {
        if (params.simulateExpired) {
          return yield* new Warehouse.SessionExpiredError({ action: "unblockCart" })
        }
        const state = yield* Ref.get(stateRef)
        const cart = findCart(state, params.cartId)
        if (cart === undefined) {
          return yield* new ApiError.ApiError({ message: `Unknown cart "${params.cartId}"` })
        }
        if (params.simulateConflict) {
          return yield* new Warehouse.ResourceCheckoutConflictError({
            reason: "spot-has-cart",
            resourceType: "packing-station",
            resourceName: "Bay-A2"
          })
        }
        const updated: Warehouse.WarehouseCart = {
          ...cart,
          status: "Free",
          blockReason: null,
          blockNote: null
        }
        yield* Ref.update(stateRef, (current) => ({
          ...current,
          carts: current.carts.map((entry) => (entry.id === params.cartId ? updated : entry))
        }))
        return updated
      })

      const blockCart = Effect.fn("WarehouseStore.blockCart")(function* (params: {
        readonly cartId: string
        readonly reason: Warehouse.BlockReason
        readonly note: string
        readonly simulateExpired: boolean
      }) {
        if (params.simulateExpired) {
          return yield* new Warehouse.SessionExpiredError({ action: "blockCart" })
        }
        if ((params.reason === "damage" || params.reason === "other") && params.note.trim().length < 5) {
          return yield* new ApiError.ApiError({
            message: "Notes are required (min 5 characters) for damage or other reasons"
          })
        }
        const state = yield* Ref.get(stateRef)
        const cart = findCart(state, params.cartId)
        if (cart === undefined) {
          return yield* new ApiError.ApiError({ message: `Unknown cart "${params.cartId}"` })
        }
        const updated: Warehouse.WarehouseCart = {
          ...cart,
          status: "Blocked",
          station: null,
          blockReason: params.reason,
          blockNote: params.note.trim() === "" ? null : params.note.trim()
        }
        yield* Ref.update(stateRef, (current) => ({
          ...current,
          carts: current.carts.map((entry) => (entry.id === params.cartId ? updated : entry))
        }))
        return updated
      })

      const preflightReleaseCart = Effect.fn("WarehouseStore.preflightReleaseCart")(function* (params: {
        readonly cartId: string
        readonly simulateExpired: boolean
      }) {
        if (params.simulateExpired) {
          return yield* new Warehouse.SessionExpiredError({ action: "releaseCart" })
        }
        const state = yield* Ref.get(stateRef)
        const cart = findCart(state, params.cartId)
        if (cart === undefined) {
          return yield* new ApiError.ApiError({ message: `Unknown cart "${params.cartId}"` })
        }
        if (cart.status === "InUse") {
          return yield* new Warehouse.CartInUseError({
            cartCode: cart.code,
            station: cart.station ?? "Packstation"
          })
        }
        return {
          cartId: cart.id,
          cartCode: cart.code,
          pickCount: cart.pickCount
        } satisfies Warehouse.PreflightReleaseResult
      })

      const releaseCart = Effect.fn("WarehouseStore.releaseCart")(function* (params: {
        readonly cartId: string
        readonly simulateExpired: boolean
      }) {
        if (params.simulateExpired) {
          return yield* new Warehouse.SessionExpiredError({ action: "releaseCart" })
        }
        const state = yield* Ref.get(stateRef)
        const cart = findCart(state, params.cartId)
        if (cart === undefined) {
          return yield* new ApiError.ApiError({ message: `Unknown cart "${params.cartId}"` })
        }
        if (cart.status === "InUse") {
          return yield* new Warehouse.CartInUseError({
            cartCode: cart.code,
            station: cart.station ?? "Packstation"
          })
        }
        const updated: Warehouse.WarehouseCart = {
          ...cart,
          status: "Free",
          station: null,
          pickCount: 0,
          valueCents: 0,
          warningCount: 0
        }
        yield* Ref.update(stateRef, (current) => ({
          ...current,
          carts: current.carts.map((entry) => (entry.id === params.cartId ? updated : entry))
        }))
        return {
          cart: updated,
          clearedPicks: cart.pickCount
        } satisfies Warehouse.ReleaseCartResult
      })

      const preflightDispatchCart = Effect.fn("WarehouseStore.preflightDispatchCart")(function* (params: {
        readonly cartId: string
        readonly simulateConflict: boolean
        readonly simulateExpired: boolean
      }) {
        if (params.simulateExpired) {
          return yield* new Warehouse.SessionExpiredError({ action: "dispatchCart" })
        }
        const state = yield* Ref.get(stateRef)
        const cart = findCart(state, params.cartId)
        if (cart === undefined) {
          return yield* new ApiError.ApiError({ message: `Unknown cart "${params.cartId}"` })
        }
        if (params.simulateConflict || cart.status === "InUse") {
          return yield* new Warehouse.ResourceCheckoutConflictError({
            reason: "resource-in-use",
            resourceType: "cart",
            resourceName: cart.code
          })
        }
        if (cart.status === "Blocked") {
          return yield* new ApiError.ApiError({ message: `Cart ${cart.code} is blocked` })
        }
        return {
          cartId: cart.id,
          cartCode: cart.code,
          pickCount: cart.pickCount,
          valueCents: cart.valueCents,
          warningCount: cart.warningCount
        } satisfies Warehouse.PreflightDispatchResult
      })

      const dispatchCartStep = Effect.fn("WarehouseStore.dispatchCartStep")(function* (params: {
        readonly cartId: string
        readonly step: Warehouse.DispatchStepKey
        readonly auditNote: string
        readonly simulateExpired: boolean
      }) {
        if (params.simulateExpired) {
          return yield* new Warehouse.SessionExpiredError({ action: `dispatchCart:${params.step}` })
        }
        const state = yield* Ref.get(stateRef)
        const cart = findCart(state, params.cartId)
        if (cart === undefined) {
          return yield* new ApiError.ApiError({ message: `Unknown cart "${params.cartId}"` })
        }
        if (params.step === "validate" && cart.warningCount > 0 && params.auditNote.trim().length < 5) {
          return yield* new ApiError.ApiError({
            message: "Audit note must be at least 5 characters when warnings are present"
          })
        }

        const completed = stepOrder.indexOf(params.step) + 1
        if (params.step !== "erp") {
          return {
            step: params.step,
            completed,
            total: stepOrder.length,
            batchId: null
          } satisfies Warehouse.DispatchStepResult
        }

        const batchId = yield* Ref.modify(stateRef, (current) => {
          const id = `BATCH-${String(current.nextBatchNumber).padStart(4, "0")}`
          const nextCarts = current.carts.map((entry) =>
            entry.id === params.cartId
              ? {
                  ...entry,
                  status: "Dispatched" as const,
                  lastBatchId: id,
                  blockNote: params.auditNote.trim() === "" ? entry.blockNote : params.auditNote.trim()
                }
              : entry
          )
          return [
            id,
            {
              carts: nextCarts,
              nextBatchNumber: current.nextBatchNumber + 1
            }
          ]
        })
        return {
          step: params.step,
          completed,
          total: stepOrder.length,
          batchId
        } satisfies Warehouse.DispatchStepResult
      })

      const refreshSession = Effect.succeed({ renewed: true })

      return {
        listCarts,
        unblockCart,
        blockCart,
        preflightReleaseCart,
        releaseCart,
        preflightDispatchCart,
        dispatchCartStep,
        refreshSession
      } as const
    })
  }
) {
  static readonly layer = Layer.effect(this, this.make)
}
