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
 * Pure content branch: only runs after `QueryResult.read` narrowed past `isInitial`/`isFailure` and proved `data`
 * exists (either a fresh `Success` or a preserved `previousSuccess` after a
 * failed refresh). Zero `undefined` / `is defined` checks live here.
 */
const renderStatusContent = (
  h: Html.H<typeof StatusPageMessage.Type>,
  status: QueryResult.ReadyQuery<Status.SystemStatus, unknown>
) =>
  h.div
    .key("status-content")
    .class(Design.ui.stack)
    .attr("aria-busy", String(status.waiting))
    .children(
      h.div.class(`${Design.ui.row} justify-between`).children(
        h.div.children(
          h.p.class("font-medium").attr("data-testid", "status-revision").children(`Revision ${status.data.revision}`),
          h.p.class(Design.ui.muted).attr("data-testid", "status-note").children(status.data.note)
        ),
        QueryResult.refreshButton(h, status, {
          onRefresh: StatusPageMessage.ClickedRefresh()
        })
      ),
      h.ul
        .class("flex flex-col divide-y divide-border")
        .attrs({ "data-testid": "status-services" })
        .children(
          status.data.services.map((service) =>
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

    const heading = h.h1.class(Design.ui.title).children("System Status")
    const status = QueryResult.read(h.queries.status)
    if (QueryResult.isInitial(status)) {
      return shell.children(
        heading,
        modeLinks,
        h.p.class(Design.ui.muted).attr("data-testid", "status-loading").children("Loading status…")
      )
    }
    if (QueryResult.isFailure(status)) {
      return shell.children(
        heading,
        modeLinks,
        QueryResult.errorPanel(h, status, {
          title: "Couldn't load system status",
          heading: 2,
          httpStatus: "503",
          onRetry: StatusPageMessage.ClickedRefresh()
        })
      )
    }

    return shell.children(
      heading,
      modeLinks,
      QueryResult.refreshErrorBanner(h, status, {
        onRetry: StatusPageMessage.ClickedRefresh()
      }),
      renderStatusContent(h, status)
    )
  }
})

/**
 * Golden boundary demo: proves SSR failure rendering (HTTP 503), SSR-to-client
 * error preservation on failed refreshes (`Failure.previousSuccess`), manual
 * invalidation, and flat ready-path content free of `undefined` checks.
 */
export const StatusPage = StatusPageNoDeps.pipe(Component.provide(GetStatus.GetStatus.layer))
