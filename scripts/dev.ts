// Dev server: Vite in middleware mode (HMR, on-demand modules) + the same Effect
// HTTP + RPC + SSR handler production uses, loaded through Vite so edits apply without restart.
import { createServer as createHttpServer } from "node:http"
import { createServer as createViteServer, createServerModuleRunner } from "vite-plus"
import type * as Assets from "../src/server/assets.ts"
import type * as Handler from "../src/server/handler.ts"

const port = Number(process.env["PORT"] ?? 5173)
const vite = await createViteServer({ server: { middlewareMode: true }, appType: "custom" })
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
    currentAppServer = handlerModule.createAppServer({ assetsFor: () => devAssets })
    if (previous !== undefined) {
      void previous.then((app) => app.dispose()).catch(() => undefined)
    }
  }
  return currentAppServer
}

const server = createHttpServer((req, res) => {
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

server.listen(port, () => console.log(`dev server on http://localhost:${port}`))

const shutdown = () => {
  void Promise.all([
    currentAppServer?.then((app) => app.dispose()).catch(() => undefined),
    vite.close(),
    new Promise<void>((resolve) => server.close(() => resolve()))
  ]).then(() => process.exit(0))
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
