import { Query } from "@effect/ui"
import { Effect, Layer, Schema } from "effect"
import { RpcClient, RpcClientError } from "effect/rpc"
import * as ApiError from "../../rpc/domain/ApiError.ts"
import * as Status from "../domain/Status.ts"
import * as StatusRpcs from "../domain/StatusRpcs.ts"

/** Marker proving this page-only query lands in the Status chunk (see scripts/verify-bundles.ts). */
export const GET_STATUS_QUERY_CHUNK = "SENTINEL:get-status-query"

/**
 * Fetches system status via `StatusRpcs` at `POST /rpc/status`.
 * Only `StatusPage` imports it (`Component.provide(GetStatus.layer)`), keeping
 * the query, its RPC group, protocol, and schemas inside the Status chunk.
 */
export class GetStatus extends Query.Service<GetStatus>()("status/GetStatus", {
  args: { mode: Status.StatusMode },
  success: Status.SystemStatus,
  error: Schema.Union([ApiError.ApiError, RpcClientError.RpcClientError]),
  staleTime: "30 seconds"
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(StatusRpcs.StatusRpcs)
      return ({ mode }) => client.getStatus({ mode })
    })
  ).pipe(Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc/status" })))
}
