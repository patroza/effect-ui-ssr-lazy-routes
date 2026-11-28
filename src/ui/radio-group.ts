import type { Component } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import type { ButtonElement, makeRadioGroup } from "@effect/ui-kit"
import { cn } from "#lib/cn"

export type RadioGroupParts<V extends string = string> = Component.Headless.Parts<ReturnType<typeof makeRadioGroup<V>>>

interface ClassOption {
  readonly class?: string | undefined
}

const orientations = {
  vertical: "grid gap-2.5",
  horizontal: "flex flex-wrap items-center gap-x-5 gap-y-2"
} as const

/** The group. Accepts an optional `element` (e.g. `field.group(h.div)`) for `Field` integration. */
export const RadioGroupRoot = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  radioGroup: RadioGroupParts<V>,
  options: ClassOption & {
    readonly orientation?: keyof typeof orientations | undefined
    readonly element?: ReturnType<Html.H<Msg>["div"]["attr"]> | undefined
  } = {}
) =>
  radioGroup.root(
    (options.element ?? h.div).class(
      cn("group/radio-group min-w-0", orientations[options.orientation ?? "vertical"], options.class)
    )
  )

/**
 * One radio, for the `value` of an entry in the group's `items` prop. Accepts
 * an optional `element` (e.g. `field.member(h.button)`).
 */
export const RadioGroupRadio = <Msg, V extends string = string, R = never>(
  h: Html.H<Msg>,
  radioGroup: RadioGroupParts<V>,
  options: ClassOption & { readonly value: V; readonly element?: ButtonElement<Msg, R> | undefined }
) =>
  radioGroup.radio({
    element: (options.element ?? h.button).class(
      cn(
        "inline-grid size-4 shrink-0 place-items-center rounded-full border border-input bg-background p-0 shadow-sm " +
          "transition-colors duration-150 hover:border-muted-foreground data-[checked]:border-brand " +
          "data-[readonly]:cursor-default data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 " +
          "group-aria-[invalid=true]/radio-group:border-destructive",
        options.class
      )
    ),
    value: options.value
  })

/** The dot. The kit keeps it mounted for one transition after its radio is unchecked, so it scales out. */
export const RadioGroupIndicator = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  radioGroup: RadioGroupParts<V>,
  options: ClassOption & { readonly value: V }
) =>
  radioGroup.indicator({
    element: h.span.class(
      cn(
        "size-2 rounded-full bg-brand transition-[scale] duration-150 " +
          "data-[starting-style]:scale-0 data-[ending-style]:scale-0",
        options.class
      )
    ),
    value: options.value
  })

/** The group's name. Give it an `id` and point the root's `aria-labelledby` at it. */
export const RadioGroupLegend = <Msg>(h: Html.H<Msg>, options: ClassOption = {}) =>
  h.div.class(cn("text-[13px] leading-5 font-medium", options.class))

/** A label for one radio: around it, or beside it with `for`. It dims with a disabled radio inside it. */
export const RadioGroupLabel = <Msg>(h: Html.H<Msg>, options: ClassOption = {}) =>
  h.label.class(
    cn(
      "inline-flex cursor-pointer items-center gap-2 text-[13px] leading-4 select-none " +
        "has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:text-muted-foreground",
      options.class
    )
  )
