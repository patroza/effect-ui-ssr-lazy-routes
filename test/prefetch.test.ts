import { describe, expect, it, vi } from "vitest"
import { loadApp } from "./helpers.ts"

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

const install = async (win: ReturnType<typeof target>["win"]) => {
  const app = await loadApp()
  const { Effect, Exit, Scope } = app.lib
  const scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(app.installPreloadErrorReload(win).pipe(Effect.provideService(Scope.Scope, scope)))
  return () => Effect.runPromise(Scope.close(scope, Exit.void))
}

describe("installPreloadErrorReload", () => {
  it("reloads and prevents the default on the first preload error", async () => {
    const { win, reload, stored } = target()
    const close = await install(win)
    const event = preloadError()
    window.dispatchEvent(event)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
    expect(Object.keys(stored)).toHaveLength(1)
    await close()
  })

  it("leaves the real chunk error alone (no preventDefault, no reload) when it just reloaded", async () => {
    const { win, reload } = target({ "effect-ui-ssr-lazy-routes:reloaded-at": String(Date.now()) })
    const close = await install(win)
    const event = preloadError()
    window.dispatchEvent(event)
    expect(reload).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    await close()
  })

  it("removes its listener when the scope closes", async () => {
    const { win, reload } = target()
    const close = await install(win)
    await close()
    const event = preloadError()
    window.dispatchEvent(event)
    expect(reload).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })
})
