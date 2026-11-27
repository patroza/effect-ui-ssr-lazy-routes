import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as DevStyles from "../src/browser/devStyles.ts"
import * as Assets from "../src/server/assets.ts"
import type * as Routes from "../src/routes.ts"
import * as Helpers from "./helpers.ts"

const routeTags = [
  "Home",
  "Products",
  "ProductDetail",
  "Analytics",
  "Status",
  "Order",
  "Warehouse",
  "NotFound"
] as const satisfies ReadonlyArray<Routes.AppRouteTag>

// The shape of Vite's `.vite/manifest.json` for this app: every page imports the
// entry chunk (it shares the framework), and the two product pages also share a
// small catalog chunk.
const manifest: Assets.Manifest = {
  "src/main.ts": {
    file: "assets/main-E1.js",
    src: "src/main.ts",
    isEntry: true,
    css: ["assets/main-E1.css"],
    dynamicImports: Object.values(Assets.routeSources)
  },
  "_catalog-C1.js": { file: "assets/catalog-C1.js" },
  "src/pages/HomePage.ts": {
    file: "assets/HomePage-H1.js",
    isDynamicEntry: true,
    imports: ["src/main.ts"]
  },
  "src/pages/ProductsPage.ts": {
    file: "assets/ProductsPage-P1.js",
    isDynamicEntry: true,
    imports: ["src/main.ts", "_catalog-C1.js"]
  },
  "src/pages/product/ProductDetailPage.ts": {
    file: "assets/ProductDetailPage-D1.js",
    isDynamicEntry: true,
    imports: ["src/main.ts", "_catalog-C1.js"]
  },
  "src/pages/AnalyticsPage.ts": {
    file: "assets/AnalyticsPage-A1.js",
    isDynamicEntry: true,
    imports: ["src/main.ts"],
    css: ["assets/AnalyticsPage-A1.css"]
  },
  "src/pages/StatusPage.ts": {
    file: "assets/StatusPage-S1.js",
    isDynamicEntry: true,
    imports: ["src/main.ts"]
  },
  "src/pages/OrderFormPage.ts": {
    file: "assets/OrderFormPage-O1.js",
    isDynamicEntry: true,
    imports: ["src/main.ts"]
  },
  "src/pages/WarehousePage.ts": {
    file: "assets/WarehousePage-W1.js",
    isDynamicEntry: true,
    imports: ["src/main.ts"]
  },
  "src/pages/NotFoundPage.ts": {
    file: "assets/NotFoundPage-N1.js",
    isDynamicEntry: true,
    imports: ["src/main.ts"]
  }
}

describe("resolveRouteAssets", () => {
  it("preloads only the matched route's chunk (never another page's)", () => {
    expect(Assets.resolveRouteAssets(manifest, "Home").modulePreloads).toEqual(["/assets/HomePage-H1.js"])
    expect(Assets.resolveRouteAssets(manifest, "Analytics").modulePreloads).toEqual(["/assets/AnalyticsPage-A1.js"])
    expect(Assets.resolveRouteAssets(manifest, "Status").modulePreloads).toEqual(["/assets/StatusPage-S1.js"])
    expect(Assets.resolveRouteAssets(manifest, "Order").modulePreloads).toEqual(["/assets/OrderFormPage-O1.js"])
    expect(Assets.resolveRouteAssets(manifest, "Warehouse").modulePreloads).toEqual(["/assets/WarehousePage-W1.js"])
    expect(Assets.resolveRouteAssets(manifest, "NotFound").modulePreloads).toEqual(["/assets/NotFoundPage-N1.js"])
  })

  it("includes the transitive static imports of the route's chunk", () => {
    expect(Assets.resolveRouteAssets(manifest, "Products").modulePreloads).toEqual([
      "/assets/ProductsPage-P1.js",
      "/assets/catalog-C1.js"
    ])
    expect(Assets.resolveRouteAssets(manifest, "ProductDetail").modulePreloads).toEqual([
      "/assets/ProductDetailPage-D1.js",
      "/assets/catalog-C1.js"
    ])
  })

  it("follows imports transitively and survives cycles", () => {
    const chain: Assets.Manifest = {
      "src/main.ts": { file: "assets/e.js", isEntry: true },
      "src/pages/HomePage.ts": { file: "assets/h.js", imports: ["_a.js", "src/main.ts"] },
      "_a.js": { file: "assets/a.js", imports: ["_b.js"] },
      "_b.js": { file: "assets/b.js", imports: ["_a.js"] } // cycle
    }
    expect(Assets.resolveRouteAssets(chain, "Home").modulePreloads).toEqual([
      "/assets/h.js",
      "/assets/a.js",
      "/assets/b.js"
    ])
  })

  it("loads the entry with a script tag, and never preloads it", () => {
    for (const tag of routeTags) {
      const assets = Assets.resolveRouteAssets(manifest, tag)
      expect(assets.scripts).toEqual(["/assets/main-E1.js"])
      expect(assets.modulePreloads).not.toContain("/assets/main-E1.js")
    }
  })

  it("adds the entry's CSS everywhere and a page's CSS only on that page", () => {
    expect(Assets.resolveRouteAssets(manifest, "Home").stylesheets).toEqual(["/assets/main-E1.css"])
    expect(Assets.resolveRouteAssets(manifest, "Analytics").stylesheets).toEqual([
      "/assets/main-E1.css",
      "/assets/AnalyticsPage-A1.css"
    ])
  })

  it("preloads the entry's static imports even when the route chunk does not import them", () => {
    const splitEntry: Assets.Manifest = {
      "src/main.ts": { file: "assets/main-E1.js", isEntry: true, imports: ["_framework-F1.js"] },
      "_framework-F1.js": { file: "assets/framework-F1.js" },
      "src/pages/HomePage.ts": { file: "assets/HomePage-H1.js", isDynamicEntry: true }
    }
    const assets = Assets.resolveRouteAssets(splitEntry, "Home")
    expect(assets.scripts).toEqual(["/assets/main-E1.js"])
    expect(assets.modulePreloads).toEqual(["/assets/HomePage-H1.js", "/assets/framework-F1.js"])
  })

  it("fails loudly when the manifest lacks a route's module", () => {
    const { "src/pages/HomePage.ts": _removed, ...incomplete } = manifest
    expect(() => Assets.resolveRouteAssets(incomplete, "Home")).toThrow(/src\/pages\/HomePage\.ts/)
  })
})

describe("document head", () => {
  const preloads = (html: string): ReadonlyArray<string> =>
    [...html.matchAll(/<link rel="modulepreload"[^>]*href="([^"]+)"/g)].map((match) => match[1] ?? "")

  const documents = [
    { url: "/", expected: ["/assets/HomePage-H1.js"] },
    { url: "/products?q=mug", expected: ["/assets/ProductsPage-P1.js", "/assets/catalog-C1.js"] },
    { url: "/products/42", expected: ["/assets/ProductDetailPage-D1.js", "/assets/catalog-C1.js"] },
    { url: "/analytics", expected: ["/assets/AnalyticsPage-A1.js"] },
    { url: "/status", expected: ["/assets/StatusPage-S1.js"] },
    { url: "/order", expected: ["/assets/OrderFormPage-O1.js"] },
    { url: "/warehouse", expected: ["/assets/WarehousePage-W1.js"] },
    { url: "/nope", expected: ["/assets/NotFoundPage-N1.js"] }
  ]
  it.layer(Helpers.browserEnv, { buildPerTest: true })("rendered on the server", (it) => {
    for (const { expected, url } of documents) {
      it.effect(`server HTML for ${url} preloads exactly the active route's chunks`, () =>
        Effect.gen(function* () {
          const page = yield* Helpers.renderDocument(url, (route) => Assets.resolveRouteAssets(manifest, route._tag))
          expect(preloads(page.html)).toEqual(expected)
          // The entry is a module script in <head>, so it downloads in parallel with the preloads.
          expect(page.html).toContain('<script type="module" crossorigin src="/assets/main-E1.js"></script>')
          // Preloads and the entry precede the body: no entry -> page waterfall.
          expect(page.html.indexOf("modulepreload")).toBeLessThan(page.html.indexOf("<body"))
        })
      )
    }
  })

  it("renderAssetTags escapes attribute values", () => {
    const tags = Assets.renderAssetTags({ scripts: [], modulePreloads: ['/a"b.js'], stylesheets: [] })
    expect(tags).toContain('href="/a&quot;b.js"')
  })
})

describe("resolveRouteAssets locale chunks", () => {
  it("preloads only the active locale chunk when the manifest lists locale catalogs", () => {
    const withLocales: Assets.Manifest = {
      [Assets.ENTRY_SOURCE]: {
        file: "assets/main-E1.js",
        isEntry: true,
        dynamicImports: ["src/pages/WarehousePage.ts", "src/i18n/catalogs/en.ts", "src/i18n/catalogs/de.ts"]
      },
      "src/pages/WarehousePage.ts": {
        file: "assets/WarehousePage-W1.js",
        isDynamicEntry: true,
        imports: ["assets/shared-S1.js"]
      },
      "assets/shared-S1.js": { file: "assets/shared-S1.js" },
      "src/i18n/catalogs/en.ts": { file: "assets/en-EN1.js", isDynamicEntry: true },
      "src/i18n/catalogs/de.ts": { file: "assets/de-DE1.js", isDynamicEntry: true }
    }
    const enAssets = Assets.resolveRouteAssets(withLocales, "Warehouse", "en")
    expect(enAssets.modulePreloads).toEqual([
      "/assets/WarehousePage-W1.js",
      "/assets/shared-S1.js",
      "/assets/en-EN1.js"
    ])
    expect(enAssets.modulePreloads).not.toContain("/assets/de-DE1.js")

    const deAssets = Assets.resolveRouteAssets(withLocales, "Warehouse", "de")
    expect(deAssets.modulePreloads).toEqual([
      "/assets/WarehousePage-W1.js",
      "/assets/shared-S1.js",
      "/assets/de-DE1.js"
    ])
    expect(deAssets.modulePreloads).not.toContain("/assets/en-EN1.js")
  })
})

describe("devAssetsFor", () => {
  it("includes the global ?direct CSS link on every route and route CSS only on Analytics", () => {
    for (const tag of routeTags) {
      const assets = Assets.devAssetsFor(tag)
      expect(assets.scripts).toEqual(["/src/main.ts"])
      if (tag === "Analytics") {
        expect(assets.stylesheets).toEqual(["/src/index.css?direct", "/src/analytics/components/chart.css?direct"])
      } else {
        expect(assets.stylesheets).toEqual(["/src/index.css?direct"])
      }
    }
  })

  it.layer(Helpers.browserEnv, { buildPerTest: true })("rendered in dev SSR <head>", (it) => {
    it.effect("places blocking stylesheet links in <head> before scripts and <body>", () =>
      Effect.gen(function* () {
        const warehouse = yield* Helpers.renderDocument("/warehouse", (route) => Assets.devAssetsFor(route._tag))
        const linkPos = warehouse.html.indexOf('<link rel="stylesheet" href="/src/index.css?direct">')
        const scriptPos = warehouse.html.indexOf('<script type="module" crossorigin src="/src/main.ts"></script>')
        const bodyPos = warehouse.html.indexOf("<body")
        expect(linkPos).toBeGreaterThan(-1)
        expect(linkPos).toBeLessThan(scriptPos)
        expect(linkPos).toBeLessThan(bodyPos)

        const analytics = yield* Helpers.renderDocument("/analytics", (route) => Assets.devAssetsFor(route._tag))
        expect(analytics.html).toContain('<link rel="stylesheet" href="/src/index.css?direct">')
        expect(analytics.html).toContain('<link rel="stylesheet" href="/src/analytics/components/chart.css?direct">')
      })
    )
  })
})

describe("DevStyles.removeSupersededDevStylesheets", () => {
  const docFromHead = (headHtml: string): Document =>
    new DOMParser().parseFromString(`<!doctype html><html><head>${headHtml}</head><body></body></html>`, "text/html")

  it("keeps SSR ?direct links untouched until Vite's matching <style data-vite-dev-id> exists", () => {
    const doc = docFromHead('<link rel="stylesheet" href="/src/index.css?direct">')
    expect(DevStyles.removeSupersededDevStylesheets(doc)).toBe(0)
    expect(doc.head.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(1)
  })

  it("removes only the ?direct links whose matching <style data-vite-dev-id> is mounted", () => {
    const doc = docFromHead(
      [
        '<link rel="stylesheet" href="/src/index.css?direct">',
        '<link rel="stylesheet" href="/src/analytics/components/chart.css?direct">',
        '<link rel="stylesheet" href="/assets/main-E1.css">',
        '<style type="text/css" data-vite-dev-id="/repo/src/index.css">body{}</style>'
      ].join("")
    )
    expect(DevStyles.removeSupersededDevStylesheets(doc)).toBe(1)
    const remaining = [...doc.head.querySelectorAll('link[rel="stylesheet"]')].map((el) => el.getAttribute("href"))
    expect(remaining).toEqual(["/src/analytics/components/chart.css?direct", "/assets/main-E1.css"])

    const chartStyle = doc.createElement("style")
    chartStyle.setAttribute("data-vite-dev-id", "C:\\repo\\src\\analytics\\components\\chart.css")
    doc.head.append(chartStyle)
    expect(DevStyles.removeSupersededDevStylesheets(doc)).toBe(1)
    const afterChart = [...doc.head.querySelectorAll('link[rel="stylesheet"]')].map((el) => el.getAttribute("href"))
    expect(afterChart).toEqual(["/assets/main-E1.css"])
  })
})
