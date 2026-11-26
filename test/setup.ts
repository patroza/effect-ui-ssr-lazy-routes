import * as Frames from "./support/frames.ts"

/**
 * happy-dom has no Popover API, and @effect/ui-kit's top-layer popups (Dialog,
 * Popover, ...) call it. A browser provides it natively; this stand-in only
 * records the open state so the kit's DOM work can run under test.
 */
// Files that opt into `@vitest-environment node` (the HTTP server tests) have no DOM to patch.
if (typeof HTMLElement !== "undefined") {
  // The kit's transitions settle on animation frames: a test runs them with `flushFrames`, not a timer.
  // The kit calls `document.defaultView.requestAnimationFrame`, which is happy-dom's own window.
  for (const view of new Set([window, document.defaultView])) {
    if (view === null) continue
    view.requestAnimationFrame = Frames.requestFrame
    view.cancelAnimationFrame = Frames.cancelFrame
  }
  const proto = HTMLElement.prototype
  if (typeof proto.showPopover !== "function") {
    proto.showPopover = function showPopover(this: HTMLElement) {
      this.setAttribute("data-test-popover-open", "")
    }
  }
  if (typeof proto.hidePopover !== "function") {
    proto.hidePopover = function hidePopover(this: HTMLElement) {
      this.removeAttribute("data-test-popover-open")
    }
  }
  if (typeof proto.togglePopover !== "function") {
    proto.togglePopover = function togglePopover(this: HTMLElement) {
      const open = this.hasAttribute("data-test-popover-open")
      if (open) this.hidePopover()
      else this.showPopover()
      return !open
    }
  }
}
