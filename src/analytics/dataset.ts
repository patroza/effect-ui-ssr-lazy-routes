/**
 * Analytics-only dataset. Nothing outside `AnalyticsPage` imports it, so it
 * must end up in the Analytics page chunk and nowhere else.
 */
export const ANALYTICS_DATASET_CHUNK = "SENTINEL:analytics-dataset"

export type Metric = "revenue" | "orders"

export interface SeriesPoint {
  readonly label: string
  readonly value: number
}

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const

const revenue = [12400, 13900, 15100, 14800, 17200, 19600, 18900, 21400, 23800, 22500, 26700, 31200]
const orders = [310, 342, 377, 361, 420, 468, 452, 509, 561, 538, 622, 704]

export const metricSeries = (metric: Metric): ReadonlyArray<SeriesPoint> =>
  months.map((label, index) => ({ label, value: (metric === "revenue" ? revenue : orders)[index] ?? 0 }))

export const metricTitle = (metric: Metric): string => (metric === "revenue" ? "Revenue (USD)" : "Orders")
