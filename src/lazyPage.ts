import { Component } from "@effect/ui"

/**
 * What a page needs to be rendered like a normal child component, typed from
 * the page's own props, events, requirements and slots.
 *
 * The result parameter is `Component.Lazy.Result`, so a `fallback` that is
 * written for a lazy component (`Initial | Failure`) type-checks for both the
 * lazy wrapper and the real component.
 */
export type PageCall<C extends Component.Any> = Component.Mountable.Call<
  Component.Props<C>,
  Component.Events<C>,
  Component.Requirements<C>,
  Component.Slots<C>,
  Component.Lazy.Result
>

export interface LazyRoutePage<C extends Component.Any & PageCall<C>> {
  /** The component name. Must equal the loaded component's own `name`. */
  readonly name: string
  /**
   * Imports the page and keeps its real `Component` for the first render.
   *
   * Call it BEFORE `HtmlHydrate.hydrate()` / `BrowserHost.mount()`, for the
   * page of the route the browser is on. It is a no-op once the page has been
   * rendered (the component identity must never change under a live page).
   */
  readonly preloadInitial: () => Promise<void>
  /**
   * Starts loading the chunk (e.g. on link hover/focus) without touching the
   * component that `render` will use.
   */
  readonly prefetch: () => Promise<void>
  /** `"initial"` when `render` uses the preloaded real component, else `"lazy"`. */
  readonly mode: () => "initial" | "lazy"
  /** `true` once the page module has been imported (by any path). */
  readonly isLoaded: () => boolean
  /** Declares the page as a child. Same signature as calling the component. */
  readonly render: PageCall<C>
}

/**
 * A route page that code-splits with `Component.lazy`, and also hydrates
 * server-rendered HTML with no loader/fallback flash.
 *
 * Why not just use `Component.lazy`? On the client, `HtmlHydrate.hydrate`
 * decodes the server's serialized state per child with that child's
 * *component*. A not-yet-loaded `Component.lazy` has no Model schema, so it
 * can't be decoded (Effect-TS/ui#263) and the client would have to throw the
 * server's DOM away, render the fallback, and then render the page.
 *
 * The workaround: the entry loads the active route's chunk first and hands the
 * real `Component` to the first render. Every other page stays a
 * `Component.lazy`. Once #263 lands, `render` can be `lazy` unconditionally and
 * `preloadInitial` only has to `lazy.preload()` the chunk (see README).
 */
export const makeLazyRoutePage = <C extends Component.Any & PageCall<C>>(
  name: string,
  load: () => Promise<C>
): LazyRoutePage<C> => {
  // One import() promise, shared by the lazy wrapper and `preloadInitial`, so
  // there is exactly one request for the chunk however it gets triggered.
  let loading: Promise<C> | undefined
  let imported = false
  const loadOnce = (): Promise<C> => {
    loading ??= load().then((component) => {
      imported = true
      return component
    })
    return loading
  }

  const lazy = Component.lazy(name, loadOnce)

  // Set at most once, before the first render. After that it never changes:
  // the kernel pairs old and new children by component identity, so swapping
  // `lazy` for the real component (or back) would remount a live page.
  let initial: C | undefined
  let rendered = false

  const render: PageCall<C> = (h, options) => {
    rendered = true
    const target: PageCall<C> = initial ?? lazy
    return target(h, options)
  }

  return {
    name,
    preloadInitial: async () => {
      const component = await loadOnce()
      if (rendered || initial !== undefined) return
      if (component.definition.name !== name) {
        throw new Error(
          `makeLazyRoutePage: "${name}" loaded a component named "${component.definition.name}". ` +
            "The names must match, or the server's serialized state paths won't line up."
        )
      }
      initial = component
    },
    prefetch: () => lazy.preload(),
    mode: () => (initial === undefined ? "lazy" : "initial"),
    isLoaded: () => imported,
    render
  }
}
