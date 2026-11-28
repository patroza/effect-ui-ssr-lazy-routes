import type { Component } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import type { Tabs } from "@effect/ui-kit"
import { cn } from "#lib/cn"

/** What the `view` closure of the kit's `Tabs` receives. */
export type TabsParts = Component.Headless.Parts<typeof Tabs>

export type TabsVariant = keyof typeof lists

interface ClassOption {
  readonly class?: string | undefined
}

const lists = {
  underline: "gap-1 data-[orientation=horizontal]:border-b data-[orientation=vertical]:w-44",
  segmented: "w-fit gap-0.5 rounded-md bg-muted p-[3px] data-[orientation=vertical]:w-44"
} as const

const tab =
  "relative z-10 inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-sm px-3 " +
  "text-[13px] font-medium whitespace-nowrap text-muted-foreground no-underline outline-offset-0 select-none " +
  "transition-colors duration-150 hover:text-foreground data-[active]:text-foreground " +
  "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[disabled]:hover:text-muted-foreground " +
  "data-[orientation=vertical]:justify-start [&_svg]:size-3.5 [&_svg]:shrink-0 " +
  "group-data-[variant=underline]/tabs-list:h-9 group-data-[variant=segmented]/tabs-list:h-7 " +
  "group-data-[variant=underline]/tabs-list:data-[orientation=vertical]:h-8 " +
  "group-data-[fill]/tabs-list:flex-1"

/** Around the list and the panels. A vertical root puts the list beside the panels. */
export const TabsRoot = <Msg>(h: Html.H<Msg>, tabs: TabsParts, options: ClassOption = {}) =>
  tabs.root(
    h.div.class(
      cn("flex w-full gap-4 data-[orientation=horizontal]:flex-col data-[orientation=vertical]:gap-6", options.class)
    )
  )

/**
 * The row or column of tabs. `underline` draws a line under the active tab,
 * `segmented` a raised pill behind it; a vertical list always fills the
 * active tab's background. `fill` stretches the tabs over the list's width.
 */
export const TabsList = <Msg>(
  h: Html.H<Msg>,
  tabs: TabsParts,
  options: ClassOption & {
    readonly variant?: TabsVariant | undefined
    readonly fill?: boolean | undefined
  } = {}
) =>
  tabs.list(
    h.div
      .attrs({ "data-variant": options.variant ?? "underline", "data-fill": options.fill === true ? "" : undefined })
      .class(
        cn(
          "group/tabs-list relative isolate flex shrink-0 data-[orientation=vertical]:flex-col",
          "data-[fill]:w-full",
          lists[options.variant ?? "underline"],
          options.class
        )
      )
  )

/** One tab, a button. */
export const TabsTab = <Msg>(h: Html.H<Msg>, tabs: TabsParts, options: ClassOption & { readonly value: string }) =>
  tabs.tab({ element: h.button.class(cn(tab, options.class)), value: options.value })

/**
 * One tab that is a link: a click and Enter also follow its `href`. With
 * `follow: false` the tab only activates and the address stays, for a list
 * whose panels are all on this page.
 */
export const TabsLink = <Msg>(
  h: Html.H<Msg>,
  tabs: TabsParts,
  options: ClassOption & { readonly value: string; readonly href: string; readonly follow?: boolean | undefined }
) => {
  const link = h.a.attr("href", options.href).class(cn(tab, options.class))
  return tabs.tab({
    element: options.follow === false ? link.on("click", () => undefined, { preventDefault: "always" }) : link,
    value: options.value
  })
}

/**
 * The mark that slides to the active tab, placed with the `--active-tab-*`
 * variables the kit measures. Put it inside the list. `undefined` while no tab
 * is active.
 */
export const TabsIndicator = <Msg>(h: Html.H<Msg>, tabs: TabsParts, options: ClassOption = {}) =>
  tabs.indicator(
    h.span.class(
      cn(
        "pointer-events-none absolute top-0 left-0 transition-[translate,width,height] duration-200 ease-out",
        "w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)]",
        "group-data-[variant=underline]/tabs-list:data-[orientation=horizontal]:top-auto",
        "group-data-[variant=underline]/tabs-list:data-[orientation=horizontal]:-bottom-px",
        "group-data-[variant=underline]/tabs-list:data-[orientation=horizontal]:h-0.5",
        "group-data-[variant=underline]/tabs-list:data-[orientation=horizontal]:bg-brand",
        "group-data-[variant=underline]/tabs-list:data-[orientation=vertical]:h-[var(--active-tab-height)]",
        "group-data-[variant=underline]/tabs-list:data-[orientation=vertical]:translate-y-[var(--active-tab-top)]",
        "group-data-[variant=underline]/tabs-list:data-[orientation=vertical]:rounded-sm",
        "group-data-[variant=underline]/tabs-list:data-[orientation=vertical]:bg-accent",
        "group-data-[variant=segmented]/tabs-list:h-[var(--active-tab-height)]",
        "group-data-[variant=segmented]/tabs-list:translate-y-[var(--active-tab-top)]",
        "group-data-[variant=segmented]/tabs-list:rounded-sm",
        "group-data-[variant=segmented]/tabs-list:bg-background",
        "group-data-[variant=segmented]/tabs-list:shadow-sm",
        options.class
      )
    )
  )

/** The content of one tab: `undefined` while hidden, unless it is kept mounted. Fades in. */
export const TabsPanel = <Msg>(h: Html.H<Msg>, tabs: TabsParts, options: ClassOption & { readonly value: string }) =>
  tabs.panel({
    element: h.div.class(
      cn(
        "min-w-0 flex-1 rounded-sm text-[13px] transition-opacity duration-200",
        "data-[starting-style]:opacity-0 data-[ending-style]:hidden",
        options.class
      )
    ),
    value: options.value
  })
