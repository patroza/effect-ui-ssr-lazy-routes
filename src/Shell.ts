import type { Html } from "@effect/ui/html"
import * as Design from "./design/classes.ts"
import * as Loading from "./design/loading.ts"
import type * as Pages from "./pages.ts"
import * as Routes from "./routes.ts"

/** The nav link of the section the route belongs to: a product's page keeps "Products" current. */
const isCurrent = (linkTag: Routes.AppRouteTag, route: Routes.AppRouteValue): boolean =>
  linkTag === route._tag || (linkTag === "Products" && route._tag === "ProductDetail")

/**
 * The layout: the primary navigation and the outlet that mounts the page of
 * the current route. It is a plain view function, not a `Component`, so the
 * pages stay direct children of `App` and the state paths the server
 * serializes (`/App/<name>[<path>]`) are the same on both sides.
 *
 * It imports no page module statically: every page is a `Component.lazy`
 * child of the `pages` it is created with (`Pages.createPages()`; production
 * uses `Pages.pages`). The browser awaits `preloadRoute` for its landing page
 * before hydrating, so that child adopts the server's DOM instead of showing
 * its fallback.
 */
export const createShell =
  (pages: Pages.Pages) =>
  <M>(h: Html.H<M>, route: Routes.AppRouteValue) => {
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
                .attr("aria-current", isCurrent(link.tag, route) ? "page" : undefined)
                .children(link.label)
            )
          )
      ),
      h.main.class("pt-6").children(
        // Key by `printPath` (no search): a new path mounts a fresh page, while
        // a search change updates the live page in place with new props.
        Routes.AppRoute.match(route, {
          Home: (r) => pages.Home(h, { key: Routes.AppRoute.printPath(r), fallback }),
          Products: (r) => pages.Products(h, { key: Routes.AppRoute.printPath(r), props: { route: r }, fallback }),
          ProductDetail: (r) =>
            pages.ProductDetail(h, {
              key: Routes.AppRoute.printPath(r),
              props: { id: r.params.id },
              fallback
            }),
          Analytics: (r) => pages.Analytics(h, { key: Routes.AppRoute.printPath(r), fallback }),
          NotFound: (r) =>
            pages.NotFound(h, {
              key: Routes.AppRoute.printPath(r),
              props: { path: Routes.AppRoute.printPath(r) },
              fallback
            })
        })
      )
    )
  }
