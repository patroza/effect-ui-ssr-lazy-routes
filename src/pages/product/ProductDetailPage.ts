import { Command, Component, Head, UiSchema } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { Dialog } from "@effect/ui-kit"
import { Effect, Layer, Option, Schema } from "effect"
import { Button, buttonVariants } from "#ui/button"
import {
  DialogBackdrop,
  DialogCloseIcon,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogViewport
} from "#ui/dialog"
import { Input } from "#ui/input"
import * as Design from "../../design/classes.ts"
import * as QueryResult from "../../design/queryResult.ts"
import * as Status from "../../lib/status.ts"
import * as BookmarkProduct from "../../product/commands/BookmarkProduct.ts"
import * as Product from "../../product/domain/Product.ts"
import * as GetProduct from "../../product/queries/GetProduct.ts"
import * as Routes from "../../routes.ts"

/** Marker proving which chunk this page lands in (see scripts/verify-bundles.ts). */
export const PRODUCT_DETAIL_PAGE_CHUNK = "SENTINEL:product-detail-page"

export const ProductDetailPageMessage = UiSchema.TaggedEnum({
  ClickedMoreQuantity: {},
  ClickedLessQuantity: {},
  ClickedBookmark: {},
  CompletedBookmarkProduct: {},
  FailedBookmarkProduct: {},
  RequestedOpenInquiry: {},
  RequestedCloseInquiry: {},
  UpdatedQuestion: { value: Schema.String },
  ClickedSendQuestion: {},
  ClickedRefresh: {}
})

const RefreshProduct = Command.make("RefreshProduct", { args: { id: Schema.String } }, ({ id }) =>
  GetProduct.GetProduct.invalidate({ id }).pipe(Effect.as(Component.noop))
)

const ProductDetailPageNoDeps = Html.component({
  name: "ProductDetailPage",
  props: Schema.Struct({ id: Schema.String }),
  model: Schema.Struct({
    quantity: Schema.Finite,
    bookmark: Schema.Literals(["Idle", "Saving", "Saved", "Failed"]),
    inquiryOpen: Schema.Boolean,
    question: Schema.String,
    sentQuestion: Schema.NullOr(Schema.String)
  }),
  message: ProductDetailPageMessage,
  queries: {
    product: { query: GetProduct.GetProduct, args: ({ props }) => ({ id: props.id }) }
  }
}).make({
  init: () => ({ quantity: 1, bookmark: "Idle", inquiryOpen: false, question: "", sentQuestion: null }),
  update: ($, message) =>
    ProductDetailPageMessage.match(message, {
      ClickedMoreQuantity: () => $.evolve({ quantity: (n) => n + 1 }),
      ClickedLessQuantity: () => $.evolve({ quantity: (n) => Math.max(1, n - 1) }),
      ClickedBookmark: () =>
        $.model.bookmark === "Idle" || $.model.bookmark === "Failed"
          ? $.evolve({ bookmark: "Saving" }).run(
              BookmarkProduct.BookmarkProduct.make({ id: $.props.id }).pipe(
                // The command's domain result becomes this page's message here, so the command never imports the page.
                Command.match({
                  onSuccess: () => ProductDetailPageMessage.CompletedBookmarkProduct(),
                  onFailure: () => ProductDetailPageMessage.FailedBookmarkProduct()
                })
              )
            )
          : $.model,
      CompletedBookmarkProduct: () => $.evolve({ bookmark: "Saved" }),
      FailedBookmarkProduct: () => $.evolve({ bookmark: "Failed" }),
      RequestedOpenInquiry: () => $.evolve({ inquiryOpen: true }),
      RequestedCloseInquiry: () => $.evolve({ inquiryOpen: false }),
      UpdatedQuestion: ({ value }) => $.evolve({ question: value }),
      ClickedSendQuestion: () =>
        $.model.question.trim() === ""
          ? $.model
          : $.evolve({ inquiryOpen: false, sentQuestion: $.model.question.trim(), question: "" }),
      ClickedRefresh: () => $.run(RefreshProduct.make({ id: $.props.id }))
    }),
  head: ($) => {
    const product = QueryResult.read($.queries.product)
    if (!QueryResult.isReady(product)) {
      return [Head.title("Product")]
    }
    return [Head.title(Option.match(product.data, { onNone: () => "Unknown product", onSome: (p) => p.name }))]
  },
  view: (h, model) => {
    const back = h.a
      .class(Design.ui.link)
      .attr("href", Routes.AppRoute.print(Routes.AppRoute.Products({ search: {} })))
      .children("← All products")
    const shell = h.section
      .attr("data-page-chunk", PRODUCT_DETAIL_PAGE_CHUNK)
      .attr("data-query", GetProduct.GET_PRODUCT_QUERY_CHUNK)
      .class(Design.ui.stack)

    const result = QueryResult.read(h.queries.product)
    if (QueryResult.isInitial(result)) {
      return shell.children(h.h1.class(Design.ui.title).children("Loading product…"), back)
    }
    if (QueryResult.isFailure(result)) {
      return shell.children(
        QueryResult.errorPanel(h, result, {
          title: "Couldn't load the product",
          httpStatus: "503",
          onRetry: ProductDetailPageMessage.ClickedRefresh()
        }),
        back
      )
    }
    if (Option.isNone(result.data)) {
      // `data-http-status` is what `renderPage` reads back to answer 404 for exactly this render.
      return shell.attr(Status.HTTP_STATUS_ATTRIBUTE, "404").children(
        QueryResult.refreshErrorBanner(h, result, {
          onRetry: ProductDetailPageMessage.ClickedRefresh()
        }),
        h.h1.class(Design.ui.title).children("Unknown product"),
        h.p.class(Design.ui.muted).children(`There is no product "${h.props.id}".`),
        back
      )
    }

    const product = result.data.value
    const bookmarked = model.bookmark === "Saved" || product.bookmarked
    return shell
      .attr("data-product-schema", Product.PRODUCT_SCHEMA_CHUNK)
      .attr("aria-busy", String(result.waiting))
      .children(
        QueryResult.refreshErrorBanner(h, result, {
          onRetry: ProductDetailPageMessage.ClickedRefresh()
        }),
        h.div
          .key("detail-content")
          .class(Design.ui.stack)
          .children(
            h.div.class(`${Design.ui.row} justify-between`).children(
              h.h1.class(Design.ui.title).children(product.name),
              QueryResult.refreshButton(h, result, {
                onRefresh: ProductDetailPageMessage.ClickedRefresh(),
                testId: "detail-refresh"
              })
            ),
            h.p.class(Design.ui.muted).children(product.blurb),
            h.p
              .attr("data-testid", "detail-total")
              .children(
                `${model.quantity} × ${Product.formatPrice(product.priceCents)} = ${Product.formatPrice(model.quantity * product.priceCents)}`
              ),
            h.div.class(Design.ui.row).children(
              Button(h, { variant: "outline", onPress: ProductDetailPageMessage.ClickedLessQuantity() })
                .attr("aria-label", "Less")
                .attr("data-testid", "detail-less")
                .children("−"),
              Button(h, { variant: "outline", onPress: ProductDetailPageMessage.ClickedMoreQuantity() })
                .attr("aria-label", "More")
                .attr("data-testid", "detail-more")
                .children("+"),
              Button(h, {
                variant: "outline",
                props: { disabled: model.bookmark === "Saving" || bookmarked },
                onPress: ProductDetailPageMessage.ClickedBookmark()
              })
                .attr("data-testid", "detail-bookmark")
                .children(
                  bookmarked
                    ? "Bookmarked ✓"
                    : model.bookmark === "Saving"
                      ? "Saving…"
                      : model.bookmark === "Failed"
                        ? "Bookmark failed — retry"
                        : "Bookmark"
                ),
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
                      .trigger(h.button.class(buttonVariants({ variant: "outline" })))
                      .attr("data-testid", "inquiry-trigger")
                      .children("Ask a question"),
                    dialog.portal(h.dialog)?.children(
                      DialogBackdrop(h, dialog),
                      DialogViewport(h, dialog).children(
                        DialogPopup(h, dialog)
                          .attr("data-testid", "inquiry-popup")
                          .children(
                            DialogCloseIcon(h, dialog),
                            DialogHeader(h).children(
                              DialogTitle(h, dialog).children(`About ${product.name}`),
                              DialogDescription(h, dialog).children("We usually reply within a day.")
                            ),
                            Input(h, {
                              props: { value: model.question },
                              onUpdate: ({ value }) => ProductDetailPageMessage.UpdatedQuestion({ value })
                            }).attrs({
                              placeholder: "Your question",
                              "aria-label": "Your question",
                              "data-testid": "inquiry-input"
                            }),
                            DialogFooter(h).children(
                              dialog
                                .close(h.button.class(buttonVariants({ variant: "outline" })))
                                .attr("data-testid", "inquiry-close")
                                .children("Cancel"),
                              Button(h, { onPress: ProductDetailPageMessage.ClickedSendQuestion() })
                                .attr("data-testid", "inquiry-send")
                                .children("Send")
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
      )
  }
})

/**
 * The page with its own Layers: `GetProduct` and `BookmarkProduct` call
 * `ProductRpcs` over the root-provided `RpcClient.Protocol`, keeping the
 * feature's RPC definitions and query/command layers in the ProductDetail chunk.
 */
export const ProductDetailPage = ProductDetailPageNoDeps.pipe(
  Component.provide(Layer.mergeAll(GetProduct.GetProduct.layer, BookmarkProduct.BookmarkProduct.layer))
)
