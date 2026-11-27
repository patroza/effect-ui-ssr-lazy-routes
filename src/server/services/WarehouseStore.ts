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
export class WarehouseStore extends Context.Service<
  WarehouseStore,
  {
    readonly listCarts: Effect.Effect<ReadonlyArray<Warehouse.WarehouseCart>>
    readonly unblockCart: (params: {
      readonly cartId: string
      readonly simulateConflict: boolean
      readonly simulateExpired: boolean
    }) => Effect.Effect<Warehouse.WarehouseCart, Warehouse.WarehouseDomainError>
    readonly blockCart: (params: {
      readonly cartId: string
      readonly reason: Warehouse.BlockReason
      readonly note: string
      readonly simulateExpired: boolean
    }) => Effect.Effect<Warehouse.WarehouseCart, Warehouse.WarehouseDomainError>
    readonly preflightReleaseCart: (params: {
      readonly cartId: string
      readonly simulateExpired: boolean
    }) => Effect.Effect<Warehouse.PreflightReleaseResult, Warehouse.WarehouseDomainError>
    readonly releaseCart: (params: {
      readonly cartId: string
      readonly simulateExpired: boolean
    }) => Effect.Effect<Warehouse.ReleaseCartResult, Warehouse.WarehouseDomainError>
    readonly preflightDispatchCart: (params: {
      readonly cartId: string
      readonly simulateConflict: boolean
      readonly simulateExpired: boolean
    }) => Effect.Effect<Warehouse.PreflightDispatchResult, Warehouse.WarehouseDomainError>
    readonly dispatchCartStep: (params: {
      readonly cartId: string
      readonly step: Warehouse.DispatchStepKey
      readonly auditNote: string
      readonly simulateExpired: boolean
    }) => Effect.Effect<Warehouse.DispatchStepResult, Warehouse.WarehouseDomainError>
    readonly refreshSession: Effect.Effect<{ readonly renewed: boolean }>
  }
>()("server/WarehouseStore") {
  static readonly layer = Layer.effect(
    WarehouseStore,
    Effect.gen(function* () {
      const stateRef = yield* Ref.make<WarehouseStoreState>({
        carts: seedCarts,
        nextBatchNumber: 1
      })

      const findCart = (state: WarehouseStoreState, cartId: string): Warehouse.WarehouseCart | undefined =>
        state.carts.find((cart) => cart.id === cartId)

      return WarehouseStore.of({
        listCarts: Effect.map(Ref.get(stateRef), (state) => state.carts),

        unblockCart: ({ cartId, simulateConflict, simulateExpired }) =>
          Effect.gen(function* () {
            if (simulateExpired) {
              return yield* new Warehouse.SessionExpiredError({ action: "unblockCart" })
            }
            const state = yield* Ref.get(stateRef)
            const cart = findCart(state, cartId)
            if (cart === undefined) {
              return yield* new ApiError.ApiError({ message: `Unknown cart "${cartId}"` })
            }
            if (simulateConflict) {
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
              carts: current.carts.map((entry) => (entry.id === cartId ? updated : entry))
            }))
            return updated
          }),

        blockCart: ({ cartId, reason, note, simulateExpired }) =>
          Effect.gen(function* () {
            if (simulateExpired) {
              return yield* new Warehouse.SessionExpiredError({ action: "blockCart" })
            }
            if ((reason === "damage" || reason === "other") && note.trim().length < 5) {
              return yield* new ApiError.ApiError({
                message: "Notes are required (min 5 characters) for damage or other reasons"
              })
            }
            const state = yield* Ref.get(stateRef)
            const cart = findCart(state, cartId)
            if (cart === undefined) {
              return yield* new ApiError.ApiError({ message: `Unknown cart "${cartId}"` })
            }
            const updated: Warehouse.WarehouseCart = {
              ...cart,
              status: "Blocked",
              station: null,
              blockReason: reason,
              blockNote: note.trim() === "" ? null : note.trim()
            }
            yield* Ref.update(stateRef, (current) => ({
              ...current,
              carts: current.carts.map((entry) => (entry.id === cartId ? updated : entry))
            }))
            return updated
          }),

        preflightReleaseCart: ({ cartId, simulateExpired }) =>
          Effect.gen(function* () {
            if (simulateExpired) {
              return yield* new Warehouse.SessionExpiredError({ action: "releaseCart" })
            }
            const state = yield* Ref.get(stateRef)
            const cart = findCart(state, cartId)
            if (cart === undefined) {
              return yield* new ApiError.ApiError({ message: `Unknown cart "${cartId}"` })
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
            }
          }),

        releaseCart: ({ cartId, simulateExpired }) =>
          Effect.gen(function* () {
            if (simulateExpired) {
              return yield* new Warehouse.SessionExpiredError({ action: "releaseCart" })
            }
            const state = yield* Ref.get(stateRef)
            const cart = findCart(state, cartId)
            if (cart === undefined) {
              return yield* new ApiError.ApiError({ message: `Unknown cart "${cartId}"` })
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
              carts: current.carts.map((entry) => (entry.id === cartId ? updated : entry))
            }))
            return {
              cart: updated,
              clearedPicks: cart.pickCount
            }
          }),

        preflightDispatchCart: ({ cartId, simulateConflict, simulateExpired }) =>
          Effect.gen(function* () {
            if (simulateExpired) {
              return yield* new Warehouse.SessionExpiredError({ action: "dispatchCart" })
            }
            const state = yield* Ref.get(stateRef)
            const cart = findCart(state, cartId)
            if (cart === undefined) {
              return yield* new ApiError.ApiError({ message: `Unknown cart "${cartId}"` })
            }
            if (simulateConflict || cart.status === "InUse") {
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
            }
          }),

        dispatchCartStep: ({ cartId, step, auditNote, simulateExpired }) =>
          Effect.gen(function* () {
            if (simulateExpired) {
              return yield* new Warehouse.SessionExpiredError({ action: `dispatchCart:${step}` })
            }
            const state = yield* Ref.get(stateRef)
            const cart = findCart(state, cartId)
            if (cart === undefined) {
              return yield* new ApiError.ApiError({ message: `Unknown cart "${cartId}"` })
            }
            if (step === "validate" && cart.warningCount > 0 && auditNote.trim().length < 5) {
              return yield* new ApiError.ApiError({
                message: "Audit note must be at least 5 characters when warnings are present"
              })
            }

            const completed = stepOrder.indexOf(step) + 1
            if (step !== "erp") {
              return {
                step,
                completed,
                total: stepOrder.length,
                batchId: null
              }
            }

            const batchId = yield* Ref.modify(stateRef, (current) => {
              const id = `BATCH-${String(current.nextBatchNumber).padStart(4, "0")}`
              const nextCarts = current.carts.map((entry) =>
                entry.id === cartId
                  ? {
                      ...entry,
                      status: "Dispatched" as const,
                      lastBatchId: id,
                      blockNote: auditNote.trim() === "" ? entry.blockNote : auditNote.trim()
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
              step,
              completed,
              total: stepOrder.length,
              batchId
            }
          }),

        refreshSession: Effect.succeed({ renewed: true })
      })
    })
  )
}
