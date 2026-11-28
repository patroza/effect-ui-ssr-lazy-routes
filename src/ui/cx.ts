/** Joins optional CSS class fragments, dropping falsy entries. */
export const cx = (...classes: ReadonlyArray<string | false | null | undefined>): string =>
  classes.filter(Boolean).join(" ")
