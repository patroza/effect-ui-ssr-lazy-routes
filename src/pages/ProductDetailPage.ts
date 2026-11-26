import { Component, Head, UiSchema } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { Cause, Option, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import { CATALOG_CHUNK, formatPrice } from "../data/products.ts"
import { GET_PRODUCT_QUERY_CHUNK, GetProduct } from "../queries/GetProduct.ts"
import { AppRoute } from "../routes.ts"

/** Marker proving which chunk this page lands in (see scripts/verify-bundles.mjs). */
export const PRODUCT_DETAIL_PAGE_CHUNK = "SENTINEL:product-detail-page"

export const ProductDetailPageMessage = UiSchema.TaggedEnum({
  ClickedMoreQuantity: {},
  ClickedLessQuantity: {}
})

export const ProductDetailPageNoDeps = Html.component({
  name: "ProductDetailPage",
  props: Schema.Struct({ id: Schema.String }),
  model: Schema.Struct({ quantity: Schema.Number }),
  message: ProductDetailPageMessage,
  queries: {
    product: { query: GetProduct, args: ({ props }) => ({ id: props.id }) }
  }
}).make({
  init: () => ({ quantity: 1 }),
  update: ($, message) =>
    ProductDetailPageMessage.match(message, {
      ClickedMoreQuantity: () => $.evolve({ quantity: (n) => n + 1 }),
      ClickedLessQuantity: () => $.evolve({ quantity: (n) => Math.max(1, n - 1) })
    }),
  head: ($) => [
    Head.title(
      AsyncResult.match($.queries.product, {
        onInitial: () => "Product",
        onFailure: () => "Product",
        onSuccess: ({ value }) => Option.match(value, { onNone: () => "Unknown product", onSome: (p) => p.name })
      })
    )
  ],
  view: (h, model) => {
    const back = h.a.attr("href", AppRoute.print(AppRoute.Products({ search: {} }))).children("← All products")
    const shell = h.section
      .attr("data-page-chunk", PRODUCT_DETAIL_PAGE_CHUNK)
      .attr("data-query", GET_PRODUCT_QUERY_CHUNK)
    const result = h.queries.product
    if (AsyncResult.isInitial(result)) return shell.children(h.h1("Loading product…"), back)
    if (AsyncResult.isFailure(result)) return shell.children(h.h1("Couldn't load the product"), h.pre(Cause.pretty(result.cause)), back)
    const product = Option.getOrUndefined(result.value)
    if (product === undefined) {
      return shell.children(h.h1("Unknown product"), h.p(`There is no product "${h.props.id}".`), back)
    }
    return shell
      .attr("data-catalog", CATALOG_CHUNK)
      .children(
        h.h1(product.name),
        h.p(product.blurb),
        h.p.attr("data-testid", "detail-total").children(
          `${model.quantity} × ${formatPrice(product.priceCents)} = ${formatPrice(model.quantity * product.priceCents)}`
        ),
        h.button
          .attr("type", "button")
          .attr("data-testid", "detail-less")
          .on("click", ProductDetailPageMessage.ClickedLessQuantity())
          .children("−"),
        h.button
          .attr("type", "button")
          .attr("data-testid", "detail-more")
          .on("click", ProductDetailPageMessage.ClickedMoreQuantity())
          .children("+"),
        back
      )
  }
})

/** The page with its own query Layer, so `GetProduct` ships in this page's chunk. */
export const ProductDetailPage = ProductDetailPageNoDeps.pipe(Component.provide(GetProduct.layer))
