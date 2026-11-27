import { Html } from "@effect/ui/html"
import { Context, Effect, Layer, Schema } from "effect"
import { formatTemplate, type MessageCatalog, type MessageKey, type TemplateValues } from "./messages.ts"

export type { MessageCatalog, MessageKey, TemplateValue, TemplateValues } from "./messages.ts"

export const AppLocale = Schema.Literals(["en", "de"])
export type AppLocale = typeof AppLocale.Type

export const I18nConfig = Schema.Struct({
  locale: AppLocale,
  bcp47: Schema.String,
  currency: Schema.Literals(["USD", "EUR"]),
  timeZone: Schema.String
})
export type I18nConfig = typeof I18nConfig.Type

export const LOCALE_CONFIGS: Readonly<Record<AppLocale, I18nConfig>> = {
  en: { locale: "en", bcp47: "en-US", currency: "USD", timeZone: "UTC" },
  de: { locale: "de", bcp47: "de-DE", currency: "EUR", timeZone: "Europe/Berlin" }
}

export const configForLocale = (locale: AppLocale): I18nConfig => LOCALE_CONFIGS[locale]

export const parseLocale = (raw: string | null | undefined): AppLocale =>
  raw?.trim().toLowerCase().startsWith("de") ? "de" : "en"

export const parseLocaleFromCookie = (cookieHeader: string | undefined): AppLocale => {
  if (cookieHeader === undefined || cookieHeader === "") return "en"
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim()
    if (!trimmed.startsWith("locale=")) continue
    return parseLocale(trimmed.slice("locale=".length))
  }
  return "en"
}

export const localeCookieHeader = (locale: AppLocale): string =>
  `locale=${locale}; Path=/; SameSite=Lax; Max-Age=31536000`

const loadedCatalogs = new Map<AppLocale, MessageCatalog>()
const loadedChunkMarkers = new Map<AppLocale, string>()
const inFlightLoads = new Map<AppLocale, Promise<MessageCatalog>>()

const importCatalogForLocale: Readonly<
  Record<AppLocale, () => Promise<{ readonly catalog: MessageCatalog; readonly chunkMarker: string }>>
> = {
  en: () => import("./catalogs/en.ts"),
  de: () => import("./catalogs/de.ts")
}

/** Registers a catalog directly (useful for deterministic unit tests). */
export const registerCatalog = (locale: AppLocale, catalog: MessageCatalog): void => {
  loadedCatalogs.set(locale, catalog)
}

/** Returns the catalog synchronously once preloaded. */
export const getCatalog = (locale: AppLocale): MessageCatalog | undefined => loadedCatalogs.get(locale)

/** Returns the bundle chunk sentinel once the locale catalog has been preloaded. */
export const getChunkMarker = (locale: AppLocale): string | undefined => loadedChunkMarkers.get(locale)

/**
 * Dynamically imports ONLY the requested locale chunk so inactive translations
 * add zero bytes to initial browser payloads. Safe to call repeatedly.
 */
export const preloadLocale = (locale: AppLocale): Promise<MessageCatalog> => {
  const existing = loadedCatalogs.get(locale)
  if (existing !== undefined) return Promise.resolve(existing)

  const pending = inFlightLoads.get(locale)
  if (pending !== undefined) return pending

  const next = importCatalogForLocale[locale]()
    .then((mod) => {
      loadedCatalogs.set(locale, mod.catalog)
      loadedChunkMarkers.set(locale, mod.chunkMarker)
      inFlightLoads.delete(locale)
      return mod.catalog
    })
    .catch((error: unknown) => {
      inFlightLoads.delete(locale)
      throw error
    })
  inFlightLoads.set(locale, next)
  return next
}

export type TranslateFn = (key: MessageKey, values?: TemplateValues) => string

export interface I18nTranslator {
  readonly config: I18nConfig
  readonly t: TranslateFn
  readonly formatCurrency: (cents: number) => string
  readonly formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string
  readonly formatDate: (date: Date, options?: Intl.DateTimeFormatOptions) => string
}

const translatorCache = new Map<AppLocale, I18nTranslator>()
const currencyFormatterCache = new Map<string, Intl.NumberFormat>()

const getCurrencyFormatter = (bcp47: string, currency: "USD" | "EUR"): Intl.NumberFormat => {
  const key = `${bcp47}:${currency}`
  const existing = currencyFormatterCache.get(key)
  if (existing !== undefined) return existing
  const formatter = new Intl.NumberFormat(bcp47, { style: "currency", currency })
  currencyFormatterCache.set(key, formatter)
  return formatter
}

/**
 * Pure synchronous translator bound to one `I18nConfig`. Reads from the
 * preloaded locale catalog and pins locale + currency + timezone so SSR HTML
 * and browser hydration match byte-for-byte.
 */
export const translator = (config: I18nConfig = LOCALE_CONFIGS.en): I18nTranslator => {
  const cached = translatorCache.get(config.locale)
  if (cached !== undefined && loadedCatalogs.has(config.locale)) {
    return cached
  }
  const currencyFormatter = getCurrencyFormatter(config.bcp47, config.currency)
  const created: I18nTranslator = {
    config,
    t: (key, values) => {
      const catalog = loadedCatalogs.get(config.locale)
      const template = catalog?.[key]
      return template === undefined ? key : formatTemplate(template, values)
    },
    formatCurrency: (cents) => currencyFormatter.format(cents / 100),
    formatNumber: (value, options) => new Intl.NumberFormat(config.bcp47, options).format(value),
    formatDate: (date, options) =>
      new Intl.DateTimeFormat(config.bcp47, { timeZone: config.timeZone, ...options }).format(date)
  }
  if (loadedCatalogs.has(config.locale)) {
    translatorCache.set(config.locale, created)
  }
  return created
}

export const translatorFor = (locale: AppLocale): I18nTranslator => translator(configForLocale(locale))

/** Effect service for server handlers, SSR rendering helpers, Commands, and Queries. */
export class I18n extends Context.Service<I18n, I18nTranslator>()("app/I18n") {
  static readonly layer = (locale: AppLocale): Layer.Layer<I18n> =>
    Layer.effect(I18n, Effect.promise(() => preloadLocale(locale)).pipe(Effect.map(() => translatorFor(locale))))
}

/**
 * Headless shared-state component exposing Schema-serializable `I18nConfig` to
 * descendants via `shares` / `reads` (matching `@effect/ui-kit` `DirectionProvider`).
 */
export const I18nProvider = Html.component({
  name: "I18nProvider",
  props: Schema.Struct({ locale: AppLocale }),
  model: Schema.Struct({}),
  message: Schema.Never,
  restore: false,
  shares: {
    value: ({ props }) => configForLocale(props.locale),
    schema: I18nConfig
  }
}).make({
  init: () => ({}),
  update: ($) => $.model,
  parts: (p) => configForLocale(p.props.locale)
})
