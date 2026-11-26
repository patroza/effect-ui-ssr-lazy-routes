import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import * as Product from "../../product/domain/Product.ts"

/**
 * Search feature RPC group. Imported only by `SearchProducts` (Products chunk)
 * and its server handler/route (`POST /rpc/search`), so it never pulls other
 * features' schemas.
 */
export class SearchRpcs extends RpcGroup.make(
  Rpc.make("searchProducts", {
    payload: { q: Schema.optional(Schema.String) },
    success: Schema.Array(Product.Product)
  })
) {}
