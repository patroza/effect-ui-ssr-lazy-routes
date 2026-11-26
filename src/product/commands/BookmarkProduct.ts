import { Command } from "@effect/ui"
import { Effect, Schema } from "effect"
import * as BookmarkPort from "../services/BookmarkPort.ts"

/**
 * Bookmarks a product. It knows nothing of its caller's messages: its domain
 * result is `{ bookmarked }`, and the page maps it into its own message with
 * `Command.map`, so this module never imports the page (no import cycle). It
 * can't fail (`error` defaults to `Schema.Never`).
 *
 * The body is a plain arrow over the port: `@effect/ui` already wraps every
 * Command run in a span named by this key, so there is no span of its own
 * (Scrapline #2619). The port's operation carries the span.
 */
export class BookmarkProduct extends Command.Service<BookmarkProduct>()("catalog/BookmarkProduct", {
  args: { id: Schema.String },
  success: Schema.Struct({ bookmarked: Schema.Boolean })
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const port = yield* BookmarkPort.BookmarkPort
      return ({ id }) => Effect.as(port.bookmark(id), { bookmarked: true })
    })
  )
}
