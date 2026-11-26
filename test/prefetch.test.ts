import { describe, expect, it, vi } from "@effect/vitest"
import { Effect, Exit, Scope } from "effect"
import * as Prefetch from "../src/browser/prefetch.ts"

/** A `ReloadTarget` over the real `window`'s event system, with a spy for `reload` and an in-memory storage. */
const target = (stored: Record<string, string> = {}) => {
  const reload = vi.fn()
  const storage = {
    getItem: (key: string) => stored[key] ?? null,
    setItem: (key: string, value: string) => {
      stored[key] = value
    }
  }
  return {
    reload,
    stored,
    win: {
      addEventListener: window.addEventListener.bind(window),
      removeEventListener: window.removeEventListener.bind(window),
      sessionStorage: storage,
      location: { reload }
    }
  }
}

const preloadError = () => new Event("vite:preloadError", { cancelable: true })

describe("installPreloadErrorReload", () => {
  it.effect("reloads and prevents the default on the first preload error", () =>
    Effect.gen(function* () {
      const { win, reload, stored } = target()
      yield* Prefetch.installPreloadErrorReload(win) // released with the test's scope
      const event = preloadError()
      window.dispatchEvent(event)
      expect(reload).toHaveBeenCalledTimes(1)
      expect(event.defaultPrevented).toBe(true)
      expect(Object.keys(stored)).toHaveLength(1)
    })
  )

  it.effect("leaves the real chunk error alone (no preventDefault, no reload) when it just reloaded", () =>
    Effect.gen(function* () {
      const { win, reload } = target({ "effect-ui-ssr-lazy-routes:reloaded-at": String(Date.now()) })
      yield* Prefetch.installPreloadErrorReload(win)
      const event = preloadError()
      window.dispatchEvent(event)
      expect(reload).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })
  )

  it.effect("reloads once per event when sessionStorage throws (private mode, blocked storage)", () =>
    Effect.gen(function* () {
      const { win, reload } = target()
      const throwing = {
        ...win,
        sessionStorage: {
          getItem: () => {
            throw new Error("SecurityError")
          },
          setItem: () => {
            throw new Error("SecurityError")
          }
        }
      }
      yield* Prefetch.installPreloadErrorReload(throwing)
      const event = preloadError()
      window.dispatchEvent(event)
      expect(reload).toHaveBeenCalledTimes(1)
      expect(event.defaultPrevented).toBe(true)
    })
  )

  it.effect("treats a stored timestamp older than the loop window as no recent reload", () =>
    Effect.gen(function* () {
      const { win, reload } = target({ "effect-ui-ssr-lazy-routes:reloaded-at": String(Date.now() - 60_000) })
      yield* Prefetch.installPreloadErrorReload(win)
      const event = preloadError()
      window.dispatchEvent(event)
      expect(reload).toHaveBeenCalledTimes(1)
      expect(event.defaultPrevented).toBe(true)
    })
  )

  it.effect("removes its listener when the scope closes", () =>
    Effect.gen(function* () {
      const { win, reload } = target()
      const scope = yield* Scope.make()
      yield* Prefetch.installPreloadErrorReload(win).pipe(Effect.provideService(Scope.Scope, scope))
      yield* Scope.close(scope, Exit.void)
      const event = preloadError()
      window.dispatchEvent(event)
      expect(reload).not.toHaveBeenCalled()
      expect(event.defaultPrevented).toBe(false)
    })
  )
})
