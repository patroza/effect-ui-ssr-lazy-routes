import type { Html } from "@effect/ui/html"
import { Progress } from "@effect/ui-kit"
import { Button, type ButtonVariant } from "#ui/button"
import { ProgressIndicator, ProgressLabel, ProgressRoot, ProgressTrack, ProgressValue } from "#ui/progress"
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

const mapButtonVariant = (variant: "default" | "primary" | "danger" | undefined): ButtonVariant => {
  switch (variant) {
    case "primary":
      return "default"
    case "danger":
      return "destructive"
    default:
      return "outline"
  }
}

/**
 * MVU counterpart to `scanner`'s `CommandButton.vue`: renders busy state,
 * disables repeat activation while in flight, and keeps button chrome consistent.
 */
export const commandButton = <M>(h: Html.H<M>, options: CommandButtonOptions<M>) =>
  Button(h, {
    variant: mapButtonVariant(options.variant),
    props: { disabled: options.busy === true || options.disabled === true },
    onPress: options.onPress
  })
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
    .class(`${Design.ui.cardError} flex flex-wrap items-center justify-between gap-3`)
    .attrs({ role: "alert", "data-testid": options.testId ?? "command-error-banner" })
    .children(
      h.div
        .class("flex flex-col gap-1")
        .children(
          h.p.class("text-sm font-medium text-destructive").children(options.title),
          shortRef === undefined
            ? undefined
            : h.span
                .class("font-mono text-xs text-destructive/80")
                .attr("data-testid", "command-trace-ref")
                .children(formatTrace(shortRef))
        ),
      options.onRetry === undefined && options.onDismiss === undefined
        ? undefined
        : h.div.class(Design.ui.row).children(
            options.onRetry === undefined
              ? undefined
              : Button(h, { variant: "outline", onPress: options.onRetry })
                  .attr("data-testid", "command-error-retry")
                  .children(options.retryLabel ?? "Retry"),
            options.onDismiss === undefined
              ? undefined
              : Button(h, { variant: "outline", onPress: options.onDismiss })
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
 * Inline streaming Command progress bar powered by `@effect/ui-kit` `Progress`
 * and `effectcn`'s `Progress` primitives, paired with an explicit `Cancel`
 * action (`Command.interrupt`).
 */
export const commandProgressPanel = <M>(h: Html.H<M>, options: CommandProgressPanelOptions<M>) =>
  h.div
    .key(options.testId ?? "command-progress-panel")
    .class(`${Design.ui.cardInfo} ${Design.ui.stack}`)
    .attrs({ role: "status", "data-testid": options.testId ?? "command-progress-panel" })
    .children(
      Progress(h, {
        props: {
          value: options.value,
          max: options.max,
          valueText: options.valueText
        },
        view: (progress) =>
          ProgressRoot(h, progress).children(
            ProgressLabel(h, progress).children(options.label),
            h.div.class(Design.ui.row).children(
              ProgressValue(h, progress, { class: "font-mono text-xs" }),
              options.onCancel === undefined
                ? undefined
                : Button(h, { variant: "outline", size: "sm", onPress: options.onCancel })
                    .attr("data-testid", "command-progress-cancel")
                    .children(options.cancelLabel ?? "Cancel")
            ),
            ProgressTrack(h, progress).children(ProgressIndicator(h, progress))
          )
      })
    )
