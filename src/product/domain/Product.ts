import { Schema } from "effect"

/**
 * Lightweight product domain schema and display helper, shared only by the
 * Products and ProductDetail chunks (never the entry chunk). Seed datasets and
 * store implementations live strictly under `src/server/`.
 */
export const Product = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  priceCents: Schema.Finite,
  blurb: Schema.String,
  bookmarked: Schema.Boolean
})
export type Product = typeof Product.Type

/** Marker proving which chunk the product schema landed in (see scripts/verify-bundles.ts). */
export const PRODUCT_SCHEMA_CHUNK = "SENTINEL:product-schema"

export const formatPrice = (priceCents: number): string => `$${(priceCents / 100).toFixed(2)}`
