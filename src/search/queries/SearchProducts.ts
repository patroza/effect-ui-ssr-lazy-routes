import { Query } from "@effect/ui"
import { Effect, Layer, Schema } from "effect"
import { RpcClient, RpcClientError } from "effect/rpc"
import * as Product from "../../product/domain/Product.ts"
import * as SearchRpcs from "../domain/SearchRpcs.ts"

/** Marker proving this page-only query lands in the Products chunk (see scripts/verify-bundles.ts). */
export const SEARCH_PRODUCTS_QUERY_CHUNK = "SENTINEL:search-products-query"

/**
 * The products matching the search text, fetched via `SearchRpcs` at
 * `POST /rpc/search`. Only `ProductsPage` imports it (and provides
 * `SearchProducts.layer` with `Component.provide`), so the query, its RPC group
 * and its protocol live in the Products chunk, while `HttpClient` and
 * `RpcSerialization` are provided once at the root.
 */
export class SearchProducts extends Query.Service<SearchProducts>()("search/SearchProducts", {
  args: { q: Schema.optional(Schema.String) },
  success: Schema.Array(Product.Product),
  error: RpcClientError.RpcClientError,
  staleTime: "5 minutes"
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(SearchRpcs.SearchRpcs)
      return ({ q }) => client.searchProducts({ q })
    })
  ).pipe(Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc/search" })))
}
