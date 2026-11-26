import { describe, expect, it } from "vitest"
import { click, hydrateFromServer, loadApp, loadedPages, serverRender, text } from "./helpers.ts"

const productsPath = "/App/ProductsPage[/products]"

/** The server's state with a different Model for one page, keeping that page's serialized queries. */
const withModel = (path: string, model: unknown) => (state: Record<string, unknown>) => {
  const entry = state[path]
  const rest = typeof entry === "object" && entry !== null ? entry : {}
  return { ...state, [path]: { ...rest, model } }
}

describe("hydration of native Component.lazy pages after `await preloadRoute(route)`", () => {
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
      editState: withModel(productsPath, { compared: ["64"] })
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

  it("imports only the active route's page module before hydrating", async () => {
    await hydrateFromServer("/products/42")
    expect([...loadedPages]).toEqual(["ProductDetail"])
  })

  it("hydrates the NotFound page (catch-all route) too", async () => {
    const browser = await hydrateFromServer("/no/such/page", {
      beforeBoot: (container) => container.querySelector("section")
    })
    expect(browser.container.querySelector("section")).toBe(browser.before)
    expect(browser.app.loadingStats.rendered).toBe(0)
  })
})

describe("Query.Service entries hydrate from the server's `~query`", () => {
  it("Products: ships the entry, adopts the DOM, and the client never refetches", async () => {
    const server = await serverRender("/products?q=mug")
    expect(JSON.stringify(server.state["~query"])).toContain("catalog/SearchProducts")
    expect(server.state[productsPath]).toMatchObject({ queries: { results: expect.anything() } })

    const browser = await hydrateFromServer("/products?q=mug", {
      beforeBoot: (container) => ({ list: container.querySelector("ul"), item: container.querySelector("li") })
    })
    // The results were adopted: the same list and row nodes, already holding the server's data.
    expect(browser.container.querySelector("ul")).toBe(browser.before.list)
    expect(browser.container.querySelector("li")).toBe(browser.before.item)
    expect(browser.container.querySelectorAll("li")).toHaveLength(1)
    expect(text(browser.container, '[data-testid="products-status"]')).toBe("1 product(s).")

    // Let anything that would refetch run, then count the catalog reads on the CLIENT's copy.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(browser.app.catalogReads.searchProducts).toBe(0)
    expect(browser.fallbacksSeen).toEqual([])
  })

  it("ProductDetail: ships the entry, adopts the DOM, and the client never refetches", async () => {
    const server = await serverRender("/products/42")
    expect(JSON.stringify(server.state["~query"])).toContain("catalog/GetProduct")

    const browser = await hydrateFromServer("/products/42", {
      beforeBoot: (container) => ({ section: container.querySelector("section"), title: container.querySelector("h1") })
    })
    expect(browser.container.querySelector("section")).toBe(browser.before.section)
    expect(browser.container.querySelector("h1")).toBe(browser.before.title)
    expect(text(browser.container, "h1")).toBe("Field notebook")

    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(browser.app.catalogReads.getProduct).toBe(0)
  })

  it("fetches (once) when the state has no `~query`: proves the zero-refetch assertion can fail", async () => {
    const browser = await hydrateFromServer("/products?q=mug", {
      editState: ({ "~query": _dropped, ...state }) => state
    })
    await expect.poll(() => browser.app.catalogReads.searchProducts).toBe(1)
  })
})

describe("negative control: native Component.lazy WITHOUT preloadRoute before hydrating", () => {
  it("replaces the server DOM with the fallback, which is why boot awaits preloadRoute first", async () => {
    const server = await serverRender("/products?q=mug")
    const app = await loadApp()
    const { App } = await import("../src/App.ts")
    const { Effect, Exit, Scope, Router, BrowserRouter, HtmlHydrate } = app.lib

    window.history.replaceState(null, "", "/products?q=mug")
    document.body.innerHTML = `<div id="app">${server.appHtml}</div>`
    const container = document.getElementById("app")
    if (container === null) throw new Error("#app missing")
    const serverSection = container.querySelector("section")
    expect(serverSection).not.toBeNull()

    const fallbacks: Array<Element> = []
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element && node.hasAttribute("data-fallback")) fallbacks.push(node)
        }
      }
    })
    observer.observe(container, { childList: true, subtree: true })

    // The page module has NOT been imported: nothing awaited `pages.Products.preload()`.
    expect([...loadedPages]).toEqual([])
    const scope = await Effect.runPromise(Scope.make())
    await Effect.runPromise(
      HtmlHydrate.hydrateEffect(App, Router.props(app.AppRoute), container, server.state).pipe(
        Effect.tap((root) => root.adopted),
        Effect.provide(BrowserRouter.layer({ routes: app.AppRoute })),
        Effect.provideService(Scope.Scope, scope)
      )
    )
    // Once the chunk arrives the page renders, but as a NEW node: the server's was thrown away.
    await expect.poll(() => container.querySelector('[data-page-chunk="SENTINEL:products-page"]')).not.toBeNull()
    observer.disconnect()
    expect(fallbacks.length).toBeGreaterThan(0)
    expect(app.loadingStats.rendered).toBeGreaterThan(0)
    expect(serverSection?.isConnected).toBe(false)
    expect(container.querySelector("section")).not.toBe(serverSection)
    await Effect.runPromise(Scope.close(scope, Exit.void))
  })
})
