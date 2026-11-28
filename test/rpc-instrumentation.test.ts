// @vitest-environment node
import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Layer, Metric, Tracer } from "effect"
import { RpcClient } from "effect/rpc"
import * as AnalyticsRpcs from "../src/analytics/domain/AnalyticsRpcs.ts"
import * as OrderRpcs from "../src/order/domain/OrderRpcs.ts"
import * as ProductRpcs from "../src/product/domain/ProductRpcs.ts"
import * as SearchRpcs from "../src/search/domain/SearchRpcs.ts"
import * as Rpc from "../src/server/rpc.ts"
import * as RpcInstrumentation from "../src/server/rpcInstrumentation.ts"
import * as StatusRpcs from "../src/status/domain/StatusRpcs.ts"
import * as WarehouseRpcs from "../src/warehouse/domain/WarehouseRpcs.ts"

const allDefinedRpcTags = (): ReadonlyArray<string> => [
  ...SearchRpcs.SearchRpcs.requests.keys(),
  ...ProductRpcs.ProductRpcs.requests.keys(),
  ...AnalyticsRpcs.AnalyticsRpcs.requests.keys(),
  ...StatusRpcs.StatusRpcs.requests.keys(),
  ...OrderRpcs.OrderRpcs.requests.keys(),
  ...WarehouseRpcs.WarehouseRpcs.requests.keys()
]

describe("RpcInstrumentation middleware", () => {
  it("maps every method across all 6 feature RpcGroups exhaustively", () => {
    const methodKeys = Object.keys(RpcInstrumentation.SAMPLE_RPC_GROUP_BY_METHOD).sort()
    expect(methodKeys).toEqual([...allDefinedRpcTags()].sort())
    expect(methodKeys).toHaveLength(16)
  })

  it.effect("records rpc.<method> server spans and exit metrics across success and failure outcomes", () =>
    Effect.gen(function* () {
      const spans: Array<Tracer.NativeSpan> = []
      const recordingTracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options)
          spans.push(span)
          return span
        }
      })

      const searchMatches = yield* Effect.gen(function* () {
        const client = yield* RpcClient.make(SearchRpcs.SearchRpcs)
        return yield* client.searchProducts({ q: "mug" })
      }).pipe(
        Effect.scoped,
        Effect.provide(RpcClient.layerProtocolHttp({ url: "/rpc/search" })),
        Effect.withTracer(recordingTracer)
      )
      expect(searchMatches).toHaveLength(1)

      const bookmarkExit = yield* Effect.gen(function* () {
        const client = yield* RpcClient.make(ProductRpcs.ProductRpcs)
        return yield* client.bookmarkProduct({ id: "non-existent-id" })
      }).pipe(
        Effect.scoped,
        Effect.provide(RpcClient.layerProtocolHttp({ url: "/rpc/product" })),
        Effect.withTracer(recordingTracer),
        Effect.exit
      )
      expect(Exit.isFailure(bookmarkExit)).toBe(true)

      const searchSpan = spans.find(
        (span) =>
          span.name === "rpc.searchProducts" &&
          span.kind === "server" &&
          span.attributes.get("rpc.system") === "effect-rpc"
      )
      expect(searchSpan?.status._tag).toBe("Ended")
      expect(searchSpan?.attributes.get("rpc.transport")).toBe("http")
      expect(searchSpan?.attributes.get("rpc.method")).toBe("searchProducts")
      expect(searchSpan?.attributes.get("rpc.group")).toBe("search")

      const bookmarkSpan = spans.find(
        (span) =>
          span.name === "rpc.bookmarkProduct" &&
          span.kind === "server" &&
          span.attributes.get("rpc.system") === "effect-rpc"
      )
      expect(bookmarkSpan?.status._tag).toBe("Ended")
      expect(bookmarkSpan?.attributes.get("rpc.transport")).toBe("http")
      expect(bookmarkSpan?.attributes.get("rpc.method")).toBe("bookmarkProduct")
      expect(bookmarkSpan?.attributes.get("rpc.group")).toBe("product")

      const successCount = yield* Metric.value(
        Metric.withAttributes(RpcInstrumentation.sampleRpcRequestsTotal, {
          rpc_method: "searchProducts",
          rpc_group: "search",
          outcome: "success"
        })
      )
      const failureCount = yield* Metric.value(
        Metric.withAttributes(RpcInstrumentation.sampleRpcRequestsTotal, {
          rpc_method: "bookmarkProduct",
          rpc_group: "product",
          outcome: "failure"
        })
      )
      const successDuration = yield* Metric.value(
        Metric.withAttributes(RpcInstrumentation.sampleRpcRequestDuration, {
          rpc_method: "searchProducts",
          rpc_group: "search",
          outcome: "success"
        })
      )

      expect(successCount.count).toBe(1)
      expect(failureCount.count).toBe(1)
      expect(successDuration.count).toBe(1)
    }).pipe(
      Effect.provideService(Metric.MetricRegistry, new Map()),
      Effect.provide(
        Rpc.InProcessRpcClientLayer.pipe(
          Layer.provide(Rpc.HandlersLayer.pipe(Layer.provide(Layer.fresh(Rpc.ServerStoresLayer))))
        )
      )
    )
  )
})
