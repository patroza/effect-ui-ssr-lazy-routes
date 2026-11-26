import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http"
import { extname, join, normalize, relative, sep } from "node:path"
import { pipeline } from "node:stream"
import type * as Assets from "./assets.ts"
import * as Render from "./render.ts"
import type * as Routes from "../routes.ts"

const contentTypes: Readonly<Record<string, string>> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8"
}

/**
 * Sent with every response of a production server (one with a `clientDir`).
 * The built app loads only same-origin modules and stylesheets; the chart is a
 * `data:` image. The dev server (Vite's HMR client, injected styles) doesn't
 * get the policy.
 */
export const contentSecurityPolicy =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'"

export interface AppHandlerOptions {
  /** Decides which assets the document loads for the matched route. */
  readonly assetsFor: (route: Routes.AppRouteValue) => Assets.PageAssets
  /** The built client directory (`dist/client`) to serve files from. Omit in dev (Vite serves them). */
  readonly clientDir?: string | undefined
}

const securityHeaders = (clientDir: string | undefined): Record<string, string> => ({
  "x-content-type-options": "nosniff",
  ...(clientDir === undefined ? {} : { "content-security-policy": contentSecurityPolicy })
})

const send = (
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  headers: Record<string, string>,
  body: string
): void => {
  // A HEAD response carries the headers (and so the length) of the GET, without the body.
  res.writeHead(status, { "content-length": Buffer.byteLength(body), ...headers })
  res.end(req.method === "HEAD" ? undefined : body)
}

/**
 * Maps a request path to a file inside `clientDir`, or `undefined` if it isn't
 * one: malformed `%` escapes, any path that leaves `clientDir`, and any dotfile
 * segment (`.vite/manifest.json`, in any letter case) are never served.
 */
const resolveStaticFile = (clientDir: string, pathname: string): string | undefined => {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined // URIError: not a file; the router decides what the URL is
  }
  if (decoded.split(/[\\/]/).some((segment) => segment.startsWith("."))) return undefined
  const file = normalize(join(clientDir, decoded))
  return file.startsWith(normalize(clientDir + sep)) ? file : undefined
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
    "cache-control": relative(clientDir, file).startsWith(`assets${sep}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
    ...securityHeaders(clientDir)
  })
  if (req.method === "HEAD") res.end()
  // `pipeline` destroys the response if the file vanishes or the client leaves: never an unhandled stream error.
  else pipeline(createReadStream(file), res, () => undefined)
  return true
}

/**
 * Static files first, then server-rendered pages. The returned promise always
 * resolves: every failure is answered (or the socket destroyed) inside.
 */
export const handleRequest =
  (options: AppHandlerOptions) =>
  async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const security = securityHeaders(options.clientDir)
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        return send(
          req,
          res,
          405,
          { allow: "GET, HEAD", "content-type": "text/plain", ...security },
          "Method Not Allowed"
        )
      }
      const target = req.url ?? "/"
      if (target.startsWith("//") || target.startsWith("/\\") || !URL.canParse(target, "http://localhost")) {
        return send(req, res, 400, { "content-type": "text/plain", ...security }, "Bad Request")
      }
      const url = new URL(target, "http://localhost")
      if (url.origin !== "http://localhost") {
        return send(req, res, 400, { "content-type": "text/plain", ...security }, "Bad Request")
      }
      if (options.clientDir !== undefined && (await serveStatic(options.clientDir, url.pathname, req, res))) return
      if (url.pathname === "/favicon.ico") return void res.writeHead(204, security).end()

      const page = await Render.renderPage(url.pathname + url.search, options.assetsFor)
      switch (page._tag) {
        case "BadRequest":
          return send(req, res, page.status, { "content-type": "text/plain", ...security }, "Bad Request")
        case "Redirect":
          if (!Render.isSafeRelativeLocation(page.location)) {
            return send(req, res, 400, { "content-type": "text/plain", ...security }, "Bad Request")
          }
          return send(
            req,
            res,
            page.status,
            { location: page.location, "content-type": "text/plain", "cache-control": "no-cache", ...security },
            ""
          )
        case "Page":
          return send(
            req,
            res,
            page.status,
            { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", ...security },
            page.html
          )
      }
    } catch (error) {
      console.error(error)
      if (res.headersSent) res.destroy()
      else send(req, res, 500, { "content-type": "text/plain", ...security }, "Internal Server Error")
    }
  }

/** `handleRequest` as a plain Node request listener, for `http.createServer`. */
export const createAppHandler = (options: AppHandlerOptions): RequestListener => {
  const handle = handleRequest(options)
  return (req, res) => void handle(req, res)
}
