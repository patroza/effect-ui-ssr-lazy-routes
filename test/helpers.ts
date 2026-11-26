import { Router, type Renderer } from "@effect/ui"
import { BrowserRouter } from "@effect/ui/html"
import { ssr } from "@effect/ui/html/testing"
import { TestHost } from "@effect/ui/testing"
import { Context, type Duration, Effect, Exit, Fiber, Layer, Option, Scope } from "effect"
import { TestClock } from "effect/testing"
import * as App from "../src/App.ts"
import * as Bootstrap from "../src/browser/bootstrap.ts"
import * as State from "../src/browser/state.ts"
import * as Pages from "../src/pages.ts"
import * as Routes from "../src/routes.ts"
import type * as Assets from "../src/server/assets.ts"
import * as Render from "../src/server/render.ts"
import * as Frames from "./support/frames.ts"
import * as Ports from "./support/ports.ts"

export const noAssets: Assets.PageAssets = { scripts: [], modulePreloads: [], stylesheets: [] }

/**
 * What every test of the app runs on: the Router at `url` (`Router.memory`, no `window`), the `TestHost` (test
 * scheduler, `TestClock`), and the counting ports. Provide it around the test body with `Effect.provide`.
 */
export const appAt = (url: string) =>
  Layer.mergeAll(Router.memory({ routes: Routes.AppRoute, url }), TestHost.layer()).pipe(
    Layer.provideMerge(Ports.countingPorts)
  )

/**
 * What a test that boots the real browser entry (`hydrateFromServer`) runs on: the `TestHost` and the counting
 * ports. The Router is `BrowserRouter` (happy-dom's `window`), which `hydrateFromServer` builds itself.
 */
export const browserEnv = TestHost.layer().pipe(Layer.provideMerge(Ports.countingPorts))

/** How many port operations ran in this test's Env (the server's and the client's together). */
export const portCounts = Effect.gen(function* () {
  const calls = yield* Ports.PortCalls
  return yield* calls.counts
})

/** The server's state with a different Model for one page, keeping that page's serialized queries. */
export const withModel = (path: string, model: unknown) => (state: Record<string, unknown>) => {
  const entry = state[path]
  const rest = typeof entry === "object" && entry !== null ? entry : {}
  return { ...state, [path]: { ...rest, model } }
}

/** Lets everything that could still fire run, on virtual time: a refetch, a late fallback, a second send. */
export const runOutTheClock = Effect.andThen(TestClock.adjust("10 seconds"), TestHost.settle)

/**
 * Runs `effect`, which sleeps on the Clock (a port's 5 ms round trip, the render budget) and queues its work on the
 * `TestHost`'s scheduler, on the `TestClock`: it settles the host (so the fibers register their sleeps), then moves
 * virtual time forward, until `effect` is done. No real time is waited for, and a render that never finishes fails
 * after a bounded number of steps.
 */
export const onTestClock = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect)
    for (let step = 0; fiber.pollUnsafe() === undefined; step++) {
      if (step === 100) return yield* Effect.die(new Error("the effect still sleeps after 100 clock steps"))
      yield* TestHost.settle
      yield* TestClock.adjust("5 millis")
    }
    return yield* Fiber.join(fiber)
  })

/** A fresh `{ app, pages }` bundle with its own load log: what ONE side (server or browser) of a test uses. */
export const makeSide = () => {
  const loaded: Array<Routes.AppRouteTag> = []
  return { loaded, ...App.createAppBundle({ onLoad: (tag) => loaded.push(tag) }) }
}
export type Side = ReturnType<typeof makeSide>

/** Starts (and awaits) the chunk of the route `url` resolves to, as `boot` does before hydrating. */
export const preloadFor = (side: Side, url: string) =>
  Option.match(Routes.routeOf(url), {
    onNone: () => Effect.void,
    onSome: (route) => Effect.promise(() => Pages.preloadRoute(route, side.pages))
  })

/**
 * Waits for the chunk of the route `url` resolves to to be loaded by `side`'s pages (the load a `Component.lazy`
 * child started is the one `preload()` shares), then settles the host so the page it unblocked is rendered. A
 * lazy `import()` is a real Promise: `TestHost.settle` cannot see one that a browser-hosted root started.
 */
export const chunkLoaded = (side: Side, url: string) => Effect.andThen(preloadFor(side, url), TestHost.settle)

/** An `ssr` frame: whether the loading fallback was in the container after that commit. */
const pageOrFallback = (container: globalThis.Element): "page" | "fallback" =>
  container.querySelector("[data-fallback]") === null ? "page" : "fallback"

/**
 * `Ssr.ssr` of the app at `url` (provide `appAt(url)` around the test): it renders on the server, hydrates the
 * HTML in a fresh document, and fails with `SsrError` unless hydration adopted every server node, Model and
 * `~query` entry and the heads agree. Its client root is registered with `TestHost`, so `TestHost.settle` waits
 * for it: `result.root.fetches()` lists the client's fetches and `result.root.frames()` each commit as
 * `"page"` or `"fallback"`.
 *
 * Note: `Ssr.ssr` runs both sides against the same `side.app`, so they share one lazy load cache. This helper
 * proves full SSR output, head/model/`~query` adoption and zero client refetches; `test/hydration.test.ts` uses
 * two separate `createAppBundle()` instances to prove zero-flash lazy hydration on an unloaded client.
 */
export const ssrAt = Effect.fn("ssrAt")(function* (url: string, options?: { readonly budget?: Duration.Input }) {
  const side = makeSide()
  yield* preloadFor(side, url)
  const result = yield* ssr(side.app, Router.props(Routes.AppRoute), { ...options, frames: pageOrFallback })
  return { side, result }
})

/** `renderPageEffect` for a URL that must render a document (not a redirect or a 400). */
export const renderDocument = Effect.fn("renderDocument")(function* (
  url: string,
  assetsFor: (route: Routes.AppRouteValue) => Assets.PageAssets = () => noAssets
) {
  const side = makeSide()
  yield* preloadFor(side, url)
  const outcome = yield* onTestClock(Render.renderPageEffect(url, assetsFor, { app: side.app }))
  if (outcome._tag !== "Page") throw new Error(`expected a page for ${url}, got ${outcome._tag} ${outcome.status}`)
  return outcome
})

/** The outcome of rendering `url` on a fresh "server": a page, a redirect or a 400. */
export const renderOutcome = Effect.fn("renderOutcome")(function* (url: string) {
  const side = makeSide()
  yield* preloadFor(side, url)
  return yield* onTestClock(Render.renderPageEffect(url, () => noAssets, { app: side.app }))
})

export interface ServerDocument {
  readonly status: number
  readonly html: string
  readonly appHtml: string
  readonly state: Renderer.State
  /** The port operations the server ran for this render (its own counters, apart from the browser's). */
  readonly serverCalls: Ports.PortCounts
}

/** Server-renders `url` with its own pages and app, and splits the document the way a browser would see it. */
export const serverRender = Effect.fn("serverRender")(function* (url: string) {
  const ports = yield* Layer.build(Layer.fresh(Ports.countingPorts))
  const page = yield* renderDocument(url).pipe(Effect.provideContext(ports))
  const parsed = new DOMParser().parseFromString(page.html, "text/html")
  const state = State.readState(parsed.getElementById("state")?.textContent)
  if (state === undefined) throw new Error("server HTML has no #state")
  const serverCalls = yield* Context.get(ports, Ports.PortCalls).counts
  return {
    status: page.status,
    html: page.html,
    appHtml: parsed.getElementById("app")?.innerHTML ?? "",
    state,
    serverCalls
  } satisfies ServerDocument
})

export interface Browser<Before> {
  /** The browser's own pages and app: `loaded` lists the page modules ITS `Component.lazy` imported. */
  readonly side: Side
  readonly container: Element
  /** The state the server serialized, after `editState` (what the client hydrated from). */
  readonly serverState: Renderer.State
  /** What `beforeBoot` returned: typically the server-rendered nodes, captured before the client boots. */
  readonly before: Before
  /**
   * Drains pending `MutationObserver` records synchronously and returns every
   * element with `data-fallback` ever inserted under the container.
   */
  readonly fallbacksSeen: () => ReadonlyArray<Element>
  /** Closes the app's scope: its listeners (link prefetch, reload guard, the Router's) are removed. */
  readonly close: Effect.Effect<void>
}

interface HydrateOptions {
  readonly editState?: (state: Renderer.State) => Renderer.State
}

const collectFallbacks = (records: ReadonlyArray<MutationRecord>, target: Array<Element>): void => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue
      if (node.hasAttribute("data-fallback")) target.push(node)
      target.push(...node.querySelectorAll("[data-fallback]"))
    }
  }
}

const hydrate = Effect.fn("hydrateFromServer")(function* <Before>(
  url: string,
  capture: (container: Element) => Before,
  options: HydrateOptions
) {
  const server = yield* serverRender(url)
  const side = makeSide() // the "browser": its lazy pages start unloaded

  window.history.replaceState(null, "", url)
  document.body.innerHTML = `<div id="app">${server.appHtml}</div>`
  const container = document.getElementById("app")
  if (container === null) throw new Error("#app missing")
  const before = capture(container)

  const seen: Array<Element> = []
  const observer = new MutationObserver((records) => collectFallbacks(records, seen))
  observer.observe(container, { childList: true, subtree: true })
  const fallbacksSeen = (): ReadonlyArray<Element> => {
    collectFallbacks(observer.takeRecords(), seen)
    return [...seen]
  }

  const state = options.editState?.(server.state) ?? server.state
  const scope = yield* Scope.make()
  const close = Effect.suspend(() => {
    collectFallbacks(observer.takeRecords(), seen)
    observer.disconnect()
    return Scope.close(scope, Exit.void)
  })
  yield* Effect.addFinalizer(() => close)
  // Like main.ts: the Router layer lives as long as the app's scope, not just as long as `boot`.
  const router = yield* Layer.buildWithScope(BrowserRouter.layer({ routes: Routes.AppRoute }), scope)
  yield* Bootstrap.boot({
    container,
    location: window.location.pathname + window.location.search,
    state,
    bundle: side
  }).pipe(
    Effect.provideContext(router),
    Effect.provideService(Scope.Scope, scope),
    Effect.tap(() => TestHost.settle)
  )
  const browser: Browser<Before> = {
    side,
    container,
    before,
    serverState: state,
    fallbacksSeen,
    close
  }
  return browser
})

/**
 * Puts the server's HTML in the document at `url`, then runs the real client `boot` against it, exactly as
 * `src/main.ts` does (`BrowserRouter` included, so `<a href>` clicks are intercepted and `history.pushState` runs).
 *
 * The server and the browser are two sides in ONE module graph, each with its own `createAppBundle()` (its own
 * lazy caches): no module is reset. Effects run on `TestHost`'s scheduler and `TestClock` — call `TestHost.settle`
 * after each DOM event, and `chunkLoaded` when navigation triggers a lazy `import()` (a native Promise outside
 * `TestHost`'s scheduler). The app's scope closes with the test.
 *
 * `capture` runs on the server's DOM before the client boots: take node references there to prove they are the
 * ones the client adopts. It is `Browser.before`.
 */
export const hydrateCapturing = <Before>(
  url: string,
  capture: (container: Element) => Before,
  options: HydrateOptions = {}
) => hydrate(url, capture, options)

/** `hydrateCapturing` without capturing anything. */
export const hydrateFromServer = (url: string, options: HydrateOptions = {}) => hydrate(url, () => undefined, options)

export const click = (element: Element): void => {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }))
}

/** The `<a href>` to `href` under `container`, or a thrown error. */
export const link = (container: Element, href: string): Element => {
  const anchor = container.querySelector(`a[href="${href}"]`)
  if (anchor === null) throw new Error(`no link to ${href}`)
  return anchor
}

/**
 * Follows the `<a href>` to `href` in the hydrated page like a user: the click is intercepted by `BrowserRouter`
 * (`history.pushState`), the target's chunk loads, and its first fetch (the ports' 5 ms round trip) completes.
 * All of it on virtual time.
 */
export const follow = (browser: Browser<unknown>, href: string) =>
  Effect.gen(function* () {
    click(link(browser.container, href))
    yield* TestHost.settle
    yield* chunkLoaded(browser.side, href)
    yield* TestClock.adjust("5 millis")
    yield* TestHost.settle
  })

/**
 * Settles the host, then runs the animation frames the kit's transitions asked for (a closing Dialog or
 * Collapsible unmounts on one), until nothing is left to run.
 */
export const settleFrames = Effect.gen(function* () {
  yield* TestHost.settle
  for (let frame = 0; frame < 10; frame++) {
    const ran = Frames.flushFrames()
    // A transition that has no animation left to wait for finishes on a resolved Promise, one microtask later.
    yield* Effect.promise(() => Promise.resolve())
    yield* TestHost.settle
    if (ran === 0) return
  }
})

/** The element with `data-testid`, or a thrown error naming it (so tests never need a non-null assertion). */
export const byTestId = (container: Element, id: string): Element => {
  const element = container.querySelector(`[data-testid="${id}"]`)
  if (element === null) throw new Error(`no element with data-testid="${id}"`)
  return element
}

export const inputValue = (input: Element): string => {
  if (!(input instanceof HTMLInputElement)) throw new Error("not an <input>")
  return input.value
}

/** Sets an input's value and fires the `input` event the way typing does. */
export const type = (input: Element, value: string): void => {
  if (!(input instanceof HTMLInputElement)) throw new Error("not an <input>")
  input.value = value
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

export const text = (container: Element, selector: string): string | undefined =>
  container.querySelector(selector)?.textContent ?? undefined
