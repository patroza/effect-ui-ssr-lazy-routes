import { Effect } from "effect"
import * as ProductRpcs from "../../product/domain/ProductRpcs.ts"
import * as ApiError from "../../rpc/domain/ApiError.ts"
import * as BookmarkStore from "../services/BookmarkStore.ts"
import * as CatalogStore from "../services/CatalogStore.ts"

/** Live RPC handlers for `ProductRpcs` — yields only `CatalogStore` and `BookmarkStore`. */
export const ProductHandlersLayer = ProductRpcs.ProductRpcs.toLayer(
  Effect.gen(function* () {
    const catalog = yield* CatalogStore.CatalogStore
    const bookmarks = yield* BookmarkStore.BookmarkStore
    return {
      getProduct: ({ id }) => catalog.find(id),
      bookmarkProduct: ({ id }) =>
        Effect.gen(function* () {
          if (!(yield* catalog.exists(id))) {
            return yield* new ApiError.ApiError({ message: `Product "${id}" not found` })
          }
          yield* bookmarks.bookmark(id)
        })
    }
  })
)
