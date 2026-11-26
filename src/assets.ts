import { Schema } from "effect"
import * as JsonString from "./jsonString.ts"
import type * as Routes from "./routes.ts"

/** The subset of Vite's `.vite/manifest.json` chunk entries this app reads. */
export const ManifestChunk = Schema.Struct({
  file: Schema.String,
  src: Schema.optionalKey(Schema.String),
  isEntry: Schema.optionalKey(Schema.Boolean),
  isDynamicEntry: Schema.optionalKey(Schema.Boolean),
  imports: Schema.optionalKey(Schema.Array(Schema.String)),
  dynamicImports: Schema.optionalKey(Schema.Array(Schema.String)),
  css: Schema.optionalKey(Schema.Array(Schema.String))
})
export type ManifestChunk = typeof ManifestChunk.Type

export const Manifest = Schema.Record(Schema.String, ManifestChunk)
export type Manifest = typeof Manifest.Type

/** Decodes the text of Vite's `.vite/manifest.json`; throws a Schema error when the shape is wrong. */
export const parseManifest = Schema.decodeSync(JsonString.jsonString(Manifest))

/** What one HTML response needs to load: the entry, the active route's chunks, and CSS. */
export interface PageAssets {
  /** `<script type="module" src>` URLs. */
  readonly scripts: ReadonlyArray<string>
  /** `<link rel="modulepreload">` URLs: the matched route's chunk and its transitive imports ONLY. */
  readonly modulePreloads: ReadonlyArray<string>
  /** `<link rel="stylesheet">` URLs: the entry's CSS plus the CSS of the route chunks. */
  readonly stylesheets: ReadonlyArray<string>
}

export const ENTRY_SOURCE = "src/client.ts"

/** Manifest key of each route's page module. `satisfies` makes a new route fail to compile until mapped. */
export const routeSources = {
  Home: "src/pages/HomePage.ts",
  Products: "src/pages/ProductsPage.ts",
  ProductDetail: "src/pages/ProductDetailPage.ts",
  Analytics: "src/pages/AnalyticsPage.ts",
  NotFound: "src/pages/NotFoundPage.ts"
} as const satisfies Record<Routes.AppRouteTag, string>

const url = (file: string): string => `/${file}`

/** The chunk for `source`, plus every chunk it statically imports (transitively), in discovery order. */
const staticClosure = (manifest: Manifest, source: string): ReadonlyArray<ManifestChunk> => {
  const seen = new Set<string>()
  const ordered: Array<ManifestChunk> = []
  const visit = (key: string): void => {
    if (seen.has(key)) return
    seen.add(key)
    const chunk = manifest[key]
    if (chunk === undefined) throw new Error(`Manifest has no entry for "${key}"`)
    ordered.push(chunk)
    for (const imported of chunk.imports ?? []) visit(imported)
  }
  visit(source)
  return ordered
}

const unique = <A>(items: Iterable<A>): ReadonlyArray<A> => [...new Set(items)]

/**
 * Production assets for a route. This is what removes the entry -> page
 * network waterfall on a direct URL visit: the HTML already tells the browser
 * to fetch the page chunk (and the shared chunks it needs) in parallel with
 * the entry, instead of discovering them only after the entry has run.
 */
export const resolveRouteAssets = (manifest: Manifest, tag: Routes.AppRouteTag): PageAssets => {
  const entry = staticClosure(manifest, ENTRY_SOURCE)
  const entryChunk = entry[0]
  if (entryChunk === undefined) throw new Error("Manifest has no entry chunk")
  const route = staticClosure(manifest, routeSources[tag])
  return {
    scripts: [url(entryChunk.file)],
    modulePreloads: unique(route.map((chunk) => url(chunk.file))).filter((href) => href !== url(entryChunk.file)),
    stylesheets: unique([...entry, ...route].flatMap((chunk) => (chunk.css ?? []).map(url)))
  }
}

/** Dev assets: Vite serves modules on demand, so there is nothing to preload. */
export const devAssets: PageAssets = {
  scripts: ["/@vite/client", `/${ENTRY_SOURCE}`],
  modulePreloads: [],
  stylesheets: []
}

const escapeAttribute = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")

/** The tags to put in `<head>`: stylesheets, then modulepreloads, then the entry script(s). */
export const renderAssetTags = (assets: PageAssets): string =>
  [
    ...assets.stylesheets.map((href) => `<link rel="stylesheet" href="${escapeAttribute(href)}">`),
    ...assets.modulePreloads.map((href) => `<link rel="modulepreload" crossorigin href="${escapeAttribute(href)}">`),
    ...assets.scripts.map((src) => `<script type="module" crossorigin src="${escapeAttribute(src)}"></script>`)
  ].join("\n    ")
