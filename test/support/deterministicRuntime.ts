import { type Layer, Random } from "effect"
import { TestClock } from "effect/testing"

/** Fixed PRNG seed shared across deterministic SSR and wire-budget suites. */
const DEFAULT_SEED = "effect-ui-ssr-lazy-routes-wire-budget"

/** Provides a seeded deterministic `Random` service while preserving the surrounding clock layer (e.g. `TestHost`). */
export const deterministicRandom = (seed: string = DEFAULT_SEED) => Random.withSeed(seed)

/** Standalone `TestClock` layer for non-DOM tests that require explicit virtual-clock control. */
export const deterministicClockLayer: Layer.Layer<TestClock.TestClock> = TestClock.layer()
