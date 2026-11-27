# effect-ui-ssr-lazy-routes

A small, strict-TypeScript reference for **[`@effect/ui`](https://github.com/Effect-TS/ui)** + **`@effect/ui-kit`** + **Tailwind CSS v4** that shows, end to end and _verifiably_:

- **Multi-page routing** with `Route.union` (+ `subset`, `printPath`) and `Router.patchSearch` (`/`, `/products?q=`, `/products/:id`, `/analytics`, `/status?mode=`, `/*`).
- **Server-side rendering** with `HtmlServer.renderToHtml`, `HtmlServer.serializeState` and `Router.static`.
- **Zero-flash hydration**: the browser adopts the _exact_ server DOM nodes, the server's serialized Model and its `~query` cache, for pages code-split with plain `Component.lazy` (`await preloadRoute` before `HtmlHydrate.hydrateEffect`).
- **Query result boundary ([`.agents/traits/query-result-boundary.md`](.agents/traits/query-result-boundary.md))**: [`src/design/queryResult.ts`](src/design/queryResult.ts) matches `h.queries.*` once at each page boundary (`onInitial` for cold nav, `onFailure` for SSR `503` / initial error UI with Retry, `onReady` for guaranteed non-optional `data: A` plus `refreshErrorBanner` when `Failure.previousSuccess` keeps SSR/cached data alive across a failed client refresh). [`src/pages/StatusPage.ts`](src/pages/StatusPage.ts) (`/status?mode=ok|fail-ssr|fail-refresh`) demonstrates SSR errors, SSR-to-client refresh errors, and manual `Query.invalidate` refresh (`Products`, `ProductDetail`, `Analytics`, `Status`), alongside `BrowserHost` automatic stale-query refetching on `Query.Visibility` / `Query.Connectivity` changes.
- **Per-page Vite splitting**, `@effect/ui-kit` included: `Tabs`, `Collapsible` and `Dialog` ship **only** in the page chunk that uses them, never in the entry (`pnpm verify:bundles`).
- **Real Effect HTTP + RPC API server** (`effect/rpc` + `effect/http`): feature-scoped `RpcGroup`s (`SearchRpcs`, `ProductRpcs`, `AnalyticsRpcs`, `StatusRpcs`) are mounted independently on `HttpRouter` (`POST /rpc/search`, `POST /rpc/product`, `POST /rpc/analytics`, `POST /rpc/status`) with zero `RpcGroup.merge`, keeping each page's schemas, RPC definitions and `RpcClient` protocol strictly in its lazy route chunk while all server stores/datasets stay under `src/server/` (0 bytes in `dist/client/`).
- **Required `HttpClient` + `RpcSerialization` at composition roots**: each page's `Query.Service` / `Command.Service` provides its own `RpcClient.layerProtocolHttp({ url: "/rpc/<group>" })`, so only `HttpClient` and `RpcSerialization` flow to each entry root — `FetchHttpClient.layer` + `RpcSerialization.layerJson` in the browser (so `Home` and `NotFound` don't even load `RpcClient`!), and an in-process `HttpClient` dispatching directly to the RPC `HttpRouter` effect during SSR (zero TCP round-trip).
- **Deterministic tests**: `@effect/vitest` `it.effect` on the `TestClock`, `TestHost.layer()` / `TestHost.settle`, `Ssr.ssr`, and `Ref`-backed in-process RPC call counters. No `vi.resetModules()`, no `setTimeout`, no wall-clock waits, no module-level counters.
- **No entry → page waterfall** on direct visits: `<link rel="modulepreload">` for the matched route's chunks and the entry's static imports, and a page's own `<link rel="stylesheet">` only on that page.
- **Dev-only DevTools**: `@effect/ui-devtools` inspector overlay + Time Travel (`DevTools.layer`) and Vite MCP server (`DevToolsVite.plugin({ dispatch: true })` at `http://127.0.0.1:4774/mcp`) in `pnpm dev`, tree-shaken to **0 bytes** in production (`pnpm verify:bundles`).
- **Tailwind v4** (`@tailwindcss/vite`) with a neutral light/dark palette (`prefers-color-scheme`, no JS), focus rings and `data-*` / `aria-*` variants on the kit's attributes.

|                                             |                                                                                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `@effect/ui`                                | `https://pkg.pr.new/Effect-TS/ui/@effect/ui@7bff56b`                                                                                   |
| `@effect/ui-kit`                            | `https://pkg.pr.new/Effect-TS/ui/@effect/ui-kit@7bff56b` (same commit)                                                                 |
| `@effect/ui-devtools`                       | `https://pkg.pr.new/Effect-TS/ui/@effect/ui-devtools@7bff56b` (dev-only)                                                               |
| `effect` / `@effect/platform-node`          | `4.1.6`                                                                                                                                |
| Tailwind CSS / `@tailwindcss/vite`          | `4.3.5`                                                                                                                                |
| Vite+ (`vite-plus`)                         | `1.8.0` (Vite `8.3.8`, Vitest `5.1.1`; `pnpm-workspace.yaml` overrides pin Oxlint `1.95.0`, Oxfmt `0.80.0`, `tsrs` `7.1.0-beta.tsrs5`) |
| TypeScript / happy-dom                      | `6.0.3` / `21.0.4`                                                                                                                     |
| `@effect/vitest`                            | `4.1.6` (pinned with `effect`)                                                                                                         |
| Package manager                             | pnpm 12, Node ≥ 22.18                                                                                                                  |
| `@effect/tsgo` / `@effect/language-service` | `0.73.7` / `0.87.5`                                                                                                                    |

## Quick start

```sh
pnpm install
pnpm typecheck        # effect-tsgo tsrs --noEmit (strict; no `any`, no `@ts-ignore`)
pnpm lint             # effect-tsgo vp lint (type-aware Oxlint + embedded effecttsgo/* diagnostics, warnings denied)
pnpm format:check     # vp fmt --check (pnpm format writes)
pnpm check            # cached via vp run: format:check + lint + typecheck + build:client + build:server + verify:bundles + test + smoke
pnpm build            # vp build (dist/client + .vite/manifest.json) and dist/server
pnpm verify:bundles   # prints the chunk table and proves the per-page split from the built output
pnpm test             # vp test run (@effect/vitest + happy-dom, on the TestClock)
pnpm smoke            # boots the built server, checks SSR HTML, modulepreload fetches, stylesheets, bad URLs
pnpm start            # production server on http://localhost:3000 (PORT=… to change)
pnpm dev              # Vite+ middleware + the same SSR handler, with HMR (PORT=5173)
```

## Toolchain

Vite+ (`vite-plus`) unifies Vite, Vitest, Oxlint, Oxfmt, and `tsrs` into a single `vite.config.ts` and local `vp` CLI (no global `vp` install required; `pnpm-workspace.yaml` overrides pin `vite`/`vitest` to the bundled versions and keep `oxlint@1.95.0`, `oxfmt@0.80.0`, and `tsrs@7.1.0-beta.tsrs5` so no lint rule is lost). Always invoke `vp lint` and `vp check` through `effect-tsgo` (as `pnpm lint` and `pnpm check` do); plain `vp lint` without `effect-tsgo` fails safe on the `effecttsgo` plugin.

| Command          | Runs                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pnpm typecheck` | `effect-tsgo tsrs --noEmit` (Effect-patched `tsrs` with `@effect/language-service`)                                      |
| `pnpm lint`      | `effect-tsgo vp lint` (type-aware Oxlint + type-checking + all 99 `effecttsgo/*` error rules, warnings denied)           |
| `pnpm lint:fix`  | `effect-tsgo vp check --fix` (formats and applies lint autofixes in one pass)                                            |
| `pnpm format`    | `vp fmt` (`pnpm format:check` runs `vp fmt --check` for CI)                                                              |
| `pnpm check`     | `vp run` over `format:check`, `lint`, `typecheck`, `build:client`, `build:server`, `verify:bundles`, `test`, and `smoke` |

- **Unified `vite.config.ts`.** Build (`build`, `ssr`), tests (`test`), formatting (`fmt`), linting (`lint`), and task caching (`run`) all live in `vite.config.ts` via `defineConfig` from `vite-plus` (with `lazyPlugins` so `vp check` / `vp lint` / `vp fmt` skip Vite plugin startup, and `mode === "test"` skipping Tailwind and DevTools during Vitest).
- **Automatic task caching & CI.** `vite.config.ts` enables `run.cache: { scripts: true, tasks: true }`, so Vite Task (`vp run`) automatically tracks file reads, directory listings, and written outputs for every cacheable `package.json` script (including `pnpm check` and `pnpm build`) and restores `dist/` on cache hits. Interactive and in-place mutating commands (`dev`, `start`, `format`, `lint:fix`) delegate to non-overlapping `cache: false` tasks so they are never cached. `.github/workflows/ci.yml` restores and saves `node_modules/.vite/task-cache` around `pnpm check` with `actions/cache`.
- **Effect diagnostics fail the build.** `tsconfig.plugins.json` holds the `@effect/language-service` severity table (every rule `"error"`;
  `unstableApiUsage` and `experimentalApiUsage` are `"off"` because `@effect/ui` is `@stability experimental`). `scripts/lib/effect-diagnostics.mjs`
  derives every enabled rule as an `effecttsgo/*` oxlint rule directly for `vite.config.ts` (extending `@effect/tsgo/oxlint-presets` to register the
  native `effecttsgo` plugin) and fails closed if none are enabled. Of the 154 rules, **99 are enabled as errors** and the other **55 are off** (rules
  the schema ships disabled, plus the two experimental-API rules above). So the same diagnostics run in `effect-tsgo vp check`, `pnpm lint`, and `pnpm typecheck`.
- **Strict oxlint.** `vite.config.ts` extends `@effect-app/eslint-shared-config` plus `config/oxlint.strict.json`
  (no `any`, no non-null assertions, no unsafe assertions, no `any` flowing anywhere, `@ts-ignore`/`@ts-nocheck` banned) with
  `typeAware`, `typeCheck`, and `denyWarnings`.
- **Imports.** Barrel imports for the libraries: `import { Effect, Schema } from "effect"`, `import { Component, Router } from "@effect/ui"`,
  `import { Button } from "@effect/ui-kit"` (submodule paths such as `effect/http`, `effect/reactivity` and `@effect/ui/html` for what the
  barrel doesn't carry). Every **local** module is a namespace import, `import * as Routes from "./routes.ts"`, never a named one; the
  tree-shaking that keeps page code out of the entry comes from the bundler, not from the import style.
- **Scripts are type-checked too.** `scripts/*.ts` run natively on Node's type stripping; `scripts/lib/effect-diagnostics.mjs` is
  checked through JSDoc (`allowJs` + `checkJs`).

## The pages

| Route           | Page chunk contains                                                                        | `@effect/ui-kit`                |
| --------------- | ------------------------------------------------------------------------------------------ | ------------------------------- |
| `/`             | counter                                                                                    | `Button`                        |
| `/products?q=`  | `SearchProducts` query + `SearchRpcs`, compare list (`Product` schema is shared)           | `Input`, `Button`               |
| `/products/:id` | `GetProduct` query, **`BookmarkProduct` Command** + `ProductRpcs`, quantity, inquiry modal | `Dialog`, `Input`, `Button`     |
| `/analytics`    | `GetAnalytics` query + `AnalyticsRpcs`, schemas, SVG chart, **its own CSS**                | `Tabs`, `Collapsible`, `Button` |
| `/status?mode=` | `GetStatus` query + `StatusRpcs`, `errorPanel` / `refreshErrorBanner` demo                 | `Button`                        |
| `/*`            | not-found (404)                                                                            | none                            |

`Button`, `Input` and `Product` schema are used by several pages, so Rollup puts them in small shared chunks (`Product-*.js` is shared only by Products and ProductDetail). `Tabs`, `Collapsible` and `Dialog` each have exactly one user, so they land in that page's chunk. `App.ts` and `Shell.ts` import no kit primitive, so the shell never pays for them.

```
src/
  main.ts                  browser entry: decode #state (`JsonString.jsonString`; unreadable → warn + mount fresh), run boot in the app scope, wire `BrowserRouter`, `FetchHttpClient.layer` + `RpcSerialization.layerJson`, and dev-only `DevTools.layer`
  index.css                @import "tailwindcss" + a tiny base layer (the entry's only global CSS)
  App.ts                   createApp(pages), createAppBundle() + the production `App`/`productionApp`: holds the route, Head.titleTemplate, Router subscription; delegates the layout to the shell
  Shell.ts                 createShell(pages): primary nav + the lazy page outlet (a plain view function, so state paths stay `/App/<page>[<path>]`)
  routes.ts                AppRoute = Route.union({ Home, Products, ProductDetail, Analytics, Status, NotFound }) + routeOf(url)
  pages.ts                 the ONLY references to ./pages/*: createPages({ onLoad }) → Component.lazy(name, () => import(...)), the production `pages`, preloadRoute(route, pages)
  pages/                   one component per route; each ends up in its own chunk
    HomePage.ts · NotFoundPage.ts · ProductsPage.ts · AnalyticsPage.ts · StatusPage.ts
    product/ProductDetailPage.ts   the inquiry Dialog; maps BookmarkProduct's result/error into its own messages with Command.match
  rpc/
    domain/ApiError.ts     typed domain `Schema.TaggedError` (with optional `cause: Schema.Defect()`) for server-side RPC failures (e.g. `bookmarkProduct`, `getStatus`)
  product/
    domain/Product.ts      lightweight `Product` schema + `formatPrice`, shared only by Products + ProductDetail
    domain/ProductRpcs.ts  `ProductRpcs` (`getProduct`, `bookmarkProduct`) — ProductDetail chunk only
    commands/BookmarkProduct.ts   Command.Service over `RpcClient.make(ProductRpcs)`, success Void / error `ApiError | RpcClientError`
    queries/GetProduct.ts  ProductDetail Query.Service over `RpcClient.make(ProductRpcs)`, error `RpcClientError`
  search/
    domain/SearchRpcs.ts   `SearchRpcs` (`searchProducts`) — Products chunk only
    queries/SearchProducts.ts   Products Query.Service over `RpcClient.make(SearchRpcs)`, error `RpcClientError`
  analytics/               Analytics-only
    domain/Analytics.ts    `Metric` / `SeriesPoint` schemas + title helper (no dataset in client bundle)
    domain/AnalyticsRpcs.ts     `AnalyticsRpcs` (`getAnalytics`) — Analytics chunk only
    queries/GetAnalytics.ts     Query.Service over `RpcClient.make(AnalyticsRpcs)`, error `RpcClientError`
    components/Chart.ts    pure SVG chart (+ chart.css, the only page-specific stylesheet)
  status/                  Status-only (SSR error + refresh error + recovery demo)
    domain/Status.ts       `StatusMode` / `SystemStatus` schemas + chunk sentinel
    domain/StatusRpcs.ts   `StatusRpcs` (`getStatus`) — Status chunk only
    queries/GetStatus.ts   Status Query.Service (`staleTime: "30 seconds"`) over `RpcClient.make(StatusRpcs)`, error `ApiError | RpcClientError`
  browser/
    bootstrap.ts           boot({ …, bundle? }): resolve URL → await preloadRoute → install guards → hydrate / mount
    prefetch.ts            scoped (Effect.acquireRelease) hover/focus prefetch + vite:preloadError reload
    state.ts               #state decoding
  design/
    classes.ts             Tailwind class recipes (plain strings, found by Tailwind's source scan)
    loading.ts             pageFallback for lazy pages (the `data-fallback` marker the tests look for)
    queryResult.ts         `matchQuery`, `errorPanel`, `refreshErrorBanner`, `refreshButton` boundary helpers
  lib/
    jsonString.ts          the central Schema.fromJsonString(Schema.toCodecJson(...))
    status.ts              `data-http-status` ("404" / "503") marker a page sets; the server reads it back as the HTTP status
  server/
    services/              server-only `Context.Service` stores (0 bytes in dist/client/): CatalogStore, BookmarkStore (`Ref`), AnalyticsStore, StatusStore (`Ref`)
    handlers/              per-group RPC handler layers (`SearchHandlers`, `ProductHandlers`, `AnalyticsHandlers`, `StatusHandlers`), each yielding only the store(s) it needs
    rpc.ts                 independent `RpcServer.layerHttp` routes (`/rpc/{search,product,analytics,status}`), `HandlersLayer` (`Layer.mergeAll` of per-group handlers), and `InProcessRpcClientLayer` (zero-TCP in-process `HttpClient` for SSR)
    assets.ts              manifest → per-route <link rel="modulepreload"> / stylesheet tags
    render.ts              renderPageEffect(url, assetsFor, { app? }) → Page | Redirect | BadRequest (requires `HttpClient` + `RpcSerialization`)
    handler.ts             Effect HTTP application (`POST /rpc/{search,product,analytics,status}` + static files + redirects + 400/405 + security headers + in-process SSR)
    serve.ts               production server entry (`NodeHttpServer.layer` + `NodeRuntime.runMain`)
config/            oxlint.strict.json (the strict type-aware rules vite.config.ts extends)
scripts/           verify-bundles.ts · smoke.ts · dev.ts
test/              ssr · hydration · ui-kit · navigation · query-result · prefetch · assets · server · pages · chart (+ setup.ts, helpers.ts, support/rpc.ts, support/frames.ts)
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
         2. await preloadRoute(route)       ← pages[route._tag].preload(), native Component.lazy (`pages` from createPages())
         3. install vite:preloadError reload + link prefetch (released with the app scope)
         4. HtmlHydrate.hydrateEffect(App, Router.props, #app, state)
                                            ← adopts DOM + Model + ~query cache entries
```

## Zero-flash hydration with plain `Component.lazy`

`Component.lazy` splits a page into its own chunk. A client that hydrates _before_ the module has loaded replaces the server's nodes with the fallback. Awaiting the preload first fixes that ([Effect-TS/ui#268](https://github.com/Effect-TS/ui/pull/268)), so there is no wrapper:

```ts
// src/pages.ts: the only place that mentions a page module. Every createPages() call has its own load caches.
export const createPages = (options: PagesOptions = {}) => {
  const loaded = <A>(tag: AppRouteTag, page: A): A => {
    options.onLoad?.(tag)
    return page
  }
  return {
    Products: Component.lazy("ProductsPage", () =>
      import("./pages/ProductsPage.ts").then((m) => loaded("Products", m.ProductsPage))
    )
    // …
  }
}
export const pages = createPages()
export const preloadRoute = (route: AppRouteValue, pageMap: Pages = pages): Promise<void> =>
  pageMap[route._tag].preload()

// src/browser/bootstrap.ts, inside Effect.fn("boot")(function* (options) { … })
yield * Effect.promise(() => Pages.preloadRoute(route, bundle.pages)) // await the matched page's chunk…
yield * HtmlHydrate.hydrateEffect(bundle.app, props, options.container, options.state) // …then hydrate: nothing is thrown away
```

`createAppBundle()` builds a matched `{ app, pages }` pair (`productionApp` is the production one). A test builds one bundle for its "server" and another for its "browser" **in the same module graph**, so no module is ever reset and `boot` can never preload one set of pages while mounting another. `boot` and `renderPage` default to `productionApp` / `App`.

The lazy name **must equal** the component's `name` (state paths look like `/App/ProductsPage[/products]`). Only the matched route's chunk is imported before hydration. `test/hydration.test.ts` has a **negative control**: hydrating _without_ `await preloadRoute(route)` renders the fallback and replaces the server's `<section>`.

## Effect HTTP + RPC API, Queries and Commands (`effect/rpc` + `effect/http`)

Modeled on [`tim-smart/bunnings-lite`](https://github.com/tim-smart/bunnings-lite), every query and command talks to a real Effect HTTP RPC API (`POST /rpc/{search,product,analytics,status}`) instead of client-side stubs, while **feature-scoped `RpcGroup`s mounted independently** (zero `RpcGroup.merge`) preserve per-page Vite chunk splitting:

```ts
// src/analytics/domain/AnalyticsRpcs.ts: feature-scoped RPC group (Analytics chunk only)
export class AnalyticsRpcs extends RpcGroup.make(
  Rpc.make("getAnalytics", {
    payload: { metric: Analytics.Metric },
    success: Schema.Array(Analytics.SeriesPoint)
  })
) {}

// src/analytics/queries/GetAnalytics.ts: page-only query over RpcClient.make(AnalyticsRpcs)
// RpcClientError is already a JSON-serializable Schema.Class — it flows straight through without erasure.
static readonly layer = this.toLayer(Effect.gen(function* () {
  const client = yield* RpcClient.make(AnalyticsRpcs.AnalyticsRpcs)
  return ({ metric }) => client.getAnalytics({ metric })
})).pipe(Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc/analytics" })))

// src/server/rpc.ts: independent per-group HTTP routes + per-group handler composition (no RpcGroup.merge)
export const RpcHttpLayer = Layer.mergeAll(
  RpcServer.layerHttp({ group: SearchRpcs.SearchRpcs, path: "/rpc/search", protocol: "http" }),
  RpcServer.layerHttp({ group: ProductRpcs.ProductRpcs, path: "/rpc/product", protocol: "http" }),
  RpcServer.layerHttp({ group: AnalyticsRpcs.AnalyticsRpcs, path: "/rpc/analytics", protocol: "http" })
).pipe(Layer.provide(RpcSerialization.layerJson))
export const HandlersLayer = Layer.mergeAll(
  SearchHandlers.SearchHandlersLayer,
  ProductHandlers.ProductHandlersLayer,
  AnalyticsHandlers.AnalyticsHandlersLayer
)
```

What that buys, each proven by a test or by `verify:bundles`:

- **Zero server data in the browser:** `CatalogStore`, `BookmarkStore` (`Ref`), `AnalyticsStore`, seed datasets, and `RpcServer` live strictly under `src/server/` (`verify:bundles` asserts 0 bytes in `dist/client/`).
- **Per-route RPC isolation (including `RpcClient`):** `SearchRpcs` ships only in `ProductsPage`, `ProductRpcs` only in `ProductDetailPage`, and `AnalyticsRpcs` only in `AnalyticsPage`; `RpcClient` itself stays out of the entry chunk and out of `Home`/`NotFound`, while the entry holds only `FetchHttpClient` + `RpcSerialization`.
- **Required transport at every composition root:** `HttpClient` + `RpcSerialization` propagate through `Component.lazy` to `App`, so forgetting to provide them at the browser entry (`src/main.ts`), SSR (`src/server/handler.ts`), or a test (`test/support/rpc.ts`) is a compile-time type error.
- **Zero-TCP SSR sharing live server state:** SSR provides `Rpc.InProcessRpcClientLayer` — an in-process `HttpClient` dispatching directly to the RPC `HttpRouter` effect against the same server store `Layer` instance as `POST /rpc/*`, so mutations (such as `bookmarkProduct`) are immediately visible to subsequent SSR renders without a network round-trip.
- **SSR + hydration:** `renderToHtml` waits for the query and serializes the settled entry under `~query`; the client seeds its cache from it, adopts the server's nodes and the client makes **0** RPC calls (`root.fetches()` is empty, and the `Ref`-backed `RpcCalls` counters stay 0). Strip `~query` from the state and it fetches once, so the assertion can fail.
- **Navigation:** a page the server didn't render fetches on the client; a `?q=` change re-keys the query on the live instance (same nodes, last results stay up).

Other Effect UI practices used: `Effect.fn` for `boot` and the server stores; `UiSchema.TaggedEnum` messages named for the fact (`SelectedMetricTab`, `CompletedBookmarkProduct`); `Router.patchSearch` with a `Route.subset` prop for the search box, whose query is `debounce: "300 millis"` so typing doesn't fetch per keystroke (the first fetch is immediate; the tests move the `TestClock` across the 300 ms); `Head.titleTemplate`; link prefetch and the `vite:preloadError` reload guard as `Effect.acquireRelease` resources in the app scope (the guard calls `preventDefault()` only when it actually reloads); `#state` decoded with `JsonString.jsonString` (`Schema.fromJsonString` over `Schema.toCodecJson`); and no `manualChunks`.

## Bundle splitting you can verify

`pnpm verify:bundles` prints the whole `dist/client/` table (entry, the 6 pages, shared chunks, CSS) and exits 1 unless:

- the **entry contains none** of the page markers, page-only query/Command names, or page-only `@effect/ui-kit` primitives (`Tabs`, `Collapsible`, `Dialog`, found by data attributes only their modules write);
- the entry reaches every page through a **dynamic `import()`** and statically imports none;
- the **`Query.Service` runtime** (`Query-*.js`) and the kit's `Button` and `Input` exist in the build but in no chunk the entry holds or statically imports;
- each of the 6 pages is its **own** chunk, holds its own markers, queries, Command, feature RPC group and kit primitives, and none of another page's (`Tabs` + `Collapsible` in Analytics, `Dialog` in ProductDetail);
- every page-only needle is found in **every** chunk of the build (shared chunks included) and that set is exactly its owner's chunk;
- the shared `Product` schema is in exactly one shared chunk, reached (through static imports, transitively) by the two product pages and by no other page or the entry;
- `Home` and `NotFound` do not statically or transitively import `Query-*.js`, `RpcClient` or `transition-*.js`;
- production `dist/client/` contains **0 bytes** of server stores, seed datasets, `RpcServer`, or `@effect/ui-devtools`;
- the entry owns exactly one stylesheet (Tailwind), and only Analytics owns a second one;
- every JS file in `assets/` is accounted for by the manifest.

Use `Tabs` in `App.ts` (an import that is never used is tree-shaken away, so it has to be rendered) and it fails with `ENTRY chunk … contains ui-kit Tabs`.

Output (hashes vary):

```
chunk               file                                    raw (B)   gzip (B)  page-only code
------------------  ------------------------------------  ---------  ---------  ---------------------------------------------------------------------------------------------------------------------
entry               assets/main-Bcnnq0_Q.js                   94778      35456
page:Home           assets/HomePage-Cc8yVYFL.js                 997        544
page:Products       assets/ProductsPage-b8yhcUtR.js            2661       1313  SearchProducts query, SearchRpcs rpc
page:ProductDetail  assets/ProductDetailPage-CtEPFoHz.js      23446       8738  GetProduct query, BookmarkProduct command, ProductRpcs getProduct rpc, ProductRpcs bookmarkProduct rpc, ui-kit Dialog
page:Analytics      assets/AnalyticsPage-BBqHq4Fj.js          21652       8665  GetAnalytics query, AnalyticsRpcs rpc, ui-kit Tabs, ui-kit Collapsible
page:NotFound       assets/NotFoundPage-DfyCDLF2.js             570        367
shared              assets/Button-1z9k8cO3.js                   592        384
shared              assets/Product-G-fY4Gtf.js                  673        447
shared              assets/Query-CTSalcNQ.js                  65443      22276
shared              assets/RpcSerialization-D4fZx9H0.js       18133       6527
shared              assets/attributes-BNllm5bX.js               484        306
shared              assets/classes-OXcvYGKa.js               241011      80440
shared              assets/rolldown-runtime-DK3Fl9T5.js         158        154
shared              assets/transition-B3QVgIiT.js              6173       2860
css                 assets/main-XHuNYSfM.css                  16286       3986
css                 assets/AnalyticsPage-BZFaGk-P.css            91        104
```

The entry is the framework (`effect` + `@effect/ui`) plus the shell. `Query-*.js` is the `Query` runtime only the lazy pages use; Vite moved it out of the entry. Do **not** force `@effect/ui` into a vendor chunk with `manualChunks`/`advancedChunks`: framework modules only lazy pages use would then move back into the initial load.

## DevTools (dev-only)

In development (`pnpm dev`), [`@effect/ui-devtools`](https://github.com/Effect-TS/ui/tree/main/packages/ui-devtools) is wired in two places:

- **Overlay + Time Travel (`src/main.ts`):** when `import.meta.env.DEV` is true, `DevTools.layer({ position: "BottomRight" })` is provided alongside `BrowserRouter.layer` (and `Layer.empty` in production). Open the corner launcher to inspect the message timeline, Model diffs, Command runs, causal chains, and **Time travel** through earlier states.
- **Vite MCP server (`vite.config.ts`):** `DevToolsVite.plugin({ dispatch: true })` runs only during `pnpm dev` (never during `vp build`, preview, or `vp test`) and exposes a local Streamable HTTP MCP endpoint at `http://127.0.0.1:4774/mcp` for agents to inspect sessions, read state/diffs, time-travel, or dispatch messages.

Production builds replace `import.meta.env.DEV` with `false` and tree-shake `@effect/ui-devtools` completely; `pnpm verify:bundles` asserts 0 references in `dist/client/`.

## No entry → page waterfall

[`src/server/assets.ts`](src/server/assets.ts) reads `dist/client/.vite/manifest.json` once and, per request, emits the matched route's chunk plus the entry's and route's transitive static imports as `<link rel="modulepreload">`, the entry as a script tag, and the entry's and the route's CSS as `<link rel="stylesheet">`:

```
GET /products/42 → css: main.css · modulepreload: ProductDetailPage, classes, rolldown-runtime, Button, attributes, transition, Product, Query, RpcSerialization
GET /analytics   → css: main.css + AnalyticsPage.css · modulepreload: AnalyticsPage, classes, rolldown-runtime, transition, attributes, RpcSerialization, Query
```

`pnpm smoke` checks this against the built server: it fetches every `<link rel="modulepreload">` and requires `200`, `text/javascript` and `immutable`. In dev there is no manifest, so there is nothing to preload, and Vite delivers the CSS through the JavaScript modules, so an unstyled flash before the entry runs is expected in dev (production links the stylesheets in `<head>`).

## HTTP behaviour

`src/server/handler.ts` composes `RpcServer.layerHttp` (`POST /rpc/{search,product,analytics,status}` with `RpcSerialization.layerJson`) with static asset serving and SSR (`NodeHttpServer` in `src/server/serve.ts`, also loaded through Vite in `scripts/dev.ts`). [`test/server.test.ts`](test/server.test.ts) drives it against a temporary client directory.

- **Effect RPC (`POST /rpc/{search,product,analytics,status}`):** serves `searchProducts` (`/rpc/search`), `getProduct` + `bookmarkProduct` (`/rpc/product`), `getAnalytics` (`/rpc/analytics`), and `getStatus` (`/rpc/status`) over JSON HTTP, sharing the same server store `Layer` instance as in-process SSR.
- **URLs** are resolved with `AppRoute.resolve` first, as `HtmlServerHttp.layerHttp` does: an undecodable URL (`/%E0%A4%A`), a protocol-relative target (`//evil.com/`), or any canonical redirect whose `Location` would start with `//` or `/\` (`/%2F%2Fevil.com/`, `/.//evil.com/`, `/a/..//evil.com/`) is rejected with `400`; a safe non-canonical path is a permanent `301` (`/products/` → `/products`), or a temporary `302` when search params were dropped as invalid (`/products?q=a&q=b` → `/products`), with `Location: AppRoute.print(route)`.
- **Status** is `404` for the catch-all route and for a page that rendered a missing record (an unknown product marks its root with `data-http-status="404"`), and `503` when a page's initial SSR query failed (`data-http-status="503"` on `QueryResult.errorPanel`), so HTTP status cannot drift from what the document shows.
- **Static files** come from `dist/client` only: `..` segments, malformed escapes and any dotfile segment (`/.vite/manifest.json`, in any letter case) are never served. `/assets/*` is `immutable`; a real `favicon.ico` in `dist/client` is served before falling back to `204`.
- **Methods:** `POST` on `/rpc`, `GET` and `HEAD` on page/static routes (`405` otherwise). `HEAD` carries the GET's real `content-length` and no body.
- **Headers:** `x-content-type-options: nosniff` always. The production server (the one with a `clientDir`) also sends `content-security-policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'`. The dev server doesn't, because Vite's HMR client and injected styles need more.
- **Errors never show internals:** failed queries on `ProductsPage`, `ProductDetailPage`, `AnalyticsPage`, and `StatusPage` render safe `ApiError` messages or a generic fallback via `QueryResult.describeFailure`, never transport errors (`socket closed`) or `Cause.pretty`.

## What the tests prove

`pnpm test` runs [`@effect/vitest`](https://github.com/Effect-TS/effect-smol/tree/main/packages/vitest) (`it.effect`, `it.layer`) with happy-dom. There is **no `vi.resetModules()`, no `vi.doMock`, no `setTimeout` and no module-level RPC counters** in `test/`:

- **`TestClock`.** `it.effect` runs on the test clock. The test RPC handlers' 5 ms round trip, the Products search's `debounce: "300 millis"` and the server's render budget are crossed with `TestClock.adjust(...)`, so a test can assert a pause of 299 ms fetches nothing and the 300th does, and `adjust("10 seconds")` + `TestHost.settle` proves that no late refetch or fallback ever fires. Nothing waits for real time.
- **`TestHost.layer()` + `TestHost.settle`.** The test scheduler runs every render, query, command, subscription and lazy load, and `settle` drains them (`@effect/ui/testing`). A lazy `import()` is a real Promise that `settle` cannot see for a root mounted on the browser host, so `Helpers.chunkLoaded` awaits the same `preload()` the `Component.lazy` child shares, then settles.
- **`Ssr.ssr`** (`@effect/ui/html/testing`) with `Router.memory`: renders on the server, hydrates in a fresh document and fails with `SsrError` unless every server node, Model and `~query` entry was adopted and the heads agree. `Ssr.ssr` runs both sides against the same `side.app` (sharing one lazy cache), proving full SSR output, query/head/Model adoption and zero refetches; `test/hydration.test.ts` uses two separate `createAppBundle()` instances to prove zero-flash lazy hydration on an unloaded client.
- **Server vs browser in one module graph.** `Helpers.hydrateFromServer` renders with one `createAppBundle()` (`renderPageEffect`, driven by the `TestClock`), puts that HTML in happy-dom and boots the real `boot` with `BrowserRouter` over a second, separate `createAppBundle()`. That proves exact DOM node identity (`toBe`), real `<a href>` click interception and `window.history.pushState`, with no module reset.
- **`Ref`-backed RPC counters.** `test/support/rpc.ts` provides per-group counting handler layers over `Rpc.makeInProcessHttpClient` to count calls into an `RpcCalls` service built per test (`Layer.fresh` gives the "server" its own, apart from the "browser"'s).
- **Animation frames.** The kit settles a closing Dialog/Collapsible on `requestAnimationFrame`, which happy-dom drives from real timers. `test/support/frames.ts` replaces it with a queue that `Helpers.settleFrames` flushes and `test/setup.ts` resets in `afterEach`.

| File                   | Proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ssr.test.ts`          | With `Ssr.ssr`, each route renders full HTML (never a loading placeholder) with the right `<title>`, search/params applied, per-page state under `/App/<Page>[<path>]` (the NotFound page's too), and the client adopts all of it with zero fetches and zero fallback frames. 404 for unknown URLs / product ids derived from the rendered page, and the `Page` / `Redirect` / `BadRequest` outcomes of `renderPage`.                                                                                                                                                                              |
| `hydration.test.ts`    | With `await preloadRoute(route)` the client **adopts the exact server DOM nodes** (`toBe`), **the server's Model**, **never renders the fallback**, imports only the active route's module. For `Query.Service` pages the client adopts the results and the RPC handlers run **0** times on the client (once when `~query` is stripped). **Negative control:** without `preloadRoute`, the fallback renders and the server `<section>` is replaced.                                                                                                                                                |
| `ui-kit.test.ts`       | `Tabs`, `Collapsible`, `Dialog`, `Input`, `Button` render on the server (selected tab, closed popup), are **adopted** on hydration (same nodes, 0 refetches, 0 fallbacks, server Collapsible state adopted), and work on the hydrated DOM: switching tabs keeps the tablist nodes and loads only the series the server didn't ship, the Collapsible opens and closes, the Dialog opens, takes input, sends and closes, and `BookmarkProduct` (`Command.Service`) runs once per click and its mapped message reaches `update`.                                                                      |
| `navigation.test.ts`   | Navigating to a _non-preloaded_ route loads only that page's module, keeps the shell, **doesn't remount** on state, tab or `?q=` updates, debounces the search by exactly 300 ms on the `TestClock` (a burst of keystrokes fetches once), fetches navigated pages' queries on the client, and the scoped hover/focus prefetch warms a chunk without changing what renders, ignores `target` / `download` / cross-origin links, and stops when the scope closes.                                                                                                                                    |
| `query-result.test.ts` | `QueryResult.matchQuery` boundary behaviour across SSR and client navigation: `/status` zero-`Initial` SSR hydration, `/status?mode=fail-ssr` HTTP `503` SSR error hydration & cold navigation into `errorPanel`, `/status?mode=fail-refresh` preserving SSR data + `refreshErrorBanner` on failed refresh and recovering on Retry, manual `Query.invalidate` Refresh buttons across `Status`/`Analytics`/`Products`/`ProductDetail`, and DOM node preservation across `Analytics` refresh transport errors.                                                                                       |
| `server.test.ts`       | The HTTP + RPC server against a temporary `clientDir`: live `POST /rpc/{search,product,analytics}` queries, bookmark mutations shared with in-process SSR, typed `ApiError` (with/without `cause`) + `RpcClientError` JSON codec round-trips, `405 Allow: POST` on non-POST `/rpc/*`, non-canonical `/rpc/*` paths, repeated in-process calls via `InProcessRpcClientLayer`, immutable static assets, path traversal and dotfiles blocked, malformed `%` is `400`, `405` on `POST` page routes, `HEAD` length, `301`/`302` canonical redirects, 404 status for unknown products, security headers. |
| `pages.test.ts`        | Every `pages[tag]` has a lazy name equal to the loaded component's `definition.name` (state paths depend on it), and each `createPages()` call has its own load cache.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `chart.test.ts`        | `escapeXml` and that a `&` / `<` in the chart's title or labels keeps the SVG well-formed XML.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `assets.test.ts`       | `resolveRouteAssets` and the `<head>` contain `modulepreload` for the active route's chunks and the entry's static imports (no other route's chunks), CSS handling, cycles, missing-manifest errors.                                                                                                                                                                                                                                                                                                                                                                                               |
| `prefetch.test.ts`     | `installPreloadErrorReload` reloads and calls `preventDefault()` on the first `vite:preloadError`; when a reload just happened it does **neither**, so the real chunk error survives; it still reloads when `sessionStorage` throws, and its listener is released with the scope.                                                                                                                                                                                                                                                                                                                  |

`test/setup.ts` adds a tiny stand-in for the Popover API, which happy-dom lacks and the kit's top-layer `Dialog` calls, and the manual `requestAnimationFrame` above.

## Gotchas this sample hit (and handles)

- **Layer lifetime.** `BrowserRouter.layer` installs the document's click/hover listeners and removes them when its layer closes. Provide the platform layers _around_ the scope that keeps the app alive (`main.ts`), not inside `boot()`.
- **One module graph, two sides.** `effect` and `@effect/ui` keep per-module registries, so the server and the browser of a test must share them. They do: each side is its own `createAppBundle()`, so lazy caches are separate while the libraries are the same copy.
- **Feature-scoped RPC groups and per-route splitting.** Putting all RPCs in one shared client group would pull every page's schemas into the entry chunk. Mounting each feature `RpcGroup` (`SearchRpcs`, `ProductRpcs`, `AnalyticsRpcs`) on its own HTTP route (`/rpc/{search,product,analytics}`) with zero `RpcGroup.merge` keeps each feature's schemas and `RpcClient` in its lazy route chunk while only `HttpClient` + `RpcSerialization` are provided once at each composition root.
- **Component name = lazy name**, because state paths are built from it.
- **Kit primitives are code-split by use, not by config.** Import `Tabs`/`Dialog` only inside the page that draws them; the barrel `@effect/ui-kit` tree-shakes (`sideEffects: []`).
- **Tailwind scans source files**, so class recipes in `design/classes.ts` must stay whole string literals. The per-route stylesheet (`chart.css`) is plain CSS so it keeps its own `<link>`.
- **SVG.** `h` has no SVG element builders, so the Analytics chart is a pure function that returns an SVG string, shown through `<img src="data:image/svg+xml,…">`.

## License

MIT
