import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Status from "../src/lib/status.ts"
import * as Helpers from "./helpers.ts"

describe("SSR with Ssr.ssr: render on the server, hydrate in a fresh document, and check the two agree", () => {
  const cases = [
    { url: "/", marker: "SENTINEL:home-page", statePath: "/App/HomePage[/]", title: "Home" },
    {
      url: "/products?q=mug",
      marker: "SENTINEL:products-page",
      statePath: "/App/ProductsPage[/products]",
      title: "Products"
    },
    {
      url: "/products/42",
      marker: "SENTINEL:product-detail-page",
      statePath: "/App/ProductDetailPage[/products/42]",
      title: "Field notebook"
    },
    {
      url: "/analytics",
      marker: "SENTINEL:analytics-page",
      statePath: "/App/AnalyticsPage[/analytics]",
      title: "Analytics"
    }
  ] as const

  for (const { marker, statePath, title, url } of cases) {
    it.effect(`renders full HTML and serialized state for ${url}, and the client adopts all of it`, () =>
      Effect.gen(function* () {
        const { result } = yield* Helpers.ssrAt(url)
        // The page itself is in the HTML: not a loading placeholder.
        expect(result.html).toContain(`data-page-chunk="${marker}"`)
        expect(result.html).not.toContain("data-fallback")
        expect(result.document.title).toBe(`${title} · Effect UI lazy routes`)
        // The page's Model is serialized under its path, next to the root's.
        expect(Object.keys(result.state)).toContain(statePath)
        expect(Object.keys(result.state)).toContain("/App")
        expect(result.adopted).toContain(statePath)
        // Zero-flash: the client never showed the fallback, and fetched nothing the server had shipped.
        expect(result.root.frames()).toEqual(["page"])
        expect(result.root.fetches()).toEqual([])
        expect(result.misses).toEqual([])
      }).pipe(Effect.provide(Helpers.appAt(url)))
    )
  }

  it.effect("renders the route's search into the page", () =>
    Effect.gen(function* () {
      const { result } = yield* Helpers.ssrAt("/products?q=mug")
      expect(result.html).toContain("Enamel camp mug")
      expect(result.html).not.toContain("Linen apron")
      expect(result.html).toContain('value="mug"')
      // The hydrated input shows the same search.
      expect(Helpers.inputValue(Helpers.byTestId(result.container, "products-search"))).toBe("mug")
    }).pipe(Effect.provide(Helpers.appAt("/products?q=mug")))
  )

  it.effect("renders the product for the :id param", () =>
    Effect.gen(function* () {
      const { result } = yield* Helpers.ssrAt("/products/42")
      expect(result.html).toContain("Field notebook")
      expect(result.html).toContain("1 × $12.00 = $12.00")
    }).pipe(Effect.provide(Helpers.appAt("/products/42")))
  )

  it.effect("renders the analytics chart (pure SVG helper) and its dataset", () =>
    Effect.gen(function* () {
      const { result } = yield* Helpers.ssrAt("/analytics")
      expect(result.html).toContain("data:image/svg+xml")
      expect(result.html).toContain("Total Revenue (USD): 237500")
    }).pipe(Effect.provide(Helpers.appAt("/analytics")))
  )

  it.effect("renders the NotFound page for an unknown URL and serializes its state under its own path", () =>
    Effect.gen(function* () {
      const { result } = yield* Helpers.ssrAt("/definitely/not/here")
      expect(result.html).toContain('data-page-chunk="SENTINEL:not-found-page"')
      expect(result.html).toContain("Page not found")
      expect(Object.keys(result.state)).toContain("/App")
      expect(Object.keys(result.state)).toContain("/App/NotFoundPage[/definitely/not/here]")
      expect(result.html).toContain("Nothing lives at /definitely/not/here.")
      expect(result.html).not.toContain("data-fallback")
    }).pipe(Effect.provide(Helpers.appAt("/definitely/not/here")))
  )
})

describe("the status the server answers with", () => {
  it.layer(Helpers.browserEnv, { buildPerTest: true })("on the server", (it) => {
    it.effect("answers 200 for a page that renders", () =>
      Effect.gen(function* () {
        for (const url of ["/", "/products?q=mug", "/products/42", "/analytics"]) {
          expect((yield* Helpers.serverRender(url)).status, url).toBe(200)
        }
      })
    )

    it.effect("answers 404 with the NotFound page for an unknown URL", () =>
      Effect.gen(function* () {
        const server = yield* Helpers.serverRender("/definitely/not/here")
        expect(server.status).toBe(404)
        expect(server.appHtml).toContain('data-page-chunk="SENTINEL:not-found-page"')
        expect(server.appHtml).toContain("Page not found")
      })
    )

    it.effect("answers 404 for an unknown product id, but still renders the page", () =>
      Effect.gen(function* () {
        const server = yield* Helpers.serverRender("/products/999")
        expect(server.status).toBe(404)
        expect(server.appHtml).toContain("Unknown product")
      })
    )

    it.effect("derives the status from what was rendered: a known product is 200, an unknown one 404", () =>
      Effect.gen(function* () {
        const known = yield* Helpers.serverRender("/products/42")
        const unknown = yield* Helpers.serverRender("/products/999")
        expect(known.status).toBe(200)
        expect(known.appHtml).not.toContain('data-http-status="404"')
        expect(unknown.status).toBe(404)
        expect(unknown.appHtml).toContain('data-http-status="404"')
      })
    )

    it.effect("answers 404 for a record that doesn't exist even when the id looks like markup", () =>
      Effect.gen(function* () {
        const server = yield* Helpers.serverRender("/products/%3Cb%20data-http-status=%22404%22%3E")
        expect(server.status).toBe(404)
        expect(server.appHtml).not.toContain("<b data-http-status")
      })
    )
  })
})

describe("renderPage outcomes", () => {
  it.layer(Helpers.browserEnv, { buildPerTest: true })("on the server", (it) => {
    it.effect("answers a malformed percent escape with BadRequest instead of throwing", () =>
      Effect.gen(function* () {
        expect(yield* Helpers.renderOutcome("/%E0%A4%A")).toEqual({ _tag: "BadRequest", status: 400 })
        expect(yield* Helpers.renderOutcome("/products/%E0%A4%A")).toEqual({ _tag: "BadRequest", status: 400 })
      })
    )

    it.effect("redirects a non-canonical path permanently to the canonical one", () =>
      Effect.gen(function* () {
        expect(yield* Helpers.renderOutcome("/products/")).toEqual({
          _tag: "Redirect",
          status: 301,
          location: "/products"
        })
      })
    )

    it.effect("redirects a URL with invalid search params temporarily, dropping them", () =>
      Effect.gen(function* () {
        expect(yield* Helpers.renderOutcome("/products?q=a&q=b")).toEqual({
          _tag: "Redirect",
          status: 302,
          location: "/products"
        })
      })
    )

    it.effect("renders (no redirect) a canonical URL", () =>
      Effect.gen(function* () {
        expect((yield* Helpers.renderOutcome("/products?q=mug"))._tag).toBe("Page")
      })
    )
  })
})

describe("Status.renderedNotFound", () => {
  it("only trusts the marker on an element, never in text", () => {
    expect(Status.renderedNotFound('<section class="x" data-http-status="404">')).toBe(true)
    expect(Status.renderedNotFound('<p>data-http-status="404"</p>')).toBe(false)
    expect(Status.renderedNotFound("<p>&lt;b data-http-status=&quot;404&quot;&gt;</p>")).toBe(false)
    expect(Status.renderedNotFound('<section data-http-status="200">')).toBe(false)
  })
})
