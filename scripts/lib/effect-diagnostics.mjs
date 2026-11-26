// Single source of truth for embedding Effect language-service diagnostics into
// type-aware oxlint (`effect-tsgo --tsrs-lint=<ver> oxlint`): derives the git-ignored
// `.oxlintrc.effect.generated.json` from `.oxlintrc.json` + `tsconfig.plugins.json` +
// `node_modules/@effect/tsgo/schema.json`.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"

export const BASE_OXLINT_CONFIG = ".oxlintrc.json"
export const EFFECT_TSCONFIG = "tsconfig.plugins.json"
export const DERIVED_OXLINT_CONFIG = ".oxlintrc.effect.generated.json"

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * @param {unknown} value
 * @returns {value is ReadonlyArray<unknown>}
 */
const isArray = (value) => Array.isArray(value)

/**
 * @param {string} name
 * @returns {string}
 */
const toKebab = (name) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()

/**
 * @param {string} filePath
 * @returns {unknown}
 */
const readJson = (filePath) => JSON.parse(readFileSync(filePath, "utf8"))

/**
 * Derive the 1:1 `effecttsgo/*` rule severity map from `tsconfig.plugins.json` +
 * `node_modules/@effect/tsgo/schema.json`. Every enabled rule (`error` or schema-default
 * `warning`) maps to `"error"`; disabled rules map to `"off"`. Fails closed when an input is
 * missing or invalid, or when no rule is enabled.
 *
 * @param {string} root
 * @returns {Record<string, "error" | "off">}
 */
export const deriveEffectRules = (root) => {
  const schemaPath = path.join(root, "node_modules/@effect/tsgo/schema.json")
  const effectTsconfigPath = path.join(root, EFFECT_TSCONFIG)
  if (!existsSync(schemaPath)) {
    throw new Error(`missing Effect schema at ${schemaPath}; run pnpm install first`)
  }
  if (!existsSync(effectTsconfigPath)) {
    throw new Error(`missing ${effectTsconfigPath}`)
  }

  const schema = readJson(schemaPath)
  const definitions = isRecord(schema) ? schema["definitions"] : undefined
  const severityDefinition = isRecord(definitions)
    ? definitions["effectLanguageServicePluginDiagnosticSeverityDefinition"]
    : undefined
  const properties = isRecord(severityDefinition) ? severityDefinition["properties"] : undefined
  if (!isRecord(properties) || Object.keys(properties).length === 0) {
    throw new Error(
      `${schemaPath} is missing definitions.effectLanguageServicePluginDiagnosticSeverityDefinition.properties`
    )
  }

  const tsconfig = readJson(effectTsconfigPath)
  const compilerOptions = isRecord(tsconfig) ? tsconfig["compilerOptions"] : undefined
  const plugins = isRecord(compilerOptions) ? compilerOptions["plugins"] : undefined
  const effectPlugin = isArray(plugins)
    ? plugins.find((entry) => isRecord(entry) && entry["name"] === "@effect/language-service")
    : undefined
  const overrides = isRecord(effectPlugin) ? effectPlugin["diagnosticSeverity"] : undefined
  if (!isRecord(overrides)) {
    throw new Error(
      `${effectTsconfigPath} must define compilerOptions.plugins["@effect/language-service"].diagnosticSeverity`
    )
  }

  /** @type {Record<string, "error" | "off">} */
  const rules = {}
  let enabledCount = 0
  for (const name of Object.keys(properties).sort()) {
    const property = properties[name]
    const schemaDefault = isRecord(property) && typeof property["default"] === "string" ? property["default"] : "off"
    const override = overrides[name]
    const severity = typeof override === "string" ? override : schemaDefault
    const mapped = severity === "error" || severity === "warning" ? "error" : "off"
    rules[`effecttsgo/${toKebab(name)}`] = mapped
    if (mapped === "error") enabledCount += 1
  }
  if (enabledCount === 0) {
    throw new Error(`derived Effect oxlint config from ${effectTsconfigPath} has no enabled effecttsgo/* rules`)
  }
  return rules
}

/**
 * Build the embedded oxlint JSON text from `.oxlintrc.json`, `tsconfig.plugins.json` and the
 * `@effect/tsgo` schema.
 *
 * @param {string} root
 * @returns {string}
 */
export const deriveEmbeddedOxlintConfigText = (root) => {
  const base = readJson(path.join(root, BASE_OXLINT_CONFIG))
  if (!isRecord(base)) {
    throw new Error(`${BASE_OXLINT_CONFIG} must be a JSON object`)
  }
  const basePlugins = isArray(base["plugins"]) ? base["plugins"] : []
  const plugins = basePlugins.includes("effecttsgo") ? basePlugins : [...basePlugins, "effecttsgo"]
  const baseRules = isRecord(base["rules"]) ? base["rules"] : {}
  return `${JSON.stringify({ ...base, plugins, rules: { ...baseRules, ...deriveEffectRules(root) } }, null, 2)}\n`
}

/**
 * Write the derived config into the git-ignored `.oxlintrc.effect.generated.json` (only when it
 * changed) and return its path.
 *
 * @param {string} root
 * @returns {string}
 */
export const ensureEmbeddedOxlintConfig = (root) => {
  const target = path.join(root, DERIVED_OXLINT_CONFIG)
  const nextText = deriveEmbeddedOxlintConfigText(root)
  if (existsSync(target) && readFileSync(target, "utf8") === nextText) {
    return target
  }
  mkdirSync(path.dirname(target), { recursive: true })
  const tmp = `${target}.${process.pid}.tmp`
  writeFileSync(tmp, nextText)
  renameSync(tmp, target)
  return target
}
