import type { Component } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import type { Fieldset } from "@effect/ui-kit"
import { cn } from "#lib/cn"

/** What the kit's `Fieldset` hands its `view` closure. */
export type FieldsetParts = Component.Headless.Parts<typeof Fieldset>

interface ClassOption {
  readonly class?: string | undefined
}

const variants = {
  default: "border-0 p-0",
  card: "rounded-lg border border-border bg-card p-5"
} as const

export type FieldsetVariant = keyof typeof variants

/** The `<fieldset>`: a column of fields under one legend. `card` draws a border around them. */
export const FieldsetRoot = <Msg>(
  h: Html.H<Msg>,
  fieldset: FieldsetParts,
  options: ClassOption & { readonly variant?: FieldsetVariant | undefined } = {}
) =>
  fieldset.root(
    h.fieldset.class(cn("m-0 flex min-w-0 flex-col gap-4", variants[options.variant ?? "default"], options.class))
  )

/** The fieldset's name. Always draw it: the root points at it. */
export const FieldsetLegend = <Msg>(h: Html.H<Msg>, fieldset: FieldsetParts, options: ClassOption = {}) =>
  fieldset.legend(h.div.class(cn("text-sm font-semibold data-[disabled]:opacity-50", options.class)))

/** A sentence under the legend. Point the root's `aria-describedby` at its id. */
export const FieldsetDescription = <Msg>(h: Html.H<Msg>, options: ClassOption = {}) =>
  h.p.class(cn("m-0 mt-1 text-[13px] text-muted-foreground", options.class))
