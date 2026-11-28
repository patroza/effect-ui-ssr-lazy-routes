import type { Component } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import type { Collapsible } from "@effect/ui-kit"
import * as Cx from "./cx.ts"

export type CollapsibleParts = Component.Headless.Parts<typeof Collapsible>

const triggerBase =
  "cursor-pointer text-[13px] font-medium transition-colors duration-150 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:focus-visible:outline-sky-400 " +
  "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 [&_svg]:size-[15px] [&_svg]:shrink-0"

const triggerVariants = {
  row:
    "flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-neutral-900 hover:bg-neutral-100 " +
    "dark:text-neutral-100 dark:hover:bg-neutral-800 " +
    "after:mr-1 after:ml-auto after:size-1.5 after:shrink-0 after:-rotate-45 after:border-r-[1.5px] " +
    "after:border-b-[1.5px] after:border-neutral-500 after:transition-transform after:duration-200 " +
    "data-[panel-open]:after:rotate-45",
  icon:
    "inline-flex size-8 shrink-0 items-center justify-center rounded-sm border border-neutral-300 bg-white " +
    "text-neutral-900 shadow-xs hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800",
  link: "inline-flex items-center gap-1.5 rounded-xs text-sky-700 underline-offset-4 hover:underline dark:text-sky-400"
} as const

export type CollapsibleTriggerVariant = keyof typeof triggerVariants

interface ClassOption {
  readonly class?: string | undefined
}

/** The `<div>` around the trigger and the panel. */
export const CollapsibleRoot = <Msg>(h: Html.H<Msg>, collapsible: CollapsibleParts, options: ClassOption = {}) =>
  collapsible.root(h.div.class(Cx.cx("w-full", options.class)))

/**
 * The button that opens and closes the panel: a full-width `row` with a chevron,
 * a square `icon` button, or a `link`.
 */
export const CollapsibleTrigger = <Msg>(
  h: Html.H<Msg>,
  collapsible: CollapsibleParts,
  options: ClassOption & { readonly variant?: CollapsibleTriggerVariant | undefined } = {}
) => collapsible.trigger(h.button.class(Cx.cx(triggerBase, triggerVariants[options.variant ?? "row"], options.class)))

/**
 * The panel, whose height animates from `--collapsible-panel-height`.
 * `undefined` once closed, so chain with `?.children(...)`.
 */
export const CollapsiblePanel = <Msg>(h: Html.H<Msg>, collapsible: CollapsibleParts, options: ClassOption = {}) =>
  collapsible.panel(
    h.div.class(
      Cx.cx(
        "h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out " +
          "data-[starting-style]:h-0 data-[ending-style]:h-0",
        options.class
      )
    )
  )
