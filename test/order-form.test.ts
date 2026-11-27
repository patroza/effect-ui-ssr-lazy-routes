import { TestHost } from "@effect/ui/testing"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option, Redacted, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import { TestClock } from "effect/testing"
import * as SchemaForm from "../src/form/SchemaForm.ts"
import * as SchemaMeta from "../src/form/schemaMeta.ts"
import * as Order from "../src/order/domain/Order.ts"
import * as Helpers from "./helpers.ts"

const roundTrip = Effect.andThen(TestClock.adjust("5 millis"), TestHost.settle)
const debounceAndRoundTrip = TestHost.settle.pipe(
  Effect.andThen(TestClock.adjust("300 millis")),
  Effect.andThen(TestHost.settle),
  Effect.andThen(roundTrip)
)

const submitForm = (container: Element): void => {
  const form = container.querySelector("form")
  if (form === null) throw new Error("no <form> element in container")
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
}

const blurElement = (element: Element): void => {
  element.dispatchEvent(new FocusEvent("blur", { bubbles: false }))
}

const fillValidCardOrder = (container: Element, code = "autumn-mug-run"): void => {
  Helpers.type(Helpers.byTestId(container, "project-code-input"), code)
  Helpers.type(Helpers.byTestId(container, "contact-email-input"), "ada@studio.test")
  Helpers.type(Helpers.byTestId(container, "billing-cardholder"), "Ada Lovelace")
  Helpers.type(Helpers.byTestId(container, "billing-zip"), "94107")
  Helpers.click(Helpers.byTestId(container, "accept-terms-checkbox"))
}

describe("SchemaMeta & SchemaForm unit tests", () => {
  it("extracts AST metadata across structs, tagged union branches, and array wildcards", () => {
    const meta = SchemaMeta.extractFieldMetaMap(Order.OrderSubmission)
    expect(meta["projectCode"]?.label).toBe("Project code")
    expect(meta["projectCode"]?.description).toContain("Unique lowercase slug")
    expect(meta["billing.cardholderName"]?.label).toBe("Cardholder name")
    expect(meta["billing.poNumber"]?.label).toBe("PO number")
    expect(meta["items.*.sku"]?.label).toBe("SKU")
    expect(meta["items.*.quantity"]?.label).toBe("Quantity")
    expect(SchemaMeta.resolveFieldLabel(meta, "items.1.sku")).toBe("Item #2 · SKU")
    expect(SchemaMeta.resolveFieldLabel(meta, "billing.poNumber")).toBe("PO number")
    expect(SchemaMeta.humanizeKey("deliveryNote")).toBe("Delivery note")
  })

  it("validates nested structs, tagged unions, array items, and cross-field refinements", () => {
    let state = Order.OrderSchemaForm.init(Order.defaultOrderFormValues)
    expect(Order.OrderSchemaForm.isDirty(state)).toBe(false)

    state = Order.OrderSchemaForm.update(state, "projectCode", (v) => ({
      ...v,
      projectCode: "valid-order",
      contactEmail: "buyer@studio.test",
      billing: { _tag: "Invoice", companyName: "Acme Corp", poNumber: "PO-9001", paymentTermsDays: "30" },
      items: [
        { id: "line-1", sku: "MUG-01", quantity: 1, unitPriceDollars: 20 },
        { id: "line-2", sku: "mug-01", quantity: 1, unitPriceDollars: 20 }
      ],
      expedited: true,
      deliveryNote: "no",
      acceptTerms: true
    }))
    expect(Order.OrderSchemaForm.isDirty(state)).toBe(true)

    // In onSubmit mode, errors are held back until submit.
    const beforeSubmit = Order.OrderSchemaForm.derive(state)
    expect(beforeSubmit.isValid).toBe(false)
    expect(beforeSubmit.field("items.1.sku").status).toBe("NotValidated")
    expect(beforeSubmit.visibleErrors).toHaveLength(0)

    state = Order.OrderSchemaForm.submit(state)
    const afterSubmit = Order.OrderSchemaForm.derive(state)
    expect(afterSubmit.field("items.1.sku").errors[0]).toContain("Duplicate SKU")
    expect(afterSubmit.field("deliveryNote").errors[0]).toContain("Expedited orders require delivery instructions")
    expect(afterSubmit.field("billing.poNumber").errors[0]).toContain("at least $100.00")

    // Fix all 3 cross-field issues -> decodes cleanly.
    state = Order.OrderSchemaForm.update(state, "items.1.sku", (v) => ({
      ...v,
      items: [
        { id: "line-1", sku: "MUG-01", quantity: 3, unitPriceDollars: 40 },
        { id: "line-2", sku: "NOTEBOOK-A5", quantity: 1, unitPriceDollars: 20 }
      ],
      deliveryNote: "Deliver to receiving bay 3"
    }))
    const valid = Order.OrderSchemaForm.derive(state)
    expect(valid.isValid).toBe(true)
    expect(Option.isSome(valid.decoded)).toBe(true)
  })

  it("supports onBlur and onChange validation modes", () => {
    const blurForm = SchemaForm.make({
      valueSchema: Order.OrderFormValues,
      formSchema: Order.OrderSubmission,
      mode: "onBlur"
    })
    let blurState = blurForm.init(Order.defaultOrderFormValues)
    blurState = blurForm.update(blurState, "projectCode", (v) => ({ ...v, projectCode: "x" }))
    expect(blurForm.derive(blurState).field("projectCode").status).toBe("NotValidated")
    blurState = blurForm.blur(blurState, "projectCode")
    expect(blurForm.derive(blurState).field("projectCode").status).toBe("Invalid")

    const changeForm = SchemaForm.make({
      valueSchema: Order.OrderFormValues,
      formSchema: Order.OrderSubmission,
      mode: "onChange"
    })
    let changeState = changeForm.init(Order.defaultOrderFormValues)
    changeState = changeForm.update(changeState, "projectCode", (v) => ({ ...v, projectCode: "x" }))
    expect(changeForm.derive(changeState).field("projectCode").status).toBe("Invalid")
  })

  it("tracks server errors (clearing on field or ancestor edit), rebase, and reset", () => {
    let state = Order.OrderSchemaForm.init(Order.defaultOrderFormValues)
    state = Order.OrderSchemaForm.setServerErrors(state, {
      fieldErrors: {
        projectCode: ["Already taken"],
        "billing.poNumber": ["Credit hold"]
      },
      formErrors: ["Service notice"]
    })
    let derived = Order.OrderSchemaForm.derive(state)
    expect(derived.field("projectCode").errors).toEqual(["Already taken"])
    expect(derived.field("billing.poNumber").errors).toEqual(["Credit hold"])
    expect(derived.formErrors).toEqual(["Service notice"])
    expect(derived.canSubmit).toBe(false)

    // Switching the parent union branch clears descendant server errors (`billing.poNumber`).
    state = Order.OrderSchemaForm.update(state, "billing", (v) => ({
      ...v,
      billing: Order.defaultCardBilling()
    }))
    derived = Order.OrderSchemaForm.derive(state)
    expect(derived.field("billing.poNumber").errors).toEqual([])
    expect(derived.field("projectCode").errors).toEqual(["Already taken"])
    expect(derived.formErrors).toEqual([])

    state = Order.OrderSchemaForm.rebase(state)
    expect(Order.OrderSchemaForm.isDirty(state)).toBe(false)
    state = Order.OrderSchemaForm.update(state, "projectCode", (v) => ({ ...v, projectCode: "changed" }))
    expect(Order.OrderSchemaForm.isDirty(state)).toBe(true)
    state = Order.OrderSchemaForm.reset(state, Order.defaultOrderFormValues)
    expect(Order.OrderSchemaForm.isDirty(state)).toBe(false)
    expect(state.values.projectCode).toBe("")
  })

  it("maps AsyncResult states cleanly via asyncCheckFromResult", () => {
    expect(SchemaForm.asyncCheckFromResult(undefined, () => [])).toEqual({ _tag: "Idle" })
    expect(SchemaForm.asyncCheckFromResult(AsyncResult.initial(false), () => [])).toEqual({ _tag: "Validating" })
    expect(SchemaForm.asyncCheckFromResult(AsyncResult.success({ ok: true }, { waiting: true }), () => [])).toEqual({
      _tag: "Validating"
    })
    expect(SchemaForm.asyncCheckFromResult(AsyncResult.success({ ok: true }), () => [])).toEqual({ _tag: "Valid" })
    expect(SchemaForm.asyncCheckFromResult(AsyncResult.success({ ok: false }), () => ["Unavailable"])).toEqual({
      _tag: "Invalid",
      errors: ["Unavailable"]
    })
    expect(SchemaForm.asyncCheckFromResult(AsyncResult.fail(new Error("boom")), () => [], "Fallback")).toEqual({
      _tag: "Invalid",
      errors: ["Fallback"]
    })
  })

  it("surfaces cross-field checks even while unrelated fields are incomplete", () => {
    // `acceptTerms` is still false and `projectCode` / `contactEmail` are empty, yet cross-field
    // duplicate-SKU, expedited deliveryNote, and Invoice $100 minimum rules still run.
    let state = Order.OrderSchemaForm.init(Order.defaultOrderFormValues)
    state = Order.OrderSchemaForm.update(state, "billing", (v) => ({
      ...v,
      billing: { _tag: "Invoice", companyName: "Acme Corp", poNumber: "PO-9001", paymentTermsDays: "30" },
      items: [
        { id: "line-1", sku: "MUG-01", quantity: 1, unitPriceDollars: 20 },
        { id: "line-2", sku: "mug-01", quantity: 1, unitPriceDollars: 20 }
      ],
      expedited: true,
      deliveryNote: "no"
    }))
    state = Order.OrderSchemaForm.submit(state)
    const derived = Order.OrderSchemaForm.derive(state)
    expect(derived.isValid).toBe(false)
    expect(derived.field("items.1.sku").errors[0]).toContain("Duplicate SKU")
    expect(derived.field("deliveryNote").errors[0]).toContain("Expedited orders require delivery instructions")
    expect(derived.field("billing.poNumber").errors[0]).toContain("at least $100.00")
  })

  it("reindexes edited, touched, and serverErrors cleanly across removeArrayItem and moveArrayItem", () => {
    let state = Order.OrderSchemaForm.init(Order.defaultOrderFormValues)
    state = Order.OrderSchemaForm.update(state, "items.0.sku", (v) => ({
      ...v,
      items: [
        { id: "line-1", sku: "BAD-0", quantity: 1, unitPriceDollars: 10 },
        { id: "line-2", sku: "GOOD-1", quantity: 1, unitPriceDollars: 20 },
        { id: "line-3", sku: "BAD-2", quantity: 1, unitPriceDollars: 30 }
      ]
    }))
    state = Order.OrderSchemaForm.update(state, "items.1.sku", (v) => v)
    state = Order.OrderSchemaForm.blur(state, "items.1.sku")
    state = Order.OrderSchemaForm.blur(state, "items.2.quantity")
    state = Order.OrderSchemaForm.setServerErrors(state, {
      fieldErrors: {
        "items.0.sku": ["Server error row 0"],
        "items.2.sku": ["Server error row 2"],
        items: ["Array-level error"]
      }
    })

    // Removing index 0 drops items.0.* and shifts items.1.* -> items.0.*, items.2.* -> items.1.*
    state = Order.OrderSchemaForm.removeArrayItem(state, "items", 0, (v) => ({
      ...v,
      items: v.items.slice(1)
    }))
    expect(state.edited).toContain("items.0.sku")
    expect(state.edited).not.toContain("items.1.sku")
    expect(state.touched).toEqual(["items.0.sku", "items.1.quantity"])
    expect(state.serverErrors).toEqual({
      "items.1.sku": ["Server error row 2"]
    })

    // Moving index 0 -> 1 swaps items.0.* and items.1.* metadata cleanly
    state = Order.OrderSchemaForm.moveArrayItem(state, "items", 0, 1, (v) => {
      const [first, second] = v.items
      return {
        ...v,
        items: first !== undefined && second !== undefined ? [second, first] : v.items
      }
    })
    expect(state.touched).toEqual(["items.1.sku", "items.0.quantity"])
    expect(state.serverErrors).toEqual({
      "items.0.sku": ["Server error row 2"]
    })
  })

  it("compares Redacted and Option values accurately in deepEqual / isDirty", () => {
    const SecretValues = Schema.Struct({
      token: Schema.Redacted(Schema.String),
      note: Schema.Option(Schema.String)
    })
    const SecretForm = SchemaForm.make({
      valueSchema: SecretValues,
      formSchema: SecretValues,
      mode: "onChange"
    })
    let state = SecretForm.init({
      token: Redacted.make("alpha"),
      note: Option.none()
    })
    expect(SecretForm.isDirty(state)).toBe(false)

    state = SecretForm.update(state, "token", (v) => ({ ...v, token: Redacted.make("beta") }))
    expect(SecretForm.isDirty(state)).toBe(true)

    state = SecretForm.update(state, "token", (v) => ({ ...v, token: Redacted.make("alpha") }))
    expect(SecretForm.isDirty(state)).toBe(false)

    state = SecretForm.update(state, "note", (v) => ({ ...v, note: Option.some("memo") }))
    expect(SecretForm.isDirty(state)).toBe(true)
  })

  it("keeps empty optional fields NotValidated after submit and memoizes derive references", () => {
    let state = Order.OrderSchemaForm.init(Order.defaultOrderFormValues)
    state = Order.OrderSchemaForm.submit(state)

    const derivedA = Order.OrderSchemaForm.derive(state)
    const derivedB = Order.OrderSchemaForm.derive(state)
    expect(derivedA).toBe(derivedB)

    expect(derivedA.field("promoCode").status).toBe("NotValidated")
    expect(derivedA.field("promoCode").invalid).toBeUndefined()
    expect(derivedA.field("deliveryNote").status).toBe("NotValidated")
    expect(derivedA.field("deliveryNote").invalid).toBeUndefined()

    const withChecksA = Order.OrderSchemaForm.derive(state, {
      projectCode: { _tag: "Validating" }
    })
    const withChecksB = Order.OrderSchemaForm.derive(state, {
      projectCode: { _tag: "Validating" }
    })
    expect(withChecksA).toBe(withChecksB)
    expect(Order.OrderSchemaForm.derive(state)).toBe(derivedA)
  })
})

describe("/order SSR & zero-flash hydration", () => {
  it.effect("Ssr.ssr renders full /order HTML and adopts Model with zero client refetches", () =>
    Effect.gen(function* () {
      const { result } = yield* Helpers.ssrAt("/order")
      expect(result.html).toContain('data-page-chunk="SENTINEL:order-form-page"')
      expect(result.html).not.toContain("data-fallback")
      expect(result.document.title).toBe("Custom Order · Effect UI lazy routes")
      expect(Object.keys(result.state)).toContain("/App/OrderFormPage[/order]")
      expect(result.adopted).toContain("/App/OrderFormPage[/order]")
      expect(result.root.frames()).toEqual(["page"])
      expect(result.root.fetches()).toEqual([])
      expect(result.misses).toEqual([])
    }).pipe(Effect.provide(Helpers.appAt("/order")))
  )

  it.layer(Helpers.browserEnv, { buildPerTest: true })("on the browser", (it) => {
    it.effect("adopts the server DOM nodes by reference with 0 fallbacks and 0 initial RPC calls", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateCapturing("/order", (container) => ({
          section: container.querySelector("section"),
          form: container.querySelector("form"),
          projectCode: container.querySelector('[data-testid="project-code-input"]'),
          submit: container.querySelector('[data-testid="order-submit"]')
        }))
        for (const [name, node] of Object.entries(browser.before)) {
          expect(node, `${name} was server-rendered`).not.toBeNull()
        }
        expect(browser.container.querySelector("section")).toBe(browser.before.section)
        expect(browser.container.querySelector("form")).toBe(browser.before.form)
        expect(Helpers.byTestId(browser.container, "project-code-input")).toBe(browser.before.projectCode)
        expect(Helpers.byTestId(browser.container, "order-submit")).toBe(browser.before.submit)

        yield* Helpers.runOutTheClock
        expect(browser.fallbacksSeen()).toEqual([])
        expect((yield* Helpers.portCounts).checkOrderCode).toBe(0)
        expect((yield* Helpers.portCounts).validatePromoCode).toBe(0)
        expect((yield* Helpers.portCounts).submitOrder).toBe(0)
      })
    )
  })
})

describe("/order interactive OmegaForm workflows", () => {
  it.layer(Helpers.browserEnv, { buildPerTest: true })("on the browser", (it) => {
    it.effect("gates debounced CheckOrderCode on sync validity, coalesces bursts, and applies suggestions", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/order")
        const codeInput = Helpers.byTestId(browser.container, "project-code-input")

        // 1. Sync-invalid code ("ab") never fires an async RPC.
        Helpers.type(codeInput, "ab")
        yield* debounceAndRoundTrip
        expect((yield* Helpers.portCounts).checkOrderCode).toBe(0)

        // 2. Burst typing coalesces to a single RPC after 300ms pause.
        for (const partial of ["t", "ta", "taken", "taken-code"]) {
          Helpers.type(codeInput, partial)
          yield* TestHost.settle
          yield* TestClock.adjust("200 millis")
          yield* TestHost.settle
        }
        expect((yield* Helpers.portCounts).checkOrderCode).toBe(0)

        yield* TestClock.adjust("100 millis")
        yield* TestHost.settle
        expect((yield* Helpers.portCounts).checkOrderCode).toBe(1)
        expect(Helpers.text(browser.container, '[data-testid="project-code-status"]')).toBe(
          "Checking project code availability…"
        )

        yield* roundTrip
        expect(Helpers.text(browser.container, '[data-testid="project-code-error"]')).toBe(
          'Project code "taken-code" is already taken'
        )
        expect(Helpers.text(browser.container, '[data-testid="project-code-suggestion"]')).toBe('Use "taken-code-2"')

        // 3. Clicking the suggestion fills the available code and resolves to Available ✓.
        Helpers.click(Helpers.byTestId(browser.container, "project-code-suggestion"))
        yield* TestHost.settle
        expect(Helpers.inputValue(codeInput)).toBe("taken-code-2")
        yield* debounceAndRoundTrip
        expect((yield* Helpers.portCounts).checkOrderCode).toBe(2)
        expect(Helpers.text(browser.container, '[data-testid="project-code-status"]')).toBe("Available ✓")
        expect(browser.container.querySelector('[data-testid="project-code-error"]')).toBeNull()
      })
    )

    it.effect("validates promo codes asynchronously and updates live totals without watchers", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/order")
        const promoInput = Helpers.byTestId(browser.container, "promo-code-input")
        expect(Helpers.text(browser.container, '[data-testid="summary-subtotal"]')).toBe("Subtotal: $48.00")
        expect(Helpers.text(browser.container, '[data-testid="summary-total"]')).toBe("Total: $48.00")

        Helpers.type(promoInput, "BADCODE")
        yield* debounceAndRoundTrip
        expect((yield* Helpers.portCounts).validatePromoCode).toBe(1)
        expect(Helpers.text(browser.container, '[data-testid="promo-code-error"]')).toContain("not recognized")
        expect(Helpers.text(browser.container, '[data-testid="summary-total"]')).toBe("Total: $48.00")

        Helpers.type(promoInput, "STUDIO15")
        yield* debounceAndRoundTrip
        expect((yield* Helpers.portCounts).validatePromoCode).toBe(2)
        expect(Helpers.text(browser.container, '[data-testid="promo-code-status"]')).toBe(
          "Applied: 15% studio discount"
        )
        expect(Helpers.text(browser.container, '[data-testid="summary-discount"]')).toBe("Discount: −$7.20")
        expect(Helpers.text(browser.container, '[data-testid="summary-total"]')).toBe("Total: $40.80")
      })
    )

    it.effect("supports tagged union billing switching, Select payment terms, and Invoice $100 minimum", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/order")
        expect(browser.container.querySelector('[data-testid="billing-cardholder"]')).not.toBeNull()
        expect(browser.container.querySelector('[data-testid="billing-company"]')).toBeNull()

        Helpers.click(Helpers.byTestId(browser.container, "billing-radio-Invoice"))
        yield* Helpers.settleFrames
        expect(browser.container.querySelector('[data-testid="billing-cardholder"]')).toBeNull()
        expect(browser.container.querySelector('[data-testid="billing-company"]')).not.toBeNull()

        // Pick Net 60 days from headless Select.
        Helpers.click(Helpers.byTestId(browser.container, "billing-terms-trigger"))
        yield* Helpers.settleFrames
        Helpers.click(Helpers.byTestId(browser.container, "billing-terms-option-60"))
        yield* Helpers.settleFrames
        expect(Helpers.text(browser.container, '[data-testid="billing-terms-trigger"]')).toContain("Net 60 days")

        Helpers.type(Helpers.byTestId(browser.container, "project-code-input"), "invoice-order")
        Helpers.type(Helpers.byTestId(browser.container, "contact-email-input"), "ap@acme.test")
        Helpers.type(Helpers.byTestId(browser.container, "billing-company"), "Acme Corp")
        Helpers.type(Helpers.byTestId(browser.container, "billing-po"), "PO-2026")
        Helpers.click(Helpers.byTestId(browser.container, "accept-terms-checkbox"))
        yield* debounceAndRoundTrip

        // Subtotal is $48 (< $100), so Invoice minimum refinement targets billing.poNumber.
        submitForm(browser.container)
        yield* Helpers.settleFrames
        expect((yield* Helpers.portCounts).submitOrder).toBe(0)
        expect(Helpers.text(browser.container, '[data-testid="billing-po-error"]')).toContain(
          "Invoice billing requires a subtotal of at least $100.00"
        )
      })
    )

    it.effect("handles dynamic line items, duplicate SKU refinement, and expedited delivery instructions", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/order")

        // Add a row with a duplicate SKU and enable expedited production without instructions.
        Helpers.click(Helpers.byTestId(browser.container, "add-line-item"))
        yield* Helpers.settleFrames
        expect(browser.container.querySelector('[data-testid="line-item-1"]')).not.toBeNull()
        Helpers.type(Helpers.byTestId(browser.container, "item-1-sku"), "notebook-a5")
        Helpers.click(Helpers.byTestId(browser.container, "expedited-switch"))
        yield* Helpers.settleFrames

        expect(Helpers.text(browser.container, '[data-testid="summary-subtotal"]')).toBe("Subtotal: $73.00")
        expect(Helpers.text(browser.container, '[data-testid="summary-expedited"]')).toBe("Expedited: +$25.00")
        expect(Helpers.text(browser.container, '[data-testid="summary-total"]')).toBe("Total: $98.00")

        fillValidCardOrder(browser.container, "rush-order")
        yield* debounceAndRoundTrip

        submitForm(browser.container)
        yield* Helpers.settleFrames
        expect((yield* Helpers.portCounts).submitOrder).toBe(0)
        expect(Helpers.text(browser.container, '[data-testid="item-1-sku-error"]')).toContain("Duplicate SKU")
        expect(Helpers.text(browser.container, '[data-testid="delivery-note-error"]')).toContain(
          "Expedited orders require delivery instructions"
        )
        expect(Helpers.text(browser.container, '[data-testid="form-error-summary"]')).toContain(
          "Item #2 · SKU: Duplicate SKU"
        )

        // Removing the duplicate row and supplying delivery instructions passes validation.
        Helpers.click(Helpers.byTestId(browser.container, "item-1-remove"))
        Helpers.type(Helpers.byTestId(browser.container, "delivery-note-input"), "Leave at studio reception")
        yield* Helpers.settleFrames
        expect(browser.container.querySelector('[data-testid="line-item-1"]')).toBeNull()
        expect(Helpers.text(browser.container, '[data-testid="summary-total"]')).toBe("Total: $73.00")

        submitForm(browser.container)
        yield* Helpers.settleFrames
        yield* roundTrip
        expect((yield* Helpers.portCounts).submitOrder).toBe(1)
        expect(Helpers.text(browser.container, '[data-testid="order-receipt"]')).toContain("Order ORD-0001 submitted")
      })
    )

    it.effect("shows client errors on invalid submit without dispatching RPC and handles blur", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/order")
        const emailInput = Helpers.byTestId(browser.container, "contact-email-input")
        blurElement(emailInput)
        yield* TestHost.settle
        // In onSubmit mode, blurring alone does not surface errors yet.
        expect(browser.container.querySelector('[data-testid="contact-email-error"]')).toBeNull()

        submitForm(browser.container)
        yield* Helpers.settleFrames
        expect((yield* Helpers.portCounts).submitOrder).toBe(0)
        expect(browser.container.querySelector('[data-testid="form-error-summary"]')).not.toBeNull()
        expect(Helpers.text(browser.container, '[data-testid="project-code-error"]')).toContain("at least 3 characters")
        expect(Helpers.text(browser.container, '[data-testid="contact-email-error"]')).toContain("required")
        expect(Helpers.text(browser.container, '[data-testid="accept-terms-error"]')).toContain("accept")
      })
    )

    it.effect("maps server OrderValidationError to fields and auto-clears on edit (SetErrorOnSubmit)", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/order")
        fillValidCardOrder(browser.container, "race-conflict")
        yield* debounceAndRoundTrip

        submitForm(browser.container)
        yield* Helpers.settleFrames
        yield* roundTrip

        expect((yield* Helpers.portCounts).submitOrder).toBe(1)
        expect(Helpers.text(browser.container, '[data-testid="project-code-error"]')).toContain(
          'Order code "race-conflict" was claimed before submission completed'
        )
        expect(Helpers.text(browser.container, '[data-testid="form-error-summary"]')).toContain("Project code:")

        // Editing the field clears its server error immediately.
        Helpers.type(Helpers.byTestId(browser.container, "project-code-input"), "fresh-code")
        yield* TestHost.settle
        expect(browser.container.querySelector('[data-testid="project-code-error"]')).toBeNull()
      })
    )

    it.effect("preserves edits on ApiError submit failure and recovers on retry", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/order")
        fillValidCardOrder(browser.container, "server-error")
        yield* debounceAndRoundTrip

        submitForm(browser.container)
        yield* Helpers.settleFrames
        yield* roundTrip

        expect((yield* Helpers.portCounts).submitOrder).toBe(1)
        expect(Helpers.text(browser.container, '[data-testid="submit-error"]')).toContain(
          "Order service temporarily unavailable. Please retry."
        )
        expect(Helpers.inputValue(Helpers.byTestId(browser.container, "contact-email-input"))).toBe("ada@studio.test")

        Helpers.type(Helpers.byTestId(browser.container, "project-code-input"), "recovered-order")
        yield* debounceAndRoundTrip
        submitForm(browser.container)
        yield* Helpers.settleFrames
        yield* roundTrip

        expect((yield* Helpers.portCounts).submitOrder).toBe(2)
        expect(browser.container.querySelector('[data-testid="submit-error"]')).toBeNull()
        expect(Helpers.text(browser.container, '[data-testid="order-receipt"]')).toContain("Order ORD-0001 submitted")
      })
    )

    it.effect("blocks navigation while dirty, guards double-submit, rebases on success, and unblocks navigation", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/order")
        expect(Helpers.text(browser.container, '[data-testid="form-dirty-badge"]')).toBe("Saved / clean")

        fillValidCardOrder(browser.container, "autumn-mug-run")
        yield* TestHost.settle
        expect(Helpers.text(browser.container, '[data-testid="form-dirty-badge"]')).toBe("Unsaved changes")

        // Attempting to follow a nav link while dirty is blocked by Router.blocked("order-form").
        Helpers.click(Helpers.link(browser.container, "/analytics"))
        yield* TestHost.settle
        expect(window.location.pathname).toBe("/order")

        yield* debounceAndRoundTrip

        // Submit and fire a second submit while in flight -> guarded to 1 RPC and fieldset disabled.
        submitForm(browser.container)
        yield* TestHost.settle
        expect(Helpers.text(browser.container, '[data-testid="order-submit"]')).toBe("Submitting order…")
        expect(Helpers.byTestId(browser.container, "order-submit").hasAttribute("disabled")).toBe(true)
        submitForm(browser.container)
        yield* TestHost.settle

        yield* roundTrip
        expect((yield* Helpers.portCounts).submitOrder).toBe(1)
        expect(Helpers.text(browser.container, '[data-testid="order-receipt"]')).toContain("Order ORD-0001 submitted")
        expect(Helpers.text(browser.container, '[data-testid="form-dirty-badge"]')).toBe("Saved / clean")

        // SubmitOrder invalidated CheckOrderCode; re-checking the claimed code now reports unavailable.
        yield* roundTrip
        expect(Helpers.text(browser.container, '[data-testid="project-code-error"]')).toContain("already taken")

        // Navigation is unblocked once rebased.
        yield* Helpers.follow(browser, "/analytics")
        expect(window.location.pathname).toBe("/analytics")
        expect(browser.container.querySelector('[data-page-chunk="SENTINEL:analytics-page"]')).not.toBeNull()
      })
    )
  })
})
