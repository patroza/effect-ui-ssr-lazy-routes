# effect-ui-ssr-lazy-routes

A small, strict-TypeScript sample of **[`@effect/ui`](https://github.com/Effect-TS/ui)** that shows, end to end and *verifiably*:

- **Multi-page routing** with `Route.union` + `Router` (`/`, `/products?q=`, `/products/:id`, `/analytics`, `/*`).
- **Server-side rendering** with `HtmlServer.renderToHtml`, `HtmlServer.serializeState` and `Router.static`.
- **Client hydration with zero loader/fallback flash**: the browser adopts the *exact* server DOM nodes and the server's serialized Model state, for pages that are code-split with `Component.lazy`.
- **Per-page Vite bundle splitting** that you can check in `dist/` (`pnpm verify:bundles`).
- **No entry → page request waterfall** on direct visits: the server reads Vite's manifest and emits `<link rel="modulepreload">` for the matched route's chunk (and its imports) only.

- **Page-local data** with `Query.Service` + `.toLayer(...)` + per-page `Component.provide(...)`: each page's query service and Layer ship in that page's chunk, and the server's `~query` entries hydrate the client's cache with zero refetches.

It uses **plain `Component.lazy`**, with no wrapper. Upstream [Effect-TS/ui#263](https://github.com/Effect-TS/ui/issues/263) (hydrating a preloaded `Component.lazy`) was fixed in [#268](https://github.com/Effect-TS/ui/pull/268), which is in the pinned build, so the custom `makeLazyRoutePage` workaround this repo used to carry is gone.

| | |
|---|---|
| `@effect/ui` | `https://pkg.pr.new/Effect-TS/ui/@effect/ui@7ef6234` (includes #268) |
| `effect` | `4.1.5` |
| Vite / Vitest / TypeScript / happy-dom | `8.0.15` / `5.1.1` / `6.0.3` / `21.0.4` |
| Package manager | pnpm 12, Node ≥ 22.18 |

## Quick start

```sh
pnpm install
pnpm typecheck        # tsc --noEmit (strict; no `any`, no `@ts-ignore`)
pnpm build            # dist/client (+ .vite/manifest.json) and dist/server
pnpm verify:bundles   # proves the per-page chunk split from the built output
pnpm test             # vitest + happy-dom: SSR, hydration, navigation, assets
pnpm start            # production server on http://localhost:3000 (PORT=… to change)
pnpm smoke            # boots the built server, checks SSR HTML + modulepreload tags, stops it
pnpm dev              # Vite middleware + the same SSR handler, with HMR (PORT=5173)
```

## How it fits together

```
src/
  routes.ts        AppRoute = Route.union({ Home, Products, ProductDetail, Analytics, NotFound })
  App.ts           root component: holds the route, picks the page (no static page imports)
  pages.ts         the ONLY references to ./pages/*: native Component.lazy(name, () => import(...)),
                   plus preloadRoute(route) = Component.lazy(...).preload()
  pages/*.ts       one component per route; each ends up in its own chunk. Products and
                   ProductDetail end with Component.provide(<Query>.layer)
  queries/*.ts     page-only Query.Service classes + toLayer (SearchProducts, GetProduct)
  analytics/*      Analytics-only modules (dataset + pure SVG chart helper + CSS)
  data/products.ts catalog shared by Products + ProductDetail (a small shared chunk)
  bootstrap.ts     boot(): parse URL → await preloadRoute → install guards → hydrate / mount
  client.ts        browser entry: decode #state (Schema.fromJsonString), run boot in the app scope
  state.ts         readState(): typed decode of the serialized #state
  prefetch.ts      scoped (Effect.acquireRelease) hover/focus prefetch + vite:preloadError reload
  render.ts        renderPage(url, assetsFor): HtmlServer.renderToHtml + serializeState + Router.static
  assets.ts        manifest → per-route <link rel="modulepreload"> / stylesheet tags
  server.ts        node:http handler: /assets (immutable cache) + SSR
  serve.ts         production entry (reads dist/client/.vite/manifest.json)
scripts/
  verify-bundles.mjs   build-output proof (below)      smoke.mjs   SSR + preload smoke test
  dev.mjs              dev server
test/                    ssr · hydration · navigation · prefetch · assets
```

### Request lifecycle

```
GET /products/42
 └─ server: routeOf(url) → Router.static({url}) → renderToHtml(App)  (Component.lazy pages are awaited)
    └─ HTML: <head> <link modulepreload ProductDetailPage.js> <link modulepreload products.js>
                     <script type=module src=client.js> </head>
             <body> <div id=app>…full page…</div> <script id=state>{serialized models}</script>
 └─ browser: downloads client.js AND the page chunks in parallel (no entry → page waterfall)
    └─ client.ts → boot():
         1. route = AppRoute.parse(location)
         2. await preloadRoute(route)       ← pages[route._tag].preload(), native Component.lazy
         3. install vite:preloadError reload + link prefetch (released with the app scope)
         4. HtmlHydrate.hydrateEffect(App, Router.props, #app, state)
                                            ← adopts DOM + Model + ~query cache entries
```

## Zero-flash hydration with plain `Component.lazy`

`Component.lazy` splits a page into its own chunk, and its documented limitation is that a client which hydrates *before* the module has loaded replaces the server's nodes with the fallback, then with the page. Awaiting `Component.lazy(...).preload()` before hydrating used to make it worse, not better ([#263](https://github.com/Effect-TS/ui/issues/263): the runtime read `.model.ast` off the lazy wrapper and threw, discarding the server DOM). [#268](https://github.com/Effect-TS/ui/pull/268) fixed that, so the pattern is now just:

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

- `App` calls `pages.Products(h, { key, props, fallback })` exactly as it would call the real component.
- Link hover/focus prefetch calls the same `preloadRoute(route)` ([`src/prefetch.ts`](src/prefetch.ts)).
- The lazy name **must equal** the component's `name` (state paths look like `/App/ProductsPage[/products]`).
- Only the matched route's chunk is imported before hydration; other pages load on demand (the tests observe the real `import()` through a mock factory, see `loadedPages` in [`test/helpers.ts`](test/helpers.ts)).
- Server and browser each have their own module graph; the tests load a fresh one per side (`loadApp()`).

`test/hydration.test.ts` has a **negative control**: native `Component.lazy` hydrated *without* `await preloadRoute(route)` renders the fallback and replaces the server's `<section>`. That is why `boot` awaits the preload first.

## Page-local queries: `Query.Service` + `.toLayer` + `Component.provide`

Products and ProductDetail load their data with a `Query.Service` that only they import ([`src/queries/`](src/queries)):

```ts
export class GetProduct extends Query.Service<GetProduct>()("catalog/GetProduct", {
  args: { id: Schema.String },
  success: Schema.Option(Product),
  error: Schema.Never,
  staleTime: "5 minutes"
}) {
  static readonly layer = this.toLayer(Effect.fnUntraced(function*({ id }) { /* fetch */ }))
}

// the component declares it…
queries: { product: { query: GetProduct, args: ({ props }) => ({ id: props.id }) } }
// …and the page provides its own Layer, so the Layer is bundled with the page:
export const ProductDetailPage = ProductDetailPageNoDeps.pipe(Component.provide(GetProduct.layer))
```

(The same shape as `SearchPage.ts` / `ProductPage.ts` in Tim Smart's bunnings-lite.) What that buys, each proven by a test or by `verify:bundles`:

- **Chunking:** the query class, its Layer and its fetcher live in the page's chunk; the entry contains neither the page markers nor the query names (`catalog/SearchProducts`, `catalog/GetProduct`).
- **SSR:** `renderToHtml` waits for the query, renders the data, and serializes the settled entry under `~query` (and the page's `queries`).
- **Hydration:** `HtmlHydrate` seeds the client cache from `~query`, so the page adopts the server's `<ul>`/`<li>`/`<h1>` nodes and the client's fetcher runs **0** times (`catalogReads` stays 0). Drop `~query` from the state and it fetches once, which shows the assertion can fail.
- **Navigation:** a page the server didn't render fetches on the client as usual, and a `?q=` change just changes the query's args on the live instance (same nodes; the last results stay up while the next load).

Other practices from the latest Effect UI: events use `.on("click", …)` / `.on("input", …)` (the `on*` sugar is gone, [#227](https://github.com/Effect-TS/ui/pull/227)); `boot` is an `Effect.fn`; the link prefetch and the `vite:preloadError` reload guard are `Effect.acquireRelease` resources inside the app scope (the reload guard is installed after the initial preload and calls `preventDefault()` only when it actually reloads, so a skipped reload keeps the real chunk error); `#state` is decoded with `Schema.fromJsonString` instead of a raw `JSON.parse`.

## Bundle splitting you can verify

`pnpm verify:bundles` reads `dist/client/.vite/manifest.json` and `dist/client/assets/*.js` and fails (exit 1) unless:

- the **entry chunk contains none** of the page markers (each page/module exports a unique `SENTINEL:*` string that is rendered as a `data-*` attribute, so it survives minification and tree-shaking);
- the entry reaches every page through a **dynamic `import()`** and statically imports none;
- each of the 5 pages is its **own** JS chunk, containing its own marker and no other page's;
- Analytics' private modules (`analytics/dataset.ts`, `analytics/chart.ts` + CSS) are inside the Analytics chunk and nowhere else;
- each page-only query (`catalog/SearchProducts`, `catalog/GetProduct`, with its marker and `Component.provide`d Layer) is in its page's chunk, in no other page's chunk and **not in the entry**;
- the shared catalog (`data/products.ts`) is in exactly one shared chunk, imported only by the two product pages;
- every JS file in `assets/` is accounted for by the manifest.

Add a static `import "./pages/HomePage.ts"` anywhere in the client graph and it fails with, e.g., `ENTRY chunk … contains page marker SENTINEL:home-page`.

Expected output (hashes vary):

```
chunk               file                                    raw (B)   gzip (B)
------------------  ------------------------------------  ---------  ---------
entry               assets/client-B4evBoDI.js                332014     113377
page:Home           assets/HomePage-BopvVsSk.js                  772        466
page:Products       assets/ProductsPage-D96gmJZ5.js             2235       1109
page:ProductDetail  assets/ProductDetailPage-D3Or26rS.js        1932        974
page:Analytics      assets/AnalyticsPage-Dh41jQsp.js            2423       1239
page:NotFound       assets/NotFoundPage-BJ6HgwZE.js              453        314
shared              assets/products-Buhh2iKZ.js                49675      17381
css                 assets/client-BKq9j6xQ.css                   246        198
css                 assets/AnalyticsPage-Ddd3rpWK.css            102        112
```

The entry is the framework (`effect` + `@effect/ui`). The `shared` chunk (`products-*.js`) is imported by exactly Products and ProductDetail: the catalog plus the `Query` runtime that only those two lazy pages use, which Vite moved out of the entry. The page chunks are small because they import the rest from the entry chunk. Do **not** force `@effect/ui` into a vendor chunk with `manualChunks`/`advancedChunks`: its own docs warn that framework modules only lazy pages use then move back into the initial load.

## No entry → page waterfall

`Component.lazy`'s docs list this limitation: *"Nothing preloads the chunk of a lazy page that a link opens directly: the entry chunk loads, then the page's."* [`src/assets.ts`](src/assets.ts) removes it for direct visits. `pnpm start` reads `dist/client/.vite/manifest.json` once, and for each request:

```
GET /products/42 → <link rel="modulepreload" href="/assets/ProductDetailPage-….js">
                   <link rel="modulepreload" href="/assets/products-….js">      (shared import)
                   <script type="module" src="/assets/client-….js">              (entry, in <head>)
GET /analytics   → <link rel="stylesheet" href="/assets/AnalyticsPage-….css"> + its chunk
```

Only the matched route's chunk and its transitive static imports are preloaded (the entry is loaded by its script tag, never preloaded twice). CSS from the entry and from the route's chunks becomes `<link rel="stylesheet">`. In dev there is no manifest, so there is nothing to preload.

## What the tests prove

`pnpm test` (Vitest + happy-dom, 43 tests):

| File | Proves |
|---|---|
| `ssr.test.ts` | Each route renders full HTML (never a loading placeholder) with the right `<title>`, search/params applied, per-page serialized state under `/App/<Page>[<path>]`, 404 for unknown URLs / product ids. |
| `hydration.test.ts` | With native `Component.lazy` and `await preloadRoute(route)`, the client **adopts the exact server DOM nodes** (`toBe` on `section`, `input`, `ul`, `li`, `a`, `button`, `header`), **adopts the server's Model**, **never renders the fallback** (a `MutationObserver` plus a counter), imports only the active route's page module, and hydrates NotFound. For `Query.Service` pages, the server's state carries `~query`, the client adopts the results nodes, and the client fetcher runs **0** times (and once when `~query` is stripped). **Negative control:** without `preloadRoute`, the fallback renders and the server `<section>` is replaced. |
| `navigation.test.ts` | Navigation to a *non-preloaded* route loads only that page's module, keeps the shell, **doesn't remount** on state or `?q=` updates (same nodes, Model survives, query re-keyed by args), works back to the server-rendered page, fetches a navigated Query page on the client, and the scoped hover/focus prefetch warms the chunk without changing what renders (then navigation shows no fallback) and stops when the scope closes. |
| `assets.test.ts` | `resolveRouteAssets` and the rendered `<head>` contain `modulepreload` for **only** the active route's chunk (+ its imports), never the entry or another page; CSS handling; cycles; missing-manifest errors. |
| `prefetch.test.ts` | `installPreloadErrorReload`: reloads and calls `preventDefault()` on the first `vite:preloadError`; when a reload just happened it does **neither**, so the real chunk error survives; its listener is released with the scope. |


## Gotchas this sample hit (and handles)

- **Layer lifetime.** `BrowserRouter.layer` installs the document's click/hover listeners and removes them when its layer closes. Provide the platform layers *around* the scope that keeps the app alive (`Effect.provide(...)` after `Effect.scoped(... Effect.never)` in `client.ts`), not inside `boot()`, or link interception silently stops after boot.
- **One copy of `effect`/`@effect/ui` per test document.** The Router keeps per-module registries; the test helpers import the libraries from the same fresh module graph as the app.
- **Component name = lazy name.** The page's `Html.component({ name })` is what `Component.lazy(name, …)` must be called, because state paths are built from it.
- **SVG.** `h` has no SVG element builders, so the Analytics chart is a pure function that returns an SVG string, shown through `<img src="data:image/svg+xml,…">`: identical on server and client, so there is nothing to mismatch.
- **Pages stay out of the entry.** Never import `./pages/*` statically. `scripts/verify-bundles.mjs` is the guard.

## License

MIT
