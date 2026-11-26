import { Router } from "@effect/ui"
import { BrowserRouter, HtmlHydrate } from "@effect/ui/html"
import { TestHost } from "@effect/ui/testing"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Layer, Scope } from "effect"
import * as Routes from "../src/routes.ts"
import * as Helpers from "./helpers.ts"

const productsPath = "/App/ProductsPage[/products]"

describe("hydration of native Component.lazy pages after `await preloadRoute(route)`", () => {
  it.layer(Helpers.browserEnv, { buildPerTest: true })("on the browser", (it) => {
    it.effect("adopts the exact server DOM nodes of the page (reference equality)", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateCapturing("/products?q=mug", (container) => ({
          // The server's nodes, captured BEFORE the client boots.
          header: container.querySelector("header"),
          section: container.querySelector("section"),
          input: container.querySelector("input[type=search]"),
          list: container.querySelector("ul"),
          item: container.querySelector("li"),
          link: container.querySelector("li a"),
          button: container.querySelector("li button")
        }))
        const server = browser.before
        for (const [name, node] of Object.entries(server)) expect(node, `${name} was server-rendered`).not.toBeNull()

        // The very same nodes, not equal-looking copies: nothing was thrown away and rebuilt.
        const { container } = browser
        expect(container.querySelector("header")).toBe(server.header)
        expect(container.querySelector("section")).toBe(server.section)
        expect(container.querySelector("input[type=search]")).toBe(server.input)
        expect(container.querySelector("ul")).toBe(server.list)
        expect(container.querySelector("li")).toBe(server.item)
        expect(container.querySelector("li a")).toBe(server.link)
        expect(container.querySelector("li button")).toBe(server.button)
        expect(server.section?.isConnected).toBe(true)
      })
    )

    it.effect("never renders the loading fallback, at any point", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/analytics")
        yield* Helpers.runOutTheClock
        expect(browser.fallbacksSeen()).toEqual([])
        expect(browser.container.querySelector("[data-fallback]")).toBeNull()
        expect(browser.container.querySelector('[data-page-chunk="SENTINEL:analytics-page"]')).not.toBeNull()
      })
    )

    it.effect("adopts the server's serialized Model instead of running the client's init", () =>
      Effect.gen(function* () {
        // `init` gives `compared: []`. The (edited) server state says one product is compared.
        const browser = yield* Helpers.hydrateFromServer("/products", {
          editState: Helpers.withModel(productsPath, { compared: ["64"] })
        })
        expect(Helpers.text(browser.container, '[data-testid="products-compared"]')).toBe("Comparing 1 product(s)")
        const pressed = [...browser.container.querySelectorAll("li button")].map((b) => b.getAttribute("aria-pressed"))
        expect(pressed).toEqual(["false", "false", "false", "false", "false", "true"])
        expect(browser.fallbacksSeen()).toEqual([])
      })
    )

    it.effect("adopts the server Model on the Home page too (counter seeded by the server, not by init)", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/", {
          editState: (state) => ({ ...state, "/App/HomePage[/]": { clicks: 41 } })
        })
        expect(Helpers.text(browser.container, '[data-testid="home-counter"]')).toBe("Clicked 41 times")
      })
    )

    it.effect("is live after hydration: a click on the server-rendered button updates it in place", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateCapturing("/", (container) =>
          container.querySelector('[data-testid="home-counter"]')
        )
        const button = browser.before
        expect(button).not.toBeNull()
        if (button === null) return
        expect(button.textContent).toBe("Clicked 0 times")
        Helpers.click(button)
        yield* TestHost.settle
        expect(button.textContent).toBe("Clicked 1 times")
        expect(browser.container.querySelector('[data-testid="home-counter"]')).toBe(button)
      })
    )

    it.effect("imports only the active route's page module before hydrating", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/products/42")
        expect(browser.side.loaded).toEqual(["ProductDetail"])
      })
    )

    it.effect("hydrates the NotFound page (catch-all route) too", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateCapturing("/no/such/page", (container) =>
          container.querySelector("section")
        )
        expect(browser.container.querySelector("section")).toBe(browser.before)
        expect(browser.fallbacksSeen()).toEqual([])
      })
    )
  })
})

describe("Query.Service entries hydrate from the server's `~query`", () => {
  it.layer(Helpers.browserEnv, { buildPerTest: true })("on the browser", (it) => {
    it.effect("Products: ships the entry, adopts the DOM, and the client never refetches", () =>
      Effect.gen(function* () {
        const server = yield* Helpers.serverRender("/products?q=mug")
        expect(JSON.stringify(server.state["~query"])).toContain("search/SearchProducts")
        expect(server.state[productsPath]).toHaveProperty("queries.results")
        expect(server.serverCalls.searchProducts).toBe(1)

        const browser = yield* Helpers.hydrateCapturing("/products?q=mug", (container) => ({
          list: container.querySelector("ul"),
          item: container.querySelector("li")
        }))
        // The results were adopted: the same list and row nodes, already holding the server's data.
        expect(browser.container.querySelector("ul")).toBe(browser.before.list)
        expect(browser.container.querySelector("li")).toBe(browser.before.item)
        expect(browser.container.querySelectorAll("li")).toHaveLength(1)
        expect(Helpers.text(browser.container, '[data-testid="products-status"]')).toBe("1 product(s).")

        // Let anything that would refetch run, then count the catalog reads on the CLIENT's ports.
        yield* Helpers.runOutTheClock
        expect((yield* Helpers.portCounts).searchProducts).toBe(0)
        expect(browser.fallbacksSeen()).toEqual([])
      })
    )

    it.effect("ProductDetail: ships the entry, adopts the DOM, and the client never refetches", () =>
      Effect.gen(function* () {
        const server = yield* Helpers.serverRender("/products/42")
        expect(JSON.stringify(server.state["~query"])).toContain("product/GetProduct")

        const browser = yield* Helpers.hydrateCapturing("/products/42", (container) => ({
          section: container.querySelector("section"),
          title: container.querySelector("h1")
        }))
        expect(browser.container.querySelector("section")).toBe(browser.before.section)
        expect(browser.container.querySelector("h1")).toBe(browser.before.title)
        expect(Helpers.text(browser.container, "h1")).toBe("Field notebook")

        yield* Helpers.runOutTheClock
        expect((yield* Helpers.portCounts).getProduct).toBe(0)
      })
    )

    it.effect("fetches (once) when the state has no `~query`: proves the zero-refetch assertion can fail", () =>
      Effect.gen(function* () {
        yield* Helpers.hydrateFromServer("/products?q=mug", {
          editState: ({ "~query": _dropped, ...state }) => state
        })
        yield* Helpers.runOutTheClock
        expect((yield* Helpers.portCounts).searchProducts).toBe(1)
      })
    )
  })
})

describe("negative control: native Component.lazy WITHOUT preloadRoute before hydrating", () => {
  it.layer(Helpers.browserEnv, { buildPerTest: true })("on the browser", (it) => {
    it.effect("replaces the server DOM with the fallback, which is why boot awaits preloadRoute first", () =>
      Effect.gen(function* () {
        const server = yield* Helpers.serverRender("/products?q=mug")
        const side = Helpers.makeSide()

        window.history.replaceState(null, "", "/products?q=mug")
        document.body.innerHTML = `<div id="app">${server.appHtml}</div>`
        const container = document.getElementById("app")
        if (container === null) throw new Error("#app missing")
        const serverSection = container.querySelector("section")
        expect(serverSection).not.toBeNull()

        const fallbacks: Array<Element> = []
        const recordFallbacks = (records: ReadonlyArray<MutationRecord>): void => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (node instanceof Element && node.hasAttribute("data-fallback")) fallbacks.push(node)
            }
          }
        }
        const observer = new MutationObserver(recordFallbacks)
        observer.observe(container, { childList: true, subtree: true })

        // Whatever an assertion below does, the observer and the app's scope are released.
        const scope = yield* Scope.make()
        yield* Effect.addFinalizer(() =>
          Effect.suspend(() => {
            observer.disconnect()
            return Scope.close(scope, Exit.void)
          })
        )
        // The page module has NOT been imported: nothing awaited `pages.Products.preload()`.
        expect(side.loaded).toEqual([])
        const router = yield* Layer.buildWithScope(BrowserRouter.layer({ routes: Routes.AppRoute }), scope)
        yield* HtmlHydrate.hydrateEffect(side.app, Router.props(Routes.AppRoute), container, server.state).pipe(
          Effect.tap((root) => root.adopted),
          Effect.provideContext(router),
          Effect.provideService(Scope.Scope, scope)
        )
        yield* TestHost.settle
        // The load `Component.lazy` started is the one `preload()` shares: once it resolves, settle renders the page.
        yield* Helpers.chunkLoaded(side, "/products?q=mug")
        // The page renders, but as a NEW node: the server's was thrown away.
        recordFallbacks(observer.takeRecords())
        expect(container.querySelector('[data-page-chunk="SENTINEL:products-page"]')).not.toBeNull()
        expect(side.loaded).toEqual(["Products"])
        expect(fallbacks.length).toBeGreaterThan(0)
        expect(serverSection?.isConnected).toBe(false)
        expect(container.querySelector("section")).not.toBe(serverSection)
      })
    )
  })
})
