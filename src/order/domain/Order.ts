import { Schema } from "effect"
import * as LocalizedValidation from "../../form/localizedValidation.ts"
import * as SchemaForm from "../../form/SchemaForm.ts"
import * as I18n from "../../i18n/I18n.ts"

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

const BillingMethodForm = Schema.Union([CardBillingForm, InvoiceBillingForm])
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

export const OrderFieldPath = Schema.Union([
  Schema.Literals([
    "projectCode",
    "contactEmail",
    "promoCode",
    "billing",
    "billing._tag",
    "billing.cardholderName",
    "billing.billingZip",
    "billing.companyName",
    "billing.poNumber",
    "billing.paymentTermsDays",
    "items",
    "expedited",
    "deliveryNote",
    "acceptTerms"
  ]),
  Schema.TemplateLiteral(["items.", Schema.Finite]),
  Schema.TemplateLiteral(["items.", Schema.Finite, ".", Schema.Literals(["id", "sku", "quantity", "unitPriceDollars"])])
])
export type OrderFieldPath = typeof OrderFieldPath.Type

interface MessageLookup {
  readonly t: (key: I18n.MessageKey, fallback: string, values?: I18n.TemplateValues) => string
  readonly formatCurrency: (cents: number) => string
}

const makeMessageLookup = (locale: I18n.AppLocale): MessageLookup => {
  const tr = I18n.translatorFor(locale)
  return {
    t: (key, fallback, values) => {
      const rendered = tr.t(key, values)
      return rendered === key ? fallback : rendered
    },
    formatCurrency: tr.formatCurrency
  }
}

const englishFallback = makeMessageLookup("en")

const INVOICE_MIN_SUBTOTAL_CENTS = 10_000
const EXPEDITED_FEE_CENTS = 2_500

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

export interface CrossFieldInput {
  readonly items: ReadonlyArray<{
    readonly sku: string
    readonly quantity: number | null
    readonly unitPriceDollars: number | null
  }>
  readonly expedited: boolean
  readonly deliveryNote: string
  readonly billing: { readonly _tag: "Card" | "Invoice" }
}

/**
 * Cross-field order rules shared by both `getOrderSchemaForm(locale).derive`
 * (surfacing issues even while unrelated fields remain incomplete) and
 * `OrderSubmission`.
 */
const makeValidateOrderCrossFields =
  (messages: MessageLookup = englishFallback) =>
  (input: CrossFieldInput): ReadonlyArray<SchemaForm.FormIssueItem> => {
    const issues: Array<SchemaForm.FormIssueItem> = []

    const seenSkus = new Map<string, number>()
    for (let index = 0; index < input.items.length; index++) {
      const item = input.items[index]
      if (item === undefined) continue
      const normalizedSku = item.sku.trim().toUpperCase()
      if (normalizedSku !== "" && seenSkus.has(normalizedSku)) {
        issues.push({
          path: `items.${index}.sku`,
          message: messages.t("order.errors.duplicateSku", `Duplicate SKU "${item.sku}" — combine quantities instead`, {
            sku: item.sku
          })
        })
      } else if (normalizedSku !== "") {
        seenSkus.set(normalizedSku, index)
      }
    }

    if (input.expedited && input.deliveryNote.trim().length < 5) {
      issues.push({
        path: "deliveryNote",
        message: messages.t(
          "order.errors.expeditedDeliveryNote",
          "Expedited orders require delivery instructions (at least 5 characters)"
        )
      })
    }

    if (input.billing._tag === "Invoice") {
      const { subtotalCents } = calculateOrderTotals(input, 0)
      if (subtotalCents < INVOICE_MIN_SUBTOTAL_CENTS) {
        const minFormatted = messages.formatCurrency(INVOICE_MIN_SUBTOTAL_CENTS)
        issues.push({
          path: "billing.poNumber",
          message: messages.t(
            "order.errors.invoiceMinimumSubtotal",
            `Invoice billing requires a subtotal of at least ${minFormatted}`,
            { amount: minFormatted }
          )
        })
      }
    }

    return issues
  }

const buildOrderSubmissionSchema = (messages: MessageLookup) => {
  const OrderCodeSchema = Schema.String.pipe(
    Schema.check(
      Schema.isTrimmed({
        message: messages.t("order.errors.projectCodeTrimmed", "Remove leading or trailing spaces")
      }),
      Schema.isMinLength(3, {
        message: messages.t("order.errors.projectCodeMinLength", "Project code must be at least 3 characters")
      }),
      Schema.isMaxLength(32, {
        message: messages.t("order.errors.projectCodeMaxLength", "Project code must be at most 32 characters")
      }),
      Schema.isPattern(/^[a-z0-9-]+$/, {
        message: messages.t("order.errors.projectCodePattern", "Use lowercase letters, numbers, and hyphens only")
      })
    )
  ).annotate({
    title: messages.t("order.fields.projectCode", "Project code"),
    description: messages.t(
      "order.fields.projectCode.desc",
      "Unique lowercase slug checked live against existing studio orders."
    )
  })

  const EmailSchema = Schema.String.pipe(
    Schema.check(
      Schema.isMinLength(1, { message: messages.t("validation.empty", "Contact email is required") }),
      Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
        message: messages.t("validation.emailInvalid", "Enter a valid email address")
      })
    )
  ).annotate({
    title: messages.t("order.fields.contactEmail", "Contact email"),
    description: messages.t("order.fields.contactEmail.desc", "Order confirmation and production proofs go here.")
  })

  const PromoCodeSchema = Schema.String.pipe(
    Schema.check(
      Schema.makeFilter((value) => value === "" || /^[A-Z0-9-]{3,16}$/.test(value), {
        message: messages.t("order.errors.promoPattern", "Promo codes use 3–16 uppercase letters, numbers, or hyphens")
      })
    )
  ).annotate({
    title: messages.t("order.fields.promoCode", "Promo code"),
    description: messages.t("order.fields.promoCode.desc", "Optional discount code (try STUDIO15 or WHOLESALE25).")
  })

  const CardBilling = Schema.TaggedStruct("Card", {
    cardholderName: Schema.String.pipe(
      Schema.check(
        Schema.isMinLength(2, {
          message: messages.t("order.errors.cardholderMinLength", "Cardholder name must be at least 2 characters")
        })
      )
    ).annotate({ title: messages.t("order.fields.billing.cardholderName", "Cardholder name") }),
    billingZip: Schema.String.pipe(
      Schema.check(
        Schema.isPattern(/^\d{5}(-\d{4})?$/, {
          message: messages.t("order.errors.billingZipPattern", "Enter a 5-digit ZIP code (e.g. 94107)")
        })
      )
    ).annotate({ title: messages.t("order.fields.billing.billingZip", "Billing ZIP") })
  })

  const InvoiceBilling = Schema.TaggedStruct("Invoice", {
    companyName: Schema.String.pipe(
      Schema.check(
        Schema.isMinLength(2, {
          message: messages.t("order.errors.companyMinLength", "Company name is required")
        })
      )
    ).annotate({ title: messages.t("order.fields.billing.companyName", "Company name") }),
    poNumber: Schema.String.pipe(
      Schema.check(
        Schema.isPattern(/^PO-[A-Z0-9-]{3,}$/, {
          message: messages.t(
            "order.errors.poPattern",
            "PO number must start with PO- followed by at least 3 characters"
          )
        })
      )
    ).annotate({ title: messages.t("order.fields.billing.poNumber", "PO number") }),
    paymentTermsDays: PaymentTerms.annotate({
      title: messages.t("order.fields.billing.paymentTermsDays", "Payment terms")
    })
  })

  const RequiredFiniteNumber = Schema.NullOr(Schema.Finite).pipe(
    Schema.refine((value): value is number => value !== null, {
      message: messages.t("order.errors.numberRequired", "Enter a number")
    })
  )

  const LineItem = Schema.Struct({
    id: Schema.String,
    sku: Schema.String.pipe(
      Schema.check(
        Schema.isMinLength(2, {
          message: messages.t("order.errors.skuMinLength", "SKU must be at least 2 characters")
        })
      )
    ).annotate({ title: messages.t("order.fields.items.*.sku", "SKU") }),
    quantity: RequiredFiniteNumber.pipe(
      Schema.check(
        Schema.isInt({ message: messages.t("order.errors.qtyWholeNumber", "Quantity must be a whole number") }),
        Schema.isBetween(
          { minimum: 1, maximum: 100 },
          { message: messages.t("order.errors.qtyRange", "Quantity must be between 1 and 100") }
        )
      )
    ).annotate({ title: messages.t("order.fields.items.*.quantity", "Quantity") }),
    unitPriceDollars: RequiredFiniteNumber.pipe(
      Schema.check(
        Schema.isBetween(
          { minimum: 1, maximum: 10_000 },
          { message: messages.t("order.errors.priceRange", "Unit price must be between $1 and $10,000") }
        )
      )
    ).annotate({ title: messages.t("order.fields.items.*.unitPriceDollars", "Unit price") })
  })

  const OrderSubmissionBase = Schema.Struct({
    projectCode: OrderCodeSchema,
    contactEmail: EmailSchema,
    promoCode: PromoCodeSchema,
    billing: Schema.Union([CardBilling, InvoiceBilling]).annotate({
      title: messages.t("order.fields.billing", "Billing method")
    }),
    items: Schema.Array(LineItem)
      .pipe(
        Schema.check(
          Schema.isMinLength(1, { message: messages.t("order.errors.minLineItems", "Add at least one line item") }),
          Schema.isMaxLength(5, {
            message: messages.t("order.errors.maxLineItems", "At most 5 line items per order")
          })
        )
      )
      .annotate({ title: messages.t("order.fields.items", "Line items") }),
    expedited: Schema.Boolean.annotate({
      title: messages.t("order.fields.expedited", "Expedited production"),
      description: messages.t(
        "order.fields.expedited.desc",
        "48-hour rush turnaround (+$25.00); requires delivery instructions."
      )
    }),
    deliveryNote: Schema.String.annotate({
      title: messages.t("order.fields.deliveryNote", "Delivery instructions"),
      description: messages.t("order.fields.deliveryNote.desc", "Required when expedited production is enabled.")
    }),
    acceptTerms: Schema.Literal(true).annotate({
      title: messages.t("order.fields.acceptTerms", "Order terms"),
      description: messages.t(
        "order.fields.acceptTerms.desc",
        "Confirm unit counts, custom SKUs, and studio proof turnaround."
      ),
      message: messages.t("order.errors.termsRequired", "You must accept the studio order terms")
    })
  })

  const crossChecks = makeValidateOrderCrossFields(messages)

  return OrderSubmissionBase.pipe(
    Schema.check(
      Schema.makeFilter((input) => {
        const crossFieldIssues = crossChecks(input)
        if (crossFieldIssues.length === 0) return undefined
        return crossFieldIssues.map((item): Schema.FilterIssue => ({
          path: item.path.split(".").map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment)),
          issue: item.message
        }))
      })
    )
  )
}

/** Canonical wire schema shared between client RPCs and server handlers. */
export const OrderSubmission = buildOrderSubmissionSchema(englishFallback)
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

const makeOrderSchemaForm = (locale: I18n.AppLocale) => {
  const tr = I18n.translatorFor(locale)
  const messages = makeMessageLookup(locale)
  const localizedSchema = LocalizedValidation.annotateLiteralUnionMessages(buildOrderSubmissionSchema(messages), tr.t)
  const hooks = LocalizedValidation.makeLocalizedHooks(tr.t)
  return SchemaForm.make({
    valueSchema: OrderFormValues,
    formSchema: localizedSchema,
    mode: "onSubmit",
    leafHook: hooks.leafHook,
    checkHook: hooks.checkHook,
    crossFieldChecks: makeValidateOrderCrossFields(messages),
    labelOptions: {
      formLabel: messages.t("common.formDefaultLabel", "Form"),
      formatItemLabel: (index, label) =>
        messages.t("common.itemRowPrefix", `Item #${index} · ${label}`, { index, label })
    }
  })
}

export type OrderSchemaFormController = ReturnType<typeof makeOrderSchemaForm>

const localizedOrderForms = new Map<I18n.AppLocale, OrderSchemaFormController>()

/** Returns a cached locale-aware `SchemaForm` controller for `/order`. */
export const getOrderSchemaForm = (locale: I18n.AppLocale = "en"): OrderSchemaFormController => {
  if (I18n.getCatalog(locale) === undefined) {
    return makeOrderSchemaForm(locale)
  }
  const existing = localizedOrderForms.get(locale)
  if (existing !== undefined) return existing
  const created = makeOrderSchemaForm(locale)
  localizedOrderForms.set(locale, created)
  return created
}

export const OrderSchemaForm: OrderSchemaFormController = getOrderSchemaForm("en")
