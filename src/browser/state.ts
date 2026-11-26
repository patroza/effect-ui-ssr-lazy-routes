import type { Renderer } from "@effect/ui"
import { Schema } from "effect"
import * as JsonString from "../lib/jsonString.ts"

// `#state` holds the JSON that `HtmlServer.serializeState` wrote: an object keyed by instance path
// (plus the `~query` cache entries and friends).
const StateFromJson = JsonString.jsonString(Schema.Record(Schema.String, Schema.Unknown))

/**
 * Decodes the server's serialized state, or `undefined` when nothing was
 * server-rendered. Malformed JSON, or JSON that isn't an object, throws a
 * Schema error instead of hydrating from garbage (`main.ts` catches it and
 * mounts fresh).
 */
export const readState = (text: string | null | undefined): Renderer.State | undefined =>
  text === null || text === undefined || text === "" ? undefined : Schema.decodeSync(StateFromJson)(text)
