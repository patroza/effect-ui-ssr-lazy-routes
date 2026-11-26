import { Route } from "@effect/ui"
import { Option, Schema } from "effect"

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

/**
 * The route a `pathname + search` resolves to, or `None` for a URL that
 * can't be decoded at all (such as a malformed `%` escape). `/*` makes every
 * decodable URL resolve, so `None` means a bad request, not a missing page.
 * The server answers it with 400; the browser only ever sees URLs it already
 * parsed.
 */
export const routeOf = (url: string): Option.Option<AppRouteValue> => Option.map(AppRoute.resolve(url), (r) => r.route)
