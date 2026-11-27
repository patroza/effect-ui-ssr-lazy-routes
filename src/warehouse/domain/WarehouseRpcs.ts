import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import * as ApiError from "../../rpc/domain/ApiError.ts"
import * as Warehouse from "./Warehouse.ts"

/**
 * Warehouse Command Console RPC procedures exposed over `POST /rpc/warehouse`.
 * Kept in the feature chunk so neither entry nor unrelated pages bundle it.
 */
export class WarehouseRpcs extends RpcGroup.make(
  Rpc.make("getWarehouseCarts", {
    success: Schema.Array(Warehouse.WarehouseCart),
    error: ApiError.ApiError
  }),
  Rpc.make("unblockCart", {
    payload: {
      cartId: Schema.String,
      simulateConflict: Schema.Boolean,
      simulateExpired: Schema.Boolean
    },
    success: Warehouse.WarehouseCart,
    error: Warehouse.WarehouseDomainError
  }),
  Rpc.make("blockCart", {
    payload: {
      cartId: Schema.String,
      reason: Warehouse.BlockReason,
      note: Schema.String,
      simulateExpired: Schema.Boolean
    },
    success: Warehouse.WarehouseCart,
    error: Warehouse.WarehouseDomainError
  }),
  Rpc.make("preflightReleaseCart", {
    payload: {
      cartId: Schema.String,
      simulateExpired: Schema.Boolean
    },
    success: Warehouse.PreflightReleaseResult,
    error: Warehouse.WarehouseDomainError
  }),
  Rpc.make("releaseCart", {
    payload: {
      cartId: Schema.String,
      simulateExpired: Schema.Boolean
    },
    success: Warehouse.ReleaseCartResult,
    error: Warehouse.WarehouseDomainError
  }),
  Rpc.make("preflightDispatchCart", {
    payload: {
      cartId: Schema.String,
      simulateConflict: Schema.Boolean,
      simulateExpired: Schema.Boolean
    },
    success: Warehouse.PreflightDispatchResult,
    error: Warehouse.WarehouseDomainError
  }),
  Rpc.make("dispatchCartStep", {
    payload: {
      cartId: Schema.String,
      step: Warehouse.DispatchStepKey,
      auditNote: Schema.String,
      simulateExpired: Schema.Boolean
    },
    success: Warehouse.DispatchStepResult,
    error: Warehouse.WarehouseDomainError
  }),
  Rpc.make("refreshSession", {
    success: Schema.Struct({ renewed: Schema.Boolean }),
    error: ApiError.ApiError
  })
) {}
