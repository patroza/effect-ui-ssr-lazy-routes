import { Head, UiSchema } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { Schema } from "effect"
import { ANALYTICS_CHART_CHUNK, lineChartSvg, svgDataUri } from "../analytics/chart.ts"
import { ANALYTICS_DATASET_CHUNK, type Metric, metricSeries, metricTitle } from "../analytics/dataset.ts"

/** Marker proving which chunk this page lands in (see scripts/verify-bundles.mjs). */
export const ANALYTICS_PAGE_CHUNK = "SENTINEL:analytics-page"

const MetricSchema = Schema.Literals(["revenue", "orders"])

export const AnalyticsPageMessage = UiSchema.TaggedEnum({
  SelectedMetric: { metric: MetricSchema }
})

const metrics: ReadonlyArray<Metric> = ["revenue", "orders"]

export const AnalyticsPage = Html.component({
  name: "AnalyticsPage",
  model: Schema.Struct({ metric: MetricSchema }),
  message: AnalyticsPageMessage
}).make({
  init: () => ({ metric: "revenue" as const }),
  update: ($, message) =>
    AnalyticsPageMessage.match(message, {
      SelectedMetric: ({ metric }) => $.evolve({ metric })
    }),
  head: () => [Head.title("Analytics")],
  view: (h, model) => {
    const series = metricSeries(model.metric)
    const title = metricTitle(model.metric)
    return h.section
      .attr("data-page-chunk", ANALYTICS_PAGE_CHUNK)
      .attr("data-chart", ANALYTICS_CHART_CHUNK)
      .attr("data-dataset", ANALYTICS_DATASET_CHUNK)
      .children(
        h.h1("Analytics"),
        h.p.children(
          metrics.map((metric) =>
            h.button
              .key(metric)
              .attr("type", "button")
              .attr("aria-pressed", String(metric === model.metric))
              .on("click", AnalyticsPageMessage.SelectedMetric({ metric }))
              .children(metricTitle(metric))
          )
        ),
        h.img
          .class("analytics-chart")
          .attr("src", svgDataUri(lineChartSvg(title, series)))
          .attr("alt", `${title} by month`)
          .attr("data-testid", "analytics-chart"),
        h.p.attr("data-testid", "analytics-total").children(
          `Total ${title}: ${series.reduce((sum, point) => sum + point.value, 0)}`
        )
      )
  }
})
