// Ported from `oxlint-plugin-t3code` (pure ESM JS with strict JSDoc types, zero runtime dependencies):
// - require-suppression-reason
// - no-inline-schema-compile
// - no-manual-effect-runtime-in-tests
// - no-test-in-loop
// - no-outset-state-indicators
// - no-unscoped-has

/**
 * @typedef {Record<string, unknown> & { type: string; parent?: AstNode | undefined }} AstNode
 * @typedef {{ loc: { start: { line: number; column: number }; end: { line: number } }; value: string }} CommentNode
 * @typedef {{ type: string; node: AstNode; justification?: string | undefined }} DisableDirective
 * @typedef {{ getAllComments(): readonly CommentNode[]; lines: readonly string[]; text: string; getDisableDirectives(): { directives: readonly DisableDirective[] } }} RuleSourceCode
 * @typedef {{ filename: string; options: readonly unknown[]; sourceCode: RuleSourceCode; report(descriptor: { node?: unknown; loc?: unknown; message: string }): void }} RuleContext
 */

const WRAPPERS = new Set([
  "ChainExpression",
  "ParenthesizedExpression",
  "TSNonNullExpression",
  "TSAsExpression",
  "TSTypeAssertion"
])

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v)

/** @param {unknown} v @returns {v is readonly unknown[]} */
const isUnknownArray = (v) => Array.isArray(v)

/** @param {unknown} node @returns {node is AstNode} */
const isAstNode = (node) => isRecord(node) && typeof node["type"] === "string"

/** @param {unknown} node @returns {AstNode | undefined} */
const asAstNode = (node) => (isAstNode(node) ? node : undefined)

/** @param {unknown} node @returns {node is { loc: { start: { line: number } } }} */
const hasLocStartLine = (node) =>
  isRecord(node) &&
  isRecord(node["loc"]) &&
  isRecord(node["loc"]["start"]) &&
  typeof node["loc"]["start"]["line"] === "number"

/** @param {unknown} node @returns {AstNode | undefined} */
const unwrapExpression = (node) => {
  let current = asAstNode(node)
  while (current !== undefined && WRAPPERS.has(current.type)) {
    current = asAstNode(current["expression"])
  }
  return current
}

/** @param {unknown} node @returns {string | undefined} */
const getPropertyName = (node) => {
  const expr = asAstNode(node)
  if (expr === undefined) return undefined
  if ((expr.type === "Identifier" || expr.type === "PrivateIdentifier") && typeof expr["name"] === "string") {
    return expr["name"]
  }
  if (expr.type === "Literal" && typeof expr["value"] === "string") return expr["value"]
  return undefined
}

/** @param {AstNode | undefined} node @param {string=} name @returns {boolean} */
const isIdentifier = (node, name) =>
  node !== undefined &&
  node.type === "Identifier" &&
  typeof node["name"] === "string" &&
  (name === undefined || node["name"] === name)

// 1. require-suppression-reason
const DIRECTIVE_PATTERN =
  /^\s*\*?\s*(?:(?:oxlint|eslint)-(?:disable|enable)|@ts-(?:expect-error|ignore|nocheck)|@effect-diagnostics)/u
const TS_DIRECTIVE_PATTERN = /^\s*\*?\s*@ts-(?:expect-error|ignore|nocheck)(?![\w-])(.*)$/su
const EMPTY_COMMENT_PATTERN = /^[\s*]*$/u

const requireSuppressionReason = {
  meta: {
    type: "suggestion",
    docs: { description: "Require every lint or type-checker suppression to say why." },
    schema: []
  },
  /** @param {RuleContext} context */
  create(context) {
    const { sourceCode } = context
    return {
      Program() {
        const comments = sourceCode.getAllComments()
        /** @type {Map<number, CommentNode>} */
        const ownLineCommentsByEndLine = new Map()
        for (const comment of comments) {
          const { line, column } = comment.loc.start
          if ((sourceCode.lines[line - 1] ?? "").slice(0, column).trim() === "") {
            ownLineCommentsByEndLine.set(comment.loc.end.line, comment)
          }
        }
        /** @param {{ loc: { start: { line: number } } }} directive */
        const explainedAbove = (directive) => {
          let above = ownLineCommentsByEndLine.get(directive.loc.start.line - 1)
          while (above && (DIRECTIVE_PATTERN.test(above.value) || EMPTY_COMMENT_PATTERN.test(above.value))) {
            above = ownLineCommentsByEndLine.get(above.loc.start.line - 1)
          }
          return above !== undefined
        }
        for (const directive of sourceCode.getDisableDirectives().directives) {
          if (
            directive.type === "enable" ||
            (directive.justification !== undefined && directive.justification.trim() !== "")
          ) {
            continue
          }
          if (hasLocStartLine(directive.node) && explainedAbove(directive.node)) {
            continue
          }
          context.report({
            loc: directive.node["loc"],
            message: "Say why: end the directive with `-- reason` or put a comment on the line above."
          })
        }
        for (const comment of comments) {
          const after = TS_DIRECTIVE_PATTERN.exec(comment.value)?.[1]
          if (after === undefined || after.replace(/^[\s:-]+/u, "").trim() !== "") continue
          if (explainedAbove(comment)) continue
          context.report({
            loc: comment.loc,
            message: "Say why: write the reason after the directive or in a comment on the line above."
          })
        }
      }
    }
  }
}

// 2. no-inline-schema-compile
const COMPILER_METHODS = new Set([
  "is",
  "asserts",
  "decodeEffect",
  "decodeExit",
  "decodeOption",
  "decodePromise",
  "decodeResult",
  "decodeSync",
  "decodeUnknownExit",
  "decodeUnknownEffect",
  "decodeUnknownOption",
  "decodeUnknownPromise",
  "decodeUnknownResult",
  "decodeUnknownSync",
  "encodeExit",
  "encodeEffect",
  "encodeOption",
  "encodePromise",
  "encodeResult",
  "encodeSync",
  "encodeUnknownExit",
  "encodeUnknownEffect",
  "encodeUnknownOption",
  "encodeUnknownPromise",
  "encodeUnknownResult",
  "encodeUnknownSync"
])

/** @param {unknown} callee @returns {string | undefined} */
const getSchemaCompilerMethod = (callee) => {
  const expr = unwrapExpression(callee)
  if (expr === undefined || expr.type !== "MemberExpression") return undefined
  const obj = unwrapExpression(expr["object"])
  if (!isIdentifier(obj, "Schema")) return undefined
  const method = getPropertyName(expr["property"])
  return method !== undefined && COMPILER_METHODS.has(method) ? method : undefined
}

/** @param {unknown} node @returns {boolean} */
const isStaticSchemaReference = (node) => {
  const expr = unwrapExpression(node)
  if (expr === undefined) return false
  if (expr.type === "Identifier" && typeof expr["name"] === "string") {
    const first = expr["name"][0]
    return first !== undefined && first.toUpperCase() === first
  }
  return expr.type === "MemberExpression"
}

/** @param {unknown} node @returns {boolean} */
const isNestedStaticSchemaCall = (node) => {
  const expr = unwrapExpression(node)
  if (expr === undefined || expr.type !== "CallExpression") return false
  const callee = unwrapExpression(expr["callee"])
  if (callee === undefined || callee.type !== "MemberExpression") return false
  const method = getPropertyName(callee["property"])
  if (
    method === "jsonString" ||
    (isIdentifier(unwrapExpression(callee["object"]), "Schema") && method === "fromJsonString")
  ) {
    const args = isUnknownArray(expr["arguments"]) ? expr["arguments"] : []
    const firstArg = args[0]
    return isStaticSchemaReference(firstArg) || isNestedStaticSchemaCall(firstArg)
  }
  return isIdentifier(unwrapExpression(callee["object"]), "Schema")
}

/** @param {unknown} node @returns {boolean} */
const isImmediatelyInvoked = (node) => {
  const expr = unwrapExpression(node)
  if (expr === undefined || !("parent" in expr)) return false
  const parent = unwrapExpression(expr.parent)
  return parent !== undefined && parent.type === "CallExpression" && unwrapExpression(parent["callee"]) === expr
}

const noInlineSchemaCompile = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow Schema decoder/encoder compiler calls inside function bodies; hoist them to module scope."
    },
    schema: []
  },
  /** @param {RuleContext} context */
  create(context) {
    let functionDepth = 0
    const enterFunction = () => {
      functionDepth++
    }
    const exitFunction = () => {
      functionDepth--
    }
    return {
      FunctionDeclaration: enterFunction,
      "FunctionDeclaration:exit": exitFunction,
      FunctionExpression: enterFunction,
      "FunctionExpression:exit": exitFunction,
      ArrowFunctionExpression: enterFunction,
      "ArrowFunctionExpression:exit": exitFunction,
      /** @param {AstNode} node */
      CallExpression(node) {
        if (functionDepth === 0) return
        const method = getSchemaCompilerMethod(node["callee"])
        if (method === undefined || !isImmediatelyInvoked(node)) return
        const args = isUnknownArray(node["arguments"]) ? node["arguments"] : []
        const firstArg = args[0]
        const high = firstArg !== undefined && isNestedStaticSchemaCall(firstArg)
        if (!high && !isStaticSchemaReference(firstArg)) return
        context.report({
          node: node["callee"],
          message: high
            ? `Hoist Schema.${method}(...) to module scope: both the inline schema literal and the compiled function are rebuilt on every call.`
            : `Hoist Schema.${method}(...) to module scope: the compiled function is rebuilt on every call.`
        })
      }
    }
  }
}

// 3. no-manual-effect-runtime-in-tests
const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/u
const EFFECT_RUNTIME_METHODS = new Set([
  "runCallback",
  "runCallbackWith",
  "runFork",
  "runForkWith",
  "runPromise",
  "runPromiseExit",
  "runPromiseExitWith",
  "runPromiseWith",
  "runSync",
  "runSyncExit",
  "runSyncExitWith",
  "runSyncWith"
])

/** @param {readonly unknown[]} options @returns {number} */
const readMaxOccurrences = (options) => {
  const first = options[0]
  return isRecord(first) && typeof first["maxOccurrences"] === "number" ? first["maxOccurrences"] : 0
}

/** @param {AstNode} node @returns {string | undefined} */
const manualRunnerName = (node) => {
  const obj = unwrapExpression(node["object"])
  const prop = getPropertyName(node["property"])
  if (prop === undefined) return undefined
  if (isIdentifier(obj, "Effect") && EFFECT_RUNTIME_METHODS.has(prop)) return `Effect.${prop}`
  if (isIdentifier(obj, "ManagedRuntime") && prop === "make") return "ManagedRuntime.make"
  return undefined
}

const noManualEffectRuntimeInTests = {
  meta: {
    type: "problem",
    docs: { description: "Disallow manually creating or running Effect runtimes in tests; use @effect/vitest." },
    schema: [
      {
        type: "object",
        properties: { maxOccurrences: { type: "integer", minimum: 0 } },
        additionalProperties: false
      }
    ],
    defaultOptions: [{ maxOccurrences: 0 }]
  },
  /** @param {RuleContext} context */
  create(context) {
    if (!TEST_FILE_PATTERN.test(context.filename)) return {}
    const allowedCount = readMaxOccurrences(context.options)
    let occurrenceCount = 0
    return {
      /** @param {AstNode} node */
      MemberExpression(node) {
        const runner = manualRunnerName(node)
        if (runner === undefined) return
        occurrenceCount++
        if (occurrenceCount <= allowedCount) return
        context.report({
          node,
          message: `Do not use ${runner} in tests. Use @effect/vitest with it.effect(...) and test layers instead.`
        })
      }
    }
  }
}

// 4. no-test-in-loop
const NODE_TEST_IMPORT_PATTERN = /["']node:test["']/u
const TEST_FUNCTIONS = new Set(["describe", "it", "suite", "test"])
const EACH_CAPABLE_MODIFIERS = new Set(["effect", "live"])
const LOOPS = new Set(["ForStatement", "ForInStatement", "ForOfStatement"])
const FUNCTIONS = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"])

/** @param {unknown} callee @returns {string | undefined} */
const testCallName = (callee) => {
  const expr = unwrapExpression(callee)
  if (expr === undefined) return undefined
  if (expr.type === "Identifier" && typeof expr["name"] === "string") {
    return TEST_FUNCTIONS.has(expr["name"]) ? expr["name"] : undefined
  }
  if (expr.type !== "MemberExpression") return undefined
  const obj = unwrapExpression(expr["object"])
  const prop = getPropertyName(expr["property"])
  if (obj === undefined || prop === undefined || !EACH_CAPABLE_MODIFIERS.has(prop)) return undefined
  if (obj.type !== "Identifier" || typeof obj["name"] !== "string" || !TEST_FUNCTIONS.has(obj["name"])) {
    return undefined
  }
  return `${obj["name"]}.${prop}`
}

/** @param {AstNode} node @returns {boolean} */
const isInsideLoop = (node) => {
  let current = node.parent
  while (current) {
    if (LOOPS.has(current.type)) return true
    if (FUNCTIONS.has(current.type)) return false
    current = current.parent
  }
  return false
}

const noTestInLoop = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow declaring tests inside a for loop; use it.each / it.effect.each / describe.each instead."
    },
    schema: []
  },
  /** @param {RuleContext} context */
  create(context) {
    if (!TEST_FILE_PATTERN.test(context.filename)) return {}
    if (NODE_TEST_IMPORT_PATTERN.test(context.sourceCode.text)) return {}
    return {
      /** @param {AstNode} node */
      CallExpression(node) {
        const name = testCallName(node["callee"])
        if (name === undefined || !isInsideLoop(node)) return
        context.report({
          node: node["callee"],
          message: `Do not call ${name}(...) inside a for loop. Use ${name}.each(cases)(name, ...) instead.`
        })
      }
    }
  }
}

// 5. no-outset-state-indicators
const CLASS_COMPOSERS = new Set(["cn", "cx", "clsx", "classNames", "cva", "twMerge"])
const STATE_VARIANT = /(?:^|[^\w])(?:focus(?:-visible|-within)?|selected|checked|pressed)(?=$|[^\w])/u
const RING_WIDTH = /^ring(?:-(?:[1-9]\d*|\[[^\]]+\]|\(length:[^)]+\)))?$/u
const OUTLINE_WIDTH = /^outline-(?:(\d+)|\[(?:length:)?(\d+(?:\.\d+)?)px\])$/u
const INWARD_OFFSET = /^-outline-offset-(\d+)$/u

/** @typedef {{ readonly variants: readonly string[]; readonly utility: string }} ParsedClass */

/** @param {string} token @returns {ParsedClass} */
function parseClass(token) {
  /** @type {string[]} */
  const variants = []
  let depth = 0
  let start = 0
  for (let index = 0; index < token.length; index++) {
    const character = token[index]
    if (character === "[" || character === "(") depth++
    else if (character === "]" || character === ")") depth--
    else if (character === ":" && depth === 0) {
      variants.push(token.slice(start, index))
      start = index + 1
    }
  }
  return { variants, utility: token.slice(start).replace(/^!|!$/gu, "") }
}

/** @param {ParsedClass} companion @param {ParsedClass} indicator */
const covers = (companion, indicator) => companion.variants.every((variant) => indicator.variants.includes(variant))

/** @param {AstNode} node @returns {boolean} */
const isClassComposer = (node) => {
  if (node.type !== "CallExpression") return false
  const callee = asAstNode(node["callee"])
  if (callee === undefined) return false
  if (callee.type === "Identifier" && typeof callee["name"] === "string") {
    return CLASS_COMPOSERS.has(callee["name"])
  }
  return callee.type === "MemberExpression" && getPropertyName(callee["property"]) === "cx"
}

/** @param {unknown} node @param {string[]} out */
function collectStrings(node, out) {
  if (Array.isArray(node)) {
    for (const child of node) collectStrings(child, out)
    return
  }
  const current = asAstNode(node)
  if (current === undefined) return
  if (/^(?:Conditional|Logical|Object)Expression$/u.test(current.type)) return
  if (current.type === "CallExpression" && !isClassComposer(current)) return
  if (current.type === "Literal" && typeof current["value"] === "string") out.push(current["value"])
  if (current.type === "TemplateElement" && isRecord(current["value"])) {
    const cooked = current["value"]["cooked"]
    const raw = current["value"]["raw"]
    if (typeof cooked === "string") out.push(cooked)
    else if (typeof raw === "string") out.push(raw)
  }
  for (const [key, value] of Object.entries(current)) {
    if (key !== "parent") collectStrings(value, out)
  }
}

/** @param {AstNode} node @param {readonly ParsedClass[]} own @returns {ParsedClass[]} */
function scopeClasses(node, own) {
  /** @type {string[]} */
  const strings = []
  for (let current = node.parent; current; current = current.parent) {
    if (/Statement$|Declaration$|^JSX(?:Attribute|Element)$/u.test(current.type)) break
    if (isClassComposer(current)) collectStrings(current, strings)
  }
  return [...own, ...strings.join(" ").split(/\s+/u).map(parseClass)]
}

/** @param {string} text @param {AstNode} node @returns {string[]} */
function findOutsetOffenders(text, node) {
  const own = text.split(/\s+/u).filter(Boolean).map(parseClass)
  /** @type {string[]} */
  const found = []
  /** @type {ParsedClass[] | undefined} */
  let scope
  for (const token of own) {
    const { utility, variants } = token
    const label = [...variants, utility].join(":")
    if (/^outline-offset-|^\[outline-offset:/u.test(utility)) {
      found.push(label)
      continue
    }
    if (!STATE_VARIANT.test(variants.join(":"))) continue
    if (RING_WIDTH.test(utility)) {
      scope ??= scopeClasses(node, own)
      if (!scope.some((other) => other.utility === "ring-inset" && covers(other, token))) found.push(label)
      continue
    }
    const outline = OUTLINE_WIDTH.exec(utility)
    if (outline) {
      const width = Number(outline[1] ?? outline[2])
      if (width <= 2) continue
      scope ??= scopeClasses(node, own)
      const inward = scope.some((other) => {
        const offset = INWARD_OFFSET.exec(other.utility)
        return offset !== null && Number(offset[1]) >= width && covers(other, token)
      })
      if (!inward) found.push(label)
    }
  }
  return found
}

const noOutsetStateIndicators = {
  meta: {
    type: "problem",
    docs: {
      description: "Keep focus and selection indicators inside their element, where an ancestor cannot clip them."
    },
    schema: []
  },
  /** @param {RuleContext} context */
  create(context) {
    /** @param {AstNode} node @param {string} text */
    const check = (node, text) => {
      for (const utility of findOutsetOffenders(text, node)) {
        context.report({
          node,
          message: `${utility} paints a focus or selection indicator outside its element, where an ancestor can clip it. Add ring-inset under the same variant, drop the positive outline offset, or use a negative offset at least as wide as the outline.`
        })
      }
    }
    return {
      /** @param {AstNode} node */
      Literal(node) {
        if (typeof node["value"] === "string") check(node, node["value"])
      },
      /** @param {AstNode} node */
      TemplateLiteral(node) {
        const quasis = Array.isArray(node["quasis"]) ? node["quasis"] : []
        const text = quasis
          .map((part) => {
            if (!isRecord(part) || !isRecord(part["value"])) return ""
            return typeof part["value"]["cooked"] === "string"
              ? part["value"]["cooked"]
              : typeof part["value"]["raw"] === "string"
                ? part["value"]["raw"]
                : ""
          })
          .join(" ")
        check(node, text)
      }
    }
  }
}

// 6. no-unscoped-has
const COMBINATOR_PATTERN = /[\s>+~]/u
const NARROWING_PATTERN = /[.#[]|^[a-z]/iu
const ROOT_COMPOUND_PATTERN = /^(?:html|body|:root)(?![\w-])/iu
const GROUP_PREFIX_PATTERN = /(?:^|:)(?:group|peer)-$/u
const ANCESTOR_PREFIX_PATTERN = /(?:^|:)in-$/u
const ATTRIBUTE_PREFIX_PATTERN = /(?:^|:)(?:data|aria)-$/u
const QUOTED_PATTERN = /(["'])(?:\\.|(?!\1).)*\1/gu
const VARIANT_END_PATTERN = /^(?:\/[\w-]+)?:/u

/** @param {string} token @returns {Array<{ prefix: string; group: string }>} */
function variantGroups(token) {
  /** @type {Array<{ prefix: string; group: string }>} */
  const groups = []
  let depth = 0
  let start = -1
  for (let index = 0; index < token.length; index++) {
    const char = token[index]
    if (char === "[") {
      if (depth === 0) start = index + 1
      depth++
    } else if (char === "]" && depth > 0) {
      depth--
      if (depth === 0 && VARIANT_END_PATTERN.test(token.slice(index + 1))) {
        groups.push({ prefix: token.slice(0, start - 1), group: token.slice(start, index) })
      }
    }
  }
  return groups
}

/** @param {string} selector @param {number} open @returns {number} */
function closingParen(selector, open) {
  let depth = 0
  for (let index = open; index < selector.length; index++) {
    if (selector[index] === "(") depth++
    else if (selector[index] === ")" && --depth === 0) return index
  }
  return selector.length
}

/** @param {string} selector @param {number} from @returns {boolean} */
function isWrapperSubject(selector, from) {
  let depth = 0
  for (let index = from; index < selector.length; index++) {
    const char = selector[index] ?? ""
    if (char === "(") depth++
    else if (char === ")") {
      if (depth === 0) return true
      depth--
    } else if (depth > 0) continue
    else if (char === ",") return true
    else if (COMBINATOR_PATTERN.test(char)) {
      const next = selector.slice(index).trimStart()[0]
      if (/\s/u.test(char) && (next === undefined || next === ")" || next === ",")) continue
      return false
    }
  }
  return true
}

/** @param {string} selector @returns {string[]} */
function hasCompounds(selector) {
  /** @type {string[]} */
  const compounds = []
  let index = selector.indexOf(":has(")
  while (index !== -1) {
    let compound = ""
    let depth = 0
    let subjectEnd = closingParen(selector, index + ":has".length) + 1
    let skippingBranch = false
    for (let position = index - 1; position >= 0; position--) {
      const char = selector[position] ?? ""
      if (char === ")") depth++
      else if (char === "(") {
        if (depth > 0) depth--
        else {
          if (!isWrapperSubject(selector, subjectEnd)) break
          skippingBranch = false
          subjectEnd = closingParen(selector, position) + 1
        }
      } else if (depth === 0 && char === ",") {
        skippingBranch = true
        continue
      } else if (depth === 0 && !skippingBranch && COMBINATOR_PATTERN.test(char)) break
      if (!skippingBranch) compound = char + compound
    }
    compounds.push(compound)
    index = selector.indexOf(":has(", index + 1)
  }
  return compounds
}

/** @param {string} compound @returns {string} */
function withoutNegations(compound) {
  let result = ""
  let index = 0
  while (index < compound.length) {
    if (!compound.startsWith(":not(", index)) {
      result += compound[index]
      index++
      continue
    }
    let depth = 0
    for (index += ":not".length; index < compound.length; index++) {
      if (compound[index] === "(") depth++
      else if (compound[index] === ")" && --depth === 0) break
    }
    index++
  }
  return result
}

/** @param {string} text @returns {string[]} */
function findUnscopedHasVariants(text) {
  if (!text.toLowerCase().includes(":has(")) return []
  /** @type {string[]} */
  const offenders = []
  for (const token of text.split(/\s+/u)) {
    for (const { prefix, group } of variantGroups(token)) {
      if (ATTRIBUTE_PREFIX_PATTERN.test(prefix)) continue
      const relative = group.toLowerCase().replace(QUOTED_PATTERN, '""').replaceAll("_", " ")
      const owner = GROUP_PREFIX_PATTERN.test(prefix) ? ".group" : ".self"
      const selector = ANCESTOR_PREFIX_PATTERN.test(prefix)
        ? `:is(${relative.replaceAll("&", "*")}) .self`
        : relative.includes("&")
          ? relative.replaceAll("&", owner)
          : `${owner}:is(${relative})`
      const unscoped = hasCompounds(selector).some((compound) => {
        const anchor = withoutNegations(compound)
        return !NARROWING_PATTERN.test(anchor) || ROOT_COMPOUND_PATTERN.test(anchor)
      })
      if (unscoped) offenders.push(`[${group}]`)
    }
  }
  return offenders
}

const noUnscopedHas = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Tailwind arbitrary variants with a :has() that is not anchored to a class, attribute, id, or tag."
    },
    schema: []
  },
  /** @param {RuleContext} context */
  create(context) {
    /** @param {string} variant */
    const message = (variant) =>
      `Anchor the :has() in ${variant} to a class, attribute, or tag below the document root. Chrome evaluates an unanchored :has() on every ancestor.`
    return {
      /** @param {AstNode} node */
      Literal(node) {
        if (typeof node["value"] !== "string") return
        for (const variant of findUnscopedHasVariants(node["value"])) {
          context.report({ node, message: message(variant) })
        }
      },
      /** @param {AstNode} node */
      TemplateElement(node) {
        if (!isRecord(node["value"])) return
        const text =
          typeof node["value"]["cooked"] === "string"
            ? node["value"]["cooked"]
            : typeof node["value"]["raw"] === "string"
              ? node["value"]["raw"]
              : ""
        for (const variant of findUnscopedHasVariants(text)) {
          context.report({ node, message: message(variant) })
        }
      }
    }
  }
}

export default {
  meta: { name: "local" },
  rules: {
    "require-suppression-reason": requireSuppressionReason,
    "no-inline-schema-compile": noInlineSchemaCompile,
    "no-manual-effect-runtime-in-tests": noManualEffectRuntimeInTests,
    "no-test-in-loop": noTestInLoop,
    "no-outset-state-indicators": noOutsetStateIndicators,
    "no-unscoped-has": noUnscopedHas
  }
}
