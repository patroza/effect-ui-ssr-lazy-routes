import type { Component } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import type { Field } from "@effect/ui-kit"
import { cn } from "#lib/cn"

/** What the kit's `Field` hands its `view` closure. */
export type FieldParts = Component.Headless.Parts<typeof Field>

interface ClassOption {
  readonly class?: string | undefined
}

const orientations = {
  vertical: "flex-col gap-1.5",
  horizontal: "flex-row items-center justify-between gap-4"
} as const

export type FieldOrientation = keyof typeof orientations

/**
 * The field's root. `vertical` stacks the label, the control and the text
 * under it. `horizontal` puts a `FieldContent` on the left and a small
 * control, such as a switch, on the right.
 */
export const FieldRoot = <Msg>(
  h: Html.H<Msg>,
  field: FieldParts,
  options: ClassOption & { readonly orientation?: FieldOrientation | undefined } = {}
) => field.root(h.div.class(cn("flex w-full min-w-0", orientations[options.orientation ?? "vertical"], options.class)))

/** The column of label and description in a horizontal field. */
export const FieldContent = <Msg>(h: Html.H<Msg>, options: ClassOption = {}) =>
  h.div.class(cn("flex min-w-0 flex-col gap-0.5", options.class))

export const FieldLabel = <Msg>(h: Html.H<Msg>, field: FieldParts, options: ClassOption = {}) =>
  field.label(
    h.label.class(
      cn(
        "text-[13px] leading-snug font-medium data-[disabled]:opacity-50 data-[invalid]:text-destructive",
        options.class
      )
    )
  )

/** The name of a field drawn with `field.group`, such as a range slider or a one-time code. */
export const FieldLegend = <Msg>(h: Html.H<Msg>, field: FieldParts, options: ClassOption = {}) =>
  field.legend(
    h.div.class(
      cn(
        "text-[13px] leading-snug font-medium data-[disabled]:opacity-50 data-[invalid]:text-destructive",
        options.class
      )
    )
  )

/** Needs `described: true` in the field's props, so the control points at it. */
export const FieldDescription = <Msg>(h: Html.H<Msg>, field: FieldParts, options: ClassOption = {}) =>
  field.description(
    h.p.class(cn("m-0 text-xs leading-normal text-muted-foreground data-[disabled]:opacity-50", options.class))
  )

/** `undefined` unless the field is invalid and enabled: `FieldError(h, field)?.children(message)`. */
export const FieldError = <Msg>(h: Html.H<Msg>, field: FieldParts, options: ClassOption = {}) =>
  field.error(h.div.class(cn("text-xs leading-normal text-destructive", options.class)))
