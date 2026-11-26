import { Context, Effect, Layer, Option } from "effect"
import type * as Product from "../../product/domain/Product.ts"
import * as BookmarkStore from "./BookmarkStore.ts"

interface SeedProduct {
  readonly id: string
  readonly name: string
  readonly priceCents: number
  readonly blurb: string
}

const seedProducts: ReadonlyArray<SeedProduct> = [
  { id: "1", name: "Ceramic pour-over", priceCents: 3400, blurb: "Slow coffee, tidy cleanup." },
  { id: "7", name: "Walnut desk tray", priceCents: 4900, blurb: "Keeps small things in one place." },
  { id: "13", name: "Linen apron", priceCents: 5200, blurb: "Washes soft, wears long." },
  { id: "21", name: "Brass bookmark", priceCents: 1800, blurb: "A page-keeper that ages well." },
  { id: "42", name: "Field notebook", priceCents: 1200, blurb: "Dot grid, lay-flat binding." },
  { id: "64", name: "Enamel camp mug", priceCents: 1600, blurb: "Light, loud, and unbreakable." }
]

const withBookmark = (item: SeedProduct, bookmarked: ReadonlySet<string>): Product.Product => ({
  ...item,
  bookmarked: bookmarked.has(item.id)
})

/**
 * Server-only product catalog store. Holds the seed dataset and joins it with
 * `BookmarkStore` so bookmark mutations are reflected in subsequent reads.
 */
export class CatalogStore extends Context.Service<CatalogStore>()("server/CatalogStore", {
  make: Effect.gen(function* () {
    const bookmarks = yield* BookmarkStore.BookmarkStore

    const search = Effect.fn("CatalogStore.search")(function* (query: string | undefined) {
      const needle = query?.trim().toLowerCase() ?? ""
      const bookmarked = yield* bookmarks.all
      const matched =
        needle === ""
          ? seedProducts
          : seedProducts.filter((product) => `${product.name} ${product.blurb}`.toLowerCase().includes(needle))
      return matched.map((item) => withBookmark(item, bookmarked))
    })

    const find = Effect.fn("CatalogStore.find")(function* (id: string) {
      const item = seedProducts.find((product) => product.id === id)
      if (item === undefined) return Option.none<Product.Product>()
      const bookmarked = yield* bookmarks.all
      return Option.some(withBookmark(item, bookmarked))
    })

    const exists = Effect.fn("CatalogStore.exists")(function* (id: string) {
      return seedProducts.some((product) => product.id === id)
    })

    return { search, find, exists } as const
  })
}) {
  static readonly layer = Layer.effect(this, this.make)
}
