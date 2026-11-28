import { UiSchema, type View } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import { Button, Field, makeRadioGroup, makeSelect } from "@effect/ui-kit"
import { Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { RpcClientError } from "effect/rpc"
import * as Design from "../../design/classes.ts"
import * as FormControls from "../../form/FormControls.ts"
import * as SchemaForm from "../../form/SchemaForm.ts"
import type * as I18n from "../../i18n/I18n.ts"
import type * as ApiError from "../../rpc/domain/ApiError.ts"
import * as SelectUi from "../../ui/select.ts"
import * as Order from "../domain/Order.ts"

const BillingRadioGroup = makeRadioGroup({ value: Order.BillingMethodTag })
const TermsSelect = makeSelect({ value: Order.PaymentTerms })

export const SubmitState = UiSchema.TaggedEnum({
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

export type Msg = typeof OrderFormPageMessage.Type

export type OrderDerivedForm = SchemaForm.DerivedFormState<
  Order.OrderSubmission,
  SchemaForm.FieldPath<Order.OrderFormValues>
>

type CodeCheckResult = AsyncResult.AsyncResult<
  Order.OrderCodeCheckResult,
  ApiError.ApiError | RpcClientError.RpcClientError
>
type PromoCheckResult = AsyncResult.AsyncResult<
  Order.PromoValidationResult,
  ApiError.ApiError | RpcClientError.RpcClientError
>

const evaluateCodeCheck = (
  form: SchemaForm.FormState<Order.OrderFormValues>,
  result: CodeCheckResult,
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
  result: PromoCheckResult,
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

export const deriveOrderForm = (
  controller: Order.OrderSchemaFormController,
  form: SchemaForm.FormState<Order.OrderFormValues>,
  codeResult: CodeCheckResult,
  promoResult: PromoCheckResult,
  t: I18n.TranslateFn
): OrderDerivedForm => {
  const syncDerived = controller.derive(form)
  return controller.derive(form, {
    projectCode: evaluateCodeCheck(form, codeResult, syncDerived.fieldPassesSync("projectCode"), t),
    promoCode: evaluatePromoCheck(form, promoResult, syncDerived.fieldPassesSync("promoCode"), t)
  })
}

export const activePromoDiscount = (
  values: Order.OrderFormValues,
  derived: OrderDerivedForm,
  promoResult: PromoCheckResult
): number =>
  values.promoCode.trim() !== "" &&
  derived.fieldPassesSync("promoCode") &&
  AsyncResult.isSuccess(promoResult) &&
  promoResult.value.valid
    ? promoResult.value.discountPercent
    : 0

const renderCodeAdornment = (
  h: Html.H<Msg>,
  values: Order.OrderFormValues,
  fieldState: SchemaForm.DerivedFieldState,
  codeResult: CodeCheckResult,
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
  promoResult: PromoCheckResult,
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

export const renderDetailsSection = (
  h: Html.H<Msg>,
  legend: View.Content<Msg, never>,
  controller: Order.OrderSchemaFormController,
  values: Order.OrderFormValues,
  derived: OrderDerivedForm,
  codeCheck: CodeCheckResult,
  promoCheck: PromoCheckResult,
  isSubmitting: boolean,
  t: I18n.TranslateFn
) => {
  const projectCodeState = derived.field("projectCode")
  const promoCodeState = derived.field("promoCode")
  return h.div.class(`${Design.ui.card} ${Design.ui.stack}`).children(
    legend,
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
        statusAdornment: renderCodeAdornment(h, values, projectCodeState, codeCheck, t),
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
      statusAdornment: renderPromoAdornment(h, values, promoCodeState, promoCheck, t),
      onUpdate: (value) => OrderFormPageMessage.UpdatedPromoCode({ value }),
      onBlur: OrderFormPageMessage.BlurredField({ path: "promoCode" })
    })
  )
}

export const renderBillingSection = (
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
                        SelectUi.SelectLabel(h, select, { class: "mb-0" }).children(
                          controller.labelFor("billing.paymentTermsDays")
                        ),
                        field.focusWithin(h.div.class("relative")).children(
                          SelectUi.SelectTrigger(h, select, {
                            element: field.member(h.button),
                            class: "w-full min-w-0"
                          })
                            .attr("data-testid", "billing-terms-trigger")
                            .children(SelectUi.SelectValue(h, select), SelectUi.SelectIcon(h, select)),
                          SelectUi.SelectPositioner(h, select, {
                            class: "absolute top-full left-0 z-20 mt-1 w-full"
                          }).children(
                            SelectUi.SelectPopup(h, select, { class: "w-full min-w-0" }).children(
                              paymentTermsItems.map(({ value, label }) =>
                                SelectUi.SelectItem(h, select, { value })
                                  .attr("data-testid", `billing-terms-option-${value}`)
                                  .children(
                                    SelectUi.SelectItemText(h, select).children(label),
                                    SelectUi.SelectItemIndicator(h, select, { value })
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

export const renderLineItemsSection = (
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

export const renderFulfillmentSection = (
  h: Html.H<Msg>,
  controller: Order.OrderSchemaFormController,
  values: Order.OrderFormValues,
  derived: OrderDerivedForm,
  isSubmitting: boolean,
  t: I18n.TranslateFn
) =>
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
      description: controller.meta["acceptTerms"]?.description,
      checked: values.acceptTerms,
      state: derived.field("acceptTerms"),
      disabled: isSubmitting,
      testId: "accept-terms-checkbox",
      errorTestId: "accept-terms-error",
      onToggle: (checked) => OrderFormPageMessage.ToggledAcceptTerms({ checked }),
      onBlur: OrderFormPageMessage.BlurredField({ path: "acceptTerms" })
    })
  )

export const renderSummaryCard = (h: Html.H<Msg>, totals: Order.OrderTotals, i18n: I18n.I18nTranslator) => {
  const { t, formatCurrency } = i18n
  return h.div
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
                .children(t("order.summaryDiscount", { amount: formatCurrency(totals.discountCents) }))
            : undefined,
          totals.expeditedFeeCents > 0
            ? h.span
                .attr("data-testid", "summary-expedited")
                .children(t("order.summaryExpedited", { amount: formatCurrency(totals.expeditedFeeCents) }))
            : undefined
        ),
      h.div
        .class("text-lg font-semibold")
        .attr("data-testid", "summary-total")
        .children(t("order.summaryTotal", { amount: formatCurrency(totals.totalCents) }))
    )
}
