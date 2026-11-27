import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Schema, SchemaIssue } from "effect"
import * as LocalizedValidation from "../src/form/localizedValidation.ts"
import * as I18n from "../src/i18n/I18n.ts"
import * as DeCatalog from "../src/i18n/catalogs/de.ts"
import * as EnCatalog from "../src/i18n/catalogs/en.ts"
import * as Messages from "../src/i18n/messages.ts"
import * as Order from "../src/order/domain/Order.ts"
import * as ApiError from "../src/rpc/domain/ApiError.ts"
import * as Warehouse from "../src/warehouse/domain/Warehouse.ts"
import * as Helpers from "./helpers.ts"
import * as TestRpc from "./support/rpc.ts"

describe("i18n catalogs & template formatter", () => {
  it("keeps exact key parity across MESSAGE_KEYS, en, and de with non-empty values", () => {
    const expectedKeys = [...Messages.MESSAGE_KEYS].sort()
    expect(Object.keys(EnCatalog.catalog).sort()).toEqual(expectedKeys)
    expect(Object.keys(DeCatalog.catalog).sort()).toEqual(expectedKeys)

    for (const key of Messages.MESSAGE_KEYS) {
      expect(EnCatalog.catalog[key].trim().length, `en:${key}`).toBeGreaterThan(0)
      expect(DeCatalog.catalog[key].trim().length, `de:${key}`).toBeGreaterThan(0)
    }
    expect(EnCatalog.chunkMarker).toBe("SENTINEL:i18n-en")
    expect(DeCatalog.chunkMarker).toBe("SENTINEL:i18n-de")
  })

  it("formats ICU parameter and plural blocks in EN & DE", () => {
    expect(Messages.formatTemplate(EnCatalog.catalog["validation.fixErrorsCount"], { count: 1 })).toBe("1 issue")
    expect(Messages.formatTemplate(EnCatalog.catalog["validation.fixErrorsCount"], { count: 3 })).toBe("3 issues")
    expect(Messages.formatTemplate(DeCatalog.catalog["validation.fixErrorsCount"], { count: 1 })).toBe("1 Problem")
    expect(Messages.formatTemplate(DeCatalog.catalog["validation.fixErrorsCount"], { count: 3 })).toBe("3 Probleme")

    expect(
      Messages.formatTemplate(DeCatalog.catalog["warehouse.errorCartInUse"], {
        cartCode: "CART-204",
        station: "Packstation B"
      })
    ).toBe("Wagen CART-204 ist aktuell an Packstation B gesperrt und kann nicht freigegeben werden.")
  })

  it("localizes SchemaForm labels, validation checks, and AST literal unions for de vs en", () => {
    const enForm = Order.getOrderSchemaForm("en")
    const deForm = Order.getOrderSchemaForm("de")

    expect(enForm.labelFor("projectCode")).toBe("Project code")
    expect(deForm.labelFor("projectCode")).toBe("Projektcode")
    expect(enForm.labelFor("billing.paymentTermsDays")).toBe("Payment terms")
    expect(deForm.labelFor("billing.paymentTermsDays")).toBe("Zahlungsziel")
    expect(deForm.labelFor("items.0.quantity")).toBe("Position #1 · Menge")

    const invalidSubmitted = deForm.submit(
      deForm.init({
        ...Order.defaultOrderFormValues,
        projectCode: "ab",
        contactEmail: "not-an-email"
      })
    )
    const derived = deForm.derive(invalidSubmitted)
    expect(derived.field("projectCode").errors).toContain("Projektcode muss mindestens 3 Zeichen lang sein")
    expect(derived.field("contactEmail").errors).toContain("Bitte geben Sie eine gültige E-Mail-Adresse ein")

    // Verify `annotateLiteralUnionMessages` rewrites `Schema.Literals` AST failure messages for active locale.
    const deTr = I18n.translatorFor("de")
    const deHooks = LocalizedValidation.makeLocalizedHooks(deTr.t)
    const TermsSchema = LocalizedValidation.annotateLiteralUnionMessages(Schema.Literals(["15", "30", "60"]), deTr.t)
    const formatter = SchemaIssue.makeFormatterStandardSchemaV1({
      leafHook: deHooks.leafHook,
      checkHook: deHooks.checkHook
    })
    const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(TermsSchema)("90"))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      const firstReason = exit.cause.reasons[0]
      if (firstReason?._tag === "Fail") {
        const formatted = formatter(firstReason.error.issue)
        expect(formatted.issues.map((item) => item.message)).toContain("Bitte wählen: 15, 30, 60")
      }
    }
  })

  it("localizes Warehouse domain & transport errors in EN and DE", () => {
    const en = I18n.translatorFor("en").t
    const de = I18n.translatorFor("de").t

    const conflictFailure = new Warehouse.WarehouseCommandFailure({
      error: new Warehouse.ResourceCheckoutConflictError({
        reason: "spot-has-cart",
        resourceType: "packing-station",
        resourceName: "Bay-A2"
      }),
      transportMessage: null,
      failureSpan: null
    })
    expect(Warehouse.describeWarehouseFailure(en, conflictFailure)).toContain("Packing station: Bay-A2")
    expect(Warehouse.describeWarehouseFailure(de, conflictFailure)).toContain("Packstation: Bay-A2")

    const expiredFailure = new Warehouse.WarehouseCommandFailure({
      error: new Warehouse.SessionExpiredError({ action: "blockCart" }),
      transportMessage: null,
      failureSpan: null
    })
    expect(Warehouse.describeWarehouseFailure(en, expiredFailure)).toContain("Session expired")
    expect(Warehouse.describeWarehouseFailure(de, expiredFailure)).toContain("Sitzung abgelaufen")

    const transportFailure = new Warehouse.WarehouseCommandFailure({
      error: new ApiError.ApiError({ message: "ECONNRESET" }),
      transportMessage: "ECONNRESET",
      failureSpan: null
    })
    expect(Warehouse.describeWarehouseFailure(de, transportFailure)).toContain("RPC-Verbindungsfehler")
  })
})

describe("/order German SSR & hydration", () => {
  it.effect("renders and adopts German labels, EUR currency, and 0 refetches via Ssr.ssr", () =>
    Effect.gen(function* () {
      const { result } = yield* Helpers.ssrAt("/order", { locale: "de" })
      expect(result.document.documentElement.lang).toBe("de")
      expect(result.document.title).toContain("Sonderbestellung")
      expect(result.html).toContain("Individuelle Studiobestellung")
      expect(result.html).toContain('data-i18n-chunk="SENTINEL:i18n-de"')
      expect(result.html).toContain("48,00")
      expect(result.root.frames()).toEqual(["page"])
      expect(result.root.fetches()).toEqual([])
      expect(result.misses).toEqual([])
    }).pipe(Effect.provide(Helpers.appAt("/order")))
  )

  it.layer(Helpers.browserEnv, { buildPerTest: true })("browser hydration in locale=de", (it) => {
    it.effect("hydrates German /order DOM without losing nodes or triggering RPCs", () =>
      Effect.gen(function* () {
        const browser = yield* Helpers.hydrateFromServer("/order", { locale: "de" })
        expect(document.documentElement.lang).toBe("de")
        expect(browser.container.textContent).toContain("Individuelle Studiobestellung")
        const subtotal = Helpers.byTestId(browser.container, "summary-subtotal").textContent ?? ""
        expect(subtotal).toContain("48,00")
        expect(subtotal).toContain("€")
        expect(yield* Helpers.portCounts).toEqual(TestRpc.noCalls)
        expect(browser.fallbacksSeen()).toEqual([])
      })
    )
  })
})
