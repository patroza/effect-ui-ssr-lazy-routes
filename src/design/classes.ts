/**
 * Tailwind class recipes shared by the shell and the pages. They are plain
 * string literals, so Tailwind finds every class by scanning the source, and
 * the neutral palette follows the OS light/dark setting (no JavaScript).
 */
const focus =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:focus-visible:outline-sky-400"

const control =
  "rounded-md border border-neutral-300 bg-white text-sm text-neutral-900 shadow-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"

const buttonBase = `inline-flex cursor-pointer items-center justify-center gap-1 rounded-md border px-3 py-1.5 text-sm font-medium shadow-xs disabled:cursor-not-allowed disabled:opacity-50 ${focus}`

const cardBase = "rounded-lg border p-4"

export const ui = {
  link: `rounded-xs font-medium text-sky-700 underline-offset-4 hover:underline dark:text-sky-400 ${focus}`,
  navLink: `rounded-md px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 aria-[current=page]:bg-neutral-900 aria-[current=page]:text-white dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 dark:aria-[current=page]:bg-neutral-100 dark:aria-[current=page]:text-neutral-900 ${focus}`,
  button: `${buttonBase} border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100 aria-pressed:border-neutral-900 aria-pressed:bg-neutral-900 aria-pressed:text-white dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800 dark:aria-pressed:border-neutral-100 dark:aria-pressed:bg-neutral-100 dark:aria-pressed:text-neutral-900`,
  buttonPrimary: `${buttonBase} border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200`,
  buttonDanger: `${buttonBase} border-red-300 bg-white text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-neutral-900 dark:text-red-300 dark:hover:bg-red-950/50`,
  input: `w-full px-3 py-2 placeholder:text-neutral-400 ${control} ${focus}`,
  cardBase,
  card: `${cardBase} border-neutral-200 dark:border-neutral-800`,
  cardError: `${cardBase} border-red-300 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30`,
  cardWarning: `${cardBase} border-amber-300 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/30`,
  cardSuccess: `${cardBase} border-emerald-300 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/30`,
  cardInfo: `${cardBase} border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/20`,
  title: "text-2xl font-semibold tracking-tight",
  muted: "text-sm text-neutral-600 dark:text-neutral-400",
  stack: "flex flex-col gap-4",
  row: "flex flex-wrap items-center gap-2"
} as const
