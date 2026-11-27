import { Rpc, RpcGroup } from "effect/rpc"
import * as ApiError from "../../rpc/domain/ApiError.ts"
import * as Status from "./Status.ts"

/** RPC group for the `/status` error & refresh demo, mounted independently at `/rpc/status`. */
export const StatusRpcs = RpcGroup.make(
  Rpc.make("getStatus", {
    payload: {
      mode: Status.StatusMode
    },
    success: Status.SystemStatus,
    error: ApiError.ApiError
  })
)
