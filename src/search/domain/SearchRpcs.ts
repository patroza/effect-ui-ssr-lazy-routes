import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import * as Product from "../../product/domain/Product.ts"
import * as ApiError from "../../rpc/domain/ApiError.ts"

/**
 * Search feature RPC group. Imported only by `SearchProducts` (Products chunk)
 * and the server's merged `AppRpcs`, so it never pulls other features' schemas.
 */
export class SearchRpcs extends RpcGroup.make(
  Rpc.make("searchProducts", {
    payload: { q: Schema.optional(Schema.String) },
    success: Schema.Array(Product.Product),
    error: ApiError.ApiError
  })
) {}
