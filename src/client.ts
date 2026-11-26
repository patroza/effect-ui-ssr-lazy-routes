import { BrowserRouter } from "@effect/ui/html"
import { Effect } from "effect"
import * as Bootstrap from "./bootstrap.ts"
import * as Routes from "./routes.ts"
import * as State from "./state.ts"
import "./styles.css"

const container = document.getElementById("app")
if (container === null) throw new Error("#app not found")

// The server's `serializeState` output is exactly what `hydrateEffect` takes.
const state = State.readState(document.getElementById("state")?.textContent)

Effect.runFork(
  Bootstrap.boot({ container, location: window.location.pathname + window.location.search, state }).pipe(
    // Keep the app (and its scope, which owns the document listeners) alive for the life of the page...
    Effect.andThen(Effect.never),
    Effect.scoped,
    // ...and the Router/HTTP layers outside it, so their document listeners stay installed.
    Effect.provide(Bootstrap.platformLayer(BrowserRouter.layer({ routes: Routes.AppRoute })))
  )
)
