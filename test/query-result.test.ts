import { TestHost } from "@effect/ui/testing"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { HttpClientError } from "effect/http"
import { TestClock } from "effect/testing"
import * as Helpers from "./helpers.ts"
import * as TestRpc from "./support/rpc.ts"

const roundTrip = Effect.andThen(TestClock.adjust("5 millis"), TestHost.settle)

describe("QueryResult boundary & /status demo", () => {
  it.layer(Helpers.browserEnv, { buildPerTest: true })("SSR + hydration + manual refresh", (it) => {
    it.effect("/status SSR injects ~query with zero Initial flash and manual Refresh refetches", () =>
      Effect.gen(function* () {
        const server = yield* Helpers.serverRender("/status")
        expect(server.status).toBe(200)
        expect(server.appHtml).toContain("Revision 1")
        expect(server.appHtml).not.toContain('data-testid="status-loading"')

        const browser = yield* Helpers.hydrateCapturing("/status", (container) => ({
          section: container.querySelector("section"),
          revision: container.querySelector('[data-testid="status-revision"]'),
          refresh: container.querySelector('[data-testid="refresh-button"]')
        }))
        expect(browser.fallbacksSeen()).toEqual([])
        expect(browser.container.querySelector('[data-testid="status-loading"]')).toBeNull()
        expect(browser.container.querySelector('[data-testid="status-revision"]')).toBe(browser.before.revision)
        expect(browser.container.querySelector('[data-testid="refresh-button"]')).toBe(browser.before.refresh)
        expect((yield* Helpers.portCounts).getStatus).toBe(0)

        Helpers.click(Helpers.byTestId(browser.container, "refresh-button"))
        yield* Helpers.settleFrames
        yield* roundTrip
        expect((yield* Helpers.portCounts).getStatus).toBe(1)
        expect(Helpers.text(browser.container, '[data-testid="status-revision"]')).toBe("Revision 1")
      })
    )

    it.effect("/status?mode=fail-ssr returns HTTP 503 on SSR and hydrates directly into ErrorPanel", () =>
      Effect.gen(function* () {
        const server = yield* Helpers.serverRender("/status?mode=fail-ssr")
        expect(server.status).toBe(503)
        expect(server.appHtml).toContain("System Status")
        expect(server.appHtml).toContain('data-testid="query-error"')
        expect(server.appHtml).toContain("Status backend unavailable during SSR")
        expect(server.appHtml).not.toContain('data-testid="status-loading"')

        const browser = yield* Helpers.hydrateCapturing("/status?mode=fail-ssr", (container) =>
          container.querySelector('[data-testid="query-error"]')
        )
        expect(browser.before).not.toBeNull()
        expect(browser.fallbacksSeen()).toEqual([])
        expect(browser.container.querySelector('[data-testid="status-loading"]')).toBeNull()
        expect(browser.container.querySelector("h1")?.textContent).toBe("System Status")
        expect(browser.container.querySelector('[data-testid="query-error"] h2')?.textContent).toBe(
          "Couldn't load system status"
        )
        expect(browser.container.querySelector('[data-testid="query-error"]')).toBe(browser.before)
        expect(Helpers.text(browser.container, '[data-testid="query-error-message"]')).toBe(
          "Status backend unavailable during SSR"
        )
        yield* Helpers.runOutTheClock
        expect((yield* Helpers.portCounts).getStatus).toBe(0)
      })
    )

    it.effect("Analytics manual Refresh button invalidates and refetches", () =>
      Effect.gen(function* () {
        const analytics = yield* Helpers.hydrateFromServer("/analytics")
        expect((yield* Helpers.portCounts).getAnalytics).toBe(0)
        Helpers.click(Helpers.byTestId(analytics.container, "analytics-refresh"))
        yield* Helpers.settleFrames
        yield* roundTrip
        expect((yield* Helpers.portCounts).getAnalytics).toBe(1)
      })
    )

    it.effect("Products manual Refresh button invalidates and refetches", () =>
      Effect.gen(function* () {
        const products = yield* Helpers.hydrateFromServer("/products?q=mug")
        expect((yield* Helpers.portCounts).searchProducts).toBe(0)
        Helpers.click(Helpers.byTestId(products.container, "products-refresh"))
        yield* Helpers.settleFrames
        yield* roundTrip
        expect((yield* Helpers.portCounts).searchProducts).toBe(1)
      })
    )

    it.effect("ProductDetail manual Refresh button invalidates and refetches", () =>
      Effect.gen(function* () {
        const detail = yield* Helpers.hydrateFromServer("/products/42")
        expect((yield* Helpers.portCounts).getProduct).toBe(0)
        Helpers.click(Helpers.byTestId(detail.container, "detail-refresh"))
        yield* Helpers.settleFrames
        yield* roundTrip
        expect((yield* Helpers.portCounts).getProduct).toBe(1)
      })
    )

    it.effect("cold client navigation to /status?mode=fail-ssr shows ErrorPanel without crashing", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/")
        yield* Helpers.follow(browser, "/status")
        yield* Helpers.follow(browser, "/status?mode=fail-ssr")
        expect(Helpers.text(browser.container, '[data-testid="query-error-message"]')).toBe(
          "Status backend unavailable during SSR"
        )
        expect(browser.container.querySelector('[data-testid="status-services"]')).toBeNull()
      })
    )
  })

  it.effect(
    "/status?mode=fail-refresh succeeds on SSR, keeps SSR data on client refresh ApiError, and recovers on retry",
    () =>
      Effect.gen(function* () {
        const { result } = yield* Helpers.ssrAt("/status?mode=fail-refresh")
        expect(result.html).toContain("Revision 1")
        expect(result.html).not.toContain('data-testid="refresh-error"')
        expect(result.root.frames()).toEqual(["page"])
        expect(result.root.fetches()).toEqual([])

        // Attempt 2 fails with ApiError in StatusStore: SSR data stays rendered + inline refresh-error banner appears.
        Helpers.click(Helpers.byTestId(result.container, "refresh-button"))
        yield* Helpers.settleFrames
        yield* roundTrip
        expect(Helpers.text(result.container, '[data-testid="status-revision"]')).toBe("Revision 1")
        expect(result.container.querySelectorAll('[data-testid="status-services"] li')).toHaveLength(3)
        expect(Helpers.text(result.container, '[data-testid="refresh-error-message"]')).toContain(
          "Client refresh failed: upstream status timeout"
        )
        expect(result.container.querySelector('[data-testid="query-error"]')).toBeNull()

        // Attempt 3 succeeds: recovers to Revision 2 and removes the refresh-error banner.
        Helpers.click(Helpers.byTestId(result.container, "refresh-error-retry"))
        yield* Helpers.settleFrames
        yield* roundTrip
        expect(Helpers.text(result.container, '[data-testid="status-revision"]')).toBe("Revision 2")
        expect(result.container.querySelector('[data-testid="refresh-error"]')).toBeNull()
      }).pipe(Effect.provide(Helpers.appAt("/status?mode=fail-refresh")))
  )

  it.effect("Analytics preserves the hydrated SSR chart when a client refresh hits a transport error", () => {
    let attempts = 0
    return Effect.gen(function* () {
      const browser = yield* Helpers.hydrateCapturing("/analytics", (container) =>
        container.querySelector('[data-testid="analytics-chart"]')
      )
      expect(browser.before).not.toBeNull()

      Helpers.click(Helpers.byTestId(browser.container, "analytics-refresh"))
      yield* Helpers.settleFrames
      yield* roundTrip
      expect(browser.container.querySelector('[data-testid="analytics-chart"]')).toBe(browser.before)
      expect(Helpers.text(browser.container, '[data-testid="analytics-total"]')).toBe("Total Revenue (USD): 237500")
      expect(browser.container.querySelector('[data-testid="refresh-error"]')).not.toBeNull()
      expect(browser.container.querySelector('[data-testid="query-error"]')).toBeNull()

      Helpers.click(Helpers.byTestId(browser.container, "refresh-error-retry"))
      yield* Helpers.settleFrames
      yield* roundTrip
      expect(browser.container.querySelector('[data-testid="refresh-error"]')).toBeNull()
      expect(attempts).toBe(2)
    }).pipe(
      Effect.provide(
        TestHost.layer().pipe(
          Layer.provideMerge(
            TestRpc.makeCountingRpcProtocol({
              failRequest: (request) => {
                if (request.url.includes("/rpc/analytics")) {
                  attempts++
                  if (attempts === 1) {
                    return new HttpClientError.HttpClientError({
                      reason: new HttpClientError.TransportError({
                        request,
                        cause: new Error("socket reset")
                      })
                    })
                  }
                }
                return undefined
              }
            })
          )
        )
      )
    )
  })
})
