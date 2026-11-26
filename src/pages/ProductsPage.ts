import { Command, Head, Router, UiSchema } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { Schema } from "effect"
import { CATALOG_CHUNK, formatPrice, searchProducts } from "../data/products.ts"
import { AppRoute } from "../routes.ts"

/** Marker proving which chunk this page lands in (see scripts/verify-bundles.mjs). */
export const PRODUCTS_PAGE_CHUNK = "SENTINEL:products-page"

// A one-case subset of the union, so the page can take its whole route as props
// and pass it to `Router.patchSearch`.
const ProductsRoute = AppRoute.subset(["Products"])

export const ProductsPageMessage = UiSchema.TaggedEnum({
  UpdatedQuery: { text: Schema.String },
  ToggledCompare: { id: Schema.String }
})

export const ProductsPage = Html.component({
  name: "ProductsPage",
  props: Schema.Struct({ route: ProductsRoute }),
  // The compare list is local state: it is serialized by the server and adopted
  // by the client on hydration, and survives search updates (no remount).
  model: Schema.Struct({ compared: Schema.Array(Schema.String) }),
  message: ProductsPageMessage
}).make({
  init: () => ({ compared: [] }),
  update: ($, message) =>
    ProductsPageMessage.match(message, {
      // The URL is the only copy of the query: write it with `patchSearch` and
      // the new route comes back as props through the root.
      UpdatedQuery: ({ text }) =>
        $.run(
          Router.patchSearch(AppRoute, $.props.route, { q: text || undefined }).pipe(Command.asNoop)
        ),
      ToggledCompare: ({ id }) =>
        $.evolve({
          compared: (compared) => compared.includes(id) ? compared.filter((other) => other !== id) : [...compared, id]
        })
    }),
  head: () => [Head.title("Products")],
  view: (h, model) => {
    const q = h.props.route.search.q
    const results = searchProducts(q)
    return h.section
      .attr("data-page-chunk", PRODUCTS_PAGE_CHUNK)
      .attr("data-catalog", CATALOG_CHUNK)
      .children(
        h.h1("Products"),
        h.input
          .attrs({ type: "search", "aria-label": "Search products", "data-testid": "products-search" })
          .value(q ?? "")
          .onInput(({ value }) => ProductsPageMessage.UpdatedQuery({ text: value })),
        h.p.attr("data-testid", "products-compared").children(`Comparing ${model.compared.length} product(s)`),
        h.ul(
          results.map((product) =>
            h.li.key(product.id).children(
              h.a
                .attr("href", AppRoute.print(AppRoute.ProductDetail({ params: { id: product.id } })))
                .children(product.name),
              ` — ${formatPrice(product.priceCents)} `,
              h.button
                .attr("type", "button")
                .attr("aria-pressed", String(model.compared.includes(product.id)))
                .onClick(ProductsPageMessage.ToggledCompare({ id: product.id }))
                .children(model.compared.includes(product.id) ? "Remove from compare" : "Compare")
            )
          )
        ),
        results.length === 0 ? h.p("No products match your search.") : h.p(`${results.length} product(s).`)
      )
  }
})
