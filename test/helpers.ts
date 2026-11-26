import type { Renderer } from "@effect/ui"
import { afterEach, vi } from "vitest"
import type { PageAssets } from "../src/assets.ts"

/**
 * Which page modules have been imported since the latest `loadApp()`. The mock
 * factory below runs exactly when a page module is first imported, so this
 * observes the real `import()` that `Component.lazy` does.
 */
export const loadedPages = new Set<string>()
const pageModules = ["Home", "Products", "ProductDetail", "Analytics", "NotFound"] as const

export const noAssets: PageAssets = { scripts: [], modulePreloads: [], stylesheets: [] }

/**
 * A freshly loaded copy of every app module, with its own `Component.lazy`
 * caches. The server and the browser are different processes in production,
 * so tests load one copy to render on the "server" and another for the "client".
 */
export const loadApp = async () => {
  vi.resetModules()
  loadedPages.clear()
  for (const name of pageModules) {
    vi.doMock(`../src/pages/${name}Page.ts`, async (importOriginal) => {
      loadedPages.add(name)
      return await importOriginal()
    })
  }
  // `effect` and `@effect/ui` keep per-module registries (the Router's engine, service keys, ...), so the
  // test must use the SAME copies as the app, never ones imported statically by the test file.
  const [effect, ui, uiHtml, render, bootstrap, pages, routes, loading, prefetch, products, dataset, state] = await Promise.all([
    import("effect"),
    import("@effect/ui"),
    import("@effect/ui/html"),
    import("../src/render.ts"),
    import("../src/bootstrap.ts"),
    import("../src/pages.ts"),
    import("../src/routes.ts"),
    import("../src/loading.ts"),
    import("../src/prefetch.ts"),
    import("../src/data/products.ts"),
    import("../src/analytics/dataset.ts"),
    import("../src/state.ts")
  ])
  return {
    ...render,
    ...bootstrap,
    ...pages,
    ...routes,
    ...loading,
    ...prefetch,
    ...state,
    catalogReads: products.catalogReads,
    catalogWrites: products.catalogWrites,
    analyticsReads: dataset.analyticsReads,
    lib: {
      Effect: effect.Effect,
      Exit: effect.Exit,
      Layer: effect.Layer,
      Scope: effect.Scope,
      Logger: effect.Logger,
      Router: ui.Router,
      ...uiHtml
    }
  }
}
export type App = Awaited<ReturnType<typeof loadApp>>

export interface ServerDocument {
  readonly status: number
  readonly html: string
  readonly appHtml: string
  readonly state: Renderer.State
}

/** Server-renders `url` with its own module copy and splits the document the way a browser would see it. */
export const serverRender = async (url: string): Promise<ServerDocument> => {
  const server = await loadApp()
  const page = await server.renderPage(url, () => noAssets)
  const parsed = new DOMParser().parseFromString(page.html, "text/html")
  const state = server.readState(parsed.getElementById("state")?.textContent)
  if (state === undefined) throw new Error("server HTML has no #state")
  return {
    status: page.status,
    html: page.html,
    appHtml: parsed.getElementById("app")?.innerHTML ?? "",
    state
  }
}

export interface Browser<Before> {
  /** The client's module copy: its `pages`, `loadingStats`, ... */
  readonly app: App
  /** The app root: `root.model()` is the root component's Model. */
  readonly root: { readonly model: () => unknown }
  readonly container: Element
  /** The state the server serialized, after `editState` (what the client hydrated from). */
  readonly serverState: Renderer.State
  /** What `beforeBoot` returned: typically the server-rendered nodes, captured before the client boots. */
  readonly before: Before
  /** Every element with `data-fallback` that was ever inserted under the container. */
  readonly fallbacksSeen: ReadonlyArray<Element>
  readonly close: () => Promise<void>
}

const open: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(open.splice(0).map((close) => close()))
})

interface HydrateOptions {
  readonly editState?: (state: Renderer.State) => Renderer.State
}

/**
 * Puts the server's HTML in the document at `url`, then runs the real client
 * `boot` against it, exactly as `src/client.ts` does (BrowserRouter included).
 * The browser is closed automatically after each test.
 *
 * `beforeBoot` runs on the server's DOM before the client boots: capture node
 * references there to prove they are the ones the client adopts.
 */
export async function hydrateFromServer(url: string, options?: HydrateOptions): Promise<Browser<undefined>>
export async function hydrateFromServer<Before>(
  url: string,
  options: HydrateOptions & { readonly beforeBoot: (container: Element) => Before }
): Promise<Browser<Before>>
export async function hydrateFromServer(
  url: string,
  options: HydrateOptions & { readonly beforeBoot?: (container: Element) => unknown } = {}
): Promise<Browser<unknown>> {
  const server = await serverRender(url)
  const app = await loadApp() // a different module graph: the "browser"

  window.history.replaceState(null, "", url)
  document.body.innerHTML = `<div id="app">${server.appHtml}</div>`
  const container = document.getElementById("app")
  if (container === null) throw new Error("#app missing")
  const before = options.beforeBoot?.(container)

  const fallbacksSeen: Array<Element> = []
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue
        if (node.hasAttribute("data-fallback")) fallbacksSeen.push(node)
        fallbacksSeen.push(...node.querySelectorAll("[data-fallback]"))
      }
    }
  })
  observer.observe(container, { childList: true, subtree: true })

  const state = options.editState?.(server.state) ?? server.state
  const { Effect, Exit, Layer, Scope } = app.lib
  const scope = await Effect.runPromise(Scope.make())
  // Like client.ts: the platform layers live as long as the app's scope, not just as long as `boot`.
  const platform = await Effect.runPromise(
    Layer.buildWithScope(app.platformLayer(app.lib.BrowserRouter.layer({ routes: app.AppRoute })), scope)
  )
  const root = await Effect.runPromise(
    app.boot({ container, location: window.location.pathname + window.location.search, state }).pipe(
      Effect.provideContext(platform),
      Effect.provideService(Scope.Scope, scope)
    )
  )
  const close = async () => {
    observer.disconnect()
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
  open.push(close)
  return { app, root, container, before, serverState: state, fallbacksSeen, close }
}

export const click = (element: Element): void => {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }))
}

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
