import { Schema } from "effect"
import type * as I18n from "../i18n/I18n.ts"
import * as JsonString from "../lib/jsonString.ts"
import type * as Routes from "../routes.ts"

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
  /** `<link rel="modulepreload">` URLs: the matched route's chunk, active locale chunk, and static imports. */
  readonly modulePreloads: ReadonlyArray<string>
  /** `<link rel="stylesheet">` URLs: the entry's CSS plus the CSS of the route chunks. */
  readonly stylesheets: ReadonlyArray<string>
}

export const ENTRY_SOURCE = "src/main.ts"
const ENTRY_STYLESHEET = "src/index.css"

/** Dev-only route stylesheets in addition to `ENTRY_STYLESHEET`. */
const routeDevStylesheets: Readonly<Partial<Record<Routes.AppRouteTag, ReadonlyArray<string>>>> = {
  Analytics: ["src/analytics/components/chart.css"]
}

const devStylesheetUrl = (source: string): string => `/${source}?direct`

/** Manifest key of each route's page module. `satisfies` makes a new route fail to compile until mapped. */
export const routeSources = {
  Home: "src/pages/HomePage.ts",
  Products: "src/pages/ProductsPage.ts",
  ProductDetail: "src/pages/product/ProductDetailPage.ts",
  Analytics: "src/pages/AnalyticsPage.ts",
  Status: "src/pages/StatusPage.ts",
  Order: "src/pages/OrderFormPage.ts",
  Warehouse: "src/pages/WarehousePage.ts",
  NotFound: "src/pages/NotFoundPage.ts"
} as const satisfies Record<Routes.AppRouteTag, string>

/** Manifest key of each lazy-split translation catalog module. */
export const localeSources = {
  en: "src/i18n/catalogs/en.ts",
  de: "src/i18n/catalogs/de.ts"
} as const satisfies Record<I18n.AppLocale, string>

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
 * Production assets for a route and active locale. Preloads the page chunk
 * AND the active locale catalog chunk (never the inactive locale) in parallel
 * with the entry script so hydration has zero waterfall or fallback keys.
 */
export const resolveRouteAssets = (
  manifest: Manifest,
  tag: Routes.AppRouteTag,
  locale: I18n.AppLocale = "en"
): PageAssets => {
  const entry = staticClosure(manifest, ENTRY_SOURCE)
  const entryChunk = entry[0]
  if (entryChunk === undefined) throw new Error("Manifest has no entry chunk")
  const route = staticClosure(manifest, routeSources[tag])
  const localeSource = localeSources[locale]
  const localeChunks = manifest[localeSource] !== undefined ? staticClosure(manifest, localeSource) : []
  return {
    scripts: [url(entryChunk.file)],
    modulePreloads: unique([...route, ...localeChunks, ...entry].map((chunk) => url(chunk.file))).filter(
      (href) => href !== url(entryChunk.file)
    ),
    stylesheets: unique([...entry, ...route, ...localeChunks].flatMap((chunk) => (chunk.css ?? []).map(url)))
  }
}

/**
 * Dev assets for the matched route: render-blocking `?direct` stylesheet
 * links in `<head>` eliminate SSR FOUC (while keeping a distinct URL from
 * Vite's JS CSS module imports), and `src/main.ts` hands them off to Vite's
 * HMR `<style data-vite-dev-id>` tags once mounted.
 */
export const devAssetsFor = (tag: Routes.AppRouteTag): PageAssets => ({
  scripts: [`/${ENTRY_SOURCE}`],
  modulePreloads: [],
  stylesheets: [devStylesheetUrl(ENTRY_STYLESHEET), ...(routeDevStylesheets[tag] ?? []).map(devStylesheetUrl)]
})

const escapeAttribute = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")

/** The tags to put in `<head>`: stylesheets, then modulepreloads, then the entry script(s). */
export const renderAssetTags = (assets: PageAssets): string =>
  [
    ...assets.stylesheets.map((href) => `<link rel="stylesheet" href="${escapeAttribute(href)}">`),
    ...assets.modulePreloads.map((href) => `<link rel="modulepreload" crossorigin href="${escapeAttribute(href)}">`),
    ...assets.scripts.map((src) => `<script type="module" crossorigin src="${escapeAttribute(src)}"></script>`)
  ].join("\n    ")
