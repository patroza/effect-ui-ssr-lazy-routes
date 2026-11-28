// Proves, from the BUILT output, that every page is its own chunk, that the
// entry chunk carries no page code (no page marker, no page-only query,
// command, feature RPC group, or @effect/ui-kit primitive), and that ZERO
// server handlers/stores/datasets or @effect/ui-devtools enter dist/client/.
//
//   node scripts/verify-bundles.ts [distClientDir]
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"
import type * as I18n from "../src/i18n/I18n.ts"
import type * as Routes from "../src/routes.ts"
import * as Assets from "../src/server/assets.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const clientDir = process.argv[2] ?? join(root, "dist/client")
const manifest = Assets.parseManifest(readFileSync(join(clientDir, ".vite/manifest.json"), "utf8"))

const failures: Array<string> = []
const check = (ok: boolean, message: string): void => {
  if (!ok) failures.push(message)
}

// --- Page-only things, each with the page that owns it and a string that is unique to it in the build. ---
// Sentinels are exported by our own modules. Query/Command services and RPC tags carry their key into the build as a
// string literal. A @effect/ui-kit primitive is identified by a data attribute only its module writes.
type Owned = readonly [needle: string, label: string, owner: Routes.AppRouteTag]
const owned: ReadonlyArray<Owned> = [
  // [needle, label, owner route]
  ["SENTINEL:home-page", "Home page", "Home"],
  ["SENTINEL:products-page", "Products page", "Products"],
  ["SENTINEL:search-products-query", "SearchProducts marker", "Products"],
  ["search/SearchProducts", "SearchProducts query", "Products"],
  ["searchProducts", "SearchRpcs rpc", "Products"],
  ["SENTINEL:product-detail-page", "ProductDetail page", "ProductDetail"],
  ["SENTINEL:get-product-query", "GetProduct marker", "ProductDetail"],
  ["product/GetProduct", "GetProduct query", "ProductDetail"],
  ["product/BookmarkProduct", "BookmarkProduct command", "ProductDetail"],
  ["getProduct", "ProductRpcs getProduct rpc", "ProductDetail"],
  ["bookmarkProduct", "ProductRpcs bookmarkProduct rpc", "ProductDetail"],
  ["SENTINEL:analytics-page", "Analytics page", "Analytics"],
  ["SENTINEL:analytics-chart", "Analytics chart", "Analytics"],
  ["SENTINEL:analytics-schema", "Analytics schema", "Analytics"],
  ["SENTINEL:get-analytics-query", "GetAnalytics marker", "Analytics"],
  ["analytics/GetAnalytics", "GetAnalytics query", "Analytics"],
  ["getAnalytics", "AnalyticsRpcs rpc", "Analytics"],
  ["data-activation-direction", "ui-kit Tabs", "Analytics"],
  ["data-panel-open", "ui-kit Collapsible", "Analytics"],
  ["SENTINEL:status-page", "Status page", "Status"],
  ["SENTINEL:status-schema", "Status schema", "Status"],
  ["SENTINEL:get-status-query", "GetStatus marker", "Status"],
  ["status/GetStatus", "GetStatus query", "Status"],
  ["getStatus", "StatusRpcs rpc", "Status"],
  ["SENTINEL:order-form-page", "OrderForm page", "Order"],
  ["SENTINEL:order-schema", "Order schema", "Order"],
  ["SENTINEL:check-order-code-query", "CheckOrderCode marker", "Order"],
  ["SENTINEL:validate-promo-code-query", "ValidatePromoCode marker", "Order"],
  ["order/CheckOrderCode", "CheckOrderCode query", "Order"],
  ["order/ValidatePromoCode", "ValidatePromoCode query", "Order"],
  ["order/SubmitOrder", "SubmitOrder command", "Order"],
  ["checkOrderCode", "OrderRpcs checkOrderCode rpc", "Order"],
  ["validatePromoCode", "OrderRpcs validatePromoCode rpc", "Order"],
  ["submitOrder", "OrderRpcs submitOrder rpc", "Order"],
  ["FormRoot", "ui-kit Form", "Order"],
  ["data-select-blocker", "ui-kit Select", "Order"],
  ["SENTINEL:warehouse-page", "Warehouse page", "Warehouse"],
  ["SENTINEL:warehouse-schema", "Warehouse schema", "Warehouse"],
  ["SENTINEL:get-warehouse-carts-query", "GetWarehouseCarts marker", "Warehouse"],
  ["warehouse/GetWarehouseCarts", "GetWarehouseCarts query", "Warehouse"],
  ["warehouse/UnblockCart", "UnblockCart command", "Warehouse"],
  ["warehouse/BlockCart", "BlockCart command", "Warehouse"],
  ["warehouse/PreflightReleaseCart", "PreflightReleaseCart command", "Warehouse"],
  ["warehouse/ReleaseCart", "ReleaseCart command", "Warehouse"],
  ["warehouse/PreflightDispatchCart", "PreflightDispatchCart command", "Warehouse"],
  ["warehouse/DispatchCartBatch", "DispatchCartBatch command", "Warehouse"],
  ["warehouse/RefreshSession", "RefreshSession command", "Warehouse"],
  ["dispatchCartStep", "WarehouseRpcs dispatchCartStep rpc", "Warehouse"],
  ["data-progressing", "ui-kit Progress", "Warehouse"],
  ["--toast-index", "ui-kit ToastProvider", "Warehouse"],
  ["SENTINEL:not-found-page", "NotFound page", "NotFound"]
]
// Lazy-split translation catalog markers (dynamic imports only, never in entry or another locale).
type LocaleOwned = readonly [needle: string, label: string, owner: I18n.AppLocale]
const localeNeedles: ReadonlyArray<LocaleOwned> = [
  ["SENTINEL:i18n-en", "i18n en catalog", "en"],
  ["SENTINEL:i18n-de", "i18n de catalog", "de"]
]
// Framework and kit code that only lazy pages use. It must exist in the build, in a chunk that is neither the
// entry nor reachable from it by a static import: otherwise every visitor downloads it up front.
const pageOnlyFramework: ReadonlyArray<readonly [needle: string, label: string]> = [
  ["effect/ui/Query/Build", "@effect/ui Query.Service runtime"],
  ["effect/ui/Query/accessor", "@effect/ui Query.Service accessors"],
  ["~effect/rpc/RpcClientError", "effect/rpc RpcClient runtime"],
  ["data-dialog-backdrop", "ui-kit Dialog"],
  ["data-touched", "ui-kit Field"],
  ["data-scrubbing", "ui-kit NumberField"],
  ["data-parent", "ui-kit Checkbox"],
  ["Button: the element already handles click", "ui-kit Button"],
  ["Input: the element already handles input", "ui-kit Input"]
]
// Imported by exactly the Products and ProductDetail chunks: one shared chunk, never the entry.
const sharedNeedles: ReadonlyArray<readonly [needle: string, label: string]> = [
  ["SENTINEL:product-schema", "product schema"]
]
// Server-only stores, datasets and RPC server runtime that must never appear in dist/client/.
const serverOnlyNeedles: ReadonlyArray<readonly [needle: string, label: string]> = [
  ["effect-ui-ssr-lazy-routes/server/services/CatalogStore", "server CatalogStore"],
  ["effect-ui-ssr-lazy-routes/server/services/BookmarkStore", "server BookmarkStore"],
  ["effect-ui-ssr-lazy-routes/server/services/AnalyticsStore", "server AnalyticsStore"],
  ["effect-ui-ssr-lazy-routes/server/services/StatusStore", "server StatusStore"],
  ["effect-ui-ssr-lazy-routes/server/services/OrderStore", "server OrderStore"],
  ["effect-ui-ssr-lazy-routes/server/services/WarehouseStore", "server WarehouseStore"],
  ["Ceramic pour-over", "server seed catalog dataset"],
  ["effect/rpc/RpcServer", "RpcServer runtime"]
]
// Dev-only code that must never appear in any production chunk (0 bytes in dist/client).
const devOnlyNeedles: ReadonlyArray<readonly [needle: string, label: string]> = [
  ["@effect/ui-devtools", "@effect/ui-devtools package"],
  ["effect-ui-devtools", "@effect/ui-devtools plugin/overlay"],
  ["effect_ui_list_sessions", "@effect/ui-devtools WebMCP tools"],
  ["Paused at #", "@effect/ui-devtools Time travel UI"]
]

// Every SENTINEL a source file declares must be known here, so a new marker can't escape the check.
const walk = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  )
const declared = new Set(
  walk(join(root, "src")).flatMap((file) => readFileSync(file, "utf8").match(/SENTINEL:[a-z0-9-]+/g) ?? [])
)
const known = new Set([
  ...owned.map(([needle]) => needle),
  ...sharedNeedles.map(([needle]) => needle),
  ...localeNeedles.map(([needle]) => needle)
])
for (const sentinel of declared) {
  check(known.has(sentinel), `src declares ${sentinel} but verify-bundles.ts doesn't know its owner`)
}

// --- Read every chunk. ---
const chunkFiles = readdirSync(join(clientDir, "assets")).filter((name) => name.endsWith(".js"))
const read = (file: string): Buffer => readFileSync(join(clientDir, file))
const code = new Map(chunkFiles.map((name) => [`assets/${name}`, read(`assets/${name}`).toString("utf8")]))
/** EVERY chunk (entry, pages and shared) whose code contains `needle`. */
const holdersOf = (needle: string): ReadonlyArray<string> =>
  [...code].filter(([, text]) => text.includes(needle)).map(([file]) => file)
/** The files of `source`'s chunk and of every chunk it imports statically, transitively. */
const staticClosureFiles = (source: string): ReadonlySet<string> => {
  const seen = new Set<string>()
  const closure = new Set<string>()
  const visit = (key: string): void => {
    if (seen.has(key)) return
    seen.add(key)
    const chunk = manifest[key]
    if (chunk === undefined) return
    closure.add(chunk.file)
    for (const imported of chunk.imports ?? []) visit(imported)
  }
  visit(source)
  return closure
}
const size = (file: string): { readonly raw: number; readonly gzip: number } => {
  const buffer = read(file)
  return { raw: buffer.length, gzip: gzipSync(buffer).length }
}

// --- Entry. ---
const entries = Object.values(manifest).filter((chunk) => chunk.isEntry === true)
check(entries.length === 1, `expected exactly one entry chunk, found ${entries.length}`)
const entry = entries[0]
if (entry === undefined) {
  console.error("\n✗ manifest has no entry chunk")
  process.exit(1)
}
const entryCode = code.get(entry.file) ?? ""
check(entryCode.length > 0, `entry chunk ${entry.file} not found in assets/`)

for (const [needle, label] of [...owned, ...sharedNeedles, ...localeNeedles]) {
  check(!entryCode.includes(needle), `ENTRY chunk ${entry.file} contains ${label} (${needle})`)
}
const entryClosure = staticClosureFiles(Assets.ENTRY_SOURCE)
for (const [needle, label] of pageOnlyFramework) {
  const holders = holdersOf(needle)
  check(holders.length > 0, `${label} (${needle}) is in no chunk: the marker is stale`)
  check(!holders.includes(entry.file), `ENTRY chunk ${entry.file} contains ${label} (${needle})`)
  for (const holder of holders) {
    check(!entryClosure.has(holder), `the entry statically imports ${holder}, which holds ${label}`)
  }
}
const pageSources: ReadonlyArray<string> = Object.values(Assets.routeSources)
const localeSourcesList: ReadonlyArray<string> = Object.values(Assets.localeSources)
for (const imported of entry.imports ?? []) {
  check(!pageSources.includes(imported), `entry statically imports page module ${imported}`)
  check(!localeSourcesList.includes(imported), `entry statically imports locale module ${imported}`)
}
for (const source of [...pageSources, ...localeSourcesList]) {
  check(
    (entry.dynamicImports ?? []).includes(source),
    `entry doesn't reach ${source} through a dynamic import() (is it imported statically elsewhere?)`
  )
}

// --- Pages. ---
const pageChunks = Object.entries(Assets.routeSources).map(([route, source]) => {
  const chunk: Assets.ManifestChunk | undefined = manifest[source]
  check(chunk !== undefined, `manifest has no chunk for ${route} (${source})`)
  check(chunk?.isDynamicEntry === true, `${route} (${source}) is not a dynamic-entry chunk`)
  check(chunk?.file !== entry.file, `${route} shares the entry chunk file`)
  return { route, source, chunk }
})
const files = pageChunks.map(({ chunk }) => chunk?.file)
check(new Set(files).size === files.length, "two pages share one chunk file")

for (const { route, chunk } of pageChunks) {
  const own = (chunk === undefined ? undefined : code.get(chunk.file)) ?? ""
  for (const [needle, label, owner] of owned) {
    if (owner === route)
      check(own.includes(needle), `${route} chunk ${chunk?.file} is missing its own ${label} (${needle})`)
    else check(!own.includes(needle), `${route} chunk ${chunk?.file} contains ${owner}'s ${label} (${needle})`)
  }
}
// Whatever chunk it lands in (page, shared or entry), a page-only needle lives in its owner's chunk and nowhere else.
for (const [needle, label, owner] of owned) {
  const ownerFile = pageChunks.find(({ route }) => route === owner)?.chunk?.file
  const holders = holdersOf(needle)
  check(
    ownerFile !== undefined && holders.length === 1 && holders[0] === ownerFile,
    `${label} (${needle}) should live only in ${owner}'s chunk ${ownerFile}, found in: ${holders.join(", ") || "no chunk"}`
  )
}

// The product schema is shared by exactly the Products and ProductDetail chunks, never the entry.
for (const [needle] of sharedNeedles) {
  const holders = holdersOf(needle)
  check(holders.length === 1, `${needle} should live in exactly one shared chunk, found ${holders.length}`)
  const holder = holders[0]
  for (const route of ["Products", "ProductDetail"] as const) {
    check(
      holder !== undefined && staticClosureFiles(Assets.routeSources[route]).has(holder),
      `${route} chunk doesn't import the shared product schema chunk ${holder}`
    )
  }
  // Transitively: a page that reaches the product schema through ANOTHER shared chunk would load it too.
  for (const route of ["Home", "Analytics", "Status", "Order", "Warehouse", "NotFound"] as const) {
    check(
      holder === undefined || !staticClosureFiles(Assets.routeSources[route]).has(holder),
      `${route} chunk (transitively) imports the product schema chunk it doesn't need`
    )
  }
  check(
    holder === undefined || !entryClosure.has(holder),
    `the entry statically imports the product schema chunk ${holder}`
  )
}

// --- Locale catalogs: separate dynamic-entry chunks, zero static inclusion in entry, mutually isolated. ---
const localeChunks = Object.entries(Assets.localeSources).map(([locale, source]) => {
  const chunk: Assets.ManifestChunk | undefined = manifest[source]
  check(chunk !== undefined, `manifest has no chunk for locale ${locale} (${source})`)
  check(chunk?.isDynamicEntry === true, `locale ${locale} (${source}) is not a dynamic-entry chunk`)
  check(chunk?.file !== entry.file, `locale ${locale} shares the entry chunk file`)
  if (chunk !== undefined) {
    check(!entryClosure.has(chunk.file), `entry statically closure-imports locale ${locale} chunk ${chunk.file}`)
  }
  return { locale, source, chunk }
})
const localeFiles = localeChunks.map(({ chunk }) => chunk?.file)
check(new Set(localeFiles).size === localeFiles.length, "two locales share one chunk file")
for (const [needle, label, owner] of localeNeedles) {
  const ownerFile = localeChunks.find(({ locale }) => locale === owner)?.chunk?.file
  const holders = holdersOf(needle)
  check(
    ownerFile !== undefined && holders.length === 1 && holders[0] === ownerFile,
    `${label} (${needle}) should live only in locale:${owner} chunk ${ownerFile}, found in: ${holders.join(", ") || "no chunk"}`
  )
}
const enChunkFile = localeChunks.find(({ locale }) => locale === "en")?.chunk?.file
const deChunkFile = localeChunks.find(({ locale }) => locale === "de")?.chunk?.file
if (enChunkFile !== undefined && deChunkFile !== undefined) {
  const enAssets = Assets.resolveRouteAssets(manifest, "Warehouse", "en")
  const deAssets = Assets.resolveRouteAssets(manifest, "Warehouse", "de")
  check(enAssets.modulePreloads.includes(`/${enChunkFile}`), `Warehouse EN assets missing ${enChunkFile}`)
  check(!enAssets.modulePreloads.includes(`/${deChunkFile}`), `Warehouse EN assets leaked ${deChunkFile}`)
  check(deAssets.modulePreloads.includes(`/${deChunkFile}`), `Warehouse DE assets missing ${deChunkFile}`)
  check(!deAssets.modulePreloads.includes(`/${enChunkFile}`), `Warehouse DE assets leaked ${enChunkFile}`)
}

// Home and NotFound use no queries, no RPC client and no transitions: neither may statically/transitively import them.
const queryHolders = holdersOf("effect/ui/Query/Build")
const rpcClientHolders = holdersOf("~effect/rpc/RpcClientError")
for (const route of ["Home", "NotFound"] as const) {
  const closure = staticClosureFiles(Assets.routeSources[route])
  for (const holder of queryHolders) {
    check(!closure.has(holder), `${route} chunk (transitively) imports Query runtime ${holder}`)
  }
  for (const holder of rpcClientHolders) {
    check(!closure.has(holder), `${route} chunk (transitively) imports RpcClient runtime ${holder}`)
  }
  for (const file of closure) {
    check(!/^assets\/Query-.*\.js$/.test(file), `${route} chunk (transitively) imports ${file}`)
    check(!/^assets\/transition-.*\.js$/.test(file), `${route} chunk (transitively) imports ${file}`)
  }
}

// Server-only stores, datasets and RPC server runtime must be completely absent from every client chunk.
for (const [needle, label] of serverOnlyNeedles) {
  const holders = holdersOf(needle)
  check(holders.length === 0, `client build contains ${label} (${needle}) in: ${holders.join(", ")}`)
}

// Dev-only @effect/ui-devtools code must be completely absent from every production chunk.
for (const [needle, label] of devOnlyNeedles) {
  const holders = holdersOf(needle)
  check(holders.length === 0, `production build contains ${label} (${needle}) in: ${holders.join(", ")}`)
}

// --- CSS: Tailwind (global) rides with the entry; the page-specific stylesheet only with Analytics. ---
check(
  (entry.css ?? []).length === 1,
  `entry should own exactly one stylesheet (Tailwind), has ${(entry.css ?? []).length}`
)
for (const { route, chunk } of pageChunks) {
  const expected = route === "Analytics" ? 1 : 0
  check(
    (chunk?.css ?? []).length === expected,
    `${route} should own ${expected} stylesheet(s), has ${(chunk?.css ?? []).length}`
  )
}

// --- Report. ---
const owns = (file: string): string =>
  owned
    .filter(([needle]) => (code.get(file) ?? "").includes(needle))
    .map(([, label]) => label)
    .filter(
      (label) =>
        label.startsWith("ui-kit") || label.endsWith("query") || label.endsWith("command") || label.endsWith("rpc")
    )
    .join(", ")
interface Row {
  readonly role: string
  readonly file: string
  readonly raw: number
  readonly gzip: number
  readonly owns: string
}
const rows: Array<Row> = []
const add = (role: string, file: string): void => {
  rows.push({ role, file, ...size(file), owns: file.endsWith(".js") ? owns(file) : "" })
}
add("entry", entry.file)
for (const { route, chunk } of pageChunks) if (chunk) add(`page:${route}`, chunk.file)
for (const { locale, chunk } of localeChunks) if (chunk) add(`locale:${locale}`, chunk.file)
const shared = Object.values(manifest).filter((chunk) => !chunk.isEntry && !chunk.isDynamicEntry)
for (const chunk of shared) add("shared", chunk.file)
const css = [...new Set(Object.values(manifest).flatMap((chunk) => chunk.css ?? []))]
for (const file of css) add("css", file)

const widest = (key: "role" | "file" | "owns", header: string): number =>
  Math.max(header.length, ...rows.map((row) => row[key].length))
const roleWidth = widest("role", "chunk")
const fileWidth = widest("file", "file")
const ownsWidth = widest("owns", "page-only code")
const pad = (text: string, width: number): string => text.padEnd(width)
const num = (value: number): string => String(value).padStart(9)
console.log(
  `\n${pad("chunk", roleWidth)}  ${pad("file", fileWidth)}  ${"raw (B)".padStart(9)}  ${"gzip (B)".padStart(9)}  page-only code`
)
console.log(
  `${"-".repeat(roleWidth)}  ${"-".repeat(fileWidth)}  ${"-".repeat(9)}  ${"-".repeat(9)}  ${"-".repeat(ownsWidth)}`
)
for (const row of rows) {
  console.log(
    `${pad(row.role, roleWidth)}  ${pad(row.file, fileWidth)}  ${num(row.raw)}  ${num(row.gzip)}  ${row.owns}`
  )
}

const accounted = new Set(rows.map((row) => row.file))
const orphans = chunkFiles.map((name) => `assets/${name}`).filter((file) => !accounted.has(file))
check(orphans.length === 0, `assets/ has JS not described by the manifest: ${orphans.join(", ")}`)

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} bundle check(s) failed:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(
  `\n✓ entry carries no page code; ${pageChunks.length} pages are ${pageChunks.length} separate chunks; ` +
    `${owned.length} page-only markers, queries, commands, RPCs and ui-kit primitives each live in exactly their owner chunk; ` +
    `0 server stores/datasets and 0 devtools in dist/client/.`
)
