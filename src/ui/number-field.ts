import type { Component } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import type { InputElement, NumberField } from "@effect/ui-kit"
import { cn } from "#lib/cn"

/** What the kit's `NumberField` hands its `view` closure. */
export type NumberFieldParts = Component.Headless.Parts<typeof NumberField>

interface ClassOption {
  readonly class?: string | undefined
}

const stepper =
  "relative shrink-0 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground active:bg-foreground/10 " +
  "data-[disabled]:cursor-not-allowed data-[disabled]:bg-transparent data-[disabled]:text-muted-foreground/40 " +
  "before:absolute before:top-1/2 before:left-1/2"

const bar = "before:h-[1.5px] before:w-2.5 before:-translate-1/2 before:rounded-full before:bg-current"

const chevron =
  "before:size-[5px] before:-translate-x-1/2 before:border-t-[1.5px] before:border-l-[1.5px] before:border-current"

const groups = {
  default: "",
  stacked: "[&>input]:border-l-0 [&>input]:text-left"
} as const

export type NumberFieldVariant = keyof typeof groups

/** The root. Pass `element: field.root(h.div)` when the number field is a `Field`. */
export const NumberFieldRoot = <Msg>(
  h: Html.H<Msg>,
  numberField: NumberFieldParts,
  options: ClassOption & { readonly element?: ReturnType<Html.H<Msg>["div"]["attr"]> | undefined } = {}
) => numberField.root((options.element ?? h.div).class(cn("inline-flex flex-col items-start gap-1.5", options.class)))

/** A `<label>`. Point its `for` at the input's id, or draw `field.label` instead. */
export const NumberFieldLabel = <Msg>(h: Html.H<Msg>, numberField: NumberFieldParts, options: ClassOption = {}) =>
  h.label
    .class(cn("text-[13px] font-medium data-[disabled]:opacity-50", options.class))
    .attr("data-disabled", numberField.disabled ? "" : undefined)

/**
 * The bordered box around the input and the buttons. `stacked` is for an
 * input followed by `NumberFieldSteppers`.
 */
export const NumberFieldGroup = <Msg>(
  h: Html.H<Msg>,
  numberField: NumberFieldParts,
  options: ClassOption & { readonly variant?: NumberFieldVariant | undefined } = {}
) =>
  numberField.group(
    h.div.class(
      cn(
        "inline-flex h-8.5 items-stretch rounded-md border border-input bg-background shadow-sm",
        "transition-[border-color,box-shadow] duration-150 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20",
        "has-[input[aria-invalid=true]]:border-destructive data-[disabled]:opacity-50",
        groups[options.variant ?? "default"],
        options.class
      )
    )
  )

/** The text input. Pass `element: field.control(h.input)` in a `Field`, or `h.input.attr("id", ...)` for a label. */
export const NumberFieldInput = <Msg>(
  h: Html.H<Msg>,
  numberField: NumberFieldParts,
  options: ClassOption & { readonly element?: InputElement<Msg> | undefined } = {}
) =>
  numberField.input(
    (options.element ?? h.input).class(
      cn(
        "w-22 min-w-0 border-0 border-x border-input bg-transparent px-2.5 text-center text-[13px] text-foreground tabular-nums outline-none",
        "data-[disabled]:cursor-not-allowed data-[readonly]:text-muted-foreground",
        options.class
      )
    )
  )

/** The minus button, drawn with a bar. */
export const NumberFieldDecrement = <Msg>(h: Html.H<Msg>, numberField: NumberFieldParts, options: ClassOption = {}) =>
  numberField.decrement({
    element: h.button.class(cn(stepper, bar, "w-8 rounded-l-[calc(var(--radius-md)-1px)]", options.class))
  })

/** The plus button, drawn with two bars. */
export const NumberFieldIncrement = <Msg>(h: Html.H<Msg>, numberField: NumberFieldParts, options: ClassOption = {}) =>
  numberField.increment({
    element: h.button.class(
      cn(
        stepper,
        bar,
        "w-8 rounded-r-[calc(var(--radius-md)-1px)]",
        "after:absolute after:top-1/2 after:left-1/2 after:h-[1.5px] after:w-2.5 after:-translate-1/2 after:rotate-90 after:rounded-full after:bg-current",
        options.class
      )
    )
  })

/** Both buttons in a column of chevrons, for the end of a `stacked` group. */
export const NumberFieldSteppers = <Msg>(h: Html.H<Msg>, numberField: NumberFieldParts, options: ClassOption = {}) =>
  h.div.class(cn("flex w-6 flex-col", options.class)).children(
    numberField.increment({
      element: h.button.class(
        cn(
          stepper,
          chevron,
          "flex-1 rounded-tr-[calc(var(--radius-md)-1px)] border-b border-input before:-translate-y-1/4 before:rotate-45"
        )
      )
    }),
    numberField.decrement({
      element: h.button.class(
        cn(stepper, chevron, "flex-1 rounded-br-[calc(var(--radius-md)-1px)] before:-translate-y-3/4 before:rotate-225")
      )
    })
  )

/** The two-headed arrow the scrub area and its cursor show. */
export const NumberFieldScrubIcon = <Msg>(h: Html.H<Msg>) =>
  h
    .el("svg")
    .attrs({
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true"
    })
    .children(h.el("path").attr("d", "M8 8l-4 4 4 4M16 8l4 4-4 4M4 12h16"))

/** An area that changes the value when it is dragged across. Put the label inside it. */
export const NumberFieldScrubArea = <Msg>(
  h: Html.H<Msg>,
  numberField: NumberFieldParts,
  options: ClassOption & { readonly direction?: "horizontal" | "vertical" | undefined } = {}
) =>
  numberField.scrubArea({
    element: h.span.class(
      cn(
        "inline-flex cursor-ew-resize items-center gap-1.5 data-[disabled]:cursor-default data-[disabled]:opacity-50",
        "[&_label]:cursor-[inherit] [&_svg]:size-[13px] [&_svg]:text-muted-foreground",
        options.class
      )
    ),
    direction: options.direction
  })

/**
 * Stands in for the pointer while a drag holds the pointer lock, and is
 * `undefined` otherwise. It is a popover, so its browser defaults are cleared.
 */
export const NumberFieldScrubAreaCursor = <Msg>(
  h: Html.H<Msg>,
  numberField: NumberFieldParts,
  options: ClassOption = {}
) =>
  numberField
    .scrubAreaCursor(
      h.span.class(
        cn(
          "size-5.5 overflow-visible border-0 bg-transparent p-0 text-foreground [&_svg]:size-5.5 [&_svg]:text-foreground",
          options.class
        )
      )
    )
    ?.children(NumberFieldScrubIcon(h))
