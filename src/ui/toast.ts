import type { Component } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import type { ToastItem, ToastProvider } from "@effect/ui-kit"
import { cn } from "#lib/cn"

/** What the `view` closure of the kit's `ToastProvider` receives. */
export type ToastProviderParts = Component.Headless.Parts<typeof ToastProvider>

const positions = {
  "top-left": "inset-[1rem_auto_auto_1rem] [--toast-direction:1]",
  "top-center": "inset-[1rem_0_auto_0] mx-auto [--toast-direction:1]",
  "top-right": "inset-[1rem_1rem_auto_auto] [--toast-direction:1]",
  "bottom-left": "inset-[auto_auto_1rem_1rem] [--toast-direction:-1]",
  "bottom-center": "inset-[auto_0_1rem_0] mx-auto [--toast-direction:-1]",
  "bottom-right": "inset-[auto_1rem_1rem_auto] [--toast-direction:-1]"
} as const

export type ToastPosition = keyof typeof positions

type ClassOption = { readonly class?: string | undefined }

/**
 * The region that holds the stack. The kit makes it a popover in the top
 * layer, so these classes clear the browser's popover box and pin it to a
 * corner. With `topLayer: false` on the provider it is an ordinary element:
 * pass `class: "absolute"` to place it inside a `relative` ancestor.
 */
export const ToastViewport = <Msg>(
  h: Html.H<Msg>,
  toastProvider: ToastProviderParts,
  options: ClassOption & { readonly position?: ToastPosition | undefined } = {}
) => {
  const position = options.position ?? "bottom-right"
  return toastProvider.viewport(
    h.div
      .class(
        cn(
          "group/toasts fixed m-0 h-[var(--toast-frontmost-height,0px)] w-[356px] max-w-[calc(100vw-2rem)] overflow-visible",
          "border-0 bg-transparent p-0 text-foreground outline-none [--toast-gap:10px] [--toast-peek:12px]",
          positions[position],
          options.class
        )
      )
      .attr("data-side", position.startsWith("top") ? "top" : "bottom")
  )
}

/**
 * One toast. Collapsed, the toasts sit behind the front one and peek out;
 * while the pointer or keyboard focus is on the stack they fan out, each
 * moved by the heights the kit measured.
 */
export const Toast = <Msg>(
  h: Html.H<Msg>,
  toastProvider: ToastProviderParts,
  toast: ToastItem,
  options: ClassOption = {}
) =>
  toastProvider.root({
    element: h.div.class(
      cn(
        "absolute inset-x-0 bottom-0 z-[calc(100_-_var(--toast-index,0))] box-border origin-bottom rounded-md border",
        "h-[var(--toast-frontmost-height,auto)] bg-popover text-[13px] leading-snug text-foreground shadow-float",
        "group-data-[side=top]/toasts:top-0 group-data-[side=top]/toasts:bottom-auto group-data-[side=top]/toasts:origin-top",
        "translate-y-[calc(var(--toast-index,0)_*_var(--toast-peek)_*_var(--toast-direction))]",
        "scale-[calc(1_-_var(--toast-index,0)_*_0.05)]",
        "transition-[translate,scale,opacity,height] duration-200 ease-out",
        // Fills the gap between two toasts, so the pointer stays on the stack.
        "after:absolute after:inset-x-0 after:-inset-y-[var(--toast-gap)] after:-z-10 after:content-['']",
        "data-[expanded]:h-[var(--toast-height,auto)] data-[expanded]:scale-100",
        "data-[expanded]:translate-y-[calc((var(--toast-offset-y,0px)_+_var(--toast-index,0)_*_var(--toast-gap))_*_var(--toast-direction))]",
        "data-[starting-style]:translate-y-[calc(var(--toast-direction)_*_-24px)] data-[starting-style]:opacity-0",
        "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
        "data-[limited]:pointer-events-none data-[limited]:opacity-0",
        options.class
      )
    ),
    toast
  })

/** The visible content of a toast, hidden while the toast sits behind the front one. */
export const ToastContent = <Msg>(
  h: Html.H<Msg>,
  toastProvider: ToastProviderParts,
  toast: ToastItem,
  options: ClassOption = {}
) =>
  toastProvider.content({
    element: h.div.class(
      cn(
        "flex h-full items-start gap-2.5 overflow-hidden rounded-[inherit] bg-popover px-3.5 py-3",
        "transition-opacity duration-200 data-[behind]:not-data-[expanded]:opacity-0",
        options.class
      )
    ),
    toast
  })

/** The column that holds the title and the description. */
export const ToastText = <Msg>(h: Html.H<Msg>, options: ClassOption = {}) =>
  h.div.class(cn("grid min-w-0 flex-1 gap-0.5", options.class))

export const ToastTitle = <Msg>(
  h: Html.H<Msg>,
  toastProvider: ToastProviderParts,
  toast: ToastItem,
  options: ClassOption = {}
) => toastProvider.title({ element: h.div.class(cn("font-medium", options.class)), toast }).children(toast.title)

export const ToastDescription = <Msg>(
  h: Html.H<Msg>,
  toastProvider: ToastProviderParts,
  toast: ToastItem,
  options: ClassOption = {}
) =>
  toastProvider
    .description({ element: h.div.class(cn("text-muted-foreground", options.class)), toast })
    .children(toast.description)

/** A button for the consumer's own action. Chain `.on("click", message)` and the label. */
export const ToastAction = <Msg>(
  h: Html.H<Msg>,
  toastProvider: ToastProviderParts,
  toast: ToastItem,
  options: ClassOption = {}
) =>
  toastProvider.action({
    element: h.button.class(
      cn(
        "inline-flex h-6.5 shrink-0 items-center self-center rounded-sm bg-primary px-2.5 text-xs font-medium",
        "text-primary-foreground transition-opacity duration-150 hover:opacity-85",
        options.class
      )
    ),
    toast
  })

export const ToastClose = <Msg>(
  h: Html.H<Msg>,
  toastProvider: ToastProviderParts,
  toast: ToastItem,
  options: ClassOption = {}
) =>
  toastProvider
    .close({
      element: h.button
        .class(
          cn(
            "-mt-0.5 -mr-1 inline-flex size-5.5 shrink-0 items-center justify-center rounded-sm text-muted-foreground",
            "transition-colors duration-150 hover:bg-accent hover:text-foreground",
            options.class
          )
        )
        .attr("aria-label", "Close"),
      toast
    })
    .children(
      h
        .el("svg")
        .attrs({
          class: "size-3.5",
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          "stroke-width": "2",
          "stroke-linecap": "round",
          "aria-hidden": "true"
        })
        .children(h.el("path").attr("d", "M6 6l12 12M18 6 6 18"))
    )

const icons: Record<string, { readonly class: string; readonly path: string }> = {
  success: { class: "text-success", path: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM8.5 12.5 11 15l4.5-5.5" },
  error: { class: "text-destructive", path: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM15 9l-6 6M9 9l6 6" },
  warning: {
    class: "text-warning",
    path: "M10.3 3.9 2.4 17.5a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4M12 16.5h.01"
  },
  info: { class: "text-muted-foreground", path: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM12 16v-4.5M12 8h.01" }
}

/** An icon for the toast's `type`: success, error, warning, info, or a spinner for loading. Nothing for any other. */
export const ToastIcon = <Msg>(h: Html.H<Msg>, toast: ToastItem, options: ClassOption = {}) => {
  if (toast.type === "loading") {
    return h.span
      .class(
        cn(
          "mt-px size-4 shrink-0 animate-spin rounded-full border-2 border-muted-foreground border-r-transparent",
          options.class
        )
      )
      .attr("aria-hidden", "true")
  }
  const icon = toast.type === undefined ? undefined : icons[toast.type]
  return icon === undefined
    ? undefined
    : h
        .el("svg")
        .attrs({
          class: cn("mt-px size-4 shrink-0", icon.class, options.class),
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          "stroke-width": "2",
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          "aria-hidden": "true"
        })
        .children(h.el("path").attr("d", icon.path))
}

/**
 * The whole stack with the usual toast: icon, title, description and a close
 * button. Draw it once inside the provider's `view` closure, next to the app:
 * `ToastProvider(h, { view: (toastProvider) => h.div(App(h, {}), Toaster(h, toastProvider)) })`.
 * For a toast with other content, compose the parts above yourself.
 */
export const Toaster = <Msg>(
  h: Html.H<Msg>,
  toastProvider: ToastProviderParts,
  options: ClassOption & { readonly position?: ToastPosition | undefined } = {}
) =>
  ToastViewport(h, toastProvider, options).children(
    toastProvider.toasts.map((toast) =>
      Toast(h, toastProvider, toast).children(
        ToastContent(h, toastProvider, toast).children(
          ToastIcon(h, toast),
          ToastText(h).children(
            ToastTitle(h, toastProvider, toast),
            toast.description !== undefined && ToastDescription(h, toastProvider, toast)
          ),
          toast.type !== "loading" && ToastClose(h, toastProvider, toast)
        )
      )
    )
  )
