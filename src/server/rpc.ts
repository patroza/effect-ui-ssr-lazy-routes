import { Effect, Layer, type Scope } from "effect"
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse
} from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import * as AnalyticsRpcs from "../analytics/domain/AnalyticsRpcs.ts"
import * as OrderRpcs from "../order/domain/OrderRpcs.ts"
import * as ProductRpcs from "../product/domain/ProductRpcs.ts"
import * as SearchRpcs from "../search/domain/SearchRpcs.ts"
import * as StatusRpcs from "../status/domain/StatusRpcs.ts"
import * as WarehouseRpcs from "../warehouse/domain/WarehouseRpcs.ts"
import * as AnalyticsHandlers from "./handlers/AnalyticsHandlers.ts"
import * as OrderHandlers from "./handlers/OrderHandlers.ts"
import * as ProductHandlers from "./handlers/ProductHandlers.ts"
import * as SearchHandlers from "./handlers/SearchHandlers.ts"
import * as StatusHandlers from "./handlers/StatusHandlers.ts"
import * as WarehouseHandlers from "./handlers/WarehouseHandlers.ts"
import * as RpcInstrumentation from "./rpcInstrumentation.ts"
import * as AnalyticsStore from "./services/AnalyticsStore.ts"
import * as BookmarkStore from "./services/BookmarkStore.ts"
import * as CatalogStore from "./services/CatalogStore.ts"
import * as OrderStore from "./services/OrderStore.ts"
import * as StatusStore from "./services/StatusStore.ts"
import * as WarehouseStore from "./services/WarehouseStore.ts"

/** All server-side stores composed with a single shared `BookmarkStore` instance. */
export const ServerStoresLayer = Layer.mergeAll(
  CatalogStore.CatalogStore.layer.pipe(Layer.provideMerge(BookmarkStore.BookmarkStore.layer)),
  AnalyticsStore.AnalyticsStore.layer,
  StatusStore.StatusStore.layer,
  OrderStore.OrderStore.layer,
  WarehouseStore.WarehouseStore.layer
)

/** Live RPC handlers composed from each feature `RpcGroup`'s own independent handler layer. */
export const HandlersLayer = Layer.mergeAll(
  SearchHandlers.SearchHandlersLayer,
  ProductHandlers.ProductHandlersLayer,
  AnalyticsHandlers.AnalyticsHandlersLayer,
  StatusHandlers.StatusHandlersLayer,
  OrderHandlers.OrderHandlersLayer,
  WarehouseHandlers.WarehouseHandlersLayer
)

/** Feature-scoped HTTP RPC paths mounted independently on `HttpRouter`. */
export const RPC_PATHS = [
  "/rpc/search",
  "/rpc/product",
  "/rpc/analytics",
  "/rpc/status",
  "/rpc/order",
  "/rpc/warehouse"
] as const

/** Composed HTTP POST `/rpc/{search,product,analytics,status,order,warehouse}` route layer using JSON serialization. */
export const RpcHttpLayer = Layer.mergeAll(
  RpcServer.layerHttp({
    group: SearchRpcs.SearchRpcs.middleware(RpcInstrumentation.RpcInstrumentation),
    path: RPC_PATHS[0],
    protocol: "http"
  }),
  RpcServer.layerHttp({
    group: ProductRpcs.ProductRpcs.middleware(RpcInstrumentation.RpcInstrumentation),
    path: RPC_PATHS[1],
    protocol: "http"
  }),
  RpcServer.layerHttp({
    group: AnalyticsRpcs.AnalyticsRpcs.middleware(RpcInstrumentation.RpcInstrumentation),
    path: RPC_PATHS[2],
    protocol: "http"
  }),
  RpcServer.layerHttp({
    group: StatusRpcs.StatusRpcs.middleware(RpcInstrumentation.RpcInstrumentation),
    path: RPC_PATHS[3],
    protocol: "http"
  }),
  RpcServer.layerHttp({
    group: OrderRpcs.OrderRpcs.middleware(RpcInstrumentation.RpcInstrumentation),
    path: RPC_PATHS[4],
    protocol: "http"
  }),
  RpcServer.layerHttp({
    group: WarehouseRpcs.WarehouseRpcs.middleware(RpcInstrumentation.RpcInstrumentation),
    path: RPC_PATHS[5],
    protocol: "http"
  })
).pipe(Layer.provide(RpcInstrumentation.RpcInstrumentation.layer), Layer.provide(RpcSerialization.layerJson))

/**
 * Builds an in-process `HttpClient` that dispatches requests directly to the
 * composed RPC `HttpRouter` effect with zero TCP sockets, preserving the
 * caller's Effect runtime (including `TestClock` in tests) and sharing live
 * server stores.
 */
export const makeInProcessHttpClient = <E>(
  rpcEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, HttpServerRequest.HttpServerRequest | Scope.Scope>
): HttpClient.HttpClient => {
  const inner = HttpClient.make((request) =>
    Effect.gen(function* () {
      const serverResponse = yield* rpcEffect.pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromClientRequest(request)),
        Effect.scoped
      )
      return HttpClientResponse.fromWeb(request, HttpServerResponse.toWeb(serverResponse))
    }).pipe(
      Effect.mapError(
        (cause) =>
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, cause })
          })
      )
    )
  )

  return HttpClient.makeWith<HttpClientError.HttpClientError, never, HttpClientError.HttpClientError, never>(
    (requestEffect) =>
      Effect.flatMap(requestEffect, (request) =>
        inner.execute(
          request.url.startsWith("/") ? HttpClientRequest.setUrl(request, `http://localhost${request.url}`) : request
        )
      ),
    Effect.succeed
  )
}

/**
 * In-process `HttpClient` + `RpcSerialization` layer wired directly to
 * `RpcHttpLayer` and the provided feature RPC handler layers.
 */
export const InProcessRpcClientLayer = Layer.mergeAll(
  Layer.effect(
    HttpClient.HttpClient,
    HttpRouter.toHttpEffect(RpcHttpLayer).pipe(
      Effect.provideService(HttpRouter.RouterConfig, { ignoreTrailingSlash: true }),
      Effect.map(makeInProcessHttpClient)
    )
  ),
  RpcSerialization.layerJson
)
