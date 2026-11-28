import type { Component } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import type { ButtonElement, makeSelect } from "@effect/ui-kit"
import * as Cx from "./cx.ts"

/** What the `view` closure of the kit's `Select` or `makeSelect` receives. */
export type SelectParts<V extends string = string> = Component.Headless.Parts<ReturnType<typeof makeSelect<V>>>

export type SelectSize = keyof typeof triggerSizes

interface ClassOption {
  readonly class?: string | undefined
}

const triggerSizes = {
  sm: "h-7 min-w-36 gap-1.5 rounded-sm pr-2 pl-2.5 text-xs",
  default: "h-9 min-w-48 pr-2.5 pl-3 text-sm",
  lg: "h-10 min-w-56 pr-3 pl-3.5 text-sm"
} as const

const popupSizes = {
  sm: "text-xs [&_[role=option]]:min-h-6.5 [&_[role=option]]:px-1.5 [&_[role=option]]:py-0.5",
  default: "text-sm",
  lg: "text-sm [&_[role=option]]:min-h-8.5 [&_[role=option]]:px-2.5"
} as const

/** The text above the trigger. It names the trigger, and a click focuses it. */
export const SelectLabel = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption = {}
) => select.label(h.div.class(Cx.cx("mb-1.5 cursor-default text-sm leading-snug font-medium", options.class)))

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
    (options.element ?? h.button)
      .on("mousedown", () => undefined, { preventDefault: "always" })
      .class(
        Cx.cx(
          "inline-flex cursor-pointer items-center justify-between gap-2 rounded-md border border-neutral-300 bg-white text-start",
          "leading-none whitespace-nowrap text-neutral-900 shadow-xs select-none",
          "transition-colors duration-150 hover:bg-neutral-100 data-[popup-open]:bg-neutral-100",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600",
          "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[disabled]:hover:bg-white",
          "data-[readonly]:cursor-default data-[readonly]:bg-neutral-100",
          "dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800 dark:data-[popup-open]:bg-neutral-800 dark:focus-visible:outline-sky-400",
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
    h.span.class(
      Cx.cx(
        "min-w-0 truncate leading-snug data-[placeholder]:text-neutral-500 dark:data-[placeholder]:text-neutral-400",
        options.class
      )
    )
  )

/** The chevron inside the trigger. */
export const SelectIcon = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption = {}
) =>
  select.icon(
    h.span.class(
      Cx.cx(
        "mx-1 mb-[3px] size-[7px] shrink-0 rotate-45 border-r-[1.5px] border-b-[1.5px] border-neutral-500 dark:border-neutral-400",
        options.class
      )
    )
  )

/** The element the kit places for the popup. Put `SelectPopup` inside. */
export const SelectPositioner = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption = {}
) => select.positioner(h.div.class(Cx.cx("outline-none data-[side=none]:my-2.5", options.class)))

/** The box with the options. */
export const SelectPopup = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption & { readonly size?: SelectSize | undefined } = {}
) =>
  select.popup(
    h.div.class(
      Cx.cx(
        "relative box-border max-w-[var(--available-width)] min-w-[max(var(--anchor-width),10rem)] overflow-y-auto",
        "rounded-lg border border-neutral-200 bg-white p-1 text-neutral-900 shadow-lg outline-none",
        "dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100",
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
      .class(Cx.cx("min-h-0 flex-1 overflow-y-auto p-1 outline-none [scrollbar-width:none]", options.class))
  )

/** One option. Put `SelectItemText` and `SelectItemIndicator` inside. */
export const SelectItem = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption & { readonly value: V }
) =>
  select.item({
    element: h.div.class(
      Cx.cx(
        "flex min-h-7.5 cursor-pointer scroll-my-1 items-center gap-2 rounded-sm px-2.5 py-1.5 leading-snug outline-none select-none",
        "data-[highlighted]:bg-neutral-100 dark:data-[highlighted]:bg-neutral-800",
        "data-[selected]:font-medium data-[disabled]:text-neutral-500 data-[disabled]:opacity-60",
        "[&_svg]:size-[15px] [&_svg]:shrink-0 [&_svg]:text-neutral-500",
        options.class
      )
    ),
    value: options.value
  })

/** The option's label, aligned with the trigger's text. */
export const SelectItemText = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption = {}
) => select.itemText(h.div.class(Cx.cx("min-w-0 flex-1 whitespace-nowrap", options.class)))

/** The tick of a selected option. `undefined` for unselected items. */
export const SelectItemIndicator = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption & { readonly value: V }
) =>
  select.itemIndicator({
    element: h.span.class(
      Cx.cx(
        "mr-1.5 mb-0.5 ml-2.5 h-[9px] w-[5px] shrink-0 rotate-45 border-r-[1.5px] border-b-[1.5px] border-sky-600 dark:border-sky-400",
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
      Cx.cx(
        "grid size-[15px] shrink-0 place-items-center rounded-xs border border-neutral-300 bg-white transition-colors",
        "duration-150 in-data-[selected]:border-sky-600 in-data-[selected]:bg-sky-600 dark:border-neutral-700 dark:bg-neutral-900 dark:in-data-[selected]:border-sky-400 dark:in-data-[selected]:bg-sky-400",
        "in-data-[selected]:before:mb-0.5 in-data-[selected]:before:h-2 in-data-[selected]:before:w-1",
        "in-data-[selected]:before:rotate-45 in-data-[selected]:before:border-r-[1.5px]",
        "in-data-[selected]:before:border-b-[1.5px] in-data-[selected]:before:border-white",
        options.class
      )
    )

/** A run of options under a `SelectGroupLabel`. */
export const SelectGroup = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption & { readonly group: string }
) => select.group({ element: h.div.key(options.group).class(Cx.cx(options.class)), group: options.group })

export const SelectGroupLabel = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption & { readonly group: string }
) =>
  select.groupLabel({
    element: h.div.class(
      Cx.cx("px-2 pt-1.5 pb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400", options.class)
    ),
    group: options.group
  })

export const SelectSeparator = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption & { readonly key?: string | undefined } = {}
) => {
  const element = h.div.class(Cx.cx("-mx-1 my-1 h-px bg-neutral-200 dark:bg-neutral-800", options.class))
  return select.separator(options.key === undefined ? element : element.key(options.key))
}

const scrollArrow =
  "inset-x-0 z-10 hidden h-6 cursor-default place-items-center rounded-lg bg-white dark:bg-neutral-900 data-[visible]:grid " +
  "before:size-1.5 before:rotate-45 before:border-neutral-500 dark:before:border-neutral-400"

/** Shown while the list can scroll up. Hovering it scrolls. Needs `SelectList`. */
export const SelectScrollUpArrow = <Msg, V extends string = string>(
  h: Html.H<Msg>,
  select: SelectParts<V>,
  options: ClassOption = {}
) =>
  select.scrollUpArrow({
    keepMounted: true,
    element: h.div.class(
      Cx.cx(scrollArrow, "top-0 before:translate-y-0.5 before:border-t-[1.5px] before:border-l-[1.5px]", options.class)
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
      Cx.cx(
        scrollArrow,
        "bottom-0 before:-translate-y-0.5 before:border-r-[1.5px] before:border-b-[1.5px]",
        options.class
      )
    )
  })
