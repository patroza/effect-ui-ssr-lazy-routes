import { Head, Router, UiSchema } from "@effect/ui"
import { Html, HtmlHead } from "@effect/ui/html"
import { Schema } from "effect"
import { pageFallback } from "./loading.ts"
import { pages } from "./pages.ts"
import { AppRoute } from "./routes.ts"

export const AppMessage = UiSchema.TaggedEnum({
  ChangedRoute: { route: AppRoute }
})

/**
 * The root. It holds the route and picks the page. It imports no page module
 * statically: every page is a `Component.lazy` child. The browser awaits
 * `preloadRoute` for its landing page before hydrating, so that child adopts
 * the server's DOM instead of showing its fallback.
 */
export const App = Html.component({
  name: "App",
  props: Schema.Struct({ route: AppRoute }),
  model: Schema.Struct({ route: AppRoute }),
  message: AppMessage
}).make({
  init: ($) => ({ route: $.props.route }),
  update: (_$, message) =>
    AppMessage.match(message, {
      ChangedRoute: ({ route }) => ({ route })
    }),
  subscriptions: ({ model }) => [
    Router.subscription(AppRoute, model.route, (route) => AppMessage.ChangedRoute({ route }))
  ],
  head: () => [Head.titleTemplate((title) => `${title} · Effect UI lazy routes`), HtmlHead.lang("en")],
  view: (h, { route }) => {
    const fallback = pageFallback(h)
    return h.div(
      h.header(
        h.nav.children(
          h.a.attr("href", AppRoute.print(AppRoute.Home())).children("Home"),
          h.a.attr("href", AppRoute.print(AppRoute.Products({ search: {} }))).children("Products"),
          h.a.attr("href", AppRoute.print(AppRoute.Analytics())).children("Analytics")
        )
      ),
      h.main(
        // Key by `printPath` (no search): a new path mounts a fresh page, while
        // a search change updates the live page in place with new props.
        AppRoute.match(route, {
          Home: (r) => pages.Home(h, { key: AppRoute.printPath(r), fallback }),
          Products: (r) => pages.Products(h, { key: AppRoute.printPath(r), props: { route: r }, fallback }),
          ProductDetail: (r) =>
            pages.ProductDetail(h, {
              key: AppRoute.printPath(r),
              props: { id: r.params.id },
              fallback
            }),
          Analytics: (r) => pages.Analytics(h, { key: AppRoute.printPath(r), fallback }),
          NotFound: (r) =>
            pages.NotFound(h, {
              key: AppRoute.printPath(r),
              props: { path: AppRoute.printPath(r) },
              fallback
            })
        })
      )
    )
  }
})
