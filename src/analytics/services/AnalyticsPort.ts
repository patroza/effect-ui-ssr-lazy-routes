import { Context, Effect, Layer, Option } from "effect"
import * as Dataset from "../domain/Analytics.ts"

/**
 * The analytics dataset's I/O. `GetAnalytics` captures it. Every operation is
 * an `Effect.fn`, so each call is a span.
 */
export class AnalyticsPort extends Context.Service<
  AnalyticsPort,
  {
    readonly series: (metric: Dataset.Metric) => Effect.Effect<ReadonlyArray<Dataset.SeriesPoint>>
  }
>()("analytics/AnalyticsPort") {
  /** The production implementation: a stand-in for a network round trip on the Effect clock. */
  static readonly live = AnalyticsPort.of({
    series: Effect.fn("AnalyticsPort.series")(function* (metric: Dataset.Metric) {
      yield* Effect.sleep("5 millis")
      return Dataset.metricSeries(metric)
    })
  })

  /** Provided by the page; reuses an `AnalyticsPort` already in the Env (a test's), see `CatalogPort.layer`. */
  static readonly layer = Layer.effect(
    AnalyticsPort,
    Effect.map(
      Effect.serviceOption(AnalyticsPort),
      Option.getOrElse(() => AnalyticsPort.live)
    )
  )
}
