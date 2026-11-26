import { Effect } from "effect"
import * as SearchRpcs from "../../search/domain/SearchRpcs.ts"
import * as CatalogStore from "../services/CatalogStore.ts"

/** Live RPC handlers for `SearchRpcs` — yields only `CatalogStore`. */
export const SearchHandlersLayer = SearchRpcs.SearchRpcs.toLayer(
  Effect.gen(function* () {
    const catalog = yield* CatalogStore.CatalogStore
    return {
      searchProducts: ({ q }) => catalog.search(q)
    }
  })
)
