---
name: "query-result-boundary"
subject: "`@effect/ui` pages and components that render `h.queries.*` (`src/pages/**/*.ts`, `src/design/queryResult.ts`)."
requirement: |
  Flatten each `h.queries.*` result once at the component boundary through `QueryResult.read` (or root
  `AsyncResult` checks that inspect `Failure.previousSuccess`) and branch with flat early returns using
  `QueryResult.isInitial`, `QueryResult.isFailure`, and (when checking readiness upfront, e.g. in `head`)
  `QueryResult.isReady`:
  - `QueryResult.isInitial(result)`: loading UI only (never reached during hydrated SSR; valid for cold
    client navigation or fallback mounts).
  - `QueryResult.isFailure(result)`: reached only when no prior data exists (`Failure.previousSuccess` is
    `None`); render a dedicated error component with Retry (`QueryResult.errorPanel`) and HTTP `503` on SSR
    (`data-http-status="503"`), never turning a failure into `undefined` or a blank state.
  - Ready happy path (after the early returns, or inside `QueryResult.isReady(result)`): guaranteed
    non-optional `data: A` with zero downstream `data === undefined` checks; render an inline
    `QueryResult.refreshErrorBanner` when `refreshFailure !== undefined`. Leave properties on the narrowed
    result (`result.data`, `result.waiting`, `result.refreshFailure`) rather than destructuring unless
    repeated enough to help clarity.
  - Key both `QueryResult.refreshErrorBanner` (`.key("refresh-error")`) and its ready content sibling
    (`.key("*-content")`) so inserting or clearing the banner preserves hydrated DOM nodes in `@effect/ui` `patchList`.
  Trigger manual refreshes through `Command.make` calling `Query.invalidate(...)`, never bypassing `Query.Service`.
purpose: |
  Keeps content renderers flat and free of defensive "is defined" checks or nested match callbacks, guarantees
  SSR failures render a real error component (with HTTP 503) instead of collapsing into undefined/loading states,
  and preserves last-known SSR/cached data when a client refresh fails.
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
+const series = QueryResult.read(h.queries.series)
+if (QueryResult.isInitial(series)) {
+  return h.p.children("Loading…")
+}
+if (QueryResult.isFailure(series)) {
+  return QueryResult.errorPanel(h, { title: "Couldn't load analytics", cause: series.cause, onRetry })
+}
+return h.div.children(
+  series.refreshFailure === undefined
+    ? undefined
+    : QueryResult.refreshErrorBanner(h, { cause: series.refreshFailure, waiting: series.waiting, onRetry }),
+  renderChart(h, series.data, series.waiting).key("analytics-content") // `series.data` is guaranteed defined
+)
```
