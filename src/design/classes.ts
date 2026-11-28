/**
 * Tailwind class recipes backed by `effectcn` semantic CSS tokens
 * (`src/styles/tokens.css` mapped via `@theme inline` in `src/index.css`).
 * Keep this module free of `@effect/ui-kit` imports because `Shell.ts` imports it
 * in the entry chunk.
 */
const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"

const cardBase = "rounded-lg border p-4"

export const ui = {
  link: `rounded-xs font-medium text-brand underline-offset-4 hover:underline ${focus}`,
  navLink: `rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-[current=page]:bg-primary aria-[current=page]:text-primary-foreground ${focus}`,
  button: `inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3.5 py-2 text-[13px] leading-none font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50 ${focus}`,
  buttonPrimary: `inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-transparent bg-primary px-3.5 py-2 text-[13px] leading-none font-medium text-primary-foreground shadow-sm hover:bg-primary/85 disabled:cursor-not-allowed disabled:opacity-50 ${focus}`,
  buttonDanger: `inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-transparent bg-destructive px-3.5 py-2 text-[13px] leading-none font-medium text-destructive-foreground shadow-sm hover:bg-destructive/85 disabled:cursor-not-allowed disabled:opacity-50 ${focus}`,
  input: `w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] text-foreground shadow-sm placeholder:text-muted-foreground ${focus}`,
  cardBase,
  card: `${cardBase} border-border bg-card text-foreground`,
  cardError: `${cardBase} border-destructive/40 bg-destructive/10 text-destructive`,
  cardWarning: `${cardBase} border-warning/40 bg-warning/10 text-warning`,
  cardSuccess: `${cardBase} border-success/40 bg-success/10 text-success`,
  cardInfo: `${cardBase} border-brand/30 bg-brand-wash text-foreground`,
  title: "text-2xl font-semibold tracking-tight",
  muted: "text-sm text-muted-foreground",
  stack: "flex flex-col gap-4",
  row: "flex flex-wrap items-center gap-2"
} as const
