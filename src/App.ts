import { Head, Router, UiSchema } from "@effect/ui"
import { Html, HtmlHead } from "@effect/ui/html"
import { Schema } from "effect"
import * as Pages from "./pages.ts"
import * as Routes from "./routes.ts"
import * as Shell from "./Shell.ts"

export const AppMessage = UiSchema.TaggedEnum({
  ChangedRoute: { route: Routes.AppRoute }
})

/**
 * The root. It holds the route, owns the head and the Router subscription, and
 * delegates the layout (navigation and the lazy page outlet) to the shell of
 * the `pages` it is created with.
 *
 * Production uses `App` below. A test creates one app per side (`createApp(Pages.createPages())` for its
 * "server", another for its "browser") in one module graph.
 */
export const createApp = (pages: Pages.Pages) => {
  const shell = Shell.createShell(pages)
  return Html.component({
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
    view: (h, { route }) => shell(h, route)
  })
}

export type AppComponent = ReturnType<typeof createApp>

/** The production app, over the production `pages`. */
export const App: AppComponent = createApp(Pages.pages)
