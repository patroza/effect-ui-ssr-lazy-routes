import { Head, UiSchema } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { Button } from "@effect/ui-kit"
import { Schema } from "effect"
import * as Design from "../design/classes.ts"
import * as Routes from "../routes.ts"

/** Marker proving which chunk this page lands in (see scripts/verify-bundles.ts). */
export const HOME_PAGE_CHUNK = "SENTINEL:home-page"

export const HomePageMessage = UiSchema.TaggedEnum({
  ClickedCounter: {}
})

export const HomePage = Html.component({
  name: "HomePage",
  model: Schema.Struct({ clicks: Schema.Finite }),
  message: HomePageMessage
}).make({
  init: () => ({ clicks: 0 }),
  update: ($, message) =>
    HomePageMessage.match(message, {
      ClickedCounter: () => $.evolve({ clicks: (n) => n + 1 })
    }),
  head: () => [Head.title("Home")],
  view: (h, model) =>
    h.section
      .attr("data-page-chunk", HOME_PAGE_CHUNK)
      .class(Design.ui.stack)
      .children(
        h.h1.class(Design.ui.title).children("Home"),
        h.p.class(Design.ui.muted).children("Server-rendered, hydrated without a loading flash, and split per route."),
        h.p.class(Design.ui.row).children(
          h.a
            .class(Design.ui.link)
            .attr("href", Routes.AppRoute.print(Routes.AppRoute.Products({ search: {} })))
            .children("Browse products"),
          h.span.class(Design.ui.muted).children("·"),
          h.a
            .class(Design.ui.link)
            .attr("href", Routes.AppRoute.print(Routes.AppRoute.Analytics()))
            .children("See analytics"),
          h.span.class(Design.ui.muted).children("·"),
          h.a
            .class(Design.ui.link)
            .attr("href", Routes.AppRoute.print(Routes.AppRoute.Order()))
            .children("Place custom order")
        ),
        h.div.children(
          Button(h, { onPress: HomePageMessage.ClickedCounter() })
            .class(Design.ui.button)
            .attr("data-testid", "home-counter")
            .children(`Clicked ${model.clicks} times`)
        )
      )
})
