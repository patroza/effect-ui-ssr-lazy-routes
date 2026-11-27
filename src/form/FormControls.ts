import type { Renderer, View } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import { Checkbox, Field, Input, NumberField, type NumberFieldFormat, Switch } from "@effect/ui-kit"
import * as Design from "../design/classes.ts"
import type * as SchemaForm from "./SchemaForm.ts"

const labelClass = "text-sm font-medium text-neutral-900 dark:text-neutral-100"
const errorClass = "text-sm font-medium text-red-600 dark:text-red-400"

const renderLabel = <M>(h: Html.H<M>, label: string, required: boolean | undefined) => [
  label,
  required === true
    ? h.span.class("ml-1 text-red-600 dark:text-red-400").attr("aria-hidden", "true").children("*")
    : undefined
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
      field.root(h.div.class("flex flex-col gap-1.5")).children(
        field.label(h.label.class(labelClass)).children(...renderLabel(h, options.label, options.required)),
        Input(h, {
          element: field.control(h.input).on("blur", options.onBlur),
          props: { value: options.value, disabled: field.disabled },
          onUpdate: ({ value }) => options.onUpdate(value)
        })
          .class(Design.ui.input)
          .attrs({
            name: options.name,
            type: options.type ?? "text",
            placeholder: options.placeholder,
            "data-testid": options.testId
          }),
        options.statusAdornment,
        options.description === undefined
          ? undefined
          : field.description(h.p).class(Design.ui.muted).children(options.description),
        field
          .error(h.p)
          ?.class(errorClass)
          .attr("data-testid", options.errorTestId)
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
          nf.root(field.root(h.div).class("flex flex-col gap-1.5")).children(
            field.label(h.label.class(labelClass)).children(...renderLabel(h, options.label, options.required)),
            nf
              .group(h.div)
              .class("flex items-stretch gap-1")
              .children(
                nf
                  .decrement({
                    element: h.button
                      .class(Design.ui.button)
                      .attr("aria-label", options.decreaseLabel)
                      .attr("data-testid", options.decrementTestId)
                  })
                  .children("−"),
                nf
                  .input(field.control(h.input).on("blur", options.onBlur))
                  .class(Design.ui.input)
                  .attr("data-testid", options.testId),
                nf
                  .increment({
                    element: h.button
                      .class(Design.ui.button)
                      .attr("aria-label", options.increaseLabel)
                      .attr("data-testid", options.incrementTestId)
                  })
                  .children("+")
              ),
            options.description === undefined
              ? undefined
              : field.description(h.p).class(Design.ui.muted).children(options.description),
            field
              .error(h.p)
              ?.class(errorClass)
              .attr("data-testid", options.errorTestId)
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
      field.root(h.div.class("flex flex-col gap-1.5")).children(
        h.div.class("flex items-center justify-between gap-3").children(
          h.div
            .class("flex flex-col gap-0.5")
            .children(
              field.label(h.label.class(labelClass)).children(options.label),
              options.description === undefined
                ? undefined
                : field.description(h.p).class(Design.ui.muted).children(options.description)
            ),
          Switch(h, {
            props: { checked: options.checked, name: options.name, disabled: field.disabled },
            onToggle: ({ checked }) => options.onToggle(checked),
            view: (parts) =>
              parts
                .root(
                  field
                    .control(h.button)
                    .on("blur", options.onBlur)
                    .class(
                      "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-neutral-300 bg-neutral-200 p-0.5 transition-colors data-[checked]:border-neutral-900 data-[checked]:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:data-[checked]:border-neutral-100 dark:data-[checked]:bg-neutral-100"
                    )
                    .attr("data-testid", options.testId)
                )
                .children(
                  parts
                    .thumb(h.span)
                    .class(
                      "block size-4 rounded-full bg-white transition-transform data-[checked]:translate-x-5 dark:bg-neutral-900"
                    )
                )
          })
        ),
        field
          .error(h.p)
          ?.class(errorClass)
          .attr("data-testid", options.errorTestId)
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
      field.root(h.div.class("flex flex-col gap-1.5")).children(
        h.div.class("flex items-start gap-2.5").children(
          Checkbox(h, {
            props: { checked: options.checked, name: options.name, disabled: field.disabled },
            onEmit: { Toggled: ({ checked }) => options.onToggle(checked) },
            view: (checkbox) =>
              checkbox
                .root(
                  field
                    .control(h.button)
                    .on("blur", options.onBlur)
                    .class(
                      "mt-0.5 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded border border-neutral-300 bg-white text-xs font-bold text-white transition-colors data-[checked]:border-neutral-900 data-[checked]:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-900 dark:data-[checked]:border-neutral-100 dark:data-[checked]:bg-neutral-100"
                    )
                    .attr("data-testid", options.testId)
                )
                .children(checkbox.indicator(h.span).children(checkbox.checked ? "✓" : ""))
          }),
          h.div
            .class("flex flex-col gap-0.5")
            .children(
              field.label(h.label.class(`${labelClass} cursor-pointer`)).children(options.label),
              options.description === undefined
                ? undefined
                : field.description(h.p).class(Design.ui.muted).children(options.description)
            )
        ),
        field
          .error(h.p)
          ?.class(errorClass)
          .attr("data-testid", options.errorTestId)
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
      .class("text-sm font-semibold text-red-700 dark:text-red-300")
      .children(options.title ?? "Please resolve the following issues"),
    h.ul
      .class("list-disc space-y-1 pl-5 text-sm text-red-700 dark:text-red-300")
      .children(
        options.errors.map((issue, index) =>
          h.li
            .key(`${issue.path}-${index}`)
            .children(issue.path === "" ? issue.message : `${options.labelFor(issue.path)}: ${issue.message}`)
        )
      )
  )
}
