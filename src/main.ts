import { BrowserRouter } from "@effect/ui/html"
import { Effect } from "effect"
import * as Bootstrap from "./browser/bootstrap.ts"
import * as Routes from "./routes.ts"
import * as State from "./browser/state.ts"
import "./index.css"

const container = document.getElementById("app")
if (container === null) throw new Error("#app not found")

// The server's `serializeState` output is exactly what `hydrateEffect` takes. If it is unreadable, the
// page is still usable: warn and mount the app fresh instead of leaving the server HTML dead.
const readState = Effect.try(() => State.readState(document.getElementById("state")?.textContent)).pipe(
  Effect.catch((error) =>
    Effect.logWarning("Could not read the server state; mounting fresh instead of hydrating", error).pipe(
      Effect.as(undefined)
    )
  )
)

Effect.runFork(
  readState.pipe(
    Effect.flatMap((state) =>
      Bootstrap.boot({ container, location: window.location.pathname + window.location.search, state })
    ),
    // Keep the app (and its scope, which owns the document listeners) alive for the life of the page...
    Effect.andThen(Effect.never),
    Effect.scoped,
    // ...and the Router/HTTP layers outside it, so their document listeners stay installed.
    Effect.provide(Bootstrap.platformLayer(BrowserRouter.layer({ routes: Routes.AppRoute })))
  )
)
