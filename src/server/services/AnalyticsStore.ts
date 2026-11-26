import { Context, Effect, Layer } from "effect"
import type * as Analytics from "../../analytics/domain/Analytics.ts"

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const
const revenue = [12400, 13900, 15100, 14800, 17200, 19600, 18900, 21400, 23800, 22500, 26700, 31200]
const orders = [310, 342, 377, 361, 420, 468, 452, 509, 561, 538, 622, 704]

/**
 * Server-only analytics store. Holds the monthly datasets strictly on the
 * server so no analytics dataset ever ships to `dist/client/`.
 */
export class AnalyticsStore extends Context.Service<AnalyticsStore>()("server/AnalyticsStore", {
  make: Effect.gen(function* () {
    const series = Effect.fn("AnalyticsStore.series")(function* (metric: Analytics.Metric) {
      const values = metric === "revenue" ? revenue : orders
      return months.map((label, index): Analytics.SeriesPoint => ({ label, value: values[index] ?? 0 }))
    })

    return { series } as const
  })
}) {
  static readonly layer = Layer.effect(this, this.make)
}
