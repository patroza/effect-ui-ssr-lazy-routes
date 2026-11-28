import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { TestClock } from "effect/testing"
import * as Design from "../src/design/classes.ts"
import * as Helpers from "./helpers.ts"
import * as TestRpc from "./support/rpc.ts"

const roundTrip = Effect.gen(function* () {
  yield* Helpers.settleFrames
  yield* TestClock.adjust("5 millis")
  yield* Helpers.settleFrames
})

const settleMutation = Effect.andThen(roundTrip, roundTrip)

const advanceStreamStep = Effect.gen(function* () {
  yield* Helpers.settleFrames
  yield* TestClock.adjust("120 millis")
  yield* Helpers.settleFrames
  yield* TestClock.adjust("5 millis")
  yield* Helpers.settleFrames
})

describe("/warehouse Scanner Command Console", () => {
  it.layer(Helpers.browserEnv, { buildPerTest: true })("hydrated DOM workflows", (it) => {
    it.effect("SSR + zero-flash hydration in EN and DE preserves exact DOM nodes with 0 client refetches", () =>
      Effect.gen(function* () {
        const en = yield* Helpers.hydrateCapturing(
          "/warehouse",
          (container) => ({
            section: container.querySelector('[data-page-chunk="SENTINEL:warehouse-page"]')
          }),
          { locale: "en" }
        )
        expect(en.before.section).not.toBeNull()
        expect(en.container.querySelector('[data-page-chunk="SENTINEL:warehouse-page"]')).toBe(en.before.section)
        expect(en.container.textContent).toContain("Warehouse Command Console")
        expect(Helpers.byTestId(en.container, "cart-status-cart-309").textContent).toBe("Blocked")
        expect(en.fallbacksSeen()).toEqual([])
        expect(yield* Helpers.portCounts).toEqual(TestRpc.noCalls)
        yield* en.close

        const de = yield* Helpers.hydrateFromServer("/warehouse", { locale: "de" })
        expect(document.documentElement.lang).toBe("de")
        expect(de.container.textContent).toContain("Lager-Command-Konsole")
        expect(Helpers.byTestId(de.container, "unblock-cart-309").textContent).toBe("Freigeben")
        expect(de.fallbacksSeen()).toEqual([])
        expect(yield* Helpers.portCounts).toEqual(TestRpc.noCalls)
      })
    )

    it.effect(
      "optimistically unblocks a cart, rolls back with Ref trace badge on conflict, and succeeds on retry",
      () =>
        Effect.gen(function* () {
          const { container } = yield* Helpers.hydrateFromServer("/warehouse")

          // Enable simulated checkout conflict, then click Unblock on cart-309.
          Helpers.click(Helpers.byTestId(container, "sim-checkout-conflict"))
          yield* Helpers.settleFrames
          Helpers.click(Helpers.byTestId(container, "unblock-cart-309"))
          yield* Helpers.settleFrames

          // Optimistic patch flips status immediately before RPC settles.
          expect(Helpers.byTestId(container, "cart-status-cart-309").textContent).toBe("Free")

          // Let the RPC fail -> optimistic cache rolls back to Blocked + inline banner + Ref badge.
          yield* settleMutation
          expect(Helpers.byTestId(container, "cart-status-cart-309").textContent).toBe("Blocked")
          const banner = Helpers.byTestId(container, "warehouse-error-banner")
          expect(banner.textContent).toContain("Bay-A2")
          expect(Helpers.byTestId(container, "command-trace-ref").textContent).toMatch(/^Ref /)

          // Turn off simulated conflict and retry from the error banner.
          Helpers.click(Helpers.byTestId(container, "sim-checkout-conflict"))
          yield* Helpers.settleFrames
          Helpers.click(Helpers.byTestId(container, "command-error-retry"))
          yield* settleMutation

          expect(Helpers.byTestId(container, "cart-status-cart-309").textContent).toBe("Free")
          expect(Helpers.byTestId(container, "warehouse-success-banner").textContent).toContain("CART-309")

          const counts = yield* Helpers.portCounts
          expect(counts.unblockCart).toBe(2)
          expect(counts.getWarehouseCarts).toBe(2)
        })
    )

    it.effect("gates BlockCart with controlled Dialog + SchemaForm cross-field validation", () =>
      Effect.gen(function* () {
        const { container } = yield* Helpers.hydrateFromServer("/warehouse")

        Helpers.click(Helpers.byTestId(container, "block-cart-101"))
        yield* Helpers.settleFrames
        expect(Helpers.byTestId(container, "block-dialog-popup")).not.toBeNull()

        // Selecting damage requires a >= 5-char note; empty submit blocks without hitting RPC.
        Helpers.click(Helpers.byTestId(container, "block-reason-damage"))
        yield* Helpers.settleFrames
        Helpers.click(Helpers.byTestId(container, "block-dialog-submit"))
        yield* Helpers.settleFrames
        expect(Helpers.byTestId(container, "block-note-error").textContent).toContain("min 5 characters")
        expect((yield* Helpers.portCounts).blockCart).toBe(0)

        Helpers.type(Helpers.byTestId(container, "block-note-input"), "Broken caster wheel")
        yield* Helpers.settleFrames
        Helpers.click(Helpers.byTestId(container, "block-dialog-submit"))
        yield* settleMutation

        expect(container.querySelector('[data-testid="block-dialog-popup"]')).toBeNull()
        expect(Helpers.byTestId(container, "cart-status-cart-101").textContent).toBe("Blocked")
        expect(Helpers.byTestId(container, "cart-card-cart-101").textContent).toContain("Broken caster wheel")
        expect((yield* Helpers.portCounts).blockCart).toBe(1)
      })
    )

    it.effect("rejects busy cart release via CartInUseError and commits safe release through AlertDialog", () =>
      Effect.gen(function* () {
        const { container } = yield* Helpers.hydrateFromServer("/warehouse")

        // Busy cart-204 fails preflight and never opens confirmation AlertDialog.
        Helpers.click(Helpers.byTestId(container, "release-cart-204"))
        yield* roundTrip
        expect(container.querySelector('[data-testid="release-alert-popup"]')).toBeNull()
        expect(Helpers.byTestId(container, "warehouse-error-banner").textContent).toContain("Packstation B")

        // Free cart-101 passes preflight -> opens AlertDialog -> populates Trace panel.
        Helpers.click(Helpers.byTestId(container, "release-cart-101"))
        yield* roundTrip
        expect(Helpers.byTestId(container, "release-alert-popup")).not.toBeNull()
        expect(Helpers.byTestId(container, "trace-origin-span").textContent).toContain("Preflight / Origin span:")

        Helpers.click(Helpers.byTestId(container, "release-alert-confirm"))
        yield* settleMutation
        expect(container.querySelector('[data-testid="release-alert-popup"]')).toBeNull()
        expect(Helpers.byTestId(container, "warehouse-success-banner").textContent).toContain("6 picks cleared")
        expect(Helpers.byTestId(container, "trace-exec-span").textContent).toContain("Execution span:")
      })
    )

    it.effect(
      "runs streaming DispatchCartBatch through warning Dialog and supports mid-stream Command.interrupt cancel",
      () =>
        Effect.gen(function* () {
          const { container } = yield* Helpers.hydrateFromServer("/warehouse")

          // cart-102 has 2 warnings -> opens supervisor audit note Dialog.
          Helpers.click(Helpers.byTestId(container, "dispatch-cart-102"))
          yield* roundTrip
          expect(Helpers.byTestId(container, "dispatch-warn-popup")).not.toBeNull()

          Helpers.click(Helpers.byTestId(container, "dispatch-warn-confirm"))
          yield* Helpers.settleFrames
          expect(Helpers.byTestId(container, "dispatch-audit-error").textContent).toContain("at least 5 characters")

          Helpers.type(Helpers.byTestId(container, "dispatch-audit-input"), "Verified cushions")
          yield* Helpers.settleFrames
          Helpers.click(Helpers.byTestId(container, "dispatch-warn-confirm"))
          yield* roundTrip

          // Step 1 ("validate") completed; steps 2..4 stream across 120ms + 5ms slices.
          expect(Helpers.byTestId(container, "dispatch-progress-panel").textContent).toContain("1/4")
          for (let step = 0; step < 3; step++) {
            yield* advanceStreamStep
          }
          // Invalidation refetch of GetWarehouseCarts.
          yield* roundTrip

          expect(container.querySelector('[data-testid="dispatch-progress-panel"]')).toBeNull()
          expect(Helpers.byTestId(container, "cart-status-cart-102").textContent).toBe("Dispatched")
          expect(Helpers.byTestId(container, "warehouse-success-banner").textContent).toContain("BATCH-0001")

          // cart-101 has 0 warnings -> opens AlertDialog -> cancel mid-stream interrupts fiber cleanly.
          const stepsBeforeCancel = (yield* Helpers.portCounts).dispatchCartStep
          Helpers.click(Helpers.byTestId(container, "dispatch-cart-101"))
          yield* roundTrip
          expect(Helpers.byTestId(container, "dispatch-alert-popup")).not.toBeNull()

          Helpers.click(Helpers.byTestId(container, "dispatch-confirm"))
          yield* roundTrip
          expect(Helpers.byTestId(container, "dispatch-progress-panel").textContent).toContain("1/4")

          Helpers.click(Helpers.byTestId(container, "command-progress-cancel"))
          yield* Helpers.settleFrames
          expect(container.querySelector('[data-testid="dispatch-progress-panel"]')).toBeNull()
          expect(Helpers.byTestId(container, "warehouse-success-banner").textContent).toContain("Operation cancelled")

          yield* Helpers.runOutTheClock
          expect(Helpers.byTestId(container, "cart-status-cart-101").textContent).toBe("Free")
          expect((yield* Helpers.portCounts).dispatchCartStep - stepsBeforeCancel).toBe(1)
        })
    )

    it.effect("recovers from mid-flight SessionExpiredError via AlertDialog without losing dialog draft inputs", () =>
      Effect.gen(function* () {
        const { container } = yield* Helpers.hydrateFromServer("/warehouse")

        Helpers.click(Helpers.byTestId(container, "sim-session-expired"))
        yield* Helpers.settleFrames

        Helpers.click(Helpers.byTestId(container, "block-cart-101"))
        yield* Helpers.settleFrames
        Helpers.click(Helpers.byTestId(container, "block-reason-damage"))
        yield* Helpers.settleFrames
        Helpers.type(Helpers.byTestId(container, "block-note-input"), "Bent handle")
        yield* Helpers.settleFrames
        Helpers.click(Helpers.byTestId(container, "block-dialog-submit"))
        yield* roundTrip

        expect(Helpers.byTestId(container, "session-expired-popup")).not.toBeNull()

        // Confirm re-authentication -> RefreshSession + automatic replay of BlockCart with preserved "Bent handle" draft.
        Helpers.click(Helpers.byTestId(container, "session-expired-confirm"))
        yield* roundTrip // refreshSession
        yield* settleMutation // replayed blockCart + GetWarehouseCarts refetch

        expect(container.querySelector('[data-testid="session-expired-popup"]')).toBeNull()
        expect(container.querySelector('[data-testid="block-dialog-popup"]')).toBeNull()
        expect(Helpers.byTestId(container, "cart-status-cart-101").textContent).toBe("Blocked")
        expect(Helpers.byTestId(container, "cart-card-cart-101").textContent).toContain("Bent handle")

        const counts = yield* Helpers.portCounts
        expect(counts.refreshSession).toBe(1)
        expect(counts.blockCart).toBe(2)
      })
    )

    it.effect("keeps ToastProvider silent by default and emits toasts only when opted in", () =>
      Effect.gen(function* () {
        const { container } = yield* Helpers.hydrateFromServer("/warehouse")
        const viewport = Helpers.byTestId(container, "warehouse-toast-viewport")

        // Default off: unblocking emits 0 toasts.
        Helpers.click(Helpers.byTestId(container, "unblock-cart-309"))
        yield* settleMutation
        expect(viewport.querySelectorAll('[data-testid^="warehouse-toast-"]')).toHaveLength(0)

        // Toggle opt-in toasts ON and run BlockCart -> toast renders inside viewport.
        Helpers.click(Helpers.byTestId(container, "toggle-opt-in-toasts"))
        yield* Helpers.settleFrames
        Helpers.click(Helpers.byTestId(container, "block-cart-101"))
        yield* Helpers.settleFrames
        Helpers.click(Helpers.byTestId(container, "block-dialog-submit"))
        yield* settleMutation

        expect(viewport.querySelectorAll('[data-testid^="warehouse-toast-"]')).toHaveLength(1)
        expect(viewport.textContent).toContain("CART-101")

        // A failing non-dispatch action emits toastActionError when opted in.
        Helpers.click(Helpers.byTestId(container, "release-cart-204"))
        yield* roundTrip
        expect(viewport.querySelectorAll('[data-testid^="warehouse-toast-"]')).toHaveLength(2)
        expect(viewport.textContent).toContain("Packstation B")
      })
    )

    it.effect("recovers from SessionExpiredError during PreflightDispatch without leaving flow stuck in Running", () =>
      Effect.gen(function* () {
        const { container } = yield* Helpers.hydrateFromServer("/warehouse")

        Helpers.click(Helpers.byTestId(container, "sim-session-expired"))
        yield* Helpers.settleFrames

        Helpers.click(Helpers.byTestId(container, "dispatch-cart-101"))
        yield* roundTrip
        expect(Helpers.byTestId(container, "session-expired-popup")).not.toBeNull()

        Helpers.click(Helpers.byTestId(container, "session-expired-confirm"))
        yield* roundTrip // refreshSession
        yield* roundTrip // replayed preflightDispatchCart

        expect(container.querySelector('[data-testid="session-expired-popup"]')).toBeNull()
        expect(Helpers.byTestId(container, "dispatch-alert-popup")).not.toBeNull()
        expect(container.querySelector('[data-testid="dispatch-progress-panel"]')).toBeNull()
        expect(container.querySelector('[data-testid="warehouse-error-banner"]')).toBeNull()

        const counts = yield* Helpers.portCounts
        expect(counts.refreshSession).toBe(1)
        expect(counts.preflightDispatchCart).toBe(2)
      })
    )

    it.effect("shows Checking… only on the clicked preflight action while disabling sibling actions", () =>
      Effect.gen(function* () {
        const { container } = yield* Helpers.hydrateFromServer("/warehouse")

        Helpers.click(Helpers.byTestId(container, "dispatch-cart-101"))
        yield* Helpers.settleFrames

        const dispatchBtn = Helpers.byTestId(container, "dispatch-cart-101")
        const releaseBtn = Helpers.byTestId(container, "release-cart-101")
        const blockBtn = Helpers.byTestId(container, "block-cart-101")

        expect(dispatchBtn.getAttribute("aria-busy")).toBe("true")
        expect(dispatchBtn.textContent).toBe("Checking…")
        expect(releaseBtn.getAttribute("aria-busy")).toBeNull()
        expect(releaseBtn.textContent).toBe("Release…")
        expect(releaseBtn.hasAttribute("disabled")).toBe(true)
        expect(blockBtn.hasAttribute("disabled")).toBe(true)

        yield* roundTrip
        expect(Helpers.byTestId(container, "dispatch-alert-popup")).not.toBeNull()
        expect(dispatchBtn.getAttribute("aria-busy")).toBeNull()
      })
    )
  })

  it("keeps Design.ui button and card recipes free of conflicting Tailwind color utilities", () => {
    const tokens = (classes: string) => new Set(classes.split(/\s+/).filter(Boolean))

    const primary = tokens(Design.ui.buttonPrimary)
    expect(primary.has("bg-primary")).toBe(true)
    expect(primary.has("text-primary-foreground")).toBe(true)
    expect(primary.has("bg-background")).toBe(false)
    expect(primary.has("text-foreground")).toBe(false)

    const danger = tokens(Design.ui.buttonDanger)
    expect(danger.has("bg-destructive")).toBe(true)
    expect(danger.has("text-destructive-foreground")).toBe(true)
    expect(danger.has("border-input")).toBe(false)
    expect(danger.has("text-foreground")).toBe(false)

    for (const variant of [Design.ui.cardError, Design.ui.cardWarning, Design.ui.cardSuccess, Design.ui.cardInfo]) {
      const cardTokens = tokens(variant)
      expect(cardTokens.has("border-border")).toBe(false)
      expect(cardTokens.has("bg-card")).toBe(false)
    }
  })
})
