import type { Html } from "@effect/ui/html"
import { type ButtonElement, Switch as KitSwitch, type SwitchProps } from "@effect/ui-kit"
import { cn } from "#lib/cn"

const sizes = {
  sm: { root: "h-3.5 w-6.5", thumb: "size-2.5 data-[checked]:translate-x-3" },
  default: { root: "h-4.5 w-8", thumb: "size-3.5 data-[checked]:translate-x-3.5" },
  lg: { root: "h-6 w-10.5 p-[3px]", thumb: "size-4.5 data-[checked]:translate-x-4.5" }
} as const

export type SwitchSize = keyof typeof sizes

/**
 * The kit's Switch, drawn: a track with its thumb. Accepts an optional `element`
 * (e.g. `field.control(h.button)`) so it can wire into a `Field`.
 */
export const Switch = <Msg, R = never>(
  h: Html.H<Msg>,
  options: {
    readonly size?: SwitchSize | undefined
    readonly class?: string | undefined
    readonly element?: ButtonElement<Msg, R> | undefined
    readonly props: SwitchProps
    readonly onToggle?: ((event: { readonly checked: boolean }) => NoInfer<Msg> | undefined) | undefined
  }
) => {
  const size = sizes[options.size ?? "default"]
  return KitSwitch(h, {
    props: options.props,
    onToggle: options.onToggle,
    view: (parts) =>
      parts
        .root(
          (options.element ?? h.button).class(
            cn(
              "inline-flex shrink-0 items-center rounded-full border-0 bg-input p-0.5 transition-colors duration-150 " +
                "data-[checked]:bg-brand data-[readonly]:cursor-default " +
                "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
              size.root,
              options.class
            )
          )
        )
        .children(
          parts.thumb(
            h.span.class(
              cn(
                "rounded-full bg-background shadow-sm transition-[translate,background-color] duration-150 " +
                  "dark:bg-foreground data-[checked]:bg-brand-foreground dark:data-[checked]:bg-brand-foreground",
                size.thumb
              )
            )
          )
        )
  })
}

/** A label for the switch: around it, or beside it with `for`. It dims with a disabled switch inside it. */
export const SwitchLabel = <Msg>(h: Html.H<Msg>, options: { readonly class?: string | undefined } = {}) =>
  h.label.class(
    cn(
      "inline-flex cursor-pointer items-center gap-2.5 text-[13px] leading-4.5 font-medium select-none " +
        "has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:text-muted-foreground",
      options.class
    )
  )
