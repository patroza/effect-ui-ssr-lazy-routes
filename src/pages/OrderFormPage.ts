import { Command, Component, Head, Router } from "@effect/ui"
import { Html, HtmlCommand } from "@effect/ui/html"
import { Button, Fieldset, Form } from "@effect/ui-kit"
import { Array as Arr, Layer, Option, Schema } from "effect"
import * as Design from "../design/classes.ts"
import * as FormControls from "../form/FormControls.ts"
import type * as SchemaForm from "../form/SchemaForm.ts"
import * as I18n from "../i18n/I18n.ts"
import * as SubmitOrder from "../order/commands/SubmitOrder.ts"
import * as OrderSections from "../order/components/OrderSections.ts"
import * as Order from "../order/domain/Order.ts"
import * as CheckOrderCode from "../order/queries/CheckOrderCode.ts"
import * as ValidatePromoCode from "../order/queries/ValidatePromoCode.ts"

/** Marker proving which chunk this page lands in (see scripts/verify-bundles.ts). */
export const ORDER_FORM_PAGE_CHUNK = "SENTINEL:order-form-page"

export const OrderFormPageMessage = OrderSections.OrderFormPageMessage

const ErrorSummaryRef = Html.ref("OrderErrorSummary", "div")

const OrderFormModelSchema = Schema.Struct({
  form: Order.OrderSchemaForm.State,
  nextLineId: Schema.Finite,
  termsSelectOpen: Schema.Boolean,
  submit: OrderSections.SubmitState
})
type OrderFormModel = typeof OrderFormModelSchema.Type

const updateFormField = (
  controller: Order.OrderSchemaFormController,
  model: OrderFormModel,
  path: SchemaForm.FieldPath<Order.OrderFormValues>,
  updater: (values: Order.OrderFormValues) => Order.OrderFormValues
): OrderFormModel => ({
  ...model,
  form: controller.update(model.form, path, updater),
  submit: model.submit._tag === "Failed" ? OrderSections.SubmitState.Idle() : model.submit
})

const removeFormArrayItem = (
  controller: Order.OrderSchemaFormController,
  model: OrderFormModel,
  arrayPath: SchemaForm.FieldPath<Order.OrderFormValues>,
  index: number,
  updater: (values: Order.OrderFormValues) => Order.OrderFormValues
): OrderFormModel => ({
  ...model,
  form: controller.removeArrayItem(model.form, arrayPath, index, updater),
  submit: model.submit._tag === "Failed" ? OrderSections.SubmitState.Idle() : model.submit
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

const editLineItemField = (
  controller: Order.OrderSchemaFormController,
  model: OrderFormModel,
  id: string,
  field: "sku" | "quantity" | "unitPriceDollars",
  updater: (item: Order.LineItemForm) => Order.LineItemForm
): OrderFormModel => {
  const index = lineItemIndex(model.form.values, id)
  if (index < 0) return model
  return updateFormField(controller, model, `items.${index}.${field}`, (v) => updateLineItem(v, id, updater))
}

const OrderFormContentNoDeps = Html.component({
  name: "OrderFormContent",
  model: OrderFormModelSchema,
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
    submit: OrderSections.SubmitState.Idle()
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
      UpdatedLineSku: ({ id, value }) =>
        editLineItemField(controller, $.model, id, "sku", (item) => ({ ...item, sku: value })),
      UpdatedLineQuantity: ({ id, value }) =>
        editLineItemField(controller, $.model, id, "quantity", (item) => ({ ...item, quantity: value })),
      UpdatedLinePrice: ({ id, value }) =>
        editLineItemField(controller, $.model, id, "unitPriceDollars", (item) => ({
          ...item,
          unitPriceDollars: value
        })),
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
        submit: OrderSections.SubmitState.Idle()
      }),
      SubmittedForm: () => {
        if ($.model.submit._tag === "Submitting") return $.model
        const submittedForm = controller.submit($.model.form)
        const derived = OrderSections.deriveOrderForm(
          controller,
          submittedForm,
          $.queries.codeCheck,
          $.queries.promoCheck,
          tr.t
        )
        if (Option.isNone(derived.decoded)) {
          return $.evolve({ form: submittedForm })
        }
        return $.evolve({ form: submittedForm, submit: OrderSections.SubmitState.Submitting() }).run(
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
          submit: OrderSections.SubmitState.Succeeded({ receipt })
        }),
      FailedSubmitValidation: ({ fieldErrors, formErrors }) =>
        $.evolve({
          form: controller.setServerErrors($.model.form, { fieldErrors, formErrors }),
          submit: OrderSections.SubmitState.Idle()
        }).run(HtmlCommand.focus(ErrorSummaryRef, () => Component.noop)),
      FailedSubmitTransport: ({ message }) =>
        $.evolve({
          submit: OrderSections.SubmitState.Failed({ message })
        }).run(HtmlCommand.focus(ErrorSummaryRef, () => Component.noop))
    })
  },
  view: (h, model) => {
    const i18n = I18n.translator(h.reads.i18n)
    const { t, formatCurrency } = i18n
    const controller = Order.getOrderSchemaForm(h.reads.i18n.locale)
    const derived = OrderSections.deriveOrderForm(controller, model.form, h.queries.codeCheck, h.queries.promoCheck, t)
    const values = model.form.values
    const isSubmitting = model.submit._tag === "Submitting"
    const discountPercent = OrderSections.activePromoDiscount(values, derived, h.queries.promoCheck)
    const totals = Order.calculateOrderTotals(values, discountPercent)

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
                    OrderSections.renderDetailsSection(
                      h,
                      fieldset.legend(h.div.class("text-lg font-semibold")).children(t("order.sectionDetails")),
                      controller,
                      values,
                      derived,
                      h.queries.codeCheck,
                      h.queries.promoCheck,
                      isSubmitting,
                      t
                    ),
                    OrderSections.renderBillingSection(
                      h,
                      controller,
                      values,
                      derived,
                      model.termsSelectOpen,
                      isSubmitting,
                      t
                    ),
                    OrderSections.renderLineItemsSection(h, controller, values, derived, isSubmitting, i18n),
                    OrderSections.renderFulfillmentSection(h, controller, values, derived, isSubmitting, t),
                    OrderSections.renderSummaryCard(h, totals, i18n),
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
