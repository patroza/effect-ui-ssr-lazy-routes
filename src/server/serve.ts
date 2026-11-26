import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"
import * as Assets from "./assets.ts"
import * as Server from "./handler.ts"

/**
 * Production entry, built to `dist/server/serve.js` (`pnpm build:server`).
 * It reads the client build's manifest once at startup.
 */
const clientDir = fileURLToPath(new URL("../client", import.meta.url))
const manifest = Assets.parseManifest(readFileSync(`${clientDir}/.vite/manifest.json`, "utf8"))

const handler = Server.createAppHandler({
  clientDir,
  assetsFor: (route) => Assets.resolveRouteAssets(manifest, route._tag)
})

const port = Number(process.env["PORT"] ?? 3000)
const server = createServer(handler)
server.listen(port, () => {
  const address = server.address()
  const actual = typeof address === "object" && address !== null ? address.port : port
  console.log(`listening on http://localhost:${actual}`)
})

const shutdown = () => server.close(() => process.exit(0))
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
