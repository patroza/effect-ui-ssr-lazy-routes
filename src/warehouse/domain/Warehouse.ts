import { Schema } from "effect"
import * as LocalizedValidation from "../../form/localizedValidation.ts"
import * as SchemaForm from "../../form/SchemaForm.ts"
import * as I18n from "../../i18n/I18n.ts"
import * as ApiError from "../../rpc/domain/ApiError.ts"
import * as CommandTrace from "../../workflow/CommandTrace.ts"

/** Marker proving the warehouse domain schema lands only in the Warehouse chunk (see scripts/verify-bundles.ts). */
export const WAREHOUSE_SCHEMA_CHUNK = "SENTINEL:warehouse-schema"

export const CartStatus = Schema.Literals(["Free", "InUse", "Blocked", "Dispatched"])
export type CartStatus = typeof CartStatus.Type

export const BlockReason = Schema.Literals(["maintenance", "damage", "inventory", "other"])
export type BlockReason = typeof BlockReason.Type

export const BlockCartFieldPath = Schema.Literals(["reason", "note"])
export type BlockCartFieldPath = typeof BlockCartFieldPath.Type

export const WarehouseCart = Schema.Struct({
  id: Schema.String,
  code: Schema.String,
  station: Schema.NullOr(Schema.String),
  status: CartStatus,
  pickCount: Schema.Finite,
  valueCents: Schema.Finite,
  warningCount: Schema.Finite,
  blockReason: Schema.NullOr(BlockReason),
  blockNote: Schema.NullOr(Schema.String),
  lastBatchId: Schema.NullOr(Schema.String)
})
export type WarehouseCart = typeof WarehouseCart.Type

export const BlockCartFormValues = Schema.Struct({
  reason: BlockReason,
  note: Schema.String
})
export type BlockCartFormValues = typeof BlockCartFormValues.Type

export const defaultBlockCartFormValues: BlockCartFormValues = {
  reason: "maintenance",
  note: ""
}

export const DispatchStepKey = Schema.Literals(["validate", "reserve", "print", "erp"])
export type DispatchStepKey = typeof DispatchStepKey.Type

export const DispatchStepResult = Schema.Struct({
  step: DispatchStepKey,
  completed: Schema.Finite,
  total: Schema.Finite,
  batchId: Schema.NullOr(Schema.String)
})
export type DispatchStepResult = typeof DispatchStepResult.Type

export const PreflightReleaseResult = Schema.Struct({
  cartId: Schema.String,
  cartCode: Schema.String,
  pickCount: Schema.Finite
})
export type PreflightReleaseResult = typeof PreflightReleaseResult.Type

export const ReleaseCartResult = Schema.Struct({
  cart: WarehouseCart,
  clearedPicks: Schema.Finite
})
export type ReleaseCartResult = typeof ReleaseCartResult.Type

export const PreflightDispatchResult = Schema.Struct({
  cartId: Schema.String,
  cartCode: Schema.String,
  pickCount: Schema.Finite,
  valueCents: Schema.Finite,
  warningCount: Schema.Finite
})
export type PreflightDispatchResult = typeof PreflightDispatchResult.Type

/**
 * Conflict domain error mirroring `macs-holding/scanner`'s
 * `ResourceCheckoutConflictError` (`CommanderErrorRenderers` demo).
 */
export class ResourceCheckoutConflictError extends Schema.TaggedError<
  ResourceCheckoutConflictError,
  { readonly brand: unique symbol }
>()("ResourceCheckoutConflictError", {
  reason: Schema.Literals(["spot-has-cart", "resource-in-use"]),
  resourceType: Schema.Literals(["cart", "packing-station"]),
  resourceName: Schema.String
}) {}

/** Typed error when attempting to release a cart actively locked by another packer. */
export class CartInUseError extends Schema.TaggedError<CartInUseError, { readonly brand: unique symbol }>()(
  "CartInUseError",
  {
    cartCode: Schema.String,
    station: Schema.String
  }
) {}

/**
 * Auth-boundary error mirroring `scanner`'s `NotLoggedInError` / `AuthPrompt`
 * recovery flow across Commands without silent data loss.
 */
export class SessionExpiredError extends Schema.TaggedError<SessionExpiredError, { readonly brand: unique symbol }>()(
  "SessionExpiredError",
  {
    action: Schema.String
  }
) {}

export const WarehouseDomainError = Schema.Union([
  ResourceCheckoutConflictError,
  CartInUseError,
  SessionExpiredError,
  ApiError.ApiError
])
export type WarehouseDomainError = typeof WarehouseDomainError.Type

export const WarehouseWireError = Schema.Union([
  WarehouseDomainError,
  Schema.TaggedStruct("RpcClientError", {
    message: Schema.String
  })
])

/**
 * Schema-serializable Command error envelope carrying the active Command run's
 * OTel `SpanPointer` so error banners show `Ref <traceId>` and retries link cleanly.
 */
export class WarehouseCommandFailure extends Schema.TaggedError<
  WarehouseCommandFailure,
  { readonly brand: unique symbol }
>()("WarehouseCommandFailure", {
  error: Schema.Union([ResourceCheckoutConflictError, CartInUseError, SessionExpiredError, ApiError.ApiError]),
  transportMessage: Schema.NullOr(Schema.String),
  failureSpan: Schema.NullOr(CommandTrace.SpanPointer)
}) {}

export interface BlockNoteCheck {
  readonly reason: BlockReason
  readonly note: string
}

const makeValidateBlockCartCrossFields =
  (t: I18n.TranslateFn) =>
  (values: BlockNoteCheck): ReadonlyArray<SchemaForm.FormIssueItem> => {
    if ((values.reason === "damage" || values.reason === "other") && values.note.trim().length < 5) {
      return [
        {
          path: "note",
          message: t("warehouse.blockNoteRequired")
        }
      ]
    }
    return []
  }

const makeBlockCartSubmissionSchema = (t: I18n.TranslateFn) => {
  const cross = makeValidateBlockCartCrossFields(t)
  return Schema.Struct({
    reason: BlockReason.annotate({ title: t("warehouse.fields.reason") }),
    note: Schema.String.annotate({
      title: t("warehouse.fields.note"),
      description: t("warehouse.fields.note.desc")
    })
  }).pipe(
    Schema.check(
      Schema.makeFilter((input) => {
        const issues = cross(input)
        if (issues.length === 0) return undefined
        return issues.map((item): Schema.FilterIssue => ({
          path: [item.path],
          issue: item.message
        }))
      })
    )
  )
}

const makeBlockCartSchemaForm = (locale: I18n.AppLocale) => {
  const { t } = I18n.translatorFor(locale)
  const formSchema = LocalizedValidation.annotateLiteralUnionMessages(makeBlockCartSubmissionSchema(t), t)
  const hooks = LocalizedValidation.makeLocalizedHooks(t)
  return SchemaForm.make({
    valueSchema: BlockCartFormValues,
    formSchema,
    mode: "onChange",
    leafHook: hooks.leafHook,
    checkHook: hooks.checkHook,
    crossFieldChecks: makeValidateBlockCartCrossFields(t)
  })
}

export type BlockCartSchemaFormController = ReturnType<typeof makeBlockCartSchemaForm>

const cachedBlockForms = new Map<I18n.AppLocale, BlockCartSchemaFormController>()

/** Returns a cached locale-aware `SchemaForm` controller for the Block Cart modal. */
export const getBlockCartSchemaForm = (locale: I18n.AppLocale = "en"): BlockCartSchemaFormController => {
  if (I18n.getCatalog(locale) === undefined) return makeBlockCartSchemaForm(locale)
  const existing = cachedBlockForms.get(locale)
  if (existing !== undefined) return existing
  const created = makeBlockCartSchemaForm(locale)
  cachedBlockForms.set(locale, created)
  return created
}

export const blockReasonLabel = (t: I18n.TranslateFn, reason: BlockReason): string => {
  switch (reason) {
    case "maintenance":
      return t("warehouse.reasonMaintenance")
    case "damage":
      return t("warehouse.reasonDamage")
    case "inventory":
      return t("warehouse.reasonInventory")
    case "other":
      return t("warehouse.reasonOther")
  }
}

export const dispatchStepLabel = (t: I18n.TranslateFn, step: DispatchStepKey): string => {
  switch (step) {
    case "validate":
      return t("warehouse.stepValidate")
    case "reserve":
      return t("warehouse.stepReserve")
    case "print":
      return t("warehouse.stepPrint")
    case "erp":
      return t("warehouse.stepErp")
  }
}

/**
 * Counterpart to `scanner`'s `CommanderErrorRenderers` registry: maps typed
 * warehouse domain failures (and transport failures) into localized user messages.
 */
export const describeWarehouseFailure = (t: I18n.TranslateFn, failure: WarehouseCommandFailure): string => {
  if (failure.transportMessage !== null) {
    return t("warehouse.errorRpcUnavailable")
  }
  const err = failure.error
  switch (err._tag) {
    case "ResourceCheckoutConflictError": {
      const resourceType = err.resourceType === "cart" ? t("warehouse.resourceCart") : t("warehouse.resourceStation")
      return err.reason === "spot-has-cart"
        ? t("warehouse.errorConflictSpot", { resourceType, resourceName: err.resourceName })
        : t("warehouse.errorConflictInUse", { resourceType, resourceName: err.resourceName })
    }
    case "CartInUseError":
      return t("warehouse.errorCartInUse", { cartCode: err.cartCode, station: err.station })
    case "SessionExpiredError":
      return t("warehouse.errorSessionExpired", { action: err.action })
    case "ApiError":
      return t("warehouse.errorUnknown", { message: err.message })
  }
}
