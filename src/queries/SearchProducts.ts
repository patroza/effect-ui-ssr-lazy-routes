import * as Query from "@effect/ui/Query"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { catalogReads, Product, searchProducts } from "../data/products.ts"

/** Marker proving this page-only query lands in the Products chunk (see scripts/verify-bundles.ts). */
export const SEARCH_PRODUCTS_QUERY_CHUNK = "SENTINEL:search-products-query"

/**
 * The products matching the search text. Only `ProductsPage` imports it (and
 * provides `SearchProducts.layer` with `Component.provide`), so the query and
 * its Layer live in the Products chunk, never in the entry chunk.
 */
export class SearchProducts extends Query.Service<SearchProducts>()("catalog/SearchProducts", {
  args: { q: Schema.optional(Schema.String) },
  success: Schema.Array(Product),
  error: Schema.Never,
  staleTime: "5 minutes"
}) {
  static readonly layer = this.toLayer(
    Effect.fnUntraced(function* ({ q }) {
      // A stand-in for a network round trip, so the cache has something to wait for.
      yield* Effect.sleep("5 millis")
      catalogReads.searchProducts += 1
      return searchProducts(q)
    })
  )
}
