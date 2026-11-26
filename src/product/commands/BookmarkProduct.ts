import { Command } from "@effect/ui"
import { Effect, Schema } from "effect"
import { RpcClient } from "effect/rpc"
import * as ApiError from "../../rpc/domain/ApiError.ts"
import * as ProductRpcs from "../domain/ProductRpcs.ts"

/**
 * Bookmarks a product via `ProductRpcs`. It knows nothing of its caller's
 * messages: its domain result is `void` (or `ApiError`), and the page maps both
 * channels into its own messages with `Command.match`, so this module never
 * imports the page (no import cycle).
 */
export class BookmarkProduct extends Command.Service<BookmarkProduct>()("product/BookmarkProduct", {
  args: { id: Schema.String },
  success: Schema.Void,
  error: ApiError.ApiError
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(ProductRpcs.ProductRpcs)
      return ({ id }) =>
        client
          .bookmarkProduct({ id })
          .pipe(
            Effect.catchTag("RpcClientError", (error) => Effect.fail(new ApiError.ApiError({ message: error.message })))
          )
    })
  )
}
