/**
 * Tailwind class recipes shared by the shell and the pages. They are plain
 * string literals, so Tailwind finds every class by scanning the source, and
 * the neutral palette follows the OS light/dark setting (no JavaScript).
 */
const focus =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 dark:focus-visible:outline-sky-400"

const control =
  "rounded-md border border-neutral-300 bg-white text-sm text-neutral-900 shadow-xs dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"

export const ui = {
  link: `rounded-xs font-medium text-sky-700 underline-offset-4 hover:underline dark:text-sky-400 ${focus}`,
  navLink: `rounded-md px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 aria-[current=page]:bg-neutral-900 aria-[current=page]:text-white dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 dark:aria-[current=page]:bg-neutral-100 dark:aria-[current=page]:text-neutral-900 ${focus}`,
  button: `inline-flex cursor-pointer items-center justify-center gap-1 px-3 py-1.5 font-medium hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-neutral-900 aria-pressed:bg-neutral-900 aria-pressed:text-white dark:hover:bg-neutral-800 dark:aria-pressed:border-neutral-100 dark:aria-pressed:bg-neutral-100 dark:aria-pressed:text-neutral-900 ${control} ${focus}`,
  input: `w-full px-3 py-2 placeholder:text-neutral-400 ${control} ${focus}`,
  card: "rounded-lg border border-neutral-200 p-4 dark:border-neutral-800",
  title: "text-2xl font-semibold tracking-tight",
  muted: "text-sm text-neutral-600 dark:text-neutral-400",
  stack: "flex flex-col gap-4",
  row: "flex flex-wrap items-center gap-2",
  dialogBackdrop:
    "fixed inset-0 bg-black/40 transition-opacity data-starting-style:opacity-0 data-ending-style:opacity-0",
  dialogViewport: "fixed inset-0 grid place-items-center p-4",
  dialogPopup:
    "w-full max-w-md rounded-lg border border-neutral-200 bg-white p-5 shadow-xl transition-all data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0 dark:border-neutral-800 dark:bg-neutral-900"
} as const
