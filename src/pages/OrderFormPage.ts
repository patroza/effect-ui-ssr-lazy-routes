import { Command, Component, Head, Router, UiSchema } from "@effect/ui"
import { Html, HtmlCommand } from "@effect/ui/html"
import { Button, Field, Fieldset, Form, makeRadioGroup, makeSelect } from "@effect/ui-kit"
import { Array as Arr, Layer, Option, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { RpcClientError } from "effect/rpc"
import * as Design from "../design/classes.ts"
import * as FormControls from "../form/FormControls.ts"
import * as SchemaForm from "../form/SchemaForm.ts"
import * as SubmitOrder from "../order/commands/SubmitOrder.ts"
import * as Order from "../order/domain/Order.ts"
import * as CheckOrderCode from "../order/queries/CheckOrderCode.ts"
import * as ValidatePromoCode from "../order/queries/ValidatePromoCode.ts"
import type * as ApiError from "../rpc/domain/ApiError.ts"

/** Marker proving which chunk this page lands in (see scripts/verify-bundles.ts). */
export const ORDER_FORM_PAGE_CHUNK = "SENTINEL:order-form-page"

const BillingRadioGroup = makeRadioGroup({ value: Order.BillingMethodTag })
const TermsSelect = makeSelect({ value: Order.PaymentTerms })
const ErrorSummaryRef = Html.ref("OrderErrorSummary", "div")

const billingItems = [
  { value: "Card" as const, label: "Credit / Corporate Card" },
  { value: "Invoice" as const, label: "Net Terms Invoice ($100+)" }
] as const

const paymentTermsItems = [
  { value: "15" as const, label: "Net 15 days" },
  { value: "30" as const, label: "Net 30 days" },
  { value: "60" as const, label: "Net 60 days" }
] as const

const SubmitState = UiSchema.TaggedEnum({
  Idle: {},
  Submitting: {},
  Succeeded: { receipt: Order.OrderReceipt },
  Failed: { message: Schema.String }
})

export const OrderFormPageMessage = UiSchema.TaggedEnum({
  UpdatedProjectCode: { value: Schema.String },
  AppliedSuggestedCode: { code: Schema.String },
  UpdatedContactEmail: { value: Schema.String },
  UpdatedPromoCode: { value: Schema.String },
  SwitchedBillingMethod: { method: Order.BillingMethodTag },
  UpdatedCardholderName: { value: Schema.String },
  UpdatedBillingZip: { value: Schema.String },
  UpdatedCompanyName: { value: Schema.String },
  UpdatedPoNumber: { value: Schema.String },
  SetTermsSelectOpen: { open: Schema.Boolean },
  PickedPaymentTerms: { days: Order.PaymentTerms },
  AddedLineItem: {},
  RemovedLineItem: { id: Schema.String },
  UpdatedLineSku: { id: Schema.String, value: Schema.String },
  UpdatedLineQuantity: { id: Schema.String, value: Schema.NullOr(Schema.Finite) },
  UpdatedLinePrice: { id: Schema.String, value: Schema.NullOr(Schema.Finite) },
  ToggledExpedited: { checked: Schema.Boolean },
  UpdatedDeliveryNote: { value: Schema.String },
  ToggledAcceptTerms: { checked: Schema.Boolean },
  BlurredField: { path: Order.OrderFieldPath },
  ClickedReset: {},
  SubmittedForm: {},
  SucceededSubmit: { receipt: Order.OrderReceipt },
  FailedSubmitValidation: {
    fieldErrors: Schema.Record(Schema.String, Schema.Array(Schema.String)),
    formErrors: Schema.Array(Schema.String)
  },
  FailedSubmitTransport: { message: Schema.String }
})

type Msg = typeof OrderFormPageMessage.Type

const evaluateCodeCheck = (
  form: SchemaForm.FormState<Order.OrderFormValues>,
  result: AsyncResult.AsyncResult<Order.OrderCodeCheckResult, ApiError.ApiError | RpcClientError.RpcClientError>,
  passesSync: boolean
): SchemaForm.AsyncCheckStatus => {
  if (form.values.projectCode.trim() === "" || !passesSync) return { _tag: "Idle" }
  return SchemaForm.asyncCheckFromResult(
    result,
    (res) => (res.available ? [] : [res.reason ?? "Project code is unavailable"]),
    "Could not verify project code availability — please try again"
  )
}

const evaluatePromoCheck = (
  form: SchemaForm.FormState<Order.OrderFormValues>,
  result: AsyncResult.AsyncResult<Order.PromoValidationResult, ApiError.ApiError | RpcClientError.RpcClientError>,
  passesSync: boolean
): SchemaForm.AsyncCheckStatus => {
  if (form.values.promoCode.trim() === "" || !passesSync) return { _tag: "Idle" }
  return SchemaForm.asyncCheckFromResult(
    result,
    (res) => (res.valid ? [] : [res.description ?? "Promo code is not recognized"]),
    "Could not verify promo code — please try again"
  )
}

const deriveOrderForm = (
  form: SchemaForm.FormState<Order.OrderFormValues>,
  codeResult: AsyncResult.AsyncResult<Order.OrderCodeCheckResult, ApiError.ApiError | RpcClientError.RpcClientError>,
  promoResult: AsyncResult.AsyncResult<Order.PromoValidationResult, ApiError.ApiError | RpcClientError.RpcClientError>
) => {
  const syncDerived = Order.OrderSchemaForm.derive(form)
  const codeStatus = evaluateCodeCheck(form, codeResult, syncDerived.fieldPassesSync("projectCode"))
  const promoStatus = evaluatePromoCheck(form, promoResult, syncDerived.fieldPassesSync("promoCode"))
  return Order.OrderSchemaForm.derive(form, {
    projectCode: codeStatus,
    promoCode: promoStatus
  })
}

type OrderDerivedForm = SchemaForm.DerivedFormState<Order.OrderSubmission, SchemaForm.FieldPath<Order.OrderFormValues>>

const updateFormField = (
  model: {
    readonly form: SchemaForm.FormState<Order.OrderFormValues>
    readonly nextLineId: number
    readonly termsSelectOpen: boolean
    readonly submit: typeof SubmitState.Type
  },
  path: SchemaForm.FieldPath<Order.OrderFormValues>,
  updater: (values: Order.OrderFormValues) => Order.OrderFormValues
) => ({
  ...model,
  form: Order.OrderSchemaForm.update(model.form, path, updater),
  submit: model.submit._tag === "Failed" ? SubmitState.Idle() : model.submit
})

const removeFormArrayItem = (
  model: {
    readonly form: SchemaForm.FormState<Order.OrderFormValues>
    readonly nextLineId: number
    readonly termsSelectOpen: boolean
    readonly submit: typeof SubmitState.Type
  },
  arrayPath: SchemaForm.FieldPath<Order.OrderFormValues>,
  index: number,
  updater: (values: Order.OrderFormValues) => Order.OrderFormValues
) => ({
  ...model,
  form: Order.OrderSchemaForm.removeArrayItem(model.form, arrayPath, index, updater),
  submit: model.submit._tag === "Failed" ? SubmitState.Idle() : model.submit
})

const updateLineItem = (
  values: Order.OrderFormValues,
  id: string,
  updater: (item: Order.LineItemForm) => Order.LineItemForm
): Order.OrderFormValues => ({
  ...values,
  items: Arr.map(values.items, (item) => (item.id === id ? updater(item) : item))
})

const lineItemIndex = (values: Order.OrderFormValues, id: string): number =>
  values.items.findIndex((item) => item.id === id)

const renderCodeAdornment = (
  h: Html.H<Msg>,
  values: Order.OrderFormValues,
  fieldState: SchemaForm.DerivedFieldState,
  codeResult: AsyncResult.AsyncResult<Order.OrderCodeCheckResult, ApiError.ApiError | RpcClientError.RpcClientError>
) => {
  if (values.projectCode.trim() === "") return undefined
  if (fieldState.status === "Validating") {
    return h.div
      .class(Design.ui.muted)
      .attr("data-testid", "project-code-status")
      .children("Checking project code availability…")
  }
  if (fieldState.status === "Valid" && AsyncResult.isSuccess(codeResult) && codeResult.value.available) {
    return h.div
      .class("text-sm text-emerald-700 dark:text-emerald-400")
      .attr("data-testid", "project-code-status")
      .children("Available ✓")
  }
  if (
    fieldState.status === "Invalid" &&
    AsyncResult.isSuccess(codeResult) &&
    !codeResult.value.available &&
    codeResult.value.suggestion !== null
  ) {
    const suggestion = codeResult.value.suggestion
    return h.div
      .class(Design.ui.row)
      .attr("data-testid", "project-code-status")
      .children(
        h.span.class(Design.ui.muted).children("Suggestion:"),
        Button(h, {
          onPress: OrderFormPageMessage.AppliedSuggestedCode({ code: suggestion })
        })
          .class(Design.ui.button)
          .attr("data-testid", "project-code-suggestion")
          .children(`Use "${suggestion}"`)
      )
  }
  return undefined
}

const renderPromoAdornment = (
  h: Html.H<Msg>,
  values: Order.OrderFormValues,
  fieldState: SchemaForm.DerivedFieldState,
  promoResult: AsyncResult.AsyncResult<Order.PromoValidationResult, ApiError.ApiError | RpcClientError.RpcClientError>
) => {
  if (values.promoCode.trim() === "") return undefined
  if (fieldState.status === "Validating") {
    return h.div.class(Design.ui.muted).attr("data-testid", "promo-code-status").children("Validating promo code…")
  }
  if (fieldState.status === "Valid" && AsyncResult.isSuccess(promoResult) && promoResult.value.valid) {
    return h.div
      .class("text-sm text-emerald-700 dark:text-emerald-400")
      .attr("data-testid", "promo-code-status")
      .children(`Applied: ${promoResult.value.description ?? `${promoResult.value.discountPercent}% off`}`)
  }
  return undefined
}

const renderBillingSection = (
  h: Html.H<Msg>,
  values: Order.OrderFormValues,
  derived: OrderDerivedForm,
  termsSelectOpen: boolean,
  isSubmitting: boolean
) => {
  const billingTypeState = derived.field("billing")
  return h.div.class(`${Design.ui.card} ${Design.ui.stack}`).children(
    h.h2.class("text-lg font-semibold").children("2. Billing Method"),
    Field(h, {
      key: "field-billing-type",
      props: {
        disabled: isSubmitting,
        invalid: billingTypeState.invalid,
        dirty: billingTypeState.dirty,
        filled: true
      },
      view: (field) =>
        BillingRadioGroup(h, {
          props: {
            value: values.billing._tag,
            items: billingItems.map(({ value }) => ({ value })),
            name: "billingType",
            disabled: field.disabled,
            invalid: field.invalid
          },
          onEmit: {
            Picked: ({ value }) => OrderFormPageMessage.SwitchedBillingMethod({ method: value })
          },
          view: (radioGroup) =>
            field.root(h.div.class("flex flex-col gap-2")).children(
              field.legend(h.div.class("text-sm font-medium")).children("Billing method"),
              radioGroup.root(field.group(h.div.class("flex flex-wrap gap-3"))).children(
                billingItems.map(({ value, label }) =>
                  h.label
                    .key(value)
                    .class(
                      "inline-flex cursor-pointer items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700"
                    )
                    .children(
                      radioGroup
                        .radio({
                          element: field.member(h.button).attr("data-testid", `billing-radio-${value}`),
                          value
                        })
                        .class(
                          "inline-flex size-4 items-center justify-center rounded-full border border-neutral-400 data-[checked]:border-neutral-900 dark:data-[checked]:border-neutral-100"
                        )
                        .children(
                          radioGroup
                            .indicator({ element: h.span, value })
                            ?.class("size-2 rounded-full bg-neutral-900 dark:bg-neutral-100")
                        ),
                      label
                    )
                )
              ),
              field
                .error(h.p)
                ?.class("text-sm font-medium text-red-600 dark:text-red-400")
                .children(billingTypeState.errors[0] ?? "")
            )
        })
    }),
    values.billing._tag === "Card"
      ? h.div
          .key("billing-card")
          .class("grid gap-4 sm:grid-cols-2")
          .children(
            FormControls.textField(h, {
              fieldKey: "field-cardholder-name",
              name: "billing.cardholderName",
              label: Order.OrderSchemaForm.labelFor("billing.cardholderName"),
              value: values.billing.cardholderName,
              state: derived.field("billing.cardholderName"),
              required: true,
              disabled: isSubmitting,
              placeholder: "Ada Lovelace",
              testId: "billing-cardholder",
              errorTestId: "billing-cardholder-error",
              onUpdate: (value) => OrderFormPageMessage.UpdatedCardholderName({ value }),
              onBlur: OrderFormPageMessage.BlurredField({ path: "billing.cardholderName" })
            }),
            FormControls.textField(h, {
              fieldKey: "field-billing-zip",
              name: "billing.billingZip",
              label: Order.OrderSchemaForm.labelFor("billing.billingZip"),
              value: values.billing.billingZip,
              state: derived.field("billing.billingZip"),
              required: true,
              disabled: isSubmitting,
              placeholder: "94107",
              testId: "billing-zip",
              errorTestId: "billing-zip-error",
              onUpdate: (value) => OrderFormPageMessage.UpdatedBillingZip({ value }),
              onBlur: OrderFormPageMessage.BlurredField({ path: "billing.billingZip" })
            })
          )
      : (() => {
          const invoice = values.billing
          const termsState = derived.field("billing.paymentTermsDays")
          return h.div
            .key("billing-invoice")
            .class("grid gap-4 sm:grid-cols-3")
            .children(
              FormControls.textField(h, {
                fieldKey: "field-company-name",
                name: "billing.companyName",
                label: Order.OrderSchemaForm.labelFor("billing.companyName"),
                value: invoice.companyName,
                state: derived.field("billing.companyName"),
                required: true,
                disabled: isSubmitting,
                placeholder: "Analytical Engine Co.",
                testId: "billing-company",
                errorTestId: "billing-company-error",
                onUpdate: (value) => OrderFormPageMessage.UpdatedCompanyName({ value }),
                onBlur: OrderFormPageMessage.BlurredField({ path: "billing.companyName" })
              }),
              FormControls.textField(h, {
                fieldKey: "field-po-number",
                name: "billing.poNumber",
                label: Order.OrderSchemaForm.labelFor("billing.poNumber"),
                value: invoice.poNumber,
                state: derived.field("billing.poNumber"),
                required: true,
                disabled: isSubmitting,
                placeholder: "PO-2026",
                testId: "billing-po",
                errorTestId: "billing-po-error",
                onUpdate: (value) => OrderFormPageMessage.UpdatedPoNumber({ value }),
                onBlur: OrderFormPageMessage.BlurredField({ path: "billing.poNumber" })
              }),
              Field(h, {
                key: "field-payment-terms",
                props: {
                  disabled: isSubmitting,
                  invalid: termsState.invalid,
                  dirty: termsState.dirty,
                  filled: true
                },
                view: (field) =>
                  TermsSelect(h, {
                    props: {
                      open: termsSelectOpen,
                      value: invoice.paymentTermsDays,
                      items: paymentTermsItems,
                      name: "billing.paymentTermsDays",
                      disabled: field.disabled,
                      topLayer: false
                    },
                    onEmit: {
                      RequestedOpen: () => OrderFormPageMessage.SetTermsSelectOpen({ open: true }),
                      RequestedClose: () => OrderFormPageMessage.SetTermsSelectOpen({ open: false }),
                      Picked: ({ value }) =>
                        typeof value === "string"
                          ? OrderFormPageMessage.PickedPaymentTerms({ days: value })
                          : undefined,
                      Settled: () => undefined
                    },
                    view: (select) =>
                      field.root(h.div.class("relative flex flex-col gap-1.5")).children(
                        select.label(h.div.class("text-sm font-medium")).children("Payment terms"),
                        field.focusWithin(h.div.class("relative")).children(
                          select
                            .trigger(field.member(h.button))
                            .class(`${Design.ui.input} flex items-center justify-between text-left`)
                            .attr("data-testid", "billing-terms-trigger")
                            .children(select.value(h.span), select.icon(h.span).children("▾")),
                          select
                            .positioner(
                              h.div.class(
                                "z-20 mt-1 w-full rounded-md border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
                              )
                            )
                            .children(
                              select.popup(h.div.class("flex flex-col")).children(
                                paymentTermsItems.map(({ value, label }) =>
                                  select
                                    .item({ element: h.div, value })
                                    .class(
                                      "flex cursor-pointer items-center justify-between rounded px-2.5 py-1.5 text-sm data-[highlighted]:bg-neutral-100 data-[selected]:font-medium dark:data-[highlighted]:bg-neutral-800"
                                    )
                                    .attr("data-testid", `billing-terms-option-${value}`)
                                    .children(
                                      select.itemText(h.div).children(label),
                                      select.itemIndicator({ element: h.span, value })?.children("✓")
                                    )
                                )
                              )
                            )
                        ),
                        field
                          .error(h.p)
                          ?.class("text-sm font-medium text-red-600 dark:text-red-400")
                          .children(termsState.errors[0] ?? "")
                      )
                  })
              })
            )
        })()
  )
}

const renderLineItemsSection = (
  h: Html.H<Msg>,
  values: Order.OrderFormValues,
  derived: OrderDerivedForm,
  isSubmitting: boolean
) => {
  const itemsState = derived.field("items")
  return h.div.class(`${Design.ui.card} ${Design.ui.stack}`).children(
    h.div.class(`${Design.ui.row} justify-between`).children(
      h.div.children(
        h.h2.class("text-lg font-semibold").children("3. Line Items"),
        h.p.class(Design.ui.muted).children("Up to 5 items; duplicate SKUs are rejected across rows.")
      ),
      Button(h, {
        props: { disabled: isSubmitting || values.items.length >= 5 },
        onPress: OrderFormPageMessage.AddedLineItem()
      })
        .class(Design.ui.button)
        .attr("data-testid", "add-line-item")
        .children("Add item")
    ),
    itemsState.errors[0] === undefined
      ? undefined
      : h.p
          .key("items-array-error")
          .class("text-sm font-medium text-red-600 dark:text-red-400")
          .attr("role", "alert")
          .attr("data-testid", "items-array-error")
          .children(itemsState.errors[0]),
    h.div.class(Design.ui.stack).children(
      values.items.map((item, index) => {
        const lineTotals = Order.calculateOrderTotals({ items: [item], expedited: false }, 0)
        return h.div
          .key(item.id)
          .class(
            "grid gap-3 rounded-md border border-neutral-200 p-3 sm:grid-cols-[2fr_1fr_1fr_auto] dark:border-neutral-800"
          )
          .attr("data-testid", `line-item-${index}`)
          .children(
            FormControls.textField(h, {
              fieldKey: `field-${item.id}-sku`,
              name: `items.${index}.sku`,
              label: `Item #${index + 1} SKU`,
              value: item.sku,
              state: derived.field(`items.${index}.sku`),
              required: true,
              disabled: isSubmitting,
              placeholder: "CUSTOM-SKU",
              testId: `item-${index}-sku`,
              errorTestId: `item-${index}-sku-error`,
              onUpdate: (value) => OrderFormPageMessage.UpdatedLineSku({ id: item.id, value }),
              onBlur: OrderFormPageMessage.BlurredField({ path: `items.${index}.sku` })
            }),
            FormControls.numberField(h, {
              fieldKey: `field-${item.id}-qty`,
              name: `items.${index}.quantity`,
              label: "Quantity",
              value: item.quantity,
              state: derived.field(`items.${index}.quantity`),
              required: true,
              disabled: isSubmitting,
              min: 1,
              max: 100,
              step: 1,
              testId: `item-${index}-quantity`,
              decrementTestId: `item-${index}-quantity-dec`,
              incrementTestId: `item-${index}-quantity-inc`,
              errorTestId: `item-${index}-quantity-error`,
              onUpdate: (value) => OrderFormPageMessage.UpdatedLineQuantity({ id: item.id, value }),
              onBlur: OrderFormPageMessage.BlurredField({ path: `items.${index}.quantity` })
            }),
            FormControls.numberField(h, {
              fieldKey: `field-${item.id}-price`,
              name: `items.${index}.unitPriceDollars`,
              label: "Unit price",
              value: item.unitPriceDollars,
              state: derived.field(`items.${index}.unitPriceDollars`),
              required: true,
              disabled: isSubmitting,
              min: 1,
              max: 10_000,
              step: 1,
              format: { style: "currency", currency: "USD" },
              testId: `item-${index}-price`,
              decrementTestId: `item-${index}-price-dec`,
              incrementTestId: `item-${index}-price-inc`,
              errorTestId: `item-${index}-price-error`,
              onUpdate: (value) => OrderFormPageMessage.UpdatedLinePrice({ id: item.id, value }),
              onBlur: OrderFormPageMessage.BlurredField({ path: `items.${index}.unitPriceDollars` })
            }),
            h.div.class("flex flex-col items-end justify-between gap-2").children(
              h.span
                .class(`${Design.ui.muted} pt-1 font-medium`)
                .attr("data-testid", `item-${index}-subtotal`)
                .children(Order.formatCents(lineTotals.subtotalCents)),
              Button(h, {
                props: { disabled: isSubmitting },
                onPress: OrderFormPageMessage.RemovedLineItem({ id: item.id })
              })
                .class(Design.ui.button)
                .attr("data-testid", `item-${index}-remove`)
                .children("Remove")
            )
          )
      })
    )
  )
}

const OrderFormPageNoDeps = Html.component({
  name: "OrderFormPage",
  model: Schema.Struct({
    form: Order.OrderSchemaForm.State,
    nextLineId: Schema.Finite,
    termsSelectOpen: Schema.Boolean,
    submit: SubmitState
  }),
  message: OrderFormPageMessage,
  queries: {
    codeCheck: {
      query: CheckOrderCode.CheckOrderCode,
      debounce: "300 millis",
      args: ({ model }) => {
        const code = model.form.values.projectCode
        if (code.trim() === "") return undefined
        const derived = Order.OrderSchemaForm.derive(model.form)
        return derived.fieldPassesSync("projectCode") ? { code } : undefined
      }
    },
    promoCheck: {
      query: ValidatePromoCode.ValidatePromoCode,
      debounce: "300 millis",
      args: ({ model }) => {
        const code = model.form.values.promoCode
        if (code.trim() === "") return undefined
        const derived = Order.OrderSchemaForm.derive(model.form)
        return derived.fieldPassesSync("promoCode") ? { code } : undefined
      }
    }
  }
}).make({
  init: () => ({
    form: Order.OrderSchemaForm.init(Order.defaultOrderFormValues),
    nextLineId: 2,
    termsSelectOpen: false,
    submit: SubmitState.Idle()
  }),
  subscriptions: ({ model }) => (Order.OrderSchemaForm.isDirty(model.form) ? [Router.blocked("order-form")] : []),
  update: ($, message) =>
    OrderFormPageMessage.match(message, {
      UpdatedProjectCode: ({ value }) => updateFormField($.model, "projectCode", (v) => ({ ...v, projectCode: value })),
      AppliedSuggestedCode: ({ code }) => updateFormField($.model, "projectCode", (v) => ({ ...v, projectCode: code })),
      UpdatedContactEmail: ({ value }) =>
        updateFormField($.model, "contactEmail", (v) => ({ ...v, contactEmail: value })),
      UpdatedPromoCode: ({ value }) => updateFormField($.model, "promoCode", (v) => ({ ...v, promoCode: value })),
      SwitchedBillingMethod: ({ method }) => ({
        ...updateFormField($.model, "billing", (v) => ({
          ...v,
          billing: method === "Card" ? Order.defaultCardBilling() : Order.defaultInvoiceBilling()
        })),
        termsSelectOpen: false
      }),
      UpdatedCardholderName: ({ value }) =>
        updateFormField($.model, "billing.cardholderName", (v) =>
          v.billing._tag === "Card" ? { ...v, billing: { ...v.billing, cardholderName: value } } : v
        ),
      UpdatedBillingZip: ({ value }) =>
        updateFormField($.model, "billing.billingZip", (v) =>
          v.billing._tag === "Card" ? { ...v, billing: { ...v.billing, billingZip: value } } : v
        ),
      UpdatedCompanyName: ({ value }) =>
        updateFormField($.model, "billing.companyName", (v) =>
          v.billing._tag === "Invoice" ? { ...v, billing: { ...v.billing, companyName: value } } : v
        ),
      UpdatedPoNumber: ({ value }) =>
        updateFormField($.model, "billing.poNumber", (v) =>
          v.billing._tag === "Invoice" ? { ...v, billing: { ...v.billing, poNumber: value } } : v
        ),
      SetTermsSelectOpen: ({ open }) => $.evolve({ termsSelectOpen: open }),
      PickedPaymentTerms: ({ days }) => ({
        ...updateFormField($.model, "billing.paymentTermsDays", (v) =>
          v.billing._tag === "Invoice" ? { ...v, billing: { ...v.billing, paymentTermsDays: days } } : v
        ),
        termsSelectOpen: false
      }),
      AddedLineItem: () =>
        $.model.form.values.items.length >= 5
          ? $.model
          : {
              ...updateFormField($.model, "items", (v) => ({
                ...v,
                items: [...v.items, { id: `line-${$.model.nextLineId}`, sku: "", quantity: 1, unitPriceDollars: 25 }]
              })),
              nextLineId: $.model.nextLineId + 1
            },
      RemovedLineItem: ({ id }) => {
        const index = lineItemIndex($.model.form.values, id)
        if (index < 0) return $.model
        return removeFormArrayItem($.model, "items", index, (v) => ({
          ...v,
          items: v.items.filter((item) => item.id !== id)
        }))
      },
      UpdatedLineSku: ({ id, value }) => {
        const index = lineItemIndex($.model.form.values, id)
        if (index < 0) return $.model
        return updateFormField($.model, `items.${index}.sku`, (v) =>
          updateLineItem(v, id, (item) => ({ ...item, sku: value }))
        )
      },
      UpdatedLineQuantity: ({ id, value }) => {
        const index = lineItemIndex($.model.form.values, id)
        if (index < 0) return $.model
        return updateFormField($.model, `items.${index}.quantity`, (v) =>
          updateLineItem(v, id, (item) => ({ ...item, quantity: value }))
        )
      },
      UpdatedLinePrice: ({ id, value }) => {
        const index = lineItemIndex($.model.form.values, id)
        if (index < 0) return $.model
        return updateFormField($.model, `items.${index}.unitPriceDollars`, (v) =>
          updateLineItem(v, id, (item) => ({ ...item, unitPriceDollars: value }))
        )
      },
      ToggledExpedited: ({ checked }) => updateFormField($.model, "expedited", (v) => ({ ...v, expedited: checked })),
      UpdatedDeliveryNote: ({ value }) =>
        updateFormField($.model, "deliveryNote", (v) => ({ ...v, deliveryNote: value })),
      ToggledAcceptTerms: ({ checked }) =>
        updateFormField($.model, "acceptTerms", (v) => ({ ...v, acceptTerms: checked })),
      BlurredField: ({ path }) => $.evolve({ form: Order.OrderSchemaForm.blur($.model.form, path) }),
      ClickedReset: () => ({
        form: Order.OrderSchemaForm.reset($.model.form, Order.defaultOrderFormValues),
        nextLineId: 2,
        termsSelectOpen: false,
        submit: SubmitState.Idle()
      }),
      SubmittedForm: () => {
        if ($.model.submit._tag === "Submitting") return $.model
        const submittedForm = Order.OrderSchemaForm.submit($.model.form)
        const derived = deriveOrderForm(submittedForm, $.queries.codeCheck, $.queries.promoCheck)
        if (Option.isNone(derived.decoded)) {
          return $.evolve({ form: submittedForm })
        }
        return $.evolve({ form: submittedForm, submit: SubmitState.Submitting() }).run(
          SubmitOrder.SubmitOrder.make({ order: derived.decoded.value }).pipe(
            Command.match({
              onSuccess: (receipt) => OrderFormPageMessage.SucceededSubmit({ receipt }),
              onFailure: (error) =>
                error._tag === "OrderValidationError"
                  ? OrderFormPageMessage.FailedSubmitValidation({
                      fieldErrors: error.fieldErrors,
                      formErrors: error.formErrors
                    })
                  : OrderFormPageMessage.FailedSubmitTransport({ message: error.message })
            })
          )
        )
      },
      SucceededSubmit: ({ receipt }) =>
        $.evolve({
          form: Order.OrderSchemaForm.rebase($.model.form),
          submit: SubmitState.Succeeded({ receipt })
        }),
      FailedSubmitValidation: ({ fieldErrors, formErrors }) =>
        $.evolve({
          form: Order.OrderSchemaForm.setServerErrors($.model.form, { fieldErrors, formErrors }),
          submit: SubmitState.Idle()
        }).run(HtmlCommand.focus(ErrorSummaryRef, () => Component.noop)),
      FailedSubmitTransport: ({ message }) =>
        $.evolve({
          submit: SubmitState.Failed({ message })
        }).run(HtmlCommand.focus(ErrorSummaryRef, () => Component.noop))
    }),
  head: () => [Head.title("Custom Order")],
  view: (h, model) => {
    const derived = deriveOrderForm(model.form, h.queries.codeCheck, h.queries.promoCheck)
    const values = model.form.values
    const isSubmitting = model.submit._tag === "Submitting"
    const discountPercent =
      values.promoCode.trim() !== "" &&
      derived.fieldPassesSync("promoCode") &&
      AsyncResult.isSuccess(h.queries.promoCheck) &&
      h.queries.promoCheck.value.valid
        ? h.queries.promoCheck.value.discountPercent
        : 0
    const totals = Order.calculateOrderTotals(values, discountPercent)

    const projectCodeState = derived.field("projectCode")
    const promoCodeState = derived.field("promoCode")

    return h.section
      .attr("data-page-chunk", ORDER_FORM_PAGE_CHUNK)
      .attr("data-order-schema", Order.ORDER_SCHEMA_CHUNK)
      .attr("data-code-query", CheckOrderCode.CHECK_ORDER_CODE_QUERY_CHUNK)
      .attr("data-promo-query", ValidatePromoCode.VALIDATE_PROMO_CODE_QUERY_CHUNK)
      .class(Design.ui.stack)
      .children(
        h.div.class(`${Design.ui.row} justify-between`).children(
          h.div.children(
            h.h1.class(Design.ui.title).children("Custom Studio Order"),
            h.p
              .class(Design.ui.muted)
              .children(
                "OmegaForm-style schema form: single Effect Schema, tagged union billing, dynamic rows, debounced async checks, and server-side rejection mapping."
              )
          ),
          h.div.class(Design.ui.row).children(
            h.span
              .key("dirty-badge")
              .class(
                derived.isDirty
                  ? "rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                  : "rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
              )
              .attr("data-testid", "form-dirty-badge")
              .children(derived.isDirty ? "Unsaved changes" : "Saved / clean"),
            Button(h, {
              props: { disabled: isSubmitting },
              onPress: OrderFormPageMessage.ClickedReset()
            })
              .class(Design.ui.button)
              .attr("data-testid", "order-reset")
              .children("Reset")
          )
        ),
        model.submit._tag === "Succeeded"
          ? h.div
              .key("order-receipt")
              .class(
                `${Design.ui.card} ${Design.ui.stack} border-emerald-300 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30`
              )
              .attrs({ role: "status", "data-testid": "order-receipt" })
              .children(
                h.div
                  .class(`${Design.ui.row} justify-between`)
                  .children(
                    h.h2
                      .class("text-lg font-semibold text-emerald-800 dark:text-emerald-300")
                      .children(`Order ${model.submit.receipt.orderId} submitted`),
                    Button(h, { onPress: OrderFormPageMessage.ClickedReset() })
                      .class(Design.ui.button)
                      .attr("data-testid", "order-start-another")
                      .children("Start another order")
                  ),
                h.p
                  .class("text-sm text-emerald-800 dark:text-emerald-300")
                  .children(
                    `Reference ${model.submit.receipt.projectCode} · Total ${Order.formatCents(model.submit.receipt.totalCents)}${model.submit.receipt.discountPercent > 0 ? ` (${model.submit.receipt.discountPercent}% discount)` : ""}.`
                  )
              )
          : undefined,
        model.submit._tag === "Failed"
          ? h.div
              .key("submit-error")
              .ref(ErrorSummaryRef)
              .class(
                `${Design.ui.card} ${Design.ui.stack} border-red-300 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30`
              )
              .attrs({ role: "alert", tabindex: "-1", "data-testid": "submit-error" })
              .children(
                h.h2
                  .class("text-sm font-semibold text-red-700 dark:text-red-300")
                  .children("Submission failed — your edits are preserved"),
                h.p.class("text-sm text-red-700 dark:text-red-300").children(model.submit.message)
              )
          : undefined,
        Form(h, {
          onEmit: {
            Submitted: () => OrderFormPageMessage.SubmittedForm()
          },
          view: (form) =>
            form.root(h.form.key("order-form").class(Design.ui.stack)).children(
              Fieldset(h, {
                props: { disabled: isSubmitting },
                view: (fieldset) =>
                  fieldset.root(h.fieldset.class(Design.ui.stack)).children(
                    h.div.class(`${Design.ui.card} ${Design.ui.stack}`).children(
                      fieldset.legend(h.div.class("text-lg font-semibold")).children("1. Project & Contact"),
                      h.div.class("grid gap-4 sm:grid-cols-2").children(
                        FormControls.textField(h, {
                          fieldKey: "field-project-code",
                          name: "projectCode",
                          label: Order.OrderSchemaForm.labelFor("projectCode"),
                          description: Order.OrderSchemaForm.meta["projectCode"]?.description,
                          value: values.projectCode,
                          state: projectCodeState,
                          required: true,
                          disabled: isSubmitting,
                          placeholder: "autumn-mug-run",
                          testId: "project-code-input",
                          errorTestId: "project-code-error",
                          statusAdornment: renderCodeAdornment(h, values, projectCodeState, h.queries.codeCheck),
                          onUpdate: (value) => OrderFormPageMessage.UpdatedProjectCode({ value }),
                          onBlur: OrderFormPageMessage.BlurredField({ path: "projectCode" })
                        }),
                        FormControls.textField(h, {
                          fieldKey: "field-contact-email",
                          name: "contactEmail",
                          label: Order.OrderSchemaForm.labelFor("contactEmail"),
                          description: Order.OrderSchemaForm.meta["contactEmail"]?.description,
                          value: values.contactEmail,
                          state: derived.field("contactEmail"),
                          required: true,
                          disabled: isSubmitting,
                          type: "email",
                          placeholder: "studio@example.com",
                          testId: "contact-email-input",
                          errorTestId: "contact-email-error",
                          onUpdate: (value) => OrderFormPageMessage.UpdatedContactEmail({ value }),
                          onBlur: OrderFormPageMessage.BlurredField({ path: "contactEmail" })
                        })
                      ),
                      FormControls.textField(h, {
                        fieldKey: "field-promo-code",
                        name: "promoCode",
                        label: Order.OrderSchemaForm.labelFor("promoCode"),
                        description: Order.OrderSchemaForm.meta["promoCode"]?.description,
                        value: values.promoCode,
                        state: promoCodeState,
                        disabled: isSubmitting,
                        placeholder: "STUDIO15",
                        testId: "promo-code-input",
                        errorTestId: "promo-code-error",
                        statusAdornment: renderPromoAdornment(h, values, promoCodeState, h.queries.promoCheck),
                        onUpdate: (value) => OrderFormPageMessage.UpdatedPromoCode({ value }),
                        onBlur: OrderFormPageMessage.BlurredField({ path: "promoCode" })
                      })
                    ),
                    renderBillingSection(h, values, derived, model.termsSelectOpen, isSubmitting),
                    renderLineItemsSection(h, values, derived, isSubmitting),
                    h.div.class(`${Design.ui.card} ${Design.ui.stack}`).children(
                      h.h2.class("text-lg font-semibold").children("4. Delivery & Terms"),
                      FormControls.switchField(h, {
                        fieldKey: "field-expedited",
                        name: "expedited",
                        label: Order.OrderSchemaForm.labelFor("expedited"),
                        description: Order.OrderSchemaForm.meta["expedited"]?.description,
                        checked: values.expedited,
                        state: derived.field("expedited"),
                        disabled: isSubmitting,
                        testId: "expedited-switch",
                        onToggle: (checked) => OrderFormPageMessage.ToggledExpedited({ checked }),
                        onBlur: OrderFormPageMessage.BlurredField({ path: "expedited" })
                      }),
                      FormControls.textField(h, {
                        fieldKey: "field-delivery-note",
                        name: "deliveryNote",
                        label: Order.OrderSchemaForm.labelFor("deliveryNote"),
                        description: Order.OrderSchemaForm.meta["deliveryNote"]?.description,
                        value: values.deliveryNote,
                        state: derived.field("deliveryNote"),
                        required: values.expedited,
                        disabled: isSubmitting,
                        placeholder: "Leave at loading dock B",
                        testId: "delivery-note-input",
                        errorTestId: "delivery-note-error",
                        onUpdate: (value) => OrderFormPageMessage.UpdatedDeliveryNote({ value }),
                        onBlur: OrderFormPageMessage.BlurredField({ path: "deliveryNote" })
                      }),
                      FormControls.checkboxField(h, {
                        fieldKey: "field-accept-terms",
                        name: "acceptTerms",
                        label: "I accept the custom production terms and lead times",
                        checked: values.acceptTerms,
                        state: derived.field("acceptTerms"),
                        disabled: isSubmitting,
                        testId: "accept-terms-checkbox",
                        errorTestId: "accept-terms-error",
                        onToggle: (checked) => OrderFormPageMessage.ToggledAcceptTerms({ checked }),
                        onBlur: OrderFormPageMessage.BlurredField({ path: "acceptTerms" })
                      })
                    ),
                    h.div
                      .class(`${Design.ui.card} flex flex-wrap items-center justify-between gap-4`)
                      .attr("data-testid", "order-summary")
                      .children(
                        h.div
                          .class("flex flex-wrap gap-4 text-sm")
                          .children(
                            h.span
                              .attr("data-testid", "summary-subtotal")
                              .children(`Subtotal: ${Order.formatCents(totals.subtotalCents)}`),
                            totals.discountCents > 0
                              ? h.span
                                  .attr("data-testid", "summary-discount")
                                  .children(`Discount: −${Order.formatCents(totals.discountCents)}`)
                              : undefined,
                            totals.expeditedFeeCents > 0
                              ? h.span
                                  .attr("data-testid", "summary-expedited")
                                  .children(`Expedited: +${Order.formatCents(totals.expeditedFeeCents)}`)
                              : undefined
                          ),
                        h.div
                          .class("text-lg font-semibold")
                          .attr("data-testid", "summary-total")
                          .children(`Total: ${Order.formatCents(totals.totalCents)}`)
                      ),
                    FormControls.errorSummary(h, {
                      errors: derived.visibleErrors,
                      labelFor: Order.OrderSchemaForm.labelFor,
                      summaryRef: model.submit._tag === "Failed" ? undefined : ErrorSummaryRef
                    }),
                    h.div.class(`${Design.ui.row} justify-end`).children(
                      Button(h, {
                        props: { type: "submit", disabled: isSubmitting }
                      })
                        .class(Design.ui.button)
                        .attr("data-testid", "order-submit")
                        .children(
                          isSubmitting
                            ? "Submitting order…"
                            : derived.isValidating
                              ? "Waiting for checks…"
                              : "Submit order"
                        )
                    )
                  )
              })
            )
        })
      )
  }
})

/**
 * The page with its own Layers: `CheckOrderCode`, `ValidatePromoCode`, and
 * `SubmitOrder` call `OrderRpcs` over `/rpc/order`, keeping the entire form
 * engine, schema, queries, command, and `@effect/ui-kit` form primitives inside
 * the Order route chunk.
 */
export const OrderFormPage = OrderFormPageNoDeps.pipe(
  Component.provide(
    Layer.mergeAll(
      CheckOrderCode.CheckOrderCode.layer,
      ValidatePromoCode.ValidatePromoCode.layer,
      SubmitOrder.SubmitOrder.layer
    )
  )
)
