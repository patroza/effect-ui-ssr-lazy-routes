import { Command } from "@effect/ui"
import { Effect, Schema } from "effect"
import * as BookmarkPort from "../services/BookmarkPort.ts"

/**
 * Bookmarks a product. It knows nothing of its caller's messages: its domain
 * result is `void` (or a failure message), and the page maps both channels into
 * its own messages with `Command.match`, so this module never imports the page
 * (no import cycle).
 *
 * The body is a plain arrow over the port: `@effect/ui` already wraps every
 * Command run in a span named by this key, so there is no span of its own.
 * The port's operation carries the span.
 */
export class BookmarkProduct extends Command.Service<BookmarkProduct>()("product/BookmarkProduct", {
  args: { id: Schema.String },
  success: Schema.Void,
  error: Schema.String
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const port = yield* BookmarkPort.BookmarkPort
      return ({ id }) => port.bookmark(id)
    })
  )
}
