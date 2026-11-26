import { Context, Effect, Option } from "effect"
import * as Product from "../domain/Product.ts"

export interface CatalogPortService {
  readonly search: (q: string | undefined) => Effect.Effect<ReadonlyArray<Product.Product>>
  readonly find: (id: string) => Effect.Effect<Option.Option<Product.Product>>
}

/**
 * The production implementation: an in-memory catalog standing in for a network
 * round trip on the Effect clock, so a test (`TestClock`) decides when it completes.
 * Tests wrap it to observe calls (see `test/support/ports.ts`).
 */
export const live: CatalogPortService = {
  search: Effect.fn("CatalogPort.search")(function* (q: string | undefined) {
    yield* Effect.sleep("5 millis")
    return Product.searchProducts(q)
  }),
  find: Effect.fn("CatalogPort.find")(function* (id: string) {
    yield* Effect.sleep("5 millis")
    return Option.fromNullishOr(Product.findProduct(id))
  })
}

/**
 * The catalog's I/O. Queries capture it, so a query's fetcher never names the
 * data source. Every operation is an `Effect.fn`, so each call is a span.
 *
 * A `Context.Reference` carries `live` as its default: pages don't need to
 * provide it, so it stays in the shared catalog chunk while tests can override
 * it cleanly in any layer order.
 */
export const CatalogPort = Context.Reference<CatalogPortService>("product/CatalogPort", {
  defaultValue: () => live
})
