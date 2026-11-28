import { Command } from "@effect/ui"
import { Effect, Layer, Schema, Stream } from "effect"
import { RpcClient, type RpcClientError } from "effect/rpc"
import * as ApiError from "../../rpc/domain/ApiError.ts"
import * as CommandTrace from "../../workflow/CommandTrace.ts"
import * as Warehouse from "../domain/Warehouse.ts"
import * as WarehouseRpcs from "../domain/WarehouseRpcs.ts"
import * as GetWarehouseCarts from "../queries/GetWarehouseCarts.ts"

const mapFailure = (
  err: Warehouse.WarehouseDomainError | RpcClientError.RpcClientError,
  failureSpan: CommandTrace.SpanPointer | null
): Warehouse.WarehouseCommandFailure =>
  err._tag === "RpcClientError"
    ? new Warehouse.WarehouseCommandFailure({
        error: new ApiError.ApiError({ message: err.message }),
        transportMessage: err.message,
        failureSpan
      })
    : new Warehouse.WarehouseCommandFailure({
        error: err,
        transportMessage: null,
        failureSpan
      })

const wrapWarehouseRpc = <A>(
  effect: Effect.Effect<A, Warehouse.WarehouseDomainError | RpcClientError.RpcClientError>,
  parentSpan: CommandTrace.SpanPointer | null,
  phase: string
): Effect.Effect<
  { readonly value: A; readonly span: CommandTrace.SpanPointer | null },
  Warehouse.WarehouseCommandFailure
> =>
  CommandTrace.withWorkflowSpan(
    phase,
    parentSpan
  )(
    CommandTrace.captureCommandOutcome(effect).pipe(
      Effect.catch((err) =>
        Effect.flatMap(CommandTrace.captureSpanPointer, (failureSpan) => Effect.fail(mapFailure(err, failureSpan)))
      )
    )
  )

/** Unblocks a cart with an instant optimistic cache patch and `GetWarehouseCarts` invalidation. */
export class UnblockCart extends Command.Service<UnblockCart>()("warehouse/UnblockCart", {
  args: {
    cartId: Schema.String,
    simulateConflict: Schema.Boolean,
    simulateExpired: Schema.Boolean,
    parentSpan: Schema.NullOr(CommandTrace.SpanPointer)
  },
  group: ["cartId"],
  mode: "switch",
  success: Schema.Struct({
    value: Warehouse.WarehouseCart,
    span: Schema.NullOr(CommandTrace.SpanPointer)
  }),
  error: Warehouse.WarehouseCommandFailure,
  optimistic: ({ cartId }) => [
    GetWarehouseCarts.GetWarehouseCarts.patch({}, (carts) =>
      carts.map((cart) =>
        cart.id === cartId ? { ...cart, status: "Free" as const, blockReason: null, blockNote: null } : cart
      )
    )
  ],
  invalidates: () => [GetWarehouseCarts.GetWarehouseCarts]
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(WarehouseRpcs.WarehouseRpcs)
      return ({ cartId, simulateConflict, simulateExpired, parentSpan }) =>
        wrapWarehouseRpc(
          client.unblockCart({ cartId, simulateConflict, simulateExpired }),
          parentSpan,
          "warehouse.unblock"
        )
    })
  ).pipe(Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc/warehouse" })))
}

/** Blocks a cart from a modal `SchemaForm` payload. */
export class BlockCart extends Command.Service<BlockCart>()("warehouse/BlockCart", {
  args: {
    cartId: Schema.String,
    reason: Warehouse.BlockReason,
    note: Schema.String,
    simulateExpired: Schema.Boolean,
    parentSpan: Schema.NullOr(CommandTrace.SpanPointer)
  },
  group: ["cartId"],
  mode: "switch",
  success: Schema.Struct({
    value: Warehouse.WarehouseCart,
    span: Schema.NullOr(CommandTrace.SpanPointer)
  }),
  error: Warehouse.WarehouseCommandFailure,
  invalidates: () => [GetWarehouseCarts.GetWarehouseCarts]
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(WarehouseRpcs.WarehouseRpcs)
      return ({ cartId, reason, note, simulateExpired, parentSpan }) =>
        wrapWarehouseRpc(client.blockCart({ cartId, reason, note, simulateExpired }), parentSpan, "warehouse.block")
    })
  ).pipe(Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc/warehouse" })))
}

/** Checks cart eligibility before opening the Release `AlertDialog`, capturing an OTel `SpanPointer`. */
export class PreflightReleaseCart extends Command.Service<PreflightReleaseCart>()("warehouse/PreflightReleaseCart", {
  args: {
    cartId: Schema.String,
    simulateExpired: Schema.Boolean,
    parentSpan: Schema.NullOr(CommandTrace.SpanPointer)
  },
  group: ["cartId"],
  mode: "switch",
  success: Schema.Struct({
    value: Warehouse.PreflightReleaseResult,
    span: Schema.NullOr(CommandTrace.SpanPointer)
  }),
  error: Warehouse.WarehouseCommandFailure
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(WarehouseRpcs.WarehouseRpcs)
      return ({ cartId, simulateExpired, parentSpan }) =>
        wrapWarehouseRpc(
          client.preflightReleaseCart({ cartId, simulateExpired }),
          parentSpan,
          "warehouse.release_preflight"
        )
    })
  ).pipe(Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc/warehouse" })))
}

/** Commits cart release after the user confirms the `AlertDialog`, parented to the preflight `SpanPointer`. */
export class ReleaseCart extends Command.Service<ReleaseCart>()("warehouse/ReleaseCart", {
  args: {
    cartId: Schema.String,
    simulateExpired: Schema.Boolean,
    parentSpan: Schema.NullOr(CommandTrace.SpanPointer)
  },
  group: ["cartId"],
  mode: "switch",
  success: Schema.Struct({
    value: Warehouse.ReleaseCartResult,
    span: Schema.NullOr(CommandTrace.SpanPointer)
  }),
  error: Warehouse.WarehouseCommandFailure,
  invalidates: () => [GetWarehouseCarts.GetWarehouseCarts]
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(WarehouseRpcs.WarehouseRpcs)
      return ({ cartId, simulateExpired, parentSpan }) =>
        wrapWarehouseRpc(client.releaseCart({ cartId, simulateExpired }), parentSpan, "warehouse.release_execute")
    })
  ).pipe(Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc/warehouse" })))
}

/** Preflights dispatch warnings and captures an OTel `SpanPointer` before opening `AlertDialog`/`Dialog`. */
export class PreflightDispatchCart extends Command.Service<PreflightDispatchCart>()("warehouse/PreflightDispatchCart", {
  args: {
    cartId: Schema.String,
    simulateConflict: Schema.Boolean,
    simulateExpired: Schema.Boolean,
    parentSpan: Schema.NullOr(CommandTrace.SpanPointer)
  },
  group: ["cartId"],
  mode: "switch",
  success: Schema.Struct({
    value: Warehouse.PreflightDispatchResult,
    span: Schema.NullOr(CommandTrace.SpanPointer)
  }),
  error: Warehouse.WarehouseCommandFailure
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(WarehouseRpcs.WarehouseRpcs)
      return ({ cartId, simulateConflict, simulateExpired, parentSpan }) =>
        wrapWarehouseRpc(
          client.preflightDispatchCart({ cartId, simulateConflict, simulateExpired }),
          parentSpan,
          "warehouse.dispatch_preflight"
        )
    })
  ).pipe(Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc/warehouse" })))
}

const dispatchSteps: ReadonlyArray<{ readonly index: number; readonly step: Warehouse.DispatchStepKey }> = [
  { index: 0, step: "validate" },
  { index: 1, step: "reserve" },
  { index: 2, step: "print" },
  { index: 3, step: "erp" }
]

/**
 * Multi-step `stream: true` Command executing the 4 dispatch stages over RPC
 * under one unified `warehouse.dispatch_execute` span parented to `parentSpan`.
 * Supports mid-stream cancellation via `Command.interrupt(DispatchCartBatch, { cartId })`.
 */
export class DispatchCartBatch extends Command.Service<DispatchCartBatch>()("warehouse/DispatchCartBatch", {
  args: {
    cartId: Schema.String,
    auditNote: Schema.String,
    simulateExpired: Schema.Boolean,
    parentSpan: Schema.NullOr(CommandTrace.SpanPointer)
  },
  group: ["cartId"],
  mode: "switch",
  stream: true,
  success: Schema.Struct({
    value: Warehouse.DispatchStepResult,
    span: Schema.NullOr(CommandTrace.SpanPointer)
  }),
  error: Warehouse.WarehouseCommandFailure,
  invalidates: () => [GetWarehouseCarts.GetWarehouseCarts]
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(WarehouseRpcs.WarehouseRpcs)
      return ({ cartId, auditNote, simulateExpired, parentSpan }) =>
        Stream.fromIterable(dispatchSteps).pipe(
          Stream.mapEffect(({ index, step }) =>
            wrapWarehouseRpc(
              Effect.gen(function* () {
                if (index > 0) yield* Effect.sleep("120 millis")
                return yield* client.dispatchCartStep({ cartId, step, auditNote, simulateExpired })
              }),
              null,
              `warehouse.dispatch_step.${step}`
            )
          ),
          CommandTrace.withWorkflowSpanStream("warehouse.dispatch_execute", parentSpan)
        )
    })
  ).pipe(Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc/warehouse" })))
}

/** Renews the warehouse operator session under the paused workflow's `traceId` before replay. */
export class RefreshSession extends Command.Service<RefreshSession>()("warehouse/RefreshSession", {
  args: {
    parentSpan: Schema.NullOr(CommandTrace.SpanPointer)
  },
  success: Schema.Struct({
    value: Schema.Struct({ renewed: Schema.Boolean }),
    span: Schema.NullOr(CommandTrace.SpanPointer)
  }),
  error: Warehouse.WarehouseCommandFailure
}) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const client = yield* RpcClient.make(WarehouseRpcs.WarehouseRpcs)
      return ({ parentSpan }) => wrapWarehouseRpc(client.refreshSession(), parentSpan, "warehouse.session_refresh")
    })
  ).pipe(Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc/warehouse" })))
}

export const WarehouseCommandsLayer = Layer.mergeAll(
  UnblockCart.layer,
  BlockCart.layer,
  PreflightReleaseCart.layer,
  ReleaseCart.layer,
  PreflightDispatchCart.layer,
  DispatchCartBatch.layer,
  RefreshSession.layer
)
