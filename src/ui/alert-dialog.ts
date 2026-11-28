import type { Html } from "@effect/ui/html"
import type { AlertDialogParts } from "@effect/ui-kit"
import * as Cx from "./cx.ts"

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
      Cx.cx(
        "fixed inset-0 bg-black/40 transition-opacity duration-200",
        "data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
        options.class
      )
    )
  )

/** Centres the popup in the screen. */
export const AlertDialogViewport = <Msg>(h: Html.H<Msg>, alertDialog: AlertDialogParts, options: ClassOption = {}) =>
  alertDialog.viewport(
    h.div.class(Cx.cx("pointer-events-none fixed inset-0 grid place-items-center p-4", options.class))
  )

export const AlertDialogPopup = <Msg>(
  h: Html.H<Msg>,
  alertDialog: AlertDialogParts,
  options: ClassOption & { readonly size?: AlertDialogSize | undefined } = {}
) =>
  alertDialog.popup(
    h.div.class(
      Cx.cx(
        "pointer-events-auto relative flex max-h-full flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-6 text-sm",
        "text-neutral-900 shadow-xl outline-none dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100",
        "transition-[opacity,scale] duration-200 ease-out",
        "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
        "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
        sizes[options.size ?? "default"],
        options.class
      )
    )
  )

export const AlertDialogHeader = <Msg>(h: Html.H<Msg>, options: ClassOption = {}) =>
  h.div.class(Cx.cx("flex flex-col gap-1.5", options.class))

export const AlertDialogTitle = <Msg>(h: Html.H<Msg>, alertDialog: AlertDialogParts, options: ClassOption = {}) =>
  alertDialog.title(
    h.h2.class(Cx.cx("m-0 border-0 p-0 text-[16px] leading-snug font-semibold tracking-tight", options.class))
  )

export const AlertDialogDescription = <Msg>(h: Html.H<Msg>, alertDialog: AlertDialogParts, options: ClassOption = {}) =>
  alertDialog.description(
    h.p.class(
      Cx.cx(
        "m-0 text-[13px] leading-normal text-neutral-600 dark:text-neutral-400",
        "[&_code]:rounded-xs [&_code]:bg-neutral-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
        "[&_code]:text-neutral-900 dark:[&_code]:bg-neutral-800 dark:[&_code]:text-neutral-100",
        options.class
      )
    )
  )

export const AlertDialogFooter = <Msg>(h: Html.H<Msg>, options: ClassOption = {}) =>
  h.div.class(Cx.cx("flex flex-wrap items-center justify-end gap-2", options.class))
