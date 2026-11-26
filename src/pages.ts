import { makeLazyRoutePage } from "./lazyPage.ts"
import type { AppRouteTag, AppRouteValue } from "./routes.ts"

/**
 * The ONLY place that references the page modules, and only through dynamic
 * `import()`. Nothing else in the client graph may import `./pages/*`
 * statically (a static import pulls the page back into the entry chunk).
 * `scripts/verify-bundles.mjs` proves it on the built output.
 */
export const pages = {
  Home: makeLazyRoutePage("HomePage", () => import("./pages/HomePage.ts").then((m) => m.HomePage)),
  Products: makeLazyRoutePage("ProductsPage", () => import("./pages/ProductsPage.ts").then((m) => m.ProductsPage)),
  ProductDetail: makeLazyRoutePage(
    "ProductDetailPage",
    () => import("./pages/ProductDetailPage.ts").then((m) => m.ProductDetailPage)
  ),
  Analytics: makeLazyRoutePage(
    "AnalyticsPage",
    () => import("./pages/AnalyticsPage.ts").then((m) => m.AnalyticsPage)
  ),
  NotFound: makeLazyRoutePage("NotFoundPage", () => import("./pages/NotFoundPage.ts").then((m) => m.NotFoundPage))
} as const satisfies Record<AppRouteTag, unknown>

/** Load the matched route's chunk and keep its real component for the first render. Await before hydrating. */
export const preloadInitialRoute = (route: AppRouteValue): Promise<void> => pages[route._tag].preloadInitial()

/** Start loading the chunk of a route a user is about to visit. Never changes what renders. */
export const prefetchRoute = (route: AppRouteValue): Promise<void> => pages[route._tag].prefetch()
