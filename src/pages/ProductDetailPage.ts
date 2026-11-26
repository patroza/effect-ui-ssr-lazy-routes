import { Head, UiSchema } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { Schema } from "effect"
import { CATALOG_CHUNK, findProduct, formatPrice } from "../data/products.ts"
import { AppRoute } from "../routes.ts"

/** Marker proving which chunk this page lands in (see scripts/verify-bundles.mjs). */
export const PRODUCT_DETAIL_PAGE_CHUNK = "SENTINEL:product-detail-page"

export const ProductDetailPageMessage = UiSchema.TaggedEnum({
  ClickedMoreQuantity: {},
  ClickedLessQuantity: {}
})

export const ProductDetailPage = Html.component({
  name: "ProductDetailPage",
  props: Schema.Struct({ id: Schema.String }),
  model: Schema.Struct({ quantity: Schema.Number }),
  message: ProductDetailPageMessage
}).make({
  init: () => ({ quantity: 1 }),
  update: ($, message) =>
    ProductDetailPageMessage.match(message, {
      ClickedMoreQuantity: () => $.evolve({ quantity: (n) => n + 1 }),
      ClickedLessQuantity: () => $.evolve({ quantity: (n) => Math.max(1, n - 1) })
    }),
  head: ($) => [Head.title(findProduct($.props.id)?.name ?? "Unknown product")],
  view: (h, model) => {
    const product = findProduct(h.props.id)
    const back = h.a.attr("href", AppRoute.print(AppRoute.Products({ search: {} }))).children("← All products")
    if (product === undefined) {
      return h.section
        .attr("data-page-chunk", PRODUCT_DETAIL_PAGE_CHUNK)
        .children(h.h1("Unknown product"), h.p(`There is no product "${h.props.id}".`), back)
    }
    return h.section
      .attr("data-page-chunk", PRODUCT_DETAIL_PAGE_CHUNK)
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
          .onClick(ProductDetailPageMessage.ClickedLessQuantity())
          .children("−"),
        h.button
          .attr("type", "button")
          .attr("data-testid", "detail-more")
          .onClick(ProductDetailPageMessage.ClickedMoreQuantity())
          .children("+"),
        back
      )
  }
})
