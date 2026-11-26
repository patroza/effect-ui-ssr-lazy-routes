import { Router } from "@effect/ui"
import { HtmlServer } from "@effect/ui/html"
import { Effect, Option } from "effect"
import { App } from "./App.ts"
import { type PageAssets, renderAssetTags } from "./assets.ts"
import { findProduct } from "./data/products.ts"
import { AppRoute, type AppRouteValue } from "./routes.ts"

export interface RenderedPage {
  readonly status: number
  readonly html: string
  readonly route: AppRouteValue
}

/** Resolves the URL with the same route union the client uses. `/*` makes it total. */
export const routeOf = (url: string): AppRouteValue =>
  Option.getOrThrowWith(AppRoute.parse(url), () => new Error(`Unparseable URL: ${url}`))

const statusOf = (route: AppRouteValue): number => {
  switch (route._tag) {
    case "NotFound":
      return 404
    case "ProductDetail":
      return findProduct(route.params.id) === undefined ? 404 : 200
    default:
      return 200
  }
}

/**
 * Server-renders one URL.
 *
 * `HtmlServer.renderToHtml` runs `init`/`update`/`view` of `App` for the route
 * the static Router reports. `Component.lazy` pages are awaited, so the HTML
 * contains the whole page. `serializeState` is what the client adopts.
 *
 * `assetsFor` is called with the matched route, so the document can preload
 * exactly that route's chunks.
 */
export const renderPage = async (
  url: string,
  assetsFor: (route: AppRouteValue) => PageAssets
): Promise<RenderedPage> => {
  const route = routeOf(url)
  const page = await Effect.runPromise(
    HtmlServer.renderToHtml(App, Router.props(AppRoute), { budget: "1 second" }).pipe(
      Effect.provide(Router.static({ routes: AppRoute, url }))
    )
  )
  const html = `<!doctype html>
<html ${page.htmlAttributes}>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    ${page.head}
    ${renderAssetTags(assetsFor(route))}
  </head>
  <body ${page.bodyAttributes}>
    <div id="app">${page.html}</div>
    <script type="application/json" id="state">${HtmlServer.serializeState(page.state)}</script>
  </body>
</html>
`
  return { status: statusOf(route), html, route }
}
