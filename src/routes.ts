import { Route } from "@effect/ui"
import { Schema } from "effect"

/**
 * The typed route union shared by the server, the client and the tests.
 *
 * It lives in its own module (and never imports a page) so that pages can
 * build links from it without creating an import cycle with `App.ts`.
 */
export const AppRoute = Route.union({
  Home: Route.make("/"),
  Products: Route.make("/products", {
    search: { q: Schema.optional(Schema.String) }
  }),
  ProductDetail: Route.make("/products/:id", { params: { id: Schema.String } }),
  Analytics: Route.make("/analytics"),
  NotFound: Route.make("/*")
})

export type AppRouteValue = typeof AppRoute.Type
export type AppRouteTag = AppRouteValue["_tag"]
