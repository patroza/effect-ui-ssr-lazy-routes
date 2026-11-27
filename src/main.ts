import { BrowserRouter } from "@effect/ui/html"
import { DevTools } from "@effect/ui-devtools"
import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { RpcSerialization } from "effect/rpc"
import * as Bootstrap from "./browser/bootstrap.ts"
import * as DevStyles from "./browser/devStyles.ts"
import * as State from "./browser/state.ts"
import * as I18n from "./i18n/I18n.ts"
import * as Routes from "./routes.ts"
import "./index.css"

if (import.meta.env.DEV) {
  DevStyles.removeSupersededDevStylesheets(document)
}

const container = document.getElementById("app")
if (container === null) throw new Error("#app not found")

const locale = I18n.parseLocale(document.documentElement.lang)
const bcp47 = I18n.configForLocale(locale).bcp47

// The server's `serializeState` output is exactly what `hydrateEffect` takes. If it is unreadable, the
// page is still usable: warn and mount the app fresh instead of leaving the server HTML dead.
const readState = Effect.try(() => State.readState(document.getElementById("state")?.textContent)).pipe(
  Effect.catch((error) =>
    Effect.logWarning("Could not read the server state; mounting fresh instead of hydrating", error).pipe(
      Effect.as(undefined)
    )
  )
)

// Dev-only inspector overlay + Time Travel (tree-shaken to 0 bytes in production builds).
const devToolsLayer = import.meta.env.DEV ? DevTools.layer({ position: "BottomRight" }) : Layer.empty

// Browser HTTP client (sending Accept-Language for server-localized errors) + JSON RPC serialization.
const localizedHttpClientLayer = Layer.effect(
  HttpClient.HttpClient,
  Effect.map(HttpClient.HttpClient, HttpClient.mapRequest(HttpClientRequest.setHeader("accept-language", bcp47)))
).pipe(Layer.provide(FetchHttpClient.layer))

const rpcTransportLayer = Layer.mergeAll(localizedHttpClientLayer, RpcSerialization.layerJson)

Effect.runFork(
  readState.pipe(
    Effect.flatMap((state) =>
      Bootstrap.boot({ container, location: window.location.pathname + window.location.search, state, locale })
    ),
    Effect.tap(() =>
      Effect.sync(() => {
        if (import.meta.env.DEV) {
          DevStyles.removeSupersededDevStylesheets(document)
        }
        container.setAttribute("data-hydrated", "true")
      })
    ),
    // Keep the app (and its scope, which owns the document listeners) alive for the life of the page...
    Effect.andThen(Effect.never),
    Effect.scoped,
    // ...and the Router/HTTP/DevTools layers outside it, so their listeners and transport stay installed.
    Effect.provide(Layer.mergeAll(BrowserRouter.layer({ routes: Routes.AppRoute }), rpcTransportLayer, devToolsLayer)),
    Effect.tapCause((cause) => Effect.logError("Failed to boot app", cause))
  )
)
