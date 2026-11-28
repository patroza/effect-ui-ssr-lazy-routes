import type { Renderer, View } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import { Checkbox, Field, NumberField, type NumberFieldFormat } from "@effect/ui-kit"
import { CheckboxIndicator, CheckboxRoot } from "#ui/checkbox"
import { FieldContent, FieldDescription, FieldError, FieldLabel, FieldRoot } from "#ui/field"
import { Input } from "#ui/input"
import {
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
  NumberFieldRoot
} from "#ui/number-field"
import { Switch } from "#ui/switch"
import * as Design from "../design/classes.ts"
import type * as SchemaForm from "./SchemaForm.ts"

const renderLabel = <M>(h: Html.H<M>, label: string, required: boolean | undefined) => [
  label,
  required === true ? h.span.class("ml-1 text-destructive").attr("aria-hidden", "true").children("*") : undefined
]

export interface TextFieldOptions<M> {
  readonly fieldKey: string
  readonly name: string
  readonly label: string
  readonly value: string
  readonly state: SchemaForm.DerivedFieldState
  readonly required?: boolean | undefined
  readonly disabled?: boolean | undefined
  readonly description?: string | undefined
  readonly placeholder?: string | undefined
  readonly type?: string | undefined
  readonly testId?: string | undefined
  readonly errorTestId?: string | undefined
  readonly statusAdornment?: View.Content<M, never> | undefined
  readonly onUpdate: (value: string) => M
  readonly onBlur: M
}

/** Accessible `Field` + `Input` control bound to `SchemaForm.DerivedFieldState`. */
export const textField = <M>(h: Html.H<M>, options: TextFieldOptions<M>) => {
  const errorMessage = options.state.errors[0]
  return Field(h, {
    key: options.fieldKey,
    props: {
      disabled: options.disabled,
      invalid: options.state.invalid,
      described: options.description !== undefined,
      dirty: options.state.dirty,
      filled: options.value !== ""
    },
    view: (field) =>
      FieldRoot(h, field).children(
        FieldLabel(h, field).children(...renderLabel(h, options.label, options.required)),
        Input(h, {
          element: field.control(h.input).on("blur", options.onBlur),
          props: { value: options.value, disabled: field.disabled },
          onUpdate: ({ value }) => options.onUpdate(value)
        }).attrs({
          name: options.name,
          type: options.type ?? "text",
          placeholder: options.placeholder,
          "data-testid": options.testId
        }),
        options.statusAdornment,
        options.description === undefined ? undefined : FieldDescription(h, field).children(options.description),
        FieldError(h, field)
          ?.attr("data-testid", options.errorTestId)
          .children(errorMessage ?? "")
      )
  })
}

export interface NumberFieldOptions<M> {
  readonly fieldKey: string
  readonly name: string
  readonly label: string
  readonly value: number | null
  readonly state: SchemaForm.DerivedFieldState
  readonly required?: boolean | undefined
  readonly disabled?: boolean | undefined
  readonly description?: string | undefined
  readonly min?: number | undefined
  readonly max?: number | undefined
  readonly step?: number | undefined
  readonly locale?: string | undefined
  readonly format?: NumberFieldFormat | undefined
  readonly increaseLabel?: string | undefined
  readonly decreaseLabel?: string | undefined
  readonly testId?: string | undefined
  readonly decrementTestId?: string | undefined
  readonly incrementTestId?: string | undefined
  readonly errorTestId?: string | undefined
  readonly onUpdate: (value: number | null) => M
  readonly onBlur: M
}

/** Accessible `Field` + `NumberField` control bound to `SchemaForm.DerivedFieldState`. */
export const numberField = <M>(h: Html.H<M>, options: NumberFieldOptions<M>) => {
  const errorMessage = options.state.errors[0]
  return Field(h, {
    key: options.fieldKey,
    props: {
      disabled: options.disabled,
      invalid: options.state.invalid,
      described: options.description !== undefined,
      dirty: options.state.dirty,
      filled: options.value !== null
    },
    view: (field) =>
      NumberField(h, {
        props: {
          value: options.value,
          min: options.min,
          max: options.max,
          step: options.step ?? 1,
          allowOutOfRange: true,
          locale: options.locale ?? "en-US",
          format: options.format,
          name: options.name,
          disabled: field.disabled
        },
        onEmit: {
          Updated: ({ value }) => options.onUpdate(value),
          Committed: () => undefined
        },
        view: (nf) =>
          NumberFieldRoot(h, nf, { element: field.root(h.div), class: "w-full items-stretch" }).children(
            FieldLabel(h, field).children(...renderLabel(h, options.label, options.required)),
            NumberFieldGroup(h, nf, { class: "w-full" }).children(
              NumberFieldDecrement(h, nf)
                .attr("aria-label", options.decreaseLabel)
                .attr("data-testid", options.decrementTestId),
              NumberFieldInput(h, nf, {
                element: field.control(h.input).on("blur", options.onBlur),
                class: "w-auto flex-1"
              }).attr("data-testid", options.testId),
              NumberFieldIncrement(h, nf)
                .attr("aria-label", options.increaseLabel)
                .attr("data-testid", options.incrementTestId)
            ),
            options.description === undefined ? undefined : FieldDescription(h, field).children(options.description),
            FieldError(h, field)
              ?.attr("data-testid", options.errorTestId)
              .children(errorMessage ?? "")
          )
      })
  })
}

export interface ToggleFieldOptions<M> {
  readonly fieldKey: string
  readonly name: string
  readonly label: string
  readonly checked: boolean
  readonly state: SchemaForm.DerivedFieldState
  readonly disabled?: boolean | undefined
  readonly description?: string | undefined
  readonly testId?: string | undefined
  readonly errorTestId?: string | undefined
  readonly onToggle: (checked: boolean) => M
  readonly onBlur: M
}

/** Accessible `Field` + `Switch` toggle bound to `SchemaForm.DerivedFieldState`. */
export const switchField = <M>(h: Html.H<M>, options: ToggleFieldOptions<M>) => {
  const errorMessage = options.state.errors[0]
  return Field(h, {
    key: options.fieldKey,
    props: {
      disabled: options.disabled,
      invalid: options.state.invalid,
      described: options.description !== undefined,
      dirty: options.state.dirty,
      filled: options.checked
    },
    view: (field) =>
      FieldRoot(h, field).children(
        h.div.class("flex items-center justify-between gap-3").children(
          FieldContent(h).children(
            FieldLabel(h, field).children(options.label),
            options.description === undefined ? undefined : FieldDescription(h, field).children(options.description)
          ),
          Switch(h, {
            element: field.control(h.button).on("blur", options.onBlur),
            props: { checked: options.checked, name: options.name, disabled: field.disabled },
            onToggle: ({ checked }) => options.onToggle(checked)
          }).attr("data-testid", options.testId)
        ),
        FieldError(h, field)
          ?.attr("data-testid", options.errorTestId)
          .children(errorMessage ?? "")
      )
  })
}

/** Accessible `Field` + `Checkbox` control bound to `SchemaForm.DerivedFieldState`. */
export const checkboxField = <M>(h: Html.H<M>, options: ToggleFieldOptions<M>) => {
  const errorMessage = options.state.errors[0]
  return Field(h, {
    key: options.fieldKey,
    props: {
      disabled: options.disabled,
      invalid: options.state.invalid,
      described: options.description !== undefined,
      dirty: options.state.dirty,
      filled: options.checked
    },
    view: (field) =>
      FieldRoot(h, field).children(
        h.div.class("flex items-start gap-2.5").children(
          Checkbox(h, {
            props: { checked: options.checked, name: options.name, disabled: field.disabled },
            onEmit: { Toggled: ({ checked }) => options.onToggle(checked) },
            view: (checkbox) =>
              CheckboxRoot(h, checkbox, {
                element: field.control(h.button).on("blur", options.onBlur),
                class: "mt-0.5"
              })
                .attr("data-testid", options.testId)
                .children(CheckboxIndicator(h, checkbox))
          }),
          FieldContent(h).children(
            FieldLabel(h, field, { class: "cursor-pointer" }).children(options.label),
            options.description === undefined ? undefined : FieldDescription(h, field).children(options.description)
          )
        ),
        FieldError(h, field)
          ?.attr("data-testid", options.errorTestId)
          .children(errorMessage ?? "")
      )
  })
}

export interface ErrorSummaryOptions {
  readonly errors: ReadonlyArray<SchemaForm.FormIssueItem>
  readonly labelFor: (path: string) => string
  readonly title?: string | undefined
  readonly summaryRef?: Renderer.Ref<HTMLDivElement> | undefined
  readonly testId?: string | undefined
}

/**
 * OmegaForm `<form.Errors />` equivalent: renders all currently visible
 * field-level and form-level errors inside an accessible `role="alert"` card.
 */
export const errorSummary = <M>(h: Html.H<M>, options: ErrorSummaryOptions) => {
  if (options.errors.length === 0) return undefined
  const base = h.div
    .key("form-error-summary")
    .class(`${Design.ui.cardError} ${Design.ui.stack}`)
    .attrs({
      role: "alert",
      tabindex: "-1",
      "data-testid": options.testId ?? "form-error-summary"
    })
  const container = options.summaryRef === undefined ? base : base.ref(options.summaryRef)
  return container.children(
    h.h2
      .class("text-sm font-semibold text-destructive")
      .children(options.title ?? "Please resolve the following issues"),
    h.ul
      .class("list-disc space-y-1 pl-5 text-sm text-destructive")
      .children(
        options.errors.map((issue, index) =>
          h.li
            .key(`${issue.path}-${index}`)
            .children(issue.path === "" ? issue.message : `${options.labelFor(issue.path)}: ${issue.message}`)
        )
      )
  )
}
