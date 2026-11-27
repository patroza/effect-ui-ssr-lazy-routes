# Complex Forms & State in `@effect/ui` (An OmegaForm Architecture)

This document explains how to manage complex forms and form state in `@effect/ui`, how `effect-app/libs`'s `OmegaForm` maps onto `@effect/ui` + Effect v4 `Schema`, and how the `/order` example ([OrderFormPage.ts](../src/pages/OrderFormPage.ts)) puts every piece together.

---

## 1. Core Principles for Complex Forms in `@effect/ui`

`@effect/ui` is built around **typed Model-View-Update (MVU)**, **SSR with zero-flash hydration**, and **Schema-encoded persistence/replay**:

1. **Keep the Component Model minimal and serializable.**
   Store only what cannot be computed from inputs:
   - `values` and `baseline` (for structural `isDirty` comparison),
   - `edited` and `touched` field paths,
   - `submitted` flag,
   - `serverErrors` and `formServerErrors` returned by RPC submission.
     Never store derived validation errors, totals, or `canSubmit` booleans in the Model. Compute them purely in `derive(...)` so cross-field rules and totals can never go stale.

2. **Use Effect `Schema` as the single source of truth.**
   - `OrderFormValues` models raw control state (including `null` for cleared `NumberField`s or `""` for untyped text).
   - `OrderSubmission` models the strict domain contract—shared by the client `SchemaForm` decoder and the server `OrderRpcs` payload (`POST /rpc/order`)—including nested structs, tagged unions (`Card | Invoice`), dynamic arrays (`items`), and cross-field `Schema.makeFilter` refinements targeting exact nested paths (`["items", index, "sku"]`, `["deliveryNote"]`, `["billing", "poNumber"]`).

3. **Model debounced async field validation as `Query.Service` entries.**
   Instead of managing `AbortController`s, sequence numbers, or manual debounce timers:
   - Declare each async validator as a `Query.Service` (`CheckOrderCode`, `ValidatePromoCode`) with `debounce: "300 millis"`.
   - Gate `args` on sync validity (`derived.fieldPassesSync(path) ? { code } : undefined`). Invalid or empty inputs produce `undefined`, keeping network traffic at zero.
   - Changing input restarts the debounce clock and interrupts obsolete in-flight fetches automatically.
   - `SchemaForm.asyncCheckFromResult` projects `AsyncResult` onto `Idle | Validating | Valid | Invalid` (never trapping a failed transport error in `Validating`).

4. **Model submission as a `Command.Service` with explicit state.**
   - Guard double-submit in `update` (`if ($.model.submit._tag === "Submitting") return $.model`).
   - Wrap controls in `@effect/ui-kit`'s `Fieldset` (`disabled: isSubmitting`).
   - Run `SubmitOrder.make({ order: decoded })`, declaring `invalidates` to clear stale `CheckOrderCode` cache entries on exit.
   - Map `OrderValidationError` via `OrderSchemaForm.setServerErrors` (cleared automatically when the user edits that field or any descendant path) and focus the error summary with `HtmlCommand.focus`.
   - Map `ApiError` / `RpcClientError` to a retryable banner without losing form edits.

5. **Guard unsaved changes with `Router.blocked`.**
   Return `[Router.blocked("order-form")]` from `subscriptions` whenever `OrderSchemaForm.isDirty(model.form)` is `true`. On successful submission, `OrderSchemaForm.rebase(form)` advances `baseline` to the submitted values (mirroring OmegaForm's `prevent-and-reset`), releasing `Router.blocked` immediately.

6. **Secret fields (`Schema.Redacted`) belong in leaf components.**
   When a form includes secrets (passwords, API keys), declare those fields with `Schema.Redacted(Schema.String)`. `@effect/ui` excludes any component whose Model contains `Redacted` from `history.state` and SSR state serialization, so isolate secret-bearing forms as leaf components.

---

## 2. Mapping `effect-app/libs` OmegaForm onto `@effect/ui`

| `effect-app/libs` OmegaForm                 | `@effect/ui` + `src/form/` Equivalent                                                                   | Implementation                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `useOmegaForm(schema, opts, cfg)`           | `SchemaForm.make({ valueSchema, formSchema, mode })`                                                    | [`SchemaForm.ts`](../src/form/SchemaForm.ts)        |
| `generateMetaFromSchema(schema)`            | `SchemaMeta.extractFieldMetaMap(schema)` + `resolveFieldLabel`                                          | [`schemaMeta.ts`](../src/form/schemaMeta.ts)        |
| `toLocalizedStandardSchemaV1` + `onDynamic` | `Schema.decodeUnknownExit(formSchema, { errors: "all" })` + `SchemaIssue.makeFormatterStandardSchemaV1` | [`SchemaForm.ts`](../src/form/SchemaForm.ts)        |
| `<form.Form>`                               | `@effect/ui-kit` `Form` (sets `novalidate`, focuses first `[aria-invalid="true"]` on submit)            | [`OrderFormPage.ts`](../src/pages/OrderFormPage.ts) |
| `<form.Input>` / `OmegaInput`               | `FormControls.textField`, `numberField`, `switchField`, `checkboxField` over `Field`                    | [`FormControls.ts`](../src/form/FormControls.ts)    |
| `<form.TaggedUnion>`                        | `makeRadioGroup` + `Schema.TaggedStruct` union branch switching (`Card` \| `Invoice`)                   | [`OrderFormPage.ts`](../src/pages/OrderFormPage.ts) |
| `<form.Array>`                              | Keyed dynamic array rows (`items`) + `AddedLineItem` / `RemovedLineItem`                                | [`OrderFormPage.ts`](../src/pages/OrderFormPage.ts) |
| `<form.Errors />`                           | `FormControls.errorSummary` (`role="alert"` + resolved AST labels)                                      | [`FormControls.ts`](../src/form/FormControls.ts)    |
| `SetErrorOnSubmit`                          | `OrderValidationError` -> `setServerErrors` (auto-clears on field edit)                                 | [`SchemaForm.ts`](../src/form/SchemaForm.ts)        |
| `preventWindowExit: "prevent-and-reset"`    | `Router.blocked("order-form")` + `rebase` on `SucceededSubmit`                                          | [`OrderFormPage.ts`](../src/pages/OrderFormPage.ts) |
| Reactive `watch(values)` totals             | Pure `Order.calculateOrderTotals(values, discountPercent)` in `view`                                    | [`Order.ts`](../src/order/domain/Order.ts)          |

---

## 3. When to Use Built-in `Validation.make` vs `SchemaForm`

- **Use `@effect/ui`'s `Validation.make`** for flat, string-heavy forms (login, signup, contact modals) where flat `Rule.*` lists and `Schema.Redacted` string fields are sufficient.
- **Use `SchemaForm` (`src/form/`)** when the domain schema includes **nested structs, tagged union branches, dynamic array items with per-row errors, cross-field refinements targeting nested paths, AST-driven labels/descriptions, or decoded `From -> To` submission shared with RPC endpoints**.

---

## 4. `/order` Reference Demo Scenarios

Visit `/order` to exercise all behaviors live:

- **`taken-code` or `legacy-01`** in _Project code_: triggers debounced `CheckOrderCode` conflict with a one-click `"Use \"taken-code-2\""` suggestion button.
- **`STUDIO15`** or **`WHOLESALE25`** in _Promo code_: validates asynchronously and updates live subtotal/discount/total pricing.
- **Billing method (`Card` vs `Invoice`)**: switches tagged union branches (`makeRadioGroup` + `makeSelect` for payment terms); `Invoice` enforces a **$100.00 minimum subtotal** on `billing.poNumber`.
- **Duplicate SKU across rows**: adding a second row with the same SKU highlights `items.1.sku` via cross-field `Schema.makeFilter`.
- **Expedited production `Switch`**: requires `deliveryNote` (at least 5 chars) and adds `+$25.00`.
- **`race-conflict`**, **`PO-REJECTED`**, or **`@blocked.test`**: pass client validation and trigger server-side field rejections (`OrderValidationError`), which auto-clear as soon as you edit the flagged field.
- **`server-error`**: triggers an `ApiError` banner while keeping all form values intact for retry.
