import { Option } from "effect"
import { prefetchRoute } from "./pages.ts"
import { AppRoute } from "./routes.ts"

/**
 * Prefetch a route's chunk when the pointer enters, or keyboard focus lands
 * on, an internal link. Delegated on the document, so it covers links the app
 * renders later. It only warms the module cache; it never changes what renders.
 */
export const installLinkPrefetch = (doc: Document): (() => void) => {
  const onIntent = (event: Event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest("a[href]")
    if (anchor === null) return
    const url = new URL(anchor.getAttribute("href") ?? "", doc.location.href)
    if (url.origin !== doc.location.origin) return
    const route = AppRoute.parse(url.pathname + url.search)
    if (Option.isSome(route)) void prefetchRoute(route.value)
  }
  doc.addEventListener("pointerover", onIntent)
  doc.addEventListener("focusin", onIntent)
  return () => {
    doc.removeEventListener("pointerover", onIntent)
    doc.removeEventListener("focusin", onIntent)
  }
}

/**
 * A failed dynamic import (typically a stale chunk after a deploy) can be
 * cached by the browser's module map and fail every later load. Reload once.
 * https://vite.dev/guide/build#load-error-handling
 */
export const installPreloadErrorReload = (win: Window): (() => void) => {
  const onError = (event: Event) => {
    event.preventDefault()
    const key = "effect-ui-ssr-lazy-routes:reloaded-at"
    try {
      const last = Number(win.sessionStorage.getItem(key) ?? 0)
      if (Date.now() - last < 10_000) return // avoid a reload loop
      win.sessionStorage.setItem(key, String(Date.now()))
    } catch {
      // sessionStorage unavailable: reload anyway, once per event
    }
    win.location.reload()
  }
  win.addEventListener("vite:preloadError", onError)
  return () => win.removeEventListener("vite:preloadError", onError)
}
