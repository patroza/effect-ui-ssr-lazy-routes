import { Router } from "@effect/ui"
import { HtmlServer } from "@effect/ui/html"
import { Effect, Option } from "effect"
import * as App from "../App.ts"
import * as Assets from "./assets.ts"
import * as Routes from "../routes.ts"
import * as Status from "../lib/status.ts"

/** A rendered document and the status the render itself implies. */
export interface RenderedPage {
  readonly _tag: "Page"
  readonly status: number
  readonly html: string
  readonly route: Routes.AppRouteValue
}

/**
 * The URL isn't the canonical spelling of its route: a trailing slash (`301`,
 * permanent), or search params dropped as invalid such as a repeated `?q=a&q=b`
 * (`302`, since the same URL may be valid later). Same rule as `HtmlServerHttp`.
 */
export interface RenderedRedirect {
  readonly _tag: "Redirect"
  readonly status: 301 | 302
  readonly location: string
}

/** The URL can't be decoded at all (a malformed `%` escape): the client's fault, not a missing page. */
export interface RenderedBadRequest {
  readonly _tag: "BadRequest"
  readonly status: 400
}

export interface RenderOptions {
  /** The root to render. Defaults to the production `App`; a test passes one built over its own `pages`. */
  readonly app?: App.AppComponent | undefined
}

export type RenderOutcome = RenderedPage | RenderedRedirect | RenderedBadRequest

/**
 * Server-renders one URL.
 *
 * `AppRoute.resolve` decides first, like `HtmlServerHttp.layerHttp` does: an
 * undecodable URL is `BadRequest`, a non-canonical one a `Redirect`.
 * Otherwise `HtmlServer.renderToHtml` runs `init`/`update`/`view` of `App` for
 * the route the static Router reports. `Component.lazy` pages are awaited, so
 * the HTML contains the whole page. `serializeState` is what the client adopts.
 * The status is 404 for the catch-all route (`resolved.notFound`) or when the
 * rendered page says its record is missing.
 *
 * `assetsFor` is called with the matched route, so the document can preload
 * exactly that route's chunks.
 *
 * This is the Effect: it runs on whatever Clock it is given, so a test drives
 * it with `TestClock`. `renderPage` below is what the HTTP handler awaits.
 */
export const renderPageEffect = Effect.fn("renderPage")(function* (
  url: string,
  assetsFor: (route: Routes.AppRouteValue) => Assets.PageAssets,
  options: RenderOptions = {}
) {
  const resolved = Routes.AppRoute.resolve(url)
  if (Option.isNone(resolved)) return { _tag: "BadRequest", status: 400 } satisfies RenderOutcome
  const { invalid, notFound, redirected, route } = resolved.value
  if (redirected || invalid.length > 0) {
    return {
      _tag: "Redirect",
      status: invalid.length > 0 ? 302 : 301,
      location: Routes.AppRoute.print(route)
    } satisfies RenderOutcome
  }

  const page = yield* HtmlServer.renderToHtml(options.app ?? App.App, Router.props(Routes.AppRoute), {
    budget: "1 second"
  }).pipe(Effect.provide(Router.static({ routes: Routes.AppRoute, url })))
  const html = `<!doctype html>
<html ${page.htmlAttributes}>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    ${page.head}
    ${Assets.renderAssetTags(assetsFor(route))}
  </head>
  <body ${page.bodyAttributes}>
    <div id="app">${page.html}</div>
    <script type="application/json" id="state">${HtmlServer.serializeState(page.state)}</script>
  </body>
</html>
`
  return {
    _tag: "Page",
    status: notFound || Status.renderedNotFound(page.html) ? 404 : 200,
    html,
    route
  } satisfies RenderOutcome
})

/** `renderPageEffect` on the real clock, for the HTTP handler. */
export const renderPage = (
  url: string,
  assetsFor: (route: Routes.AppRouteValue) => Assets.PageAssets,
  options: RenderOptions = {}
): Promise<RenderOutcome> => Effect.runPromise(renderPageEffect(url, assetsFor, options))
