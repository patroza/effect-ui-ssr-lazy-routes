import { describe, expect, it } from "vitest"
import * as Helpers from "./helpers.ts"

describe("SSR", () => {
  const cases = [
    { url: "/", status: 200, marker: "SENTINEL:home-page", statePath: "/App/HomePage[/]", title: "Home" },
    {
      url: "/products?q=mug",
      status: 200,
      marker: "SENTINEL:products-page",
      statePath: "/App/ProductsPage[/products]",
      title: "Products"
    },
    {
      url: "/products/42",
      status: 200,
      marker: "SENTINEL:product-detail-page",
      statePath: "/App/ProductDetailPage[/products/42]",
      title: "Field notebook"
    },
    {
      url: "/analytics",
      status: 200,
      marker: "SENTINEL:analytics-page",
      statePath: "/App/AnalyticsPage[/analytics]",
      title: "Analytics"
    }
  ] as const

  it.each(cases)(
    "renders full HTML and serialized state for $url",
    async ({ url, status, marker, statePath, title }) => {
      const server = await Helpers.serverRender(url)
      expect(server.status).toBe(status)
      // The page itself is in the HTML: not a loading placeholder.
      expect(server.appHtml).toContain(`data-page-chunk="${marker}"`)
      expect(server.appHtml).not.toContain("data-fallback")
      expect(new DOMParser().parseFromString(server.html, "text/html").title).toBe(`${title} · Effect UI lazy routes`)
      // The page's Model is serialized under its path, next to the root's.
      expect(Object.keys(server.state)).toContain(statePath)
      expect(Object.keys(server.state)).toContain("/App")
    }
  )

  it("renders the route's search into the page", async () => {
    const server = await Helpers.serverRender("/products?q=mug")
    expect(server.appHtml).toContain("Enamel camp mug")
    expect(server.appHtml).not.toContain("Linen apron")
    expect(server.appHtml).toContain('value="mug"')
  })

  it("renders the product for the :id param", async () => {
    const server = await Helpers.serverRender("/products/42")
    expect(server.appHtml).toContain("Field notebook")
    expect(server.appHtml).toContain("1 × $12.00 = $12.00")
  })

  it("renders the analytics chart (pure SVG helper) and its dataset", async () => {
    const server = await Helpers.serverRender("/analytics")
    expect(server.appHtml).toContain("data:image/svg+xml")
    expect(server.appHtml).toContain("Total Revenue (USD): 237500")
  })

  it("answers 404 with the NotFound page for an unknown URL", async () => {
    const server = await Helpers.serverRender("/definitely/not/here")
    expect(server.status).toBe(404)
    expect(server.appHtml).toContain('data-page-chunk="SENTINEL:not-found-page"')
    expect(server.appHtml).toContain("Page not found")
  })

  it("serializes the NotFound page's state under its own instance path", async () => {
    const server = await Helpers.serverRender("/definitely/not/here")
    expect(Object.keys(server.state)).toContain("/App")
    expect(Object.keys(server.state)).toContain("/App/NotFoundPage[/definitely/not/here]")
    expect(server.appHtml).toContain("Nothing lives at /definitely/not/here.")
    expect(server.appHtml).not.toContain("data-fallback")
  })

  it("answers 404 for an unknown product id, but still renders the page", async () => {
    const server = await Helpers.serverRender("/products/999")
    expect(server.status).toBe(404)
    expect(server.appHtml).toContain("Unknown product")
  })

  it("derives the status from what was rendered: a known product is 200, an unknown one 404", async () => {
    const known = await Helpers.serverRender("/products/42")
    const unknown = await Helpers.serverRender("/products/999")
    expect(known.status).toBe(200)
    expect(known.appHtml).not.toContain('data-http-status="404"')
    expect(unknown.status).toBe(404)
    expect(unknown.appHtml).toContain('data-http-status="404"')
  })

  it("answers 404 for a record that doesn't exist even when the id looks like markup", async () => {
    const server = await Helpers.serverRender("/products/%3Cb%20data-http-status=%22404%22%3E")
    expect(server.status).toBe(404)
    expect(server.appHtml).not.toContain("<b data-http-status")
  })
})

describe("renderPage outcomes", () => {
  const outcome = async (url: string) => (await Helpers.loadApp()).renderPage(url, () => Helpers.noAssets)

  it("answers a malformed percent escape with BadRequest instead of throwing", async () => {
    expect(await outcome("/%E0%A4%A")).toEqual({ _tag: "BadRequest", status: 400 })
    expect(await outcome("/products/%E0%A4%A")).toEqual({ _tag: "BadRequest", status: 400 })
  })

  it("redirects a non-canonical path permanently to the canonical one", async () => {
    expect(await outcome("/products/")).toEqual({ _tag: "Redirect", status: 301, location: "/products" })
  })

  it("redirects a URL with invalid search params temporarily, dropping them", async () => {
    expect(await outcome("/products?q=a&q=b")).toEqual({ _tag: "Redirect", status: 302, location: "/products" })
  })

  it("renders (no redirect) a canonical URL", async () => {
    expect((await outcome("/products?q=mug"))._tag).toBe("Page")
  })
})

describe("Status.renderedNotFound", () => {
  it("only trusts the marker on an element, never in text", async () => {
    const Status = await import("../src/lib/status.ts")
    expect(Status.renderedNotFound('<section class="x" data-http-status="404">')).toBe(true)
    expect(Status.renderedNotFound('<p>data-http-status="404"</p>')).toBe(false)
    expect(Status.renderedNotFound("<p>&lt;b data-http-status=&quot;404&quot;&gt;</p>")).toBe(false)
    expect(Status.renderedNotFound('<section data-http-status="200">')).toBe(false)
  })
})
