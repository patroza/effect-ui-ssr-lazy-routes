import type { View } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import { AlertDialog, type AlertDialogParts, Dialog } from "@effect/ui-kit"
import {
  AlertDialogBackdrop,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogViewport
} from "#ui/alert-dialog"
import { Button, buttonVariants } from "#ui/button"
import {
  DialogBackdrop,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogViewport
} from "#ui/dialog"
import { Input } from "#ui/input"
import * as CommandResult from "../../design/commandResult.ts"
import * as FormControls from "../../form/FormControls.ts"
import type * as SchemaForm from "../../form/SchemaForm.ts"
import type * as I18n from "../../i18n/I18n.ts"
import * as Warehouse from "../domain/Warehouse.ts"
import * as WarehouseState from "../WarehouseState.ts"

const blockReasons: ReadonlyArray<Warehouse.BlockReason> = ["maintenance", "damage", "inventory", "other"]

const confirmAlertDialog = <M>(
  h: Html.H<M>,
  options: {
    readonly key: string
    readonly open: boolean
    readonly onClose: () => M
    readonly popupTestId: string
    readonly titleText: string
    readonly descriptionText: string
    readonly cancelLabel: string
    readonly cancelTestId: string
    readonly confirmLabel: string
    readonly confirmBusyLabel?: string | undefined
    readonly confirmBusy?: boolean | undefined
    readonly confirmVariant: "primary" | "danger"
    readonly confirmTestId: string
    readonly onConfirm: M
  }
) =>
  AlertDialog(h, {
    key: options.key,
    props: { open: options.open },
    onEmit: {
      RequestedOpen: () => undefined,
      RequestedClose: options.onClose,
      Settled: () => undefined
    },
    view: (alert: AlertDialogParts) =>
      h.div.class("contents").children(
        alert.portal(h.dialog)?.children(
          AlertDialogBackdrop(h, alert),
          AlertDialogViewport(h, alert).children(
            AlertDialogPopup(h, alert)
              .attr("data-testid", options.popupTestId)
              .children(
                options.open
                  ? AlertDialogHeader(h).children(
                      AlertDialogTitle(h, alert).children(options.titleText),
                      AlertDialogDescription(h, alert).children(options.descriptionText)
                    )
                  : undefined,
                options.open
                  ? AlertDialogFooter(h).children(
                      alert
                        .initialFocus(alert.close(h.button.class(buttonVariants({ variant: "outline" }))))
                        .attr("data-testid", options.cancelTestId)
                        .children(options.cancelLabel),
                      CommandResult.commandButton(h, {
                        label: options.confirmLabel,
                        busyLabel: options.confirmBusyLabel,
                        busy: options.confirmBusy,
                        variant: options.confirmVariant,
                        testId: options.confirmTestId,
                        onPress: options.onConfirm
                      })
                    )
                  : undefined
              )
          )
        )
      )
  })

const modalDialog = <M>(
  h: Html.H<M>,
  options: {
    readonly key: string
    readonly open: boolean
    readonly onClose: () => M
    readonly popupTestId: string
    readonly titleText: string
    readonly descriptionText: string
    readonly ready: boolean
    readonly body: View.Input<M, never>
    readonly cancelLabel: string
    readonly cancelTestId: string
    readonly submitLabel: string
    readonly submitBusyLabel?: string | undefined
    readonly submitBusy?: boolean | undefined
    readonly submitTestId: string
    readonly onSubmit: M
  }
) =>
  Dialog(h, {
    key: options.key,
    props: { open: options.open },
    onEmit: {
      RequestedOpen: () => undefined,
      RequestedClose: options.onClose,
      Settled: () => undefined
    },
    view: (dialog) =>
      h.div.class("contents").children(
        dialog.portal(h.dialog)?.children(
          DialogBackdrop(h, dialog),
          DialogViewport(h, dialog).children(
            DialogPopup(h, dialog)
              .attr("data-testid", options.popupTestId)
              .children(
                options.ready
                  ? DialogHeader(h).children(
                      DialogTitle(h, dialog).children(options.titleText),
                      DialogDescription(h, dialog).children(options.descriptionText)
                    )
                  : undefined,
                options.ready ? options.body : undefined,
                options.ready
                  ? DialogFooter(h).children(
                      dialog
                        .close(h.button.class(buttonVariants({ variant: "outline" })))
                        .attr("data-testid", options.cancelTestId)
                        .children(options.cancelLabel),
                      CommandResult.commandButton(h, {
                        label: options.submitLabel,
                        busyLabel: options.submitBusyLabel,
                        busy: options.submitBusy,
                        variant: "primary",
                        testId: options.submitTestId,
                        onPress: options.onSubmit
                      })
                    )
                  : undefined
              )
          )
        )
      )
  })

export const renderWarehouseDialogs = (
  h: Html.H<WarehouseState.WarehouseMsg>,
  model: WarehouseState.WarehouseModel,
  blockForm: Warehouse.BlockCartSchemaFormController,
  blockDerived:
    | SchemaForm.DerivedFormState<Warehouse.BlockCartFormValues, SchemaForm.FieldPath<Warehouse.BlockCartFormValues>>
    | undefined,
  i18n: I18n.I18nTranslator
) => {
  const { formatCurrency, t } = i18n
  const blockDialogModel = model.blockDialog
  const releaseAlertModel = model.releaseAlert
  const dispatchModalModel = model.dispatchModal
  const sessionPromptModel = model.sessionPrompt

  return [
    modalDialog(h, {
      key: "block-cart-dialog",
      open: blockDialogModel !== null && sessionPromptModel === null,
      onClose: () => WarehouseState.WarehouseMessage.RequestedCloseBlockDialog(),
      popupTestId: "block-dialog-popup",
      titleText:
        blockDialogModel === null ? "" : t("warehouse.blockDialogTitle", { cartCode: blockDialogModel.cartCode }),
      descriptionText: t("warehouse.blockDialogDescription"),
      ready: blockDialogModel !== null && blockDerived !== undefined,
      body:
        blockDialogModel === null || blockDerived === undefined
          ? undefined
          : [
              blockDialogModel.failure === null
                ? undefined
                : CommandResult.commandErrorBanner(h, {
                    title: Warehouse.describeWarehouseFailure(t, blockDialogModel.failure),
                    span: blockDialogModel.failure.failureSpan
                  }),
              h.div.class("flex flex-col gap-1.5").children(
                h.span.class("text-[13px] font-medium").children(blockForm.labelFor("reason")),
                h.div.class("flex flex-wrap gap-2").children(
                  blockReasons.map((reason) =>
                    Button(h, {
                      variant: blockDialogModel.form.values.reason === reason ? "default" : "outline",
                      onPress: WarehouseState.WarehouseMessage.ChangedBlockReason({ reason })
                    })
                      .key(reason)
                      .attr("aria-pressed", blockDialogModel.form.values.reason === reason ? "true" : "false")
                      .attr("data-testid", `block-reason-${reason}`)
                      .children(Warehouse.blockReasonLabel(t, reason))
                  )
                )
              ),
              FormControls.textField(h, {
                fieldKey: "block-note-field",
                name: "note",
                label: blockForm.labelFor("note"),
                description: blockForm.meta["note"]?.description,
                value: blockDialogModel.form.values.note,
                state: blockDerived.field("note"),
                required:
                  blockDialogModel.form.values.reason === "damage" || blockDialogModel.form.values.reason === "other",
                disabled: blockDialogModel.submitting,
                testId: "block-note-input",
                errorTestId: "block-note-error",
                onUpdate: (note) => WarehouseState.WarehouseMessage.ChangedBlockNote({ note }),
                onBlur: WarehouseState.WarehouseMessage.BlurredBlockField({ path: "note" })
              })
            ],
      cancelLabel: t("common.cancel"),
      cancelTestId: "block-dialog-cancel",
      submitLabel: t("warehouse.blockSubmit"),
      submitBusyLabel: t("warehouse.blockSubmitting"),
      submitBusy: blockDialogModel?.submitting,
      submitTestId: "block-dialog-submit",
      onSubmit: WarehouseState.WarehouseMessage.SubmittedBlockForm()
    }),

    confirmAlertDialog(h, {
      key: "release-alert-dialog",
      open: releaseAlertModel !== null && sessionPromptModel === null,
      onClose: () => WarehouseState.WarehouseMessage.RequestedCloseReleaseAlert(),
      popupTestId: "release-alert-popup",
      titleText:
        releaseAlertModel === null
          ? ""
          : t("warehouse.releaseAlertTitle", { cartCode: releaseAlertModel.preflight.cartCode }),
      descriptionText: t("warehouse.releaseAlertDescription"),
      cancelLabel: t("common.cancel"),
      cancelTestId: "release-alert-cancel",
      confirmLabel: t("warehouse.releaseConfirm"),
      confirmBusyLabel: t("common.loading"),
      confirmBusy: releaseAlertModel?.submitting,
      confirmVariant: "danger",
      confirmTestId: "release-alert-confirm",
      onConfirm: WarehouseState.WarehouseMessage.ConfirmedReleaseCart()
    }),

    confirmAlertDialog(h, {
      key: "dispatch-alert-dialog",
      open: dispatchModalModel !== null && dispatchModalModel.preflight.warningCount === 0,
      onClose: () => WarehouseState.WarehouseMessage.RequestedCloseDispatchModal(),
      popupTestId: "dispatch-alert-popup",
      titleText:
        dispatchModalModel === null
          ? ""
          : t("warehouse.dispatchTitleClean", { cartCode: dispatchModalModel.preflight.cartCode }),
      descriptionText:
        dispatchModalModel === null
          ? ""
          : t("warehouse.dispatchDescClean", {
              pickCount: dispatchModalModel.preflight.pickCount,
              value: formatCurrency(dispatchModalModel.preflight.valueCents)
            }),
      cancelLabel: t("common.cancel"),
      cancelTestId: "dispatch-cancel",
      confirmLabel: t("warehouse.dispatchConfirm"),
      confirmVariant: "primary",
      confirmTestId: "dispatch-confirm",
      onConfirm: WarehouseState.WarehouseMessage.ConfirmedDispatchCart()
    }),

    modalDialog(h, {
      key: "dispatch-warn-dialog",
      open: dispatchModalModel !== null && dispatchModalModel.preflight.warningCount > 0,
      onClose: () => WarehouseState.WarehouseMessage.RequestedCloseDispatchModal(),
      popupTestId: "dispatch-warn-popup",
      titleText:
        dispatchModalModel === null
          ? ""
          : t("warehouse.dispatchTitleWarn", { cartCode: dispatchModalModel.preflight.cartCode }),
      descriptionText:
        dispatchModalModel === null
          ? ""
          : t("warehouse.dispatchDescWarn", {
              cartCode: dispatchModalModel.preflight.cartCode,
              warningCount: dispatchModalModel.preflight.warningCount
            }),
      ready: dispatchModalModel !== null,
      body:
        dispatchModalModel === null
          ? undefined
          : h.div.class("flex flex-col gap-1.5").children(
              h.label
                .attr("for", "dispatch-audit-note")
                .class("text-[13px] font-medium")
                .children(t("warehouse.dispatchNoteLabel")),
              Input(h, {
                props: { value: dispatchModalModel.auditNote },
                onUpdate: ({ value }) => WarehouseState.WarehouseMessage.ChangedDispatchAuditNote({ note: value })
              }).attrs({
                id: "dispatch-audit-note",
                placeholder: t("warehouse.dispatchNotePlaceholder"),
                "data-testid": "dispatch-audit-input"
              }),
              dispatchModalModel.noteError
                ? h.p
                    .class("text-xs text-destructive")
                    .attr("data-testid", "dispatch-audit-error")
                    .children(t("warehouse.dispatchNoteError"))
                : undefined
            ),
      cancelLabel: t("common.cancel"),
      cancelTestId: "dispatch-warn-cancel",
      submitLabel: t("warehouse.dispatchConfirm"),
      submitTestId: "dispatch-warn-confirm",
      onSubmit: WarehouseState.WarehouseMessage.ConfirmedDispatchCart()
    }),

    confirmAlertDialog(h, {
      key: "session-expired-alert",
      open: sessionPromptModel !== null,
      onClose: () => WarehouseState.WarehouseMessage.RequestedCloseSessionPrompt(),
      popupTestId: "session-expired-popup",
      titleText: t("warehouse.sessionDialogTitle"),
      descriptionText: t("warehouse.sessionDialogBody"),
      cancelLabel: t("common.cancel"),
      cancelTestId: "session-expired-cancel",
      confirmLabel: t("warehouse.sessionDialogConfirm"),
      confirmBusyLabel: t("warehouse.sessionDialogSubmitting"),
      confirmBusy: sessionPromptModel?.refreshing,
      confirmVariant: "primary",
      confirmTestId: "session-expired-confirm",
      onConfirm: WarehouseState.WarehouseMessage.ConfirmedSessionRefresh()
    })
  ]
}
