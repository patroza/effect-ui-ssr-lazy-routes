import { Command, Component, Head, Router, UiSchema } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { Button, Input } from "@effect/ui-kit"
import { Option, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import * as Products from "../product/domain/Product.ts"
import * as Design from "../design/classes.ts"
import * as SearchProducts from "../search/queries/SearchProducts.ts"
import * as Routes from "../routes.ts"

/** Marker proving which chunk this page lands in (see scripts/verify-bundles.ts). */
export const PRODUCTS_PAGE_CHUNK = "SENTINEL:products-page"

// A one-case subset of the union, so the page can take its whole route as props
// and pass it to `Router.patchSearch`.
const ProductsRoute = Routes.AppRoute.subset(["Products"])

export const ProductsPageMessage = UiSchema.TaggedEnum({
  UpdatedQuery: { text: Schema.String },
  ToggledCompare: { id: Schema.String }
})

export const ProductsPageNoDeps = Html.component({
  name: "ProductsPage",
  props: Schema.Struct({ route: ProductsRoute }),
  // The compare list is local state: it is serialized by the server and adopted
  // by the client on hydration, and survives search updates (no remount).
  model: Schema.Struct({ compared: Schema.Array(Schema.String) }),
  message: ProductsPageMessage,
  // The results are fetched by the query (and shipped in the server's `~query`),
  // never copied into the Model.
  queries: {
    results: {
      query: SearchProducts.SearchProducts,
      // The input writes every keystroke to the URL; wait for typing to pause before fetching.
      debounce: "300 millis",
      args: ({ props }) => ({ q: props.route.search.q })
    }
  }
}).make({
  init: () => ({ compared: [] }),
  update: ($, message) =>
    ProductsPageMessage.match(message, {
      // The URL is the only copy of the query: write it with `patchSearch` and
      // the new route comes back as props through the root.
      UpdatedQuery: ({ text }) =>
        $.run(Router.patchSearch(Routes.AppRoute, $.props.route, { q: text || undefined }).pipe(Command.asNoop)),
      ToggledCompare: ({ id }) =>
        $.evolve({
          compared: (compared) => (compared.includes(id) ? compared.filter((other) => other !== id) : [...compared, id])
        })
    }),
  head: () => [Head.title("Products")],
  view: (h, model) => {
    const q = h.props.route.search.q
    // The last results stay up while the next search loads.
    const results = AsyncResult.match(h.queries.results, {
      onInitial: () => Option.getOrUndefined(h.previous.results),
      onFailure: () => undefined,
      onSuccess: ({ value }) => value
    })
    const status =
      results === undefined
        ? AsyncResult.isFailure(h.queries.results)
          ? "Search failed."
          : "Searching…"
        : results.length === 0
          ? "No products match your search."
          : `${results.length} product(s).`
    return h.section
      .attr("data-page-chunk", PRODUCTS_PAGE_CHUNK)
      .attr("data-catalog", Products.CATALOG_CHUNK)
      .attr("data-query", SearchProducts.SEARCH_PRODUCTS_QUERY_CHUNK)
      .class(Design.ui.stack)
      .children(
        h.h1.class(Design.ui.title).children("Products"),
        Input(h, {
          props: { value: q ?? "" },
          onUpdate: ({ value }) => ProductsPageMessage.UpdatedQuery({ text: value })
        })
          .class(Design.ui.input)
          .attrs({
            type: "search",
            placeholder: "Search products…",
            "aria-label": "Search products",
            "data-testid": "products-search"
          }),
        h.p
          .class(Design.ui.muted)
          .attr("data-testid", "products-compared")
          .children(`Comparing ${model.compared.length} product(s)`),
        h.ul.class("flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800").children(
          (results ?? []).map((product) =>
            h.li
              .key(product.id)
              .class("flex items-center justify-between gap-3 py-3")
              .children(
                h.div.children(
                  h.a
                    .class(Design.ui.link)
                    .attr("href", Routes.AppRoute.print(Routes.AppRoute.ProductDetail({ params: { id: product.id } })))
                    .children(product.name),
                  h.span.class(Design.ui.muted).children(` — ${Products.formatPrice(product.priceCents)}`)
                ),
                Button(h, { onPress: ProductsPageMessage.ToggledCompare({ id: product.id }) })
                  .class(Design.ui.button)
                  .attr("aria-pressed", String(model.compared.includes(product.id)))
                  .children(model.compared.includes(product.id) ? "Remove from compare" : "Compare")
              )
          )
        ),
        h.p.class(Design.ui.muted).attr("data-testid", "products-status").children(status)
      )
  }
})

/**
 * The page with its own query Layer. `Component.provide` keeps `SearchProducts.layer`
 * inside this module, so it ships in the Products chunk with the page.
 */
export const ProductsPage = ProductsPageNoDeps.pipe(Component.provide(SearchProducts.SearchProducts.layer))
