import { Head, UiSchema } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { Schema } from "effect"
import { ui } from "../design.ts"
import { AppRoute } from "../routes.ts"

/** Marker proving which chunk this page lands in (see scripts/verify-bundles.mjs). */
export const NOT_FOUND_PAGE_CHUNK = "SENTINEL:not-found-page"

// `NotFoundPage` has no interaction of its own, so it takes the empty message.
export const NotFoundPage = Html.component({
  name: "NotFoundPage",
  props: Schema.Struct({ path: Schema.String }),
  model: Schema.Struct({}),
  message: UiSchema.TaggedEnum({})
}).make({
  init: () => ({}),
  update: ($) => $.model,
  head: () => [Head.title("Page not found")],
  view: (h) =>
    h.section.attr("data-page-chunk", NOT_FOUND_PAGE_CHUNK).class(ui.stack).children(
      h.h1.class(ui.title).children("Page not found"),
      h.p.class(ui.muted).children(`Nothing lives at ${h.props.path}.`),
      h.a.class(ui.link).attr("href", AppRoute.print(AppRoute.Home())).children("Back home")
    )
})
