import { Command } from "@effect/ui"
import { Effect, Layer, Schema } from "effect"
import { RpcClient, RpcClientError } from "effect/rpc"
import * as ApiError from "../../rpc/domain/ApiError.ts"
import * as ProductRpcs from "../domain/ProductRpcs.ts"

/**
 * Bookmarks a product via `ProductRpcs` at `POST /rpc/product`. It knows
 * nothing of its caller's messages: its domain result is `void` (or
 * `ApiError | RpcClientError`), and the page maps both channels into its own
 * messages with `Command.match`, so this module never imports the page (no
 * import cycle).
 */
export class BookmarkProduct extends Command.Service<BookmarkProduct>()("product/BookmarkProduct", {
  args: { id: Schema.String },
  success: Schema.Void,
  error: Schema.Union([ApiError.ApiError, RpcClientError.RpcClientError])
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(ProductRpcs.ProductRpcs)
      return ({ id }) => client.bookmarkProduct({ id })
    })
  ).pipe(Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc/product" })))
}
