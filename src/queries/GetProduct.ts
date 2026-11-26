import * as Query from "@effect/ui/Query"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { catalogReads, findProduct, Product } from "../data/products.ts"

/** Marker proving this page-only query lands in the ProductDetail chunk (see scripts/verify-bundles.ts). */
export const GET_PRODUCT_QUERY_CHUNK = "SENTINEL:get-product-query"

/**
 * One product by id (`None` when there is no such product). Only
 * `ProductDetailPage` imports it and provides `GetProduct.layer` with
 * `Component.provide`, so it lives in the ProductDetail chunk.
 */
export class GetProduct extends Query.Service<GetProduct>()("catalog/GetProduct", {
  args: { id: Schema.String },
  success: Schema.Option(Product),
  error: Schema.Never,
  staleTime: "5 minutes"
}) {
  static readonly layer = this.toLayer(
    Effect.fnUntraced(function* ({ id }) {
      yield* Effect.sleep("5 millis")
      catalogReads.getProduct += 1
      return Option.fromNullishOr(findProduct(id))
    })
  )
}
