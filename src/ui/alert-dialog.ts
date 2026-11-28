import type { Html } from "@effect/ui/html"
import type { AlertDialogParts } from "@effect/ui-kit"
import { cn } from "#lib/cn"

interface ClassOption {
  readonly class?: string | undefined
}

const sizes = {
  sm: "w-full max-w-[340px]",
  default: "w-full max-w-[440px]"
} as const

export type AlertDialogSize = keyof typeof sizes

/** The layer that dims the page. A press on it doesn't close an alert dialog. */
export const AlertDialogBackdrop = <Msg>(h: Html.H<Msg>, alertDialog: AlertDialogParts, options: ClassOption = {}) =>
  alertDialog.backdrop(
    h.div.class(
      cn(
        "fixed inset-0 bg-[color-mix(in_oklab,var(--shadow-color)_45%,transparent)] transition-opacity duration-200",
        "data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
        options.class
      )
    )
  )

/** Centres the popup in the screen. */
export const AlertDialogViewport = <Msg>(h: Html.H<Msg>, alertDialog: AlertDialogParts, options: ClassOption = {}) =>
  alertDialog.viewport(h.div.class(cn("pointer-events-none fixed inset-0 grid place-items-center p-4", options.class)))

export const AlertDialogPopup = <Msg>(
  h: Html.H<Msg>,
  alertDialog: AlertDialogParts,
  options: ClassOption & { readonly size?: AlertDialogSize | undefined } = {}
) =>
  alertDialog.popup(
    h.div.class(
      cn(
        "pointer-events-auto relative flex max-h-full flex-col gap-4 rounded-lg border bg-popover p-6 text-sm",
        "text-foreground shadow-float outline-none",
        "transition-[opacity,scale] duration-200 ease-out",
        "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
        "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
        sizes[options.size ?? "default"],
        options.class
      )
    )
  )

export const AlertDialogHeader = <Msg>(h: Html.H<Msg>, options: ClassOption = {}) =>
  h.div.class(cn("flex flex-col gap-1.5", options.class))

export const AlertDialogTitle = <Msg>(h: Html.H<Msg>, alertDialog: AlertDialogParts, options: ClassOption = {}) =>
  alertDialog.title(
    h.h2.class(cn("m-0 border-0 p-0 text-[16px] leading-snug font-semibold tracking-tight", options.class))
  )

export const AlertDialogDescription = <Msg>(h: Html.H<Msg>, alertDialog: AlertDialogParts, options: ClassOption = {}) =>
  alertDialog.description(
    h.p.class(
      cn(
        "m-0 text-[13px] leading-normal text-muted-foreground",
        "[&_code]:rounded-xs [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs " +
          "[&_code]:text-foreground",
        options.class
      )
    )
  )

export const AlertDialogFooter = <Msg>(h: Html.H<Msg>, options: ClassOption = {}) =>
  h.div.class(cn("flex flex-wrap items-center justify-end gap-2", options.class))
