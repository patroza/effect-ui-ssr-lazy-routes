import { TestHost } from "@effect/ui/testing"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import * as BookmarkPort from "../src/product/services/BookmarkPort.ts"
import * as Helpers from "./helpers.ts"

const analyticsPath = "/App/AnalyticsPage[/analytics]"

/** The ports' round trip is 5 ms: this completes whatever a step started. */
const roundTrip = Effect.andThen(TestClock.adjust("5 millis"), TestHost.settle)

const serverDocument = (html: string) => new DOMParser().parseFromString(`<body>${html}</body>`, "text/html")

describe("@effect/ui-kit primitives: SSR (Ssr.ssr renders, hydrates and checks the two agree)", () => {
  it.effect(
    "Analytics: renders Tabs (active tab selected, one panel) and a closed Collapsible, plus its `~query`",
    () =>
      Effect.gen(function* () {
        const { result } = yield* Helpers.ssrAt("/analytics")
        const doc = serverDocument(result.html)
        expect(doc.querySelectorAll('[role="tab"]')).toHaveLength(2)
        expect(doc.querySelector('[data-testid="tab-revenue"]')?.getAttribute("aria-selected")).toBe("true")
        expect(doc.querySelector('[data-testid="tab-orders"]')?.getAttribute("aria-selected")).toBe("false")
        expect(doc.querySelectorAll('[role="tabpanel"]')).toHaveLength(1)
        expect(doc.querySelector('[data-testid="about-trigger"]')?.getAttribute("aria-expanded")).toBe("false")
        expect(doc.querySelector('[data-testid="about-panel"]')).toBeNull()
        expect(JSON.stringify(result.state["~query"])).toContain("analytics/GetAnalytics")
      }).pipe(Effect.provide(Helpers.appAt("/analytics")))
  )

  it.effect("ProductDetail: renders the Dialog trigger closed (no <dialog> in the HTML) and kit Buttons", () =>
    Effect.gen(function* () {
      const { result } = yield* Helpers.ssrAt("/products/42")
      const doc = serverDocument(result.html)
      expect(doc.querySelector('[data-testid="inquiry-trigger"]')).not.toBeNull()
      expect(doc.querySelector("dialog")).toBeNull()
      expect(doc.querySelector('[data-testid="detail-bookmark"]')?.textContent).toBe("Bookmark")
    }).pipe(Effect.provide(Helpers.appAt("/products/42")))
  )
})

describe("@effect/ui-kit primitives: zero-flash hydration", () => {
  it.layer(Helpers.browserEnv, { buildPerTest: true })("on the browser", (it) => {
    it.effect("Analytics: adopts the Tabs and Collapsible nodes, the `~query` entry, and never refetches", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateCapturing("/analytics", (container) => ({
          section: container.querySelector("section"),
          list: container.querySelector('[role="tablist"]'),
          revenue: container.querySelector('[data-testid="tab-revenue"]'),
          orders: container.querySelector('[data-testid="tab-orders"]'),
          panel: container.querySelector('[role="tabpanel"]'),
          chart: container.querySelector('[data-testid="analytics-chart"]'),
          about: container.querySelector('[data-testid="about-trigger"]')
        }))
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

        yield* Helpers.runOutTheClock
        expect((yield* Helpers.portCounts).getAnalytics).toBe(0)
        expect(browser.fallbacksSeen()).toEqual([])
      })
    )

    it.effect("Analytics: adopts the server's Collapsible state from the serialized Model", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/analytics", {
          editState: Helpers.withModel(analyticsPath, { metric: "revenue", aboutOpen: true })
        })
        expect(Helpers.byTestId(browser.container, "about-trigger").getAttribute("aria-expanded")).toBe("true")
        expect(Helpers.text(browser.container, '[data-testid="about-trigger"]')).toBe("Hide data notes")
      })
    )

    it.effect("ProductDetail: adopts the Dialog trigger and kit Button nodes", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateCapturing("/products/42", (container) => ({
          trigger: container.querySelector('[data-testid="inquiry-trigger"]'),
          more: container.querySelector('[data-testid="detail-more"]'),
          bookmark: container.querySelector('[data-testid="detail-bookmark"]')
        }))
        for (const [name, node] of Object.entries(browser.before))
          expect(node, `${name} was server-rendered`).not.toBeNull()
        expect(Helpers.byTestId(browser.container, "inquiry-trigger")).toBe(browser.before.trigger)
        expect(Helpers.byTestId(browser.container, "detail-more")).toBe(browser.before.more)
        expect(Helpers.byTestId(browser.container, "detail-bookmark")).toBe(browser.before.bookmark)
        yield* Helpers.runOutTheClock
        expect((yield* Helpers.portCounts).getProduct).toBe(0)
        expect(browser.fallbacksSeen()).toEqual([])
      })
    )
  })
})

describe("@effect/ui-kit primitives: interactive after hydration", () => {
  it.layer(Helpers.browserEnv, { buildPerTest: true })("on the browser", (it) => {
    it.effect("Tabs: switching tabs on the hydrated DOM keeps the adopted nodes and loads the other series", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateCapturing("/analytics", (container) => ({
          list: container.querySelector('[role="tablist"]'),
          revenue: container.querySelector('[data-testid="tab-revenue"]'),
          orders: container.querySelector('[data-testid="tab-orders"]')
        }))
        const { container, before } = browser
        expect(Helpers.text(container, '[data-testid="analytics-total"]')).toBe("Total Revenue (USD): 237500")

        Helpers.click(Helpers.byTestId(container, "tab-orders"))
        yield* Helpers.settleFrames
        yield* roundTrip
        expect(Helpers.text(container, '[data-testid="analytics-total"]')).toBe("Total Orders: 5664")
        expect(container.querySelector('[role="tablist"]')).toBe(before.list)
        expect(Helpers.byTestId(container, "tab-revenue")).toBe(before.revenue)
        expect(Helpers.byTestId(container, "tab-orders")).toBe(before.orders)
        expect(before.orders?.getAttribute("aria-selected")).toBe("true")
        expect(before.revenue?.getAttribute("aria-selected")).toBe("false")
        expect((yield* Helpers.portCounts).getAnalytics).toBe(1) // only the series the server did not ship

        Helpers.click(Helpers.byTestId(container, "tab-revenue")) // back: served from the (adopted) query cache
        yield* Helpers.settleFrames
        expect(Helpers.text(container, '[data-testid="analytics-total"]')).toBe("Total Revenue (USD): 237500")
        yield* Helpers.runOutTheClock
        expect((yield* Helpers.portCounts).getAnalytics).toBe(1)
      })
    )

    it.effect("Collapsible: opens and closes its panel on the adopted trigger", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateCapturing("/analytics", (container) =>
          container.querySelector('[data-testid="about-trigger"]')
        )
        const { container } = browser
        const trigger = browser.before
        expect(container.querySelector('[data-testid="about-panel"]')).toBeNull()

        Helpers.click(Helpers.byTestId(container, "about-trigger"))
        yield* Helpers.settleFrames
        expect(container.querySelector('[data-testid="about-panel"]')).not.toBeNull()
        expect(trigger?.getAttribute("aria-expanded")).toBe("true")
        expect(Helpers.byTestId(container, "about-trigger")).toBe(trigger)

        Helpers.click(Helpers.byTestId(container, "about-trigger"))
        yield* Helpers.settleFrames
        expect(container.querySelector('[data-testid="about-panel"]')).toBeNull()
        expect(trigger?.getAttribute("aria-expanded")).toBe("false")
      })
    )

    it.effect("Dialog + Input: opens from the adopted trigger, takes a question, sends and closes", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateCapturing("/products/42", (container) =>
          container.querySelector('[data-testid="inquiry-trigger"]')
        )
        const { container } = browser
        const trigger = browser.before
        expect(container.querySelector("dialog")).toBeNull()

        Helpers.click(Helpers.byTestId(container, "inquiry-trigger"))
        yield* Helpers.settleFrames
        expect(container.querySelector("dialog")).not.toBeNull()
        expect(Helpers.byTestId(container, "inquiry-trigger")).toBe(trigger) // the trigger was adopted, not rebuilt
        // The popup lives inside the portaled <dialog>, and is labelled by the product's name.
        expect(container.querySelector("dialog")?.contains(Helpers.byTestId(container, "inquiry-popup"))).toBe(true)
        expect(Helpers.byTestId(container, "inquiry-popup").textContent).toContain("About Field notebook")

        Helpers.type(Helpers.byTestId(container, "inquiry-input"), "Is it dot grid?")
        yield* Helpers.settleFrames
        expect(Helpers.inputValue(Helpers.byTestId(container, "inquiry-input"))).toBe("Is it dot grid?")
        Helpers.click(Helpers.byTestId(container, "inquiry-send"))
        yield* Helpers.settleFrames
        expect(Helpers.text(container, '[data-testid="inquiry-sent"]')).toBe("Question sent: “Is it dot grid?”")
        expect(container.querySelector("dialog")).toBeNull()
        expect(Helpers.byTestId(container, "inquiry-trigger")).toBe(trigger)
      })
    )

    it.effect("Dialog: the Cancel button closes it without sending", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/products/42")
        const { container } = browser
        Helpers.click(Helpers.byTestId(container, "inquiry-trigger"))
        yield* Helpers.settleFrames
        expect(container.querySelector("dialog")).not.toBeNull()
        Helpers.click(Helpers.byTestId(container, "inquiry-close"))
        yield* Helpers.settleFrames
        expect(container.querySelector("dialog")).toBeNull()
        expect(container.querySelector('[data-testid="inquiry-sent"]')).toBeNull()
      })
    )

    it.effect("Command.Service: BookmarkProduct runs once on click and its mapped message reaches update", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateCapturing("/products/42", (container) =>
          container.querySelector('[data-testid="detail-bookmark"]')
        )
        const { container } = browser
        const button = browser.before
        expect(button?.textContent).toBe("Bookmark")
        expect((yield* Helpers.portCounts).bookmarkProduct).toBe(0)

        Helpers.click(Helpers.byTestId(container, "detail-bookmark"))
        yield* Helpers.settleFrames
        expect(button?.textContent).toBe("Saving…") // the command is in flight on the port's round trip
        yield* roundTrip
        expect(button?.textContent).toBe("Bookmarked ✓")
        expect((yield* Helpers.portCounts).bookmarkProduct).toBe(1)
        expect(button?.hasAttribute("disabled")).toBe(true)
        expect(Helpers.byTestId(container, "detail-bookmark")).toBe(button) // same node

        Helpers.click(Helpers.byTestId(container, "detail-bookmark")) // a disabled button sends nothing
        yield* Helpers.runOutTheClock
        expect((yield* Helpers.portCounts).bookmarkProduct).toBe(1)
      })
    )

    it.effect("Command.Service: BookmarkProduct handles failure and allows retry", () =>
      Effect.gen(function* () {
        let attempts = 0
        const browser = yield* Helpers.hydrateFromServer("/products/42").pipe(
          Effect.provideService(BookmarkPort.BookmarkPort, {
            bookmark: () => {
              attempts++
              return attempts === 1 ? Effect.fail("offline") : Effect.void
            }
          })
        )
        const button = Helpers.byTestId(browser.container, "detail-bookmark")
        Helpers.click(button)
        yield* Helpers.settleFrames
        expect(button.textContent).toBe("Bookmark failed — retry")
        expect(button.hasAttribute("disabled")).toBe(false)

        Helpers.click(button)
        yield* Helpers.settleFrames
        expect(button.textContent).toBe("Bookmarked ✓")
        expect(attempts).toBe(2)
      })
    )

    it.effect("Button + Input on Products: compare toggles in place, typing updates the URL", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateCapturing("/products", (container) => ({
          input: container.querySelector("input[type=search]"),
          button: container.querySelector("li button")
        }))
        const { container, before } = browser
        expect(before.button).not.toBeNull()
        if (before.button === null) return
        Helpers.click(before.button)
        yield* Helpers.settleFrames
        expect(before.button.getAttribute("aria-pressed")).toBe("true")
        expect(Helpers.text(container, '[data-testid="products-compared"]')).toBe("Comparing 1 product(s)")

        const input = Helpers.byTestId(container, "products-search")
        expect(input).toBe(before.input)
        Helpers.type(input, "mug")
        yield* Helpers.settleFrames
        expect(window.location.search).toBe("?q=mug") // the URL is written at once
        expect(container.querySelectorAll("li")).toHaveLength(6)
        yield* TestClock.adjust("300 millis") // the debounce
        yield* Helpers.settleFrames
        yield* roundTrip
        expect(container.querySelectorAll("li")).toHaveLength(1)
        expect(container.querySelector("input[type=search]")).toBe(before.input)
      })
    )
  })
})
