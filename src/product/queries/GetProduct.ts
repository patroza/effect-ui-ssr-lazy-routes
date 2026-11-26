import { Query } from "@effect/ui"
import { Effect, Schema } from "effect"
import { RpcClient } from "effect/rpc"
import * as ApiError from "../../rpc/domain/ApiError.ts"
import * as Product from "../domain/Product.ts"
import * as ProductRpcs from "../domain/ProductRpcs.ts"

/** Marker proving this page-only query lands in the ProductDetail chunk (see scripts/verify-bundles.ts). */
export const GET_PRODUCT_QUERY_CHUNK = "SENTINEL:get-product-query"

/**
 * One product by id (`None` when there is no such product), fetched via
 * `ProductRpcs`. Only `ProductDetailPage` imports it and provides
 * `GetProduct.layer` with `Component.provide`, so it lives in the ProductDetail
 * chunk while `RpcClient.Protocol` is provided once at the root.
 */
export class GetProduct extends Query.Service<GetProduct>()("product/GetProduct", {
  args: { id: Schema.String },
  success: Schema.Option(Product.Product),
  error: ApiError.ApiError,
  staleTime: "5 minutes"
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(ProductRpcs.ProductRpcs)
      return ({ id }) =>
        client
          .getProduct({ id })
          .pipe(
            Effect.catchTag("RpcClientError", (error) => Effect.fail(new ApiError.ApiError({ message: error.message })))
          )
    })
  )
}
