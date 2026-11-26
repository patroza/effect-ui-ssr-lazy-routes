import * as Head from "@effect/ui/Head"
import * as UiSchema from "@effect/ui/UiSchema"
import { Html } from "@effect/ui/html"
import { Button } from "@effect/ui-kit/Button"
import * as Schema from "effect/Schema"
import { ui } from "../design.ts"
import { AppRoute } from "../routes.ts"

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
      .class(ui.stack)
      .children(
        h.h1.class(ui.title).children("Home"),
        h.p.class(ui.muted).children("Server-rendered, hydrated without a loading flash, and split per route."),
        h.p.class(ui.row).children(
          h.a
            .class(ui.link)
            .attr("href", AppRoute.print(AppRoute.Products({ search: {} })))
            .children("Browse products"),
          h.span.class(ui.muted).children("·"),
          h.a.class(ui.link).attr("href", AppRoute.print(AppRoute.Analytics())).children("See analytics")
        ),
        h.div.children(
          Button(h, { onPress: HomePageMessage.ClickedCounter() })
            .class(ui.button)
            .attr("data-testid", "home-counter")
            .children(`Clicked ${model.clicks} times`)
        )
      )
})
