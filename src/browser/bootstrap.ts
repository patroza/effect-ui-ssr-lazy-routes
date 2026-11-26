import { type Renderer, Router } from "@effect/ui"
import { BrowserHost, HtmlHydrate } from "@effect/ui/html"
import { Effect, Option } from "effect"
import * as App from "../App.ts"
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
}

/**
 * Boots the app in the browser, inside the caller's scope:
 *
 * 1. resolve the URL with the same route union the server used,
 * 2. await `preloadRoute` for the matched route: the native
 *    `Component.lazy(...).preload()` of its page,
 * 3. install the `vite:preloadError` reload guard and the link prefetch (both
 *    released with the scope),
 * 4. hydrate the server DOM + state (or mount fresh if there is none).
 *
 * Step 2 must come before step 4: the lazy child then hydrates like a direct
 * one (same DOM nodes, Model and `~query` entries, no fallback).
 *
 * Provide the Router layer (`BrowserRouter.layer(...)` in the browser,
 * `Router.memory(...)` in tests) AROUND the scope that keeps the app alive (as
 * `src/main.ts` does), never inside `boot`: the Router layer owns the
 * document's click listeners and removes them when the layer closes.
 */
export const boot = Effect.fn("boot")(function* (options: BootOptions) {
  const bundle = options.bundle ?? App.productionApp
  // `/*` is a catch-all, so the server only serves URLs that resolve; an undecodable one has no page to preload.
  const route = Routes.routeOf(options.location)
  if (Option.isSome(route)) yield* Effect.promise(() => Pages.preloadRoute(route.value, bundle.pages))

  // After the initial preload, so a failed first load surfaces as itself.
  const doc = options.container.ownerDocument
  const win = doc.defaultView
  if (win !== null) yield* Prefetch.installPreloadErrorReload(win)
  yield* Prefetch.installLinkPrefetch(doc, bundle.pages)

  const root =
    options.state === undefined
      ? yield* BrowserHost.mountEffect(bundle.app, Router.props(Routes.AppRoute), options.container)
      : yield* HtmlHydrate.hydrateEffect(bundle.app, Router.props(Routes.AppRoute), options.container, options.state)

  // Completes once every instance that adopts server state is live.
  yield* root.adopted
  return root
})
