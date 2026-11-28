import type { Component } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import type { Dialog } from "@effect/ui-kit"
import { cn } from "#lib/cn"

/** What a `Dialog`'s `view` closure receives. */
export type DialogParts = Component.Headless.Parts<typeof Dialog>

interface ClassOption {
  readonly class?: string | undefined
}

const sizes = {
  sm: "w-full max-w-[340px]",
  default: "w-full max-w-[440px]",
  lg: "w-full max-w-[680px]",
  full:
    "h-full w-full rounded-none border-0 data-[ending-style]:translate-y-4 data-[starting-style]:translate-y-4 " +
    "data-[ending-style]:scale-100 data-[starting-style]:scale-100"
} as const

export type DialogSize = keyof typeof sizes

/** The layer that dims the page. Leave it out of a non-modal dialog. */
export const DialogBackdrop = <Msg>(h: Html.H<Msg>, dialog: DialogParts, options: ClassOption = {}) =>
  dialog.backdrop(
    h.div.class(
      cn(
        "fixed inset-0 bg-[color-mix(in_oklab,var(--shadow-color)_45%,transparent)] transition-opacity duration-200",
        "data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
        options.class
      )
    )
  )

/** Centres the popup in the screen. Presses pass through it to the backdrop or the page. */
export const DialogViewport = <Msg>(
  h: Html.H<Msg>,
  dialog: DialogParts,
  options: ClassOption & { readonly size?: DialogSize | undefined } = {}
) =>
  dialog.viewport(
    h.div.class(
      cn(
        "pointer-events-none fixed inset-0 grid place-items-center",
        options.size === "full" ? "p-0" : "p-4",
        options.class
      )
    )
  )

/** The dialog's box. With another dialog open inside it, it steps back. */
export const DialogPopup = <Msg>(
  h: Html.H<Msg>,
  dialog: DialogParts,
  options: ClassOption & { readonly size?: DialogSize | undefined } = {}
) =>
  dialog.popup(
    h.div.class(
      cn(
        "pointer-events-auto relative flex max-h-full flex-col gap-4 rounded-lg border bg-popover p-6 text-sm",
        "text-foreground shadow-float outline-none",
        "transition-[opacity,scale,translate,filter] duration-200 ease-out",
        "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
        "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
        "data-[nested-dialog-open]:-translate-y-[calc(14px*var(--nested-dialogs))]",
        "data-[nested-dialog-open]:scale-[calc(1-0.05*var(--nested-dialogs))]",
        "data-[nested-dialog-open]:brightness-95",
        sizes[options.size ?? "default"],
        options.class
      )
    )
  )

export const DialogHeader = <Msg>(h: Html.H<Msg>, options: ClassOption = {}) =>
  h.div.class(cn("flex flex-col gap-1.5 pr-6", options.class))

export const DialogTitle = <Msg>(h: Html.H<Msg>, dialog: DialogParts, options: ClassOption = {}) =>
  dialog.title(h.h2.class(cn("m-0 border-0 p-0 text-[16px] leading-snug font-semibold tracking-tight", options.class)))

export const DialogDescription = <Msg>(h: Html.H<Msg>, dialog: DialogParts, options: ClassOption = {}) =>
  dialog.description(h.p.class(cn("m-0 text-[13px] leading-normal text-muted-foreground", options.class)))

/** The content between the header and the footer. `scrollable` lets it scroll when the dialog is taller than the screen. */
export const DialogBody = <Msg>(
  h: Html.H<Msg>,
  options: ClassOption & { readonly scrollable?: boolean | undefined } = {}
) =>
  h.div.class(
    cn(
      "flex flex-col gap-3 text-[13px]",
      options.scrollable === true && "-mx-6 min-h-0 overflow-y-auto border-y px-6 py-4 text-muted-foreground",
      options.class
    )
  )

export const DialogFooter = <Msg>(h: Html.H<Msg>, options: ClassOption = {}) =>
  h.div.class(cn("flex flex-wrap items-center justify-end gap-2", options.class))

/** The small close button in the popup's corner. */
export const DialogCloseIcon = <Msg>(
  h: Html.H<Msg>,
  dialog: DialogParts,
  options: ClassOption & { readonly label?: string | undefined } = {}
) =>
  dialog
    .close(
      h.button
        .class(
          cn(
            "absolute top-3.5 right-3.5 grid size-7 place-items-center rounded-sm text-muted-foreground",
            "transition-colors duration-150 hover:bg-accent hover:text-foreground",
            options.class
          )
        )
        .attr("aria-label", options.label ?? "Close")
    )
    .children(
      h
        .el("svg")
        .attrs({
          class: "size-[15px]",
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          "stroke-width": "2",
          "stroke-linecap": "round",
          "aria-hidden": "true"
        })
        .children(h.el("path").attr("d", "M6 6l12 12M18 6L6 18"))
    )
