import { Component } from "@effect/ui"
import type * as Routes from "./routes.ts"

export interface PagesOptions {
  /** Called once per `pages` instance, when `tag`'s module has been imported (tests watch it; production passes none). */
  readonly onLoad?: ((tag: Routes.AppRouteTag) => void) | undefined
}

/**
 * Builds a fresh set of `Component.lazy` pages, each with its own load cache.
 *
 * This is the ONLY place that references the page modules, and only through
 * dynamic `import()`. Nothing else in the client graph may import `./pages/*`
 * statically (a static import pulls the page back into the entry chunk).
 * `scripts/verify-bundles.ts` proves it on the built output.
 *
 * These are plain `Component.lazy` pages. Since Effect-TS/ui#268, a lazy
 * child that was `preload()`ed before hydration adopts the server's DOM, Model
 * and `~query` entries, so there is no wrapper around them.
 *
 * Production uses the one `pages` below. A test builds one set for its
 * "server" and another for its "browser" in the same module graph: each has
 * its own cache, so whether a chunk is loaded when the client hydrates is the
 * client's own, without resetting modules.
 */
export const createPages = (options: PagesOptions = {}) => {
  const loaded = <A>(tag: Routes.AppRouteTag, page: A): A => {
    options.onLoad?.(tag)
    return page
  }
  return {
    Home: Component.lazy("HomePage", () => import("./pages/HomePage.ts").then((m) => loaded("Home", m.HomePage))),
    Products: Component.lazy("ProductsPage", () =>
      import("./pages/ProductsPage.ts").then((m) => loaded("Products", m.ProductsPage))
    ),
    ProductDetail: Component.lazy("ProductDetailPage", () =>
      import("./pages/product/ProductDetailPage.ts").then((m) => loaded("ProductDetail", m.ProductDetailPage))
    ),
    Analytics: Component.lazy("AnalyticsPage", () =>
      import("./pages/AnalyticsPage.ts").then((m) => loaded("Analytics", m.AnalyticsPage))
    ),
    Status: Component.lazy("StatusPage", () =>
      import("./pages/StatusPage.ts").then((m) => loaded("Status", m.StatusPage))
    ),
    Order: Component.lazy("OrderFormPage", () =>
      import("./pages/OrderFormPage.ts").then((m) => loaded("Order", m.OrderFormPage))
    ),
    NotFound: Component.lazy("NotFoundPage", () =>
      import("./pages/NotFoundPage.ts").then((m) => loaded("NotFound", m.NotFoundPage))
    )
  } as const satisfies Record<Routes.AppRouteTag, unknown>
}

export type Pages = ReturnType<typeof createPages>

/** The pages the production app (`App`, the server and the browser entry) uses. */
export const pages: Pages = createPages()

/**
 * Starts loading (and resolves once loaded) the chunk of `route`. It never
 * rejects. Await it for the route the browser is on BEFORE hydrating; call it
 * without awaiting for a link the user is about to follow. A test passes its
 * client's `pages`.
 */
export const preloadRoute = (route: Routes.AppRouteValue, pageMap: Pages = pages): Promise<void> =>
  pageMap[route._tag].preload()
