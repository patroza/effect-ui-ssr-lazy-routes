import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import * as ApiError from "../../rpc/domain/ApiError.ts"
import * as Product from "./Product.ts"

/**
 * Product detail feature RPC group. Imported only by `GetProduct`,
 * `BookmarkProduct` (ProductDetail chunk) and the server's merged `AppRpcs`.
 */
export class ProductRpcs extends RpcGroup.make(
  Rpc.make("getProduct", {
    payload: { id: Schema.String },
    success: Schema.Option(Product.Product),
    error: ApiError.ApiError
  }),
  Rpc.make("bookmarkProduct", {
    payload: { id: Schema.String },
    success: Schema.Void,
    error: ApiError.ApiError
  })
) {}
