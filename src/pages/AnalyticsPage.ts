import { Command, Component, Head, UiSchema } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { Collapsible, Tabs } from "@effect/ui-kit"
import { Effect, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import * as Chart from "../analytics/components/Chart.ts"
import * as Analytics from "../analytics/domain/Analytics.ts"
import * as GetAnalytics from "../analytics/queries/GetAnalytics.ts"
import * as Design from "../design/classes.ts"
import * as QueryResult from "../design/queryResult.ts"

/** Marker proving which chunk this page lands in (see scripts/verify-bundles.ts). */
export const ANALYTICS_PAGE_CHUNK = "SENTINEL:analytics-page"

export const AnalyticsPageMessage = UiSchema.TaggedEnum({
  SelectedMetricTab: { metric: Analytics.Metric },
  ToggledAbout: { open: Schema.Boolean },
  ClickedRefresh: {}
})

const RefreshAnalytics = Command.make("RefreshAnalytics", { args: { metric: Analytics.Metric } }, ({ metric }) =>
  GetAnalytics.GetAnalytics.invalidate({ metric }).pipe(Effect.as(Component.noop))
)

const isMetric = Schema.is(Analytics.Metric)

const tabClass =
  "relative cursor-pointer px-4 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 data-active:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 dark:data-active:text-neutral-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600 dark:focus-visible:outline-sky-400"

const indicatorClass =
  "absolute bottom-0 left-(--active-tab-left) h-0.5 w-(--active-tab-width) bg-sky-600 transition-all dark:bg-sky-400"

const renderChartContent = <M>(
  h: Html.H<M>,
  title: string,
  series: ReadonlyArray<Analytics.SeriesPoint>,
  waiting: boolean
) =>
  h.div
    .key("analytics-content")
    .class(Design.ui.stack)
    .attr("aria-busy", String(waiting))
    .children(
      h.img
        .class("analytics-chart")
        .attr("src", Chart.svgDataUri(Chart.lineChartSvg(title, series)))
        .attr("alt", `${title} by month`)
        .attr("data-testid", "analytics-chart"),
      h.p
        .class(Design.ui.muted)
        .attr("data-testid", "analytics-total")
        .children(`Total ${title}: ${series.reduce((sum, point) => sum + point.value, 0)}`)
    )

const AnalyticsPageNoDeps = Html.component({
  name: "AnalyticsPage",
  model: Schema.Struct({ metric: Analytics.Metric, aboutOpen: Schema.Boolean }),
  message: AnalyticsPageMessage,
  // The series is fetched by the query (and shipped in the server's `~query`), keyed by the selected tab.
  queries: {
    series: { query: GetAnalytics.GetAnalytics, args: ({ model }) => ({ metric: model.metric }) }
  }
}).make({
  init: () => ({ metric: "revenue", aboutOpen: false }),
  update: ($, message) =>
    AnalyticsPageMessage.match(message, {
      SelectedMetricTab: ({ metric }) => $.evolve({ metric }),
      ToggledAbout: ({ open }) => $.evolve({ aboutOpen: open }),
      ClickedRefresh: () => $.run(RefreshAnalytics.make({ metric: $.model.metric }))
    }),
  head: () => [Head.title("Analytics")],
  view: (h, model) => {
    const title = Analytics.metricTitle(model.metric)
    const content = QueryResult.matchQuery(h.queries.series, {
      onInitial: () => h.p.class(Design.ui.muted).children("Loading…"),
      onFailure: (cause) =>
        QueryResult.errorPanel(h, {
          title: "Couldn't load analytics",
          heading: 2,
          cause,
          onRetry: AnalyticsPageMessage.ClickedRefresh()
        }),
      onReady: ({ data, refreshFailure, waiting }) =>
        h.div.class(Design.ui.stack).children(
          refreshFailure === undefined
            ? undefined
            : QueryResult.refreshErrorBanner(h, {
                cause: refreshFailure,
                waiting,
                onRetry: AnalyticsPageMessage.ClickedRefresh()
              }),
          renderChartContent(h, title, data, waiting)
        )
    })

    return h.section
      .attr("data-page-chunk", ANALYTICS_PAGE_CHUNK)
      .attr("data-chart", Chart.ANALYTICS_CHART_CHUNK)
      .attr("data-analytics-schema", Analytics.ANALYTICS_SCHEMA_CHUNK)
      .attr("data-query", GetAnalytics.GET_ANALYTICS_QUERY_CHUNK)
      .class(Design.ui.stack)
      .children(
        h.div.class(`${Design.ui.row} justify-between`).children(
          h.h1.class(Design.ui.title).children("Analytics"),
          QueryResult.refreshButton(h, {
            waiting: AsyncResult.isWaiting(h.queries.series),
            onRefresh: AnalyticsPageMessage.ClickedRefresh(),
            testId: "analytics-refresh"
          })
        ),
        Tabs(h, {
          props: { value: model.metric, tabs: Analytics.metrics.map((value) => ({ value })) },
          onEmit: {
            // Tab values are plain strings: only the metrics we declared above can come back.
            Selected: ({ value }) =>
              isMetric(value) ? AnalyticsPageMessage.SelectedMetricTab({ metric: value }) : undefined
          },
          view: (tabs) =>
            tabs.root(h.div.class(Design.ui.stack)).children(
              tabs.list(h.div.class("relative flex border-b border-neutral-200 dark:border-neutral-800")).children(
                Analytics.metrics.map((metric) =>
                  tabs
                    .tab({ element: h.button.key(metric).class(tabClass), value: metric })
                    .attr("data-testid", `tab-${metric}`)
                    .children(Analytics.metricTitle(metric))
                ),
                tabs.indicator(h.span.class(indicatorClass))
              ),
              Analytics.metrics.map((metric) =>
                tabs.panel({ element: h.div.key(metric), value: metric })?.children(content)
              )
            )
        }),
        Collapsible(h, {
          props: { open: model.aboutOpen },
          onEmit: {
            Toggled: ({ open }) => AnalyticsPageMessage.ToggledAbout({ open }),
            Settled: () => undefined
          },
          view: (about) =>
            about.root(h.div.class(Design.ui.card)).children(
              about
                .trigger(h.button.class(`cursor-pointer text-sm ${Design.ui.link}`))
                .attr("data-testid", "about-trigger")
                .children(model.aboutOpen ? "Hide data notes" : "About this data"),
              about
                .panel(h.p.class(`mt-2 ${Design.ui.muted}`))
                ?.attr("data-testid", "about-panel")
                .children("Monthly figures for one year, loaded by the page's own GetAnalytics query.")
            )
        })
      )
  }
})

/** The page with its own Layer: `GetAnalytics` calls `AnalyticsRpcs` over the root-provided `RpcClient.Protocol`. */
export const AnalyticsPage = AnalyticsPageNoDeps.pipe(Component.provide(GetAnalytics.GetAnalytics.layer))
