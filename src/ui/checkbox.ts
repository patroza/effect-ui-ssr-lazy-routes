import type { Component } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import type { ButtonElement, Checkbox } from "@effect/ui-kit"
import { cn } from "#lib/cn"

export type CheckboxParts = Component.Headless.Parts<typeof Checkbox>

interface ClassOption {
  readonly class?: string | undefined
}

/**
 * The box. Draw it inside the kit's `view` and put the indicator in it.
 * Accepts an optional `element` (e.g. `field.control(h.button)`) so it composes inside `Field`.
 */
export const CheckboxRoot = <Msg, R = never>(
  h: Html.H<Msg>,
  checkbox: CheckboxParts,
  options: ClassOption & { readonly element?: ButtonElement<Msg, R> | undefined } = {}
) =>
  checkbox.root(
    (options.element ?? h.button).class(
      cn(
        "inline-grid size-4 shrink-0 place-items-center rounded-xs border border-input bg-background p-0 " +
          "text-brand-foreground shadow-sm transition-colors duration-150 hover:border-muted-foreground " +
          "data-[checked]:border-brand data-[checked]:bg-brand " +
          "data-[indeterminate]:border-brand data-[indeterminate]:bg-brand " +
          "data-[readonly]:cursor-default data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
        options.class
      )
    )
  )

/** The tick, or a dash while the checkbox is indeterminate. Both are borders, so there is no icon to ship. */
export const CheckboxIndicator = <Msg>(h: Html.H<Msg>, checkbox: CheckboxParts, options: ClassOption = {}) =>
  checkbox.indicator(
    h.span.class(
      cn(
        "-mt-0.5 h-[5px] w-[9px] -rotate-45 border-b-[1.5px] border-l-[1.5px] border-current " +
          "data-[unchecked]:hidden " +
          "data-[indeterminate]:mt-0 data-[indeterminate]:h-0 data-[indeterminate]:w-2 " +
          "data-[indeterminate]:rotate-0 data-[indeterminate]:border-l-0",
        options.class
      )
    )
  )

/** A label for the checkbox: around the root, or beside it with `for`. It dims with a disabled checkbox inside it. */
export const CheckboxLabel = <Msg>(h: Html.H<Msg>, options: ClassOption = {}) =>
  h.label.class(
    cn(
      "inline-flex cursor-pointer items-center gap-2 text-[13px] leading-4 font-medium select-none " +
        "has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:text-muted-foreground",
      options.class
    )
  )
