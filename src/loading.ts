import type * as Component from "@effect/ui/Component"
import type { Html } from "@effect/ui/html"
import { ui } from "./design.ts"

/**
 * Counts how many times the page-loading fallback was produced. Production
 * code never reads it; the tests assert it stays 0 across a hydration.
 */
export const loadingStats = { rendered: 0 }

/** The fallback shown while a lazy page's chunk loads (or if it fails to). */
export const pageFallback =
  <M>(h: Html.H<M>) =>
  (result: Component.Lazy.Result) => {
    loadingStats.rendered += 1
    return h.p
      .attr("data-fallback", "loading")
      .class(`animate-pulse ${ui.muted}`)
      .children(result._tag === "Failure" ? "Couldn't load this page." : "Loading…")
  }
