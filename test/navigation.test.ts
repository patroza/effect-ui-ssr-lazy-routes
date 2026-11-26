import { describe, expect, it } from "vitest"
import { click, hydrateFromServer, loadedPages, text } from "./helpers.ts"

const link = (container: Element, href: string): Element => {
  const anchor = container.querySelector(`a[href="${href}"]`)
  if (anchor === null) throw new Error(`no link to ${href}`)
  return anchor
}

describe("client-side navigation to a route that was not preloaded", () => {
  it("loads the page's chunk lazily on navigation, and keeps the surrounding DOM", async () => {
    const browser = await hydrateFromServer("/", {
      beforeBoot: (container) => container.querySelector("header")
    })
    expect([...loadedPages]).toEqual(["Home"])

    click(link(browser.container, "/analytics"))
    await expect.poll(() => browser.container.querySelector('[data-page-chunk="SENTINEL:analytics-page"]')).not.toBeNull()

    expect([...loadedPages].sort()).toEqual(["Analytics", "Home"]) // only the visited page was imported
    expect(window.location.pathname).toBe("/analytics")
    expect(browser.container.querySelector("header")).toBe(browser.before) // the shell was not rebuilt
    expect(browser.container.querySelector('[data-page-chunk="SENTINEL:home-page"]')).toBeNull()
  })

  it("does not remount the page on state or search updates", async () => {
    const browser = await hydrateFromServer("/", {})
    click(link(browser.container, "/products"))
    await expect.poll(() => browser.container.querySelector('[data-page-chunk="SENTINEL:products-page"]')).not.toBeNull()
    expect(loadedPages.has("Products")).toBe(true)
    await expect.poll(() => browser.container.querySelectorAll("li").length).toBe(6)

    const section = browser.container.querySelector("section")
    const input = browser.container.querySelector<HTMLInputElement>("input[type=search]")
    if (section === null || input === null) throw new Error("products page not rendered")

    // 1. A Model update (compare product "1") keeps the very same nodes.
    const compare = browser.container.querySelector("li button")
    if (compare === null) throw new Error("no compare button")
    click(compare)
    await expect.poll(() => text(browser.container, '[data-testid="products-compared"]')).toBe("Comparing 1 product(s)")
    expect(browser.container.querySelector("section")).toBe(section)

    // 2. A search update (`?q=mug`) changes the props (and so the query's args), not the instance.
    input.value = "mug"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await expect.poll(() => browser.container.querySelectorAll("li").length).toBe(1)
    await expect.poll(() => window.location.search).toBe("?q=mug")

    expect(browser.container.querySelector("section")).toBe(section)
    expect(browser.container.querySelector("input[type=search]")).toBe(input)
    // The Model survived the search update; a remount would have reset it to 0.
    expect(text(browser.container, '[data-testid="products-compared"]')).toBe("Comparing 1 product(s)")
  })

  it("can still navigate back to the page the server rendered (no remount issues)", async () => {
    const browser = await hydrateFromServer("/")
    click(link(browser.container, "/analytics"))
    await expect.poll(() => browser.container.querySelector('[data-page-chunk="SENTINEL:analytics-page"]')).not.toBeNull()
    click(link(browser.container, "/"))
    await expect.poll(() => browser.container.querySelector('[data-page-chunk="SENTINEL:home-page"]')).not.toBeNull()
    const counter = browser.container.querySelector('[data-testid="home-counter"]')
    if (counter === null) throw new Error("no counter")
    click(counter)
    await expect.poll(() => counter.textContent).toBe("Clicked 1 times")
  })

  it("keeps a lazily navigated page mounted across its own state updates", async () => {
    const browser = await hydrateFromServer("/")
    click(link(browser.container, "/analytics"))
    await expect.poll(() => browser.container.querySelector('[data-page-chunk="SENTINEL:analytics-page"]')).not.toBeNull()
    const chart = browser.container.querySelector('[data-testid="analytics-chart"]')

    const orders = [...browser.container.querySelectorAll("button")].find((b) => b.textContent === "Orders")
    if (orders === undefined) throw new Error("no Orders button")
    click(orders)
    await expect.poll(() => text(browser.container, '[data-testid="analytics-total"]')).toBe("Total Orders: 5664")
    expect(browser.container.querySelector('[data-testid="analytics-chart"]')).toBe(chart) // same node: no remount
  })

  it("fetches a navigated Query.Service page's queries on the client", async () => {
    const browser = await hydrateFromServer("/")
    expect(browser.app.catalogReads).toEqual({ searchProducts: 0, getProduct: 0 })
    click(link(browser.container, "/products"))
    await expect.poll(() => browser.container.querySelectorAll("li").length).toBe(6)
    expect(browser.app.catalogReads.searchProducts).toBe(1) // nothing was shipped for this page, so it fetched
    click(link(browser.container, "/products/42"))
    await expect.poll(() => text(browser.container, "h1")).toBe("Field notebook")
    expect(browser.app.catalogReads.getProduct).toBe(1)
  })
})

// `boot` installs the link prefetch inside the app scope and removes it when the scope closes.
describe("link prefetch", () => {
  it("preloads a page's chunk on pointer intent, without changing what renders", async () => {
    const browser = await hydrateFromServer("/")
    expect(loadedPages.has("Analytics")).toBe(false)

    link(browser.container, "/analytics").dispatchEvent(new Event("pointerover", { bubbles: true }))
    await expect.poll(() => loadedPages.has("Analytics")).toBe(true)

    // Nothing visible changed, and nothing else was fetched.
    expect(browser.container.querySelector('[data-page-chunk="SENTINEL:analytics-page"]')).toBeNull()
    expect(browser.container.querySelector('[data-page-chunk="SENTINEL:home-page"]')).not.toBeNull()
    expect(loadedPages.has("Products")).toBe(false)
  })

  it("preloads on keyboard focus too, and then navigates with no loading fallback", async () => {
    const browser = await hydrateFromServer("/")
    const products = link(browser.container, "/products")
    products.dispatchEvent(new Event("focusin", { bubbles: true }))
    await expect.poll(() => loadedPages.has("Products")).toBe(true)

    click(products)
    await expect.poll(() => browser.container.querySelector('[data-page-chunk="SENTINEL:products-page"]')).not.toBeNull()
    // The chunk was already loaded, so `Component.lazy` mounts at once: no fallback.
    expect(browser.fallbacksSeen).toEqual([])
    expect(browser.app.loadingStats.rendered).toBe(0)
  })

  it("stops preloading once the app's scope is closed", async () => {
    const browser = await hydrateFromServer("/")
    const analytics = link(browser.container, "/analytics") // closing the scope unmounts the app's nodes
    await browser.close()
    document.body.append(analytics) // still an `<a href>` in the document, now with no app listening
    analytics.dispatchEvent(new Event("pointerover", { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(loadedPages.has("Analytics")).toBe(false)
  })
})
