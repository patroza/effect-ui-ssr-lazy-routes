import { Query } from "@effect/ui"
import { Effect, Schema } from "effect"
import * as CatalogPort from "../services/CatalogPort.ts"
import * as Products from "../domain/Product.ts"

/** Marker proving this page-only query lands in the ProductDetail chunk (see scripts/verify-bundles.ts). */
export const GET_PRODUCT_QUERY_CHUNK = "SENTINEL:get-product-query"

/**
 * One product by id (`None` when there is no such product), read through
 * `CatalogPort`. Only `ProductDetailPage` imports it and provides
 * `GetProduct.layer` with `Component.provide`, so it lives in the ProductDetail chunk.
 */
export class GetProduct extends Query.Service<GetProduct>()("catalog/GetProduct", {
  args: { id: Schema.String },
  success: Schema.Option(Products.Product),
  error: Schema.Never,
  staleTime: "5 minutes"
}) {
  /** Requires `CatalogPort`. */
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const port = yield* CatalogPort.CatalogPort
      return ({ id }) => port.find(id)
    })
  )
}
