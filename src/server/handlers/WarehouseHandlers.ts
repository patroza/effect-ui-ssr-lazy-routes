import { Effect } from "effect"
import * as WarehouseRpcs from "../../warehouse/domain/WarehouseRpcs.ts"
import * as WarehouseStore from "../services/WarehouseStore.ts"

/** Live RPC handlers for `WarehouseRpcs` — yields only `WarehouseStore`. */
export const WarehouseHandlersLayer = WarehouseRpcs.WarehouseRpcs.toLayer(
  Effect.gen(function* () {
    const store = yield* WarehouseStore.WarehouseStore
    return {
      getWarehouseCarts: () => store.listCarts,
      unblockCart: (params) => store.unblockCart(params),
      blockCart: (params) => store.blockCart(params),
      preflightReleaseCart: (params) => store.preflightReleaseCart(params),
      releaseCart: (params) => store.releaseCart(params),
      preflightDispatchCart: (params) => store.preflightDispatchCart(params),
      dispatchCartStep: (params) => store.dispatchCartStep(params),
      refreshSession: () => store.refreshSession
    }
  })
)
