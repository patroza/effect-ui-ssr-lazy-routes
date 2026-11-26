import { Query } from "@effect/ui"
import { Effect, Layer, Schema } from "effect"
import { RpcClient, RpcClientError } from "effect/rpc"
import * as Product from "../domain/Product.ts"
import * as ProductRpcs from "../domain/ProductRpcs.ts"

/** Marker proving this page-only query lands in the ProductDetail chunk (see scripts/verify-bundles.ts). */
export const GET_PRODUCT_QUERY_CHUNK = "SENTINEL:get-product-query"

/**
 * One product by id (`None` when there is no such product), fetched via
 * `ProductRpcs` at `POST /rpc/product`. Only `ProductDetailPage` imports it
 * and provides `GetProduct.layer` with `Component.provide`, so it lives in the
 * ProductDetail chunk while `HttpClient` and `RpcSerialization` are provided
 * once at the root.
 */
export class GetProduct extends Query.Service<GetProduct>()("product/GetProduct", {
  args: { id: Schema.String },
  success: Schema.Option(Product.Product),
  error: RpcClientError.RpcClientError,
  staleTime: "5 minutes"
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(ProductRpcs.ProductRpcs)
      return ({ id }) => client.getProduct({ id })
    })
  ).pipe(Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc/product" })))
}
