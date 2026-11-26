import { Head, Router, UiSchema } from "@effect/ui"
import { Html, HtmlHead } from "@effect/ui/html"
import { Schema } from "effect"
import * as Design from "./design.ts"
import * as Loading from "./loading.ts"
import * as Pages from "./pages.ts"
import * as Routes from "./routes.ts"

export const AppMessage = UiSchema.TaggedEnum({
  ChangedRoute: { route: Routes.AppRoute }
})

/**
 * The root. It holds the route and picks the page. It imports no page module
 * statically: every page is a `Component.lazy` child. The browser awaits
 * `preloadRoute` for its landing page before hydrating, so that child adopts
 * the server's DOM instead of showing its fallback.
 */
export const App = Html.component({
  name: "App",
  props: Schema.Struct({ route: Routes.AppRoute }),
  model: Schema.Struct({ route: Routes.AppRoute }),
  message: AppMessage
}).make({
  init: ($) => ({ route: $.props.route }),
  update: (_$, message) =>
    AppMessage.match(message, {
      ChangedRoute: ({ route }) => ({ route })
    }),
  subscriptions: ({ model }) => [
    Router.subscription(Routes.AppRoute, model.route, (route) => AppMessage.ChangedRoute({ route }))
  ],
  head: () => [Head.titleTemplate((title) => `${title} · Effect UI lazy routes`), HtmlHead.lang("en")],
  view: (h, { route }) => {
    const fallback = Loading.pageFallback(h)
    const links = [
      { tag: "Home", href: Routes.AppRoute.print(Routes.AppRoute.Home()), label: "Home" },
      { tag: "Products", href: Routes.AppRoute.print(Routes.AppRoute.Products({ search: {} })), label: "Products" },
      { tag: "Analytics", href: Routes.AppRoute.print(Routes.AppRoute.Analytics()), label: "Analytics" }
    ] as const
    return h.div(
      h.header.class("border-b border-neutral-200 pb-3 dark:border-neutral-800").children(
        h.nav
          .class("flex gap-1")
          .attr("aria-label", "Primary")
          .children(
            links.map((link) =>
              h.a
                .key(link.tag)
                .class(Design.ui.navLink)
                .attr("href", link.href)
                .attr("aria-current", link.tag === route._tag ? "page" : undefined)
                .children(link.label)
            )
          )
      ),
      h.main.class("pt-6").children(
        // Key by `printPath` (no search): a new path mounts a fresh page, while
        // a search change updates the live page in place with new props.
        Routes.AppRoute.match(route, {
          Home: (r) => Pages.pages.Home(h, { key: Routes.AppRoute.printPath(r), fallback }),
          Products: (r) =>
            Pages.pages.Products(h, { key: Routes.AppRoute.printPath(r), props: { route: r }, fallback }),
          ProductDetail: (r) =>
            Pages.pages.ProductDetail(h, {
              key: Routes.AppRoute.printPath(r),
              props: { id: r.params.id },
              fallback
            }),
          Analytics: (r) => Pages.pages.Analytics(h, { key: Routes.AppRoute.printPath(r), fallback }),
          NotFound: (r) =>
            Pages.pages.NotFound(h, {
              key: Routes.AppRoute.printPath(r),
              props: { path: Routes.AppRoute.printPath(r) },
              fallback
            })
        })
      )
    )
  }
})
