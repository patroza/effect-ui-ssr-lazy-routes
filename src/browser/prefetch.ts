import { Effect, Option } from "effect"
import * as Pages from "../pages.ts"
import * as Routes from "../routes.ts"

/**
 * Preload a route's chunk when the pointer enters, or keyboard focus lands
 * on, an internal link. Delegated on the document, so it covers links the app
 * renders later. It calls the same `preloadRoute` as the initial boot (the
 * native `Component.lazy(...).preload()`), so it only warms the module cache
 * and never changes what renders. The listeners go away when the scope closes.
 */
export const installLinkPrefetch = (doc: Document) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const onIntent = (event: Event) => {
        const target = event.target
        if (!(target instanceof Element)) return
        const anchor = target.closest("a[href]")
        if (anchor === null) return
        // Links the router leaves to the browser (new tab, download) aren't navigations.
        if (anchor.hasAttribute("target") || anchor.hasAttribute("download")) return
        const href = anchor.getAttribute("href") ?? ""
        if (!URL.canParse(href, doc.location.href)) return
        const url = new URL(href, doc.location.href)
        if (url.origin !== doc.location.origin) return
        const route = Routes.routeOf(url.pathname + url.search)
        if (Option.isSome(route)) void Pages.preloadRoute(route.value)
      }
      doc.addEventListener("pointerover", onIntent)
      doc.addEventListener("focusin", onIntent)
      return onIntent
    }),
    (onIntent) =>
      Effect.sync(() => {
        doc.removeEventListener("pointerover", onIntent)
        doc.removeEventListener("focusin", onIntent)
      })
  ).pipe(Effect.asVoid)

/** The slice of `Window` the reload guard needs (so tests can pass a double). */
export interface ReloadTarget {
  readonly addEventListener: Window["addEventListener"]
  readonly removeEventListener: Window["removeEventListener"]
  readonly sessionStorage: Pick<Storage, "getItem" | "setItem">
  readonly location: Pick<Location, "reload">
}

const reloadedAtKey = "effect-ui-ssr-lazy-routes:reloaded-at"
const reloadLoopWindowMs = 10_000

/**
 * A failed dynamic import (typically a stale chunk after a deploy) can be
 * cached by the browser's module map and fail every later load. Reload once.
 * https://vite.dev/guide/build#load-error-handling
 *
 * `preventDefault()` runs only when this actually reloads. When the reload is
 * skipped (one already happened in the last 10 s), the event is left alone so
 * Vite rethrows the real chunk error instead of hiding it.
 */
export const installPreloadErrorReload = (win: ReloadTarget) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const onError = (event: Event) => {
        try {
          const last = Number(win.sessionStorage.getItem(reloadedAtKey) ?? 0)
          if (Date.now() - last < reloadLoopWindowMs) return // avoid a reload loop
          win.sessionStorage.setItem(reloadedAtKey, String(Date.now()))
        } catch {
          // sessionStorage unavailable: reload anyway, once per event
        }
        event.preventDefault()
        win.location.reload()
      }
      win.addEventListener("vite:preloadError", onError)
      return onError
    }),
    (onError) => Effect.sync(() => win.removeEventListener("vite:preloadError", onError))
  ).pipe(Effect.asVoid)
