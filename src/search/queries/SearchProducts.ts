import { Query } from "@effect/ui"
import { Effect, Schema } from "effect"
import * as Product from "../../product/domain/Product.ts"
import * as CatalogPort from "../../product/services/CatalogPort.ts"

/** Marker proving this page-only query lands in the Products chunk (see scripts/verify-bundles.ts). */
export const SEARCH_PRODUCTS_QUERY_CHUNK = "SENTINEL:search-products-query"

/**
 * The products matching the search text, read through `CatalogPort`. Only
 * `ProductsPage` imports it (and provides `SearchProducts.layer` with
 * `Component.provide`), so the query and its Layer live in the Products chunk,
 * never in the entry chunk.
 */
export class SearchProducts extends Query.Service<SearchProducts>()("search/SearchProducts", {
  args: { q: Schema.optional(Schema.String) },
  success: Schema.Array(Product.Product),
  error: Schema.Never,
  staleTime: "5 minutes"
}) {
  /** Reads `CatalogPort` (a `Context.Reference` defaulting to `live`). */
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const port = yield* CatalogPort.CatalogPort
      return ({ q }) => port.search(q)
    })
  )
}
