import type { Renderer } from "@effect/ui"
import { BrowserRouter } from "@effect/ui/html"
import { Effect } from "effect"
import { boot, platformLayer } from "./bootstrap.ts"
import { installLinkPrefetch, installPreloadErrorReload } from "./prefetch.ts"
import { AppRoute } from "./routes.ts"
import "./styles.css"

installPreloadErrorReload(window)
installLinkPrefetch(document)

const container = document.getElementById("app")
if (container === null) throw new Error("#app not found")

const stateElement = document.getElementById("state")
// The server's `serializeState` output is exactly what `hydrateEffect` takes.
const state: Renderer.State | undefined = stateElement?.textContent ? JSON.parse(stateElement.textContent) : undefined

Effect.runFork(
  boot({ container, location: window.location.pathname + window.location.search, state }).pipe(
    // Keep the app (and its scope) alive for the life of the page...
    Effect.andThen(Effect.never),
    Effect.scoped,
    // ...and the Router/HTTP layers outside it, so their document listeners stay installed.
    Effect.provide(platformLayer(BrowserRouter.layer({ routes: AppRoute })))
  )
)
