import * as Schema from "effect/Schema"

/**
 * A tiny in-memory catalog. It is imported by the Products and ProductDetail
 * query services only, so the bundler puts it in a chunk shared by those two
 * pages (never in the entry chunk).
 */
export const Product = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  priceCents: Schema.Finite,
  blurb: Schema.String
})
export type Product = typeof Product.Type

/**
 * How many times the catalog was actually read by a query fetcher. Production
 * code never reads it; the tests assert it stays 0 on the client while a
 * server-rendered page hydrates from the state's `~query` entries.
 */
export const catalogReads = { searchProducts: 0, getProduct: 0 }

/** How many times the `BookmarkProduct` Command body ran. The tests assert the click ran it exactly once. */
export const catalogWrites = { bookmarkProduct: 0 }

/** Marker proving which chunk the catalog landed in (see scripts/verify-bundles.ts). */
export const CATALOG_CHUNK = "SENTINEL:catalog-data"

export const products: ReadonlyArray<Product> = [
  { id: "1", name: "Ceramic pour-over", priceCents: 3400, blurb: "Slow coffee, tidy cleanup." },
  { id: "7", name: "Walnut desk tray", priceCents: 4900, blurb: "Keeps small things in one place." },
  { id: "13", name: "Linen apron", priceCents: 5200, blurb: "Washes soft, wears long." },
  { id: "21", name: "Brass bookmark", priceCents: 1800, blurb: "A page-keeper that ages well." },
  { id: "42", name: "Field notebook", priceCents: 1200, blurb: "Dot grid, lay-flat binding." },
  { id: "64", name: "Enamel camp mug", priceCents: 1600, blurb: "Light, loud, and unbreakable." }
]

export const findProduct = (id: string): Product | undefined => products.find((product) => product.id === id)

export const searchProducts = (query: string | undefined): ReadonlyArray<Product> => {
  const needle = query?.trim().toLowerCase() ?? ""
  return needle === ""
    ? products
    : products.filter((product) => `${product.name} ${product.blurb}`.toLowerCase().includes(needle))
}

export const formatPrice = (priceCents: number): string => `$${(priceCents / 100).toFixed(2)}`
