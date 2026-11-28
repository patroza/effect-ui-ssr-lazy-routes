import { Head, Router, UiSchema } from "@effect/ui"
import { Html, HtmlHead } from "@effect/ui/html"
import { Schema } from "effect"
import * as I18n from "./i18n/I18n.ts"
import * as Pages from "./pages.ts"
import * as Routes from "./routes.ts"
import * as Shell from "./Shell.ts"

const AppMessage = UiSchema.TaggedEnum({
  ChangedRoute: { route: Routes.AppRoute }
})

/**
 * The root. It holds the route and active locale, owns `<head>` and the Router
 * subscription, and keeps lazy pages as direct children so SSR `#state` paths
 * stay `/App/<Page>[<path>]`.
 */
const createApp = (pages: Pages.Pages) => {
  const shell = Shell.createShell(pages)
  return Html.component({
    name: "App",
    props: Schema.Struct({
      route: Routes.AppRoute,
      locale: Schema.optionalKey(I18n.AppLocale)
    }),
    model: Schema.Struct({
      route: Routes.AppRoute,
      locale: I18n.AppLocale
    }),
    message: AppMessage
  }).make({
    init: ($) => ({
      route: $.props.route,
      locale: $.props.locale ?? "en"
    }),
    update: ($, message) =>
      AppMessage.match(message, {
        ChangedRoute: ({ route }) => $.evolve({ route })
      }),
    subscriptions: ({ model }) => [
      Router.subscription(Routes.AppRoute, model.route, (route) => AppMessage.ChangedRoute({ route }))
    ],
    head: ({ model }) => [
      Head.titleTemplate((title) => `${title} · Effect UI lazy routes`),
      HtmlHead.lang(model.locale)
    ],
    view: (h, { locale, route }) => shell(h, route, locale)
  })
}

export type AppComponent = ReturnType<typeof createApp>

/** A matched `{ app, pages }` pair so a caller can never preload one set of pages and mount another. */
export interface AppBundle {
  readonly app: AppComponent
  readonly pages: Pages.Pages
}

/** Builds a fresh `{ app, pages }` bundle with its own lazy load caches. */
export const createAppBundle = (options?: Pages.PagesOptions): AppBundle => {
  const pages = Pages.createPages(options)
  return { app: createApp(pages), pages }
}

/** The production app, over the production `pages`. */
export const App: AppComponent = createApp(Pages.pages)

/** The production `{ app, pages }` bundle. */
export const productionApp: AppBundle = { app: App, pages: Pages.pages }
