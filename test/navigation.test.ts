import { TestHost } from "@effect/ui/testing"
import { describe, expect, it, vi } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import * as Helpers from "./helpers.ts"

describe("client-side navigation to a route that was not preloaded", () => {
  it.layer(Helpers.browserEnv, { buildPerTest: true })("on the browser", (it) => {
    it.effect("loads the page's chunk lazily on navigation, and keeps the surrounding DOM", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateCapturing("/", (container) => container.querySelector("header"))
        expect(browser.side.loaded).toEqual(["Home"])

        yield* Helpers.follow(browser, "/analytics")
        expect(browser.container.querySelector('[data-page-chunk="SENTINEL:analytics-page"]')).not.toBeNull()

        expect([...browser.side.loaded].sort()).toEqual(["Analytics", "Home"]) // only the visited page was imported
        expect(window.location.pathname).toBe("/analytics")
        expect(browser.container.querySelector("header")).toBe(browser.before) // the shell was not rebuilt
        expect(browser.container.querySelector('[data-page-chunk="SENTINEL:home-page"]')).toBeNull()
      })
    )

    it.effect("does not remount the page on state or search updates (and debounces the search on the clock)", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/")
        yield* Helpers.follow(browser, "/products")
        expect(browser.side.loaded).toContain("Products")
        expect(browser.container.querySelectorAll("li")).toHaveLength(6)

        const section = browser.container.querySelector("section")
        const input = browser.container.querySelector("input[type=search]")
        if (section === null || !(input instanceof HTMLInputElement)) throw new Error("products page not rendered")

        // 1. A Model update (compare product "1") keeps the very same nodes.
        const compare = browser.container.querySelector("li button")
        if (compare === null) throw new Error("no compare button")
        Helpers.click(compare)
        yield* TestHost.settle
        expect(Helpers.text(browser.container, '[data-testid="products-compared"]')).toBe("Comparing 1 product(s)")
        expect(browser.container.querySelector("section")).toBe(section)

        // 2. A search update (`?q=mug`) changes the props (and so the query's args), not the instance. The URL is
        // written at once; the query waits for typing to pause for 300 ms, on the TestClock.
        const before = yield* Helpers.portCounts
        Helpers.type(input, "mug")
        yield* TestHost.settle
        expect(window.location.search).toBe("?q=mug")
        yield* TestClock.adjust("299 millis")
        yield* TestHost.settle
        expect((yield* Helpers.portCounts).searchProducts).toBe(before.searchProducts) // still debouncing
        expect(browser.container.querySelectorAll("li")).toHaveLength(6) // the last results stay up

        yield* TestClock.adjust("1 millis") // the pause is 300 ms: the fetch starts, and sleeps for its round trip
        yield* TestHost.settle
        expect((yield* Helpers.portCounts).searchProducts).toBe(before.searchProducts + 1)
        expect(browser.container.querySelectorAll("li")).toHaveLength(6)

        yield* TestClock.adjust("5 millis")
        yield* TestHost.settle
        expect(browser.container.querySelectorAll("li")).toHaveLength(1)

        expect(browser.container.querySelector("section")).toBe(section)
        expect(browser.container.querySelector("input[type=search]")).toBe(input)
        // The Model survived the search update; a remount would have reset it to 0.
        expect(Helpers.text(browser.container, '[data-testid="products-compared"]')).toBe("Comparing 1 product(s)")
      })
    )

    it.effect("fetches once for a burst of keystrokes: each one restarts the 300 ms debounce", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/products")
        const input = Helpers.byTestId(browser.container, "products-search")
        const before = yield* Helpers.portCounts

        for (const text of ["m", "mu", "mug"]) {
          Helpers.type(input, text)
          yield* TestHost.settle
          yield* TestClock.adjust("200 millis") // never a pause of 300 ms
          yield* TestHost.settle
        }
        expect((yield* Helpers.portCounts).searchProducts).toBe(before.searchProducts)

        yield* TestClock.adjust("100 millis") // typing stopped for 300 ms in all: it fetches, once, for the last text
        yield* TestHost.settle
        yield* TestClock.adjust("10 seconds") // the round trip completes, and nothing late fires after it
        yield* TestHost.settle
        expect((yield* Helpers.portCounts).searchProducts).toBe(before.searchProducts + 1)
        expect(window.location.search).toBe("?q=mug")
        expect(browser.container.querySelectorAll("li")).toHaveLength(1)
        expect(browser.fallbacksSeen()).toEqual([])
      })
    )

    it.effect("can still navigate back to the page the server rendered (no remount issues)", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/")
        yield* Helpers.follow(browser, "/analytics")
        expect(browser.container.querySelector('[data-page-chunk="SENTINEL:analytics-page"]')).not.toBeNull()
        yield* Helpers.follow(browser, "/")
        expect(browser.container.querySelector('[data-page-chunk="SENTINEL:home-page"]')).not.toBeNull()
        const counter = Helpers.byTestId(browser.container, "home-counter")
        Helpers.click(counter)
        yield* TestHost.settle
        expect(counter.textContent).toBe("Clicked 1 times")
      })
    )

    it.effect("keeps a lazily navigated page mounted across its own state updates", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/")
        yield* Helpers.follow(browser, "/analytics")
        const section = browser.container.querySelector("section")
        const revenueTab = Helpers.byTestId(browser.container, "tab-revenue")

        Helpers.click(Helpers.byTestId(browser.container, "tab-orders"))
        yield* TestHost.settle
        yield* TestClock.adjust("5 millis")
        yield* TestHost.settle
        expect(Helpers.text(browser.container, '[data-testid="analytics-total"]')).toBe("Total Orders: 5664")
        // The page and its tabs are the same nodes: only the active panel's content changed.
        expect(browser.container.querySelector("section")).toBe(section)
        expect(Helpers.byTestId(browser.container, "tab-revenue")).toBe(revenueTab)
        expect(revenueTab.getAttribute("aria-selected")).toBe("false")
        expect(Helpers.byTestId(browser.container, "tab-orders").getAttribute("aria-selected")).toBe("true")
      })
    )

    it.effect("fetches a navigated Query.Service page's queries on the client", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/")
        expect(yield* Helpers.portCounts).toEqual({
          searchProducts: 0,
          getProduct: 0,
          bookmarkProduct: 0,
          getAnalytics: 0,
          getStatus: 0,
          checkOrderCode: 0,
          validatePromoCode: 0,
          submitOrder: 0
        })
        yield* Helpers.follow(browser, "/products")
        expect(browser.container.querySelectorAll("li")).toHaveLength(6)
        expect((yield* Helpers.portCounts).searchProducts).toBe(1) // nothing was shipped for this page, so it fetched
        yield* Helpers.follow(browser, "/products/42")
        expect(Helpers.text(browser.container, "h1")).toBe("Field notebook")
        expect((yield* Helpers.portCounts).getProduct).toBe(1)
        yield* Helpers.follow(browser, "/analytics")
        expect(Helpers.text(browser.container, '[data-testid="analytics-total"]')).toBe("Total Revenue (USD): 237500")
        expect((yield* Helpers.portCounts).getAnalytics).toBe(1)
      })
    )
  })
})

// `boot` installs the link prefetch inside the app scope and removes it when the scope closes.
describe("link prefetch", () => {
  it.layer(Helpers.browserEnv, { buildPerTest: true })("on the browser", (it) => {
    it.effect("preloads a page's chunk on pointer intent, without changing what renders", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/")
        expect(browser.side.loaded).not.toContain("Analytics")

        Helpers.link(browser.container, "/analytics").dispatchEvent(new Event("pointerover", { bubbles: true }))
        yield* Helpers.chunkLoaded(browser.side, "/analytics")
        expect(browser.side.loaded).toContain("Analytics")

        // Nothing visible changed, and nothing else was fetched.
        expect(browser.container.querySelector('[data-page-chunk="SENTINEL:analytics-page"]')).toBeNull()
        expect(browser.container.querySelector('[data-page-chunk="SENTINEL:home-page"]')).not.toBeNull()
        expect(browser.side.loaded).not.toContain("Products")
      })
    )

    it.effect("preloads on keyboard focus too, and then navigates with no loading fallback", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/")
        const products = Helpers.link(browser.container, "/products")
        products.dispatchEvent(new Event("focusin", { bubbles: true }))
        yield* Helpers.chunkLoaded(browser.side, "/products")
        expect(browser.side.loaded).toContain("Products")

        Helpers.click(products)
        yield* TestHost.settle
        yield* TestClock.adjust("5 millis")
        yield* TestHost.settle
        expect(browser.container.querySelector('[data-page-chunk="SENTINEL:products-page"]')).not.toBeNull()
        // The chunk was already loaded, so `Component.lazy` mounts at once: no fallback.
        expect(browser.fallbacksSeen()).toEqual([])
      })
    )

    it.effect("ignores links the browser handles itself (target, download) and other origins", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/")
        const preload = vi.spyOn(browser.side.pages.Analytics, "preload")
        const anchors: ReadonlyArray<{ readonly attrs: Record<string, string> }> = [
          { attrs: { href: "/analytics", target: "_blank" } },
          { attrs: { href: "/analytics", download: "" } },
          { attrs: { href: "https://example.com/analytics" } },
          { attrs: { href: "http://[bad" } }
        ]
        for (const { attrs } of anchors) {
          const anchor = document.createElement("a")
          for (const [name, value] of Object.entries(attrs)) anchor.setAttribute(name, value)
          browser.container.append(anchor)
          anchor.dispatchEvent(new Event("pointerover", { bubbles: true }))
        }
        yield* TestHost.settle
        expect(preload).not.toHaveBeenCalled()
        expect(browser.side.loaded).not.toContain("Analytics")

        // Positive twin: the same href without the attribute does preload, so the assertion above could have failed.
        const plain = document.createElement("a")
        plain.setAttribute("href", "/analytics")
        browser.container.append(plain)
        plain.dispatchEvent(new Event("pointerover", { bubbles: true }))
        expect(preload).toHaveBeenCalledTimes(1)
        yield* Helpers.chunkLoaded(browser.side, "/analytics")
        expect(browser.side.loaded).toContain("Analytics")
      })
    )

    it.effect("stops preloading once the app's scope is closed", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/")
        const preload = vi.spyOn(browser.side.pages.Analytics, "preload")
        const analytics = Helpers.link(browser.container, "/analytics") // closing the scope unmounts the app's nodes
        yield* browser.close
        document.body.append(analytics) // still an `<a href>` in the document, now with no app listening
        analytics.dispatchEvent(new Event("pointerover", { bubbles: true }))
        yield* TestHost.settle
        expect(preload).not.toHaveBeenCalled()
        expect(browser.side.loaded).not.toContain("Analytics")
      })
    )
  })
})
