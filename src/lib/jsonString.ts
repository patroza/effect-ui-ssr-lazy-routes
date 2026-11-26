import { Schema } from "effect"

type JsonStringOptions = Parameters<typeof Schema.fromJsonString>[1]

/**
 * The one way this app decodes or encodes JSON text: `schema`'s JSON codec
 * (`Schema.toCodecJson`) behind `Schema.fromJsonString`. Use it instead of
 * calling `Schema.fromJsonString` directly.
 */
export const jsonString = <S extends Schema.Top>(schema: S, options?: JsonStringOptions) =>
  Schema.fromJsonString(Schema.toCodecJson(schema), options)
