import { describe, expect, it } from "vitest"
import { type Manifest, renderAssetTags, resolveRouteAssets, routeSources } from "../src/assets.ts"
import type { AppRouteTag } from "../src/routes.ts"
import { loadApp } from "./helpers.ts"

const routeTags = ["Home", "Products", "ProductDetail", "Analytics", "NotFound"] as const satisfies ReadonlyArray<AppRouteTag>

// The shape of Vite's `.vite/manifest.json` for this app: every page imports the
// entry chunk (it shares the framework), and the two product pages also share a
// small catalog chunk.
const manifest: Manifest = {
  "src/client.ts": {
    file: "assets/client-E1.js",
    src: "src/client.ts",
    isEntry: true,
    css: ["assets/client-E1.css"],
    dynamicImports: Object.values(routeSources)
  },
  "_catalog-C1.js": { file: "assets/catalog-C1.js" },
  "src/pages/HomePage.ts": {
    file: "assets/HomePage-H1.js",
    isDynamicEntry: true,
    imports: ["src/client.ts"]
  },
  "src/pages/ProductsPage.ts": {
    file: "assets/ProductsPage-P1.js",
    isDynamicEntry: true,
    imports: ["src/client.ts", "_catalog-C1.js"]
  },
  "src/pages/ProductDetailPage.ts": {
    file: "assets/ProductDetailPage-D1.js",
    isDynamicEntry: true,
    imports: ["src/client.ts", "_catalog-C1.js"]
  },
  "src/pages/AnalyticsPage.ts": {
    file: "assets/AnalyticsPage-A1.js",
    isDynamicEntry: true,
    imports: ["src/client.ts"],
    css: ["assets/AnalyticsPage-A1.css"]
  },
  "src/pages/NotFoundPage.ts": {
    file: "assets/NotFoundPage-N1.js",
    isDynamicEntry: true,
    imports: ["src/client.ts"]
  }
}

describe("resolveRouteAssets", () => {
  it("preloads only the matched route's chunk (never another page's)", () => {
    expect(resolveRouteAssets(manifest, "Home").modulePreloads).toEqual(["/assets/HomePage-H1.js"])
    expect(resolveRouteAssets(manifest, "Analytics").modulePreloads).toEqual(["/assets/AnalyticsPage-A1.js"])
    expect(resolveRouteAssets(manifest, "NotFound").modulePreloads).toEqual(["/assets/NotFoundPage-N1.js"])
  })

  it("includes the transitive static imports of the route's chunk", () => {
    expect(resolveRouteAssets(manifest, "Products").modulePreloads).toEqual([
      "/assets/ProductsPage-P1.js",
      "/assets/catalog-C1.js"
    ])
    expect(resolveRouteAssets(manifest, "ProductDetail").modulePreloads).toEqual([
      "/assets/ProductDetailPage-D1.js",
      "/assets/catalog-C1.js"
    ])
  })

  it("follows imports transitively and survives cycles", () => {
    const chain: Manifest = {
      "src/client.ts": { file: "assets/e.js", isEntry: true },
      "src/pages/HomePage.ts": { file: "assets/h.js", imports: ["_a.js", "src/client.ts"] },
      "_a.js": { file: "assets/a.js", imports: ["_b.js"] },
      "_b.js": { file: "assets/b.js", imports: ["_a.js"] } // cycle
    }
    expect(resolveRouteAssets(chain, "Home").modulePreloads).toEqual(["/assets/h.js", "/assets/a.js", "/assets/b.js"])
  })

  it("loads the entry with a script tag, and never preloads it", () => {
    for (const tag of routeTags) {
      const assets = resolveRouteAssets(manifest, tag)
      expect(assets.scripts).toEqual(["/assets/client-E1.js"])
      expect(assets.modulePreloads).not.toContain("/assets/client-E1.js")
    }
  })

  it("adds the entry's CSS everywhere and a page's CSS only on that page", () => {
    expect(resolveRouteAssets(manifest, "Home").stylesheets).toEqual(["/assets/client-E1.css"])
    expect(resolveRouteAssets(manifest, "Analytics").stylesheets).toEqual([
      "/assets/client-E1.css",
      "/assets/AnalyticsPage-A1.css"
    ])
  })

  it("fails loudly when the manifest lacks a route's module", () => {
    const { "src/pages/HomePage.ts": _removed, ...incomplete } = manifest
    expect(() => resolveRouteAssets(incomplete, "Home")).toThrow(/src\/pages\/HomePage\.ts/)
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
    const app = await loadApp()
    const page = await app.renderPage(url, (route) => resolveRouteAssets(manifest, route._tag))
    expect(preloads(page.html)).toEqual(expected)
    // The entry is a module script in <head>, so it downloads in parallel with the preloads.
    expect(page.html).toContain('<script type="module" crossorigin src="/assets/client-E1.js"></script>')
    // Preloads and the entry precede the body: no entry -> page waterfall.
    expect(page.html.indexOf("modulepreload")).toBeLessThan(page.html.indexOf("<body"))
  })

  it("renderAssetTags escapes attribute values", () => {
    const tags = renderAssetTags({ scripts: [], modulePreloads: ['/a"b.js'], stylesheets: [] })
    expect(tags).toContain('href="/a&quot;b.js"')
  })
})
