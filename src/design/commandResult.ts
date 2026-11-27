import type { Html } from "@effect/ui/html"
import { Button, Progress } from "@effect/ui-kit"
import * as Design from "./classes.ts"
import * as CommandTrace from "../workflow/CommandTrace.ts"

export interface CommandButtonOptions<M> {
  readonly label: string
  readonly busyLabel?: string | undefined
  readonly busy?: boolean | undefined
  readonly disabled?: boolean | undefined
  readonly variant?: "default" | "primary" | "danger" | undefined
  readonly testId?: string | undefined
  readonly onPress: M
}

const variantClass = (variant: "default" | "primary" | "danger" | undefined): string => {
  switch (variant) {
    case "primary":
      return `${Design.ui.button} border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200`
    case "danger":
      return `${Design.ui.button} border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/50`
    default:
      return Design.ui.button
  }
}

/**
 * MVU counterpart to `scanner`'s `CommandButton.vue`: renders busy state,
 * disables repeat activation while in flight, and keeps button chrome consistent.
 */
export const commandButton = <M>(h: Html.H<M>, options: CommandButtonOptions<M>) =>
  Button(h, {
    props: { disabled: options.busy === true || options.disabled === true },
    onPress: options.onPress
  })
    .class(variantClass(options.variant))
    .attr("aria-busy", options.busy === true ? "true" : undefined)
    .attr("data-testid", options.testId)
    .children(options.busy === true ? (options.busyLabel ?? options.label) : options.label)

export interface CommandErrorBannerOptions<M> {
  readonly title: string
  readonly span?: CommandTrace.SpanPointer | null | undefined
  readonly traceRefLabel?: ((traceId: string) => string) | undefined
  readonly retryLabel?: string | undefined
  readonly dismissLabel?: string | undefined
  readonly testId?: string | undefined
  readonly onRetry?: M | undefined
  readonly onDismiss?: M | undefined
}

/**
 * Inline `role="alert"` error banner for Command failures with optional OTel trace
 * reference badge, retry trigger, and dismiss action (never a transient toast).
 */
export const commandErrorBanner = <M>(h: Html.H<M>, options: CommandErrorBannerOptions<M>) => {
  const shortRef = CommandTrace.shortTraceRef(options.span)
  const formatTrace = options.traceRefLabel ?? ((traceId: string) => `Ref ${traceId}`)
  return h.div
    .key(options.testId ?? "command-error-banner")
    .class(
      `${Design.ui.card} flex flex-wrap items-center justify-between gap-3 border-red-300 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30`
    )
    .attrs({ role: "alert", "data-testid": options.testId ?? "command-error-banner" })
    .children(
      h.div
        .class("flex flex-col gap-1")
        .children(
          h.p.class("text-sm font-medium text-red-800 dark:text-red-300").children(options.title),
          shortRef === undefined
            ? undefined
            : h.span
                .class("font-mono text-xs text-red-700/80 dark:text-red-400")
                .attr("data-testid", "command-trace-ref")
                .children(formatTrace(shortRef))
        ),
      options.onRetry === undefined && options.onDismiss === undefined
        ? undefined
        : h.div.class(Design.ui.row).children(
            options.onRetry === undefined
              ? undefined
              : Button(h, { onPress: options.onRetry })
                  .class(Design.ui.button)
                  .attr("data-testid", "command-error-retry")
                  .children(options.retryLabel ?? "Retry"),
            options.onDismiss === undefined
              ? undefined
              : Button(h, { onPress: options.onDismiss })
                  .class(Design.ui.button)
                  .attr("data-testid", "command-error-dismiss")
                  .children(options.dismissLabel ?? "Dismiss")
          )
    )
}

export interface CommandProgressPanelOptions<M> {
  readonly label: string
  readonly value: number | null
  readonly max: number
  readonly valueText?: string | undefined
  readonly cancelLabel?: string | undefined
  readonly testId?: string | undefined
  readonly onCancel?: M | undefined
}

/**
 * Inline streaming Command progress bar powered by `@effect/ui-kit` `Progress`,
 * paired with an explicit `Cancel` action (`Command.interrupt`).
 */
export const commandProgressPanel = <M>(h: Html.H<M>, options: CommandProgressPanelOptions<M>) =>
  h.div
    .key(options.testId ?? "command-progress-panel")
    .class(`${Design.ui.card} ${Design.ui.stack} border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/20`)
    .attrs({ role: "status", "data-testid": options.testId ?? "command-progress-panel" })
    .children(
      Progress(h, {
        props: {
          value: options.value,
          max: options.max,
          valueText: options.valueText
        },
        view: (progress) =>
          progress.root(h.div.class("flex flex-col gap-2")).children(
            h.div.class("flex flex-wrap items-center justify-between gap-2").children(
              progress
                .label(h.span)
                .class("text-sm font-medium text-sky-950 dark:text-sky-100")
                .children(options.label),
              h.div.class(Design.ui.row).children(
                progress.value(h.span).class("font-mono text-xs text-sky-800 dark:text-sky-300"),
                options.onCancel === undefined
                  ? undefined
                  : Button(h, { onPress: options.onCancel })
                      .class(Design.ui.button)
                      .attr("data-testid", "command-progress-cancel")
                      .children(options.cancelLabel ?? "Cancel")
              )
            ),
            progress
              .track(h.div.class("h-2 w-full overflow-hidden rounded-full bg-sky-200 dark:bg-sky-900"))
              .children(
                progress.indicator(h.div.class("h-full rounded-full bg-sky-600 transition-all dark:bg-sky-400"))
              )
          )
      })
    )
