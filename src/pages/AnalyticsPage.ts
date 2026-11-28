import { Command, Component, Head, UiSchema } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { Collapsible, Tabs } from "@effect/ui-kit"
import { Effect, Schema } from "effect"
import * as Chart from "../analytics/components/Chart.ts"
import * as Analytics from "../analytics/domain/Analytics.ts"
import * as GetAnalytics from "../analytics/queries/GetAnalytics.ts"
import * as Design from "../design/classes.ts"
import * as QueryResult from "../design/queryResult.ts"
import * as CollapsibleUi from "../ui/collapsible.ts"
import * as TabsUi from "../ui/tabs.ts"

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
    const renderSeriesPanel = () => {
      const series = QueryResult.read(h.queries.series)
      if (QueryResult.isInitial(series)) {
        return h.p.class(Design.ui.muted).children("Loading…")
      }
      if (QueryResult.isFailure(series)) {
        return QueryResult.errorPanel(h, series, {
          title: "Couldn't load analytics",
          heading: 2,
          onRetry: AnalyticsPageMessage.ClickedRefresh()
        })
      }
      return h.div.class(Design.ui.stack).children(
        QueryResult.refreshErrorBanner(h, series, {
          onRetry: AnalyticsPageMessage.ClickedRefresh()
        }),
        renderChartContent(h, title, series.data, series.waiting)
      )
    }
    const content = renderSeriesPanel()

    return h.section
      .attr("data-page-chunk", ANALYTICS_PAGE_CHUNK)
      .attr("data-chart", Chart.ANALYTICS_CHART_CHUNK)
      .attr("data-analytics-schema", Analytics.ANALYTICS_SCHEMA_CHUNK)
      .attr("data-query", GetAnalytics.GET_ANALYTICS_QUERY_CHUNK)
      .class(Design.ui.stack)
      .children(
        h.div.class(`${Design.ui.row} justify-between`).children(
          h.h1.class(Design.ui.title).children("Analytics"),
          QueryResult.refreshButton(h, h.queries.series, {
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
            TabsUi.TabsRoot(h, tabs).children(
              TabsUi.TabsList(h, tabs, { variant: "underline" }).children(
                Analytics.metrics.map((metric) =>
                  TabsUi.TabsTab(h, tabs, { value: metric })
                    .key(metric)
                    .attr("data-testid", `tab-${metric}`)
                    .children(Analytics.metricTitle(metric))
                ),
                TabsUi.TabsIndicator(h, tabs)
              ),
              Analytics.metrics.map((metric) =>
                TabsUi.TabsPanel(h, tabs, { value: metric })?.key(metric).children(content)
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
            CollapsibleUi.CollapsibleRoot(h, about, { class: Design.ui.card }).children(
              CollapsibleUi.CollapsibleTrigger(h, about, { variant: "link", class: "text-sm" })
                .attr("data-testid", "about-trigger")
                .children(model.aboutOpen ? "Hide data notes" : "About this data"),
              CollapsibleUi.CollapsiblePanel(h, about)
                ?.attr("data-testid", "about-panel")
                .children(
                  h.p
                    .class(`pt-2 ${Design.ui.muted}`)
                    .children("Monthly figures for one year, loaded by the page's own GetAnalytics query.")
                )
            )
        })
      )
  }
})

/** The page with its own Layer: `GetAnalytics` calls `AnalyticsRpcs` over the root-provided `RpcClient.Protocol`. */
export const AnalyticsPage = AnalyticsPageNoDeps.pipe(Component.provide(GetAnalytics.GetAnalytics.layer))
