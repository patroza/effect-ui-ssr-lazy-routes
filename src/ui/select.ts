import type { Component } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import type { ButtonElement, makeSelect } from "@effect/ui-kit"
import { cn } from "#lib/cn"

/** What the `view` closure of the kit's `Select` or `makeSelect` receives. */
export type SelectParts<V extends string = string> = Component.Headless.Parts<ReturnType<typeof makeSelect<V>>>

export type SelectSize = keyof typeof triggerSizes

interface ClassOption {
  readonly class?: string | undefined
}

const triggerSizes = {
  sm: "h-7 min-w-36 gap-1.5 rounded-sm pr-2 pl-2.5 text-xs",
  default: "h-8.5 min-w-48 pr-2.5 pl-3 text-[13px]",
  lg: "h-10 min-w-56 pr-3 pl-3.5 text-sm"
} as const

const popupSizes = {
  sm: "text-xs [&_[role=option]]:min-h-6.5 [&_[role=option]]:px-1.5 [&_[role=option]]:py-0.5",
  default: "text-[13px]",
  lg: "text-sm [&_[role=option]]:min-h-8.5 [&_[role=option]]:px-2.5"
} as const

/** The text above the trigger. It names the trigger, and a click focuses it. */
export const SelectLabel = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption = {}
) => select.label(h.div.class(cn("mb-1.5 cursor-default text-[13px] leading-snug font-medium", options.class)))

/** The button that opens the popup. Put `SelectValue` and `SelectIcon` inside. Accepts `element` for `Field` wiring. */
export const SelectTrigger = <Msg, V extends string = string, R = never>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption & {
    readonly size?: SelectSize | undefined
    readonly element?: ButtonElement<Msg, R> | undefined
  } = {}
) =>
  select.trigger(
    // The press opens the popup and the kit moves focus into it. Left alone, the browser would then focus the
    // pressed button, and the kit closes a popup that covers its trigger when the trigger takes focus.
    (options.element ?? h.button)
      .on("mousedown", () => undefined, { preventDefault: "always" })
      .class(
        cn(
          "inline-flex items-center justify-between gap-2 rounded-md border border-input bg-background text-start",
          "leading-none whitespace-nowrap text-foreground shadow-sm select-none",
          "transition-colors duration-150 hover:bg-accent data-[popup-open]:bg-accent",
          "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[disabled]:hover:bg-background",
          "data-[readonly]:cursor-default data-[readonly]:bg-muted",
          triggerSizes[options.size ?? "default"],
          options.class
        )
      )
  )

/** The selected label, or the placeholder, inside the trigger. */
export const SelectValue = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption = {}
) =>
  select.value(
    h.span.class(cn("min-w-0 truncate leading-snug data-[placeholder]:text-muted-foreground", options.class))
  )

/** The chevron inside the trigger. */
export const SelectIcon = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption = {}
) =>
  select.icon(
    h.span.class(
      cn(
        "mx-1 mb-[3px] size-[7px] shrink-0 rotate-45 border-r-[1.5px] border-b-[1.5px] border-muted-foreground",
        options.class
      )
    )
  )

/**
 * The element the kit places, in the top layer. Put `SelectPopup` inside. Its
 * vertical margin is the gap the kit keeps to the viewport's edges while the
 * popup covers the trigger.
 */
export const SelectPositioner = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption = {}
) => select.positioner(h.div.class(cn("outline-none data-[side=none]:my-2.5", options.class)))

/**
 * The box with the options.
 */
export const SelectPopup = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption & { readonly size?: SelectSize | undefined } = {}
) =>
  select.popup(
    h.div.class(
      cn(
        "relative box-border max-w-[var(--available-width)] min-w-[max(var(--anchor-width),10rem)] overflow-y-auto",
        "rounded-lg border bg-popover p-1 text-foreground shadow-float outline-none",
        "max-h-[min(var(--available-height),20rem)] data-[side=none]:max-h-none",
        "origin-[var(--transform-origin)] transition-[opacity,scale] duration-150",
        "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
        "not-data-[side=none]:data-[starting-style]:scale-95 not-data-[side=none]:data-[ending-style]:scale-95",
        "data-[side=none]:[scrollbar-width:none]",
        "has-[>[data-slot=select-list]]:flex has-[>[data-slot=select-list]]:flex-col",
        "has-[>[data-slot=select-list]]:overflow-hidden has-[>[data-slot=select-list]]:p-0",
        popupSizes[options.size ?? "default"],
        options.class
      )
    )
  )

/** The scrolling part of a popup that also holds scroll arrows. */
export const SelectList = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption = {}
) =>
  select.list(
    h.div
      .attr("data-slot", "select-list")
      .class(cn("min-h-0 flex-1 overflow-y-auto p-1 outline-none [scrollbar-width:none]", options.class))
  )

/** One option. Put `SelectItemText` and `SelectItemIndicator` inside. */
export const SelectItem = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption & { readonly value: V }
) =>
  select.item({
    element: h.div.class(
      cn(
        "flex min-h-7.5 cursor-default scroll-my-1 items-center gap-2 rounded-sm px-2 py-1 leading-snug outline-none",
        "select-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
        "data-[selected]:font-medium data-[disabled]:text-muted-foreground data-[disabled]:opacity-60",
        "[&_svg]:size-[15px] [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
        options.class
      )
    ),
    value: options.value
  })

/** The option's label, which the kit lines up with the trigger's text. */
export const SelectItemText = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption = {}
) => select.itemText(h.div.class(cn("min-w-0 flex-1 whitespace-nowrap", options.class)))

/** The tick of a selected option. `undefined` for the others. */
export const SelectItemIndicator = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption & { readonly value: V }
) =>
  select.itemIndicator({
    element: h.span.class(
      cn(
        "mr-1.5 mb-0.5 ml-2.5 h-[9px] w-[5px] shrink-0 rotate-45 border-r-[1.5px] border-b-[1.5px] border-brand",
        options.class
      )
    ),
    value: options.value
  })

/** A checkbox in front of an option's label, for a `multiple` select. */
export const SelectItemCheckbox = <Msg>(h: Html.H<Msg>, options: ClassOption = {}) =>
  h.span
    .attr("aria-hidden", "true")
    .class(
      cn(
        "grid size-[15px] shrink-0 place-items-center rounded-xs border border-input bg-background transition-colors",
        "duration-150 in-data-[selected]:border-brand in-data-[selected]:bg-brand",
        "in-data-[selected]:before:mb-0.5 in-data-[selected]:before:h-2 in-data-[selected]:before:w-1",
        "in-data-[selected]:before:rotate-45 in-data-[selected]:before:border-r-[1.5px]",
        "in-data-[selected]:before:border-b-[1.5px] in-data-[selected]:before:border-brand-foreground",
        options.class
      )
    )

/** A run of options under a `SelectGroupLabel`. */
export const SelectGroup = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption & { readonly group: string }
) => select.group({ element: h.div.key(options.group).class(cn(options.class)), group: options.group })

export const SelectGroupLabel = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption & { readonly group: string }
) =>
  select.groupLabel({
    element: h.div.class(cn("px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground", options.class)),
    group: options.group
  })

export const SelectSeparator = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption & { readonly key?: string | undefined } = {}
) => {
  const element = h.div.class(cn("-mx-1 my-1 h-px bg-border", options.class))
  return select.separator(options.key === undefined ? element : element.key(options.key))
}

const scrollArrow =
  "inset-x-0 z-10 hidden h-6 cursor-default place-items-center rounded-lg bg-popover data-[visible]:grid " +
  "before:size-1.5 before:rotate-45 before:border-muted-foreground"

/** Shown while the list can scroll up. Hovering it scrolls. Needs `SelectList`. */
export const SelectScrollUpArrow = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption = {}
) =>
  select.scrollUpArrow({
    keepMounted: true,
    element: h.div.class(
      cn(scrollArrow, "top-0 before:translate-y-0.5 before:border-t-[1.5px] before:border-l-[1.5px]", options.class)
    )
  })

/** Shown while the list can scroll down. Hovering it scrolls. Needs `SelectList`. */
export const SelectScrollDownArrow = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption = {}
) =>
  select.scrollDownArrow({
    keepMounted: true,
    element: h.div.class(
      cn(scrollArrow, "bottom-0 before:-translate-y-0.5 before:border-r-[1.5px] before:border-b-[1.5px]", options.class)
    )
  })
