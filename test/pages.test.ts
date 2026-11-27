import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Pages from "../src/pages.ts"
import * as Routes from "../src/routes.ts"

// The name given to `Component.lazy(name, ...)` becomes part of the instance path
// (`/App/<name>[<path>]`) the server serializes and the client looks up. If it
// drifted from the loaded component's own `name`, hydration would miss its state.
const loaded = {
  Home: () => import("../src/pages/HomePage.ts").then((m) => m.HomePage),
  Products: () => import("../src/pages/ProductsPage.ts").then((m) => m.ProductsPage),
  ProductDetail: () => import("../src/pages/product/ProductDetailPage.ts").then((m) => m.ProductDetailPage),
  Analytics: () => import("../src/pages/AnalyticsPage.ts").then((m) => m.AnalyticsPage),
  Status: () => import("../src/pages/StatusPage.ts").then((m) => m.StatusPage),
  Order: () => import("../src/pages/OrderFormPage.ts").then((m) => m.OrderFormPage),
  Warehouse: () => import("../src/pages/WarehousePage.ts").then((m) => m.WarehousePage),
  NotFound: () => import("../src/pages/NotFoundPage.ts").then((m) => m.NotFoundPage)
} as const satisfies Record<Routes.AppRouteTag, () => Promise<{ readonly definition: { readonly name: string } }>>

const lazyTypeId = "~@effect/ui/Component/Lazy"

/** The name `Component.lazy` was given, read from the marker object it carries. */
const lazyName = (lazy: object): string | undefined => {
  const marker: unknown = Reflect.get(lazy, lazyTypeId)
  if (typeof marker !== "object" || marker === null) return undefined
  const name: unknown = Reflect.get(marker, "name")
  return typeof name === "string" ? name : undefined
}

describe("pages", () => {
  const tags = [
    "Home",
    "Products",
    "ProductDetail",
    "Analytics",
    "Status",
    "Order",
    "Warehouse",
    "NotFound"
  ] as const satisfies ReadonlyArray<Routes.AppRouteTag>

  it("has a lazy page for every route", () => {
    expect(Object.keys(Pages.pages).sort()).toEqual([...tags].sort())
    expect(Object.keys(Pages.createPages()).sort()).toEqual([...tags].sort())
  })

  for (const tag of tags) {
    it.effect(`${tag}: the lazy name is the loaded component's name`, () =>
      Effect.gen(function* () {
        const component = yield* Effect.promise(loaded[tag])
        expect(lazyName(Pages.pages[tag])).toBe(component.definition.name)
        expect(lazyName(Pages.createPages()[tag])).toBe(component.definition.name)
      })
    )
  }

  it.effect("createPages gives every call its own load cache, so no module needs resetting", () =>
    Effect.gen(function* () {
      const loadedA: Array<Routes.AppRouteTag> = []
      const loadedB: Array<Routes.AppRouteTag> = []
      const a = Pages.createPages({ onLoad: (tag) => loadedA.push(tag) })
      const b = Pages.createPages({ onLoad: (tag) => loadedB.push(tag) })
      const route = Routes.AppRoute.Home()

      yield* Effect.promise(() => Pages.preloadRoute(route, a))
      expect(loadedA).toEqual(["Home"])
      expect(loadedB).toEqual([]) // `b` never loaded it, though the module is already imported

      yield* Effect.promise(() => Pages.preloadRoute(route, a))
      expect(loadedA).toEqual(["Home"]) // a page loads once per set

      yield* Effect.promise(() => Pages.preloadRoute(route, b))
      expect(loadedB).toEqual(["Home"])
    })
  )
})
