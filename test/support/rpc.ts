import { Context, Effect, Layer, Option, Ref, Schema } from "effect"
import { HttpClient, type HttpClientError, type HttpClientRequest, HttpRouter, HttpServerRequest } from "effect/http"
import { RpcSerialization } from "effect/rpc"
import type * as ApiError from "../../src/rpc/domain/ApiError.ts"
import * as ProductRpcs from "../../src/product/domain/ProductRpcs.ts"
import * as Rpc from "../../src/server/rpc.ts"
import * as CatalogStore from "../../src/server/services/CatalogStore.ts"

/** How many times each RPC operation ran. */
export interface RpcCounts {
  readonly searchProducts: number
  readonly getProduct: number
  readonly bookmarkProduct: number
  readonly getAnalytics: number
  readonly getStatus: number
  readonly checkOrderCode: number
  readonly validatePromoCode: number
  readonly submitOrder: number
  readonly getWarehouseCarts: number
  readonly unblockCart: number
  readonly blockCart: number
  readonly preflightReleaseCart: number
  readonly releaseCart: number
  readonly preflightDispatchCart: number
  readonly dispatchCartStep: number
  readonly refreshSession: number
}

export const noCalls: RpcCounts = {
  searchProducts: 0,
  getProduct: 0,
  bookmarkProduct: 0,
  getAnalytics: 0,
  getStatus: 0,
  checkOrderCode: 0,
  validatePromoCode: 0,
  submitOrder: 0,
  getWarehouseCarts: 0,
  unblockCart: 0,
  blockCart: 0,
  preflightReleaseCart: 0,
  releaseCart: 0,
  preflightDispatchCart: 0,
  dispatchCartStep: 0,
  refreshSession: 0
}

const OperationTag = Schema.Literals([
  "searchProducts",
  "getProduct",
  "bookmarkProduct",
  "getAnalytics",
  "getStatus",
  "checkOrderCode",
  "validatePromoCode",
  "submitOrder",
  "getWarehouseCarts",
  "unblockCart",
  "blockCart",
  "preflightReleaseCart",
  "releaseCart",
  "preflightDispatchCart",
  "dispatchCartStep",
  "refreshSession"
])

const RpcWireRequest = Schema.TaggedStruct("Request", {
  tag: OperationTag
})
const isRpcWireRequest = Schema.is(RpcWireRequest)
const decodeRpcWirePayload = Schema.decodeUnknownOption(Schema.Union([RpcWireRequest, Schema.Array(RpcWireRequest)]))

/**
 * Where the counting RPC protocol writes. A `Ref` per test, built with the
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

const makeHandlersLayer = (overrides?: {
  readonly bookmarkProduct?: (id: string) => Effect.Effect<void, ApiError.ApiError>
}) => {
  if (overrides?.bookmarkProduct === undefined) {
    return Rpc.HandlersLayer
  }
  const bookmarkProduct = overrides.bookmarkProduct
  return Layer.mergeAll(
    Rpc.HandlersLayer,
    ProductRpcs.ProductRpcs.toLayer(
      Effect.gen(function* () {
        const catalog = yield* CatalogStore.CatalogStore
        return {
          getProduct: ({ id }) => catalog.find(id),
          bookmarkProduct: ({ id }) => bookmarkProduct(id)
        }
      })
    )
  )
}

/**
 * In-process `HttpClient` + `RpcSerialization` wired directly to the real
 * `Rpc.HandlersLayer` and `Rpc.RpcHttpLayer` routes with a deterministic 5 ms
 * `TestClock` round-trip and per-test `Ref` call counters. Zero TCP sockets.
 *
 * `failRequest` optionally intercepts outgoing HTTP RPC requests to inject a
 * real `HttpClientError` (wrapped by `RpcClient` into `RpcClientError`).
 */
export const makeCountingRpcProtocol = (overrides?: {
  readonly bookmarkProduct?: (id: string) => Effect.Effect<void, ApiError.ApiError>
  readonly failRequest?: (request: HttpClientRequest.HttpClientRequest) => HttpClientError.HttpClientError | undefined
}) =>
  Layer.fresh(
    Layer.mergeAll(
      Layer.effect(
        HttpClient.HttpClient,
        Effect.gen(function* () {
          const calls = yield* RpcCalls
          const rpcEffect = yield* HttpRouter.toHttpEffect(Rpc.RpcHttpLayer).pipe(
            Effect.provideService(HttpRouter.RouterConfig, { ignoreTrailingSlash: true })
          )
          const countingRpcEffect = Effect.gen(function* () {
            const req = yield* HttpServerRequest.HttpServerRequest
            const jsonOption = yield* Effect.option(req.json)
            if (Option.isSome(jsonOption)) {
              const parsed = decodeRpcWirePayload(jsonOption.value)
              if (Option.isSome(parsed)) {
                const items = isRpcWireRequest(parsed.value) ? [parsed.value] : parsed.value
                yield* Effect.forEach(items, (item) => calls.record(item.tag), { discard: true })
              }
            }
            yield* roundTripDelay
            return yield* rpcEffect
          })
          const base = Rpc.makeInProcessHttpClient(countingRpcEffect)
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
      ),
      RpcSerialization.layerJson
    ).pipe(
      Layer.provide(makeHandlersLayer(overrides).pipe(Layer.provide(Rpc.ServerStoresLayer))),
      Layer.provideMerge(makeRpcCalls)
    )
  )

export const countingRpcProtocol = makeCountingRpcProtocol()
