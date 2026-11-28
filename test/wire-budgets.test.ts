import { HtmlServer } from "@effect/ui/html"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option, Random, Schema } from "effect"
import { type RpcMessage, RpcSerialization } from "effect/rpc"
import * as Analytics from "../src/analytics/domain/Analytics.ts"
import * as Order from "../src/order/domain/Order.ts"
import * as Product from "../src/product/domain/Product.ts"
import * as ApiError from "../src/rpc/domain/ApiError.ts"
import * as Status from "../src/status/domain/Status.ts"
import * as Warehouse from "../src/warehouse/domain/Warehouse.ts"
import * as Helpers from "./helpers.ts"
import * as DeterministicRuntime from "./support/deterministicRuntime.ts"

const textEncoder = new TextEncoder()
const wireParser = RpcSerialization.json.makeUnsafe()

const encodeWireBytes = (envelope: RpcMessage.FromClientEncoded | RpcMessage.FromServerEncoded): number => {
  const encoded = wireParser.encode(envelope)
  if (typeof encoded === "string") return textEncoder.encode(encoded).byteLength
  if (encoded instanceof Uint8Array) return encoded.byteLength
  return 0
}

const utf8ByteLength = (text: string): number => textEncoder.encode(text).byteLength

const encodeProductOption = Schema.encodeEffect(RpcSerialization.json.codecFor(Schema.Option(Product.Product)))
const encodeSearchProducts = Schema.encodeEffect(RpcSerialization.json.codecFor(Schema.Array(Product.Product)))
const encodeApiError = Schema.encodeEffect(RpcSerialization.json.codecFor(ApiError.ApiError))
const encodeAnalyticsSeries = Schema.encodeEffect(RpcSerialization.json.codecFor(Schema.Array(Analytics.SeriesPoint)))
const encodeSystemStatus = Schema.encodeEffect(RpcSerialization.json.codecFor(Status.SystemStatus))
const encodeOrderSubmission = Schema.encodeEffect(RpcSerialization.json.codecFor(Order.OrderSubmission))
const encodeOrderReceipt = Schema.encodeEffect(RpcSerialization.json.codecFor(Order.OrderReceipt))
const encodeWarehouseCarts = Schema.encodeEffect(RpcSerialization.json.codecFor(Schema.Array(Warehouse.WarehouseCart)))
const encodeWarehouseFailure = Schema.encodeEffect(RpcSerialization.json.codecFor(Warehouse.WarehouseCommandFailure))

const sampleProduct: Product.Product = {
  id: "42",
  name: "Field notebook",
  priceCents: 1200,
  blurb: "Dot-grid pocket notebook",
  bookmarked: false
}

const sampleSeries: ReadonlyArray<Analytics.SeriesPoint> = Array.from({ length: 12 }, (_, index) => ({
  label: `M${index + 1}`,
  value: 1000 + index * 250
}))

const sampleStatus: Status.SystemStatus = {
  revision: 1,
  mode: "ok",
  note: "All edge nodes healthy",
  services: [
    { name: "catalog", healthy: true, latencyMs: 12 },
    { name: "orders", healthy: true, latencyMs: 18 },
    { name: "warehouse", healthy: true, latencyMs: 9 }
  ]
}

const sampleOrderSubmission: Order.OrderSubmission = {
  projectCode: "studio-mug-01",
  contactEmail: "buyer@studio.test",
  promoCode: "STUDIO15",
  billing: { _tag: "Card", cardholderName: "Ada Lovelace", billingZip: "94107" },
  items: [{ id: "line-1", sku: "MUG-01", quantity: 2, unitPriceDollars: 24 }],
  expedited: false,
  deliveryNote: "",
  acceptTerms: true
}

const sampleWarehouseCarts: ReadonlyArray<Warehouse.WarehouseCart> = [
  {
    id: "cart-101",
    code: "CART-101",
    station: null,
    status: "Free",
    pickCount: 6,
    valueCents: 14_200,
    warningCount: 0,
    blockReason: null,
    blockNote: null,
    lastBatchId: null
  },
  {
    id: "cart-204",
    code: "CART-204",
    station: "Packstation B",
    status: "InUse",
    pickCount: 3,
    valueCents: 8_900,
    warningCount: 1,
    blockReason: null,
    blockNote: null,
    lastBatchId: null
  }
]

describe("RPC encoded wire-byte budgets & SSR #state payload budgets", () => {
  it.effect(
    "keeps encoded RPC request & exit envelopes deterministic and within byte ceilings across all 6 groups",
    () =>
      Effect.gen(function* () {
        const sampleTraceToken = yield* Random.nextIntBetween(1000, 9999)
        const requestId = `req-${sampleTraceToken}`

        const searchReqBytes = encodeWireBytes({
          _tag: "Request",
          id: requestId,
          tag: "searchProducts",
          payload: { q: "mug" },
          headers: []
        })
        const searchExitBytes = encodeWireBytes({
          _tag: "Exit",
          requestId,
          exit: { _tag: "Success", value: yield* encodeSearchProducts([sampleProduct]) }
        })

        const productReqBytes = encodeWireBytes({
          _tag: "Request",
          id: requestId,
          tag: "getProduct",
          payload: { id: "42" },
          headers: []
        })
        const productExitBytes = encodeWireBytes({
          _tag: "Exit",
          requestId,
          exit: { _tag: "Success", value: yield* encodeProductOption(Option.some(sampleProduct)) }
        })
        const productErrExitBytes = encodeWireBytes({
          _tag: "Exit",
          requestId,
          exit: {
            _tag: "Failure",
            cause: [
              { _tag: "Fail", error: yield* encodeApiError(new ApiError.ApiError({ message: "Product missing" })) }
            ]
          }
        })

        const analyticsReqBytes = encodeWireBytes({
          _tag: "Request",
          id: requestId,
          tag: "getAnalytics",
          payload: { metric: "revenue" },
          headers: []
        })
        const analyticsExitBytes = encodeWireBytes({
          _tag: "Exit",
          requestId,
          exit: { _tag: "Success", value: yield* encodeAnalyticsSeries(sampleSeries) }
        })

        const statusReqBytes = encodeWireBytes({
          _tag: "Request",
          id: requestId,
          tag: "getStatus",
          payload: { mode: "ok" },
          headers: []
        })
        const statusExitBytes = encodeWireBytes({
          _tag: "Exit",
          requestId,
          exit: { _tag: "Success", value: yield* encodeSystemStatus(sampleStatus) }
        })

        const orderReqBytes = encodeWireBytes({
          _tag: "Request",
          id: requestId,
          tag: "submitOrder",
          payload: { order: yield* encodeOrderSubmission(sampleOrderSubmission) },
          headers: []
        })
        const orderExitBytes = encodeWireBytes({
          _tag: "Exit",
          requestId,
          exit: {
            _tag: "Success",
            value: yield* encodeOrderReceipt({
              orderId: "ORD-0001",
              projectCode: "studio-mug-01",
              totalCents: 4080,
              discountPercent: 15
            })
          }
        })

        const warehouseReqBytes = encodeWireBytes({
          _tag: "Request",
          id: requestId,
          tag: "getWarehouseCarts",
          payload: undefined,
          headers: []
        })
        const warehouseExitBytes = encodeWireBytes({
          _tag: "Exit",
          requestId,
          exit: { _tag: "Success", value: yield* encodeWarehouseCarts(sampleWarehouseCarts) }
        })
        const warehouseFailureBytes = encodeWireBytes({
          _tag: "Exit",
          requestId,
          exit: {
            _tag: "Failure",
            cause: [
              {
                _tag: "Fail",
                error: yield* encodeWarehouseFailure(
                  new Warehouse.WarehouseCommandFailure({
                    error: new Warehouse.WarehouseTransportError({ reason: "unavailable" }),
                    failureSpan: null
                  })
                )
              }
            ]
          }
        })

        const measurements = {
          searchReqBytes,
          searchExitBytes,
          productReqBytes,
          productExitBytes,
          productErrExitBytes,
          analyticsReqBytes,
          analyticsExitBytes,
          statusReqBytes,
          statusExitBytes,
          orderReqBytes,
          orderExitBytes,
          warehouseReqBytes,
          warehouseExitBytes,
          warehouseFailureBytes
        }

        expect(searchReqBytes).toBeGreaterThan(0)
        expect(searchReqBytes).toBeLessThanOrEqual(256)
        expect(searchExitBytes).toBeLessThanOrEqual(512)
        expect(productReqBytes).toBeLessThanOrEqual(256)
        expect(productExitBytes).toBeLessThanOrEqual(512)
        expect(productErrExitBytes).toBeLessThanOrEqual(512)
        expect(analyticsReqBytes).toBeLessThanOrEqual(256)
        expect(analyticsExitBytes).toBeLessThanOrEqual(1024)
        expect(statusReqBytes).toBeLessThanOrEqual(256)
        expect(statusExitBytes).toBeLessThanOrEqual(512)
        expect(orderReqBytes).toBeLessThanOrEqual(1024)
        expect(orderExitBytes).toBeLessThanOrEqual(512)
        expect(warehouseReqBytes).toBeLessThanOrEqual(256)
        expect(warehouseExitBytes).toBeLessThanOrEqual(1024)
        expect(warehouseFailureBytes).toBeLessThanOrEqual(512)
        expect(measurements.orderReqBytes).toBeGreaterThan(measurements.warehouseReqBytes)
      }).pipe(DeterministicRuntime.deterministicRandom(), Effect.provide(DeterministicRuntime.deterministicClockLayer))
  )

  const ssrStateCases = [
    { url: "/", maxBytes: 2048 },
    { url: "/products?q=mug", maxBytes: 4096 },
    { url: "/products/42", maxBytes: 4096 },
    { url: "/analytics", maxBytes: 4096 },
    { url: "/status", maxBytes: 4096 },
    { url: "/order", maxBytes: 16384 },
    { url: "/warehouse", maxBytes: 8192 }
  ] as const

  it.live.each(ssrStateCases)(
    "keeps SSR #state for $url deterministic and within $maxBytes bytes",
    ({ url, maxBytes }) => {
      const renderCold = () =>
        Helpers.serverRender(url).pipe(
          DeterministicRuntime.deterministicRandom(),
          Effect.provide(
            Layer.fresh(Helpers.browserEnv).pipe(
              Layer.provideMerge(Layer.fresh(DeterministicRuntime.deterministicClockLayer))
            )
          )
        )
      return Effect.gen(function* () {
        const first = yield* renderCold()
        const second = yield* renderCold()

        const firstSerialized = HtmlServer.serializeState(first.state)
        const secondSerialized = HtmlServer.serializeState(second.state)
        const byteSize = utf8ByteLength(firstSerialized)

        expect(byteSize).toBeGreaterThan(2)
        expect(firstSerialized).toBe(secondSerialized)
        expect(byteSize).toBeLessThanOrEqual(maxBytes)
      })
    }
  )
})
