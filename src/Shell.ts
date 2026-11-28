import type { Html } from "@effect/ui/html"
import * as Design from "./design/classes.ts"
import * as Loading from "./design/loading.ts"
import * as I18n from "./i18n/I18n.ts"
import type * as Pages from "./pages.ts"
import * as Routes from "./routes.ts"

/** The nav link of the section the route belongs to: a product's page keeps "Products" current. */
const isCurrent = (linkTag: Routes.AppRouteTag, route: Routes.AppRouteValue): boolean =>
  linkTag === route._tag || (linkTag === "Products" && route._tag === "ProductDetail")

/**
 * The layout: the primary navigation, progressive-enhancement POST locale
 * switcher, and the outlet that mounts the page of the current route directly
 * under `App` so serialized state paths (`/App/<name>[<path>]`) match on server
 * and client.
 */
export const createShell =
  (pages: Pages.Pages) =>
  <M>(h: Html.H<M>, route: Routes.AppRouteValue, locale: I18n.AppLocale = "en") => {
    const fallback = Loading.pageFallback(h)
    const { t } = I18n.translatorFor(locale)
    const currentHref = Routes.AppRoute.print(route)
    const links = [
      { tag: "Home", href: Routes.AppRoute.print(Routes.AppRoute.Home()), label: t("nav.home") },
      {
        tag: "Products",
        href: Routes.AppRoute.print(Routes.AppRoute.Products({ search: {} })),
        label: t("nav.products")
      },
      { tag: "Analytics", href: Routes.AppRoute.print(Routes.AppRoute.Analytics()), label: t("nav.analytics") },
      { tag: "Status", href: Routes.AppRoute.print(Routes.AppRoute.Status({ search: {} })), label: t("nav.status") },
      { tag: "Order", href: Routes.AppRoute.print(Routes.AppRoute.Order()), label: t("nav.order") },
      { tag: "Warehouse", href: Routes.AppRoute.print(Routes.AppRoute.Warehouse()), label: t("nav.warehouse") }
    ] as const
    const locales: ReadonlyArray<{ readonly code: I18n.AppLocale; readonly label: string }> = [
      { code: "en", label: t("nav.localeEn") },
      { code: "de", label: t("nav.localeDe") }
    ]
    return h.div(
      h.header.class("flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3").children(
        h.nav
          .class("flex flex-wrap gap-1")
          .attr("aria-label", t("nav.primaryAria"))
          .children(
            links.map((link) =>
              h.a
                .key(link.tag)
                .class(Design.ui.navLink)
                .attr("href", link.href)
                .attr("aria-current", isCurrent(link.tag, route) ? "page" : undefined)
                .children(link.label)
            )
          ),
        h.div
          .class("flex items-center gap-1")
          .attr("role", "group")
          .attr("aria-label", t("nav.languageLabel"))
          .attr("data-testid", "locale-switcher")
          .attr("data-i18n-chunk", I18n.getChunkMarker(locale))
          .children(
            locales.map((item) =>
              h.button
                .key(`locale-${item.code}`)
                .attr("type", "submit")
                .attr("form", `locale-form-${item.code}`)
                .attr("data-testid", `locale-switch-${item.code}`)
                .attr("aria-pressed", locale === item.code ? "true" : "false")
                .class(
                  `cursor-pointer rounded-sm border px-2 py-1 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                    locale === item.code
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`
                )
                .children(item.label)
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
          Status: (r) =>
            pages.Status(h, {
              key: Routes.AppRoute.printPath(r),
              props: { mode: r.search.mode },
              fallback
            }),
          Order: (r) => pages.Order(h, { key: Routes.AppRoute.printPath(r), props: { locale }, fallback }),
          Warehouse: (r) => pages.Warehouse(h, { key: Routes.AppRoute.printPath(r), props: { locale }, fallback }),
          NotFound: (r) =>
            pages.NotFound(h, {
              key: Routes.AppRoute.printPath(r),
              props: { path: Routes.AppRoute.printPath(r) },
              fallback
            })
        })
      ),
      locales.map((item) =>
        h.form
          .key(`locale-form-${item.code}`)
          .attr("id", `locale-form-${item.code}`)
          .attr("method", "post")
          .attr("action", "/locale")
          .class("hidden")
          .children(
            h.input.attr("type", "hidden").attr("name", "locale").attr("value", item.code),
            h.input.attr("type", "hidden").attr("name", "next").attr("value", currentHref)
          )
      )
    )
  }
