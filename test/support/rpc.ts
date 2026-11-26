import { Context, Effect, Layer, Ref } from "effect"
import * as ApiError from "../../src/rpc/domain/ApiError.ts"
import * as Rpc from "../../src/server/rpc.ts"
import * as AnalyticsStore from "../../src/server/services/AnalyticsStore.ts"
import * as BookmarkStore from "../../src/server/services/BookmarkStore.ts"
import * as CatalogStore from "../../src/server/services/CatalogStore.ts"

/** How many times each RPC operation ran. */
export interface RpcCounts {
  readonly searchProducts: number
  readonly getProduct: number
  readonly bookmarkProduct: number
  readonly getAnalytics: number
}

export const noCalls: RpcCounts = { searchProducts: 0, getProduct: 0, bookmarkProduct: 0, getAnalytics: 0 }

/**
 * Where the counting RPC handlers below write. A `Ref` per test, built with the
 * Layer: nothing is shared between tests, and nothing is a module-level `let`.
 */
export class RpcCalls extends Context.Service<
  RpcCalls,
  {
    readonly counts: Effect.Effect<RpcCounts>
    readonly record: (operation: keyof RpcCounts) => Effect.Effect<void>
  }
>()("test/RpcCalls") {}

const makeRpcCalls = Layer.effect(
  RpcCalls,
  Effect.gen(function* () {
    const ref = yield* Ref.make(noCalls)
    return RpcCalls.of({
      counts: Ref.get(ref),
      record: (operation) => Ref.update(ref, (counts) => ({ ...counts, [operation]: counts[operation] + 1 }))
    })
  })
)

const roundTripDelay = Effect.sleep("5 millis")

const makeCountingHandlers = (overrides?: {
  readonly bookmarkProduct?: (id: string) => Effect.Effect<void, ApiError.ApiError>
}) =>
  Rpc.AppRpcs.toLayer(
    Effect.gen(function* () {
      const calls = yield* RpcCalls
      const catalog = yield* CatalogStore.CatalogStore
      const bookmarks = yield* BookmarkStore.BookmarkStore
      const analytics = yield* AnalyticsStore.AnalyticsStore

      return {
        searchProducts: ({ q }) =>
          calls.record("searchProducts").pipe(Effect.andThen(roundTripDelay), Effect.andThen(catalog.search(q))),
        getProduct: ({ id }) =>
          calls.record("getProduct").pipe(Effect.andThen(roundTripDelay), Effect.andThen(catalog.find(id))),
        bookmarkProduct: ({ id }) =>
          calls.record("bookmarkProduct").pipe(
            Effect.andThen(
              overrides?.bookmarkProduct !== undefined
                ? overrides.bookmarkProduct(id)
                : roundTripDelay.pipe(
                    Effect.andThen(
                      Effect.gen(function* () {
                        if (!(yield* catalog.exists(id))) {
                          return yield* new ApiError.ApiError({ message: `Product "${id}" not found` })
                        }
                        yield* bookmarks.bookmark(id)
                      })
                    )
                  )
            )
          ),
        getAnalytics: ({ metric }) =>
          calls.record("getAnalytics").pipe(Effect.andThen(roundTripDelay), Effect.andThen(analytics.series(metric)))
      }
    })
  )

/**
 * In-process `RpcClient.Protocol` wired to the real `AppRpcs` handlers and
 * server stores, with a deterministic 5 ms `TestClock` round-trip and
 * per-test `Ref` call counters. Zero TCP sockets.
 */
export const makeCountingRpcProtocol = (overrides?: {
  readonly bookmarkProduct?: (id: string) => Effect.Effect<void, ApiError.ApiError>
}) =>
  Layer.fresh(Rpc.InProcessProtocolLayer).pipe(
    Layer.provide(makeCountingHandlers(overrides).pipe(Layer.provide(Layer.fresh(Rpc.ServerStoresLayer)))),
    Layer.provideMerge(Layer.fresh(makeRpcCalls))
  )

export const countingRpcProtocol = makeCountingRpcProtocol()
