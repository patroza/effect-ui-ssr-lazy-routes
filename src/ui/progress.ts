import type { Component } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import type { Progress } from "@effect/ui-kit"
import { cn } from "#lib/cn"

type ProgressParts = Component.Headless.Parts<typeof Progress>

const sizes = { sm: "sm", md: "md", lg: "lg" } as const
const variants = { default: "default", success: "success", destructive: "destructive" } as const

export type ProgressSize = keyof typeof sizes
export type ProgressVariant = keyof typeof variants

interface ClassOption {
  readonly class?: string | undefined
}

/**
 * The `role="progressbar"` root: a two-column grid with the label and the value
 * above the track. `size` sets the track's height and `variant` the fill.
 * Without a label, chain an `aria-label`.
 */
export const ProgressRoot = <Msg>(
  h: Html.H<Msg>,
  progress: ProgressParts,
  options: ClassOption & {
    readonly size?: ProgressSize | undefined
    readonly variant?: ProgressVariant | undefined
  } = {}
) =>
  progress.root(
    h.div
      .class(cn("group/progress grid w-full grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-2", options.class))
      .attrs({ "data-size": sizes[options.size ?? "md"], "data-variant": variants[options.variant ?? "default"] })
  )

export const ProgressLabel = <Msg>(h: Html.H<Msg>, progress: ProgressParts, options: ClassOption = {}) =>
  progress.label(h.span.class(cn("text-[13px] font-medium text-foreground", options.class)))

/** The value's text. The kit fills it in when it has no children. */
export const ProgressValue = <Msg>(h: Html.H<Msg>, progress: ProgressParts, options: ClassOption = {}) =>
  progress.value(h.span.class(cn("text-[13px] text-muted-foreground tabular-nums", options.class)))

export const ProgressTrack = <Msg>(h: Html.H<Msg>, progress: ProgressParts, options: ClassOption = {}) =>
  progress.track(
    h.div.class(
      cn(
        "col-span-2 h-2 overflow-hidden rounded-full bg-secondary group-data-[size=sm]/progress:h-1 " +
          "group-data-[size=lg]/progress:h-3",
        options.class
      )
    )
  )

/**
 * The fill. The kit sets its width, and none while indeterminate, when a
 * short bar slides across the track (`animate-indeterminate` is defined in
 * `styles/tailwind.css`).
 */
export const ProgressIndicator = <Msg>(h: Html.H<Msg>, progress: ProgressParts, options: ClassOption = {}) =>
  progress.indicator(
    h.div.class(
      cn(
        "h-full rounded-full bg-brand transition-[width] duration-300 ease-out " +
          "data-[indeterminate]:w-2/5 data-[indeterminate]:animate-indeterminate " +
          "group-data-[variant=success]/progress:bg-success group-data-[variant=destructive]/progress:bg-destructive",
        options.class
      )
    )
  )
