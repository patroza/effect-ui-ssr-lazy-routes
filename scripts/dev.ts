// Dev server: Vite in middleware mode (HMR, on-demand modules) + the same Effect
// HTTP + RPC + SSR handler production uses, loaded through Vite so edits apply without restart.
import { createServer as createHttpServer, type Server as HttpServer } from "node:http"
import { createServer as createViteServer, createServerModuleRunner, type ViteDevServer } from "vite-plus"
import type * as Assets from "../src/server/assets.ts"
import type * as Handler from "../src/server/handler.ts"
import { parseAppPort, resolveDevToolsPort } from "./lib/dev-ports.ts"

const listenHttpServer = (server: HttpServer, port: number): Promise<number> =>
  new Promise((resolve, reject) => {
    function onError(error: Error) {
      server.off("listening", onListening)
      reject(error)
    }
    function onListening() {
      server.off("error", onError)
      const address = server.address()
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("Could not determine bound dev server port")))
        return
      }
      resolve(address.port)
    }
    server.once("error", onError)
    server.once("listening", onListening)
    server.listen(port)
  })

const closeHttpServer = (server: HttpServer): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => resolve())
  })

const requestedPort = parseAppPort(process.env["PORT"])
const server = createHttpServer()
const actualPort = await listenHttpServer(server, requestedPort)

let vite: ViteDevServer
try {
  const devToolsPort = await resolveDevToolsPort({
    actualAppPort: actualPort,
    appPortEnv: process.env["PORT"],
    devToolsPortEnv: process.env["DEVTOOLS_PORT"]
  })
  process.env["DEVTOOLS_PORT"] = String(devToolsPort)

  vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: "custom"
  })
} catch (error) {
  await closeHttpServer(server)
  throw error
}

// Loads modules through Vite's SSR environment, so edits apply without restarting.
const runner = createServerModuleRunner(vite.environments.ssr)

let currentHandlerModule: typeof Handler | undefined
let currentAppServer: Promise<Handler.ManagedNodeHandler> | undefined

const getAppServer = async (): Promise<Handler.ManagedNodeHandler> => {
  const [handlerModule, { devAssets }] = await Promise.all([
    runner.import<typeof Handler>("/src/server/handler.ts"),
    runner.import<typeof Assets>("/src/server/assets.ts")
  ])
  if (currentAppServer === undefined || currentHandlerModule !== handlerModule) {
    const previous = currentAppServer
    currentHandlerModule = handlerModule
    currentAppServer = handlerModule.createAppServer({
      assetsFor: () => devAssets,
      transformHtml: (url, html) => vite.transformIndexHtml(url, html)
    })
    if (previous !== undefined) {
      void previous.then((app) => app.dispose()).catch(() => undefined)
    }
  }
  return currentAppServer
}

server.on("request", (req, res) => {
  vite.middlewares(req, res, async () => {
    try {
      const app = await getAppServer()
      app.handler(req, res)
    } catch (error) {
      if (error instanceof Error) vite.ssrFixStacktrace(error)
      console.error(error)
      res.statusCode = 500
      res.end("Internal Server Error")
    }
  })
})

console.log(`dev server on http://localhost:${actualPort}`)

const shutdown = () => {
  void Promise.all([
    currentAppServer?.then((app) => app.dispose()).catch(() => undefined),
    vite.close(),
    closeHttpServer(server)
  ]).then(() => process.exit(0))
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
