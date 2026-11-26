import { Context, Effect, Layer, Ref } from "effect"
import { HttpClient, type HttpClientError, type HttpClientRequest, HttpRouter } from "effect/http"
import { RpcSerialization } from "effect/rpc"
import * as AnalyticsRpcs from "../../src/analytics/domain/AnalyticsRpcs.ts"
import * as ProductRpcs from "../../src/product/domain/ProductRpcs.ts"
import * as ApiError from "../../src/rpc/domain/ApiError.ts"
import * as SearchRpcs from "../../src/search/domain/SearchRpcs.ts"
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

const makeCountingSearchHandlers = () =>
  SearchRpcs.SearchRpcs.toLayer(
    Effect.gen(function* () {
      const calls = yield* RpcCalls
      const catalog = yield* CatalogStore.CatalogStore
      return {
        searchProducts: ({ q }) =>
          calls.record("searchProducts").pipe(Effect.andThen(roundTripDelay), Effect.andThen(catalog.search(q)))
      }
    })
  )

const makeCountingProductHandlers = (overrides?: {
  readonly bookmarkProduct?: (id: string) => Effect.Effect<void, ApiError.ApiError>
}) =>
  ProductRpcs.ProductRpcs.toLayer(
    Effect.gen(function* () {
      const calls = yield* RpcCalls
      const catalog = yield* CatalogStore.CatalogStore
      const bookmarks = yield* BookmarkStore.BookmarkStore
      return {
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
          )
      }
    })
  )

const makeCountingAnalyticsHandlers = () =>
  AnalyticsRpcs.AnalyticsRpcs.toLayer(
    Effect.gen(function* () {
      const calls = yield* RpcCalls
      const analytics = yield* AnalyticsStore.AnalyticsStore
      return {
        getAnalytics: ({ metric }) =>
          calls.record("getAnalytics").pipe(Effect.andThen(roundTripDelay), Effect.andThen(analytics.series(metric)))
      }
    })
  )

const makeCountingHandlers = (overrides?: {
  readonly bookmarkProduct?: (id: string) => Effect.Effect<void, ApiError.ApiError>
}) =>
  Layer.mergeAll(makeCountingSearchHandlers(), makeCountingProductHandlers(overrides), makeCountingAnalyticsHandlers())

/**
 * In-process `HttpClient` + `RpcSerialization` wired to the real per-group
 * HTTP RPC routes (`/rpc/{search,product,analytics}`) and server stores, with a
 * deterministic 5 ms `TestClock` round-trip and per-test `Ref` call counters.
 * Zero TCP sockets.
 *
 * `failRequest` optionally intercepts outgoing HTTP RPC requests to inject a
 * real `HttpClientError` (wrapped by `RpcClient` into `RpcClientError`).
 */
export const makeCountingRpcProtocol = (overrides?: {
  readonly bookmarkProduct?: (id: string) => Effect.Effect<void, ApiError.ApiError>
  readonly failRequest?: (request: HttpClientRequest.HttpClientRequest) => HttpClientError.HttpClientError | undefined
}) =>
  Layer.mergeAll(
    Layer.effect(
      HttpClient.HttpClient,
      HttpRouter.toHttpEffect(Rpc.RpcHttpLayer).pipe(
        Effect.provideService(HttpRouter.RouterConfig, { ignoreTrailingSlash: true }),
        Effect.map((rpcEffect) => {
          const base = Rpc.makeInProcessHttpClient(rpcEffect)
          if (overrides?.failRequest === undefined) return base
          const failRequest = overrides.failRequest
          return HttpClient.makeWith<HttpClientError.HttpClientError, never, HttpClientError.HttpClientError, never>(
            (requestEffect) =>
              Effect.flatMap(requestEffect, (request) => {
                const error = failRequest(request)
                return error !== undefined ? Effect.fail(error) : base.execute(request)
              }),
            Effect.succeed
          )
        })
      )
    ),
    RpcSerialization.layerJson
  ).pipe(
    Layer.provide(makeCountingHandlers(overrides).pipe(Layer.provide(Layer.fresh(Rpc.ServerStoresLayer)))),
    Layer.provideMerge(Layer.fresh(makeRpcCalls))
  )

export const countingRpcProtocol = makeCountingRpcProtocol()
