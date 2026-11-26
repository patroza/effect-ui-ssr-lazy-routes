import { BrowserRouter } from "@effect/ui/html"
import { Effect } from "effect"
import { boot, platformLayer } from "./bootstrap.ts"
import { AppRoute } from "./routes.ts"
import { readState } from "./state.ts"
import "./styles.css"

const container = document.getElementById("app")
if (container === null) throw new Error("#app not found")

// The server's `serializeState` output is exactly what `hydrateEffect` takes.
const state = readState(document.getElementById("state")?.textContent)

Effect.runFork(
  boot({ container, location: window.location.pathname + window.location.search, state }).pipe(
    // Keep the app (and its scope, which owns the document listeners) alive for the life of the page...
    Effect.andThen(Effect.never),
    Effect.scoped,
    // ...and the Router/HTTP layers outside it, so their document listeners stay installed.
    Effect.provide(platformLayer(BrowserRouter.layer({ routes: AppRoute })))
  )
)
