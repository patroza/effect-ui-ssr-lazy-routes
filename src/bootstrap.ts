import { Router } from "@effect/ui"
import type { Renderer } from "@effect/ui"
import { BrowserHost, HtmlHydrate } from "@effect/ui/html"
import { Effect, Layer, Option } from "effect"
import { FetchHttpClient } from "effect/http"
import { App } from "./App.ts"
import { preloadRoute } from "./pages.ts"
import { installLinkPrefetch, installPreloadErrorReload } from "./prefetch.ts"
import { AppRoute, type AppRouteValue } from "./routes.ts"

export interface BootOptions {
  /** The element the server rendered into (`#app`). */
  readonly container: Element
  /** `pathname + search` of the document, parsed with the same route union as the server. */
  readonly location: string
  /** The server's serialized state (`#state`), or `undefined` when nothing was server-rendered. */
  readonly state: Renderer.State | undefined
}

export const parseLocation = (location: string): AppRouteValue =>
  // `/*` is a catch-all, so every URL parses to some route.
  Option.getOrThrowWith(AppRoute.parse(location), () => new Error(`Unparseable URL: ${location}`))

/**
 * The platform services the app needs: a Router (`BrowserRouter.layer(...)` in
 * the browser, `Router.memory(...)` in tests) and an HTTP client.
 *
 * Provide this layer AROUND the scope that keeps the app alive (as
 * `src/client.ts` does), never inside `boot`: the Router layer owns the
 * document's click listeners and removes them when the layer closes.
 */
export const platformLayer = (router: Layer.Layer<Router.Services>) => Layer.mergeAll(router, FetchHttpClient.layer)

/**
 * Boots the app in the browser, inside the caller's scope:
 *
 * 1. parse the URL with the same route union the server used,
 * 2. await `preloadRoute` for the matched route: the native
 *    `Component.lazy(...).preload()` of its page,
 * 3. install the `vite:preloadError` reload guard and the link prefetch (both
 *    released with the scope),
 * 4. hydrate the server DOM + state (or mount fresh if there is none).
 *
 * Step 2 must come before step 4: the lazy child then hydrates like a direct
 * one (same DOM nodes, Model and `~query` entries, no fallback).
 */
export const boot = Effect.fn("boot")(function*(options: BootOptions) {
  const route = parseLocation(options.location)
  yield* Effect.promise(() => preloadRoute(route))

  // After the initial preload, so a failed first load surfaces as itself.
  const doc = options.container.ownerDocument
  const win = doc.defaultView
  if (win !== null) yield* installPreloadErrorReload(win)
  yield* installLinkPrefetch(doc)

  const root = options.state === undefined
    ? yield* BrowserHost.mountEffect(App, Router.props(AppRoute), options.container)
    : yield* HtmlHydrate.hydrateEffect(App, Router.props(AppRoute), options.container, options.state)

  // Completes once every instance that adopts server state is live.
  yield* root.adopted
  return root
})
