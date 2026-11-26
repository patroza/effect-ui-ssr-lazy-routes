import { Head, UiSchema } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { Schema } from "effect"
import { AppRoute } from "../routes.ts"

/** Marker proving which chunk this page lands in (see scripts/verify-bundles.mjs). */
export const HOME_PAGE_CHUNK = "SENTINEL:home-page"

export const HomePageMessage = UiSchema.TaggedEnum({
  ClickedCounter: {}
})

export const HomePage = Html.component({
  name: "HomePage",
  model: Schema.Struct({ clicks: Schema.Number }),
  message: HomePageMessage
}).make({
  init: () => ({ clicks: 0 }),
  update: ($, message) =>
    HomePageMessage.match(message, {
      ClickedCounter: () => $.evolve({ clicks: (n) => n + 1 })
    }),
  head: () => [Head.title("Home")],
  view: (h, model) =>
    h.section.attr("data-page-chunk", HOME_PAGE_CHUNK).children(
      h.h1("Home"),
      h.p("Server-rendered, hydrated without a loading flash, and split per route."),
      h.p.children(
        h.a.attr("href", AppRoute.print(AppRoute.Products({ search: {} }))).children("Browse products"),
        " · ",
        h.a.attr("href", AppRoute.print(AppRoute.Analytics())).children("See analytics")
      ),
      h.button
        .attr("type", "button")
        .attr("data-testid", "home-counter")
        .on("click", HomePageMessage.ClickedCounter())
        .children(`Clicked ${model.clicks} times`)
    )
})
