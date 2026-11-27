import { type Cause, Option, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { Html } from "@effect/ui/html"
import { Button } from "@effect/ui-kit"
import * as ApiError from "../rpc/domain/ApiError.ts"
import * as Design from "./classes.ts"

/**
 * The data state handed to a page's `onReady` branch once `matchQuery` has
 * proved that usable data is present — either from the latest `Success` or
 * preserved via `Failure.previousSuccess` when a client refresh fails.
 */
export interface ReadyQuery<A, E> {
  readonly data: A
  readonly waiting: boolean
  readonly refreshFailure: Cause.Cause<E> | undefined
}

export interface MatchQueryHandlers<A, E, OutInitial, OutFailure, OutReady> {
  readonly onInitial: (result: AsyncResult.Initial<A, E>) => OutInitial
  readonly onFailure: (cause: Cause.Cause<E>, result: AsyncResult.Failure<A, E>) => OutFailure
  readonly onReady: (ready: ReadyQuery<A, E>) => OutReady
}

/**
 * Single boundary matcher for `@effect/ui` `h.queries.*` results.
 *
 * Unlike ad-hoc `AsyncResult.match` helpers that turn `Initial` and `Failure`
 * into `undefined` (forcing downstream `is defined` checks), this splits the
 * view cleanly into:
 * - `onInitial`: cold load (never reached during hydrated SSR),
 * - `onFailure`: failed with no previous data (renders an error panel),
 * - `onReady`: always receives defined `data: A` (plus optional `refreshFailure`
 *   when a client refresh failed over previously loaded SSR/cached data).
 */
export const matchQuery = <A, E, OutInitial, OutFailure, OutReady>(
  result: AsyncResult.AsyncResult<A, E>,
  handlers: MatchQueryHandlers<A, E, OutInitial, OutFailure, OutReady>
): OutInitial | OutFailure | OutReady => {
  if (AsyncResult.isInitial(result)) {
    return handlers.onInitial(result)
  }
  if (AsyncResult.isSuccess(result)) {
    return handlers.onReady({
      data: result.value,
      waiting: result.waiting,
      refreshFailure: undefined
    })
  }
  if (Option.isSome(result.previousSuccess)) {
    return handlers.onReady({
      data: result.previousSuccess.value.value,
      waiting: result.waiting,
      refreshFailure: result.cause
    })
  }
  return handlers.onFailure(result.cause, result)
}

const isApiError = Schema.is(ApiError.ApiError)

/**
 * Formats a failure cause safely for display: surfaces explicit domain `ApiError`
 * messages, while hiding internal transport/defect details (such as socket errors).
 */
export const describeFailure = (cause: Cause.Cause<unknown>): string => {
  // Lazy cause inspect: unwrap the primary error only to reveal typed ApiError text.
  for (const reason of cause.reasons) {
    if (reason._tag === "Fail" && isApiError(reason.error)) {
      return reason.error.message
    }
  }
  return "Something went wrong while loading data. Please try again."
}

export interface ErrorPanelOptions<M> {
  readonly title: string
  readonly cause: Cause.Cause<unknown>
  readonly onRetry?: M | undefined
  readonly retryLabel?: string | undefined
  readonly heading?: 1 | 2 | undefined
  readonly httpStatus?: "503" | undefined
  readonly testId?: string | undefined
}

/** Dedicated error component rendered when a query fails with no prior data. */
export const errorPanel = <M>(h: Html.H<M>, options: ErrorPanelOptions<M>) => {
  const heading =
    options.heading === 2
      ? h.h2.class("text-lg font-semibold").children(options.title)
      : h.h1.class(Design.ui.title).children(options.title)

  return h.div
    .class(`${Design.ui.card} ${Design.ui.stack} border-red-300 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30`)
    .attrs({
      role: "alert",
      "data-testid": options.testId ?? "query-error",
      ...(options.httpStatus === undefined ? {} : { "data-http-status": options.httpStatus })
    })
    .children(
      heading,
      h.p.class(Design.ui.muted).attr("data-testid", "query-error-message").children(describeFailure(options.cause)),
      options.onRetry === undefined
        ? undefined
        : h.div.children(
            Button(h, { onPress: options.onRetry })
              .class(Design.ui.button)
              .attr("data-testid", "query-error-retry")
              .children(options.retryLabel ?? "Retry")
          )
    )
}

export interface RefreshErrorBannerOptions<M> {
  readonly cause: Cause.Cause<unknown>
  readonly waiting: boolean
  readonly onRetry: M
  readonly testId?: string | undefined
}

/** Inline warning shown above preserved SSR/cached data when a client refresh fails. */
export const refreshErrorBanner = <M>(h: Html.H<M>, options: RefreshErrorBannerOptions<M>) =>
  h.div
    .key("refresh-error")
    .class(
      `${Design.ui.card} ${Design.ui.row} justify-between border-amber-300 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30`
    )
    .attrs({
      role: "alert",
      "data-testid": options.testId ?? "refresh-error"
    })
    .children(
      h.p
        .class(Design.ui.muted)
        .attr("data-testid", "refresh-error-message")
        .children(`Refresh failed — showing last loaded data: ${describeFailure(options.cause)}`),
      Button(h, {
        props: { disabled: options.waiting },
        onPress: options.onRetry
      })
        .class(Design.ui.button)
        .attr("data-testid", "refresh-error-retry")
        .children(options.waiting ? "Retrying…" : "Retry refresh")
    )

export interface RefreshButtonOptions<M> {
  readonly waiting: boolean
  readonly onRefresh: M
  readonly testId?: string | undefined
  readonly label?: string | undefined
}

/** Consistent manual refresh button backed by `Query.invalidate`. */
export const refreshButton = <M>(h: Html.H<M>, options: RefreshButtonOptions<M>) =>
  Button(h, {
    props: { disabled: options.waiting },
    onPress: options.onRefresh
  })
    .class(Design.ui.button)
    .attr("data-testid", options.testId ?? "refresh-button")
    .children(options.waiting ? "Refreshing…" : (options.label ?? "Refresh"))
