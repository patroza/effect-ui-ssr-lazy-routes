import { Effect } from "effect"
import * as StatusRpcs from "../../status/domain/StatusRpcs.ts"
import * as StatusStore from "../services/StatusStore.ts"

export const StatusHandlersLayer = StatusRpcs.StatusRpcs.toLayer(
  Effect.gen(function* () {
    const status = yield* StatusStore.StatusStore
    return {
      getStatus: ({ mode }) => status.check(mode)
    }
  })
)
