# effect-ui-ssr-lazy-routes

A small, strict-TypeScript sample of **[`@effect/ui`](https://github.com/Effect-TS/ui)** that shows, end to end and *verifiably*:

- **Multi-page routing** with `Route.union` + `Router` (`/`, `/products?q=`, `/products/:id`, `/analytics`, `/*`).
- **Server-side rendering** with `HtmlServer.renderToHtml`, `HtmlServer.serializeState` and `Router.static`.
- **Client hydration with zero loader/fallback flash**: the browser adopts the *exact* server DOM nodes and the server's serialized Model state, for pages that are code-split with `Component.lazy`.
- **Per-page Vite bundle splitting** that you can check in `dist/` (`pnpm verify:bundles`).
- **No entry → page request waterfall** on direct visits: the server reads Vite's manifest and emits `<link rel="modulepreload">` for the matched route's chunk (and its imports) only.

It works around upstream [Effect-TS/ui#263](https://github.com/Effect-TS/ui/issues/263) (hydrating an unloaded `Component.lazy`), and says exactly how it simplifies once that lands.

| | |
|---|---|
| `@effect/ui` | `https://pkg.pr.new/Effect-TS/ui/@effect/ui@43cd8fe` |
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
  lazyPage.ts      makeLazyRoutePage(name, load): the #263 workaround (see below)
  pages.ts         the ONLY references to ./pages/*: dynamic import() only
  pages/*.ts       one component per route; each ends up in its own chunk
  analytics/*      Analytics-only modules (dataset + pure SVG chart helper + CSS)
  data/products.ts catalog shared by Products + ProductDetail (a small shared chunk)
  bootstrap.ts     boot(): parse URL → await chunk of the matched route → hydrate / mount
  client.ts        browser entry: vite:preloadError reload, link prefetch, boot
  prefetch.ts      hover/focus prefetch + preloadError handler
  render.ts        renderPage(url, assetsFor): HtmlServer.renderToHtml + serializeState + Router.static
  assets.ts        manifest → per-route <link rel="modulepreload"> / stylesheet tags
  server.ts        node:http handler: /assets (immutable cache) + SSR
  serve.ts         production entry (reads dist/client/.vite/manifest.json)
scripts/
  verify-bundles.mjs   build-output proof (below)      smoke.mjs   SSR + preload smoke test
  dev.mjs              dev server
test/                    ssr · hydration · navigation · assets · lazyPage
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
         2. await pages[route._tag].preloadInitial()      ← real Component, cached
         3. HtmlHydrate.hydrateEffect(App, Router.props, #app, state)   ← adopts DOM + Model
```

## Zero-flash hydration and the #263 workaround

`Component.lazy` is great for splitting, but its documented limitation is:

> The client doesn't load the module before it hydrates, so it replaces the server's nodes with the fallback, then with the page once the module has loaded.

and in practice ([#263](https://github.com/Effect-TS/ui/issues/263)) `HtmlHydrate` decodes each child's serialized state with the child's **component**. A not-yet-loaded `Component.lazy` has no Model schema, so `stateCodecOf(lazy)` throws `TypeError: Cannot read properties of undefined (reading 'ast')`, the server's page DOM is dropped and rebuilt, and the user sees the fallback. `test/hydration.test.ts` keeps a **canary test** that reproduces exactly this.

**The workaround is `makeLazyRoutePage(name, load)` in [`src/lazyPage.ts`](src/lazyPage.ts):**

| | |
|---|---|
| `preloadInitial()` | `await import()` of the page and keep the **real `Component`**. `boot()` calls it for the matched route *before* `HtmlHydrate.hydrateEffect`, so hydration receives the real component and adopts the server DOM and serialized Model directly. No fallback ever renders. |
| `prefetch()` | `Component.lazy(...).preload()`, called when the pointer enters or keyboard focus lands on an internal link ([`src/prefetch.ts`](src/prefetch.ts)). It warms the module cache only and never changes which component `render` uses. |
| `render(h, options)` | Same signature as calling a component. Uses the preloaded real component if there is one, else `Component.lazy`. The choice is **frozen at the first render**: the kernel pairs old and new children by component *identity* (`pairs()` in `kernel.js`), so swapping implementations under a live page would remount it. `preloadInitial()` after the first render is a no-op. |

Other things that matter, each covered by a test:

- The lazy name **must equal** the component's `name` (state paths look like `/App/ProductsPage[/products]`). `preloadInitial` throws a clear error if they differ.
- One `import()` per page however it is triggered (hover, navigation, boot): they share a memoised loader.
- Only the matched route's chunk is loaded before hydration; every other page stays a lazy `Component.lazy` that loads on demand (`isLoaded()` proves it).
- Server and browser must each have their own `makeLazyRoutePage` instances (they do, being different processes). The tests load a fresh module graph for each side (`loadApp()` in [`test/helpers.ts`](test/helpers.ts)).

### When #263 lands

Delete the "preloaded real component" branch: `render` becomes the `Component.lazy` wrapper unconditionally, `preloadInitial()` shrinks to `lazy.preload()` (still awaited before hydrating, so the module is loaded and hydration doesn't have to wait), and the freeze logic goes away. The canary test then fails, which is your cue to remove it. Everything else (manifest preloads, bundle verification) is unchanged.

## Bundle splitting you can verify

`pnpm verify:bundles` reads `dist/client/.vite/manifest.json` and `dist/client/assets/*.js` and fails (exit 1) unless:

- the **entry chunk contains none** of the page markers (each page/module exports a unique `SENTINEL:*` string that is rendered as a `data-*` attribute, so it survives minification and tree-shaking);
- the entry reaches every page through a **dynamic `import()`** and statically imports none;
- each of the 5 pages is its **own** JS chunk, containing its own marker and no other page's;
- Analytics' private modules (`analytics/dataset.ts`, `analytics/chart.ts` + CSS) are inside the Analytics chunk and nowhere else;
- the shared catalog (`data/products.ts`) is in exactly one shared chunk, imported only by the two product pages;
- every JS file in `assets/` is accounted for by the manifest.

Add a static `import "./pages/HomePage.ts"` anywhere in the client graph and it fails with, e.g., `ENTRY chunk … contains page marker SENTINEL:home-page`.

Expected output (hashes vary):

```
chunk               file                                    raw (B)   gzip (B)
------------------  ------------------------------------  ---------  ---------
entry               assets/client-i5-sx-XP.js                306849     105105
page:Home           assets/HomePage-B-bVCTfS.js                 773        465
page:Products       assets/ProductsPage-fiMVX9Md.js            1432        766
page:ProductDetail  assets/ProductDetailPage-Dn_3t9rv.js       1259        611
page:Analytics      assets/AnalyticsPage--1V9eZIc.js           2424       1237
page:NotFound       assets/NotFoundPage-BFw-QwYj.js             441        313
shared              assets/products-DfwBtIpS.js                 749        457
css                 assets/client-BKq9j6xQ.css                  246        198
css                 assets/AnalyticsPage-Ddd3rpWK.css           102        112
```

The entry is the framework (`effect` + `@effect/ui`); the page chunks are small because they import it from the entry chunk. Do **not** force `@effect/ui` into a vendor chunk with `manualChunks`/`advancedChunks`: its own docs warn that framework modules only lazy pages use then move back into the initial load.

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

`pnpm test` (Vitest + happy-dom, 41 tests):

| File | Proves |
|---|---|
| `ssr.test.ts` | Each route renders full HTML (never a loading placeholder) with the right `<title>`, search/params applied, per-page serialized state under `/App/<Page>[<path>]`, 404 for unknown URLs / product ids. |
| `hydration.test.ts` | After `boot()`, the client **adopts the exact server DOM nodes** (`toBe` reference equality on `section`, `input`, `ul`, `li`, `a`, `button`, `header`), **adopts the server's Model** (edited state shows `Comparing 1`, `Clicked 41 times`; `init` would give 0), **never renders the fallback** (a `MutationObserver` plus a counter), only loads the active route's chunk, and hydrates NotFound. Includes the #263 **canary**. |
| `navigation.test.ts` | Client-side navigation to a *non-preloaded* route loads its chunk lazily (`isLoaded()` flips on navigation, other pages stay unloaded), keeps the shell, **doesn't remount** on state or `?q=` updates (same nodes, Model survives), works back to the server-rendered page, never swaps a mounted page's component identity, and hover/focus prefetch warms the chunk without changing what renders (then navigation shows no fallback). |
| `assets.test.ts` | `resolveRouteAssets` and the rendered `<head>` contain `modulepreload` for **only** the active route's chunk (+ its imports), never the entry or another page; CSS handling; cycles; missing-manifest errors. |
| `lazyPage.test.ts` | `prefetch` ≠ `preloadInitial`; one `import()` however it is triggered; name-mismatch and failed-import behaviour. |

Beyond happy-dom, the built output was also driven in headless Chromium (not part of the repo to keep dependencies small): direct visit to `/products/42` requested only that page's chunk plus the shared one, inserted **0** fallbacks, kept the parser-created nodes, hover prefetched `AnalyticsPage`, link clicks navigated without a document reload, and `?q=` updates kept the same `<section>`.

## Gotchas this sample hit (and handles)

- **Layer lifetime.** `BrowserRouter.layer` installs the document's click/hover listeners and removes them when its layer closes. Provide the platform layers *around* the scope that keeps the app alive (`Effect.provide(...)` after `Effect.scoped(... Effect.never)` in `client.ts`), not inside `boot()`, or link interception silently stops after boot.
- **One copy of `effect`/`@effect/ui` per test document.** The Router keeps per-module registries; the test helpers import the libraries from the same fresh module graph as the app.
- **Component name = lazy name.** The page's `Html.component({ name })` is what the lazy wrapper must be called, because state paths are built from it.
- **SVG.** `h` has no SVG element builders, so the Analytics chart is a pure function that returns an SVG string, shown through `<img src="data:image/svg+xml,…">`: identical on server and client, so there is nothing to mismatch.
- **Pages stay out of the entry.** Never import `./pages/*` statically. `scripts/verify-bundles.mjs` is the guard.

## License

MIT
