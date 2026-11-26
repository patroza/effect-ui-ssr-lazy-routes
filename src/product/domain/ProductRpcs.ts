import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import * as ApiError from "../../rpc/domain/ApiError.ts"
import * as Product from "./Product.ts"

/**
 * Product detail feature RPC group. Imported only by `GetProduct`,
 * `BookmarkProduct` (ProductDetail chunk) and its server handler/route
 * (`POST /rpc/product`).
 */
export class ProductRpcs extends RpcGroup.make(
  Rpc.make("getProduct", {
    payload: { id: Schema.String },
    success: Schema.Option(Product.Product)
  }),
  Rpc.make("bookmarkProduct", {
    payload: { id: Schema.String },
    success: Schema.Void,
    error: ApiError.ApiError
  })
) {}
