import { type Schema, SchemaAST } from "effect"

export interface FieldMeta {
  readonly label: string
  readonly description: string | undefined
  readonly required: boolean
}

export interface ResolveLabelOptions {
  readonly formLabel?: string | undefined
  readonly formatItemLabel?: ((index: number, label: string) => string) | undefined
}

const isRecord = (u: unknown): u is Readonly<Record<string, unknown>> => typeof u === "object" && u !== null

const readStringAnnotation = (annotations: unknown, key: "title" | "description"): string | undefined => {
  if (!isRecord(annotations)) return undefined
  const value = annotations[key]
  return typeof value === "string" ? value : undefined
}

const defaultFormatItemLabel = (index: number, label: string): string => `Item #${index} · ${label}`

/**
 * Converts a camelCase / snake_case / kebab-case identifier or dotted path
 * into a readable field label (for example `projectCode` -> `"Project code"`).
 */
export const humanizeKey = (key: string, options: ResolveLabelOptions = {}): string => {
  const segments = key.split(".").filter((segment) => segment.length > 0)
  if (segments.length === 0) return options.formLabel ?? "Form"

  const last = segments[segments.length - 1] ?? key
  const words = last
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
  const formatted = words.length === 0 ? last : words.charAt(0).toUpperCase() + words.slice(1)

  const numericSegment = segments.find((segment) => /^\d+$/.test(segment))
  if (numericSegment !== undefined) {
    const formatItem = options.formatItemLabel ?? defaultFormatItemLabel
    return formatItem(Number(numericSegment) + 1, formatted)
  }
  return formatted
}

const allowsNullish = (ast: SchemaAST.AST): boolean => {
  if (SchemaAST.isNull(ast) || SchemaAST.isUndefined(ast)) return true
  if (SchemaAST.isUnion(ast)) return ast.types.some(allowsNullish)
  return false
}

const walkAst = (
  ast: SchemaAST.AST,
  prefix: string,
  parentRequired: boolean,
  out: Record<string, FieldMeta>,
  seenSuspends: ReadonlySet<SchemaAST.AST>
): void => {
  if (SchemaAST.isSuspend(ast)) {
    if (seenSuspends.has(ast)) return
    walkAst(ast.thunk(), prefix, parentRequired, out, new Set([...seenSuspends, ast]))
    return
  }

  if (SchemaAST.isObjects(ast)) {
    for (const prop of ast.propertySignatures) {
      if (typeof prop.name !== "string") continue
      const fieldPath = prefix === "" ? prop.name : `${prefix}.${prop.name}`
      const isOptional = prop.type.context?.isOptional === true || allowsNullish(prop.type)
      const propRequired = parentRequired && !isOptional
      const resolved = SchemaAST.resolve(prop.type)
      const title =
        readStringAnnotation(resolved, "title") ??
        readStringAnnotation(prop.type.annotations, "title") ??
        readStringAnnotation(prop.type.context?.annotations, "title")
      const description =
        readStringAnnotation(resolved, "description") ??
        readStringAnnotation(prop.type.annotations, "description") ??
        readStringAnnotation(prop.type.context?.annotations, "description")

      const existing = out[fieldPath]
      if (existing === undefined) {
        out[fieldPath] = {
          label: title ?? humanizeKey(prop.name),
          description,
          required: propRequired
        }
      } else {
        out[fieldPath] = {
          label: title ?? existing.label,
          description: description ?? existing.description,
          required: existing.required || propRequired
        }
      }

      walkAst(prop.type, fieldPath, propRequired, out, seenSuspends)
    }
    return
  }

  if (SchemaAST.isUnion(ast)) {
    for (const member of ast.types) {
      if (!SchemaAST.isNull(member) && !SchemaAST.isUndefined(member)) {
        walkAst(member, prefix, parentRequired, out, seenSuspends)
      }
    }
    return
  }

  if (SchemaAST.isArrays(ast)) {
    for (const [index, element] of ast.elements.entries()) {
      const elementPath = prefix === "" ? String(index) : `${prefix}.${index}`
      walkAst(element, elementPath, parentRequired, out, seenSuspends)
    }
    const restElement = ast.rest[0]
    if (restElement !== undefined) {
      const wildcardPrefix = prefix === "" ? "*" : `${prefix}.*`
      walkAst(restElement, wildcardPrefix, parentRequired, out, seenSuspends)
    }
  }
}

/**
 * Inspects an Effect Schema AST once to extract display metadata (`label`,
 * `description`, `required`) keyed by dotted field paths, including union
 * branches and `array.*` item fields.
 */
export const extractFieldMetaMap = (schema: Schema.Top): Readonly<Record<string, FieldMeta>> => {
  const out: Record<string, FieldMeta> = {}
  walkAst(schema.ast, "", true, out, new Set())
  return out
}

/**
 * Resolves a human-readable label for a concrete dotted field path (such as
 * `"items.1.sku"` -> `"Item #2 · SKU"` or `"billing.poNumber"` -> `"PO number"`).
 */
export const resolveFieldLabel = (
  metaMap: Readonly<Record<string, FieldMeta>>,
  path: string,
  options: ResolveLabelOptions = {}
): string => {
  if (path === "") return options.formLabel ?? "Form"
  const exact = metaMap[path]
  if (exact !== undefined) return exact.label

  const segments = path.split(".")
  const numericSegment = segments.find((segment) => /^\d+$/.test(segment))
  const wildcardPath = segments.map((segment) => (/^\d+$/.test(segment) ? "*" : segment)).join(".")
  const wildcard = metaMap[wildcardPath]
  if (wildcard !== undefined) {
    if (numericSegment === undefined) return wildcard.label
    const formatItem = options.formatItemLabel ?? defaultFormatItemLabel
    return formatItem(Number(numericSegment) + 1, wildcard.label)
  }

  return humanizeKey(path, options)
}
