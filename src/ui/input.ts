import type { Html } from "@effect/ui/html"
import { Input as KitInput, type InputElement, type InputProps } from "@effect/ui-kit"
import { cn } from "#lib/cn"

const base =
  "block h-8.5 w-full min-w-0 rounded-md border border-input bg-background px-3 text-[13px] text-foreground shadow-sm outline-none " +
  "transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground " +
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 " +
  "aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/20 " +
  "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 " +
  "[&[readonly]]:bg-muted [&[readonly]]:text-muted-foreground [&[readonly]]:shadow-none " +
  "[&[type=file]]:cursor-pointer [&[type=file]]:pl-0 [&[type=file]]:leading-8 [&[type=file]]:text-muted-foreground " +
  "file:mr-3 file:h-8 file:cursor-pointer file:border-0 file:border-r file:border-solid file:border-input file:bg-muted file:px-3 " +
  "file:text-[13px] file:font-medium file:text-foreground"

const sizes = {
  default: "",
  sm: "h-7 rounded-sm px-2.5 text-xs",
  lg: "h-10 px-3.5 text-sm"
} as const

export type InputSize = keyof typeof sizes

interface ClassOption {
  readonly class?: string | undefined
}

/** The input's classes, for a control that should look like one: a textarea, a native select, a file input. */
export const inputVariants = (
  options: { readonly size?: InputSize | undefined; readonly class?: string | undefined } = {}
): string => cn(base, sizes[options.size ?? "default"], options.class)

/**
 * The kit's Input with a look. Pass the value as `props` and what an edit
 * sends as `onUpdate`, and chain the native attributes:
 * `Input(h, { props: { value }, onUpdate }).attrs({ name: "email", type: "email" })`.
 * In a field, pass `element: field.control(h.input)`.
 */
export const Input = <Msg, R = never>(
  h: { readonly input: InputElement<Msg> },
  options: {
    readonly size?: InputSize | undefined
    readonly class?: string | undefined
    readonly element?: InputElement<Msg, R> | undefined
    readonly props: InputProps
    readonly onUpdate?: ((event: { readonly value: string }) => NoInfer<Msg> | undefined) | undefined
  }
): InputElement<Msg, R> =>
  KitInput<Msg, R>(h, { element: options.element, props: options.props, onUpdate: options.onUpdate }).class(
    inputVariants(options)
  )

/**
 * Draws the border around an input and what sits beside it: an `InputIcon`,
 * an `InputAddon` or an `InputAction`. The input inside loses its own border.
 */
export const InputGroup = <Msg>(h: Html.H<Msg>, options: ClassOption = {}) =>
  h.div.class(
    cn(
      "flex h-8.5 w-full items-center rounded-md border border-input bg-background shadow-sm",
      "transition-[border-color,box-shadow] duration-150 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20",
      "has-[input[aria-invalid=true]]:border-destructive has-[input[data-disabled]]:opacity-50",
      "[&>input]:h-full [&>input]:flex-1 [&>input]:border-0 [&>input]:bg-transparent [&>input]:shadow-none [&>input]:focus-visible:ring-0",
      options.class
    )
  )

/** A leading icon. Draw an SVG inside it. */
export const InputIcon = <Msg>(h: Html.H<Msg>, options: ClassOption = {}) =>
  h.span
    .class(cn("ml-2.5 inline-flex shrink-0 text-muted-foreground [&_svg]:size-[15px] [&+input]:pl-2", options.class))
    .attr("aria-hidden", "true")

/** A muted block of text at either end: a protocol, a unit, a currency. */
export const InputAddon = <Msg>(h: Html.H<Msg>, options: ClassOption = {}) =>
  h.span.class(
    cn(
      "inline-flex shrink-0 items-center self-stretch bg-muted px-2.5 text-[13px] whitespace-nowrap text-muted-foreground",
      "first:rounded-l-[calc(var(--radius-md)-1px)] first:border-r first:border-input",
      "last:rounded-r-[calc(var(--radius-md)-1px)] last:border-l last:border-input",
      options.class
    )
  )

/** A small button inside the group, such as one that reveals a password. Give it an `aria-label`. */
export const InputAction = <Msg>(h: Html.H<Msg>, options: ClassOption = {}) =>
  h.button
    .class(
      cn(
        "mr-1 inline-flex size-6.5 shrink-0 items-center justify-center rounded-sm text-muted-foreground",
        "transition-colors duration-150 hover:bg-accent hover:text-foreground [&_svg]:size-[15px]",
        options.class
      )
    )
    .attr("type", "button")
