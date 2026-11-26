import * as Component from "@effect/ui/Component"
import type { AppRouteTag, AppRouteValue } from "./routes.ts"

/**
 * The ONLY place that references the page modules, and only through dynamic
 * `import()`. Nothing else in the client graph may import `./pages/*`
 * statically (a static import pulls the page back into the entry chunk).
 * `scripts/verify-bundles.ts` proves it on the built output.
 *
 * These are plain `Component.lazy` pages. Since Effect-TS/ui#268, a lazy
 * child that was `preload()`ed before hydration adopts the server's DOM, Model
 * and `~query` entries, so there is no wrapper around them.
 */
export const pages = {
  Home: Component.lazy("HomePage", () => import("./pages/HomePage.ts").then((m) => m.HomePage)),
  Products: Component.lazy("ProductsPage", () => import("./pages/ProductsPage.ts").then((m) => m.ProductsPage)),
  ProductDetail: Component.lazy("ProductDetailPage", () =>
    import("./pages/ProductDetailPage.ts").then((m) => m.ProductDetailPage)
  ),
  Analytics: Component.lazy("AnalyticsPage", () => import("./pages/AnalyticsPage.ts").then((m) => m.AnalyticsPage)),
  NotFound: Component.lazy("NotFoundPage", () => import("./pages/NotFoundPage.ts").then((m) => m.NotFoundPage))
} as const satisfies Record<AppRouteTag, unknown>

/**
 * Starts loading (and resolves once loaded) the chunk of `route`. It never
 * rejects. Await it for the route the browser is on BEFORE hydrating; call it
 * without awaiting for a link the user is about to follow.
 */
export const preloadRoute = (route: AppRouteValue): Promise<void> => pages[route._tag].preload()
