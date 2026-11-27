---
name: "query-result-boundary"
subject: "`@effect/ui` pages and components that render `h.queries.*` (`src/pages/**/*.ts`, `src/design/queryResult.ts`)."
requirement: |
  Match each `h.queries.*` result once at the component boundary through `QueryResult.matchQuery` (or root
  `AsyncResult` matching that inspects `Failure.previousSuccess`):
  - `onInitial`: loading UI only (never reached during hydrated SSR; valid for cold client navigation or fallback mounts).
  - `onFailure`: reached only when no prior data exists (`Failure.previousSuccess` is `None`); render a dedicated
    error component with Retry (`QueryResult.errorPanel`) and HTTP `503` on SSR (`data-http-status="503"`), never
    turning a failure into `undefined` or a blank state.
  - `onReady`: reached for `Success` OR for a `Failure` carrying `previousSuccess: Some(...)`; pass guaranteed
    non-optional `data: A` into pure content views with zero downstream `data === undefined` checks, and show an
    inline `QueryResult.refreshErrorBanner` when `refreshFailure !== undefined`.
  - Key both `QueryResult.refreshErrorBanner` (`.key("refresh-error")`) and its ready content sibling
    (`.key("*-content")`) so inserting or clearing the banner preserves hydrated DOM nodes in `@effect/ui` `patchList`.
  Trigger manual refreshes through `Command.make` calling `Query.invalidate(...)`, never bypassing `Query.Service`.
purpose: |
  Keeps content renderers free of defensive "is defined" checks, guarantees SSR failures render a real error component
  (with HTTP 503) instead of collapsing into undefined/loading states, and preserves last-known SSR/cached data when a
  client refresh fails.
golden: "src/pages/StatusPage.ts"
coverage: review
---

```diff
-const series = AsyncResult.match(h.queries.series, {
-  onInitial: () => undefined,
-  onFailure: () => undefined,
-  onSuccess: ({ value }) => value
-})
-if (series === undefined) return h.p("Loading…")
-return renderChart(h, series)
+return QueryResult.matchQuery(h.queries.series, {
+  onInitial: () => h.p.children("Loading…"),
+  onFailure: (cause) => QueryResult.errorPanel(h, { title: "Couldn't load analytics", cause, onRetry }),
+  onReady: ({ data, refreshFailure, waiting }) =>
+    h.div.children(
+      refreshFailure === undefined ? undefined : QueryResult.refreshErrorBanner(h, { cause: refreshFailure, waiting, onRetry }),
+      renderChart(h, data, waiting).key("analytics-content") // `data` is guaranteed defined
+    )
+})
```
