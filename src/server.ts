import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http"
import { extname, join, normalize, sep } from "node:path"
import { type PageAssets } from "./assets.ts"
import { renderPage } from "./render.ts"
import type { AppRouteValue } from "./routes.ts"

const contentTypes: Readonly<Record<string, string>> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8"
}

export interface AppHandlerOptions {
  /** Decides which assets the document loads for the matched route. */
  readonly assetsFor: (route: AppRouteValue) => PageAssets
  /** The built client directory (`dist/client`) to serve files from. Omit in dev (Vite serves them). */
  readonly clientDir?: string | undefined
}

const send = (res: ServerResponse, status: number, headers: Record<string, string>, body: string): void => {
  res.writeHead(status, { "content-length": Buffer.byteLength(body), ...headers })
  res.end(body)
}

/** Maps a request path to a file inside `clientDir`, or `undefined` if it would escape it. */
const resolveStaticFile = (clientDir: string, pathname: string): string | undefined => {
  const file = normalize(join(clientDir, decodeURIComponent(pathname)))
  const root = normalize(clientDir + sep)
  return file.startsWith(root) && !file.includes(`${sep}.vite${sep}`) ? file : undefined
}

const serveStatic = async (clientDir: string, pathname: string, req: IncomingMessage, res: ServerResponse) => {
  const file = resolveStaticFile(clientDir, pathname)
  if (file === undefined) return false
  const info = await stat(file).catch(() => undefined)
  if (info === undefined || !info.isFile()) return false
  res.writeHead(200, {
    "content-type": contentTypes[extname(file)] ?? "application/octet-stream",
    "content-length": info.size,
    // Everything under /assets is content-hashed, so it can be cached forever.
    "cache-control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache"
  })
  if (req.method === "HEAD") res.end()
  else createReadStream(file).pipe(res)
  return true
}

/** A plain Node request listener: static files first, then server-rendered pages. */
export const createAppHandler =
  (options: AppHandlerOptions): RequestListener =>
  async (req, res) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        return send(res, 405, { allow: "GET, HEAD", "content-type": "text/plain" }, "Method Not Allowed")
      }
      const url = new URL(req.url ?? "/", "http://localhost")
      if (url.pathname === "/favicon.ico") return void res.writeHead(204).end()
      if (options.clientDir !== undefined && (await serveStatic(options.clientDir, url.pathname, req, res))) return

      const page = await renderPage(url.pathname + url.search, options.assetsFor)
      send(
        res,
        page.status,
        { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" },
        req.method === "HEAD" ? "" : page.html
      )
    } catch (error) {
      console.error(error)
      send(res, 500, { "content-type": "text/plain" }, "Internal Server Error")
    }
  }
