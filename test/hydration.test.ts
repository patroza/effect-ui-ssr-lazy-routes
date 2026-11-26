import { describe, expect, it } from "vitest"
import { click, hydrateFromServer, loadApp, serverRender, text } from "./helpers.ts"

describe("hydration after preloadInitialRoute", () => {
  it("adopts the exact server DOM nodes of the page (reference equality)", async () => {
    const browser = await hydrateFromServer("/products?q=mug", {
      // The server's nodes, captured BEFORE the client boots.
      beforeBoot: (container) => ({
        header: container.querySelector("header"),
        section: container.querySelector("section"),
        input: container.querySelector("input[type=search]"),
        list: container.querySelector("ul"),
        item: container.querySelector("li"),
        link: container.querySelector("li a"),
        button: container.querySelector("li button")
      })
    })
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

    // The client rendered the REAL page component, never the lazy wrapper.
    expect(browser.app.pages.Products.mode()).toBe("initial")
  })

  it("never renders the loading fallback, at any point", async () => {
    const browser = await hydrateFromServer("/analytics")
    await new Promise((resolve) => setTimeout(resolve, 50)) // let any late render land
    expect(browser.fallbacksSeen).toEqual([])
    expect(browser.app.loadingStats.rendered).toBe(0)
    expect(browser.container.querySelector("[data-fallback]")).toBeNull()
    expect(browser.container.querySelector('[data-page-chunk="SENTINEL:analytics-page"]')).not.toBeNull()
  })

  it("adopts the server's serialized Model instead of running the client's init", async () => {
    // `init` gives `compared: []`. The (edited) server state says one product is compared.
    const browser = await hydrateFromServer("/products", {
      editState: (state) => ({ ...state, "/App/ProductsPage[/products]": { compared: ["64"] } })
    })
    expect(text(browser.container, '[data-testid="products-compared"]')).toBe("Comparing 1 product(s)")
    const pressed = [...browser.container.querySelectorAll("li button")].map((b) => b.getAttribute("aria-pressed"))
    expect(pressed).toEqual(["false", "false", "false", "false", "false", "true"])
    expect(browser.app.loadingStats.rendered).toBe(0)
  })

  it("adopts the server Model on the Home page too (counter seeded by the server, not by init)", async () => {
    const browser = await hydrateFromServer("/", {
      editState: (state) => ({ ...state, "/App/HomePage[/]": { clicks: 41 } })
    })
    expect(text(browser.container, '[data-testid="home-counter"]')).toBe("Clicked 41 times")
  })

  it("is live after hydration: a click on the server-rendered button updates it in place", async () => {
    const browser = await hydrateFromServer("/", {
      beforeBoot: (container) => container.querySelector('[data-testid="home-counter"]')
    })
    const button = browser.before
    expect(button).not.toBeNull()
    if (button === null) return
    expect(button.textContent).toBe("Clicked 0 times")
    click(button)
    await expect.poll(() => button.textContent).toBe("Clicked 1 times")
    expect(browser.container.querySelector('[data-testid="home-counter"]')).toBe(button)
  })

  it("loads only the active route's chunk before hydrating", async () => {
    const browser = await hydrateFromServer("/products/42")
    const { pages } = browser.app
    expect(pages.ProductDetail.isLoaded()).toBe(true)
    expect(pages.Home.isLoaded()).toBe(false)
    expect(pages.Products.isLoaded()).toBe(false)
    expect(pages.Analytics.isLoaded()).toBe(false)
    expect(pages.NotFound.isLoaded()).toBe(false)
  })

  it("hydrates the NotFound page (catch-all route) too", async () => {
    const browser = await hydrateFromServer("/no/such/page", {
      beforeBoot: (container) => container.querySelector("section")
    })
    expect(browser.container.querySelector("section")).toBe(browser.before)
    expect(browser.app.loadingStats.rendered).toBe(0)
  })
})

// Effect-TS/ui#263: while the upstream bug is open, hydrating with an
// unloaded `Component.lazy` throws inside the runtime (`stateCodecOf` reads
// `.model.ast` of the lazy wrapper) and the server DOM is thrown away. This is
// the CANARY for the workaround: once it fails, #263 is fixed upstream and
// `preloadInitial` can shrink to `lazy.preload()` (see README).
describe("Effect-TS/ui#263 canary", () => {
  it("naive hydrate (no preloadInitial) drops the page: why makeLazyRoutePage preloads first", async () => {
    const server = await serverRender("/products?q=mug")
    const app = await loadApp()
    const { App } = await import("../src/App.ts")
    const { Effect, Exit, Logger, Scope, Router, BrowserRouter, HtmlHydrate } = app.lib

    window.history.replaceState(null, "", "/products?q=mug")
    document.body.innerHTML = `<div id="app">${server.appHtml}</div>`
    const container = document.getElementById("app")
    if (container === null) throw new Error("#app missing")
    const serverSection = container.querySelector("section")
    expect(serverSection).not.toBeNull()

    const scope = await Effect.runPromise(Scope.make())
    await Effect.runPromise(
      HtmlHydrate.hydrateEffect(App, Router.props(app.AppRoute), container, server.state).pipe(
        Effect.tap((root) => root.adopted),
        // The runtime logs the TypeError; keep the test output quiet.
        Effect.provide([BrowserRouter.layer({ routes: app.AppRoute }), Logger.layer([])]),
        Effect.provideService(Scope.Scope, scope)
      )
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    // The server's page node was NOT adopted: it was discarded (the flash this repo removes).
    expect(serverSection?.isConnected).toBe(false)
    expect(container.querySelector("section")).not.toBe(serverSection)
    await Effect.runPromise(Scope.close(scope, Exit.void))
  })
})
