import { Exit, Option, Schema, SchemaIssue } from "effect"
import { AsyncResult } from "effect/reactivity"
import * as SchemaMeta from "./schemaMeta.ts"

export type ValidationMode = "onSubmit" | "onBlur" | "onChange"

export type AsyncCheckStatus =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Validating" }
  | { readonly _tag: "Valid" }
  | { readonly _tag: "Invalid"; readonly errors: ReadonlyArray<string> }

export interface FormState<Values> {
  readonly values: Values
  readonly baseline: Values
  readonly edited: ReadonlyArray<string>
  readonly touched: ReadonlyArray<string>
  readonly submitted: boolean
  readonly serverErrors: Readonly<Record<string, ReadonlyArray<string>>>
  readonly formServerErrors: ReadonlyArray<string>
}

export type FieldStatus = "NotValidated" | "Validating" | "Valid" | "Invalid"

export interface DerivedFieldState {
  readonly path: string
  readonly status: FieldStatus
  readonly errors: ReadonlyArray<string>
  readonly showResult: boolean
  readonly invalid: boolean | undefined
  readonly dirty: boolean
  readonly touched: boolean
  readonly edited: boolean
}

export interface FormIssueItem {
  readonly path: string
  readonly message: string
}

export interface DerivedFormState<To> {
  readonly decoded: Option.Option<To>
  readonly syncDecoded: Option.Option<To>
  readonly isDirty: boolean
  readonly isValid: boolean
  readonly isValidating: boolean
  readonly canSubmit: boolean
  readonly field: (path: string) => DerivedFieldState
  readonly fieldPassesSync: (path: string) => boolean
  readonly visibleErrors: ReadonlyArray<FormIssueItem>
  readonly allErrors: ReadonlyArray<FormIssueItem>
  readonly formErrors: ReadonlyArray<string>
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Structural equality for JSON/Model-serializable form values. */
export const deepEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false
    for (let index = 0; index < left.length; index++) {
      if (!deepEqual(left[index], right[index])) return false
    }
    return true
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false
    for (const key of leftKeys) {
      if (!Object.hasOwn(right, key) || !deepEqual(left[key], right[key])) return false
    }
    return true
  }
  return false
}

const getPathValue = (root: unknown, path: string): unknown => {
  if (path === "") return root
  let current: unknown = root
  for (const segment of path.split(".")) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return undefined
      current = current[Number(segment)]
      continue
    }
    if (isRecord(current) && Object.hasOwn(current, segment)) {
      current = current[segment]
      continue
    }
    return undefined
  }
  return current
}

const addUnique = (list: ReadonlyArray<string>, item: string): ReadonlyArray<string> =>
  list.includes(item) ? list : [...list, item]

const dropServerErrorsUnder = (
  errors: Readonly<Record<string, ReadonlyArray<string>>>,
  path: string
): Readonly<Record<string, ReadonlyArray<string>>> => {
  const prefix = `${path}.`
  const next: Record<string, ReadonlyArray<string>> = {}
  for (const [key, value] of Object.entries(errors)) {
    if (key === path || key.startsWith(prefix)) continue
    next[key] = value
  }
  return next
}

const normalizeKeySegment = (segment: PropertyKey | { readonly key: PropertyKey }): string => {
  const raw = typeof segment === "object" && segment !== null && "key" in segment ? segment.key : segment
  return typeof raw === "symbol" ? (raw.description ?? "") : String(raw)
}

const normalizeIssuePath = (path: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined): string => {
  if (path === undefined || path.length === 0) return ""
  return path.map(normalizeKeySegment).join(".")
}

const pushUniqueMessage = (target: Array<string>, message: string): void => {
  if (!target.includes(message)) target.push(message)
}

/**
 * Projects a `@effect/ui` `Query.Service` `AsyncResult` onto a form field's
 * `AsyncCheckStatus`. Failures are mapped to `Invalid` rather than leaving the
 * field stuck in `Validating`.
 */
export const asyncCheckFromResult = <A, E>(
  result: AsyncResult.AsyncResult<A, E> | undefined,
  evaluate: (value: A) => ReadonlyArray<string>,
  failureMessage = "Could not verify right now — please try again"
): AsyncCheckStatus => {
  if (result === undefined) return { _tag: "Idle" }
  if (AsyncResult.isInitial(result) || result.waiting) return { _tag: "Validating" }
  if (AsyncResult.isSuccess(result)) {
    const errors = evaluate(result.value)
    return errors.length === 0 ? { _tag: "Valid" } : { _tag: "Invalid", errors }
  }
  return { _tag: "Invalid", errors: [failureMessage] }
}

/**
 * Creates a Schema-driven form controller for `@effect/ui` components.
 *
 * - Stores only minimal serializable `FormState<Values>` in the Component Model.
 * - Derives per-field validity, visibility, dirty flags, and decoded `To`
 *   values purely on demand from `formSchema`.
 * - Coordinates sync Schema checks, cross-field refinements, debounced async
 *   `Query` checks, and server-side `reject` errors without mutable state.
 */
export const make = <
  SValue extends Schema.Top & { readonly DecodingServices: never; readonly EncodingServices: never },
  SForm extends Schema.Top & Schema.ConstraintDecoder<unknown, never>
>(options: {
  readonly valueSchema: SValue
  readonly formSchema: SForm
  readonly mode?: ValidationMode | undefined
  readonly leafHook?: SchemaIssue.LeafHook | undefined
  readonly checkHook?: SchemaIssue.CheckHook | undefined
}) => {
  type Values = SValue["Type"]
  type Decoded = SForm["Type"]

  const mode: ValidationMode = options.mode ?? "onSubmit"
  const meta = SchemaMeta.extractFieldMetaMap(options.formSchema)
  const decodeUnknown = Schema.decodeUnknownExit(options.formSchema, { errors: "all" })
  const formatter = SchemaIssue.makeFormatterStandardSchemaV1({
    leafHook: options.leafHook,
    checkHook: options.checkHook
  })

  const State = Schema.Struct({
    values: options.valueSchema,
    baseline: options.valueSchema,
    edited: Schema.Array(Schema.String),
    touched: Schema.Array(Schema.String),
    submitted: Schema.Boolean,
    serverErrors: Schema.Record(Schema.String, Schema.Array(Schema.String)),
    formServerErrors: Schema.Array(Schema.String)
  })

  const init = (initialValues: Values): FormState<Values> => ({
    values: initialValues,
    baseline: initialValues,
    edited: [],
    touched: [],
    submitted: false,
    serverErrors: {},
    formServerErrors: []
  })

  const update = (state: FormState<Values>, path: string, updater: (values: Values) => Values): FormState<Values> => ({
    ...state,
    values: updater(state.values),
    edited: addUnique(state.edited, path),
    serverErrors: dropServerErrorsUnder(state.serverErrors, path),
    formServerErrors: []
  })

  const blur = (state: FormState<Values>, path: string): FormState<Values> => ({
    ...state,
    touched: addUnique(state.touched, path)
  })

  const submit = (state: FormState<Values>): FormState<Values> =>
    state.submitted ? state : { ...state, submitted: true }

  const setServerErrors = (
    state: FormState<Values>,
    errors: {
      readonly fieldErrors?: Readonly<Record<string, ReadonlyArray<string>>> | undefined
      readonly formErrors?: ReadonlyArray<string> | undefined
    }
  ): FormState<Values> => {
    const cleanedFields: Record<string, ReadonlyArray<string>> = {}
    for (const [path, messages] of Object.entries(errors.fieldErrors ?? {})) {
      if (messages.length > 0) cleanedFields[path] = messages
    }
    return {
      ...state,
      submitted: true,
      serverErrors: cleanedFields,
      formServerErrors: [...(errors.formErrors ?? [])]
    }
  }

  const clearServerErrors = (state: FormState<Values>): FormState<Values> => ({
    ...state,
    serverErrors: {},
    formServerErrors: []
  })

  const rebase = (state: FormState<Values>, nextBaseline: Values = state.values): FormState<Values> => ({
    values: state.values,
    baseline: nextBaseline,
    edited: [],
    touched: [],
    submitted: false,
    serverErrors: {},
    formServerErrors: []
  })

  const reset = (state: FormState<Values>, nextValues: Values = state.baseline): FormState<Values> => init(nextValues)

  const isDirty = (state: FormState<Values>): boolean => !deepEqual(state.values, state.baseline)

  const showsPath = (state: FormState<Values>, path: string): boolean => {
    if (state.submitted) return true
    if (mode === "onChange") return state.edited.includes(path)
    if (mode === "onBlur") return state.touched.includes(path)
    return false
  }

  const derive = (
    state: FormState<Values>,
    asyncChecks: Readonly<Record<string, AsyncCheckStatus | undefined>> = {}
  ): DerivedFormState<Decoded> => {
    const exit = decodeUnknown(state.values)
    const syncIssuesByPath = new Map<string, Array<string>>()
    const rootSyncIssues: Array<string> = []
    let syncDecoded: Option.Option<Decoded> = Option.none()

    if (Exit.isSuccess(exit)) {
      syncDecoded = Option.some(exit.value)
    } else {
      for (const reason of exit.cause.reasons) {
        if (reason._tag === "Fail" && Schema.isSchemaError(reason.error)) {
          const formatted = formatter(reason.error.issue)
          for (const issue of formatted.issues) {
            const path = normalizeIssuePath(issue.path)
            if (path === "") {
              pushUniqueMessage(rootSyncIssues, issue.message)
            } else {
              const bucket = syncIssuesByPath.get(path)
              if (bucket === undefined) {
                syncIssuesByPath.set(path, [issue.message])
              } else {
                pushUniqueMessage(bucket, issue.message)
              }
            }
          }
        }
      }
    }

    const fieldPassesSync = (path: string): boolean => {
      if (syncIssuesByPath.has(path)) return false
      const prefix = `${path}.`
      for (const issuePath of syncIssuesByPath.keys()) {
        if (issuePath.startsWith(prefix)) return false
      }
      return true
    }

    const fieldCache = new Map<string, DerivedFieldState>()
    const field = (path: string): DerivedFieldState => {
      const cached = fieldCache.get(path)
      if (cached !== undefined) return cached

      const edited = state.edited.includes(path)
      const touched = state.touched.includes(path)
      const dirty = !deepEqual(getPathValue(state.values, path), getPathValue(state.baseline, path))
      const show = showsPath(state, path)

      const serverMsgs = Object.hasOwn(state.serverErrors, path) ? (state.serverErrors[path] ?? []) : []
      const syncMsgs = syncIssuesByPath.get(path) ?? []
      const asyncCheck = Object.hasOwn(asyncChecks, path) ? asyncChecks[path] : undefined

      let result: DerivedFieldState
      if (serverMsgs.length > 0) {
        result = {
          path,
          status: "Invalid",
          errors: serverMsgs,
          showResult: true,
          invalid: true,
          dirty,
          touched,
          edited
        }
      } else if (syncMsgs.length > 0) {
        result = show
          ? {
              path,
              status: "Invalid",
              errors: syncMsgs,
              showResult: true,
              invalid: true,
              dirty,
              touched,
              edited
            }
          : {
              path,
              status: "NotValidated",
              errors: syncMsgs,
              showResult: false,
              invalid: undefined,
              dirty,
              touched,
              edited
            }
      } else if (asyncCheck !== undefined && asyncCheck._tag !== "Idle") {
        if (asyncCheck._tag === "Validating") {
          result = {
            path,
            status: "Validating",
            errors: [],
            showResult: true,
            invalid: undefined,
            dirty,
            touched,
            edited
          }
        } else if (asyncCheck._tag === "Invalid") {
          result = {
            path,
            status: "Invalid",
            errors: asyncCheck.errors,
            showResult: true,
            invalid: true,
            dirty,
            touched,
            edited
          }
        } else {
          result = {
            path,
            status: "Valid",
            errors: [],
            showResult: true,
            invalid: false,
            dirty,
            touched,
            edited
          }
        }
      } else if (show) {
        result = {
          path,
          status: "Valid",
          errors: [],
          showResult: true,
          invalid: false,
          dirty,
          touched,
          edited
        }
      } else {
        result = {
          path,
          status: "NotValidated",
          errors: [],
          showResult: false,
          invalid: undefined,
          dirty,
          touched,
          edited
        }
      }

      fieldCache.set(path, result)
      return result
    }

    const candidatePaths = new Set<string>()
    for (const metaPath of Object.keys(meta)) {
      if (!metaPath.includes("*")) candidatePaths.add(metaPath)
    }
    for (const issuePath of syncIssuesByPath.keys()) candidatePaths.add(issuePath)
    for (const serverPath of Object.keys(state.serverErrors)) candidatePaths.add(serverPath)
    for (const asyncPath of Object.keys(asyncChecks)) candidatePaths.add(asyncPath)

    const allErrors: Array<FormIssueItem> = []
    const visibleErrors: Array<FormIssueItem> = []

    for (const path of candidatePaths) {
      const derivedField = field(path)
      const serverMsgs = Object.hasOwn(state.serverErrors, path) ? (state.serverErrors[path] ?? []) : []
      const syncMsgs = syncIssuesByPath.get(path) ?? []
      const asyncCheck = Object.hasOwn(asyncChecks, path) ? asyncChecks[path] : undefined
      const asyncMsgs = asyncCheck?._tag === "Invalid" ? asyncCheck.errors : []
      const rawMessages = [...serverMsgs, ...syncMsgs, ...asyncMsgs]
      for (const message of rawMessages) {
        if (!allErrors.some((item) => item.path === path && item.message === message)) {
          allErrors.push({ path, message })
        }
      }
      if (derivedField.status === "Invalid") {
        for (const message of derivedField.errors) {
          visibleErrors.push({ path, message })
        }
      }
    }

    const formErrors = [...state.formServerErrors, ...(state.submitted ? rootSyncIssues : [])]
    for (const message of formErrors) {
      visibleErrors.push({ path: "", message })
    }
    for (const message of [...state.formServerErrors, ...rootSyncIssues]) {
      if (!allErrors.some((item) => item.path === "" && item.message === message)) {
        allErrors.push({ path: "", message })
      }
    }

    const hasServerError =
      state.formServerErrors.length > 0 || Object.values(state.serverErrors).some((list) => list.length > 0)
    const isValidating = Object.values(asyncChecks).some((check) => check?._tag === "Validating")
    const hasAsyncInvalid = Object.values(asyncChecks).some((check) => check?._tag === "Invalid")

    const isValid = Option.isSome(syncDecoded) && !hasServerError && !hasAsyncInvalid
    const canSubmit = isValid && !isValidating
    const decoded = canSubmit ? syncDecoded : Option.none()

    return {
      decoded,
      syncDecoded,
      isDirty: isDirty(state),
      isValid,
      isValidating,
      canSubmit,
      field,
      fieldPassesSync,
      visibleErrors,
      allErrors,
      formErrors
    }
  }

  const labelFor = (path: string): string => SchemaMeta.resolveFieldLabel(meta, path)

  return {
    State,
    meta,
    init,
    update,
    blur,
    submit,
    setServerErrors,
    clearServerErrors,
    rebase,
    reset,
    isDirty,
    derive,
    labelFor
  }
}
