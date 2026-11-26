import * as Component from "@effect/ui/Component"
import * as Head from "@effect/ui/Head"
import * as UiSchema from "@effect/ui/UiSchema"
import { Html } from "@effect/ui/html"
import { Collapsible } from "@effect/ui-kit/Collapsible"
import { Tabs } from "@effect/ui-kit/Tabs"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { ANALYTICS_CHART_CHUNK, lineChartSvg, svgDataUri } from "../analytics/chart.ts"
import { ANALYTICS_DATASET_CHUNK, Metric, metrics, metricTitle } from "../analytics/dataset.ts"
import { GET_ANALYTICS_QUERY_CHUNK, GetAnalytics } from "../analytics/GetAnalytics.ts"
import { ui } from "../design.ts"

/** Marker proving which chunk this page lands in (see scripts/verify-bundles.ts). */
export const ANALYTICS_PAGE_CHUNK = "SENTINEL:analytics-page"

export const AnalyticsPageMessage = UiSchema.TaggedEnum({
  SelectedMetricTab: { metric: Metric },
  ToggledAbout: { open: Schema.Boolean }
})

const isMetric = Schema.is(Metric)

const tabClass =
  "relative cursor-pointer px-4 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 data-active:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 dark:data-active:text-neutral-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600 dark:focus-visible:outline-sky-400"

const indicatorClass =
  "absolute bottom-0 left-(--active-tab-left) h-0.5 w-(--active-tab-width) bg-sky-600 transition-all dark:bg-sky-400"

export const AnalyticsPageNoDeps = Html.component({
  name: "AnalyticsPage",
  model: Schema.Struct({ metric: Metric, aboutOpen: Schema.Boolean }),
  message: AnalyticsPageMessage,
  // The series is fetched by the query (and shipped in the server's `~query`), keyed by the selected tab.
  queries: {
    series: { query: GetAnalytics, args: ({ model }) => ({ metric: model.metric }) }
  }
}).make({
  init: () => ({ metric: "revenue" as const, aboutOpen: false }),
  update: ($, message) =>
    AnalyticsPageMessage.match(message, {
      SelectedMetricTab: ({ metric }) => $.evolve({ metric }),
      ToggledAbout: ({ open }) => $.evolve({ aboutOpen: open })
    }),
  head: () => [Head.title("Analytics")],
  view: (h, model) => {
    const title = metricTitle(model.metric)
    // The last series stays up while the next tab's loads.
    const series = AsyncResult.match(h.queries.series, {
      onInitial: () => Option.getOrUndefined(h.previous.series),
      onFailure: () => undefined,
      onSuccess: ({ value }) => value
    })
    const content =
      series === undefined
        ? h.p.class(ui.muted).children("Loading…")
        : h.div.class(ui.stack).children(
            h.img
              .class("analytics-chart")
              .attr("src", svgDataUri(lineChartSvg(title, series)))
              .attr("alt", `${title} by month`)
              .attr("data-testid", "analytics-chart"),
            h.p
              .class(ui.muted)
              .attr("data-testid", "analytics-total")
              .children(`Total ${title}: ${series.reduce((sum, point) => sum + point.value, 0)}`)
          )
    return h.section
      .attr("data-page-chunk", ANALYTICS_PAGE_CHUNK)
      .attr("data-chart", ANALYTICS_CHART_CHUNK)
      .attr("data-dataset", ANALYTICS_DATASET_CHUNK)
      .attr("data-query", GET_ANALYTICS_QUERY_CHUNK)
      .class(ui.stack)
      .children(
        h.h1.class(ui.title).children("Analytics"),
        Tabs(h, {
          props: { value: model.metric, tabs: metrics.map((value) => ({ value })) },
          onEmit: {
            // Tab values are plain strings: only the metrics we declared above can come back.
            Selected: ({ value }) =>
              isMetric(value) ? AnalyticsPageMessage.SelectedMetricTab({ metric: value }) : undefined
          },
          view: (tabs) =>
            tabs.root(h.div.class(ui.stack)).children(
              tabs.list(h.div.class("relative flex border-b border-neutral-200 dark:border-neutral-800")).children(
                metrics.map((metric) =>
                  tabs
                    .tab({ element: h.button.key(metric).class(tabClass), value: metric })
                    .attr("data-testid", `tab-${metric}`)
                    .children(metricTitle(metric))
                ),
                tabs.indicator(h.span.class(indicatorClass))
              ),
              metrics.map((metric) => tabs.panel({ element: h.div.key(metric), value: metric })?.children(content))
            )
        }),
        Collapsible(h, {
          props: { open: model.aboutOpen },
          onEmit: {
            Toggled: ({ open }) => AnalyticsPageMessage.ToggledAbout({ open }),
            Settled: () => undefined
          },
          view: (about) =>
            about.root(h.div.class(ui.card)).children(
              about
                .trigger(h.button.class(`cursor-pointer text-sm ${ui.link}`))
                .attr("data-testid", "about-trigger")
                .children(model.aboutOpen ? "Hide data notes" : "About this data"),
              about
                .panel(h.p.class(`mt-2 ${ui.muted}`))
                ?.attr("data-testid", "about-panel")
                .children("Monthly figures for one year, loaded by the page's own GetAnalytics query.")
            )
        })
      )
  }
})

/** The page with its own query Layer, so `GetAnalytics` ships in this page's chunk. */
export const AnalyticsPage = AnalyticsPageNoDeps.pipe(Component.provide(GetAnalytics.layer))
