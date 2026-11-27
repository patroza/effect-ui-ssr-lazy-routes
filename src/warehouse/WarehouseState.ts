import { Command, Component, UiSchema } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { ToastProvider } from "@effect/ui-kit"
import { Effect, Schema } from "effect"
import type * as SchemaForm from "../form/SchemaForm.ts"
import * as I18n from "../i18n/I18n.ts"
import * as CommandFlow from "../workflow/CommandFlow.ts"
import * as CommandTrace from "../workflow/CommandTrace.ts"
import * as WarehouseCommands from "./commands/WarehouseCommands.ts"
import * as Warehouse from "./domain/Warehouse.ts"
import * as GetWarehouseCarts from "./queries/GetWarehouseCarts.ts"

const BlockDraftSchema = Warehouse.getBlockCartSchemaForm("en").State

export const PendingRetryAction = Schema.Union([
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
export type PendingRetryAction = typeof PendingRetryAction.Type

export const WorkflowIntent = Schema.Union([
  Schema.TaggedStruct("Unblock", { cartId: Schema.String, cartCode: Schema.String }),
  Schema.TaggedStruct("Block", { cartId: Schema.String, cartCode: Schema.String }),
  Schema.TaggedStruct("Release", { cartId: Schema.String, cartCode: Schema.String }),
  Schema.TaggedStruct("Dispatch", { cartId: Schema.String, cartCode: Schema.String })
])
export type WorkflowIntent = typeof WorkflowIntent.Type

const WorkflowSuccess = Schema.Struct({
  message: Schema.String
})

export const WarehouseFlow = CommandFlow.makeCommandFlow({
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

export const BlockDialogState = Schema.Struct({
  cartId: Schema.String,
  cartCode: Schema.String,
  form: BlockDraftSchema,
  submitting: Schema.Boolean,
  originSpan: Schema.NullOr(CommandTrace.SpanPointer),
  failure: Schema.NullOr(Warehouse.WarehouseCommandFailure)
})

export const ReleaseAlertState = Schema.Struct({
  preflight: Warehouse.PreflightReleaseResult,
  originSpan: Schema.NullOr(CommandTrace.SpanPointer),
  submitting: Schema.Boolean
})

export const DispatchModalState = Schema.Struct({
  preflight: Warehouse.PreflightDispatchResult,
  auditNote: Schema.String,
  noteError: Schema.Boolean,
  originSpan: Schema.NullOr(CommandTrace.SpanPointer)
})

export const SessionPromptState = Schema.Struct({
  pending: PendingRetryAction,
  originSpan: Schema.NullOr(CommandTrace.SpanPointer),
  refreshing: Schema.Boolean
})

export const WarehouseModelSchema = Schema.Struct({
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
})
export type WarehouseModel = typeof WarehouseModelSchema.Type

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
export type WarehouseMsg = typeof WarehouseMessage.Type

const RefreshCarts = Command.make("warehouse/RefreshCarts", { args: {} }, () =>
  GetWarehouseCarts.GetWarehouseCarts.invalidate({}).pipe(Effect.as(Component.noop))
)

export const dispatchToastId = (cartId: string): string => `warehouse-dispatch-${cartId}`

export const intentOfAction = (action: PendingRetryAction): WorkflowIntent => {
  switch (action._tag) {
    case "RetryUnblock":
      return { _tag: "Unblock", cartId: action.cartId, cartCode: action.cartCode }
    case "RetryBlock":
      return { _tag: "Block", cartId: action.cartId, cartCode: action.cartCode }
    case "RetryPreflightRelease":
      return { _tag: "Release", cartId: action.cartId, cartCode: action.cartCode }
    case "RetryRelease":
      return { _tag: "Release", cartId: action.preflight.cartId, cartCode: action.preflight.cartCode }
    case "RetryPreflightDispatch":
      return { _tag: "Dispatch", cartId: action.cartId, cartCode: action.cartCode }
    case "RetryDispatchStream":
      return { _tag: "Dispatch", cartId: action.preflight.cartId, cartCode: action.preflight.cartCode }
  }
}

const issuePendingAction = (
  action: PendingRetryAction,
  options: {
    readonly simulateConflict: boolean
    readonly simulateExpired: boolean
    readonly originSpan: CommandTrace.SpanPointer | null
  }
) => {
  const intent = intentOfAction(action)
  const onFailure = (failure: Warehouse.WarehouseCommandFailure, fromBlockDialog = false) =>
    WarehouseMessage.FailedAction({ retry: action, intent, failure, fromBlockDialog })

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
          onFailure: (failure) => onFailure(failure)
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
          onFailure: (failure) => onFailure(failure, true)
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
          onFailure: (failure) => onFailure(failure)
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
          onFailure: (failure) => onFailure(failure)
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
          onFailure: (failure) => onFailure(failure)
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
          onFailure: (failure) => onFailure(failure)
        })
      )
  }
}

export const WarehouseConsoleSpec = Html.component({
  name: "WarehouseConsole",
  model: WarehouseModelSchema,
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
})

export const initWarehouseModel = WarehouseConsoleSpec.init(() => ({
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
}))

export const updateWarehouseModel = WarehouseConsoleSpec.update(($, message) => {
  const { locale } = $.reads.i18n
  const { t } = I18n.translatorFor(locale)
  const blockForm = Warehouse.getBlockCartSchemaForm(locale)

  const sendToast = (
    step: ReturnType<typeof $.set>,
    id: string,
    title: string,
    type: "loading" | "success" | "error",
    options?: {
      readonly updateExisting?: boolean
      readonly description?: string | undefined
      readonly timeout?: number | undefined
    }
  ) => {
    if (!$.model.toastsEnabled) return step
    if (options?.updateExisting === true) {
      return step.send(ToastProvider, {
        _tag: "RequestedUpdate",
        id,
        title,
        type,
        ...(options.description === undefined ? {} : { description: options.description }),
        ...(options.timeout === undefined ? {} : { timeout: options.timeout })
      })
    }
    return step.send(ToastProvider, {
      _tag: "RequestedAdd",
      toast: {
        id,
        title,
        type,
        ...(options?.description === undefined ? {} : { description: options.description }),
        ...(options?.timeout === undefined ? {} : { timeout: options.timeout })
      }
    })
  }

  const updateBlockDialog = (updater: (dialog: typeof BlockDialogState.Type) => typeof BlockDialogState.Type) =>
    $.model.blockDialog === null ? $.model : $.evolve({ blockDialog: updater($.model.blockDialog) })

  const startPendingAction = (
    action: PendingRetryAction,
    originSpan: CommandTrace.SpanPointer | null,
    overrides?: {
      readonly simulateExpired?: boolean
      readonly clearSessionPrompt?: boolean
      readonly nextOriginSpan?: CommandTrace.SpanPointer | null
      readonly blockFormSubmitted?: SchemaForm.FormState<Warehouse.BlockCartFormValues>
    }
  ) => {
    const model = $.model
    const intent = intentOfAction(action)
    const extraEvolve = {
      ...(overrides?.clearSessionPrompt === true ? { sessionPrompt: null } : {}),
      ...(overrides?.nextOriginSpan !== undefined ? { lastOriginSpan: overrides.nextOriginSpan } : {})
    }
    const effect = issuePendingAction(action, {
      simulateConflict: model.simCheckoutConflict,
      simulateExpired: overrides?.simulateExpired ?? model.simSessionExpired,
      originSpan
    })
    switch (action._tag) {
      case "RetryUnblock":
        return $.evolve({
          ...extraEvolve,
          lastRetry: action,
          flow: WarehouseFlow.start(model.flow, intent, originSpan, null)
        }).run(effect)
      case "RetryBlock": {
        const blockDialog =
          model.blockDialog === null
            ? null
            : {
                ...model.blockDialog,
                ...(overrides?.blockFormSubmitted === undefined ? {} : { form: overrides.blockFormSubmitted }),
                submitting: true,
                failure: null
              }
        return $.evolve({
          ...extraEvolve,
          blockDialog,
          lastRetry: action,
          flow: blockDialog === null ? WarehouseFlow.start(model.flow, intent, originSpan, null) : model.flow
        }).run(effect)
      }
      case "RetryPreflightRelease":
      case "RetryPreflightDispatch":
        return $.evolve({
          ...extraEvolve,
          preparing: {
            cartId: action.cartId,
            action: action._tag === "RetryPreflightRelease" ? "release" : "dispatch"
          },
          lastRetry: action,
          flow: WarehouseFlow.idle
        }).run(effect)
      case "RetryRelease":
        return $.evolve({
          ...extraEvolve,
          releaseAlert: model.releaseAlert === null ? null : { ...model.releaseAlert, submitting: true },
          lastRetry: action,
          flow: WarehouseFlow.start(model.flow, intent, originSpan, null)
        }).run(effect)
      case "RetryDispatchStream": {
        const flow = WarehouseFlow.start(model.flow, intent, originSpan, {
          cartId: action.preflight.cartId,
          cartCode: action.preflight.cartCode,
          step: "validate",
          completed: 0,
          total: 4
        })
        return sendToast(
          $.evolve({
            ...extraEvolve,
            dispatchModal: null,
            lastRetry: action,
            flow
          }),
          dispatchToastId(action.preflight.cartId),
          t("warehouse.toastDispatchRunning", { cartCode: action.preflight.cartCode }),
          "loading"
        ).run(effect)
      }
    }
  }

  return WarehouseMessage.match(message, {
    ToggledSimSessionExpired: () => $.evolve({ simSessionExpired: !$.model.simSessionExpired }),
    ToggledSimCheckoutConflict: () => $.evolve({ simCheckoutConflict: !$.model.simCheckoutConflict }),
    ToggledOptInToasts: () => $.evolve({ toastsEnabled: !$.model.toastsEnabled }),
    ClickedRefreshCarts: () => $.run(RefreshCarts.make()),

    ClickedUnblock: ({ cartId, cartCode }) => startPendingAction({ _tag: "RetryUnblock", cartId, cartCode }, null),

    SucceededUnblock: ({ cartId, cartCode, span }) => {
      const description = t("warehouse.successUnblock", { cartCode })
      const nextFlow = WarehouseFlow.succeeded(
        $.model.flow,
        { _tag: "Unblock", cartId, cartCode },
        { message: description },
        span
      )
      return sendToast(
        $.evolve({
          flow: nextFlow,
          lastRetry: null,
          lastExecutionSpan: span ?? $.model.lastExecutionSpan
        }),
        `unblock-${cartId}`,
        t("warehouse.toastActionSuccess"),
        "success",
        { description, timeout: 4000 }
      )
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
      updateBlockDialog((dialog) => ({
        ...dialog,
        form: blockForm.update(dialog.form, "reason", (v) => ({ ...v, reason })),
        failure: null
      })),

    ChangedBlockNote: ({ note }) =>
      updateBlockDialog((dialog) => ({
        ...dialog,
        form: blockForm.update(dialog.form, "note", (v) => ({ ...v, note })),
        failure: null
      })),

    BlurredBlockField: ({ path }) =>
      updateBlockDialog((dialog) => ({
        ...dialog,
        form: blockForm.blur(dialog.form, path)
      })),

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
      return startPendingAction(
        {
          _tag: "RetryBlock",
          cartId: dialog.cartId,
          cartCode: dialog.cartCode,
          reason: derived.decoded.value.reason,
          note: derived.decoded.value.note
        },
        dialog.originSpan,
        { blockFormSubmitted: submitted }
      )
    },

    SucceededBlock: ({ cartCode, reason, span }) => {
      const cartId = $.model.blockDialog?.cartId ?? "cart"
      const reasonLabel = Warehouse.blockReasonLabel(t, reason)
      const description = t("warehouse.successBlock", { cartCode, reason: reasonLabel })
      const nextFlow = WarehouseFlow.succeeded(
        $.model.flow,
        { _tag: "Block", cartId, cartCode },
        { message: description },
        span
      )
      return sendToast(
        $.evolve({
          blockDialog: null,
          flow: nextFlow,
          lastRetry: null,
          lastExecutionSpan: span ?? $.model.lastExecutionSpan
        }),
        `block-${cartId}`,
        t("warehouse.toastActionSuccess"),
        "success",
        { description, timeout: 4000 }
      )
    },

    ClickedReleaseCart: ({ cartId, cartCode }) =>
      startPendingAction({ _tag: "RetryPreflightRelease", cartId, cartCode }, null),

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
      return startPendingAction({ _tag: "RetryRelease", preflight: alert.preflight }, alert.originSpan)
    },

    SucceededRelease: ({ cartCode, clearedPicks, span }) => {
      const cartId = $.model.releaseAlert?.preflight.cartId ?? "cart"
      const description = t("warehouse.successRelease", { cartCode, clearedPicks })
      const nextFlow = WarehouseFlow.succeeded(
        $.model.flow,
        { _tag: "Release", cartId, cartCode },
        { message: description },
        span
      )
      return sendToast(
        $.evolve({
          releaseAlert: null,
          lastRetry: null,
          flow: nextFlow,
          lastExecutionSpan: span ?? $.model.lastExecutionSpan
        }),
        `release-${cartId}`,
        t("warehouse.toastActionSuccess"),
        "success",
        { description, timeout: 4000 }
      )
    },

    ClickedDispatchCart: ({ cartId, cartCode }) =>
      startPendingAction({ _tag: "RetryPreflightDispatch", cartId, cartCode }, null),

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
      return startPendingAction(
        {
          _tag: "RetryDispatchStream",
          preflight: modal.preflight,
          auditNote: modal.auditNote
        },
        modal.originSpan
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
        return sendToast(
          $.evolve({
            flow: nextFlow,
            lastRetry: null,
            lastExecutionSpan: span ?? $.model.lastExecutionSpan
          }),
          dispatchToastId(cartId),
          t("warehouse.toastDispatchSuccess", { batchId }),
          "success",
          { updateExisting: true, description: message, timeout: 4000 }
        )
      }
      return $.evolve({
        flow: WarehouseFlow.progressed($.model.flow, {
          cartId,
          cartCode,
          step,
          completed,
          total
        }),
        lastExecutionSpan: span ?? $.model.lastExecutionSpan
      })
    },

    ClickedCancelDispatch: ({ cartId }) => {
      const intent: WorkflowIntent =
        $.model.flow._tag === "Running" ? $.model.flow.intent : { _tag: "Dispatch", cartId, cartCode: cartId }
      const next = $.evolve({
        flow: WarehouseFlow.succeeded($.model.flow, intent, { message: t("warehouse.bannerCancelled") }, null),
        lastRetry: null
      }).run(Command.interrupt(WarehouseCommands.DispatchCartBatch, { cartId }))
      return $.model.toastsEnabled
        ? next.send(ToastProvider, { _tag: "RequestedClose", id: dispatchToastId(cartId) })
        : next
    },

    FailedAction: ({ retry, intent, failure, fromBlockDialog }) => {
      const originSpan = failure.failureSpan ?? $.model.lastOriginSpan
      if (failure.error._tag === "SessionExpiredError") {
        const paused = $.evolve({
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
        return intent._tag === "Dispatch" && $.model.toastsEnabled
          ? paused.send(ToastProvider, { _tag: "RequestedClose", id: dispatchToastId(intent.cartId) })
          : paused
      }

      const description = Warehouse.describeWarehouseFailure(t, failure)
      if (fromBlockDialog && $.model.blockDialog !== null) {
        return sendToast(
          $.evolve({
            blockDialog: {
              ...$.model.blockDialog,
              submitting: false,
              failure
            },
            lastExecutionSpan: failure.failureSpan ?? $.model.lastExecutionSpan
          }),
          `action-error-${intent.cartId}`,
          t("warehouse.toastActionError"),
          "error",
          { description, timeout: 4000 }
        )
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

      if (retry._tag === "RetryDispatchStream") {
        return sendToast(
          nextStep,
          dispatchToastId(intent.cartId),
          t("warehouse.toastDispatchError", { cartCode: intent.cartCode }),
          "error",
          { updateExisting: true, description, timeout: 4000 }
        )
      }
      if (intent._tag === "Dispatch") {
        return sendToast(
          nextStep,
          dispatchToastId(intent.cartId),
          t("warehouse.toastDispatchError", { cartCode: intent.cartCode }),
          "error",
          { description, timeout: 4000 }
        )
      }
      return sendToast(nextStep, `action-error-${intent.cartId}`, t("warehouse.toastActionError"), "error", {
        description,
        timeout: 4000
      })
    },

    ClickedRetryLastError: () => {
      const retry = $.model.lastRetry
      if (retry === null) return $.model
      const originSpan = $.model.flow._tag === "Failed" ? ($.model.flow.failureSpan ?? $.model.flow.originSpan) : null
      return startPendingAction(retry, originSpan)
    },

    ClickedDismissBanner: () => $.evolve({ flow: WarehouseFlow.dismiss(), lastRetry: null }),

    RequestedCloseSessionPrompt: () => {
      const prompt = $.model.sessionPrompt
      if (prompt === null || prompt.refreshing) return $.model
      return $.evolve({
        sessionPrompt: null,
        flow: WarehouseFlow.failed($.model.flow, {
          intent: intentOfAction(prompt.pending),
          error: new Warehouse.WarehouseCommandFailure({
            error: new Warehouse.SessionExpiredError({ action: t("warehouse.sessionDialogDeclined") }),
            transportMessage: null,
            failureSpan: prompt.originSpan
          }),
          originSpan: prompt.originSpan,
          failureSpan: prompt.originSpan
        })
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
      const nextOrigin = span ?? prompt.originSpan
      return startPendingAction(prompt.pending, nextOrigin, {
        simulateExpired: false,
        clearSessionPrompt: true,
        nextOriginSpan: nextOrigin ?? $.model.lastOriginSpan
      })
    },

    FailedSessionRefresh: ({ failure }) => {
      const prompt = $.model.sessionPrompt
      return $.evolve({
        sessionPrompt: null,
        flow: WarehouseFlow.failed($.model.flow, {
          intent:
            prompt === null
              ? { _tag: "Unblock", cartId: "session", cartCode: "session" }
              : intentOfAction(prompt.pending),
          error: failure,
          failureSpan: failure.failureSpan
        })
      })
    }
  })
})
