import * as Schema from "effect/Schema"

/**
 * Analytics-only dataset. Nothing outside `AnalyticsPage` imports it, so it
 * must end up in the Analytics page chunk and nowhere else.
 */
export const ANALYTICS_DATASET_CHUNK = "SENTINEL:analytics-dataset"

export const Metric = Schema.Literals(["revenue", "orders"])
export type Metric = typeof Metric.Type

export const SeriesPoint = Schema.Struct({ label: Schema.String, value: Schema.Finite })
export type SeriesPoint = typeof SeriesPoint.Type

/**
 * How many times the dataset was actually read by a query fetcher. Production
 * code never reads it; the tests assert it stays 0 on the client while a
 * server-rendered page hydrates from the state's `~query` entries.
 */
export const analyticsReads = { getAnalytics: 0 }

export const metrics: ReadonlyArray<Metric> = ["revenue", "orders"]

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const

const revenue = [12400, 13900, 15100, 14800, 17200, 19600, 18900, 21400, 23800, 22500, 26700, 31200]
const orders = [310, 342, 377, 361, 420, 468, 452, 509, 561, 538, 622, 704]

export const metricSeries = (metric: Metric): ReadonlyArray<SeriesPoint> =>
  months.map((label, index) => ({ label, value: (metric === "revenue" ? revenue : orders)[index] ?? 0 }))

export const metricTitle = (metric: Metric): string => (metric === "revenue" ? "Revenue (USD)" : "Orders")
