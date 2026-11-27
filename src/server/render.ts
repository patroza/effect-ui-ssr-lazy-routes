import { Router } from "@effect/ui"
import { HtmlServer } from "@effect/ui/html"
import { Effect, Option } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import * as App from "../App.ts"
import * as I18n from "../i18n/I18n.ts"
import * as Status from "../lib/status.ts"
import * as Routes from "../routes.ts"
import * as Assets from "./assets.ts"

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
  /** Active SSR locale (defaults to `"en"`). */
  readonly locale?: I18n.AppLocale | undefined
}

export type RenderOutcome = RenderedPage | RenderedRedirect | RenderedBadRequest

/** Only same-origin path-relative targets (never protocol-relative `//host` or `/\host`). */
export const isSafeRelativeLocation = (location: string): boolean =>
  location.startsWith("/") && !location.startsWith("//") && !location.startsWith("/\\")

/**
 * Server-renders one URL in the requested locale.
 */
export const renderPageEffect = Effect.fn("renderPage")(function* (
  url: string,
  assetsFor: (route: Routes.AppRouteValue, locale: I18n.AppLocale) => Assets.PageAssets,
  options: RenderOptions = {}
) {
  const locale = options.locale ?? "en"
  const resolved = Routes.AppRoute.resolve(url)
  if (Option.isNone(resolved)) return { _tag: "BadRequest", status: 400 } satisfies RenderOutcome
  const { invalid, notFound, redirected, route } = resolved.value
  if (redirected || invalid.length > 0) {
    const location = Routes.AppRoute.print(route)
    if (!isSafeRelativeLocation(location)) return { _tag: "BadRequest", status: 400 } satisfies RenderOutcome
    return {
      _tag: "Redirect",
      status: invalid.length > 0 ? 302 : 301,
      location
    } satisfies RenderOutcome
  }

  yield* Effect.promise(() => I18n.preloadLocale(locale))
  const bcp47 = I18n.configForLocale(locale).bcp47
  const page = yield* HtmlServer.renderToHtml(
    options.app ?? App.App,
    Effect.map(Router.props(Routes.AppRoute), (props) => ({ ...props, locale })),
    { budget: "1 second" }
  ).pipe(
    Effect.updateService(
      HttpClient.HttpClient,
      HttpClient.mapRequest(HttpClientRequest.setHeader("accept-language", bcp47))
    ),
    Effect.provide(Router.static({ routes: Routes.AppRoute, url }))
  )
  const html = `<!doctype html>
<html ${page.htmlAttributes}>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    ${page.head}
    ${Assets.renderAssetTags(assetsFor(route, locale))}
  </head>
  <body ${page.bodyAttributes}>
    <div id="app">${page.html}</div>
    <script type="application/json" id="state">${HtmlServer.serializeState(page.state)}</script>
  </body>
</html>
`

  return {
    _tag: "Page",
    status: notFound ? 404 : (Status.renderedHttpStatus(page.html) ?? 200),
    html,
    route
  } satisfies RenderOutcome
})
