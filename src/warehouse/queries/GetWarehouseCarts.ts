import { Query } from "@effect/ui"
import { Effect, Layer, Schema } from "effect"
import { RpcClient, RpcClientError } from "effect/rpc"
import * as ApiError from "../../rpc/domain/ApiError.ts"
import * as Warehouse from "../domain/Warehouse.ts"
import * as WarehouseRpcs from "../domain/WarehouseRpcs.ts"

/** Marker proving this page-only query lands only in the Warehouse chunk (see scripts/verify-bundles.ts). */
export const GET_WAREHOUSE_CARTS_QUERY_CHUNK = "SENTINEL:get-warehouse-carts-query"

/**
 * Loads the warehouse picking carts via `WarehouseRpcs` at `POST /rpc/warehouse`.
 * Invalidated and optimistically patched by warehouse Commands.
 */
export class GetWarehouseCarts extends Query.Service<GetWarehouseCarts>()("warehouse/GetWarehouseCarts", {
  args: {},
  success: Schema.Array(Warehouse.WarehouseCart),
  error: Schema.Union([ApiError.ApiError, RpcClientError.RpcClientError]),
  staleTime: "30 seconds"
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(WarehouseRpcs.WarehouseRpcs)
      return () => client.getWarehouseCarts()
    })
  ).pipe(Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc/warehouse" })))
}
