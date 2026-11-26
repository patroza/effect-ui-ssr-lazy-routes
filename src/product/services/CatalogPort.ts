import { Context, Effect, Layer, Option } from "effect"
import * as Products from "../domain/Product.ts"

/**
 * The catalog's I/O. Queries capture it, so a query's fetcher never names the
 * data source. Every operation is an `Effect.fn`, so each call is a span.
 *
 * The in-memory catalog stands in for a network round trip: it sleeps 5 ms on
 * the Effect clock, so a test (`TestClock`) decides when it completes.
 */
export class CatalogPort extends Context.Service<
  CatalogPort,
  {
    readonly search: (q: string | undefined) => Effect.Effect<ReadonlyArray<Products.Product>>
    readonly find: (id: string) => Effect.Effect<Option.Option<Products.Product>>
  }
>()("catalog/CatalogPort") {
  /** The production implementation. Tests wrap it to observe calls (see `test/support/ports.ts`). */
  static readonly live = CatalogPort.of({
    search: Effect.fn("CatalogPort.search")(function* (q: string | undefined) {
      yield* Effect.sleep("5 millis")
      return Products.searchProducts(q)
    }),
    find: Effect.fn("CatalogPort.find")(function* (id: string) {
      yield* Effect.sleep("5 millis")
      return Option.fromNullishOr(Products.findProduct(id))
    })
  })

  /**
   * What a page provides with `Component.provide`, so the port ships in the page's chunk. `Component.provide`
   * lets the INNER provide win, so a plain outer test Layer could never replace it. This Layer therefore reuses a
   * `CatalogPort` the Env already holds (a test's fake or counting wrapper) and falls back to `live`.
   */
  static readonly layer = Layer.effect(
    CatalogPort,
    Effect.map(
      Effect.serviceOption(CatalogPort),
      Option.getOrElse(() => CatalogPort.live)
    )
  )
}
