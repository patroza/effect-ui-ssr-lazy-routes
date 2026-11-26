import { Context, Effect, Layer, Ref } from "effect"
import * as AnalyticsPort from "../../src/analytics/services/AnalyticsPort.ts"
import * as BookmarkPort from "../../src/product/services/BookmarkPort.ts"
import * as CatalogPort from "../../src/product/services/CatalogPort.ts"

/** How many times each port operation ran. */
export interface PortCounts {
  readonly searchProducts: number
  readonly getProduct: number
  readonly bookmarkProduct: number
  readonly getAnalytics: number
}

export const noCalls: PortCounts = { searchProducts: 0, getProduct: 0, bookmarkProduct: 0, getAnalytics: 0 }

/**
 * Where the counting ports below write. A `Ref` per test, built with the Layer: nothing is shared between tests,
 * and nothing is a module-level `let`.
 */
export class PortCalls extends Context.Service<
  PortCalls,
  {
    readonly counts: Effect.Effect<PortCounts>
    readonly record: (operation: keyof PortCounts) => Effect.Effect<void>
  }
>()("test/PortCalls") {}

const makePortCalls = Layer.effect(
  PortCalls,
  Effect.gen(function* () {
    const ref = yield* Ref.make(noCalls)
    return PortCalls.of({
      counts: Ref.get(ref),
      record: (operation) => Ref.update(ref, (counts) => ({ ...counts, [operation]: counts[operation] + 1 }))
    })
  })
)

/**
 * The production ports, each counting its calls into `PortCalls`.
 *
 * A page provides its own `CatalogPort.layer` with `Component.provide`, and the inner provide wins over an outer
 * one. `CatalogPort.layer` therefore reuses a port the Env already holds, which is how these reach the pages:
 * provide this Layer next to `TestHost.layer()`.
 *
 * Layers are memoized by identity, so the "server" of a test builds it with `Layer.fresh`: its own `Ref`, apart
 * from the "browser"'s.
 */
export const countingPorts = Layer.mergeAll(
  Layer.effect(
    CatalogPort.CatalogPort,
    Effect.gen(function* () {
      const calls = yield* PortCalls
      const live = CatalogPort.CatalogPort.live
      return CatalogPort.CatalogPort.of({
        search: (q) => Effect.andThen(calls.record("searchProducts"), live.search(q)),
        find: (id) => Effect.andThen(calls.record("getProduct"), live.find(id))
      })
    })
  ),
  Layer.effect(
    BookmarkPort.BookmarkPort,
    Effect.gen(function* () {
      const calls = yield* PortCalls
      const live = BookmarkPort.BookmarkPort.live
      return BookmarkPort.BookmarkPort.of({
        bookmark: (id) => Effect.andThen(calls.record("bookmarkProduct"), live.bookmark(id))
      })
    })
  ),
  Layer.effect(
    AnalyticsPort.AnalyticsPort,
    Effect.gen(function* () {
      const calls = yield* PortCalls
      const live = AnalyticsPort.AnalyticsPort.live
      return AnalyticsPort.AnalyticsPort.of({
        series: (metric) => Effect.andThen(calls.record("getAnalytics"), live.series(metric))
      })
    })
  )
).pipe(Layer.provideMerge(makePortCalls))
