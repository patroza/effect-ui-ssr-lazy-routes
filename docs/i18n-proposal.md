# Internationalization (i18n) Proposal for `@effect/ui` Apps

This proposal outlines a complete, SSR-safe, bundle-split architecture for i18n in `@effect/ui` (covering routing, catalog formatting, Effect Schema & `SchemaForm` validation hooks, locale-aware numbers/currencies/dates, RPC localization, and testing), drawing directly on proven patterns from `effect-app/packages/vue` and `effect-app/packages/vue-components`.

---

## 1. Goals & `@effect/ui` Constraints

1. **Zero-flash SSR + hydration determinism:** Server HTML, `<head>` (`Head.title`), hydrated DOM text, formatted numbers/dates, and error messages must agree byte-for-byte on first paint with zero FOUC or hydration mismatches.
2. **Concurrent request isolation (no mutable module singletons):** In `effect-app/vue`, legacy `form.ts` kept a module-level `export const translate = ref(...)` updated inside a Vue `watch`. Under SSR with concurrent requests, module-level locale state leaks across fibers. All locale state in `@effect/ui` must flow via **Effect Services** (for Commands/Queries/SSR) and **props / `shares`+`reads`** (for views).
3. **Zero dead bytes for inactive locales:** In a multi-locale app, a German `/de/...` visit must load only the German message catalog chunk — `verify:bundles` should assert inactive locale chunks never appear in `<link rel="modulepreload">`.
4. **Full replayability in `Story` and `Scene`:** Pure `view`, `head`, and `update` must remain deterministic given explicit locale/translator values recorded or injected in tests.

---

## 2. Locale Resolution, Routing & Locale Switching

### URL Prefix Routing (`BrowserRouter` + `Router.static`)

`@effect/ui`'s `BrowserRouter.layer` natively supports dynamic locale base segments:

```ts
const SupportedLocales = ["de", "en"] as const
type AppLocale = (typeof SupportedLocales)[number]
const isSupportedLocale = (segment: string): segment is AppLocale => SupportedLocales.includes(segment as AppLocale)

// Client composition root (`main.ts`)
BrowserRouter.layer({
  routes: Routes.AppRoute,
  base: (segment) => isSupportedLocale(segment)
})
```

- **Server (`handler.ts` / `render.ts`):** Inspect the first path segment (falling back to cookie / `Accept-Language` / default locale), canonical-redirect `/` or unprefixed paths if multi-locale, emit `<html lang="${locale}">`, and mount `Router.static({ url, base: `/${locale}` })`.
- **Single-locale storefront mode (e.g. Axom `de-DE` shop):** Skip URL prefix routing, pin one locale constant (`"de-DE"`) and one catalog, while still keeping the `I18n` service and Schema localization hooks below so copy, numbers, and Schema errors share one clean pipeline.

### Locale Switching = Full Document Reload

Echoing the note in `effect-app/vue/src/makeIntl.ts` (`"changing locale should really be a page reload, as you don't want to listen to the locale changing at every place"`):

- Switching locales navigates via a standard full-page anchor (`<a href="/de/..." rel="external">` or `location.assign(...)`) rather than swapping locale reactively inside an SPA session.
- **Why:** Components never need reactive subscriptions on every formatted label or memoized `SchemaForm` formatter; each browser session loads one immutable catalog chunk for its lifetime.

---

## 3. Two-Layer Delivery: `I18n` Service + `I18nProvider` (`shares` / `reads`)

Separate Effectful code (Commands, Queries, server handlers) from pure synchronous `view` / `head` functions:

### A. Effect Service (`I18n`) for Server, `Query.Service`, and `Command.Service`

Inspired by `effect-app/packages/vue/src/intl.ts`:

```ts
export interface I18nShape<Key extends string = MessageKey> {
  readonly locale: AppLocale
  readonly bcp47: string // e.g. "de-DE" | "en-US"
  readonly timeZone: string // e.g. "Europe/Berlin" (pinned across SSR & hydration)
  readonly t: (id: Key, values?: Readonly<Record<string, string | number | Date>>) => string
  readonly formatCurrency: (cents: number, currency?: string) => string
  readonly formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string
  readonly formatDate: (date: Date, options?: Intl.DateTimeFormatOptions) => string
}

export class I18n extends Context.Service<I18n, I18nShape>()("app/I18n") {
  static readonly make = (config: { readonly locale: AppLocale; ... }): Layer.Layer<I18n> => ...
}
```

### B. Ambient View Access (`I18nProvider` via `@effect/ui` `shares` / `reads`)

For pure `view`, `head`, and reusable UI components (like `QueryResult`, `FormControls`) without threading `i18n` through every prop signature:

- Mount an `I18nProvider` component near `App`'s root receiving serialized `{ locale, bcp47, timeZone }` as `props` (`restore: false`) and preloaded catalog messages, exposing `shares: { value: () => shape }`.
- Consumers declare `reads: { i18n: I18nProvider }` and call `h.reads.i18n.t(...)` inside `view` (or `$.reads.i18n.t(...)` inside `update`).
- `@effect/ui` enforces `Component.Shared<"I18nProvider">` in the type system, records reads in `MessageLog` for `Story`, and supports trivial overrides in `Scene` via `s.shared(I18nProvider, testI18n)`.
- For tiny single-locale apps (or SSR `Head.title`), explicit passing (`QueryResult.errorPanel(h, status, { ..., messages })` or single-locale catalog module) remains a lighter alternative without losing determinism.

---

## 4. Catalog Format & Lazy Splitting

### Recommended Engine: `@formatjs/intl` (Pre-compiled ASTs) or Typed Message Functions

| Aspect                                   | `@formatjs/intl` (like `effect-app/vue`)                                                              | Compiled TS Functions (Paraglide / custom TS maps)                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Bundle size**                          | Small runtime (~7 kB gzip when messages are AST-precompiled via `@formatjs/cli compile --ast`)        | ~0 B parser overhead; every message compiles to a plain TS arrow function |
| **Plurals / Select / Number / Date ICU** | Full ICU MessageFormat (`{count, plural, one {# item} other {# items}}`) + shared `Intl.*` formatters | Manual per-message helpers or limited ICU subset                          |
| **Ecosystem / TMS**                      | Direct compatibility with existing `effect-app/vue` JSON catalogs & Crowdin/Lokalise workflows        | Requires custom adapter for external translators                          |

- **Recommendation:** Keep `@formatjs/intl` with build-time AST precompilation (`compile --ast`) when sharing translators/catalogs with `effect-app/vue` / `shop` (no runtime ICU parser in the browser), **or** typed TS message dictionaries for zero-dependency samples.
- **Typed keys (`Key extends MessageKey`):** Generate/derive a union of valid IDs (and required placeholder parameter types where feasible) from the default locale catalog so missing keys fail `tsrs --noEmit`.
- **Lazy catalog chunks:** Dynamically import `await import(\`./catalogs/${locale}.ts\`)`alongside`preloadRoute(route)`in`bootstrap.ts`BEFORE`HtmlHydrate.hydrateEffect`, so only the active locale is downloaded and hydration never renders fallback keys.

---

## 5. Schema, `SchemaForm`, and Validation Localization

This maps cleanly from `effect-app/packages/vue-components/src/components/OmegaForm/validation/localized.ts` and `errors.ts` onto `src/form/SchemaForm.ts` and `SchemaIssue.makeFormatterStandardSchemaV1`:

### A. Porting `makeStandardSchemaV1Hooks(t)`

`SchemaForm.make` already accepts `leafHook` and `checkHook`:

```ts
export const makeLocalizedHooks = (
  t: I18nShape["t"]
): {
  readonly leafHook: SchemaIssue.LeafHook
  readonly checkHook: SchemaIssue.CheckHook
} => ({
  leafHook: (issue) => {
    // Respect explicit schema annotations first, then localize structural failures:
    // - MissingKey / undefined -> t("validation.empty")
    // - InvalidType on string / number / boolean -> t("validation.number.expected", { actualValue })
  },
  checkHook: (issue) => {
    // 1. Identifier check (e.g. identifier === "Email" -> t("validation.email.invalid"))
    // 2. Effect v4 `filter.annotations.representation.id` (`effect/schema/...`):
    //    - isMinLength (minLength === 1 -> validation.empty, else validation.string.minLength)
    //    - isMaxLength -> validation.string.maxLength
    //    - isInt -> validation.integer.expected
    //    - isGreaterThanOrEqualTo / isGreaterThan / isLessThanOrEqualTo / isLessThan / isBetween
    //      (mapped to validation.number.min / max / positive with `isExclusive`)
    // 3. Fallback: `SchemaIssue.defaultCheckHook(issue)` so custom `Schema.makeFilter`
    //    messages (or explicit per-filter `message`) pass through cleanly.
  }
})
```

### B. `AnyOf` / `Schema.Literals` Localization (`annotateLiteralUnionMessages`)

Just as discovered in `OmegaForm/validation/localized.ts`: Effect's formatter handles `AnyOf` issues (for `Schema.Literals(["15", "30", "60"])` or array of literal unions) directly via `getExpectedMessage` without calling `leafHook`/`checkHook`. Porting the one-time `annotateLiteralUnionMessages(schema, t)` AST walk stamps localized `annotations.message` onto `Union<Literal>` and `Arrays<Union<Literal>>` nodes once at form setup.

**Caution (`SchemaForm` caching vs locale):** Instantiate `OrderSchemaForm` per locale/translator (or memoize `SchemaForm.make` per `locale`) rather than baking one static English `SchemaForm` at module import time when serving multiple locales.

### C. Hierarchical Field Label Resolution (`errors.ts` chain)

Upgrade `SchemaMeta.resolveFieldLabel` (`schemaMeta.ts`) to resolve in order:

1. `${namespace}.fields.${normalizedPath}` (converting `items.1.sku` -> wildcard `items.*.sku` while preserving `Item #2 · ...` prefixing),
2. `general.fields.${normalizedPath}`,
3. Schema AST `title` annotation (can itself hold a message key convention such as `"order.fields.projectCode"` or fallback text),
4. `humanizeKey(path)`.

### D. Locale-Aware Numbers, Currency & Decimal Separators

- Replace hardcoded `locale: "en-US"` and `USD` formatting in `FormControls.numberField` and `Order.formatCents` with `i18n.bcp47` and `i18n.formatCurrency(...)`.
- Port `OmegaForm/decimalSeparatorInput.ts` onto `NumberField`'s `input` element (translating `,` <-> `.` on `beforeinput` when a user presses the numpad `.` on a `de-DE` comma locale so decimal entry never silently drops keystrokes).
- For flat `Validation.make` forms, construct rule messages via a small factory `(t) => Validation.make({ ... })` using `Validation.Rule.*(..., t(...))` so rules stay localized cleanly without touching `@effect/ui` core.

### E. Server Validation & `ApiError` Localization

1. **Client header propagation:** In the client composition root, wrap `HttpClient` / `RpcClient` with a middleware that attaches `Accept-Language: i18n.bcp47`.
2. **Typed domain errors:** Prefer returning structured error codes + typed interpolation params on `ApiError` / `OrderValidationError` (so the client formats them with its loaded catalog), falling back to server-translated `message` via `Accept-Language` only for legacy/external errors.

---

## 6. SSR Hydration, Timezones & Testing

1. **Timezones & formatting parity:** Browser timezone !== Node server timezone breaks date hydration. Always pass an explicit `timeZone` (default `"UTC"` or store timezone `"Europe/Berlin"`) serialized inside `#state` and `I18nProvider` props so `HtmlServer.renderToHtml` and `HtmlHydrate.hydrateEffect` format identical strings.
2. **Test helpers:**
   - Provide `makeTestI18n(locale = "en")` implementing `I18nShape` synchronously for unit, `Story`, and `Ssr.ssr` tests.
   - Components reading `I18nProvider` receive `s.shared(I18nProvider, testI18n)` in `Scene` / `HtmlTest`.
   - Extend `scripts/verify-bundles.ts` to check that multi-locale builds split catalogs into independent `locales/<lang>-*.js` chunks and never preload non-active locales.

---

## 7. Phased Rollout Plan

1. **Phase 0 (Single-locale Axom storefront, immediate):** Wire `bcp47: "de-DE"`, `timeZone: "Europe/Berlin"`, localized `makeStandardSchemaV1Hooks` + `annotateLiteralUnionMessages` into `SchemaForm`, and comma/dot numpad translation on `NumberField`.
2. **Phase 1 (Explicit `I18n` service + `I18nProvider`):** Introduce `app/I18n` Context service (Commands/Queries/SSR) and `I18nProvider` (`shares`/`reads`), migrating hardcoded UI copy (`"Loading…"`, `"Retry"`, `QueryResult` banners, `errorSummary`) to typed message keys.
3. **Phase 2 (Multi-locale + lazy bundles):** Enable `BrowserRouter.layer({ base })`, SSR path negotiation + `<html lang>`, dynamic per-locale catalog `import()` in `bootstrap.ts`, and `verify:bundles` assertions across locales.
