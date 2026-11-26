import { Deferred, Effect, Layer, Queue } from "effect"
import { RpcClient, type RpcMessage, RpcSerialization, RpcServer } from "effect/rpc"
import * as AnalyticsRpcs from "../analytics/domain/AnalyticsRpcs.ts"
import * as ProductRpcs from "../product/domain/ProductRpcs.ts"
import * as ApiError from "../rpc/domain/ApiError.ts"
import * as SearchRpcs from "../search/domain/SearchRpcs.ts"
import * as AnalyticsStore from "./services/AnalyticsStore.ts"
import * as BookmarkStore from "./services/BookmarkStore.ts"
import * as CatalogStore from "./services/CatalogStore.ts"

/**
 * Server-side merged RPC group combining all three feature-scoped groups.
 * Only server modules import `AppRpcs` so client lazy route chunks stay isolated.
 */
export const AppRpcs = SearchRpcs.SearchRpcs.merge(ProductRpcs.ProductRpcs, AnalyticsRpcs.AnalyticsRpcs)

/** All server-side stores composed with a single shared `BookmarkStore` instance. */
export const ServerStoresLayer = Layer.mergeAll(
  CatalogStore.CatalogStore.layer.pipe(Layer.provideMerge(BookmarkStore.BookmarkStore.layer)),
  AnalyticsStore.AnalyticsStore.layer
)

/** Live RPC handlers backed by the server stores. */
export const HandlersLayer = AppRpcs.toLayer(
  Effect.gen(function* () {
    const catalog = yield* CatalogStore.CatalogStore
    const bookmarks = yield* BookmarkStore.BookmarkStore
    const analytics = yield* AnalyticsStore.AnalyticsStore

    return {
      searchProducts: ({ q }) => catalog.search(q),
      getProduct: ({ id }) => catalog.find(id),
      bookmarkProduct: ({ id }) =>
        Effect.gen(function* () {
          if (!(yield* catalog.exists(id))) {
            return yield* new ApiError.ApiError({ message: `Product "${id}" not found` })
          }
          yield* bookmarks.bookmark(id)
        }),
      getAnalytics: ({ metric }) => analytics.series(metric)
    }
  })
)

/** HTTP POST `/rpc` route layer using JSON serialization, modeled on `tim-smart/bunnings-lite`. */
export const RpcHttpLayer = RpcServer.layerHttp({
  group: AppRpcs,
  path: "/rpc",
  protocol: "http"
}).pipe(Layer.provide(RpcSerialization.layerJson))

/**
 * Builds an in-process `RpcClient.Protocol` wired directly to `RpcServer.make(AppRpcs)`.
 *
 * When a scoped `RpcClient` closes, its `run` fiber exits and offers its `clientId`
 * to `disconnects` so `RpcServer.make` evicts the `ServerClient` entry immediately
 * (preventing memory leaks across long-lived SSR processes).
 */
export const makeInProcessProtocol = (options?: {
  readonly onDisconnect?: ((clientId: number) => Effect.Effect<void>) | undefined
}) =>
  Effect.gen(function* () {
    const disconnects = yield* Queue.unbounded<number>()
    yield* Effect.addFinalizer(() => Queue.shutdown(disconnects))

    const protocol = yield* RpcClient.Protocol.make((writeToClient, clientIds) =>
      Effect.gen(function* () {
        const writeToServerDeferred =
          yield* Deferred.make<(clientId: number, data: RpcMessage.FromClientEncoded) => Effect.Effect<void>>()
        const serverProtocol = yield* RpcServer.Protocol.make((writeToServer) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(writeToServerDeferred, writeToServer)
            return {
              disconnects,
              send: (clientId, response) => writeToClient(clientId, response),
              end: () => Effect.void,
              clientIds: Effect.succeed(clientIds),
              initialMessage: Effect.succeedNone,
              supportsAck: false,
              supportsTransferables: false,
              supportsSpanPropagation: true,
              supportsNotifications: false,
              codecFor: RpcSerialization.json.codecFor
            }
          })
        )
        const writeToServer = yield* Deferred.await(writeToServerDeferred)
        yield* RpcServer.make(AppRpcs, { onDisconnect: options?.onDisconnect }).pipe(
          Effect.provideService(RpcServer.Protocol, serverProtocol),
          Effect.forkScoped
        )

        return {
          send: (clientId, request) => writeToServer(clientId, request),
          supportsAck: false,
          supportsTransferables: false,
          codecFor: RpcSerialization.json.codecFor
        }
      })
    )

    return RpcClient.Protocol.of({
      ...protocol,
      run: (clientId, f) => protocol.run(clientId, f).pipe(Effect.onExit(() => Queue.offer(disconnects, clientId)))
    })
  })

/**
 * In-process `RpcClient.Protocol` wired directly to `RpcServer.make(AppRpcs)`.
 *
 * Used by SSR and tests: zero TCP sockets, runs the real `AppRpcs` handlers and
 * JSON codecs against the same server store `Layer` instance as `POST /rpc`.
 */
export const InProcessProtocolLayer = Layer.effect(RpcClient.Protocol, makeInProcessProtocol())
