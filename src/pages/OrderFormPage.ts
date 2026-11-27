import { Command, Component, Head, Router, UiSchema } from "@effect/ui"
import { Html, HtmlCommand } from "@effect/ui/html"
import { Button, Field, Fieldset, Form, makeRadioGroup, makeSelect } from "@effect/ui-kit"
import { Array as Arr, Layer, Option, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { RpcClientError } from "effect/rpc"
import * as Design from "../design/classes.ts"
import * as FormControls from "../form/FormControls.ts"
import * as SchemaForm from "../form/SchemaForm.ts"
import * as I18n from "../i18n/I18n.ts"
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
  passesSync: boolean,
  t: I18n.TranslateFn
): SchemaForm.AsyncCheckStatus => {
  if (form.values.projectCode.trim() === "" || !passesSync) return { _tag: "Idle" }
  return SchemaForm.asyncCheckFromResult(
    result,
    (res) => (res.available ? [] : [res.reason ?? t("order.codeUnavailable")]),
    t("order.codeCheckFailed")
  )
}

const evaluatePromoCheck = (
  form: SchemaForm.FormState<Order.OrderFormValues>,
  result: AsyncResult.AsyncResult<Order.PromoValidationResult, ApiError.ApiError | RpcClientError.RpcClientError>,
  passesSync: boolean,
  t: I18n.TranslateFn
): SchemaForm.AsyncCheckStatus => {
  if (form.values.promoCode.trim() === "" || !passesSync) return { _tag: "Idle" }
  return SchemaForm.asyncCheckFromResult(
    result,
    (res) => (res.valid ? [] : [res.description ?? t("order.promoInvalid")]),
    t("order.promoCheckFailed")
  )
}

const deriveOrderForm = (
  controller: Order.OrderSchemaFormController,
  form: SchemaForm.FormState<Order.OrderFormValues>,
  codeResult: AsyncResult.AsyncResult<Order.OrderCodeCheckResult, ApiError.ApiError | RpcClientError.RpcClientError>,
  promoResult: AsyncResult.AsyncResult<Order.PromoValidationResult, ApiError.ApiError | RpcClientError.RpcClientError>,
  t: I18n.TranslateFn
) => {
  const syncDerived = controller.derive(form)
  const codeStatus = evaluateCodeCheck(form, codeResult, syncDerived.fieldPassesSync("projectCode"), t)
  const promoStatus = evaluatePromoCheck(form, promoResult, syncDerived.fieldPassesSync("promoCode"), t)
  return controller.derive(form, {
    projectCode: codeStatus,
    promoCode: promoStatus
  })
}

type OrderDerivedForm = SchemaForm.DerivedFormState<Order.OrderSubmission, SchemaForm.FieldPath<Order.OrderFormValues>>

const updateFormField = (
  controller: Order.OrderSchemaFormController,
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
  form: controller.update(model.form, path, updater),
  submit: model.submit._tag === "Failed" ? SubmitState.Idle() : model.submit
})

const removeFormArrayItem = (
  controller: Order.OrderSchemaFormController,
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
  form: controller.removeArrayItem(model.form, arrayPath, index, updater),
  submit: model.submit._tag === "Failed" ? SubmitState.Idle() : model.submit
})

const lineItemIndex = (values: Order.OrderFormValues, id: string): number =>
  values.items.findIndex((item) => item.id === id)

const updateLineItem = (
  values: Order.OrderFormValues,
  id: string,
  updater: (item: Order.LineItemForm) => Order.LineItemForm
): Order.OrderFormValues => ({
  ...values,
  items: Arr.map(values.items, (item) => (item.id === id ? updater(item) : item))
})

const renderCodeAdornment = (
  h: Html.H<Msg>,
  values: Order.OrderFormValues,
  fieldState: SchemaForm.DerivedFieldState,
  codeResult: AsyncResult.AsyncResult<Order.OrderCodeCheckResult, ApiError.ApiError | RpcClientError.RpcClientError>,
  t: I18n.TranslateFn
) => {
  if (values.projectCode.trim() === "") return undefined
  if (fieldState.status === "Validating") {
    return h.div.class(Design.ui.muted).attr("data-testid", "project-code-status").children(t("order.checkingCode"))
  }
  if (fieldState.status === "Valid" && AsyncResult.isSuccess(codeResult) && codeResult.value.available) {
    return h.div
      .class("text-sm text-emerald-700 dark:text-emerald-400")
      .attr("data-testid", "project-code-status")
      .children(t("order.codeAvailable"))
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
        Button(h, {
          onPress: OrderFormPageMessage.AppliedSuggestedCode({ code: suggestion })
        })
          .class(Design.ui.button)
          .attr("data-testid", "project-code-suggestion")
          .children(t("order.useSuggestion", { suggestion }))
      )
  }
  return undefined
}

const renderPromoAdornment = (
  h: Html.H<Msg>,
  values: Order.OrderFormValues,
  fieldState: SchemaForm.DerivedFieldState,
  promoResult: AsyncResult.AsyncResult<Order.PromoValidationResult, ApiError.ApiError | RpcClientError.RpcClientError>,
  t: I18n.TranslateFn
) => {
  if (values.promoCode.trim() === "") return undefined
  if (fieldState.status === "Validating") {
    return h.div.class(Design.ui.muted).attr("data-testid", "promo-code-status").children(t("common.loading"))
  }
  if (fieldState.status === "Valid" && AsyncResult.isSuccess(promoResult) && promoResult.value.valid) {
    return h.div
      .class("text-sm text-emerald-700 dark:text-emerald-400")
      .attr("data-testid", "promo-code-status")
      .children(
        t("order.promoApplied", {
          description: promoResult.value.description ?? `${promoResult.value.discountPercent}%`
        })
      )
  }
  return undefined
}

const renderBillingSection = (
  h: Html.H<Msg>,
  controller: Order.OrderSchemaFormController,
  values: Order.OrderFormValues,
  derived: OrderDerivedForm,
  termsSelectOpen: boolean,
  isSubmitting: boolean,
  t: I18n.TranslateFn
) => {
  const billingItems = [
    { value: "Card" as const, label: t("order.billingCardOption") },
    { value: "Invoice" as const, label: t("order.billingInvoiceOption") }
  ] as const
  const paymentTermsItems = [
    { value: "15" as const, label: t("order.terms15") },
    { value: "30" as const, label: t("order.terms30") },
    { value: "60" as const, label: t("order.terms60") }
  ] as const
  const billingTypeState = derived.field("billing")
  return h.div.class(`${Design.ui.card} ${Design.ui.stack}`).children(
    h.h2.class("text-lg font-semibold").children(t("order.sectionBilling")),
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
              field.legend(h.div.class("text-sm font-medium")).children(controller.labelFor("billing")),
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
              label: controller.labelFor("billing.cardholderName"),
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
              label: controller.labelFor("billing.billingZip"),
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
                label: controller.labelFor("billing.companyName"),
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
                label: controller.labelFor("billing.poNumber"),
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
                        select
                          .label(h.div.class("text-sm font-medium"))
                          .children(controller.labelFor("billing.paymentTermsDays")),
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
  controller: Order.OrderSchemaFormController,
  values: Order.OrderFormValues,
  derived: OrderDerivedForm,
  isSubmitting: boolean,
  i18n: I18n.I18nTranslator
) => {
  const { config, formatCurrency, t } = i18n
  const itemsState = derived.field("items")
  return h.div.class(`${Design.ui.card} ${Design.ui.stack}`).children(
    h.div.class(`${Design.ui.row} justify-between`).children(
      h.div.children(h.h2.class("text-lg font-semibold").children(t("order.sectionLineItems"))),
      Button(h, {
        props: { disabled: isSubmitting || values.items.length >= 5 },
        onPress: OrderFormPageMessage.AddedLineItem()
      })
        .class(Design.ui.button)
        .attr("data-testid", "add-line-item")
        .children(t("order.addItem"))
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
              label: controller.labelFor(`items.${index}.sku`),
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
              label: controller.meta["items.*.quantity"]?.label ?? t("order.fields.items.*.quantity"),
              value: item.quantity,
              state: derived.field(`items.${index}.quantity`),
              required: true,
              disabled: isSubmitting,
              min: 1,
              max: 100,
              step: 1,
              locale: config.bcp47,
              increaseLabel: t("common.increase"),
              decreaseLabel: t("common.decrease"),
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
              label: controller.meta["items.*.unitPriceDollars"]?.label ?? t("order.fields.items.*.unitPriceDollars"),
              value: item.unitPriceDollars,
              state: derived.field(`items.${index}.unitPriceDollars`),
              required: true,
              disabled: isSubmitting,
              min: 1,
              max: 10_000,
              step: 1,
              locale: config.bcp47,
              format: { style: "currency", currency: config.currency },
              increaseLabel: t("common.increase"),
              decreaseLabel: t("common.decrease"),
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
                .children(formatCurrency(lineTotals.subtotalCents)),
              Button(h, {
                props: { disabled: isSubmitting },
                onPress: OrderFormPageMessage.RemovedLineItem({ id: item.id })
              })
                .class(Design.ui.button)
                .attr("data-testid", `item-${index}-remove`)
                .children(t("order.removeItem"))
            )
          )
      })
    )
  )
}

const OrderFormContentNoDeps = Html.component({
  name: "OrderFormContent",
  model: Schema.Struct({
    form: Order.OrderSchemaForm.State,
    nextLineId: Schema.Finite,
    termsSelectOpen: Schema.Boolean,
    submit: SubmitState
  }),
  message: OrderFormPageMessage,
  reads: {
    i18n: I18n.I18nProvider
  },
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
  update: ($, message) => {
    const { locale } = $.reads.i18n
    const tr = I18n.translatorFor(locale)
    const controller = Order.getOrderSchemaForm(locale)
    return OrderFormPageMessage.match(message, {
      UpdatedProjectCode: ({ value }) =>
        updateFormField(controller, $.model, "projectCode", (v) => ({ ...v, projectCode: value })),
      AppliedSuggestedCode: ({ code }) =>
        updateFormField(controller, $.model, "projectCode", (v) => ({ ...v, projectCode: code })),
      UpdatedContactEmail: ({ value }) =>
        updateFormField(controller, $.model, "contactEmail", (v) => ({ ...v, contactEmail: value })),
      UpdatedPromoCode: ({ value }) =>
        updateFormField(controller, $.model, "promoCode", (v) => ({ ...v, promoCode: value })),
      SwitchedBillingMethod: ({ method }) => ({
        ...updateFormField(controller, $.model, "billing", (v) => ({
          ...v,
          billing: method === "Card" ? Order.defaultCardBilling() : Order.defaultInvoiceBilling()
        })),
        termsSelectOpen: false
      }),
      UpdatedCardholderName: ({ value }) =>
        updateFormField(controller, $.model, "billing.cardholderName", (v) =>
          v.billing._tag === "Card" ? { ...v, billing: { ...v.billing, cardholderName: value } } : v
        ),
      UpdatedBillingZip: ({ value }) =>
        updateFormField(controller, $.model, "billing.billingZip", (v) =>
          v.billing._tag === "Card" ? { ...v, billing: { ...v.billing, billingZip: value } } : v
        ),
      UpdatedCompanyName: ({ value }) =>
        updateFormField(controller, $.model, "billing.companyName", (v) =>
          v.billing._tag === "Invoice" ? { ...v, billing: { ...v.billing, companyName: value } } : v
        ),
      UpdatedPoNumber: ({ value }) =>
        updateFormField(controller, $.model, "billing.poNumber", (v) =>
          v.billing._tag === "Invoice" ? { ...v, billing: { ...v.billing, poNumber: value } } : v
        ),
      SetTermsSelectOpen: ({ open }) => $.evolve({ termsSelectOpen: open }),
      PickedPaymentTerms: ({ days }) => ({
        ...updateFormField(controller, $.model, "billing.paymentTermsDays", (v) =>
          v.billing._tag === "Invoice" ? { ...v, billing: { ...v.billing, paymentTermsDays: days } } : v
        ),
        termsSelectOpen: false
      }),
      AddedLineItem: () =>
        $.model.form.values.items.length >= 5
          ? $.model
          : {
              ...updateFormField(controller, $.model, "items", (v) => ({
                ...v,
                items: [...v.items, { id: `line-${$.model.nextLineId}`, sku: "", quantity: 1, unitPriceDollars: 25 }]
              })),
              nextLineId: $.model.nextLineId + 1
            },
      RemovedLineItem: ({ id }) => {
        const index = lineItemIndex($.model.form.values, id)
        if (index < 0) return $.model
        return removeFormArrayItem(controller, $.model, "items", index, (v) => ({
          ...v,
          items: v.items.filter((item) => item.id !== id)
        }))
      },
      UpdatedLineSku: ({ id, value }) => {
        const index = lineItemIndex($.model.form.values, id)
        if (index < 0) return $.model
        return updateFormField(controller, $.model, `items.${index}.sku`, (v) =>
          updateLineItem(v, id, (item) => ({ ...item, sku: value }))
        )
      },
      UpdatedLineQuantity: ({ id, value }) => {
        const index = lineItemIndex($.model.form.values, id)
        if (index < 0) return $.model
        return updateFormField(controller, $.model, `items.${index}.quantity`, (v) =>
          updateLineItem(v, id, (item) => ({ ...item, quantity: value }))
        )
      },
      UpdatedLinePrice: ({ id, value }) => {
        const index = lineItemIndex($.model.form.values, id)
        if (index < 0) return $.model
        return updateFormField(controller, $.model, `items.${index}.unitPriceDollars`, (v) =>
          updateLineItem(v, id, (item) => ({ ...item, unitPriceDollars: value }))
        )
      },
      ToggledExpedited: ({ checked }) =>
        updateFormField(controller, $.model, "expedited", (v) => ({ ...v, expedited: checked })),
      UpdatedDeliveryNote: ({ value }) =>
        updateFormField(controller, $.model, "deliveryNote", (v) => ({ ...v, deliveryNote: value })),
      ToggledAcceptTerms: ({ checked }) =>
        updateFormField(controller, $.model, "acceptTerms", (v) => ({ ...v, acceptTerms: checked })),
      BlurredField: ({ path }) => $.evolve({ form: controller.blur($.model.form, path) }),
      ClickedReset: () => ({
        form: controller.reset($.model.form, Order.defaultOrderFormValues),
        nextLineId: 2,
        termsSelectOpen: false,
        submit: SubmitState.Idle()
      }),
      SubmittedForm: () => {
        if ($.model.submit._tag === "Submitting") return $.model
        const submittedForm = controller.submit($.model.form)
        const derived = deriveOrderForm(controller, submittedForm, $.queries.codeCheck, $.queries.promoCheck, tr.t)
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
          form: controller.rebase($.model.form),
          submit: SubmitState.Succeeded({ receipt })
        }),
      FailedSubmitValidation: ({ fieldErrors, formErrors }) =>
        $.evolve({
          form: controller.setServerErrors($.model.form, { fieldErrors, formErrors }),
          submit: SubmitState.Idle()
        }).run(HtmlCommand.focus(ErrorSummaryRef, () => Component.noop)),
      FailedSubmitTransport: ({ message }) =>
        $.evolve({
          submit: SubmitState.Failed({ message })
        }).run(HtmlCommand.focus(ErrorSummaryRef, () => Component.noop))
    })
  },
  view: (h, model) => {
    const i18n = I18n.translator(h.reads.i18n)
    const { t, formatCurrency } = i18n
    const controller = Order.getOrderSchemaForm(h.reads.i18n.locale)
    const derived = deriveOrderForm(controller, model.form, h.queries.codeCheck, h.queries.promoCheck, t)
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
            h.h1.class(Design.ui.title).children(t("order.heading")),
            h.p.class(Design.ui.muted).children(t("order.subtitle"))
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
              .children(derived.isDirty ? t("order.dirtyUnsaved") : t("order.dirtyClean")),
            Button(h, {
              props: { disabled: isSubmitting },
              onPress: OrderFormPageMessage.ClickedReset()
            })
              .class(Design.ui.button)
              .attr("data-testid", "order-reset")
              .children(t("order.reset"))
          )
        ),
        model.submit._tag === "Succeeded"
          ? h.div
              .key("order-receipt")
              .class(`${Design.ui.cardSuccess} ${Design.ui.stack}`)
              .attrs({ role: "status", "data-testid": "order-receipt" })
              .children(
                h.div
                  .class(`${Design.ui.row} justify-between`)
                  .children(
                    h.h2
                      .class("text-lg font-semibold text-emerald-800 dark:text-emerald-300")
                      .children(t("order.receiptTitle", { orderId: model.submit.receipt.orderId })),
                    Button(h, { onPress: OrderFormPageMessage.ClickedReset() })
                      .class(Design.ui.button)
                      .attr("data-testid", "order-start-another")
                      .children(t("order.reset"))
                  ),
                h.p.class("text-sm text-emerald-800 dark:text-emerald-300").children(
                  t("order.receiptBody", {
                    projectCode: model.submit.receipt.projectCode,
                    total: formatCurrency(model.submit.receipt.totalCents),
                    discount: model.submit.receipt.discountPercent
                  })
                )
              )
          : undefined,
        model.submit._tag === "Failed"
          ? h.div
              .key("submit-error")
              .ref(ErrorSummaryRef)
              .class(`${Design.ui.cardError} ${Design.ui.stack}`)
              .attrs({ role: "alert", tabindex: "-1", "data-testid": "submit-error" })
              .children(
                h.h2
                  .class("text-sm font-semibold text-red-700 dark:text-red-300")
                  .children(t("order.submitFailed", { message: model.submit.message }))
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
                      fieldset.legend(h.div.class("text-lg font-semibold")).children(t("order.sectionDetails")),
                      h.div.class("grid gap-4 sm:grid-cols-2").children(
                        FormControls.textField(h, {
                          fieldKey: "field-project-code",
                          name: "projectCode",
                          label: controller.labelFor("projectCode"),
                          description: controller.meta["projectCode"]?.description,
                          value: values.projectCode,
                          state: projectCodeState,
                          required: true,
                          disabled: isSubmitting,
                          placeholder: "autumn-mug-run",
                          testId: "project-code-input",
                          errorTestId: "project-code-error",
                          statusAdornment: renderCodeAdornment(h, values, projectCodeState, h.queries.codeCheck, t),
                          onUpdate: (value) => OrderFormPageMessage.UpdatedProjectCode({ value }),
                          onBlur: OrderFormPageMessage.BlurredField({ path: "projectCode" })
                        }),
                        FormControls.textField(h, {
                          fieldKey: "field-contact-email",
                          name: "contactEmail",
                          label: controller.labelFor("contactEmail"),
                          description: controller.meta["contactEmail"]?.description,
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
                        label: controller.labelFor("promoCode"),
                        description: controller.meta["promoCode"]?.description,
                        value: values.promoCode,
                        state: promoCodeState,
                        disabled: isSubmitting,
                        placeholder: "STUDIO15",
                        testId: "promo-code-input",
                        errorTestId: "promo-code-error",
                        statusAdornment: renderPromoAdornment(h, values, promoCodeState, h.queries.promoCheck, t),
                        onUpdate: (value) => OrderFormPageMessage.UpdatedPromoCode({ value }),
                        onBlur: OrderFormPageMessage.BlurredField({ path: "promoCode" })
                      })
                    ),
                    renderBillingSection(h, controller, values, derived, model.termsSelectOpen, isSubmitting, t),
                    renderLineItemsSection(h, controller, values, derived, isSubmitting, i18n),
                    h.div.class(`${Design.ui.card} ${Design.ui.stack}`).children(
                      h.h2.class("text-lg font-semibold").children(t("order.sectionFulfillment")),
                      FormControls.switchField(h, {
                        fieldKey: "field-expedited",
                        name: "expedited",
                        label: controller.labelFor("expedited"),
                        description: controller.meta["expedited"]?.description,
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
                        label: controller.labelFor("deliveryNote"),
                        description: controller.meta["deliveryNote"]?.description,
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
                        label: controller.labelFor("acceptTerms"),
                        description: t("order.fields.acceptTerms.desc"),
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
                              .children(t("order.summarySubtotal", { amount: formatCurrency(totals.subtotalCents) })),
                            totals.discountCents > 0
                              ? h.span
                                  .attr("data-testid", "summary-discount")
                                  .children(
                                    t("order.summaryDiscount", { amount: formatCurrency(totals.discountCents) })
                                  )
                              : undefined,
                            totals.expeditedFeeCents > 0
                              ? h.span
                                  .attr("data-testid", "summary-expedited")
                                  .children(
                                    t("order.summaryExpedited", { amount: formatCurrency(totals.expeditedFeeCents) })
                                  )
                              : undefined
                          ),
                        h.div
                          .class("text-lg font-semibold")
                          .attr("data-testid", "summary-total")
                          .children(t("order.summaryTotal", { amount: formatCurrency(totals.totalCents) }))
                      ),
                    FormControls.errorSummary(h, {
                      title: t("validation.fixErrorsTitle"),
                      errors: derived.visibleErrors,
                      labelFor: controller.labelFor,
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
                            ? t("order.submitting")
                            : derived.isValidating
                              ? t("common.loading")
                              : t("order.submit")
                        )
                    )
                  )
              })
            )
        })
      )
  }
})

const OrderFormPageNoDeps = Html.component({
  name: "OrderFormPage",
  props: Schema.Struct({
    locale: Schema.optionalKey(I18n.AppLocale)
  }),
  model: Schema.Struct({}),
  message: Schema.Never
}).make({
  init: () => ({}),
  update: ($) => $.model,
  head: ($) => [Head.title(I18n.translatorFor($.props.locale ?? "en").t("order.pageTitle"))],
  view: (h) =>
    I18n.I18nProvider(h, {
      props: { locale: h.props.locale ?? "en" },
      view: () => OrderFormContentNoDeps(h, {})
    })
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
