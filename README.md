# effect-ui-ssr-lazy-routes

A small, strict-TypeScript reference for **[`@effect/ui`](https://github.com/Effect-TS/ui)** + **`@effect/ui-kit`** + **Tailwind CSS v4** that shows, end to end and *verifiably*:

- **Multi-page routing** with `Route.union` (+ `subset`, `printPath`) and `Router.patchSearch` (`/`, `/products?q=`, `/products/:id`, `/analytics`, `/*`).
- **Server-side rendering** with `HtmlServer.renderToHtml`, `HtmlServer.serializeState` and `Router.static`.
- **Zero-flash hydration**: the browser adopts the *exact* server DOM nodes, the server's serialized Model and its `~query` cache, for pages code-split with plain `Component.lazy` (`await preloadRoute` before `HtmlHydrate.hydrateEffect`).
- **Per-page Vite splitting**, `@effect/ui-kit` included: `Tabs`, `Collapsible` and `Dialog` ship **only** in the page chunk that uses them, never in the entry (`pnpm verify:bundles`).
- **Page-local data and writes**: `Query.Service` / `Command.Service` + `.toLayer(Effect.fnUntraced(...))` + `Component.provide`, so each page's queries, Command and Layers live in that page's chunk.
- **No entry → page waterfall** on direct visits: `<link rel="modulepreload">` for the matched route's chunks only, and a page's own `<link rel="stylesheet">` only on that page.
- **Tailwind v4** (`@tailwindcss/vite`) with a neutral light/dark palette (`prefers-color-scheme`, no JS), focus rings and `data-*` / `aria-*` variants on the kit's attributes.

| | |
|---|---|
| `@effect/ui` | `https://pkg.pr.new/Effect-TS/ui/@effect/ui@7ef6234` |
| `@effect/ui-kit` | `https://pkg.pr.new/Effect-TS/ui/@effect/ui-kit@7ef6234` (same commit) |
| `effect` | `4.1.5` |
| Tailwind CSS / `@tailwindcss/vite` | `4.3.5` |
| Vite / Vitest / TypeScript / happy-dom | `8.0.15` / `5.1.1` / `6.0.3` / `21.0.4` |
| Package manager | pnpm 12, Node ≥ 22.18 |

## Quick start

```sh
pnpm install
pnpm typecheck        # tsc --noEmit (strict; no `any`, no `@ts-ignore`)
pnpm build            # dist/client (+ .vite/manifest.json) and dist/server
pnpm verify:bundles   # prints the chunk table and proves the per-page split from the built output
pnpm test             # vitest + happy-dom: SSR, hydration, ui-kit, navigation, assets
pnpm smoke            # boots the built server, checks SSR HTML, modulepreload and stylesheet tags
pnpm start            # production server on http://localhost:3000 (PORT=… to change)
pnpm dev              # Vite middleware + the same SSR handler, with HMR (PORT=5173)
```

## The pages

| Route | Page chunk contains | `@effect/ui-kit` |
|---|---|---|
| `/` | counter | `Button` |
| `/products?q=` | `SearchProducts` query + Layer, compare list | `Input`, `Button` |
| `/products/:id` | `GetProduct` query, **`BookmarkProduct` Command**, quantity, inquiry modal | `Dialog`, `Input`, `Button` |
| `/analytics` | `GetAnalytics` query, dataset, SVG chart, **its own CSS** | `Tabs`, `Collapsible` |
| `/*` | not-found (404) | none |

`Button` and `Input` are used by several pages, so Rollup puts them in small shared chunks. `Tabs`, `Collapsible` and `Dialog` each have exactly one user, so they land in that page's chunk. `App.ts` imports no kit primitive, so the shell never pays for them.

```
src/
  routes.ts        AppRoute = Route.union({ Home, Products, ProductDetail, Analytics, NotFound })
  App.ts           root component: holds the route, picks the page, Head.titleTemplate (no page imports)
  pages.ts         the ONLY references to ./pages/*: Component.lazy(name, () => import(...)) + preloadRoute
  pages/*.ts       one component per route; each ends up in its own chunk
  queries/*.ts     Products/ProductDetail Query.Service classes + toLayer
  analytics/*      Analytics-only: GetAnalytics query, dataset, pure SVG chart, chart.css
  data/products.ts catalog shared by Products + ProductDetail (a small shared chunk)
  design.ts        Tailwind class recipes (plain strings, found by Tailwind's source scan)
  styles.css       @import "tailwindcss" + a tiny base layer (the entry's only global CSS)
  bootstrap.ts     boot(): parse URL → await preloadRoute → install guards → hydrate / mount
  client.ts        browser entry: decode #state (Schema.fromJsonString), run boot in the app scope
  prefetch.ts      scoped (Effect.acquireRelease) hover/focus prefetch + vite:preloadError reload
  render.ts        renderPage(url, assetsFor): renderToHtml + serializeState + Router.static
  assets.ts        manifest → per-route <link rel="modulepreload"> / stylesheet tags
  server.ts, serve.ts   node:http handler (immutable /assets cache + SSR) and the production entry
scripts/           verify-bundles.mjs · smoke.mjs · dev.mjs
test/              ssr · hydration · ui-kit · navigation · prefetch · assets (+ setup.ts, helpers.ts)
```

### Request lifecycle

```
GET /products/42
 └─ server: routeOf(url) → Router.static({url}) → renderToHtml(App)  (Component.lazy pages are awaited)
    └─ HTML: <head> <link stylesheet client.css> <link modulepreload ProductDetailPage.js …>
                    <script type=module src=client.js> </head>
             <body> <div id=app>…full page…</div> <script id=state>{models + ~query}</script>
 └─ browser: downloads client.js AND the page chunks in parallel (no entry → page waterfall)
    └─ client.ts → boot():
         1. route = AppRoute.parse(location)
         2. await preloadRoute(route)       ← pages[route._tag].preload(), native Component.lazy
         3. install vite:preloadError reload + link prefetch (released with the app scope)
         4. HtmlHydrate.hydrateEffect(App, Router.props, #app, state)
                                            ← adopts DOM + Model + ~query cache entries
```

## Zero-flash hydration with plain `Component.lazy`

`Component.lazy` splits a page into its own chunk. A client that hydrates *before* the module has loaded replaces the server's nodes with the fallback. Awaiting the preload first fixes that ([Effect-TS/ui#268](https://github.com/Effect-TS/ui/pull/268)), so there is no wrapper:

```ts
// src/pages.ts: the only place that mentions a page module
export const pages = {
  Products: Component.lazy("ProductsPage", () => import("./pages/ProductsPage.ts").then((m) => m.ProductsPage)),
  // …
}
export const preloadRoute = (route: AppRouteValue): Promise<void> => pages[route._tag].preload()

// src/bootstrap.ts
yield* Effect.promise(() => preloadRoute(route))          // await the matched page's chunk…
yield* HtmlHydrate.hydrateEffect(App, props, container, state) // …then hydrate: nothing is thrown away
```

The lazy name **must equal** the component's `name` (state paths look like `/App/ProductsPage[/products]`). Only the matched route's chunk is imported before hydration. `test/hydration.test.ts` has a **negative control**: hydrating *without* `await preloadRoute(route)` renders the fallback and replaces the server's `<section>`.

## Queries and Commands: `Query.Service` / `Command.Service` + `.toLayer` + `Component.provide`

Each page declares what it reads and writes, and provides the implementations itself, so they are bundled with it:

```ts
// src/analytics/GetAnalytics.ts: a page-only query, keyed by the selected tab
export class GetAnalytics extends Query.Service<GetAnalytics>()("analytics/GetAnalytics", {
  args: { metric: Metric }, success: Schema.Array(SeriesPoint), error: Schema.Never, staleTime: "5 minutes"
}) {
  static readonly layer = this.toLayer(Effect.fnUntraced(function*({ metric }) { /* fetch */ }))
}

// src/pages/ProductDetailPage.ts: a Command whose body returns the page's own message
export class BookmarkProduct extends Command.Service<BookmarkProduct>()("catalog/BookmarkProduct", {
  args: { id: Schema.String },
  success: ProductDetailPageMessage
}) {
  static readonly layer = this.toLayer(Effect.fnUntraced(function*({ id }) {
    /* write */ return ProductDetailPageMessage.CompletedBookmarkProduct({ id })
  }))
}

update: ClickedBookmark: () => $.evolve({ bookmark: "Saving" }).run(BookmarkProduct.make({ id: $.props.id }))
export const ProductDetailPage = ProductDetailPageNoDeps.pipe(
  Component.provide(Layer.mergeAll(GetProduct.layer, BookmarkProduct.layer))
)
```

What that buys, each proven by a test or by `verify:bundles`:

- **Chunking:** the service classes, Layers and fetchers live in the page's chunk; the entry contains none of their names.
- **SSR + hydration:** `renderToHtml` waits for the query and serializes the settled entry under `~query`; the client seeds its cache from it, adopts the server's nodes and the fetchers run **0** times (`catalogReads` / `analyticsReads` stay 0). Strip `~query` from the state and it fetches once, so the assertion can fail.
- **Navigation:** a page the server didn't render fetches on the client; a `?q=` change re-keys the query on the live instance (same nodes, last results stay up).

Other Effect UI practices used: `Effect.fn` for `boot`; `UiSchema.TaggedEnum` messages named for the fact (`SelectedMetricTab`, `CompletedBookmarkProduct`); `Router.patchSearch` with a `Route.subset` prop for the search box; `Head.titleTemplate`; link prefetch and the `vite:preloadError` reload guard as `Effect.acquireRelease` resources in the app scope (the guard calls `preventDefault()` only when it actually reloads); `#state` decoded with `Schema.fromJsonString`; and no `manualChunks`.

## Bundle splitting you can verify

`pnpm verify:bundles` prints the whole `dist/client/` table (entry, the 5 pages, shared chunks, CSS) and exits 1 unless:

- the **entry contains none** of the page markers, page-only query/Command names, or page-only `@effect/ui-kit` primitives (`Tabs`, `Collapsible`, `Dialog`, found by data attributes only their modules write);
- the entry reaches every page through a **dynamic `import()`** and statically imports none;
- each of the 5 pages is its **own** chunk, holds its own markers, queries, Command and kit primitives, and none of another page's (`Tabs` + `Collapsible` in Analytics, `Dialog` in ProductDetail);
- the shared catalog is in exactly one shared chunk, imported only by the two product pages;
- the entry owns exactly one stylesheet (Tailwind), and only Analytics owns a second one;
- every JS file in `assets/` is accounted for by the manifest.

Add a static `import { Tabs } from "@effect/ui-kit"` to `App.ts` and it fails with `ENTRY chunk … contains ui-kit Tabs`.

Output (hashes vary):

```
chunk               file                                    raw (B)   gzip (B)  page-only code
------------------  ------------------------------------  ---------  ---------  --------------------------------------------------------
entry               assets/client-BoLWefOZ.js                339393     115890
page:Home           assets/HomePage-CvlnUfNt.js                 964        530
page:Products       assets/ProductsPage-BXDFrb9h.js            2539       1265  SearchProducts query
page:ProductDetail  assets/ProductDetailPage-BeO8Cem2.js      22792       8510  GetProduct query, BookmarkProduct command, ui-kit Dialog
page:Analytics      assets/AnalyticsPage-B1EJyar2.js          21035       8533  GetAnalytics query, ui-kit Tabs, ui-kit Collapsible
page:NotFound       assets/NotFoundPage-CNLFcxdY.js             537        346
shared              assets/Button-1z9k8cO3.js                   592        384
shared              assets/Query-DZWRTtUp.js                  48850      16901
shared              assets/attributes-BNllm5bX.js               484        306
shared              assets/products-CN8LnZgA.js                1391        803
shared              assets/transition-J2d_4rwX.js              6680       3125
css                 assets/client-D4rk_xN-.css                15293       3794
css                 assets/AnalyticsPage-BZFaGk-P.css            91        104
```

The entry is the framework (`effect` + `@effect/ui`) plus the shell. `Query-*.js` is the `Query` runtime only the lazy pages use; Vite moved it out of the entry. Do **not** force `@effect/ui` into a vendor chunk with `manualChunks`/`advancedChunks`: framework modules only lazy pages use would then move back into the initial load.

## No entry → page waterfall

[`src/assets.ts`](src/assets.ts) reads `dist/client/.vite/manifest.json` once and, per request, emits only the matched route's chunk and its transitive static imports as `<link rel="modulepreload">`, the entry as a script tag, and the entry's and the route's CSS as `<link rel="stylesheet">`:

```
GET /products/42 → css: client.css · modulepreload: ProductDetailPage, Button, products, transition, Query …
GET /analytics   → css: client.css + AnalyticsPage.css · modulepreload: AnalyticsPage, transition, Query …
```

`pnpm smoke` checks this against the built server. In dev there is no manifest, so there is nothing to preload.

## What the tests prove

`pnpm test` (Vitest + happy-dom):

| File | Proves |
|---|---|
| `ssr.test.ts` | Each route renders full HTML (never a loading placeholder) with the right `<title>`, search/params applied, per-page state under `/App/<Page>[<path>]`, 404 for unknown URLs / product ids. |
| `hydration.test.ts` | With `await preloadRoute(route)` the client **adopts the exact server DOM nodes** (`toBe`), **the server's Model**, **never renders the fallback**, imports only the active route's module. For `Query.Service` pages the client adopts the results and fetches **0** times (once when `~query` is stripped). **Negative control:** without `preloadRoute`, the fallback renders and the server `<section>` is replaced. |
| `ui-kit.test.ts` | `Tabs`, `Collapsible`, `Dialog`, `Input`, `Button` render on the server (selected tab, closed popup), are **adopted** on hydration (same nodes, 0 refetches, 0 fallbacks, server Collapsible state adopted), and work on the hydrated DOM: switching tabs keeps the tablist nodes and loads only the series the server didn't ship, the Collapsible opens and closes, the Dialog opens, takes input, sends and closes, and `BookmarkProduct` (`Command.Service`) runs once per click and its message reaches `update`. |
| `navigation.test.ts` | Navigating to a *non-preloaded* route loads only that page's module, keeps the shell, **doesn't remount** on state, tab or `?q=` updates, fetches navigated pages' queries on the client, and the scoped hover/focus prefetch warms a chunk without changing what renders and stops when the scope closes. |
| `assets.test.ts` | `resolveRouteAssets` and the `<head>` contain `modulepreload` for **only** the active route's chunks, CSS handling, cycles, missing-manifest errors. |
| `prefetch.test.ts` | `installPreloadErrorReload` reloads and calls `preventDefault()` on the first `vite:preloadError`; when a reload just happened it does **neither**, so the real chunk error survives; its listener is released with the scope. |

`test/setup.ts` adds a tiny stand-in for the Popover API, which happy-dom lacks and the kit's top-layer `Dialog` calls.

## Gotchas this sample hit (and handles)

- **Layer lifetime.** `BrowserRouter.layer` installs the document's click/hover listeners and removes them when its layer closes. Provide the platform layers *around* the scope that keeps the app alive (`client.ts`), not inside `boot()`.
- **One copy of `effect`/`@effect/ui` per test document.** The Router keeps per-module registries; the test helpers import the libraries from the same fresh module graph as the app.
- **Component name = lazy name**, because state paths are built from it.
- **Kit primitives are code-split by use, not by config.** Import `Tabs`/`Dialog` only inside the page that draws them; the barrel `@effect/ui-kit` tree-shakes (`sideEffects: []`).
- **Tailwind scans source files**, so class recipes in `design.ts` must stay whole string literals. The per-route stylesheet (`chart.css`) is plain CSS so it keeps its own `<link>`.
- **SVG.** `h` has no SVG element builders, so the Analytics chart is a pure function that returns an SVG string, shown through `<img src="data:image/svg+xml,…">`.

## License

MIT
