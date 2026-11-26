import { Context, Effect } from "effect"

export interface BookmarkPortService {
  readonly bookmark: (id: string) => Effect.Effect<void, string>
}

/** The production implementation: a stand-in for a network round trip on the Effect clock. */
export const live: BookmarkPortService = {
  bookmark: Effect.fn("BookmarkPort.bookmark")(function* (_id: string) {
    yield* Effect.sleep("5 millis")
  })
}

/**
 * The bookmark write. `BookmarkProduct` (a `Command.Service`) captures it. The
 * operation is an `Effect.fn`, so each call is a span; the Command itself adds
 * none (`@effect/ui` already wraps every Command run in a span named by its key).
 *
 * A `Context.Reference` carries `live` as its default, so it stays in the
 * ProductDetail chunk while tests can override it cleanly in any layer order.
 */
export const BookmarkPort = Context.Reference<BookmarkPortService>("product/BookmarkPort", {
  defaultValue: () => live
})
