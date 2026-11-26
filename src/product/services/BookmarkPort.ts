import { Context, Effect, Layer, Option } from "effect"

/**
 * The bookmark write. `BookmarkProduct` (a `Command.Service`) captures it. The
 * operation is an `Effect.fn`, so each call is a span; the Command itself adds
 * none (`@effect/ui` already wraps every Command run in a span named by its key).
 */
export class BookmarkPort extends Context.Service<
  BookmarkPort,
  {
    readonly bookmark: (id: string) => Effect.Effect<void>
  }
>()("catalog/BookmarkPort") {
  /** The production implementation: a stand-in for a network round trip on the Effect clock. */
  static readonly live = BookmarkPort.of({
    bookmark: Effect.fn("BookmarkPort.bookmark")(function* (_id: string) {
      yield* Effect.sleep("5 millis")
    })
  })

  /** Provided by the page; reuses a `BookmarkPort` already in the Env (a test's), see `CatalogPort.layer`. */
  static readonly layer = Layer.effect(
    BookmarkPort,
    Effect.map(
      Effect.serviceOption(BookmarkPort),
      Option.getOrElse(() => BookmarkPort.live)
    )
  )
}
