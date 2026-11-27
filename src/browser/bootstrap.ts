import { type Renderer, Router } from "@effect/ui"
import { BrowserHost, HtmlHydrate } from "@effect/ui/html"
import { Effect, Option } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import * as App from "../App.ts"
import * as I18n from "../i18n/I18n.ts"
import * as Pages from "../pages.ts"
import * as Routes from "../routes.ts"
import * as Prefetch from "./prefetch.ts"

export interface BootOptions {
  /** The element the server rendered into (`#app`). */
  readonly container: Element
  /** `pathname + search` of the document, parsed with the same route union as the server. */
  readonly location: string
  /** The server's serialized state (`#state`), or `undefined` when nothing was server-rendered. */
  readonly state: Renderer.State | undefined
  /** The matched `{ app, pages }` bundle to preload and mount. Defaults to `App.productionApp`. */
  readonly bundle?: App.AppBundle | undefined
  /** Active locale resolved from `<html lang>` (defaults to `"en"`). */
  readonly locale?: I18n.AppLocale | undefined
}

/**
 * Boots the app in the browser, inside the caller's scope:
 *
 * 1. resolve the URL with the same route union the server used,
 * 2. await `preloadRoute` AND `I18n.preloadLocale` in parallel before hydrating,
 * 3. install the `vite:preloadError` reload guard and the link prefetch,
 * 4. hydrate the server DOM + state (or mount fresh if there is none).
 */
export const boot = Effect.fn("boot")(function* (options: BootOptions) {
  const bundle = options.bundle ?? App.productionApp
  const locale = options.locale ?? "en"
  const route = Routes.routeOf(options.location)
  yield* Effect.promise(() =>
    Promise.all([
      Option.isSome(route) ? Pages.preloadRoute(route.value, bundle.pages) : Promise.resolve(),
      I18n.preloadLocale(locale)
    ])
  )

  // After the initial preload, so a failed first load surfaces as itself.
  const doc = options.container.ownerDocument
  const win = doc.defaultView
  if (win !== null) yield* Prefetch.installPreloadErrorReload(win)
  yield* Prefetch.installLinkPrefetch(doc, bundle.pages)

  const bcp47 = I18n.configForLocale(locale).bcp47
  const props = Effect.map(Router.props(Routes.AppRoute), (base) => ({ ...base, locale }))
  const mountOrHydrate =
    options.state === undefined
      ? BrowserHost.mountEffect(bundle.app, props, options.container)
      : HtmlHydrate.hydrateEffect(bundle.app, props, options.container, options.state)
  const root = yield* mountOrHydrate.pipe(
    Effect.updateService(
      HttpClient.HttpClient,
      HttpClient.mapRequest(HttpClientRequest.setHeader("accept-language", bcp47))
    )
  )

  // Completes once every instance that adopts server state is live.
  yield* root.adopted
  return root
})
