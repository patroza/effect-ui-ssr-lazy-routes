import { Command, Component, Head, UiSchema } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { Button, Dialog, Input } from "@effect/ui-kit"
import { Layer, Option, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import * as Products from "../../product/domain/Product.ts"
import * as Design from "../../design/classes.ts"
import * as BookmarkProduct from "../../product/commands/BookmarkProduct.ts"
import * as GetProduct from "../../product/queries/GetProduct.ts"
import * as BookmarkPort from "../../product/services/BookmarkPort.ts"
import * as CatalogPort from "../../product/services/CatalogPort.ts"
import * as Routes from "../../routes.ts"
import * as Status from "../../lib/status.ts"

/** Marker proving which chunk this page lands in (see scripts/verify-bundles.ts). */
export const PRODUCT_DETAIL_PAGE_CHUNK = "SENTINEL:product-detail-page"

export const ProductDetailPageMessage = UiSchema.TaggedEnum({
  ClickedMoreQuantity: {},
  ClickedLessQuantity: {},
  ClickedBookmark: {},
  CompletedBookmarkProduct: { id: Schema.String },
  RequestedOpenInquiry: {},
  RequestedCloseInquiry: {},
  UpdatedQuestion: { value: Schema.String },
  ClickedSendQuestion: {}
})

const backdropClass =
  "fixed inset-0 bg-black/40 transition-opacity data-starting-style:opacity-0 data-ending-style:opacity-0"
const viewportClass = "fixed inset-0 grid place-items-center p-4"
const popupClass =
  "w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-5 shadow-xl transition-all data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0 dark:border-neutral-800 dark:bg-neutral-900"

export const ProductDetailPageNoDeps = Html.component({
  name: "ProductDetailPage",
  props: Schema.Struct({ id: Schema.String }),
  model: Schema.Struct({
    quantity: Schema.Finite,
    bookmark: Schema.Literals(["Idle", "Saving", "Saved"]),
    inquiryOpen: Schema.Boolean,
    question: Schema.String,
    sentQuestion: Schema.NullOr(Schema.String)
  }),
  message: ProductDetailPageMessage,
  queries: {
    product: { query: GetProduct.GetProduct, args: ({ props }) => ({ id: props.id }) }
  }
}).make({
  init: () => ({ quantity: 1, bookmark: "Idle" as const, inquiryOpen: false, question: "", sentQuestion: null }),
  update: ($, message) =>
    ProductDetailPageMessage.match(message, {
      ClickedMoreQuantity: () => $.evolve({ quantity: (n) => n + 1 }),
      ClickedLessQuantity: () => $.evolve({ quantity: (n) => Math.max(1, n - 1) }),
      ClickedBookmark: () =>
        $.model.bookmark === "Idle"
          ? $.evolve({ bookmark: "Saving" as const }).run(
              BookmarkProduct.BookmarkProduct.make({ id: $.props.id }).pipe(
                // The command's domain result becomes this page's message here, so the command never imports the page.
                Command.map(() => ProductDetailPageMessage.CompletedBookmarkProduct({ id: $.props.id }))
              )
            )
          : $.model,
      CompletedBookmarkProduct: () => $.evolve({ bookmark: "Saved" as const }),
      RequestedOpenInquiry: () => $.evolve({ inquiryOpen: true }),
      RequestedCloseInquiry: () => $.evolve({ inquiryOpen: false }),
      UpdatedQuestion: ({ value }) => $.evolve({ question: value }),
      ClickedSendQuestion: () =>
        $.model.question.trim() === ""
          ? $.model
          : $.evolve({ inquiryOpen: false, sentQuestion: $.model.question.trim(), question: "" })
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
    const back = h.a
      .class(Design.ui.link)
      .attr("href", Routes.AppRoute.print(Routes.AppRoute.Products({ search: {} })))
      .children("← All products")
    const shell = h.section
      .attr("data-page-chunk", PRODUCT_DETAIL_PAGE_CHUNK)
      .attr("data-query", GetProduct.GET_PRODUCT_QUERY_CHUNK)
      .class(Design.ui.stack)
    const result = h.queries.product
    if (AsyncResult.isInitial(result))
      return shell.children(h.h1.class(Design.ui.title).children("Loading product…"), back)
    if (AsyncResult.isFailure(result)) {
      return shell.children(
        h.h1.class(Design.ui.title).children("Couldn't load the product"),
        h.p.class(Design.ui.muted).children("Something went wrong while loading this product. Please try again."),
        back
      )
    }
    const product = Option.getOrUndefined(result.value)
    if (product === undefined) {
      // `data-http-status` is what `renderPage` reads back to answer 404 for exactly this render.
      return shell
        .attr(Status.NOT_FOUND_ATTRIBUTE, "404")
        .children(
          h.h1.class(Design.ui.title).children("Unknown product"),
          h.p.class(Design.ui.muted).children(`There is no product "${h.props.id}".`),
          back
        )
    }
    return shell.attr("data-catalog", Products.CATALOG_CHUNK).children(
      h.h1.class(Design.ui.title).children(product.name),
      h.p.class(Design.ui.muted).children(product.blurb),
      h.p
        .attr("data-testid", "detail-total")
        .children(
          `${model.quantity} × ${Products.formatPrice(product.priceCents)} = ${Products.formatPrice(model.quantity * product.priceCents)}`
        ),
      h.div.class(Design.ui.row).children(
        Button(h, { onPress: ProductDetailPageMessage.ClickedLessQuantity() })
          .class(Design.ui.button)
          .attr("aria-label", "Less")
          .attr("data-testid", "detail-less")
          .children("−"),
        Button(h, { onPress: ProductDetailPageMessage.ClickedMoreQuantity() })
          .class(Design.ui.button)
          .attr("aria-label", "More")
          .attr("data-testid", "detail-more")
          .children("+"),
        Button(h, {
          props: { disabled: model.bookmark !== "Idle" },
          onPress: ProductDetailPageMessage.ClickedBookmark()
        })
          .class(Design.ui.button)
          .attr("data-testid", "detail-bookmark")
          .children(model.bookmark === "Idle" ? "Bookmark" : model.bookmark === "Saving" ? "Saving…" : "Bookmarked ✓"),
        Dialog(h, {
          props: { open: model.inquiryOpen },
          onEmit: {
            RequestedOpen: () => ProductDetailPageMessage.RequestedOpenInquiry(),
            RequestedClose: () => ProductDetailPageMessage.RequestedCloseInquiry(),
            Settled: () => undefined
          },
          view: (dialog) =>
            h.div.class("contents").children(
              dialog
                .trigger(h.button.class(Design.ui.button))
                .attr("data-testid", "inquiry-trigger")
                .children("Ask a question"),
              dialog.portal(h.dialog)?.children(
                dialog.backdrop(h.div.class(backdropClass)),
                dialog.viewport(h.div.class(viewportClass)).children(
                  dialog
                    .popup(h.div.class(popupClass))
                    .attr("data-testid", "inquiry-popup")
                    .children(
                      h.div.class(Design.ui.stack).children(
                        dialog.title(h.h2.class("text-lg font-semibold")).children(`About ${product.name}`),
                        dialog.description(h.p.class(Design.ui.muted)).children("We usually reply within a day."),
                        Input(h, {
                          props: { value: model.question },
                          onUpdate: ({ value }) => ProductDetailPageMessage.UpdatedQuestion({ value })
                        })
                          .class(Design.ui.input)
                          .attrs({
                            placeholder: "Your question",
                            "aria-label": "Your question",
                            "data-testid": "inquiry-input"
                          }),
                        h.div
                          .class(`${Design.ui.row} justify-end`)
                          .children(
                            dialog
                              .close(h.button.class(Design.ui.button))
                              .attr("data-testid", "inquiry-close")
                              .children("Cancel"),
                            Button(h, { onPress: ProductDetailPageMessage.ClickedSendQuestion() })
                              .class(Design.ui.button)
                              .attr("data-testid", "inquiry-send")
                              .children("Send")
                          )
                      )
                    )
                )
              )
            )
        })
      ),
      model.sentQuestion === null
        ? undefined
        : h.p
            .class(Design.ui.muted)
            .attr("data-testid", "inquiry-sent")
            .children(`Question sent: “${model.sentQuestion}”`),
      back
    )
  }
})

/**
 * The page with its own Layers: the `GetProduct` query over `CatalogPort` and the `BookmarkProduct`
 * Command over `BookmarkPort`. All four ship in this page's chunk.
 */
export const ProductDetailPage = ProductDetailPageNoDeps.pipe(
  Component.provide(
    Layer.mergeAll(GetProduct.GetProduct.layer, BookmarkProduct.BookmarkProduct.layer).pipe(
      Layer.provide(Layer.mergeAll(CatalogPort.CatalogPort.layer, BookmarkPort.BookmarkPort.layer))
    )
  )
)
