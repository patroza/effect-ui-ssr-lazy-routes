// Dev server: Vite in middleware mode (HMR, on-demand modules) + the same SSR
// handler production uses, loaded through Vite so edits apply without restart.
import { createServer as createHttpServer } from "node:http"
import { createServer as createViteServer } from "vite"

const port = Number(process.env.PORT ?? 5173)
const vite = await createViteServer({ server: { middlewareMode: true }, appType: "custom" })

const server = createHttpServer((req, res) => {
  vite.middlewares(req, res, async () => {
    try {
      const [{ createAppHandler }, { devAssets }] = await Promise.all([
        vite.ssrLoadModule("/src/server.ts"),
        vite.ssrLoadModule("/src/assets.ts")
      ])
      await createAppHandler({ assetsFor: () => devAssets })(req, res)
    } catch (error) {
      if (error instanceof Error) vite.ssrFixStacktrace(error)
      console.error(error)
      res.statusCode = 500
      res.end("Internal Server Error")
    }
  })
})

server.listen(port, () => console.log(`dev server on http://localhost:${port}`))

const shutdown = () => void vite.close().then(() => process.exit(0))
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
