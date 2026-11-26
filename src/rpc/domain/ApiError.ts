import { Schema } from "effect"

/**
 * Typed domain error returned by RPC procedures that can fail with a
 * server-side error (such as `bookmarkProduct` on an unknown product id).
 */
export class ApiError extends Schema.TaggedError<ApiError, { readonly brand: unique symbol }>()("ApiError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect())
}) {}
