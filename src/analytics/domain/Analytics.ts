import { Schema } from "effect"

/**
 * Analytics-only domain schemas and display helpers. Nothing outside
 * `AnalyticsPage` imports it, so it lands in the Analytics page chunk and
 * nowhere else. Seed datasets live strictly under `src/server/`.
 */
export const ANALYTICS_SCHEMA_CHUNK = "SENTINEL:analytics-schema"

export const Metric = Schema.Literals(["revenue", "orders"])
export type Metric = typeof Metric.Type

export const SeriesPoint = Schema.Struct({ label: Schema.String, value: Schema.Finite })
export type SeriesPoint = typeof SeriesPoint.Type

export const metrics: ReadonlyArray<Metric> = ["revenue", "orders"]

export const metricTitle = (metric: Metric): string => (metric === "revenue" ? "Revenue (USD)" : "Orders")
