import { Schema } from "effect"

/** Marker proving which chunk this feature's schema lands in (see scripts/verify-bundles.ts). */
export const STATUS_SCHEMA_CHUNK = "SENTINEL:status-schema"

export const StatusMode = Schema.Literals(["ok", "fail-ssr", "fail-refresh"])
export type StatusMode = typeof StatusMode.Type

export const ServiceCheck = Schema.Struct({
  name: Schema.String,
  healthy: Schema.Boolean,
  latencyMs: Schema.Finite
})
export type ServiceCheck = typeof ServiceCheck.Type

export const SystemStatus = Schema.Struct({
  revision: Schema.Finite,
  mode: StatusMode,
  note: Schema.String,
  services: Schema.Array(ServiceCheck)
})
export type SystemStatus = typeof SystemStatus.Type
