import { Schema, SchemaAST, SchemaIssue } from "effect"
import type * as I18n from "../i18n/I18n.ts"

const isRecord = (u: unknown): u is Readonly<Record<string, unknown>> => typeof u === "object" && u !== null

const readAnnotationString = (u: unknown, key: string): string | undefined => {
  if (!isRecord(u)) return undefined
  const value = u[key]
  return typeof value === "string" ? value : undefined
}

const readAnnotationNumber = (u: unknown, key: string): number | undefined => {
  if (!isRecord(u)) return undefined
  const value = u[key]
  return typeof value === "number" ? value : undefined
}

const reportedInput = (issue: SchemaIssue.Issue): unknown => (SchemaIssue.hasInput(issue) ? issue.input : undefined)

const formatReportedValue = (value: unknown): string => {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value)
  }
  try {
    return JSON.stringify(value) ?? "object"
  } catch {
    return "object"
  }
}

interface FilterMeta {
  readonly tag: string | undefined
  readonly payload: unknown
  readonly message: unknown
  readonly identifier: string | undefined
}

const extractFilterMeta = (filter: SchemaAST.Filter<unknown>): FilterMeta => {
  const annotations: unknown = filter.annotations
  if (!isRecord(annotations)) {
    return { tag: undefined, payload: undefined, message: undefined, identifier: undefined }
  }
  const rep = annotations["representation"]
  let tag: string | undefined
  let payload: unknown
  if (isRecord(rep) && typeof rep["id"] === "string") {
    tag = rep["id"].replace(/^effect\/schema\//, "")
    payload = rep["payload"]
  }
  const identifier = typeof annotations["identifier"] === "string" ? annotations["identifier"] : undefined
  return {
    tag,
    payload,
    message: annotations["message"],
    identifier
  }
}

/**
 * Builds localized Effect v4 `SchemaIssue.makeFormatterStandardSchemaV1` hooks
 * (modeled after `effect-app/vue-components` `OmegaForm/validation/localized.ts`).
 *
 * Explicit filter `message` overrides (already translated when schemas are built
 * with a `TranslateFn`, or explicit domain messages) take precedence over
 * generic structural translations so custom business errors remain specific.
 */
export const makeLocalizedHooks = (
  t: I18n.TranslateFn
): {
  readonly leafHook: SchemaIssue.LeafHook
  readonly checkHook: SchemaIssue.CheckHook
} => {
  const leafHook: SchemaIssue.LeafHook = (issue) => {
    const ast = "ast" in issue ? issue.ast : undefined
    const astMessage = ast === undefined ? undefined : readAnnotationString(ast.annotations, "message")
    if (astMessage !== undefined) return astMessage

    switch (issue._tag) {
      case "MissingKey":
        return t("validation.empty")
      case "InvalidType": {
        const input = reportedInput(issue)
        if (input === undefined) return t("validation.empty")
        if (SchemaAST.isString(issue.ast)) return t("validation.empty")
        if (SchemaAST.isBoolean(issue.ast)) return t("validation.booleanExpected")
        if (SchemaAST.isNumber(issue.ast)) {
          return t("validation.numberExpected", { actualValue: formatReportedValue(input) })
        }
        return t("validation.invalidValue")
      }
      case "InvalidValue":
        return SchemaIssue.defaultLeafHook(issue)
      default:
        return t("validation.invalidValue")
    }
  }

  const checkHook: SchemaIssue.CheckHook = (issue) => {
    const meta = extractFilterMeta(issue.filter)
    // Preserve explicit custom filter messages when present.
    if (typeof meta.message === "string" && meta.message.length > 0) {
      return meta.message
    }
    if (meta.identifier === "Email") {
      return t("validation.emailInvalid")
    }
    switch (meta.tag) {
      case "isMinLength": {
        const minLength = readAnnotationNumber(meta.payload, "minLength")
        if (minLength === undefined) break
        return minLength === 1 ? t("validation.empty") : t("validation.stringMinLength", { minLength })
      }
      case "isMaxLength": {
        const maxLength = readAnnotationNumber(meta.payload, "maxLength")
        if (maxLength === undefined) break
        return t("validation.stringMaxLength", { maxLength })
      }
      case "isTrimmed":
        return t("validation.stringTrimmed")
      case "isPattern":
        return t("validation.stringPattern")
      case "isInt": {
        const input = reportedInput(issue)
        return t("validation.integerExpected", {
          actualValue: input === undefined ? "NaN" : formatReportedValue(input)
        })
      }
      case "isGreaterThanOrEqualTo": {
        const minimum = readAnnotationNumber(meta.payload, "minimum")
        if (minimum === undefined) break
        return t("validation.numberMin", { minimum })
      }
      case "isGreaterThan": {
        const minimum = readAnnotationNumber(meta.payload, "exclusiveMinimum")
        if (minimum === undefined) break
        return t("validation.numberMinExclusive", { minimum })
      }
      case "isLessThanOrEqualTo": {
        const maximum = readAnnotationNumber(meta.payload, "maximum")
        if (maximum === undefined) break
        return t("validation.numberMax", { maximum })
      }
      case "isLessThan": {
        const maximum = readAnnotationNumber(meta.payload, "exclusiveMaximum")
        if (maximum === undefined) break
        return t("validation.numberMaxExclusive", { maximum })
      }
      case "isBetween": {
        const minimum = readAnnotationNumber(meta.payload, "minimum")
        const maximum = readAnnotationNumber(meta.payload, "maximum")
        if (minimum === undefined || maximum === undefined) break
        const input = reportedInput(issue)
        if (typeof input === "number" && input < minimum) {
          return t("validation.numberMin", { minimum })
        }
        return t("validation.numberMax", { maximum })
      }
    }
    return SchemaIssue.defaultCheckHook(issue)
  }

  return { leafHook, checkHook }
}

const isLiteralUnion = (ast: SchemaAST.AST): ast is SchemaAST.Union<SchemaAST.Literal> =>
  SchemaAST.isUnion(ast) && ast.types.every(SchemaAST.isLiteral)

const walkAnnotateUnions = (ast: SchemaAST.AST, t: I18n.TranslateFn): SchemaAST.AST => {
  if (isLiteralUnion(ast)) {
    if (ast.annotations?.message !== undefined) return ast
    const values = ast.types.map((member) => String(member.literal)).join(", ")
    return new SchemaAST.Union(
      ast.types,
      ast.options,
      {
        ...ast.annotations,
        message: t("validation.literalOneOf", { values })
      },
      ast.checks,
      ast.encoding,
      ast.context,
      ast.encodingChecks
    )
  }

  if (SchemaAST.isUnion(ast)) {
    const nextTypes = ast.types.map((member) => walkAnnotateUnions(member, t))
    const changed = nextTypes.some((next, idx) => next !== ast.types[idx])
    if (!changed) return ast
    return new SchemaAST.Union(
      nextTypes,
      ast.options,
      ast.annotations,
      ast.checks,
      ast.encoding,
      ast.context,
      ast.encodingChecks
    )
  }

  if (SchemaAST.isArrays(ast)) {
    const nextElements = ast.elements.map((el) => walkAnnotateUnions(el, t))
    const nextRest = ast.rest.map((el) => walkAnnotateUnions(el, t))
    let annotations = ast.annotations
    const firstRest = ast.rest[0]
    if (
      annotations?.message === undefined &&
      ast.rest.length === 1 &&
      firstRest !== undefined &&
      isLiteralUnion(firstRest)
    ) {
      const values = firstRest.types.map((member) => String(member.literal)).join(", ")
      annotations = {
        ...annotations,
        message: t("validation.literalOneOf", { values })
      }
    }
    const elementsChanged = nextElements.some((next, idx) => next !== ast.elements[idx])
    const restChanged = nextRest.some((next, idx) => next !== ast.rest[idx])
    if (!elementsChanged && !restChanged && annotations === ast.annotations) return ast
    return new SchemaAST.Arrays(
      ast.isMutable,
      nextElements,
      nextRest,
      annotations,
      ast.checks,
      ast.encoding,
      ast.context,
      ast.encodingChecks
    )
  }

  if (SchemaAST.isObjects(ast)) {
    const nextProps = ast.propertySignatures.map((prop) => {
      const nextType = walkAnnotateUnions(prop.type, t)
      return nextType === prop.type ? prop : new SchemaAST.PropertySignature(prop.name, nextType)
    })
    const changed = nextProps.some((next, idx) => next !== ast.propertySignatures[idx])
    if (!changed) return ast
    return new SchemaAST.Objects(
      nextProps,
      ast.indexSignatures,
      ast.annotations,
      ast.checks,
      ast.encoding,
      ast.context,
      ast.encodingChecks
    )
  }

  return ast
}

/**
 * Stamps localized `message` annotations onto literal unions (for example
 * `Schema.Literals(["15", "30", "60"])`) so `AnyOf` union issues format cleanly
 * instead of falling back to English `Expected ...` strings.
 */
export const annotateLiteralUnionMessages = <S extends Schema.Top>(schema: S, t: I18n.TranslateFn): S => {
  const nextAst = walkAnnotateUnions(schema.ast, t)
  return nextAst === schema.ast ? schema : Schema.make<S>(nextAst)
}
