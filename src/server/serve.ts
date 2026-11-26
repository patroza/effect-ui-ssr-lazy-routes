import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { HttpServer } from "effect/http"
import * as Assets from "./assets.ts"
import * as Handler from "./handler.ts"

/**
 * Production entry, built to `dist/server/serve.js` (`pnpm build:server`).
 * Serves `POST /rpc` (Effect RPC over HTTP) + SSR HTML + static assets from
 * one `NodeHttpServer` instance sharing a single server store layer.
 */
const clientDir = fileURLToPath(new URL("../client", import.meta.url))
const manifest = Assets.parseManifest(readFileSync(`${clientDir}/.vite/manifest.json`, "utf8"))
const port = Number(process.env["PORT"] ?? 3000)

const ServerLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer
    const httpEffect = yield* Handler.makeHttpAppEffect({
      clientDir,
      assetsFor: (route) => Assets.resolveRouteAssets(manifest, route._tag)
    })
    yield* server.serve(httpEffect)
    const actual =
      server.address._tag === "InetAddressV4" || server.address._tag === "InetAddressV6" ? server.address.port : port
    yield* Effect.sync(() => console.log(`listening on http://localhost:${actual}`))
  })
).pipe(Layer.provide(Handler.serverRuntimeLayer), Layer.provide(NodeHttpServer.layer(createServer, { port })))

NodeRuntime.runMain(Layer.launch(ServerLive))
