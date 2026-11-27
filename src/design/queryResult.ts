import { type Cause, Option, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import type { Html } from "@effect/ui/html"
import { Button } from "@effect/ui-kit"
import * as ApiError from "../rpc/domain/ApiError.ts"
import * as Design from "./classes.ts"

/**
 * Cold-load state returned by {@link read} before a query settles (never reached
 * during hydrated SSR).
 */
export interface InitialQuery {
  readonly _tag: "Initial"
  readonly waiting: boolean
}

/**
 * Unrecoverable failure state returned by {@link read} when a query fails with
 * no previously loaded data to fall back on.
 */
export interface FailureQuery<E> {
  readonly _tag: "Failure"
  readonly cause: Cause.Cause<E>
  readonly waiting: boolean
}

/**
 * Usable data state returned by {@link read} once data is present — either from
 * the latest `Success` or preserved via `Failure.previousSuccess` when a client
 * refresh fails.
 */
export interface ReadyQuery<A, E> {
  readonly _tag: "Ready"
  readonly data: A
  readonly waiting: boolean
  readonly refreshFailure: Cause.Cause<E> | undefined
}

export type QueryState<A, E> = InitialQuery | FailureQuery<E> | ReadyQuery<A, E>

export const isInitial = <A, E>(state: QueryState<A, E>): state is InitialQuery => state._tag === "Initial"

export const isFailure = <A, E>(state: QueryState<A, E>): state is FailureQuery<E> => state._tag === "Failure"

export const isReady = <A, E>(state: QueryState<A, E>): state is ReadyQuery<A, E> => state._tag === "Ready"

/**
 * Single boundary reader for `@effect/ui` `h.queries.*` results.
 *
 * Unlike ad-hoc `AsyncResult.match` helpers that turn `Initial` and `Failure`
 * into `undefined` (forcing downstream `is defined` checks), this flattens the
 * result into one discriminated union checked with {@link isInitial},
 * {@link isFailure}, and {@link isReady}:
 * - `Initial`: cold load (never reached during hydrated SSR),
 * - `Failure`: failed with no previous data (renders an error panel),
 * - `Ready`: always carries defined `data: A` (plus `refreshFailure` when a
 *   client refresh failed over previously loaded SSR/cached data).
 */
export const read = <A, E>(result: AsyncResult.AsyncResult<A, E>): QueryState<A, E> => {
  if (AsyncResult.isInitial(result)) {
    return {
      _tag: "Initial",
      waiting: result.waiting
    }
  }
  if (AsyncResult.isSuccess(result)) {
    return {
      _tag: "Ready",
      data: result.value,
      waiting: result.waiting,
      refreshFailure: undefined
    }
  }
  if (Option.isSome(result.previousSuccess)) {
    return {
      _tag: "Ready",
      data: result.previousSuccess.value.value,
      waiting: result.waiting,
      refreshFailure: result.cause
    }
  }
  return {
    _tag: "Failure",
    cause: result.cause,
    waiting: result.waiting
  }
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
  readonly cause?: Cause.Cause<unknown> | undefined
  readonly onRetry?: M | undefined
  readonly retryLabel?: string | undefined
  readonly heading?: 1 | 2 | undefined
  readonly httpStatus?: "503" | undefined
  readonly testId?: string | undefined
}

/** Dedicated error component rendered when a query fails with no prior data. */
export const errorPanel = <M>(h: Html.H<M>, failure: FailureQuery<unknown>, options: ErrorPanelOptions<M>) => {
  const cause = options.cause ?? failure.cause
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
      h.p.class(Design.ui.muted).attr("data-testid", "query-error-message").children(describeFailure(cause)),
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
  readonly cause?: Cause.Cause<unknown> | undefined
  readonly waiting?: boolean | undefined
  readonly onRetry: M
  readonly testId?: string | undefined
}

/** Inline warning shown above preserved SSR/cached data when a client refresh fails. */
export const refreshErrorBanner = <M>(
  h: Html.H<M>,
  ready: ReadyQuery<unknown, unknown>,
  options: RefreshErrorBannerOptions<M>
) => {
  const cause = options.cause ?? ready.refreshFailure
  if (cause === undefined) return undefined
  const waiting = options.waiting ?? ready.waiting
  return h.div
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
        .children(`Refresh failed — showing last loaded data: ${describeFailure(cause)}`),
      Button(h, {
        props: { disabled: waiting },
        onPress: options.onRetry
      })
        .class(Design.ui.button)
        .attr("data-testid", "refresh-error-retry")
        .children(waiting ? "Retrying…" : "Retry refresh")
    )
}

export interface RefreshButtonOptions<M> {
  readonly waiting?: boolean | undefined
  readonly onRefresh: M
  readonly testId?: string | undefined
  readonly label?: string | undefined
}

/** Consistent manual refresh button backed by `Query.invalidate`. */
export const refreshButton = <M>(
  h: Html.H<M>,
  state: { readonly waiting: boolean },
  options: RefreshButtonOptions<M>
) => {
  const waiting = options.waiting ?? state.waiting
  return Button(h, {
    props: { disabled: waiting },
    onPress: options.onRefresh
  })
    .class(Design.ui.button)
    .attr("data-testid", options.testId ?? "refresh-button")
    .children(waiting ? "Refreshing…" : (options.label ?? "Refresh"))
}
