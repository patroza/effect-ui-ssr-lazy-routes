import { Schema } from "effect"

/**
 * Typed application/transport error returned by RPC procedures and queries/commands.
 * Shared across feature RPC groups without pulling any feature schemas into other chunks.
 */
export class ApiError extends Schema.TaggedError<ApiError, { readonly brand: unique symbol }>()("ApiError", {
  message: Schema.String
}) {}
