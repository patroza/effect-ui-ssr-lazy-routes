import { Schema } from "effect"
import * as SchemaForm from "../../form/SchemaForm.ts"

/** Marker proving this feature's schema lands in the Order chunk (see scripts/verify-bundles.ts). */
export const ORDER_SCHEMA_CHUNK = "SENTINEL:order-schema"

export const PaymentTerms = Schema.Literals(["15", "30", "60"])
export type PaymentTerms = typeof PaymentTerms.Type

export const BillingMethodTag = Schema.Literals(["Card", "Invoice"])
export type BillingMethodTag = typeof BillingMethodTag.Type

export const CardBillingForm = Schema.TaggedStruct("Card", {
  cardholderName: Schema.String,
  billingZip: Schema.String
})
export type CardBillingForm = typeof CardBillingForm.Type

export const InvoiceBillingForm = Schema.TaggedStruct("Invoice", {
  companyName: Schema.String,
  poNumber: Schema.String,
  paymentTermsDays: PaymentTerms
})
export type InvoiceBillingForm = typeof InvoiceBillingForm.Type

export const BillingMethodForm = Schema.Union([CardBillingForm, InvoiceBillingForm])
export type BillingMethodForm = typeof BillingMethodForm.Type

export const LineItemForm = Schema.Struct({
  id: Schema.String,
  sku: Schema.String,
  quantity: Schema.NullOr(Schema.Finite),
  unitPriceDollars: Schema.NullOr(Schema.Finite)
})
export type LineItemForm = typeof LineItemForm.Type

export const OrderFormValues = Schema.Struct({
  projectCode: Schema.String,
  contactEmail: Schema.String,
  promoCode: Schema.String,
  billing: BillingMethodForm,
  items: Schema.Array(LineItemForm),
  expedited: Schema.Boolean,
  deliveryNote: Schema.String,
  acceptTerms: Schema.Boolean
})
export type OrderFormValues = typeof OrderFormValues.Type

export const OrderCodeSchema = Schema.String.pipe(
  Schema.check(
    Schema.isTrimmed({ message: "Remove leading or trailing spaces" }),
    Schema.isMinLength(3, { message: "Project code must be at least 3 characters" }),
    Schema.isMaxLength(32, { message: "Project code must be at most 32 characters" }),
    Schema.isPattern(/^[a-z0-9-]+$/, { message: "Use lowercase letters, numbers, and hyphens only" })
  )
).annotate({
  title: "Project code",
  description: "Unique lowercase slug checked live against existing studio orders."
})

export const EmailSchema = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(1, { message: "Contact email is required" }),
    Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: "Enter a valid email address" })
  )
).annotate({
  title: "Contact email",
  description: "Order confirmation and production proofs go here."
})

export const PromoCodeSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value === "" || /^[A-Z0-9-]{3,16}$/.test(value), {
      message: "Promo codes use 3–16 uppercase letters, numbers, or hyphens"
    })
  )
).annotate({
  title: "Promo code",
  description: "Optional discount code (try STUDIO15 or WHOLESALE25)."
})

export const CardBilling = Schema.TaggedStruct("Card", {
  cardholderName: Schema.String.pipe(
    Schema.check(Schema.isMinLength(2, { message: "Cardholder name must be at least 2 characters" }))
  ).annotate({ title: "Cardholder name" }),
  billingZip: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^\d{5}(-\d{4})?$/, { message: "Enter a 5-digit ZIP code (e.g. 94107)" }))
  ).annotate({ title: "Billing ZIP" })
})

export const InvoiceBilling = Schema.TaggedStruct("Invoice", {
  companyName: Schema.String.pipe(
    Schema.check(Schema.isMinLength(2, { message: "Company name is required" }))
  ).annotate({ title: "Company name" }),
  poNumber: Schema.String.pipe(
    Schema.check(
      Schema.isPattern(/^PO-[A-Z0-9-]{3,}$/, {
        message: "PO number must start with PO- followed by at least 3 characters"
      })
    )
  ).annotate({ title: "PO number" }),
  paymentTermsDays: PaymentTerms.annotate({ title: "Payment terms" })
})

const RequiredFiniteNumber = Schema.NullOr(Schema.Finite).pipe(
  Schema.refine((value): value is number => value !== null, { message: "Enter a number" })
)

export const LineItem = Schema.Struct({
  id: Schema.String,
  sku: Schema.String.pipe(
    Schema.check(Schema.isMinLength(2, { message: "SKU must be at least 2 characters" }))
  ).annotate({ title: "SKU" }),
  quantity: RequiredFiniteNumber.pipe(
    Schema.check(
      Schema.isInt({ message: "Quantity must be a whole number" }),
      Schema.isBetween({ minimum: 1, maximum: 100 }, { message: "Quantity must be between 1 and 100" })
    )
  ).annotate({ title: "Quantity" }),
  unitPriceDollars: RequiredFiniteNumber.pipe(
    Schema.check(
      Schema.isBetween({ minimum: 1, maximum: 10_000 }, { message: "Unit price must be between $1 and $10,000" })
    )
  ).annotate({ title: "Unit price" })
})

const OrderSubmissionBase = Schema.Struct({
  projectCode: OrderCodeSchema,
  contactEmail: EmailSchema,
  promoCode: PromoCodeSchema,
  billing: Schema.Union([CardBilling, InvoiceBilling]).annotate({ title: "Billing method" }),
  items: Schema.Array(LineItem)
    .pipe(
      Schema.check(
        Schema.isMinLength(1, { message: "Add at least one line item" }),
        Schema.isMaxLength(5, { message: "At most 5 line items per order" })
      )
    )
    .annotate({ title: "Line items" }),
  expedited: Schema.Boolean.annotate({
    title: "Expedited production",
    description: "48-hour rush turnaround (+$25.00); requires delivery instructions."
  }),
  deliveryNote: Schema.String.annotate({
    title: "Delivery instructions",
    description: "Required when expedited production is enabled."
  }),
  acceptTerms: Schema.Literal(true).annotate({
    title: "Order terms",
    message: "You must accept the studio order terms"
  })
})

export const INVOICE_MIN_SUBTOTAL_CENTS = 10_000
export const EXPEDITED_FEE_CENTS = 2_500

export interface OrderTotals {
  readonly subtotalCents: number
  readonly discountCents: number
  readonly expeditedFeeCents: number
  readonly totalCents: number
}

export const calculateOrderTotals = (
  values: {
    readonly items: ReadonlyArray<{ readonly quantity: number | null; readonly unitPriceDollars: number | null }>
    readonly expedited: boolean
  },
  discountPercent: number
): OrderTotals => {
  let subtotalCents = 0
  for (const item of values.items) {
    const qty = item.quantity ?? 0
    const unit = item.unitPriceDollars ?? 0
    if (Number.isFinite(qty) && Number.isFinite(unit) && qty > 0 && unit > 0) {
      subtotalCents += Math.round(qty * unit * 100)
    }
  }
  const discountCents = Math.round((subtotalCents * Math.max(0, Math.min(100, discountPercent))) / 100)
  const expeditedFeeCents = values.expedited ? EXPEDITED_FEE_CENTS : 0
  const totalCents = Math.max(0, subtotalCents - discountCents + expeditedFeeCents)
  return { subtotalCents, discountCents, expeditedFeeCents, totalCents }
}

export const formatCents = (cents: number): string => `$${(cents / 100).toFixed(2)}`

/**
 * Canonical schema shared between the client form engine and the server RPC
 * endpoint, including cross-field refinements that target exact nested paths.
 */
export const OrderSubmission = OrderSubmissionBase.pipe(
  Schema.check(
    Schema.makeFilter((input) => {
      const issues: Array<Schema.FilterIssue> = []

      const seenSkus = new Map<string, number>()
      for (let index = 0; index < input.items.length; index++) {
        const item = input.items[index]
        if (item === undefined) continue
        const normalizedSku = item.sku.trim().toUpperCase()
        if (normalizedSku !== "" && seenSkus.has(normalizedSku)) {
          issues.push({
            path: ["items", index, "sku"],
            issue: `Duplicate SKU "${item.sku}" — combine quantities instead`
          })
        } else if (normalizedSku !== "") {
          seenSkus.set(normalizedSku, index)
        }
      }

      if (input.expedited && input.deliveryNote.trim().length < 5) {
        issues.push({
          path: ["deliveryNote"],
          issue: "Expedited orders require delivery instructions (at least 5 characters)"
        })
      }

      if (input.billing._tag === "Invoice") {
        const { subtotalCents } = calculateOrderTotals(input, 0)
        if (subtotalCents < INVOICE_MIN_SUBTOTAL_CENTS) {
          issues.push({
            path: ["billing", "poNumber"],
            issue: `Invoice billing requires a subtotal of at least ${formatCents(INVOICE_MIN_SUBTOTAL_CENTS)}`
          })
        }
      }

      return issues.length === 0 ? undefined : issues
    })
  )
)
export type OrderSubmission = typeof OrderSubmission.Type

export const OrderCodeCheckResult = Schema.Struct({
  available: Schema.Boolean,
  reason: Schema.NullOr(Schema.String),
  suggestion: Schema.NullOr(Schema.String)
})
export type OrderCodeCheckResult = typeof OrderCodeCheckResult.Type

export const PromoValidationResult = Schema.Struct({
  valid: Schema.Boolean,
  discountPercent: Schema.Finite,
  description: Schema.NullOr(Schema.String)
})
export type PromoValidationResult = typeof PromoValidationResult.Type

export const OrderReceipt = Schema.Struct({
  orderId: Schema.String,
  projectCode: Schema.String,
  totalCents: Schema.Finite,
  discountPercent: Schema.Finite
})
export type OrderReceipt = typeof OrderReceipt.Type

/**
 * Typed field-level validation error returned from `submitOrder` so server-only
 * rejections map directly onto specific fields (OmegaForm `SetErrorOnSubmit`).
 */
export class OrderValidationError extends Schema.TaggedError<OrderValidationError, { readonly brand: unique symbol }>()(
  "OrderValidationError",
  {
    message: Schema.String,
    fieldErrors: Schema.Record(Schema.String, Schema.Array(Schema.String)),
    formErrors: Schema.Array(Schema.String)
  }
) {}

export const defaultCardBilling = (): CardBillingForm => ({
  _tag: "Card",
  cardholderName: "",
  billingZip: ""
})

export const defaultInvoiceBilling = (): InvoiceBillingForm => ({
  _tag: "Invoice",
  companyName: "",
  poNumber: "",
  paymentTermsDays: "30"
})

export const defaultOrderFormValues: OrderFormValues = {
  projectCode: "",
  contactEmail: "",
  promoCode: "",
  billing: defaultCardBilling(),
  items: [{ id: "line-1", sku: "NOTEBOOK-A5", quantity: 2, unitPriceDollars: 24 }],
  expedited: false,
  deliveryNote: "",
  acceptTerms: false
}

export const OrderSchemaForm = SchemaForm.make({
  valueSchema: OrderFormValues,
  formSchema: OrderSubmission,
  mode: "onSubmit"
})
