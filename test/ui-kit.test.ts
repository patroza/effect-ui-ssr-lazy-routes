import { describe, expect, it } from "vitest"
import * as Helpers from "./helpers.ts"

const analyticsPath = "/App/AnalyticsPage[/analytics]"

/** The server's state with a different Model for one page, keeping that page's serialized queries. */
const withModel = (path: string, model: unknown) => (state: Record<string, unknown>) => {
  const entry = state[path]
  const rest = typeof entry === "object" && entry !== null ? entry : {}
  return { ...state, [path]: { ...rest, model } }
}

describe("@effect/ui-kit primitives: SSR", () => {
  it("Analytics: renders Tabs (active tab selected, one panel) and a closed Collapsible, plus its `~query`", async () => {
    const server = await Helpers.serverRender("/analytics")
    const doc = new DOMParser().parseFromString(server.html, "text/html")
    expect(doc.querySelectorAll('[role="tab"]')).toHaveLength(2)
    expect(doc.querySelector('[data-testid="tab-revenue"]')?.getAttribute("aria-selected")).toBe("true")
    expect(doc.querySelector('[data-testid="tab-orders"]')?.getAttribute("aria-selected")).toBe("false")
    expect(doc.querySelectorAll('[role="tabpanel"]')).toHaveLength(1)
    expect(doc.querySelector('[data-testid="about-trigger"]')?.getAttribute("aria-expanded")).toBe("false")
    expect(doc.querySelector('[data-testid="about-panel"]')).toBeNull()
    expect(JSON.stringify(server.state["~query"])).toContain("analytics/GetAnalytics")
  })

  it("ProductDetail: renders the Dialog trigger closed (no <dialog> in the HTML) and kit Buttons", async () => {
    const server = await Helpers.serverRender("/products/42")
    const doc = new DOMParser().parseFromString(server.html, "text/html")
    expect(doc.querySelector('[data-testid="inquiry-trigger"]')).not.toBeNull()
    expect(doc.querySelector("dialog")).toBeNull()
    expect(doc.querySelector('[data-testid="detail-bookmark"]')?.textContent).toBe("Bookmark")
  })
})

describe("@effect/ui-kit primitives: zero-flash hydration", () => {
  it("Analytics: adopts the Tabs and Collapsible nodes, the `~query` entry, and never refetches", async () => {
    const browser = await Helpers.hydrateFromServer("/analytics", {
      beforeBoot: (container) => ({
        section: container.querySelector("section"),
        list: container.querySelector('[role="tablist"]'),
        revenue: container.querySelector('[data-testid="tab-revenue"]'),
        orders: container.querySelector('[data-testid="tab-orders"]'),
        panel: container.querySelector('[role="tabpanel"]'),
        chart: container.querySelector('[data-testid="analytics-chart"]'),
        about: container.querySelector('[data-testid="about-trigger"]')
      })
    })
    for (const [name, node] of Object.entries(browser.before))
      expect(node, `${name} was server-rendered`).not.toBeNull()
    const { container, before } = browser
    expect(container.querySelector("section")).toBe(before.section)
    expect(container.querySelector('[role="tablist"]')).toBe(before.list)
    expect(Helpers.byTestId(container, "tab-revenue")).toBe(before.revenue)
    expect(Helpers.byTestId(container, "tab-orders")).toBe(before.orders)
    expect(container.querySelector('[role="tabpanel"]')).toBe(before.panel)
    expect(Helpers.byTestId(container, "analytics-chart")).toBe(before.chart)
    expect(Helpers.byTestId(container, "about-trigger")).toBe(before.about)

    await new Promise((resolve) => setTimeout(resolve, 100)) // let anything that would refetch run
    expect(browser.app.analyticsReads.getAnalytics).toBe(0)
    expect(browser.fallbacksSeen).toEqual([])
    expect(browser.app.loadingStats.rendered).toBe(0)
  })

  it("Analytics: adopts the server's Collapsible state from the serialized Model", async () => {
    const browser = await Helpers.hydrateFromServer("/analytics", {
      editState: withModel(analyticsPath, { metric: "revenue", aboutOpen: true })
    })
    expect(Helpers.byTestId(browser.container, "about-trigger").getAttribute("aria-expanded")).toBe("true")
    expect(Helpers.text(browser.container, '[data-testid="about-trigger"]')).toBe("Hide data notes")
  })

  it("ProductDetail: adopts the Dialog trigger and kit Button nodes", async () => {
    const browser = await Helpers.hydrateFromServer("/products/42", {
      beforeBoot: (container) => ({
        trigger: container.querySelector('[data-testid="inquiry-trigger"]'),
        more: container.querySelector('[data-testid="detail-more"]'),
        bookmark: container.querySelector('[data-testid="detail-bookmark"]')
      })
    })
    for (const [name, node] of Object.entries(browser.before))
      expect(node, `${name} was server-rendered`).not.toBeNull()
    expect(Helpers.byTestId(browser.container, "inquiry-trigger")).toBe(browser.before.trigger)
    expect(Helpers.byTestId(browser.container, "detail-more")).toBe(browser.before.more)
    expect(Helpers.byTestId(browser.container, "detail-bookmark")).toBe(browser.before.bookmark)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(browser.app.catalogReads.getProduct).toBe(0)
    expect(browser.fallbacksSeen).toEqual([])
  })
})

describe("@effect/ui-kit primitives: interactive after hydration", () => {
  it("Tabs: switching tabs on the hydrated DOM keeps the adopted nodes and loads the other series", async () => {
    const browser = await Helpers.hydrateFromServer("/analytics", {
      beforeBoot: (container) => ({
        list: container.querySelector('[role="tablist"]'),
        revenue: container.querySelector('[data-testid="tab-revenue"]'),
        orders: container.querySelector('[data-testid="tab-orders"]')
      })
    })
    const { container, before } = browser
    expect(Helpers.text(container, '[data-testid="analytics-total"]')).toBe("Total Revenue (USD): 237500")

    Helpers.click(Helpers.byTestId(container, "tab-orders"))
    await expect.poll(() => Helpers.text(container, '[data-testid="analytics-total"]')).toBe("Total Orders: 5664")
    expect(container.querySelector('[role="tablist"]')).toBe(before.list)
    expect(Helpers.byTestId(container, "tab-revenue")).toBe(before.revenue)
    expect(Helpers.byTestId(container, "tab-orders")).toBe(before.orders)
    expect(before.orders?.getAttribute("aria-selected")).toBe("true")
    expect(before.revenue?.getAttribute("aria-selected")).toBe("false")
    expect(browser.app.analyticsReads.getAnalytics).toBe(1) // only the series the server did not ship

    Helpers.click(Helpers.byTestId(container, "tab-revenue")) // back: served from the (adopted) query cache
    await expect
      .poll(() => Helpers.text(container, '[data-testid="analytics-total"]'))
      .toBe("Total Revenue (USD): 237500")
    expect(browser.app.analyticsReads.getAnalytics).toBe(1)
  })

  it("Collapsible: opens and closes its panel on the adopted trigger", async () => {
    const browser = await Helpers.hydrateFromServer("/analytics", {
      beforeBoot: (container) => container.querySelector('[data-testid="about-trigger"]')
    })
    const { container } = browser
    const trigger = browser.before
    expect(container.querySelector('[data-testid="about-panel"]')).toBeNull()

    Helpers.click(Helpers.byTestId(container, "about-trigger"))
    await expect.poll(() => container.querySelector('[data-testid="about-panel"]')).not.toBeNull()
    expect(trigger?.getAttribute("aria-expanded")).toBe("true")
    expect(Helpers.byTestId(container, "about-trigger")).toBe(trigger)

    Helpers.click(Helpers.byTestId(container, "about-trigger"))
    await expect.poll(() => container.querySelector('[data-testid="about-panel"]')).toBeNull()
    expect(trigger?.getAttribute("aria-expanded")).toBe("false")
  })

  it("Dialog + Input: opens from the adopted trigger, takes a question, sends and closes", async () => {
    const browser = await Helpers.hydrateFromServer("/products/42", {
      beforeBoot: (container) => container.querySelector('[data-testid="inquiry-trigger"]')
    })
    const { container } = browser
    const trigger = browser.before
    expect(container.querySelector("dialog")).toBeNull()

    Helpers.click(Helpers.byTestId(container, "inquiry-trigger"))
    await expect.poll(() => container.querySelector("dialog")).not.toBeNull()
    expect(Helpers.byTestId(container, "inquiry-trigger")).toBe(trigger) // the trigger was adopted, not rebuilt
    expect(container.querySelector("dialog [role=dialog], dialog")?.textContent).toContain("About Field notebook")

    Helpers.type(Helpers.byTestId(container, "inquiry-input"), "Is it dot grid?")
    await expect.poll(() => Helpers.inputValue(Helpers.byTestId(container, "inquiry-input"))).toBe("Is it dot grid?")
    Helpers.click(Helpers.byTestId(container, "inquiry-send"))
    await expect
      .poll(() => Helpers.text(container, '[data-testid="inquiry-sent"]'))
      .toBe("Question sent: “Is it dot grid?”")
    await expect.poll(() => container.querySelector("dialog")).toBeNull()
    expect(Helpers.byTestId(container, "inquiry-trigger")).toBe(trigger)
  })

  it("Dialog: the Cancel button closes it without sending", async () => {
    const browser = await Helpers.hydrateFromServer("/products/42")
    const { container } = browser
    Helpers.click(Helpers.byTestId(container, "inquiry-trigger"))
    await expect.poll(() => container.querySelector("dialog")).not.toBeNull()
    Helpers.click(Helpers.byTestId(container, "inquiry-close"))
    await expect.poll(() => container.querySelector("dialog")).toBeNull()
    expect(container.querySelector('[data-testid="inquiry-sent"]')).toBeNull()
  })

  it("Command.Service: BookmarkProduct runs once on click and its message reaches update", async () => {
    const browser = await Helpers.hydrateFromServer("/products/42", {
      beforeBoot: (container) => container.querySelector('[data-testid="detail-bookmark"]')
    })
    const { container } = browser
    const button = browser.before
    expect(button?.textContent).toBe("Bookmark")
    expect(browser.app.catalogWrites.bookmarkProduct).toBe(0)

    Helpers.click(Helpers.byTestId(container, "detail-bookmark"))
    await expect.poll(() => button?.textContent).toBe("Bookmarked ✓")
    expect(browser.app.catalogWrites.bookmarkProduct).toBe(1)
    expect(button?.hasAttribute("disabled")).toBe(true)
    expect(Helpers.byTestId(container, "detail-bookmark")).toBe(button) // same node

    Helpers.click(Helpers.byTestId(container, "detail-bookmark")) // a disabled button sends nothing
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(browser.app.catalogWrites.bookmarkProduct).toBe(1)
  })

  it("Button + Input on Products: compare toggles in place, typing updates the URL", async () => {
    const browser = await Helpers.hydrateFromServer("/products", {
      beforeBoot: (container) => ({
        input: container.querySelector("input[type=search]"),
        button: container.querySelector("li button")
      })
    })
    const { container, before } = browser
    expect(before.button).not.toBeNull()
    if (before.button === null) return
    Helpers.click(before.button)
    await expect.poll(() => before.button?.getAttribute("aria-pressed")).toBe("true")
    expect(Helpers.text(container, '[data-testid="products-compared"]')).toBe("Comparing 1 product(s)")

    const input = Helpers.byTestId(container, "products-search")
    expect(input).toBe(before.input)
    Helpers.type(input, "mug")
    await expect.poll(() => window.location.search).toBe("?q=mug")
    await expect.poll(() => container.querySelectorAll("li").length).toBe(1)
    expect(container.querySelector("input[type=search]")).toBe(before.input)
  })
})
