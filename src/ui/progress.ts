import type { Component } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import type { Progress } from "@effect/ui-kit"
import * as Cx from "./cx.ts"

export type ProgressParts = Component.Headless.Parts<typeof Progress>

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
      .class(Cx.cx("group/progress grid w-full grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-2", options.class))
      .attrs({ "data-size": sizes[options.size ?? "md"], "data-variant": variants[options.variant ?? "default"] })
  )

export const ProgressLabel = <Msg>(h: Html.H<Msg>, progress: ProgressParts, options: ClassOption = {}) =>
  progress.label(h.span.class(Cx.cx("text-sm font-medium text-sky-950 dark:text-sky-100", options.class)))

/** The value's text. The kit fills it in when it has no children. */
export const ProgressValue = <Msg>(h: Html.H<Msg>, progress: ProgressParts, options: ClassOption = {}) =>
  progress.value(h.span.class(Cx.cx("text-xs text-sky-800 tabular-nums dark:text-sky-300", options.class)))

export const ProgressTrack = <Msg>(h: Html.H<Msg>, progress: ProgressParts, options: ClassOption = {}) =>
  progress.track(
    h.div.class(
      Cx.cx(
        "col-span-2 h-2 overflow-hidden rounded-full bg-sky-200 dark:bg-sky-900",
        "group-data-[size=sm]/progress:h-1 group-data-[size=lg]/progress:h-3",
        options.class
      )
    )
  )

/** The fill. Uses `animate-indeterminate` while value is null. */
export const ProgressIndicator = <Msg>(h: Html.H<Msg>, progress: ProgressParts, options: ClassOption = {}) =>
  progress.indicator(
    h.div.class(
      Cx.cx(
        "h-full rounded-full bg-sky-600 transition-[width] duration-300 ease-out dark:bg-sky-400",
        "data-[indeterminate]:w-2/5 data-[indeterminate]:animate-indeterminate",
        "group-data-[variant=success]/progress:bg-emerald-600 dark:group-data-[variant=success]/progress:bg-emerald-400",
        "group-data-[variant=destructive]/progress:bg-red-600 dark:group-data-[variant=destructive]/progress:bg-red-400",
        options.class
      )
    )
  )
