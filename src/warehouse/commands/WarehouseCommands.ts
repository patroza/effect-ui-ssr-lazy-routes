import { Command } from "@effect/ui"
import { Effect, Layer, Schema, Stream } from "effect"
import { RpcClient, type RpcClientError } from "effect/rpc"
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
        error: new Warehouse.WarehouseTransportError({ reason: "unavailable" }),
        failureSpan
      })
    : new Warehouse.WarehouseCommandFailure({
        error: err,
        failureSpan
      })

const wrapWarehouseRpc = <A>(
  effect: Effect.Effect<A, Warehouse.WarehouseDomainError | RpcClientError.RpcClientError>,
  originSpan: CommandTrace.SpanPointer | null,
  relationship: string
): Effect.Effect<
  { readonly value: A; readonly span: CommandTrace.SpanPointer | null },
  Warehouse.WarehouseCommandFailure
> =>
  CommandTrace.withOriginSpanLink(
    originSpan,
    relationship
  )(CommandTrace.captureCommandOutcome(effect)).pipe(
    Effect.map(({ value, originSpan: span }) => ({ value, span })),
    Effect.catch((err) =>
      Effect.flatMap(CommandTrace.captureSpanPointer, (failureSpan) => Effect.fail(mapFailure(err, failureSpan)))
    )
  )

/** Unblocks a cart with an instant optimistic cache patch and `GetWarehouseCarts` invalidation. */
export class UnblockCart extends Command.Service<UnblockCart>()("warehouse/UnblockCart", {
  args: {
    cartId: Schema.String,
    simulateConflict: Schema.Boolean,
    simulateExpired: Schema.Boolean,
    originSpan: Schema.NullOr(CommandTrace.SpanPointer)
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
      return ({ cartId, simulateConflict, simulateExpired, originSpan }) =>
        wrapWarehouseRpc(
          client.unblockCart({ cartId, simulateConflict, simulateExpired }),
          originSpan,
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
    originSpan: Schema.NullOr(CommandTrace.SpanPointer)
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
      return ({ cartId, reason, note, simulateExpired, originSpan }) =>
        wrapWarehouseRpc(client.blockCart({ cartId, reason, note, simulateExpired }), originSpan, "warehouse.block")
    })
  ).pipe(Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc/warehouse" })))
}

/** Checks cart eligibility before opening the Release `AlertDialog`, capturing an OTel `SpanPointer`. */
export class PreflightReleaseCart extends Command.Service<PreflightReleaseCart>()("warehouse/PreflightReleaseCart", {
  args: {
    cartId: Schema.String,
    simulateExpired: Schema.Boolean,
    originSpan: Schema.NullOr(CommandTrace.SpanPointer)
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
      return ({ cartId, simulateExpired, originSpan }) =>
        wrapWarehouseRpc(
          client.preflightReleaseCart({ cartId, simulateExpired }),
          originSpan,
          "warehouse.release_preflight"
        )
    })
  ).pipe(Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc/warehouse" })))
}

/** Commits cart release after the user confirms the `AlertDialog`, linked via `SpanLink`. */
export class ReleaseCart extends Command.Service<ReleaseCart>()("warehouse/ReleaseCart", {
  args: {
    cartId: Schema.String,
    simulateExpired: Schema.Boolean,
    originSpan: Schema.NullOr(CommandTrace.SpanPointer)
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
      return ({ cartId, simulateExpired, originSpan }) =>
        wrapWarehouseRpc(client.releaseCart({ cartId, simulateExpired }), originSpan, "warehouse.release_execute")
    })
  ).pipe(Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc/warehouse" })))
}

/** Preflights dispatch warnings and captures an OTel `SpanPointer` before opening `AlertDialog`/`Dialog`. */
export class PreflightDispatchCart extends Command.Service<PreflightDispatchCart>()("warehouse/PreflightDispatchCart", {
  args: {
    cartId: Schema.String,
    simulateConflict: Schema.Boolean,
    simulateExpired: Schema.Boolean,
    originSpan: Schema.NullOr(CommandTrace.SpanPointer)
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
      return ({ cartId, simulateConflict, simulateExpired, originSpan }) =>
        wrapWarehouseRpc(
          client.preflightDispatchCart({ cartId, simulateConflict, simulateExpired }),
          originSpan,
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
 * under a single Command span linked to `originSpan`. Supports mid-stream
 * cancellation via `Command.interrupt(DispatchCartBatch, { cartId })`.
 */
export class DispatchCartBatch extends Command.Service<DispatchCartBatch>()("warehouse/DispatchCartBatch", {
  args: {
    cartId: Schema.String,
    auditNote: Schema.String,
    simulateExpired: Schema.Boolean,
    originSpan: Schema.NullOr(CommandTrace.SpanPointer)
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
      return ({ cartId, auditNote, simulateExpired, originSpan }) =>
        Stream.fromIterable(dispatchSteps).pipe(
          Stream.mapEffect(({ index, step }) =>
            wrapWarehouseRpc(
              Effect.gen(function* () {
                if (index > 0) yield* Effect.sleep("120 millis")
                return yield* client.dispatchCartStep({ cartId, step, auditNote, simulateExpired })
              }),
              originSpan,
              "warehouse.dispatch_execute"
            )
          ),
          CommandTrace.withOriginSpanLinkStream(originSpan, "warehouse.dispatch_execute")
        )
    })
  ).pipe(Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc/warehouse" })))
}

/** Renews the warehouse operator session before replaying a paused Command. */
export class RefreshSession extends Command.Service<RefreshSession>()("warehouse/RefreshSession", {
  args: {
    originSpan: Schema.NullOr(CommandTrace.SpanPointer)
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
      return ({ originSpan }) => wrapWarehouseRpc(client.refreshSession(), originSpan, "warehouse.session_refresh")
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
