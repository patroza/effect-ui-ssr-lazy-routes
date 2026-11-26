import { Head, UiSchema } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { Schema } from "effect"
import * as Design from "../design.ts"
import * as Routes from "../routes.ts"

/** Marker proving which chunk this page lands in (see scripts/verify-bundles.ts). */
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
    h.section
      .attr("data-page-chunk", NOT_FOUND_PAGE_CHUNK)
      .class(Design.ui.stack)
      .children(
        h.h1.class(Design.ui.title).children("Page not found"),
        h.p.class(Design.ui.muted).children(`Nothing lives at ${h.props.path}.`),
        h.a.class(Design.ui.link).attr("href", Routes.AppRoute.print(Routes.AppRoute.Home())).children("Back home")
      )
})
