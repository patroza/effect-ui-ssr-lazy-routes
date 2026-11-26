import type * as Renderer from "@effect/ui/Renderer"
import * as Schema from "effect/Schema"

// `#state` holds the JSON that `HtmlServer.serializeState` wrote: an object keyed by instance path
// (plus the `~query` cache entries and friends).
const StateFromJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))

/**
 * Decodes the server's serialized state, or `undefined` when nothing was
 * server-rendered. Malformed JSON, or JSON that isn't an object, throws a
 * Schema error instead of hydrating from garbage.
 */
export const readState = (text: string | null | undefined): Renderer.State | undefined =>
  text === null || text === undefined || text === "" ? undefined : Schema.decodeSync(StateFromJson)(text)
