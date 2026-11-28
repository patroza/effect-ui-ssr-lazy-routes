import { Component, Head } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { ToastProvider } from "@effect/ui-kit"
import { Layer, Schema } from "effect"
import { Button } from "#ui/button"
import {
  Toast,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastIcon,
  ToastText,
  ToastTitle,
  ToastViewport
} from "#ui/toast"
import * as Design from "../design/classes.ts"
import * as CommandResult from "../design/commandResult.ts"
import * as QueryResult from "../design/queryResult.ts"
import * as I18n from "../i18n/I18n.ts"
import * as WarehouseCommands from "../warehouse/commands/WarehouseCommands.ts"
import * as WarehouseDialogs from "../warehouse/components/WarehouseDialogs.ts"
import * as Warehouse from "../warehouse/domain/Warehouse.ts"
import * as GetWarehouseCarts from "../warehouse/queries/GetWarehouseCarts.ts"
import * as WarehouseState from "../warehouse/WarehouseState.ts"

/** Marker proving the Warehouse route lands in its own lazy chunk (see scripts/verify-bundles.ts). */
export const WAREHOUSE_PAGE_CHUNK = "SENTINEL:warehouse-page"

export const WarehouseMessage = WarehouseState.WarehouseMessage

const statusBadgeClass = (status: Warehouse.CartStatus): string => {
  switch (status) {
    case "Free":
      return "rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success"
    case "InUse":
      return "rounded-full border border-warning/30 bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning"
    case "Blocked":
      return "rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive"
    case "Dispatched":
      return "rounded-full bg-brand-wash px-2.5 py-0.5 text-xs font-medium text-brand"
  }
}

const cartStatusLabel = (t: I18n.TranslateFn, status: Warehouse.CartStatus): string => {
  switch (status) {
    case "Free":
      return t("warehouse.statusFree")
    case "InUse":
      return t("warehouse.statusInUse")
    case "Blocked":
      return t("warehouse.statusBlocked")
    case "Dispatched":
      return t("warehouse.statusDispatched")
  }
}

const renderTracePanel = (
  h: Html.H<WarehouseState.WarehouseMsg>,
  model: WarehouseState.WarehouseModel,
  t: I18n.TranslateFn
) =>
  h.div
    .class(`${Design.ui.card} flex flex-col gap-1.5`)
    .attr("data-testid", "warehouse-trace-panel")
    .children(
      h.h2.class("text-sm font-semibold").children(t("warehouse.tracePanelTitle")),
      model.lastOriginSpan === null && model.lastExecutionSpan === null
        ? h.p.class(Design.ui.muted).children(t("warehouse.traceEmpty"))
        : h.div.class("flex flex-col gap-1 font-mono text-xs text-muted-foreground").children(
            model.lastOriginSpan === null
              ? undefined
              : h.div.attr("data-testid", "trace-origin-span").children(
                  t("warehouse.traceOriginLabel", {
                    traceId: model.lastOriginSpan.traceId,
                    spanId: model.lastOriginSpan.spanId
                  })
                ),
            model.lastExecutionSpan === null
              ? undefined
              : h.div.attr("data-testid", "trace-exec-span").children(
                  t("warehouse.traceExecLabel", {
                    traceId: model.lastExecutionSpan.traceId,
                    spanId: model.lastExecutionSpan.spanId
                  })
                )
          )
    )

const WarehouseConsoleNoDeps = WarehouseState.WarehouseConsoleSpec.make({
  init: WarehouseState.initWarehouseModel,
  update: WarehouseState.updateWarehouseModel,
  view: (h, model) => {
    const i18n = I18n.translator(h.reads.i18n)
    const { formatCurrency, t } = i18n
    const blockForm = Warehouse.getBlockCartSchemaForm(h.reads.i18n.locale)
    const cartsStatus = QueryResult.read(h.queries.carts)
    const blockDerived = model.blockDialog === null ? undefined : blockForm.derive(model.blockDialog.form)

    return h.section
      .attr("data-page-chunk", WAREHOUSE_PAGE_CHUNK)
      .attr("data-warehouse-schema", Warehouse.WAREHOUSE_SCHEMA_CHUNK)
      .attr("data-warehouse-query", GetWarehouseCarts.GET_WAREHOUSE_CARTS_QUERY_CHUNK)
      .class(Design.ui.stack)
      .children(
        h.div.children(
          h.h1.class(Design.ui.title).children(t("warehouse.heading")),
          h.p.class(Design.ui.muted).children(t("warehouse.subtitle")),
          h.p.class("mt-1 font-mono text-xs text-muted-foreground").children(t("warehouse.patternSummary"))
        ),

        h.div
          .class(`${Design.ui.card} flex flex-wrap items-center gap-2`)
          .attr("data-testid", "warehouse-controls")
          .children(
            Button(h, {
              variant: model.simSessionExpired ? "brand" : "outline",
              onPress: WarehouseMessage.ToggledSimSessionExpired()
            })
              .attr("aria-pressed", model.simSessionExpired ? "true" : "false")
              .attr("data-testid", "sim-session-expired")
              .children(t("warehouse.simSessionExpired")),
            Button(h, {
              variant: model.simCheckoutConflict ? "brand" : "outline",
              onPress: WarehouseMessage.ToggledSimCheckoutConflict()
            })
              .attr("aria-pressed", model.simCheckoutConflict ? "true" : "false")
              .attr("data-testid", "sim-checkout-conflict")
              .children(t("warehouse.simCheckoutConflict")),
            Button(h, {
              variant: model.toastsEnabled ? "brand" : "outline",
              onPress: WarehouseMessage.ToggledOptInToasts()
            })
              .attr("aria-pressed", model.toastsEnabled ? "true" : "false")
              .attr("data-testid", "toggle-opt-in-toasts")
              .children(t("warehouse.optInToasts"))
          ),

        model.flow._tag === "Running" && model.flow.progress !== null
          ? CommandResult.commandProgressPanel(h, {
              label: t("warehouse.progressRunningTitle", {
                cartCode: model.flow.progress.cartCode,
                step: Warehouse.dispatchStepLabel(t, model.flow.progress.step),
                completed: model.flow.progress.completed,
                total: model.flow.progress.total
              }),
              value: model.flow.progress.completed,
              max: model.flow.progress.total,
              valueText: `${model.flow.progress.completed}/${model.flow.progress.total}`,
              cancelLabel: t("warehouse.progressCancel"),
              testId: "dispatch-progress-panel",
              onCancel: WarehouseMessage.ClickedCancelDispatch({ cartId: model.flow.progress.cartId })
            })
          : undefined,

        model.flow._tag === "Succeeded"
          ? h.div
              .key("workflow-success")
              .class(`${Design.ui.cardSuccess} flex items-center justify-between gap-3`)
              .attrs({ role: "status", "data-testid": "warehouse-success-banner" })
              .children(
                h.span.class("text-sm font-medium text-success").children(model.flow.result.message),
                Button(h, { variant: "outline", onPress: WarehouseMessage.ClickedDismissBanner() }).children(
                  t("common.dismiss")
                )
              )
          : undefined,

        model.flow._tag === "Failed"
          ? CommandResult.commandErrorBanner(h, {
              title: Warehouse.describeWarehouseFailure(t, model.flow.error),
              span: model.flow.failureSpan ?? model.flow.originSpan,
              traceRefLabel: (traceId) => t("common.traceRef", { traceId }),
              retryLabel: t("common.retry"),
              dismissLabel: t("common.dismiss"),
              testId: "warehouse-error-banner",
              onRetry: model.lastRetry === null ? undefined : WarehouseMessage.ClickedRetryLastError(),
              onDismiss: WarehouseMessage.ClickedDismissBanner()
            })
          : undefined,

        QueryResult.isInitial(cartsStatus)
          ? h.p.class(Design.ui.muted).children(t("common.loading"))
          : QueryResult.isFailure(cartsStatus)
            ? QueryResult.errorPanel(h, cartsStatus, {
                title: t("warehouse.actionFeedbackHeading"),
                heading: 2,
                retryLabel: t("common.retry"),
                onRetry: WarehouseMessage.ClickedRefreshCarts()
              })
            : h.div.class(Design.ui.stack).children(
                QueryResult.refreshErrorBanner(h, cartsStatus, {
                  onRetry: WarehouseMessage.ClickedRefreshCarts()
                }),
                h.div
                  .class("grid gap-4 md:grid-cols-2")
                  .attr("data-testid", "warehouse-cart-grid")
                  .children(
                    cartsStatus.data.map((cart) => {
                      const isUnblocking = h.isRunning(WarehouseCommands.UnblockCart, { cartId: cart.id })
                      const isDispatching = h.isRunning(WarehouseCommands.DispatchCartBatch, { cartId: cart.id })
                      const isPreparingRelease =
                        model.preparing?.cartId === cart.id && model.preparing.action === "release"
                      const isPreparingDispatch =
                        model.preparing?.cartId === cart.id && model.preparing.action === "dispatch"
                      const isPreparingCart = model.preparing?.cartId === cart.id
                      const blockReasonText =
                        cart.blockReason === null ? undefined : Warehouse.blockReasonLabel(t, cart.blockReason)
                      return h.div
                        .key(cart.id)
                        .class(`${Design.ui.card} ${Design.ui.stack} justify-between`)
                        .attr("data-testid", `cart-card-${cart.id}`)
                        .children(
                          h.div.class(Design.ui.stack).children(
                            h.div
                              .class("flex items-center justify-between gap-2")
                              .children(
                                h.span.class("font-mono text-base font-semibold").children(cart.code),
                                h.span
                                  .class(statusBadgeClass(cart.status))
                                  .attr("data-testid", `cart-status-${cart.id}`)
                                  .children(cartStatusLabel(t, cart.status))
                              ),
                            h.p.class(Design.ui.muted).children(
                              t("warehouse.cartMeta", {
                                pickCount: cart.pickCount,
                                value: formatCurrency(cart.valueCents),
                                warningCount: cart.warningCount
                              })
                            ),
                            cart.station === null
                              ? undefined
                              : h.p
                                  .class(Design.ui.muted)
                                  .children(t("warehouse.cartStationNote", { station: cart.station })),
                            blockReasonText === undefined
                              ? undefined
                              : h.p
                                  .class(Design.ui.muted)
                                  .children(
                                    `${t("warehouse.cartBlockedNote", { reason: blockReasonText })}${
                                      cart.blockNote === null ? "" : ` — ${cart.blockNote}`
                                    }`
                                  )
                          ),
                          h.div.class(Design.ui.row).children(
                            cart.status === "Blocked"
                              ? CommandResult.commandButton(h, {
                                  label: t("warehouse.btnUnblock"),
                                  busyLabel: t("warehouse.btnUnblocking"),
                                  busy: isUnblocking,
                                  variant: "primary",
                                  testId: `unblock-${cart.id}`,
                                  onPress: WarehouseMessage.ClickedUnblock({ cartId: cart.id, cartCode: cart.code })
                                })
                              : CommandResult.commandButton(h, {
                                  label: t("warehouse.btnBlock"),
                                  disabled: isDispatching || isPreparingCart,
                                  testId: `block-${cart.id}`,
                                  onPress: WarehouseMessage.ClickedOpenBlockDialog({
                                    cartId: cart.id,
                                    cartCode: cart.code
                                  })
                                }),
                            CommandResult.commandButton(h, {
                              label: t("warehouse.btnRelease"),
                              busyLabel: t("warehouse.btnPreparing"),
                              busy: isPreparingRelease,
                              variant: "danger",
                              disabled: cart.status === "Blocked" || isDispatching || isPreparingDispatch,
                              testId: `release-${cart.id}`,
                              onPress: WarehouseMessage.ClickedReleaseCart({ cartId: cart.id, cartCode: cart.code })
                            }),
                            CommandResult.commandButton(h, {
                              label: t("warehouse.btnDispatch"),
                              busyLabel: isDispatching ? t("warehouse.btnDispatching") : t("warehouse.btnPreparing"),
                              busy: isDispatching || isPreparingDispatch,
                              variant: "primary",
                              disabled: (cart.status !== "Free" && cart.status !== "Dispatched") || isPreparingRelease,
                              testId: `dispatch-${cart.id}`,
                              onPress: WarehouseMessage.ClickedDispatchCart({ cartId: cart.id, cartCode: cart.code })
                            })
                          )
                        )
                    })
                  )
              ),

        renderTracePanel(h, model, t),
        ...WarehouseDialogs.renderWarehouseDialogs(h, model, blockForm, blockDerived, i18n)
      )
  }
})

const WarehousePageNoDeps = Html.component({
  name: "WarehousePage",
  props: Schema.Struct({
    locale: Schema.optionalKey(I18n.AppLocale)
  }),
  model: Schema.Struct({}),
  message: Schema.Never
}).make({
  init: () => ({}),
  update: ($) => $.model,
  head: ($) => [Head.title(I18n.translatorFor($.props.locale ?? "en").t("warehouse.pageTitle"))],
  view: (h) => {
    const locale = h.props.locale ?? "en"
    const { t } = I18n.translatorFor(locale)
    return I18n.I18nProvider(h, {
      props: { locale },
      view: () =>
        ToastProvider(h, {
          props: { timeout: 4000, topLayer: false },
          view: (toastProvider) =>
            h.div(
              WarehouseConsoleNoDeps(h, {}),
              ToastViewport(h, toastProvider, { position: "bottom-right", class: "bottom-16 z-50" })
                .attr("aria-label", t("common.notifications"))
                .attr("data-testid", "warehouse-toast-viewport")
                .children(
                  toastProvider.toasts.map((toast) =>
                    Toast(h, toastProvider, toast)
                      .attr("data-testid", `warehouse-toast-${toast.id}`)
                      .children(
                        ToastContent(h, toastProvider, toast).children(
                          ToastIcon(h, toast),
                          ToastText(h).children(
                            toast.title === undefined ? undefined : ToastTitle(h, toastProvider, toast),
                            toast.description === undefined ? undefined : ToastDescription(h, toastProvider, toast)
                          ),
                          ToastClose(h, toastProvider, toast).attr("aria-label", t("common.dismiss"))
                        )
                      )
                  )
                )
            )
        })
    })
  }
})

/**
 * The Warehouse Command Console route with its own query/command Layers scoped
 * strictly to `/warehouse`, isolating `WarehouseRpcs`, `@effect/ui-kit`
 * `ToastProvider` + `AlertDialog` + `Progress`, and the workflow engine inside
 * this lazy route chunk.
 */
export const WarehousePage = WarehousePageNoDeps.pipe(
  Component.provide(Layer.mergeAll(GetWarehouseCarts.GetWarehouseCarts.layer, WarehouseCommands.WarehouseCommandsLayer))
)
