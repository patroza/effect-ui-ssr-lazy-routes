// Single source of truth for loading JSONC oxlint configs and embedding Effect
// language-service diagnostics into Vite+ (`effect-tsgo vp check` / `effect-tsgo vp lint`).
// Derives all `effecttsgo/*` rule severities from `tsconfig.plugins.json` +
// `node_modules/@effect/tsgo/schema.json` directly for `vite.config.ts`.
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

const EFFECT_TSCONFIG = "tsconfig.plugins.json"

/** @typedef {import("vite-plus/lint").AllowWarnDeny} AllowWarnDeny */
/** @typedef {import("vite-plus/lint").DummyRule} DummyRule */
/** @typedef {import("vite-plus/lint").ExternalPluginEntry} ExternalPluginEntry */
/** @typedef {import("vite-plus/lint").OxlintConfig} OxlintConfig */
/** @typedef {NonNullable<OxlintConfig["plugins"]>[number]} LintPlugin */

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
 * @param {unknown} value
 * @returns {value is AllowWarnDeny}
 */
const isAllowWarnDeny = (value) =>
  value === "allow" ||
  value === "off" ||
  value === "warn" ||
  value === "error" ||
  value === 0 ||
  value === 1 ||
  value === 2

/**
 * @param {unknown} value
 * @returns {value is DummyRule}
 */
const isDummyRule = (value) => {
  if (isAllowWarnDeny(value)) return true
  return isArray(value) && value.length > 0 && isAllowWarnDeny(value[0])
}

/**
 * @param {unknown} value
 * @returns {value is LintPlugin}
 */
const isLintPlugin = (value) =>
  value === "eslint" ||
  value === "react" ||
  value === "unicorn" ||
  value === "typescript" ||
  value === "oxc" ||
  value === "import" ||
  value === "jsdoc" ||
  value === "jest" ||
  value === "vitest" ||
  value === "jsx-a11y" ||
  value === "nextjs" ||
  value === "react-perf" ||
  value === "promise" ||
  value === "node" ||
  value === "vue"

/**
 * @param {unknown} value
 * @returns {value is ExternalPluginEntry}
 */
const isExternalPlugin = (value) =>
  typeof value === "string" ||
  (isRecord(value) && typeof value["name"] === "string" && typeof value["specifier"] === "string")

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
 * Strip `//` and `/* ... *\/` comments from JSONC while preserving string literals.
 *
 * @param {string} input
 * @returns {string}
 */
const stripJsonComments = (input) => {
  let out = ""
  let inString = false
  let escaped = false
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    const next = input[i + 1]
    if (inString) {
      out += ch
      if (escaped) {
        escaped = false
      } else if (ch === "\\") {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === "/" && next === "/") {
      i += 2
      while (i < input.length && input[i] !== "\n") i += 1
      if (i < input.length) out += "\n"
      continue
    }
    if (ch === "/" && next === "*") {
      i += 2
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) i += 1
      i += 1
      continue
    }
    out += ch
  }
  return out
}

/**
 * @param {string} filePath
 * @returns {unknown}
 */
const readJson = (filePath) => JSON.parse(stripJsonComments(readFileSync(filePath, "utf8")))

const ALLOWED_OXLINT_TOP_LEVEL_KEYS = new Set([
  "$schema",
  "extends",
  "ignorePatterns",
  "plugins",
  "jsPlugins",
  "categories",
  "options",
  "rules"
])

/**
 * Load an Oxlint JSON/JSONC config file as a typed `OxlintConfig` object for `vite.config.ts`
 * `lint.extends`. Fails closed on unknown top-level keys, unknown plugin names, unknown
 * categories/options, or malformed rule values.
 *
 * @param {string} filePath
 * @returns {OxlintConfig}
 */
export const loadOxlintJsonConfig = (filePath) => {
  const raw = readJson(filePath)
  if (!isRecord(raw)) {
    throw new Error(`${filePath} must be a JSON object`)
  }
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_OXLINT_TOP_LEVEL_KEYS.has(key)) {
      throw new Error(`${filePath} has unsupported top-level key "${key}"`)
    }
  }
  /** @type {OxlintConfig} */
  const config = {}

  if ("plugins" in raw) {
    if (!isArray(raw["plugins"])) {
      throw new Error(`${filePath}: "plugins" must be an array`)
    }
    /** @type {Array<LintPlugin>} */
    const plugins = []
    for (const entry of raw["plugins"]) {
      if (!isLintPlugin(entry)) {
        throw new Error(`${filePath}: unsupported oxlint plugin ${JSON.stringify(entry)}`)
      }
      plugins.push(entry)
    }
    config.plugins = plugins
  }

  if ("jsPlugins" in raw) {
    if (!isArray(raw["jsPlugins"])) {
      throw new Error(`${filePath}: "jsPlugins" must be an array`)
    }
    /** @type {Array<ExternalPluginEntry>} */
    const jsPlugins = []
    for (const entry of raw["jsPlugins"]) {
      if (!isExternalPlugin(entry)) {
        throw new Error(`${filePath}: invalid jsPlugin entry ${JSON.stringify(entry)}`)
      }
      jsPlugins.push(entry)
    }
    config.jsPlugins = jsPlugins
  }

  if ("categories" in raw) {
    if (!isRecord(raw["categories"])) {
      throw new Error(`${filePath}: "categories" must be an object`)
    }
    /** @type {NonNullable<OxlintConfig["categories"]>} */
    const categories = {}
    for (const [key, value] of Object.entries(raw["categories"])) {
      if (!isAllowWarnDeny(value)) {
        throw new Error(`${filePath}: invalid severity for category "${key}": ${JSON.stringify(value)}`)
      }
      if (key === "correctness") categories.correctness = value
      else if (key === "nursery") categories.nursery = value
      else if (key === "pedantic") categories.pedantic = value
      else if (key === "perf") categories.perf = value
      else if (key === "restriction") categories.restriction = value
      else if (key === "style") categories.style = value
      else if (key === "suspicious") categories.suspicious = value
      else throw new Error(`${filePath}: unsupported category "${key}"`)
    }
    config.categories = categories
  }

  if ("options" in raw) {
    if (!isRecord(raw["options"])) {
      throw new Error(`${filePath}: "options" must be an object`)
    }
    /** @type {NonNullable<OxlintConfig["options"]>} */
    const options = {}
    for (const [key, value] of Object.entries(raw["options"])) {
      if (typeof value !== "boolean") {
        throw new Error(`${filePath}: option "${key}" must be a boolean`)
      }
      if (key === "typeAware") options.typeAware = value
      else if (key === "typeCheck") options.typeCheck = value
      else if (key === "denyWarnings") options.denyWarnings = value
      else throw new Error(`${filePath}: unsupported option "${key}"`)
    }
    config.options = options
  }

  if ("rules" in raw) {
    if (!isRecord(raw["rules"])) {
      throw new Error(`${filePath}: "rules" must be an object`)
    }
    /** @type {Record<string, DummyRule>} */
    const rules = {}
    for (const [key, value] of Object.entries(raw["rules"])) {
      if (!isDummyRule(value)) {
        throw new Error(`${filePath}: malformed rule value for "${key}": ${JSON.stringify(value)}`)
      }
      rules[key] = value
    }
    config.rules = rules
  }

  return config
}

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
