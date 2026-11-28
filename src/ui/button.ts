import { Button as KitButton, type ButtonElement, type ButtonProps } from "@effect/ui-kit"
import { cn } from "#lib/cn"

const base =
  "inline-flex h-8.5 shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent px-3.5 " +
  "text-[13px] leading-none font-medium whitespace-nowrap no-underline select-none " +
  "transition-[background-color,border-color,color,opacity] duration-150 active:translate-y-px " +
  "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 [&_svg]:size-[15px] [&_svg]:shrink-0 " +
  "data-[loading]:before:size-3 data-[loading]:before:animate-spin data-[loading]:before:rounded-full " +
  "data-[loading]:before:border-2 data-[loading]:before:border-current data-[loading]:before:border-r-transparent"

const variants = {
  default: "bg-primary text-primary-foreground hover:bg-primary/85",
  secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
  outline: "border-input bg-background text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground",
  ghost: "text-foreground hover:bg-accent hover:text-accent-foreground",
  brand: "bg-brand-soft text-brand-soft-foreground hover:bg-brand-soft/85",
  destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/85",
  link: "h-auto px-0 text-foreground underline decoration-transparent underline-offset-4 hover:decoration-current"
} as const

const sizes = {
  default: "",
  sm: "h-7 rounded-sm px-2.5 text-xs",
  lg: "h-10 px-5 text-sm",
  icon: "w-8.5 px-0",
  "icon-sm": "h-7 w-7 rounded-sm px-0"
} as const

export type ButtonVariant = keyof typeof variants
export type ButtonSize = keyof typeof sizes

/** The button's classes, for an element that should look like one: a link, a kit trigger. */
export const buttonVariants = (
  options: {
    readonly variant?: ButtonVariant | undefined
    readonly size?: ButtonSize | undefined
    readonly class?: string | undefined
  } = {}
): string => cn(base, variants[options.variant ?? "default"], sizes[options.size ?? "default"], options.class)

/**
 * The kit's Button with a look. Pass the message for a press as `onPress`
 * and chain the label: `Button(h, { variant: "outline", onPress }).children("Save")`.
 * `loading` shows a spinner and keeps the button focusable while it's disabled.
 */
export const Button = <Msg, R = never>(
  h: { readonly button: ButtonElement<Msg> },
  options: {
    readonly variant?: ButtonVariant | undefined
    readonly size?: ButtonSize | undefined
    readonly class?: string | undefined
    readonly loading?: boolean | undefined
    readonly element?: ButtonElement<Msg, R> | undefined
    readonly props?: ButtonProps | undefined
    readonly onPress?: NoInfer<Msg> | undefined
  } = {}
): ButtonElement<Msg, R> =>
  KitButton<Msg, R>(h, {
    element: options.element,
    onPress: options.onPress,
    props: options.loading === true ? { ...options.props, disabled: true, focusableWhenDisabled: true } : options.props
  })
    .class(buttonVariants(options))
    .attr("data-loading", options.loading === true ? "" : undefined)
