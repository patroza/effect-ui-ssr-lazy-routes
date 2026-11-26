import { Query } from "@effect/ui"
import { Effect, Schema } from "effect"
import { RpcClient } from "effect/rpc"
import * as Product from "../../product/domain/Product.ts"
import * as ApiError from "../../rpc/domain/ApiError.ts"
import * as SearchRpcs from "../domain/SearchRpcs.ts"

/** Marker proving this page-only query lands in the Products chunk (see scripts/verify-bundles.ts). */
export const SEARCH_PRODUCTS_QUERY_CHUNK = "SENTINEL:search-products-query"

/**
 * The products matching the search text, fetched via `SearchRpcs`. Only
 * `ProductsPage` imports it (and provides `SearchProducts.layer` with
 * `Component.provide`), so the query, its RPC group and its Layer live in the
 * Products chunk, while `RpcClient.Protocol` is provided once at the root.
 */
export class SearchProducts extends Query.Service<SearchProducts>()("search/SearchProducts", {
  args: { q: Schema.optional(Schema.String) },
  success: Schema.Array(Product.Product),
  error: ApiError.ApiError,
  staleTime: "5 minutes"
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(SearchRpcs.SearchRpcs)
      return ({ q }) =>
        client
          .searchProducts({ q })
          .pipe(
            Effect.catchTag("RpcClientError", (error) => Effect.fail(new ApiError.ApiError({ message: error.message })))
          )
    })
  )
}
