# effect-ui-ssr-lazy-routes

A small, strict-TypeScript reference for **[`@effect/ui`](https://github.com/Effect-TS/ui)** + **`@effect/ui-kit`** + **Tailwind CSS v4** that shows, end to end and _verifiably_:

- **Multi-page routing** with `Route.union` (+ `subset`, `printPath`) and `Router.patchSearch` (`/`, `/products?q=`, `/products/:id`, `/analytics`, `/*`).
- **Server-side rendering** with `HtmlServer.renderToHtml`, `HtmlServer.serializeState` and `Router.static`.
- **Zero-flash hydration**: the browser adopts the _exact_ server DOM nodes, the server's serialized Model and its `~query` cache, for pages code-split with plain `Component.lazy` (`await preloadRoute` before `HtmlHydrate.hydrateEffect`).
- **Per-page Vite splitting**, `@effect/ui-kit` included: `Tabs`, `Collapsible` and `Dialog` ship **only** in the page chunk that uses them, never in the entry (`pnpm verify:bundles`).
- **Page-local data and writes**: `Query.Service` / `Command.Service` + `.toLayer(Effect.fnUntraced(...))` + `Component.provide`, so each page's queries, Command and Layers live in that page's chunk.
- **No entry → page waterfall** on direct visits: `<link rel="modulepreload">` for the matched route's chunks only, and a page's own `<link rel="stylesheet">` only on that page.
- **Tailwind v4** (`@tailwindcss/vite`) with a neutral light/dark palette (`prefers-color-scheme`, no JS), focus rings and `data-*` / `aria-*` variants on the kit's attributes.

|                                        |                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `@effect/ui`                           | `https://pkg.pr.new/Effect-TS/ui/@effect/ui@7ef6234`                   |
| `@effect/ui-kit`                       | `https://pkg.pr.new/Effect-TS/ui/@effect/ui-kit@7ef6234` (same commit) |
| `effect`                               | `4.1.5`                                                                |
| Tailwind CSS / `@tailwindcss/vite`     | `4.3.5`                                                                |
| Vite / Vitest / TypeScript / happy-dom | `8.0.15` / `5.1.1` / `6.0.3` / `21.0.4`                                |
| Package manager                        | pnpm 12, Node ≥ 22.18                                                  |
| `@effect/tsgo`                         | `0.73.7`                                                               |
| `@effect/language-service`             | `0.87.5`                                                               |
| `tsrs`                                 | `7.1.0-beta.tsrs5`                                                     |
| `oxlint`                               | `1.95.0`                                                               |
| `oxfmt`                                | `0.80.0`                                                               |

## Quick start

```sh
pnpm install
pnpm typecheck        # tsrs --noEmit with the Effect language service (strict; no `any`, no `@ts-ignore`)
pnpm lint             # type-aware oxlint + embedded effecttsgo/* diagnostics, warnings denied
pnpm format:check     # oxfmt --check (pnpm format writes)
pnpm check            # typecheck + lint + format:check + build + verify:bundles + test + smoke
pnpm build            # dist/client (+ .vite/manifest.json) and dist/server
pnpm verify:bundles   # prints the chunk table and proves the per-page split from the built output
pnpm test             # vitest + happy-dom: SSR, hydration, ui-kit, navigation, assets, HTTP server
pnpm smoke            # boots the built server, checks SSR HTML, modulepreload fetches, stylesheets, bad URLs
pnpm start            # production server on http://localhost:3000 (PORT=… to change)
pnpm dev              # Vite middleware + the same SSR handler, with HMR (PORT=5173)
```

## Toolchain

| Command          | Runs                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm typecheck` | `node scripts/tsrs.mjs --noEmit`: `effect-tsgo tsrs@<pin>` (`tsrs`, with `@effect/language-service`) |
| `pnpm lint`      | `node scripts/oxlint.mjs --type-aware .`: `effect-tsgo --tsrs-lint=<pin> oxlint`                     |
| `pnpm lint:fix`  | the same with `--fix`, then `pnpm format`                                                            |
| `pnpm format`    | `oxfmt .` (`pnpm format:check` is the read-only CI variant)                                          |
| `pnpm check`     | all of the above, then build, bundle verification, tests and the smoke test                          |

- **Effect diagnostics fail the build.** `tsconfig.plugins.json` holds the `@effect/language-service` severity table (every rule `"error"`;
  `unstableApiUsage` and `experimentalApiUsage` are `"off"` because `@effect/ui` is `@stability experimental`). `scripts/oxlint.mjs` derives
  every enabled rule as an `effecttsgo/*` oxlint rule into the git-ignored `.oxlintrc.effect.generated.json`
  and fails closed if none are enabled. Of the 154 rules, **99 are enabled as errors** and the other **55 are off** (rules the schema
  ships disabled, plus the two experimental-API rules above). So the same diagnostics run in `pnpm typecheck` and inside `pnpm lint`.
- **Strict oxlint.** `.oxlintrc.json` extends `@effect-app/eslint-shared-config` plus `config/oxlint.strict.json`
  (no `any`, no non-null assertions, no unsafe assertions, no `any` flowing anywhere, `@ts-ignore`/`@ts-nocheck` banned) with
  `typeAware` and `denyWarnings`.
- **Imports.** Barrel imports for the libraries: `import { Effect, Schema } from "effect"`, `import { Component, Router } from "@effect/ui"`,
  `import { Button } from "@effect/ui-kit"` (submodule paths such as `effect/http`, `effect/reactivity` and `@effect/ui/html` for what the
  barrel doesn't carry). Every **local** module is a namespace import, `import * as Routes from "./routes.ts"`, never a named one; the
  tree-shaking that keeps page code out of the entry comes from the bundler, not from the import style.
- **Scripts are type-checked too.** `scripts/*.ts` run natively on Node's type stripping; the `scripts/lib/*.mjs` toolchain wrappers are
  checked through JSDoc (`allowJs` + `checkJs`).

## The pages

| Route           | Page chunk contains                                                        | `@effect/ui-kit`            |
| --------------- | -------------------------------------------------------------------------- | --------------------------- |
| `/`             | counter                                                                    | `Button`                    |
| `/products?q=`  | `SearchProducts` query + Layer, compare list                               | `Input`, `Button`           |
| `/products/:id` | `GetProduct` query, **`BookmarkProduct` Command**, quantity, inquiry modal | `Dialog`, `Input`, `Button` |
| `/analytics`    | `GetAnalytics` query, dataset, SVG chart, **its own CSS**                  | `Tabs`, `Collapsible`       |
| `/*`            | not-found (404)                                                            | none                        |

`Button` and `Input` are used by several pages, so Rollup puts them in small shared chunks: `Button` in its own `Button-*.js`, `Input` in the `Product-*.js` chunk next to the catalog (only Products and ProductDetail use it). `Tabs`, `Collapsible` and `Dialog` each have exactly one user, so they land in that page's chunk. `App.ts` and `Shell.ts` import no kit primitive, so the shell never pays for them.

```
src/
  main.ts                  browser entry: decode #state (`JsonString.jsonString`; unreadable → warn + mount fresh), run boot in the app scope
  index.css                @import "tailwindcss" + a tiny base layer (the entry's only global CSS)
  App.ts                   root component: holds the route, Head.titleTemplate, Router subscription; delegates the layout to Shell
  Shell.ts                 layout: primary nav + the lazy page outlet (a plain view function, so state paths stay `/App/<page>[<path>]`)
  routes.ts                AppRoute = Route.union({ Home, Products, ProductDetail, Analytics, NotFound }) + routeOf(url)
  pages.ts                 the ONLY references to ./pages/*: Component.lazy(name, () => import(...)) + preloadRoute
  pages/                   one component per route; each ends up in its own chunk
    HomePage.ts · NotFoundPage.ts · ProductsPage.ts · AnalyticsPage.ts
    product/ProductDetailPage.ts   also holds the BookmarkProduct command and the inquiry Dialog
  product/
    domain/Product.ts      Product schema + catalog + find/format helpers, shared by Products + ProductDetail (a small shared chunk)
    queries/GetProduct.ts  ProductDetail Query.Service + toLayer
  search/
    queries/SearchProducts.ts   Products Query.Service + toLayer
  analytics/               Analytics-only
    domain/Analytics.ts    dataset + metric types
    queries/GetAnalytics.ts
    components/Chart.ts    pure SVG chart (+ chart.css, the only page-specific stylesheet)
  browser/
    bootstrap.ts           boot(): resolve URL → await preloadRoute → install guards → hydrate / mount
    prefetch.ts            scoped (Effect.acquireRelease) hover/focus prefetch + vite:preloadError reload
    state.ts               #state decoding
  design/
    classes.ts             Tailwind class recipes (plain strings, found by Tailwind's source scan)
    loading.ts             pageFallback for lazy pages
  lib/
    jsonString.ts          the central Schema.fromJsonString(Schema.toCodecJson(...))
    status.ts              the `data-http-status="404"` marker a page sets when its record is missing; the server reads it back
  server/
    assets.ts              manifest → per-route <link rel="modulepreload"> / stylesheet tags
    render.ts              renderPage(url, assetsFor) → Page | Redirect | BadRequest (AppRoute.resolve first, like HtmlServerHttp)
    handler.ts             node:http handler (static files, redirects, 400/405, security headers, SSR)
    serve.ts               production server entry
config/            oxlint.strict.json (the strict type-aware rules .oxlintrc.json extends)
scripts/           verify-bundles.ts · smoke.ts · dev.ts
test/              ssr · hydration · ui-kit · navigation · prefetch · assets · server · pages · chart (+ setup.ts, helpers.ts)
```

### Request lifecycle

```
GET /products/42
 └─ server: AppRoute.resolve(url)  → undecodable: 400 · non-canonical: 301/302 to AppRoute.print(route)
    └─ Router.static({url}) → renderToHtml(App)  (Component.lazy pages are awaited)
    └─ HTML: <head> <link stylesheet main.css> <link modulepreload ProductDetailPage.js …>
                    <script type=module src=main.js> </head>
             <body> <div id=app>…full page…</div> <script id=state>{models + ~query}</script>
 └─ browser: downloads main.js AND the page chunks in parallel (no entry → page waterfall)
    └─ main.ts → boot():
         1. route = routeOf(location)       ← the same AppRoute.resolve the server used
         2. await preloadRoute(route)       ← pages[route._tag].preload(), native Component.lazy
         3. install vite:preloadError reload + link prefetch (released with the app scope)
         4. HtmlHydrate.hydrateEffect(App, Router.props, #app, state)
                                            ← adopts DOM + Model + ~query cache entries
```

## Zero-flash hydration with plain `Component.lazy`

`Component.lazy` splits a page into its own chunk. A client that hydrates _before_ the module has loaded replaces the server's nodes with the fallback. Awaiting the preload first fixes that ([Effect-TS/ui#268](https://github.com/Effect-TS/ui/pull/268)), so there is no wrapper:

```ts
// src/pages.ts: the only place that mentions a page module
export const pages = {
  Products: Component.lazy("ProductsPage", () => import("./pages/ProductsPage.ts").then((m) => m.ProductsPage))
  // …
}
export const preloadRoute = (route: AppRouteValue): Promise<void> => pages[route._tag].preload()

// src/browser/bootstrap.ts, inside Effect.fn("boot")(function* (options) { … })
yield * Effect.promise(() => Pages.preloadRoute(route)) // await the matched page's chunk…
yield * HtmlHydrate.hydrateEffect(App.App, props, options.container, options.state) // …then hydrate: nothing is thrown away
```

The lazy name **must equal** the component's `name` (state paths look like `/App/ProductsPage[/products]`). Only the matched route's chunk is imported before hydration. `test/hydration.test.ts` has a **negative control**: hydrating _without_ `await preloadRoute(route)` renders the fallback and replaces the server's `<section>`.

## Queries and Commands: `Query.Service` / `Command.Service` + `.toLayer` + `Component.provide`

Each page declares what it reads and writes, and provides the implementations itself, so they are bundled with it:

```ts
// src/analytics/queries/GetAnalytics.ts: a page-only query, keyed by the selected tab
export class GetAnalytics extends Query.Service<GetAnalytics>()("analytics/GetAnalytics", {
  args: { metric: Metric },
  success: Schema.Array(SeriesPoint),
  error: Schema.Never,
  staleTime: "5 minutes"
}) {
  static readonly layer = this.toLayer(
    Effect.fnUntraced(function* ({ metric }) {
      /* fetch */
    })
  )
}

// src/pages/product/ProductDetailPage.ts: a Command whose body returns the page's own message
export class BookmarkProduct extends Command.Service<BookmarkProduct>()("catalog/BookmarkProduct", {
  args: { id: Schema.String },
  success: ProductDetailPageMessage
}) {
  static readonly layer = this.toLayer(
    Effect.fnUntraced(function* ({ id }) {
      /* write */ return ProductDetailPageMessage.CompletedBookmarkProduct({ id })
    })
  )
}

// in the page's `update`:
//   ClickedBookmark: () => $.evolve({ bookmark: "Saving" as const }).run(BookmarkProduct.make({ id: $.props.id }))
export const ProductDetailPage = ProductDetailPageNoDeps.pipe(
  Component.provide(Layer.mergeAll(GetProduct.layer, BookmarkProduct.layer))
)
```

What that buys, each proven by a test or by `verify:bundles`:

- **Chunking:** the service classes, Layers and fetchers live in the page's chunk; the entry contains none of their names.
- **SSR + hydration:** `renderToHtml` waits for the query and serializes the settled entry under `~query`; the client seeds its cache from it, adopts the server's nodes and the fetchers run **0** times (`catalogReads` / `analyticsReads` stay 0). Strip `~query` from the state and it fetches once, so the assertion can fail.
- **Navigation:** a page the server didn't render fetches on the client; a `?q=` change re-keys the query on the live instance (same nodes, last results stay up).

Other Effect UI practices used: `Effect.fn` for `boot`; `UiSchema.TaggedEnum` messages named for the fact (`SelectedMetricTab`, `CompletedBookmarkProduct`); `Router.patchSearch` with a `Route.subset` prop for the search box, whose query is `debounce: "300 millis"` so typing doesn't fetch per keystroke (the first fetch is immediate); `Head.titleTemplate`; link prefetch and the `vite:preloadError` reload guard as `Effect.acquireRelease` resources in the app scope (the guard calls `preventDefault()` only when it actually reloads); `#state` decoded with `JsonString.jsonString` (`Schema.fromJsonString` over `Schema.toCodecJson`); and no `manualChunks`.

## Bundle splitting you can verify

`pnpm verify:bundles` prints the whole `dist/client/` table (entry, the 5 pages, shared chunks, CSS) and exits 1 unless:

- the **entry contains none** of the page markers, page-only query/Command names, or page-only `@effect/ui-kit` primitives (`Tabs`, `Collapsible`, `Dialog`, found by data attributes only their modules write);
- the entry reaches every page through a **dynamic `import()`** and statically imports none;
- the **`Query.Service` runtime** (`Query-*.js`) and the kit's `Button` and `Input` exist in the build but in no chunk the entry holds or statically imports;
- each of the 5 pages is its **own** chunk, holds its own markers, queries, Command and kit primitives, and none of another page's (`Tabs` + `Collapsible` in Analytics, `Dialog` in ProductDetail);
- every page-only needle is found in **every** chunk of the build (shared chunks included) and that set is exactly its owner's chunk;
- the shared catalog is in exactly one shared chunk, reached (through static imports, transitively) by the two product pages and by no other page or the entry;
- the entry owns exactly one stylesheet (Tailwind), and only Analytics owns a second one;
- every JS file in `assets/` is accounted for by the manifest.

Use `Tabs` in `App.ts` (an import that is never used is tree-shaken away, so it has to be rendered) and it fails with `ENTRY chunk … contains ui-kit Tabs`.

Output (hashes vary):

```
chunk               file                                    raw (B)   gzip (B)  page-only code
------------------  ------------------------------------  ---------  ---------  --------------------------------------------------------
entry               assets/main-DyRak2pn.js                  339706     116007
page:Home           assets/HomePage-BSJ7cEQu.js                 962        529
page:Products       assets/ProductsPage-CIQVzm5S.js            2503       1258  SearchProducts query
page:ProductDetail  assets/ProductDetailPage-dUwd_IX5.js      22942       8586  GetProduct query, BookmarkProduct command, ui-kit Dialog
page:Analytics      assets/AnalyticsPage-BIclMgvt.js          21180       8592  GetAnalytics query, ui-kit Tabs, ui-kit Collapsible
page:NotFound       assets/NotFoundPage-CzezMf1d.js             535        345
shared              assets/Button-1z9k8cO3.js                   592        384
shared              assets/Query-BhrKsXTY.js                  48834      16892
shared              assets/attributes-BNllm5bX.js               484        306
shared              assets/Product-DPTrVTJF.js                 1389        801
shared              assets/transition-C-8_3fTo.js              6678       3128
css                 assets/main-B7Z2OTFH.css                  15335       3807
css                 assets/AnalyticsPage-BZFaGk-P.css            91        104
```

The entry is the framework (`effect` + `@effect/ui`) plus the shell. `Query-*.js` is the `Query` runtime only the lazy pages use; Vite moved it out of the entry. Do **not** force `@effect/ui` into a vendor chunk with `manualChunks`/`advancedChunks`: framework modules only lazy pages use would then move back into the initial load.

## No entry → page waterfall

[`src/server/assets.ts`](src/server/assets.ts) reads `dist/client/.vite/manifest.json` once and, per request, emits only the matched route's chunk and its transitive static imports as `<link rel="modulepreload">`, the entry as a script tag, and the entry's and the route's CSS as `<link rel="stylesheet">`:

```
GET /products/42 → css: main.css · modulepreload: ProductDetailPage, Button, Product, transition, Query …
GET /analytics   → css: main.css + AnalyticsPage.css · modulepreload: AnalyticsPage, transition, Query …
```

`pnpm smoke` checks this against the built server: it fetches every `<link rel="modulepreload">` and requires `200`, `text/javascript` and `immutable`. In dev there is no manifest, so there is nothing to preload, and Vite delivers the CSS through the JavaScript modules, so an unstyled flash before the entry runs is expected in dev (production links the stylesheets in `<head>`).

## HTTP behaviour

`src/server/handler.ts` is a plain `node:http` handler. [`test/server.test.ts`](test/server.test.ts) drives it against a temporary client directory.

- **URLs** are resolved with `AppRoute.resolve` first, as `HtmlServerHttp.layerHttp` does: an undecodable URL (`/%E0%A4%A`) is `400`; a non-canonical one is a permanent `301` (`/products/` → `/products`), or a temporary `302` when search params were dropped as invalid (`/products?q=a&q=b` → `/products`), with `Location: AppRoute.print(route)`.
- **Status** is `404` for the catch-all route and for a page that rendered a missing record (an unknown product marks its root with `data-http-status="404"`), so it cannot drift from what the document shows.
- **Static files** come from `dist/client` only: `..` segments, malformed escapes and any dotfile segment (`/.vite/manifest.json`, in any letter case) are never served. `/assets/*` is `immutable`; files stream through `stream.pipeline`, so a file that vanishes mid-request never raises an unhandled stream error.
- **Methods:** `GET` and `HEAD` only (`405` otherwise). `HEAD` carries the GET's real `content-length` and no body.
- **Headers:** `x-content-type-options: nosniff` always. The production server (the one with a `clientDir`) also sends `content-security-policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:`. The dev server doesn't, because Vite's HMR client and injected styles need more.
- **Errors never show internals:** a failed query renders a plain message, not `Cause.pretty`.

## What the tests prove

`pnpm test` (Vitest + happy-dom):

| File                 | Proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ssr.test.ts`        | Each route renders full HTML (never a loading placeholder) with the right `<title>`, search/params applied, per-page state under `/App/<Page>[<path>]` (the NotFound page's too), 404 for unknown URLs / product ids derived from the rendered page, and the `Page` / `Redirect` / `BadRequest` outcomes of `renderPage`.                                                                                                                                                                                              |
| `hydration.test.ts`  | With `await preloadRoute(route)` the client **adopts the exact server DOM nodes** (`toBe`), **the server's Model**, **never renders the fallback**, imports only the active route's module. For `Query.Service` pages the client adopts the results and fetches **0** times (once when `~query` is stripped). **Negative control:** without `preloadRoute`, the fallback renders and the server `<section>` is replaced.                                                                                               |
| `ui-kit.test.ts`     | `Tabs`, `Collapsible`, `Dialog`, `Input`, `Button` render on the server (selected tab, closed popup), are **adopted** on hydration (same nodes, 0 refetches, 0 fallbacks, server Collapsible state adopted), and work on the hydrated DOM: switching tabs keeps the tablist nodes and loads only the series the server didn't ship, the Collapsible opens and closes, the Dialog opens, takes input, sends and closes, and `BookmarkProduct` (`Command.Service`) runs once per click and its message reaches `update`. |
| `navigation.test.ts` | Navigating to a _non-preloaded_ route loads only that page's module, keeps the shell, **doesn't remount** on state, tab or `?q=` updates, fetches navigated pages' queries on the client, and the scoped hover/focus prefetch warms a chunk without changing what renders, ignores `target` / `download` / cross-origin links, and stops when the scope closes.                                                                                                                                                        |
| `server.test.ts`     | The HTTP handler against a temporary `clientDir`: immutable static assets, path traversal (`/../`, `%2e%2e`, `..%2f`) and dotfiles (`/.vite/…`, any case) never served, malformed `%` is `400` (never `500`), `405` on `POST`, `HEAD` has the GET's `content-length` and no body, `301`/`302` canonical redirects, the 404 status for an unknown product, security headers (CSP only on the production handler).                                                                                                       |
| `pages.test.ts`      | Every `pages[tag]` has a lazy name equal to the loaded component's `definition.name` (state paths depend on it).                                                                                                                                                                                                                                                                                                                                                                                                       |
| `chart.test.ts`      | `escapeXml` and that a `&` / `<` in the chart's title or labels keeps the SVG well-formed XML.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `assets.test.ts`     | `resolveRouteAssets` and the `<head>` contain `modulepreload` for **only** the active route's chunks, CSS handling, cycles, missing-manifest errors.                                                                                                                                                                                                                                                                                                                                                                   |
| `prefetch.test.ts`   | `installPreloadErrorReload` reloads and calls `preventDefault()` on the first `vite:preloadError`; when a reload just happened it does **neither**, so the real chunk error survives; it still reloads when `sessionStorage` throws, and its listener is released with the scope.                                                                                                                                                                                                                                      |

`test/setup.ts` adds a tiny stand-in for the Popover API, which happy-dom lacks and the kit's top-layer `Dialog` calls.

## Gotchas this sample hit (and handles)

- **Layer lifetime.** `BrowserRouter.layer` installs the document's click/hover listeners and removes them when its layer closes. Provide the platform layers _around_ the scope that keeps the app alive (`client.ts`), not inside `boot()`.
- **One copy of `effect`/`@effect/ui` per test document.** The Router keeps per-module registries; the test helpers import the libraries from the same fresh module graph as the app.
- **Component name = lazy name**, because state paths are built from it.
- **Kit primitives are code-split by use, not by config.** Import `Tabs`/`Dialog` only inside the page that draws them; the barrel `@effect/ui-kit` tree-shakes (`sideEffects: []`).
- **Tailwind scans source files**, so class recipes in `design/classes.ts` must stay whole string literals. The per-route stylesheet (`chart.css`) is plain CSS so it keeps its own `<link>`.
- **SVG.** `h` has no SVG element builders, so the Analytics chart is a pure function that returns an SVG string, shown through `<img src="data:image/svg+xml,…">`.

## License

MIT
