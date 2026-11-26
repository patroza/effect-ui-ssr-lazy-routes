import { Context, Effect, Layer, Ref } from "effect"

/**
 * Server-only in-memory bookmark store backed by a `Ref`. Lives strictly under
 * `src/server/` so no server state or store implementation ever enters `dist/client/`.
 */
export class BookmarkStore extends Context.Service<BookmarkStore>()("server/BookmarkStore", {
  make: Effect.gen(function* () {
    const bookmarked = yield* Ref.make<ReadonlySet<string>>(new Set())

    const bookmark = Effect.fn("BookmarkStore.bookmark")(function* (id: string) {
      yield* Ref.update(bookmarked, (current) => {
        if (current.has(id)) return current
        const next = new Set(current)
        next.add(id)
        return next
      })
    })

    const isBookmarked = Effect.fn("BookmarkStore.isBookmarked")(function* (id: string) {
      const current = yield* Ref.get(bookmarked)
      return current.has(id)
    })

    const all = Ref.get(bookmarked)

    return { bookmark, isBookmarked, all } as const
  })
}) {
  static readonly layer = Layer.effect(this, this.make)
}
