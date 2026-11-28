import type { Component } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import type { Form } from "@effect/ui-kit"
import { cn } from "#lib/cn"

/** What the kit's `Form` hands its `view` closure. */
export type FormParts = Component.Headless.Parts<typeof Form>

interface ClassOption {
  readonly class?: string | undefined
}

/** The `<form>`: a column of fields. After a submit it focuses its first invalid control. */
export const FormRoot = <Msg>(h: Html.H<Msg>, form: FormParts, options: ClassOption = {}) =>
  form.root(h.form.class(cn("flex w-full max-w-90 flex-col gap-4", options.class)))

/** The row for the submit button and a `FormStatus`. */
export const FormActions = <Msg>(h: Html.H<Msg>, options: ClassOption = {}) =>
  h.div.class(cn("flex items-center gap-3 pt-1", options.class))

/** A polite note beside the submit button, such as "Saved". */
export const FormStatus = <Msg>(h: Html.H<Msg>, options: ClassOption = {}) =>
  h.span.class(cn("text-xs text-muted-foreground", options.class)).attr("role", "status")
