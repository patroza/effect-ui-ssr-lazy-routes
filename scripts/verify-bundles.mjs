// Proves, from the BUILT output, that every page is its own chunk and that the
// entry chunk carries no page code. Run after `pnpm build`.
//
//   node scripts/verify-bundles.mjs [distClientDir]
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { gzipSync } from "node:zlib"
import { routeSources } from "../src/assets.ts"

const root = new URL("..", import.meta.url).pathname
const clientDir = process.argv[2] ?? join(root, "dist/client")
const manifest = JSON.parse(readFileSync(join(clientDir, ".vite/manifest.json"), "utf8"))

const failures = []
const check = (ok, message) => {
  if (!ok) failures.push(message)
}

// --- Sentinels: unique strings each module exports, so ownership is greppable. ---
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
  )
const sentinelOwners = {
  "SENTINEL:home-page": "Home",
  "SENTINEL:products-page": "Products",
  "SENTINEL:product-detail-page": "ProductDetail",
  "SENTINEL:analytics-page": "Analytics",
  "SENTINEL:analytics-chart": "Analytics",
  "SENTINEL:analytics-dataset": "Analytics",
  "SENTINEL:not-found-page": "NotFound"
}
const sharedSentinels = ["SENTINEL:catalog-data"] // imported by Products + ProductDetail only
const declared = new Set(
  walk(join(root, "src")).flatMap((file) => readFileSync(file, "utf8").match(/SENTINEL:[a-z-]+/g) ?? [])
)
for (const sentinel of declared) {
  check(
    sentinel in sentinelOwners || sharedSentinels.includes(sentinel),
    `src declares ${sentinel} but verify-bundles.mjs doesn't know its owner`
  )
}

// --- Read every chunk. ---
const chunkFiles = readdirSync(join(clientDir, "assets")).filter((name) => name.endsWith(".js"))
const read = (file) => readFileSync(join(clientDir, file))
const code = new Map(chunkFiles.map((name) => [`assets/${name}`, read(`assets/${name}`).toString("utf8")]))
const size = (file) => {
  const buffer = read(file)
  return { raw: buffer.length, gzip: gzipSync(buffer).length }
}

// --- Entry. ---
const entries = Object.values(manifest).filter((chunk) => chunk.isEntry)
check(entries.length === 1, `expected exactly one entry chunk, found ${entries.length}`)
const entry = entries[0]
const entryCode = code.get(entry.file) ?? ""
check(entryCode.length > 0, `entry chunk ${entry.file} not found in assets/`)

for (const sentinel of [...Object.keys(sentinelOwners), ...sharedSentinels]) {
  check(!entryCode.includes(sentinel), `ENTRY chunk ${entry.file} contains page marker ${sentinel}`)
}
const pageSources = Object.values(routeSources)
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
const pageChunks = Object.entries(routeSources).map(([route, source]) => {
  const chunk = manifest[source]
  check(chunk !== undefined, `manifest has no chunk for ${route} (${source})`)
  check(chunk?.isDynamicEntry === true, `${route} (${source}) is not a dynamic-entry chunk`)
  check(chunk?.file !== entry.file, `${route} shares the entry chunk file`)
  return { route, source, chunk }
})
const files = pageChunks.map(({ chunk }) => chunk?.file)
check(new Set(files).size === files.length, "two pages share one chunk file")

for (const { route, chunk } of pageChunks) {
  const own = code.get(chunk?.file) ?? ""
  for (const [sentinel, owner] of Object.entries(sentinelOwners)) {
    if (owner === route) check(own.includes(sentinel), `${route} chunk ${chunk?.file} is missing its own marker ${sentinel}`)
    else check(!own.includes(sentinel), `${route} chunk ${chunk?.file} contains ${owner}'s marker ${sentinel}`)
  }
}

// The catalog data is shared by exactly the Products and ProductDetail chunks, never the entry.
for (const sentinel of sharedSentinels) {
  const holders = [...code].filter(([, text]) => text.includes(sentinel)).map(([file]) => file)
  check(holders.length === 1, `${sentinel} should live in exactly one shared chunk, found ${holders.length}`)
  for (const route of ["Products", "ProductDetail"]) {
    const imports = manifest[routeSources[route]]?.imports ?? []
    check(
      imports.some((key) => manifest[key]?.file === holders[0]),
      `${route} chunk doesn't import the shared catalog chunk ${holders[0]}`
    )
  }
  for (const route of ["Home", "Analytics", "NotFound"]) {
    const imports = manifest[routeSources[route]]?.imports ?? []
    check(
      !imports.some((key) => manifest[key]?.file === holders[0]),
      `${route} chunk imports the catalog chunk it doesn't need`
    )
  }
}

// --- Report. ---
const rows = []
const add = (role, file) => rows.push({ role, file: relative(clientDir, join(clientDir, file)), ...size(file) })
add("entry", entry.file)
for (const { route, chunk } of pageChunks) if (chunk) add(`page:${route}`, chunk.file)
const shared = Object.values(manifest).filter((chunk) => !chunk.isEntry && !chunk.isDynamicEntry)
for (const chunk of shared) add("shared", chunk.file)
const css = [...new Set(Object.values(manifest).flatMap((chunk) => chunk.css ?? []))]
for (const file of css) add("css", file)

const widest = (key, header) => Math.max(header.length, ...rows.map((row) => String(row[key]).length))
const roleWidth = widest("role", "chunk")
const fileWidth = widest("file", "file")
const pad = (text, width) => String(text).padEnd(width)
const num = (value) => String(value).padStart(9)
console.log(`\n${pad("chunk", roleWidth)}  ${pad("file", fileWidth)}  ${"raw (B)".padStart(9)}  ${"gzip (B)".padStart(9)}`)
console.log(`${"-".repeat(roleWidth)}  ${"-".repeat(fileWidth)}  ${"-".repeat(9)}  ${"-".repeat(9)}`)
for (const row of rows) console.log(`${pad(row.role, roleWidth)}  ${pad(row.file, fileWidth)}  ${num(row.raw)}  ${num(row.gzip)}`)

const accounted = new Set([...rows.map((row) => row.file)])
const orphans = chunkFiles.map((name) => `assets/${name}`).filter((file) => !accounted.has(file))
check(orphans.length === 0, `assets/ has JS not described by the manifest: ${orphans.join(", ")}`)

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} bundle check(s) failed:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(
  `\n✓ entry carries no page code; ${pageChunks.length} pages are ${pageChunks.length} separate chunks; ` +
    `${declared.size} markers each live in exactly their owner chunk.`
)
