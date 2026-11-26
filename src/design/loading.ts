import type { Component } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import * as Design from "./classes.ts"

/**
 * The fallback shown while a lazy page's chunk loads (or if it fails to). The
 * `data-fallback` attribute is what the tests look for (in the DOM and in an
 * `ssr` frame) to prove it never shows during hydration.
 */
export const pageFallback =
  <M>(h: Html.H<M>) =>
  (result: Component.Lazy.Result) =>
    h.p
      .attr("data-fallback", "loading")
      .class(`animate-pulse ${Design.ui.muted}`)
      .children(result._tag === "Failure" ? "Couldn't load this page." : "Loading…")
