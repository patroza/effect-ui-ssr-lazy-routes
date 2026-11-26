import { describe, expect, it } from "vitest"
import { click, hydrateFromServer, text } from "./helpers.ts"

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
    const { pages } = browser.app
    expect(pages.Analytics.isLoaded()).toBe(false)
    expect(pages.Products.isLoaded()).toBe(false)

    click(link(browser.container, "/analytics"))
    await expect.poll(() => browser.container.querySelector('[data-page-chunk="SENTINEL:analytics-page"]')).not.toBeNull()

    expect(pages.Analytics.isLoaded()).toBe(true)
    expect(pages.Products.isLoaded()).toBe(false) // only the visited page was fetched
    expect(window.location.pathname).toBe("/analytics")
    expect(browser.container.querySelector("header")).toBe(browser.before) // the shell was not rebuilt
    expect(browser.container.querySelector('[data-page-chunk="SENTINEL:home-page"]')).toBeNull()
    expect(pages.Analytics.mode()).toBe("lazy") // visited lazily, identity never swapped
  })

  it("does not remount the page on state or search updates", async () => {
    const browser = await hydrateFromServer("/", {})
    click(link(browser.container, "/products"))
    await expect.poll(() => browser.container.querySelector('[data-page-chunk="SENTINEL:products-page"]')).not.toBeNull()
    expect(browser.app.pages.Products.isLoaded()).toBe(true)

    const section = browser.container.querySelector("section")
    const input = browser.container.querySelector<HTMLInputElement>("input[type=search]")
    if (section === null || input === null) throw new Error("products page not rendered")

    // 1. A Model update (compare product "1") keeps the very same nodes.
    const compare = browser.container.querySelector("li button")
    if (compare === null) throw new Error("no compare button")
    click(compare)
    await expect.poll(() => text(browser.container, '[data-testid="products-compared"]')).toBe("Comparing 1 product(s)")
    expect(browser.container.querySelector("section")).toBe(section)

    // 2. A search update (`?q=mug`) changes the props, not the instance.
    input.value = "mug"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await expect.poll(() => browser.container.querySelectorAll("li").length).toBe(1)
    await expect.poll(() => window.location.search).toBe("?q=mug")

    expect(browser.container.querySelector("section")).toBe(section)
    expect(browser.container.querySelector("input[type=search]")).toBe(input)
    // The Model survived the search update; a remount would have reset it to 0.
    expect(text(browser.container, '[data-testid="products-compared"]')).toBe("Comparing 1 product(s)")
  })

  it("can still navigate back to the page the server rendered (real component, no remount issues)", async () => {
    const browser = await hydrateFromServer("/")
    expect(browser.app.pages.Home.mode()).toBe("initial")
    click(link(browser.container, "/analytics"))
    await expect.poll(() => browser.container.querySelector('[data-page-chunk="SENTINEL:analytics-page"]')).not.toBeNull()
    click(link(browser.container, "/"))
    await expect.poll(() => browser.container.querySelector('[data-page-chunk="SENTINEL:home-page"]')).not.toBeNull()
    const counter = browser.container.querySelector('[data-testid="home-counter"]')
    if (counter === null) throw new Error("no counter")
    click(counter)
    await expect.poll(() => counter.textContent).toBe("Clicked 1 times")
    expect(browser.app.pages.Home.mode()).toBe("initial")
  })

  it("never swaps a mounted page's component identity, even if preloadInitial is called late", async () => {
    const browser = await hydrateFromServer("/")
    click(link(browser.container, "/analytics"))
    await expect.poll(() => browser.container.querySelector('[data-page-chunk="SENTINEL:analytics-page"]')).not.toBeNull()
    const chart = browser.container.querySelector('[data-testid="analytics-chart"]')
    expect(browser.app.pages.Analytics.mode()).toBe("lazy")

    await browser.app.pages.Analytics.preloadInitial() // too late: the page is mounted
    expect(browser.app.pages.Analytics.mode()).toBe("lazy")

    const orders = [...browser.container.querySelectorAll("button")].find((b) => b.textContent === "Orders")
    if (orders === undefined) throw new Error("no Orders button")
    click(orders)
    await expect.poll(() => text(browser.container, '[data-testid="analytics-total"]')).toBe("Total Orders: 5664")
    expect(browser.container.querySelector('[data-testid="analytics-chart"]')).toBe(chart) // same node: no remount
  })
})

describe("link prefetch", () => {
  it("loads a page's chunk on pointer intent, without changing what renders", async () => {
    const browser = await hydrateFromServer("/")
    const stop = browser.app.installLinkPrefetch(document)
    try {
      const { pages } = browser.app
      expect(pages.Analytics.isLoaded()).toBe(false)

      link(browser.container, "/analytics").dispatchEvent(new Event("pointerover", { bubbles: true }))
      await expect.poll(() => pages.Analytics.isLoaded()).toBe(true)

      // Nothing visible changed, and the prefetch didn't set the initial component.
      expect(browser.container.querySelector('[data-page-chunk="SENTINEL:analytics-page"]')).toBeNull()
      expect(browser.container.querySelector('[data-page-chunk="SENTINEL:home-page"]')).not.toBeNull()
      expect(pages.Analytics.mode()).toBe("lazy")
      expect(pages.Products.isLoaded()).toBe(false)
    } finally {
      stop()
    }
  })

  it("loads a page's chunk on keyboard focus too, and then navigates with no loading fallback", async () => {
    const browser = await hydrateFromServer("/")
    const stop = browser.app.installLinkPrefetch(document)
    try {
      const products = link(browser.container, "/products")
      products.dispatchEvent(new Event("focusin", { bubbles: true }))
      await expect.poll(() => browser.app.pages.Products.isLoaded()).toBe(true)

      click(products)
      await expect.poll(() => browser.container.querySelector('[data-page-chunk="SENTINEL:products-page"]')).not.toBeNull()
      // The chunk was already loaded, so `Component.lazy` mounts at once: no fallback.
      expect(browser.fallbacksSeen).toEqual([])
      expect(browser.app.loadingStats.rendered).toBe(0)
    } finally {
      stop()
    }
  })
})
