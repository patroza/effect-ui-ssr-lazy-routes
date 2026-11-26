// Proves, from the BUILT output, that every page is its own chunk and that the
// entry chunk carries no page code: no page marker, no page-only query or
// Command, and no page-only @effect/ui-kit primitive. Run after `pnpm build`.
//
//   node scripts/verify-bundles.ts [distClientDir]
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"
import * as Assets from "../src/assets.ts"
import type * as Routes from "../src/routes.ts"

const root = fileURLToPath(new URL("..", import.meta.url))
const clientDir = process.argv[2] ?? join(root, "dist/client")
const manifest = Assets.parseManifest(readFileSync(join(clientDir, ".vite/manifest.json"), "utf8"))

const failures: Array<string> = []
const check = (ok: boolean, message: string): void => {
  if (!ok) failures.push(message)
}

// --- Page-only things, each with the page that owns it and a string that is unique to it in the build. ---
// Sentinels are exported by our own modules. Query/Command services carry their key into the build as a
// string literal. A @effect/ui-kit primitive is identified by a data attribute only its module writes.
type Owned = readonly [needle: string, label: string, owner: Routes.AppRouteTag]
const owned: ReadonlyArray<Owned> = [
  // [needle, label, owner route]
  ["SENTINEL:home-page", "Home page", "Home"],
  ["SENTINEL:products-page", "Products page", "Products"],
  ["SENTINEL:search-products-query", "SearchProducts marker", "Products"],
  ["catalog/SearchProducts", "SearchProducts query", "Products"],
  ["SENTINEL:product-detail-page", "ProductDetail page", "ProductDetail"],
  ["SENTINEL:get-product-query", "GetProduct marker", "ProductDetail"],
  ["catalog/GetProduct", "GetProduct query", "ProductDetail"],
  ["catalog/BookmarkProduct", "BookmarkProduct command", "ProductDetail"],
  ["data-dialog-backdrop", "ui-kit Dialog", "ProductDetail"],
  ["SENTINEL:analytics-page", "Analytics page", "Analytics"],
  ["SENTINEL:analytics-chart", "Analytics chart", "Analytics"],
  ["SENTINEL:analytics-dataset", "Analytics dataset", "Analytics"],
  ["SENTINEL:get-analytics-query", "GetAnalytics marker", "Analytics"],
  ["analytics/GetAnalytics", "GetAnalytics query", "Analytics"],
  ["data-activation-direction", "ui-kit Tabs", "Analytics"],
  ["data-panel-open", "ui-kit Collapsible", "Analytics"],
  ["SENTINEL:not-found-page", "NotFound page", "NotFound"]
]
// Framework and kit code that only lazy pages use. It must exist in the build, in a chunk that is neither the
// entry nor reachable from it by a static import: otherwise every visitor downloads it up front.
const pageOnlyFramework: ReadonlyArray<readonly [needle: string, label: string]> = [
  ["effect/ui/Query/Build", "@effect/ui Query.Service runtime"],
  ["effect/ui/Query/accessor", "@effect/ui Query.Service accessors"],
  ["Button: the element already handles click", "ui-kit Button"],
  ["Input: the element already handles input", "ui-kit Input"]
]
// Imported by exactly the Products and ProductDetail chunks: one shared chunk, never the entry.
const sharedNeedles: ReadonlyArray<readonly [needle: string, label: string]> = [
  ["SENTINEL:catalog-data", "catalog data"]
]

// Every SENTINEL a source file declares must be known here, so a new marker can't escape the check.
const walk = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  )
const declared = new Set(
  walk(join(root, "src")).flatMap((file) => readFileSync(file, "utf8").match(/SENTINEL:[a-z-]+/g) ?? [])
)
const known = new Set([...owned.map(([needle]) => needle), ...sharedNeedles.map(([needle]) => needle)])
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

for (const [needle, label] of [...owned, ...sharedNeedles]) {
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
for (const imported of entry.imports ?? []) {
  check(!pageSources.includes(imported), `entry statically imports page module ${imported}`)
}
for (const source of pageSources) {
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

// The catalog data is shared by exactly the Products and ProductDetail chunks, never the entry.
for (const [needle] of sharedNeedles) {
  const holders = holdersOf(needle)
  check(holders.length === 1, `${needle} should live in exactly one shared chunk, found ${holders.length}`)
  const holder = holders[0]
  for (const route of ["Products", "ProductDetail"] as const) {
    check(
      holder !== undefined && staticClosureFiles(Assets.routeSources[route]).has(holder),
      `${route} chunk doesn't import the shared catalog chunk ${holder}`
    )
  }
  // Transitively: a page that reaches the catalog through ANOTHER shared chunk would load it too.
  for (const route of ["Home", "Analytics", "NotFound"] as const) {
    check(
      holder === undefined || !staticClosureFiles(Assets.routeSources[route]).has(holder),
      `${route} chunk (transitively) imports the catalog chunk it doesn't need`
    )
  }
  check(holder === undefined || !entryClosure.has(holder), `the entry statically imports the catalog chunk ${holder}`)
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
    .filter((label) => label.startsWith("ui-kit") || label.endsWith("query") || label.endsWith("command"))
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
    `${owned.length} page-only markers, queries, commands and ui-kit primitives each live in exactly their owner chunk.`
)
