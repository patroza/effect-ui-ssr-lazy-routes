import { Command, Component, Head, UiSchema } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { AlertDialog, Button, Dialog, Input, ToastProvider } from "@effect/ui-kit"
import { Effect, Layer, Schema } from "effect"
import * as Design from "../design/classes.ts"
import * as CommandResult from "../design/commandResult.ts"
import * as QueryResult from "../design/queryResult.ts"
import * as FormControls from "../form/FormControls.ts"
import * as I18n from "../i18n/I18n.ts"
import * as CommandFlow from "../workflow/CommandFlow.ts"
import * as CommandTrace from "../workflow/CommandTrace.ts"
import * as WarehouseCommands from "../warehouse/commands/WarehouseCommands.ts"
import * as Warehouse from "../warehouse/domain/Warehouse.ts"
import * as GetWarehouseCarts from "../warehouse/queries/GetWarehouseCarts.ts"

/** Marker proving the Warehouse route lands in its own lazy chunk (see scripts/verify-bundles.ts). */
export const WAREHOUSE_PAGE_CHUNK = "SENTINEL:warehouse-page"

const BlockDraftSchema = Warehouse.getBlockCartSchemaForm("en").State

const PendingRetryAction = Schema.Union([
  Schema.TaggedStruct("RetryUnblock", {
    cartId: Schema.String,
    cartCode: Schema.String
  }),
  Schema.TaggedStruct("RetryBlock", {
    cartId: Schema.String,
    cartCode: Schema.String,
    reason: Warehouse.BlockReason,
    note: Schema.String
  }),
  Schema.TaggedStruct("RetryPreflightRelease", {
    cartId: Schema.String,
    cartCode: Schema.String
  }),
  Schema.TaggedStruct("RetryRelease", {
    preflight: Warehouse.PreflightReleaseResult
  }),
  Schema.TaggedStruct("RetryPreflightDispatch", {
    cartId: Schema.String,
    cartCode: Schema.String
  }),
  Schema.TaggedStruct("RetryDispatchStream", {
    preflight: Warehouse.PreflightDispatchResult,
    auditNote: Schema.String
  })
])
type PendingRetryAction = typeof PendingRetryAction.Type

const WorkflowIntent = Schema.Union([
  Schema.TaggedStruct("Unblock", { cartId: Schema.String, cartCode: Schema.String }),
  Schema.TaggedStruct("Block", { cartId: Schema.String, cartCode: Schema.String }),
  Schema.TaggedStruct("Release", { cartId: Schema.String, cartCode: Schema.String }),
  Schema.TaggedStruct("Dispatch", { cartId: Schema.String, cartCode: Schema.String })
])
type WorkflowIntent = typeof WorkflowIntent.Type

const WorkflowSuccess = Schema.Struct({
  message: Schema.String
})

const WarehouseFlow = CommandFlow.makeCommandFlow({
  intent: WorkflowIntent,
  draft: Schema.Null,
  progress: Schema.Struct({
    cartId: Schema.String,
    cartCode: Schema.String,
    step: Warehouse.DispatchStepKey,
    completed: Schema.Finite,
    total: Schema.Finite
  }),
  result: WorkflowSuccess,
  error: Warehouse.WarehouseCommandFailure
})

const BlockDialogState = Schema.Struct({
  cartId: Schema.String,
  cartCode: Schema.String,
  form: BlockDraftSchema,
  submitting: Schema.Boolean,
  originSpan: Schema.NullOr(CommandTrace.SpanPointer),
  failure: Schema.NullOr(Warehouse.WarehouseCommandFailure)
})

const ReleaseAlertState = Schema.Struct({
  preflight: Warehouse.PreflightReleaseResult,
  originSpan: Schema.NullOr(CommandTrace.SpanPointer),
  submitting: Schema.Boolean
})

const DispatchModalState = Schema.Struct({
  preflight: Warehouse.PreflightDispatchResult,
  auditNote: Schema.String,
  noteError: Schema.Boolean,
  originSpan: Schema.NullOr(CommandTrace.SpanPointer)
})

const SessionPromptState = Schema.Struct({
  pending: PendingRetryAction,
  originSpan: Schema.NullOr(CommandTrace.SpanPointer),
  refreshing: Schema.Boolean
})

export const WarehouseMessage = UiSchema.TaggedEnum({
  ToggledSimSessionExpired: {},
  ToggledSimCheckoutConflict: {},
  ToggledOptInToasts: {},
  ClickedRefreshCarts: {},
  ClickedUnblock: { cartId: Schema.String, cartCode: Schema.String },
  SucceededUnblock: {
    cartId: Schema.String,
    cartCode: Schema.String,
    span: Schema.NullOr(CommandTrace.SpanPointer)
  },
  ClickedOpenBlockDialog: { cartId: Schema.String, cartCode: Schema.String },
  ChangedBlockReason: { reason: Warehouse.BlockReason },
  ChangedBlockNote: { note: Schema.String },
  BlurredBlockField: { path: Warehouse.BlockCartFieldPath },
  RequestedCloseBlockDialog: {},
  SubmittedBlockForm: {},
  SucceededBlock: {
    cartCode: Schema.String,
    reason: Warehouse.BlockReason,
    span: Schema.NullOr(CommandTrace.SpanPointer)
  },
  ClickedReleaseCart: { cartId: Schema.String, cartCode: Schema.String },
  SucceededPreflightRelease: {
    preflight: Warehouse.PreflightReleaseResult,
    span: Schema.NullOr(CommandTrace.SpanPointer)
  },
  RequestedCloseReleaseAlert: {},
  ConfirmedReleaseCart: {},
  SucceededRelease: {
    cartCode: Schema.String,
    clearedPicks: Schema.Finite,
    span: Schema.NullOr(CommandTrace.SpanPointer)
  },
  ClickedDispatchCart: { cartId: Schema.String, cartCode: Schema.String },
  SucceededPreflightDispatch: {
    preflight: Warehouse.PreflightDispatchResult,
    span: Schema.NullOr(CommandTrace.SpanPointer)
  },
  ChangedDispatchAuditNote: { note: Schema.String },
  RequestedCloseDispatchModal: {},
  ConfirmedDispatchCart: {},
  ProgressedDispatch: {
    cartId: Schema.String,
    cartCode: Schema.String,
    step: Warehouse.DispatchStepKey,
    completed: Schema.Finite,
    total: Schema.Finite,
    batchId: Schema.NullOr(Schema.String),
    span: Schema.NullOr(CommandTrace.SpanPointer)
  },
  ClickedCancelDispatch: { cartId: Schema.String },
  FailedAction: {
    retry: PendingRetryAction,
    intent: WorkflowIntent,
    failure: Warehouse.WarehouseCommandFailure,
    fromBlockDialog: Schema.Boolean
  },
  ClickedRetryLastError: {},
  ClickedDismissBanner: {},
  RequestedCloseSessionPrompt: {},
  ConfirmedSessionRefresh: {},
  SucceededSessionRefresh: { span: Schema.NullOr(CommandTrace.SpanPointer) },
  FailedSessionRefresh: { failure: Warehouse.WarehouseCommandFailure }
})

const RefreshCarts = Command.make("warehouse/RefreshCarts", { args: {} }, () =>
  GetWarehouseCarts.GetWarehouseCarts.invalidate({}).pipe(Effect.as(Component.noop))
)

const statusBadgeClass = (status: Warehouse.CartStatus): string => {
  switch (status) {
    case "Free":
      return "rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
    case "InUse":
      return "rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
    case "Blocked":
      return "rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950/60 dark:text-red-300"
    case "Dispatched":
      return "rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
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

const dispatchToastId = (cartId: string): string => `warehouse-dispatch-${cartId}`

const issuePendingAction = (
  action: PendingRetryAction,
  options: {
    readonly simulateConflict: boolean
    readonly simulateExpired: boolean
    readonly originSpan: CommandTrace.SpanPointer | null
  }
) => {
  switch (action._tag) {
    case "RetryUnblock":
      return WarehouseCommands.UnblockCart.make({
        cartId: action.cartId,
        simulateConflict: options.simulateConflict,
        simulateExpired: options.simulateExpired,
        originSpan: options.originSpan
      }).pipe(
        Command.afterRefetch("2 seconds"),
        Command.match({
          onSuccess: ({ value, span }) =>
            WarehouseMessage.SucceededUnblock({ cartId: value.id, cartCode: value.code, span }),
          onFailure: (failure) =>
            WarehouseMessage.FailedAction({
              retry: action,
              intent: { _tag: "Unblock", cartId: action.cartId, cartCode: action.cartCode },
              failure,
              fromBlockDialog: false
            })
        })
      )
    case "RetryBlock":
      return WarehouseCommands.BlockCart.make({
        cartId: action.cartId,
        reason: action.reason,
        note: action.note,
        simulateExpired: options.simulateExpired,
        originSpan: options.originSpan
      }).pipe(
        Command.match({
          onSuccess: ({ value, span }) =>
            WarehouseMessage.SucceededBlock({
              cartCode: value.code,
              reason: action.reason,
              span
            }),
          onFailure: (failure) =>
            WarehouseMessage.FailedAction({
              retry: action,
              intent: { _tag: "Block", cartId: action.cartId, cartCode: action.cartCode },
              failure,
              fromBlockDialog: true
            })
        })
      )
    case "RetryPreflightRelease":
      return WarehouseCommands.PreflightReleaseCart.make({
        cartId: action.cartId,
        simulateExpired: options.simulateExpired,
        originSpan: options.originSpan
      }).pipe(
        Command.match({
          onSuccess: ({ value, span }) => WarehouseMessage.SucceededPreflightRelease({ preflight: value, span }),
          onFailure: (failure) =>
            WarehouseMessage.FailedAction({
              retry: action,
              intent: { _tag: "Release", cartId: action.cartId, cartCode: action.cartCode },
              failure,
              fromBlockDialog: false
            })
        })
      )
    case "RetryRelease":
      return WarehouseCommands.ReleaseCart.make({
        cartId: action.preflight.cartId,
        simulateExpired: options.simulateExpired,
        originSpan: options.originSpan
      }).pipe(
        Command.match({
          onSuccess: ({ value, span }) =>
            WarehouseMessage.SucceededRelease({
              cartCode: value.cart.code,
              clearedPicks: value.clearedPicks,
              span
            }),
          onFailure: (failure) =>
            WarehouseMessage.FailedAction({
              retry: action,
              intent: {
                _tag: "Release",
                cartId: action.preflight.cartId,
                cartCode: action.preflight.cartCode
              },
              failure,
              fromBlockDialog: false
            })
        })
      )
    case "RetryPreflightDispatch":
      return WarehouseCommands.PreflightDispatchCart.make({
        cartId: action.cartId,
        simulateConflict: options.simulateConflict,
        simulateExpired: options.simulateExpired,
        originSpan: options.originSpan
      }).pipe(
        Command.match({
          onSuccess: ({ value, span }) => WarehouseMessage.SucceededPreflightDispatch({ preflight: value, span }),
          onFailure: (failure) =>
            WarehouseMessage.FailedAction({
              retry: action,
              intent: { _tag: "Dispatch", cartId: action.cartId, cartCode: action.cartCode },
              failure,
              fromBlockDialog: false
            })
        })
      )
    case "RetryDispatchStream":
      return WarehouseCommands.DispatchCartBatch.make({
        cartId: action.preflight.cartId,
        auditNote: action.auditNote,
        simulateExpired: options.simulateExpired,
        originSpan: options.originSpan
      }).pipe(
        Command.match({
          onSuccess: ({ value, span }) =>
            WarehouseMessage.ProgressedDispatch({
              cartId: action.preflight.cartId,
              cartCode: action.preflight.cartCode,
              step: value.step,
              completed: value.completed,
              total: value.total,
              batchId: value.batchId,
              span
            }),
          onFailure: (failure) =>
            WarehouseMessage.FailedAction({
              retry: action,
              intent: {
                _tag: "Dispatch",
                cartId: action.preflight.cartId,
                cartCode: action.preflight.cartCode
              },
              failure,
              fromBlockDialog: false
            })
        })
      )
  }
}

const blockReasons: ReadonlyArray<Warehouse.BlockReason> = ["maintenance", "damage", "inventory", "other"]

const WarehouseConsoleNoDeps = Html.component({
  name: "WarehouseConsole",
  model: Schema.Struct({
    simSessionExpired: Schema.Boolean,
    simCheckoutConflict: Schema.Boolean,
    toastsEnabled: Schema.Boolean,
    blockDialog: Schema.NullOr(BlockDialogState),
    releaseAlert: Schema.NullOr(ReleaseAlertState),
    dispatchModal: Schema.NullOr(DispatchModalState),
    sessionPrompt: Schema.NullOr(SessionPromptState),
    lastRetry: Schema.NullOr(PendingRetryAction),
    preparing: Schema.NullOr(
      Schema.Struct({
        cartId: Schema.String,
        action: Schema.Literals(["release", "dispatch"])
      })
    ),
    flow: WarehouseFlow.State,
    lastOriginSpan: Schema.NullOr(CommandTrace.SpanPointer),
    lastExecutionSpan: Schema.NullOr(CommandTrace.SpanPointer)
  }),
  message: WarehouseMessage,
  reads: {
    i18n: I18n.I18nProvider,
    toastProvider: { owner: ToastProvider, optional: true }
  },
  queries: {
    carts: { query: GetWarehouseCarts.GetWarehouseCarts, args: () => ({}) }
  },
  restore: (model) => ({
    ...model,
    preparing: null,
    flow: WarehouseFlow.restore(model.flow),
    blockDialog: model.blockDialog === null ? null : { ...model.blockDialog, submitting: false },
    releaseAlert: model.releaseAlert === null ? null : { ...model.releaseAlert, submitting: false },
    sessionPrompt: model.sessionPrompt === null ? null : { ...model.sessionPrompt, refreshing: false }
  })
}).make({
  init: () => ({
    simSessionExpired: false,
    simCheckoutConflict: false,
    toastsEnabled: false,
    blockDialog: null,
    releaseAlert: null,
    dispatchModal: null,
    sessionPrompt: null,
    lastRetry: null,
    preparing: null,
    flow: WarehouseFlow.idle,
    lastOriginSpan: null,
    lastExecutionSpan: null
  }),
  update: ($, message) => {
    const { locale } = $.reads.i18n
    const { t } = I18n.translatorFor(locale)
    const blockForm = Warehouse.getBlockCartSchemaForm(locale)

    const maybeSendToast = (
      step: ReturnType<typeof $.set>,
      cartId: string,
      title: string,
      type: "loading" | "success" | "error",
      description?: string
    ) => {
      if (!$.model.toastsEnabled) return step
      return type === "loading"
        ? step.send(ToastProvider, {
            _tag: "RequestedAdd",
            toast: {
              id: dispatchToastId(cartId),
              title,
              type,
              ...(description === undefined ? {} : { description })
            }
          })
        : step.send(ToastProvider, {
            _tag: "RequestedUpdate",
            id: dispatchToastId(cartId),
            title,
            type,
            ...(description === undefined ? {} : { description }),
            timeout: 4000
          })
    }

    return WarehouseMessage.match(message, {
      ToggledSimSessionExpired: () => $.evolve({ simSessionExpired: !$.model.simSessionExpired }),
      ToggledSimCheckoutConflict: () => $.evolve({ simCheckoutConflict: !$.model.simCheckoutConflict }),
      ToggledOptInToasts: () => $.evolve({ toastsEnabled: !$.model.toastsEnabled }),
      ClickedRefreshCarts: () => $.run(RefreshCarts.make()),

      ClickedUnblock: ({ cartId, cartCode }) => {
        const retry: PendingRetryAction = { _tag: "RetryUnblock", cartId, cartCode }
        const flow = WarehouseFlow.start($.model.flow, { _tag: "Unblock", cartId, cartCode }, null, null)
        return $.evolve({ flow, lastRetry: retry }).run(
          issuePendingAction(retry, {
            simulateConflict: $.model.simCheckoutConflict,
            simulateExpired: $.model.simSessionExpired,
            originSpan: null
          })
        )
      },

      SucceededUnblock: ({ cartId, cartCode, span }) => {
        const nextFlow = WarehouseFlow.succeeded(
          $.model.flow,
          { _tag: "Unblock", cartId, cartCode },
          { message: t("warehouse.successUnblock", { cartCode }) },
          span
        )
        const step = $.evolve({
          flow: nextFlow,
          lastRetry: null,
          lastExecutionSpan: span ?? $.model.lastExecutionSpan
        })
        return $.model.toastsEnabled
          ? step.send(ToastProvider, {
              _tag: "RequestedAdd",
              toast: {
                id: `unblock-${cartId}`,
                title: t("warehouse.toastActionSuccess"),
                description: t("warehouse.successUnblock", { cartCode }),
                type: "success"
              }
            })
          : step
      },

      ClickedOpenBlockDialog: ({ cartId, cartCode }) =>
        $.evolve({
          blockDialog: {
            cartId,
            cartCode,
            form: blockForm.init(Warehouse.defaultBlockCartFormValues),
            submitting: false,
            originSpan: null,
            failure: null
          }
        }),

      ChangedBlockReason: ({ reason }) =>
        $.model.blockDialog === null
          ? $.model
          : $.evolve({
              blockDialog: {
                ...$.model.blockDialog,
                form: blockForm.update($.model.blockDialog.form, "reason", (v) => ({ ...v, reason })),
                failure: null
              }
            }),

      ChangedBlockNote: ({ note }) =>
        $.model.blockDialog === null
          ? $.model
          : $.evolve({
              blockDialog: {
                ...$.model.blockDialog,
                form: blockForm.update($.model.blockDialog.form, "note", (v) => ({ ...v, note })),
                failure: null
              }
            }),

      BlurredBlockField: ({ path }) =>
        $.model.blockDialog === null
          ? $.model
          : $.evolve({
              blockDialog: {
                ...$.model.blockDialog,
                form: blockForm.blur($.model.blockDialog.form, path)
              }
            }),

      RequestedCloseBlockDialog: () =>
        $.model.blockDialog?.submitting === true ? $.model : $.evolve({ blockDialog: null }),

      SubmittedBlockForm: () => {
        const dialog = $.model.blockDialog
        if (dialog === null || dialog.submitting) return $.model
        const submitted = blockForm.submit(dialog.form)
        const derived = blockForm.derive(submitted)
        if (derived.decoded._tag === "None") {
          return $.evolve({ blockDialog: { ...dialog, form: submitted } })
        }
        const retry: PendingRetryAction = {
          _tag: "RetryBlock",
          cartId: dialog.cartId,
          cartCode: dialog.cartCode,
          reason: derived.decoded.value.reason,
          note: derived.decoded.value.note
        }
        return $.evolve({
          blockDialog: { ...dialog, form: submitted, submitting: true, failure: null },
          lastRetry: retry
        }).run(
          issuePendingAction(retry, {
            simulateConflict: $.model.simCheckoutConflict,
            simulateExpired: $.model.simSessionExpired,
            originSpan: dialog.originSpan
          })
        )
      },

      SucceededBlock: ({ cartCode, reason, span }) => {
        const cartId = $.model.blockDialog?.cartId ?? "cart"
        const reasonLabel = Warehouse.blockReasonLabel(t, reason)
        const nextFlow = WarehouseFlow.succeeded(
          $.model.flow,
          { _tag: "Block", cartId, cartCode },
          { message: t("warehouse.successBlock", { cartCode, reason: reasonLabel }) },
          span
        )
        const step = $.evolve({
          blockDialog: null,
          flow: nextFlow,
          lastRetry: null,
          lastExecutionSpan: span ?? $.model.lastExecutionSpan
        })
        return $.model.toastsEnabled
          ? step.send(ToastProvider, {
              _tag: "RequestedAdd",
              toast: {
                id: `block-${cartId}`,
                title: t("warehouse.toastActionSuccess"),
                description: t("warehouse.successBlock", { cartCode, reason: reasonLabel }),
                type: "success"
              }
            })
          : step
      },

      ClickedReleaseCart: ({ cartId, cartCode }) => {
        const retry: PendingRetryAction = { _tag: "RetryPreflightRelease", cartId, cartCode }
        return $.evolve({
          preparing: { cartId, action: "release" },
          lastRetry: retry,
          flow: WarehouseFlow.idle
        }).run(
          issuePendingAction(retry, {
            simulateConflict: $.model.simCheckoutConflict,
            simulateExpired: $.model.simSessionExpired,
            originSpan: null
          })
        )
      },

      SucceededPreflightRelease: ({ preflight, span }) =>
        $.evolve({
          preparing: null,
          lastRetry: null,
          lastOriginSpan: span ?? $.model.lastOriginSpan,
          releaseAlert: {
            preflight,
            originSpan: span,
            submitting: false
          }
        }),

      RequestedCloseReleaseAlert: () =>
        $.model.releaseAlert?.submitting === true ? $.model : $.evolve({ releaseAlert: null }),

      ConfirmedReleaseCart: () => {
        const alert = $.model.releaseAlert
        if (alert === null || alert.submitting) return $.model
        const retry: PendingRetryAction = { _tag: "RetryRelease", preflight: alert.preflight }
        return $.evolve({
          releaseAlert: { ...alert, submitting: true },
          lastRetry: retry,
          flow: WarehouseFlow.start(
            $.model.flow,
            { _tag: "Release", cartId: alert.preflight.cartId, cartCode: alert.preflight.cartCode },
            alert.originSpan,
            null
          )
        }).run(
          issuePendingAction(retry, {
            simulateConflict: $.model.simCheckoutConflict,
            simulateExpired: $.model.simSessionExpired,
            originSpan: alert.originSpan
          })
        )
      },

      SucceededRelease: ({ cartCode, clearedPicks, span }) => {
        const cartId = $.model.releaseAlert?.preflight.cartId ?? "cart"
        const nextFlow = WarehouseFlow.succeeded(
          $.model.flow,
          { _tag: "Release", cartId, cartCode },
          { message: t("warehouse.successRelease", { cartCode, clearedPicks }) },
          span
        )
        return $.evolve({
          releaseAlert: null,
          lastRetry: null,
          flow: nextFlow,
          lastExecutionSpan: span ?? $.model.lastExecutionSpan
        })
      },

      ClickedDispatchCart: ({ cartId, cartCode }) => {
        const retry: PendingRetryAction = { _tag: "RetryPreflightDispatch", cartId, cartCode }
        return $.evolve({
          preparing: { cartId, action: "dispatch" },
          lastRetry: retry,
          flow: WarehouseFlow.idle
        }).run(
          issuePendingAction(retry, {
            simulateConflict: $.model.simCheckoutConflict,
            simulateExpired: $.model.simSessionExpired,
            originSpan: null
          })
        )
      },

      SucceededPreflightDispatch: ({ preflight, span }) =>
        $.evolve({
          preparing: null,
          lastRetry: null,
          lastOriginSpan: span ?? $.model.lastOriginSpan,
          dispatchModal: {
            preflight,
            auditNote: "",
            noteError: false,
            originSpan: span
          }
        }),

      ChangedDispatchAuditNote: ({ note }) =>
        $.model.dispatchModal === null
          ? $.model
          : $.evolve({
              dispatchModal: {
                ...$.model.dispatchModal,
                auditNote: note,
                noteError: false
              }
            }),

      RequestedCloseDispatchModal: () => $.evolve({ dispatchModal: null }),

      ConfirmedDispatchCart: () => {
        const modal = $.model.dispatchModal
        if (modal === null) return $.model
        if (modal.preflight.warningCount > 0 && modal.auditNote.trim().length < 5) {
          return $.evolve({
            dispatchModal: { ...modal, noteError: true }
          })
        }
        const retry: PendingRetryAction = {
          _tag: "RetryDispatchStream",
          preflight: modal.preflight,
          auditNote: modal.auditNote
        }
        const intent: WorkflowIntent = {
          _tag: "Dispatch",
          cartId: modal.preflight.cartId,
          cartCode: modal.preflight.cartCode
        }
        const flow = WarehouseFlow.start($.model.flow, intent, modal.originSpan, {
          cartId: modal.preflight.cartId,
          cartCode: modal.preflight.cartCode,
          step: "validate",
          completed: 0,
          total: 4
        })
        return maybeSendToast(
          $.evolve({
            dispatchModal: null,
            lastRetry: retry,
            flow
          }),
          modal.preflight.cartId,
          t("warehouse.toastDispatchRunning", { cartCode: modal.preflight.cartCode }),
          "loading"
        ).run(
          issuePendingAction(retry, {
            simulateConflict: $.model.simCheckoutConflict,
            simulateExpired: $.model.simSessionExpired,
            originSpan: modal.originSpan
          })
        )
      },

      ProgressedDispatch: ({ cartId, cartCode, step, completed, total, batchId, span }) => {
        if (step === "erp" && batchId !== null) {
          const message = t("warehouse.successDispatch", { batchId, cartCode })
          const nextFlow = WarehouseFlow.succeeded(
            $.model.flow,
            { _tag: "Dispatch", cartId, cartCode },
            { message },
            span
          )
          const nextStep = $.evolve({
            flow: nextFlow,
            lastRetry: null,
            lastExecutionSpan: span ?? $.model.lastExecutionSpan
          })
          return maybeSendToast(nextStep, cartId, t("warehouse.toastDispatchSuccess", { batchId }), "success", message)
        }
        const nextFlow = WarehouseFlow.progressed($.model.flow, {
          cartId,
          cartCode,
          step,
          completed,
          total
        })
        return $.evolve({
          flow: nextFlow,
          lastExecutionSpan: span ?? $.model.lastExecutionSpan
        })
      },

      ClickedCancelDispatch: ({ cartId }) => {
        const nextFlow = WarehouseFlow.cancelRunning($.model.flow)
        const base = $.evolve({
          flow: {
            _tag: "Succeeded" as const,
            intent:
              $.model.flow._tag === "Running" ? $.model.flow.intent : { _tag: "Dispatch", cartId, cartCode: cartId },
            result: { message: t("warehouse.bannerCancelled") },
            span: null
          }
        })
        const withCancel = nextFlow._tag === "Idle" ? base : $.evolve({ flow: nextFlow })
        const ran = withCancel.run(Command.interrupt(WarehouseCommands.DispatchCartBatch, { cartId }))
        return $.model.toastsEnabled
          ? ran.send(ToastProvider, { _tag: "RequestedClose", id: dispatchToastId(cartId) })
          : ran
      },

      FailedAction: ({ retry, intent, failure, fromBlockDialog }) => {
        const originSpan = failure.failureSpan ?? $.model.lastOriginSpan
        if (failure.error._tag === "SessionExpiredError") {
          return $.evolve({
            preparing: null,
            blockDialog: $.model.blockDialog === null ? null : { ...$.model.blockDialog, submitting: false },
            releaseAlert: $.model.releaseAlert === null ? null : { ...$.model.releaseAlert, submitting: false },
            flow: WarehouseFlow.idle,
            sessionPrompt: {
              pending: retry,
              originSpan,
              refreshing: false
            },
            lastOriginSpan: originSpan ?? $.model.lastOriginSpan
          })
        }

        if (fromBlockDialog && $.model.blockDialog !== null) {
          return $.evolve({
            blockDialog: {
              ...$.model.blockDialog,
              submitting: false,
              failure
            },
            lastExecutionSpan: failure.failureSpan ?? $.model.lastExecutionSpan
          })
        }

        const nextFlow = WarehouseFlow.failed($.model.flow, {
          intent,
          error: failure,
          originSpan: $.model.flow._tag === "Running" ? $.model.flow.originSpan : originSpan,
          failureSpan: failure.failureSpan
        })
        const nextStep = $.evolve({
          preparing: null,
          releaseAlert: null,
          flow: nextFlow,
          lastRetry: retry,
          lastExecutionSpan: failure.failureSpan ?? $.model.lastExecutionSpan
        })
        if (intent._tag === "Dispatch" && $.model.toastsEnabled) {
          return maybeSendToast(
            nextStep,
            intent.cartId,
            t("warehouse.toastDispatchError", { cartCode: intent.cartCode }),
            "error",
            Warehouse.describeWarehouseFailure(t, failure)
          )
        }
        return nextStep
      },

      ClickedRetryLastError: () => {
        const retry = $.model.lastRetry
        if (retry === null) return $.model
        const originSpan = $.model.flow._tag === "Failed" ? ($.model.flow.failureSpan ?? $.model.flow.originSpan) : null
        const intent: WorkflowIntent =
          $.model.flow._tag === "Failed" ? $.model.flow.intent : { _tag: "Unblock", cartId: "retry", cartCode: "CART" }
        const nextFlow = WarehouseFlow.start($.model.flow, intent, originSpan, null)
        return $.evolve({ flow: nextFlow }).run(
          issuePendingAction(retry, {
            simulateConflict: $.model.simCheckoutConflict,
            simulateExpired: $.model.simSessionExpired,
            originSpan
          })
        )
      },

      ClickedDismissBanner: () => $.evolve({ flow: WarehouseFlow.dismiss(), lastRetry: null }),

      RequestedCloseSessionPrompt: () => {
        if ($.model.sessionPrompt?.refreshing === true) return $.model
        return $.evolve({
          sessionPrompt: null,
          flow: {
            _tag: "Failed",
            intent: { _tag: "Unblock", cartId: "session", cartCode: "session" },
            draft: null,
            error: new Warehouse.WarehouseCommandFailure({
              error: new Warehouse.SessionExpiredError({ action: t("warehouse.sessionDialogDeclined") }),
              transportMessage: null,
              failureSpan: $.model.sessionPrompt?.originSpan ?? null
            }),
            attempt: 1,
            originSpan: $.model.sessionPrompt?.originSpan ?? null,
            failureSpan: $.model.sessionPrompt?.originSpan ?? null
          }
        })
      },

      ConfirmedSessionRefresh: () => {
        const prompt = $.model.sessionPrompt
        if (prompt === null || prompt.refreshing) return $.model
        return $.evolve({
          simSessionExpired: false,
          sessionPrompt: { ...prompt, refreshing: true }
        }).run(
          WarehouseCommands.RefreshSession.make({ originSpan: prompt.originSpan }).pipe(
            Command.match({
              onSuccess: ({ span }) => WarehouseMessage.SucceededSessionRefresh({ span }),
              onFailure: (failure) => WarehouseMessage.FailedSessionRefresh({ failure })
            })
          )
        )
      },

      SucceededSessionRefresh: ({ span }) => {
        const prompt = $.model.sessionPrompt
        if (prompt === null) return $.model
        const pending = prompt.pending
        const nextOrigin = span ?? prompt.originSpan
        const flow =
          pending._tag === "RetryDispatchStream"
            ? WarehouseFlow.start(
                $.model.flow,
                { _tag: "Dispatch", cartId: pending.preflight.cartId, cartCode: pending.preflight.cartCode },
                nextOrigin,
                {
                  cartId: pending.preflight.cartId,
                  cartCode: pending.preflight.cartCode,
                  step: "validate",
                  completed: 0,
                  total: 4
                }
              )
            : pending._tag === "RetryBlock"
              ? $.model.flow
              : WarehouseFlow.start(
                  $.model.flow,
                  pending._tag === "RetryRelease"
                    ? { _tag: "Release", cartId: pending.preflight.cartId, cartCode: pending.preflight.cartCode }
                    : {
                        _tag: pending._tag === "RetryUnblock" ? "Unblock" : "Release",
                        cartId: pending.cartId,
                        cartCode: pending.cartCode
                      },
                  nextOrigin,
                  null
                )
        return $.evolve({
          sessionPrompt: null,
          flow,
          lastOriginSpan: nextOrigin ?? $.model.lastOriginSpan
        }).run(
          issuePendingAction(pending, {
            simulateConflict: $.model.simCheckoutConflict,
            simulateExpired: false,
            originSpan: nextOrigin
          })
        )
      },

      FailedSessionRefresh: ({ failure }) =>
        $.evolve({
          sessionPrompt: null,
          flow: WarehouseFlow.failed($.model.flow, {
            intent: { _tag: "Unblock", cartId: "session", cartCode: "session" },
            error: failure,
            failureSpan: failure.failureSpan
          })
        })
    })
  },
  view: (h, model) => {
    const i18n = I18n.translator(h.reads.i18n)
    const { formatCurrency, t } = i18n
    const blockForm = Warehouse.getBlockCartSchemaForm(h.reads.i18n.locale)
    const cartsResult = h.queries.carts
    const cartsStatus = QueryResult.read(cartsResult)

    const toggleClass = (active: boolean) =>
      `inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "border-sky-600 bg-sky-50 text-sky-900 dark:border-sky-400 dark:bg-sky-950/40 dark:text-sky-200"
          : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`

    const blockDialogModel = model.blockDialog
    const blockDerived = blockDialogModel === null ? undefined : blockForm.derive(blockDialogModel.form)

    const releaseAlertModel = model.releaseAlert
    const dispatchModalModel = model.dispatchModal
    const sessionPromptModel = model.sessionPrompt

    return h.section
      .attr("data-page-chunk", WAREHOUSE_PAGE_CHUNK)
      .attr("data-warehouse-schema", Warehouse.WAREHOUSE_SCHEMA_CHUNK)
      .attr("data-warehouse-query", GetWarehouseCarts.GET_WAREHOUSE_CARTS_QUERY_CHUNK)
      .class(Design.ui.stack)
      .children(
        h.div.children(
          h.h1.class(Design.ui.title).children(t("warehouse.heading")),
          h.p.class(Design.ui.muted).children(t("warehouse.subtitle")),
          h.p
            .class("mt-1 font-mono text-xs text-neutral-500 dark:text-neutral-400")
            .children(t("warehouse.patternSummary"))
        ),

        h.div
          .class(`${Design.ui.card} flex flex-wrap items-center gap-2`)
          .attr("data-testid", "warehouse-controls")
          .children(
            Button(h, { onPress: WarehouseMessage.ToggledSimSessionExpired() })
              .class(toggleClass(model.simSessionExpired))
              .attr("aria-pressed", model.simSessionExpired ? "true" : "false")
              .attr("data-testid", "sim-session-expired")
              .children(t("warehouse.simSessionExpired")),
            Button(h, { onPress: WarehouseMessage.ToggledSimCheckoutConflict() })
              .class(toggleClass(model.simCheckoutConflict))
              .attr("aria-pressed", model.simCheckoutConflict ? "true" : "false")
              .attr("data-testid", "sim-checkout-conflict")
              .children(t("warehouse.simCheckoutConflict")),
            Button(h, { onPress: WarehouseMessage.ToggledOptInToasts() })
              .class(toggleClass(model.toastsEnabled))
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
                h.span
                  .class("text-sm font-medium text-emerald-800 dark:text-emerald-300")
                  .children(model.flow.result.message),
                Button(h, { onPress: WarehouseMessage.ClickedDismissBanner() })
                  .class(Design.ui.button)
                  .children(t("common.dismiss"))
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

        // Trace & SpanLink Inspector Card
        h.div
          .class(`${Design.ui.card} flex flex-col gap-1.5`)
          .attr("data-testid", "warehouse-trace-panel")
          .children(
            h.h2.class("text-sm font-semibold").children(t("warehouse.tracePanelTitle")),
            model.lastOriginSpan === null && model.lastExecutionSpan === null
              ? h.p.class(Design.ui.muted).children(t("warehouse.traceEmpty"))
              : h.div.class("flex flex-col gap-1 font-mono text-xs text-neutral-600 dark:text-neutral-400").children(
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
          ),

        // Block Cart Dialog (SchemaForm inside controlled @effect/ui-kit Dialog)
        Dialog(h, {
          key: "block-cart-dialog",
          props: { open: blockDialogModel !== null && sessionPromptModel === null },
          onEmit: {
            RequestedOpen: () => undefined,
            RequestedClose: () => WarehouseMessage.RequestedCloseBlockDialog(),
            Settled: () => undefined
          },
          view: (dialog) =>
            h.div.class("contents").children(
              dialog.portal(h.dialog)?.children(
                dialog.backdrop(h.div.class(Design.ui.dialogBackdrop)),
                dialog.viewport(h.div.class(Design.ui.dialogViewport)).children(
                  dialog
                    .popup(h.div.class(Design.ui.dialogPopup))
                    .attr("data-testid", "block-dialog-popup")
                    .children(
                      blockDialogModel === null || blockDerived === undefined
                        ? undefined
                        : h.div.class(Design.ui.stack).children(
                            dialog
                              .title(h.h2.class("text-lg font-semibold"))
                              .children(t("warehouse.blockDialogTitle", { cartCode: blockDialogModel.cartCode })),
                            dialog
                              .description(h.p.class(Design.ui.muted))
                              .children(t("warehouse.blockDialogDescription")),
                            blockDialogModel.failure === null
                              ? undefined
                              : CommandResult.commandErrorBanner(h, {
                                  title: Warehouse.describeWarehouseFailure(t, blockDialogModel.failure),
                                  span: blockDialogModel.failure.failureSpan
                                }),
                            h.div.class("flex flex-col gap-1.5").children(
                              h.span.class("text-sm font-medium").children(blockForm.labelFor("reason")),
                              h.div.class("flex flex-wrap gap-2").children(
                                blockReasons.map((reason) =>
                                  Button(h, {
                                    onPress: WarehouseMessage.ChangedBlockReason({ reason })
                                  })
                                    .key(reason)
                                    .class(Design.ui.button)
                                    .attr(
                                      "aria-pressed",
                                      blockDialogModel.form.values.reason === reason ? "true" : "false"
                                    )
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
                                blockDialogModel.form.values.reason === "damage" ||
                                blockDialogModel.form.values.reason === "other",
                              disabled: blockDialogModel.submitting,
                              testId: "block-note-input",
                              errorTestId: "block-note-error",
                              onUpdate: (note) => WarehouseMessage.ChangedBlockNote({ note }),
                              onBlur: WarehouseMessage.BlurredBlockField({ path: "note" })
                            }),
                            h.div.class(`${Design.ui.row} justify-end`).children(
                              dialog
                                .close(h.button.class(Design.ui.button))
                                .attr("data-testid", "block-dialog-cancel")
                                .children(t("common.cancel")),
                              CommandResult.commandButton(h, {
                                label: t("warehouse.blockSubmit"),
                                busyLabel: t("warehouse.blockSubmitting"),
                                busy: blockDialogModel.submitting,
                                variant: "primary",
                                testId: "block-dialog-submit",
                                onPress: WarehouseMessage.SubmittedBlockForm()
                              })
                            )
                          )
                    )
                )
              )
            )
        }),

        // Release Cart Confirmation AlertDialog
        AlertDialog(h, {
          key: "release-alert-dialog",
          props: { open: releaseAlertModel !== null && sessionPromptModel === null },
          onEmit: {
            RequestedOpen: () => undefined,
            RequestedClose: () => WarehouseMessage.RequestedCloseReleaseAlert(),
            Settled: () => undefined
          },
          view: (alert) =>
            h.div.class("contents").children(
              alert.portal(h.dialog)?.children(
                alert.backdrop(h.div.class(Design.ui.dialogBackdrop)),
                alert.viewport(h.div.class(Design.ui.dialogViewport)).children(
                  alert
                    .popup(h.div.class(Design.ui.dialogPopup))
                    .attr("data-testid", "release-alert-popup")
                    .children(
                      releaseAlertModel === null
                        ? undefined
                        : h.div.class(Design.ui.stack).children(
                            alert.title(h.h2.class("text-lg font-semibold")).children(
                              t("warehouse.releaseAlertTitle", {
                                cartCode: releaseAlertModel.preflight.cartCode
                              })
                            ),
                            alert
                              .description(h.p.class(Design.ui.muted))
                              .children(t("warehouse.releaseAlertDescription")),
                            h.div.class(`${Design.ui.row} justify-end`).children(
                              alert
                                .initialFocus(alert.close(h.button.class(Design.ui.button)))
                                .attr("data-testid", "release-alert-cancel")
                                .children(t("common.cancel")),
                              CommandResult.commandButton(h, {
                                label: t("warehouse.releaseConfirm"),
                                busyLabel: t("common.loading"),
                                busy: releaseAlertModel.submitting,
                                variant: "danger",
                                testId: "release-alert-confirm",
                                onPress: WarehouseMessage.ConfirmedReleaseCart()
                              })
                            )
                          )
                    )
                )
              )
            )
        }),

        // Dispatch Confirmation: AlertDialog (0 warnings) vs Audit Note Dialog (warnings > 0)
        AlertDialog(h, {
          key: "dispatch-alert-dialog",
          props: { open: dispatchModalModel !== null && dispatchModalModel.preflight.warningCount === 0 },
          onEmit: {
            RequestedOpen: () => undefined,
            RequestedClose: () => WarehouseMessage.RequestedCloseDispatchModal(),
            Settled: () => undefined
          },
          view: (alert) =>
            h.div.class("contents").children(
              alert.portal(h.dialog)?.children(
                alert.backdrop(h.div.class(Design.ui.dialogBackdrop)),
                alert.viewport(h.div.class(Design.ui.dialogViewport)).children(
                  alert
                    .popup(h.div.class(Design.ui.dialogPopup))
                    .attr("data-testid", "dispatch-alert-popup")
                    .children(
                      dispatchModalModel === null
                        ? undefined
                        : h.div.class(Design.ui.stack).children(
                            alert
                              .title(h.h2.class("text-lg font-semibold"))
                              .children(
                                t("warehouse.dispatchTitleClean", { cartCode: dispatchModalModel.preflight.cartCode })
                              ),
                            alert.description(h.p.class(Design.ui.muted)).children(
                              t("warehouse.dispatchDescClean", {
                                pickCount: dispatchModalModel.preflight.pickCount,
                                value: formatCurrency(dispatchModalModel.preflight.valueCents)
                              })
                            ),
                            h.div.class(`${Design.ui.row} justify-end`).children(
                              alert
                                .initialFocus(alert.close(h.button.class(Design.ui.button)))
                                .attr("data-testid", "dispatch-cancel")
                                .children(t("common.cancel")),
                              CommandResult.commandButton(h, {
                                label: t("warehouse.dispatchConfirm"),
                                variant: "primary",
                                testId: "dispatch-confirm",
                                onPress: WarehouseMessage.ConfirmedDispatchCart()
                              })
                            )
                          )
                    )
                )
              )
            )
        }),

        Dialog(h, {
          key: "dispatch-warn-dialog",
          props: { open: dispatchModalModel !== null && dispatchModalModel.preflight.warningCount > 0 },
          onEmit: {
            RequestedOpen: () => undefined,
            RequestedClose: () => WarehouseMessage.RequestedCloseDispatchModal(),
            Settled: () => undefined
          },
          view: (dialog) =>
            h.div.class("contents").children(
              dialog.portal(h.dialog)?.children(
                dialog.backdrop(h.div.class(Design.ui.dialogBackdrop)),
                dialog.viewport(h.div.class(Design.ui.dialogViewport)).children(
                  dialog
                    .popup(h.div.class(Design.ui.dialogPopup))
                    .attr("data-testid", "dispatch-warn-popup")
                    .children(
                      dispatchModalModel === null
                        ? undefined
                        : h.div.class(Design.ui.stack).children(
                            dialog
                              .title(h.h2.class("text-lg font-semibold"))
                              .children(
                                t("warehouse.dispatchTitleWarn", { cartCode: dispatchModalModel.preflight.cartCode })
                              ),
                            dialog.description(h.p.class(Design.ui.muted)).children(
                              t("warehouse.dispatchDescWarn", {
                                cartCode: dispatchModalModel.preflight.cartCode,
                                warningCount: dispatchModalModel.preflight.warningCount
                              })
                            ),
                            h.div.class("flex flex-col gap-1.5").children(
                              h.label
                                .attr("for", "dispatch-audit-note")
                                .class("text-sm font-medium")
                                .children(t("warehouse.dispatchNoteLabel")),
                              Input(h, {
                                props: { value: dispatchModalModel.auditNote },
                                onUpdate: ({ value }) => WarehouseMessage.ChangedDispatchAuditNote({ note: value })
                              })
                                .class(Design.ui.input)
                                .attrs({
                                  id: "dispatch-audit-note",
                                  placeholder: t("warehouse.dispatchNotePlaceholder"),
                                  "data-testid": "dispatch-audit-input"
                                }),
                              dispatchModalModel.noteError
                                ? h.p
                                    .class("text-sm font-medium text-red-600 dark:text-red-400")
                                    .attr("data-testid", "dispatch-audit-error")
                                    .children(t("warehouse.dispatchNoteError"))
                                : undefined
                            ),
                            h.div.class(`${Design.ui.row} justify-end`).children(
                              dialog
                                .close(h.button.class(Design.ui.button))
                                .attr("data-testid", "dispatch-warn-cancel")
                                .children(t("common.cancel")),
                              CommandResult.commandButton(h, {
                                label: t("warehouse.dispatchConfirm"),
                                variant: "primary",
                                testId: "dispatch-warn-confirm",
                                onPress: WarehouseMessage.ConfirmedDispatchCart()
                              })
                            )
                          )
                    )
                )
              )
            )
        }),

        // Mid-flight SessionExpired recovery AlertDialog (scanner `AuthPrompt` equivalent)
        AlertDialog(h, {
          key: "session-expired-alert",
          props: { open: sessionPromptModel !== null },
          onEmit: {
            RequestedOpen: () => undefined,
            RequestedClose: () => WarehouseMessage.RequestedCloseSessionPrompt(),
            Settled: () => undefined
          },
          view: (alert) =>
            h.div.class("contents").children(
              alert.portal(h.dialog)?.children(
                alert.backdrop(h.div.class(Design.ui.dialogBackdrop)),
                alert.viewport(h.div.class(Design.ui.dialogViewport)).children(
                  alert
                    .popup(h.div.class(Design.ui.dialogPopup))
                    .attr("data-testid", "session-expired-popup")
                    .children(
                      sessionPromptModel === null
                        ? undefined
                        : h.div.class(Design.ui.stack).children(
                            alert
                              .title(h.h2.class("text-lg font-semibold"))
                              .children(t("warehouse.sessionDialogTitle")),
                            alert.description(h.p.class(Design.ui.muted)).children(t("warehouse.sessionDialogBody")),
                            h.div.class(`${Design.ui.row} justify-end`).children(
                              alert
                                .initialFocus(alert.close(h.button.class(Design.ui.button)))
                                .attr("data-testid", "session-expired-cancel")
                                .children(t("common.cancel")),
                              CommandResult.commandButton(h, {
                                label: t("warehouse.sessionDialogConfirm"),
                                busyLabel: t("warehouse.sessionDialogSubmitting"),
                                busy: sessionPromptModel.refreshing,
                                variant: "primary",
                                testId: "session-expired-confirm",
                                onPress: WarehouseMessage.ConfirmedSessionRefresh()
                              })
                            )
                          )
                    )
                )
              )
            )
        })
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
              toastProvider
                .viewport(h.div.class("fixed right-4 bottom-16 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"))
                .attr("aria-label", t("common.notifications"))
                .attr("data-testid", "warehouse-toast-viewport")
                .children(
                  toastProvider.toasts.map((toast) =>
                    toastProvider
                      .root({
                        element: h.div.class(
                          "rounded-lg border border-neutral-200 bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
                        ),
                        toast
                      })
                      .attr("data-testid", `warehouse-toast-${toast.id}`)
                      .children(
                        h.div
                          .class("flex items-start justify-between gap-2")
                          .children(
                            h.div
                              .class("flex flex-col gap-0.5")
                              .children(
                                toast.title === undefined
                                  ? undefined
                                  : toastProvider
                                      .title({ element: h.strong.class("text-sm font-semibold"), toast })
                                      .children(toast.title),
                                toast.description === undefined
                                  ? undefined
                                  : toastProvider
                                      .description({ element: h.p.class(Design.ui.muted), toast })
                                      .children(toast.description)
                              ),
                            toastProvider
                              .close({ element: h.button.class(Design.ui.button), toast })
                              .children(t("common.dismiss"))
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
