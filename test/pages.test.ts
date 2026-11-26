import { describe, expect, it } from "vitest"
import type * as Routes from "../src/routes.ts"

// The name given to `Component.lazy(name, ...)` becomes part of the instance path
// (`/App/<name>[<path>]`) the server serializes and the client looks up. If it
// drifted from the loaded component's own `name`, hydration would miss its state.
const loaded = {
  Home: () => import("../src/pages/HomePage.ts").then((m) => m.HomePage),
  Products: () => import("../src/pages/ProductsPage.ts").then((m) => m.ProductsPage),
  ProductDetail: () => import("../src/pages/product/ProductDetailPage.ts").then((m) => m.ProductDetailPage),
  Analytics: () => import("../src/pages/AnalyticsPage.ts").then((m) => m.AnalyticsPage),
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
    "NotFound"
  ] as const satisfies ReadonlyArray<Routes.AppRouteTag>

  it("has a lazy page for every route", async () => {
    const { pages } = await import("../src/pages.ts")
    expect(Object.keys(pages).sort()).toEqual([...tags].sort())
  })

  it.each(tags)("%s: the lazy name is the loaded component's name", async (tag) => {
    const { pages } = await import("../src/pages.ts")
    const component = await loaded[tag]()
    expect(lazyName(pages[tag])).toBe(component.definition.name)
  })
})
