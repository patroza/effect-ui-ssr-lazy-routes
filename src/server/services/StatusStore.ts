import { Context, Effect, Layer, Ref } from "effect"
import * as ApiError from "../../rpc/domain/ApiError.ts"
import type * as Status from "../../status/domain/Status.ts"

interface StatusState {
  readonly revision: number
  readonly flakyAttempts: number
}

const baseServices: ReadonlyArray<Status.ServiceCheck> = [
  { name: "Catalog RPC", healthy: true, latencyMs: 12 },
  { name: "SSR Renderer", healthy: true, latencyMs: 8 },
  { name: "Query Cache", healthy: true, latencyMs: 2 }
]

/**
 * `Ref`-backed demo status store for `/status` and `POST /rpc/status`.
 * Supports deterministic SSR failure (`fail-ssr`) and SSR-success -> client-refresh
 * failure + retry recovery (`fail-refresh`) without module-level mutable state.
 */
export class StatusStore extends Context.Service<
  StatusStore,
  {
    readonly check: (mode: Status.StatusMode) => Effect.Effect<Status.SystemStatus, ApiError.ApiError>
  }
>()("server/StatusStore") {
  static readonly layer = Layer.effect(
    StatusStore,
    Effect.gen(function* () {
      const stateRef = yield* Ref.make<StatusState>({ revision: 0, flakyAttempts: 0 })
      return StatusStore.of({
        check: (mode) =>
          Effect.gen(function* () {
            if (mode === "fail-ssr") {
              return yield* new ApiError.ApiError({
                message: "Status backend unavailable during SSR"
              })
            }
            const next = yield* Ref.updateAndGet(stateRef, (state) => {
              if (mode === "fail-refresh") {
                const flakyAttempts = state.flakyAttempts + 1
                const shouldFail = flakyAttempts % 2 === 0
                return {
                  revision: shouldFail ? state.revision : state.revision + 1,
                  flakyAttempts
                }
              }
              return {
                revision: state.revision + 1,
                flakyAttempts: state.flakyAttempts
              }
            })
            if (mode === "fail-refresh" && next.flakyAttempts % 2 === 0) {
              return yield* new ApiError.ApiError({
                message: "Client refresh failed: upstream status timeout"
              })
            }
            return {
              revision: next.revision,
              mode,
              note:
                mode === "fail-refresh"
                  ? "SSR succeeded; click Refresh to trigger a client refresh error"
                  : "All services healthy",
              services: baseServices
            }
          })
      })
    })
  )
}
