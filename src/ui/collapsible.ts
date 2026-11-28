import type { Component } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import type { Collapsible } from "@effect/ui-kit"
import { cn } from "#lib/cn"

type CollapsibleParts = Component.Headless.Parts<typeof Collapsible>

const triggerBase =
  "text-[13px] font-medium transition-colors duration-150 " +
  "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 [&_svg]:size-[15px] [&_svg]:shrink-0"

const triggerVariants = {
  row:
    "flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-foreground hover:bg-accent " +
    "after:mr-1 after:ml-auto after:size-1.5 after:shrink-0 after:-rotate-45 after:border-r-[1.5px] " +
    "after:border-b-[1.5px] after:border-muted-foreground after:transition-transform after:duration-200 " +
    "data-[panel-open]:after:rotate-45",
  icon:
    "inline-flex size-8 shrink-0 items-center justify-center rounded-sm border border-input bg-background " +
    "text-foreground shadow-sm hover:bg-accent",
  link:
    "inline-flex items-center gap-1.5 rounded-xs text-muted-foreground underline-offset-4 " +
    "hover:text-foreground hover:underline"
} as const

export type CollapsibleTriggerVariant = keyof typeof triggerVariants

interface ClassOption {
  readonly class?: string | undefined
}

/** The `<div>` around the trigger and the panel. */
export const CollapsibleRoot = <Msg>(h: Html.H<Msg>, collapsible: CollapsibleParts, options: ClassOption = {}) =>
  collapsible.root(h.div.class(cn("w-full", options.class)))

/**
 * The button that opens and closes the panel: a full-width `row` with a chevron,
 * a square `icon` button, or a quiet `link`.
 */
export const CollapsibleTrigger = <Msg>(
  h: Html.H<Msg>,
  collapsible: CollapsibleParts,
  options: ClassOption & { readonly variant?: CollapsibleTriggerVariant | undefined } = {}
) => collapsible.trigger(h.button.class(cn(triggerBase, triggerVariants[options.variant ?? "row"], options.class)))

/**
 * The panel, whose height animates from the kit's `--collapsible-panel-height`.
 * `undefined` once it has closed, so chain with `?.children(...)`. Keep padding
 * on its children, so it can shrink to nothing.
 */
export const CollapsiblePanel = <Msg>(h: Html.H<Msg>, collapsible: CollapsibleParts, options: ClassOption = {}) =>
  collapsible.panel(
    h.div.class(
      cn(
        "h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out " +
          "data-[starting-style]:h-0 data-[ending-style]:h-0",
        options.class
      )
    )
  )
