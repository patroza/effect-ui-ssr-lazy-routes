import { Command, Component, Head, UiSchema } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { Effect, Schema } from "effect"
import * as Design from "../design/classes.ts"
import * as QueryResult from "../design/queryResult.ts"
import * as Routes from "../routes.ts"
import * as Status from "../status/domain/Status.ts"
import * as GetStatus from "../status/queries/GetStatus.ts"

/** Marker proving which chunk this page lands in (see scripts/verify-bundles.ts). */
export const STATUS_PAGE_CHUNK = "SENTINEL:status-page"

export const StatusPageMessage = UiSchema.TaggedEnum({
  ClickedRefresh: {}
})

const RefreshStatus = Command.make("RefreshStatus", { args: { mode: Status.StatusMode } }, ({ mode }) =>
  GetStatus.GetStatus.invalidate({ mode }).pipe(Effect.as(Component.noop))
)

/**
 * Pure content branch: only runs when `QueryResult.matchQuery` proved `data`
 * exists (either a fresh `Success` or a preserved `previousSuccess` after a
 * failed refresh). Zero `undefined` / `is defined` checks live here.
 */
const renderStatusContent = (h: Html.H<typeof StatusPageMessage.Type>, data: Status.SystemStatus, waiting: boolean) =>
  h.div
    .key("status-content")
    .class(Design.ui.stack)
    .attr("aria-busy", String(waiting))
    .children(
      h.div.class(`${Design.ui.row} justify-between`).children(
        h.div.children(
          h.p.class("font-medium").attr("data-testid", "status-revision").children(`Revision ${data.revision}`),
          h.p.class(Design.ui.muted).attr("data-testid", "status-note").children(data.note)
        ),
        QueryResult.refreshButton(h, {
          waiting,
          onRefresh: StatusPageMessage.ClickedRefresh()
        })
      ),
      h.ul
        .class("flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800")
        .attrs({ "data-testid": "status-services" })
        .children(
          data.services.map((service) =>
            h.li
              .key(service.name)
              .class("flex items-center justify-between py-2 text-sm")
              .children(
                h.span.children(service.name),
                h.span
                  .class(Design.ui.muted)
                  .children(`${service.healthy ? "Healthy" : "Down"} (${service.latencyMs} ms)`)
              )
          )
        )
    )

const StatusPageNoDeps = Html.component({
  name: "StatusPage",
  props: Schema.Struct({ mode: Schema.optional(Status.StatusMode) }),
  model: Schema.Struct({}),
  message: StatusPageMessage,
  queries: {
    status: {
      query: GetStatus.GetStatus,
      args: ({ props }) => ({ mode: props.mode ?? "ok" })
    }
  }
}).make({
  init: () => ({}),
  update: ($, message) =>
    StatusPageMessage.match(message, {
      ClickedRefresh: () => $.run(RefreshStatus.make({ mode: $.props.mode ?? "ok" }))
    }),
  head: () => [Head.title("Status")],
  view: (h) => {
    const mode = h.props.mode ?? "ok"
    const modeLinks = h.nav
      .class(Design.ui.row)
      .attr("aria-label", "Status scenarios")
      .children(
        h.a
          .class(Design.ui.link)
          .attr("href", Routes.AppRoute.print(Routes.AppRoute.Status({ search: {} })))
          .attr("aria-current", mode === "ok" ? "page" : undefined)
          .children("Normal"),
        h.span.class(Design.ui.muted).children("·"),
        h.a
          .class(Design.ui.link)
          .attr("href", Routes.AppRoute.print(Routes.AppRoute.Status({ search: { mode: "fail-ssr" } })))
          .attr("aria-current", mode === "fail-ssr" ? "page" : undefined)
          .children("SSR error"),
        h.span.class(Design.ui.muted).children("·"),
        h.a
          .class(Design.ui.link)
          .attr("href", Routes.AppRoute.print(Routes.AppRoute.Status({ search: { mode: "fail-refresh" } })))
          .attr("aria-current", mode === "fail-refresh" ? "page" : undefined)
          .children("SSR OK → refresh error")
      )

    const shell = h.section
      .attr("data-page-chunk", STATUS_PAGE_CHUNK)
      .attr("data-status-schema", Status.STATUS_SCHEMA_CHUNK)
      .attr("data-query", GetStatus.GET_STATUS_QUERY_CHUNK)
      .class(Design.ui.stack)

    return QueryResult.matchQuery(h.queries.status, {
      onInitial: () =>
        shell.children(
          h.h1.class(Design.ui.title).children("System Status"),
          modeLinks,
          h.p.class(Design.ui.muted).attr("data-testid", "status-loading").children("Loading status…")
        ),
      onFailure: (cause) =>
        shell.children(
          modeLinks,
          QueryResult.errorPanel(h, {
            title: "Couldn't load system status",
            cause,
            httpStatus: "503",
            onRetry: StatusPageMessage.ClickedRefresh()
          })
        ),
      onReady: ({ data, refreshFailure, waiting }) =>
        shell.children(
          h.h1.class(Design.ui.title).children("System Status"),
          modeLinks,
          refreshFailure === undefined
            ? undefined
            : QueryResult.refreshErrorBanner(h, {
                cause: refreshFailure,
                waiting,
                onRetry: StatusPageMessage.ClickedRefresh()
              }),
          renderStatusContent(h, data, waiting)
        )
    })
  }
})

/**
 * Golden boundary demo: proves SSR failure rendering (HTTP 503), SSR-to-client
 * error preservation on failed refreshes (`Failure.previousSuccess`), manual
 * invalidation, and pure `onReady` content free of `undefined` checks.
 */
export const StatusPage = StatusPageNoDeps.pipe(Component.provide(GetStatus.GetStatus.layer))
