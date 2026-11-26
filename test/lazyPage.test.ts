import { UiSchema } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { makeLazyRoutePage } from "../src/lazyPage.ts"

const Tiny = Html.component({
  name: "Tiny",
  model: Schema.Struct({}),
  message: UiSchema.TaggedEnum({})
}).make({
  init: () => ({}),
  update: ($) => $.model,
  view: (h) => h.p("tiny")
})

const counting = () => {
  let calls = 0
  return { load: () => (calls += 1, Promise.resolve(Tiny)), calls: () => calls }
}

describe("makeLazyRoutePage", () => {
  it("starts out lazy and not loaded", () => {
    const { load, calls } = counting()
    const page = makeLazyRoutePage("Tiny", load)
    expect(page.mode()).toBe("lazy")
    expect(page.isLoaded()).toBe(false)
    expect(calls()).toBe(0)
  })

  it("prefetch loads the chunk but does not choose the component for the first render", async () => {
    const { load, calls } = counting()
    const page = makeLazyRoutePage("Tiny", load)
    await page.prefetch()
    expect(page.isLoaded()).toBe(true)
    expect(page.mode()).toBe("lazy")
    expect(calls()).toBe(1)
  })

  it("preloadInitial loads the chunk and switches the first render to the real component", async () => {
    const { load, calls } = counting()
    const page = makeLazyRoutePage("Tiny", load)
    await page.preloadInitial()
    expect(page.isLoaded()).toBe(true)
    expect(page.mode()).toBe("initial")
    expect(calls()).toBe(1)
  })

  it("requests the chunk once however many paths ask for it", async () => {
    const { load, calls } = counting()
    const page = makeLazyRoutePage("Tiny", load)
    await Promise.all([page.prefetch(), page.preloadInitial(), page.prefetch(), page.preloadInitial()])
    expect(calls()).toBe(1)
  })

  it("rejects when the loaded component's name differs (server state paths would not line up)", async () => {
    const { load } = counting()
    const page = makeLazyRoutePage("SomethingElse", load)
    await expect(page.preloadInitial()).rejects.toThrow(/named "Tiny"/)
    expect(page.mode()).toBe("lazy")
  })

  it("propagates a failed import from preloadInitial, and prefetch never rejects", async () => {
    const page = makeLazyRoutePage<typeof Tiny>("Tiny", () => Promise.reject(new Error("chunk 404")))
    await expect(page.prefetch()).resolves.toBeUndefined()
    await expect(page.preloadInitial()).rejects.toThrow("chunk 404")
    expect(page.isLoaded()).toBe(false)
  })
})
