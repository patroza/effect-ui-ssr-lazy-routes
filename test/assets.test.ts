import { describe, expect, it } from "vitest"
import * as Assets from "../src/server/assets.ts"
import type * as Routes from "../src/routes.ts"
import * as Helpers from "./helpers.ts"

const routeTags = [
  "Home",
  "Products",
  "ProductDetail",
  "Analytics",
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

  it("fails loudly when the manifest lacks a route's module", () => {
    const { "src/pages/HomePage.ts": _removed, ...incomplete } = manifest
    expect(() => Assets.resolveRouteAssets(incomplete, "Home")).toThrow(/src\/pages\/HomePage\.ts/)
  })
})

describe("document head", () => {
  const preloads = (html: string): ReadonlyArray<string> =>
    [...html.matchAll(/<link rel="modulepreload"[^>]*href="([^"]+)"/g)].map((match) => match[1] ?? "")

  it.each([
    { url: "/", expected: ["/assets/HomePage-H1.js"] },
    { url: "/products?q=mug", expected: ["/assets/ProductsPage-P1.js", "/assets/catalog-C1.js"] },
    { url: "/products/42", expected: ["/assets/ProductDetailPage-D1.js", "/assets/catalog-C1.js"] },
    { url: "/analytics", expected: ["/assets/AnalyticsPage-A1.js"] },
    { url: "/nope", expected: ["/assets/NotFoundPage-N1.js"] }
  ])("server HTML for $url preloads exactly the active route's chunks", async ({ url, expected }) => {
    const app = await Helpers.loadApp()
    const page = await Helpers.renderDocument(app, url, (route) => Assets.resolveRouteAssets(manifest, route._tag))
    expect(preloads(page.html)).toEqual(expected)
    // The entry is a module script in <head>, so it downloads in parallel with the preloads.
    expect(page.html).toContain('<script type="module" crossorigin src="/assets/main-E1.js"></script>')
    // Preloads and the entry precede the body: no entry -> page waterfall.
    expect(page.html.indexOf("modulepreload")).toBeLessThan(page.html.indexOf("<body"))
  })

  it("renderAssetTags escapes attribute values", () => {
    const tags = Assets.renderAssetTags({ scripts: [], modulePreloads: ['/a"b.js'], stylesheets: [] })
    expect(tags).toContain('href="/a&quot;b.js"')
  })
})
