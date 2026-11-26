/**
 * happy-dom has no Popover API, and @effect/ui-kit's top-layer popups (Dialog,
 * Popover, ...) call it. A browser provides it natively; this stand-in only
 * records the open state so the kit's DOM work can run under test.
 */
// Files that opt into `@vitest-environment node` (the HTTP server tests) have no DOM to patch.
if (typeof HTMLElement !== "undefined") {
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
