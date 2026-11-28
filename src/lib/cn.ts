import { twMerge } from "tailwind-merge"

/** Joins class names, drops the falsy ones, and lets a later Tailwind class win over an earlier one. */
export const cn = (...classes: ReadonlyArray<string | false | null | undefined>): string =>
  twMerge(classes.filter(Boolean).join(" "))
