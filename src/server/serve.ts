import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { HttpServer } from "effect/http"
import * as Assets from "./assets.ts"
import * as Handler from "./handler.ts"
import * as HttpResponseErrorGuard from "./httpResponseErrorGuard.ts"

const parsePort = (raw: string | undefined): number => {
  if (raw === undefined || raw === "") return 3000
  if (!/^[0-9]+$/.test(raw)) {
    throw new RangeError(`Invalid PORT "${raw}": expected integer between 0 and 65535`)
  }
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new RangeError(`Invalid PORT "${raw}": expected integer between 0 and 65535`)
  }
  return parsed
}

/**
 * Production entry, built to `dist/server/serve.js` (`pnpm build:server`).
 * Serves `POST /rpc` (Effect RPC over HTTP) + SSR HTML + static assets from
 * one `NodeHttpServer` instance sharing a single server store layer.
 */
const clientDir = fileURLToPath(new URL("../client", import.meta.url))
const manifest = Assets.parseManifest(readFileSync(`${clientDir}/.vite/manifest.json`, "utf8"))
const port = parsePort(process.env["PORT"])

const ServerLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer
    const httpEffect = yield* Handler.makeHttpAppEffect({
      clientDir,
      assetsFor: (route, locale) => Assets.resolveRouteAssets(manifest, route._tag, locale)
    })
    yield* server.serve(httpEffect)
    const actual =
      server.address._tag === "InetAddressV4" || server.address._tag === "InetAddressV6" ? server.address.port : port
    yield* Effect.sync(() => process.stdout.write(`listening on http://localhost:${actual}\n`))
  })
).pipe(
  Layer.provide(Handler.serverRuntimeLayer),
  Layer.provide(
    NodeHttpServer.layer(() => HttpResponseErrorGuard.guardHttpResponseWriteErrors(createServer()), { port })
  )
)

NodeRuntime.runMain(Layer.launch(ServerLive))
