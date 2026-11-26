import { readFile, stat } from "node:fs/promises"
import type { RequestListener } from "node:http"
import { extname, join, normalize, relative, sep } from "node:path"
import { NodeHttpServer } from "@effect/platform-node"
import { Effect, Exit, Layer, Scope } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import type * as Routes from "../routes.ts"
import type * as Assets from "./assets.ts"
import * as Render from "./render.ts"
import * as Rpc from "./rpc.ts"

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

const textReply = (
  method: string,
  status: number,
  headers: Record<string, string>,
  body: string
): HttpServerResponse.HttpServerResponse => {
  const contentLength = Buffer.byteLength(body)
  if (method === "HEAD") {
    return HttpServerResponse.empty({
      status,
      headers: { "content-length": String(contentLength), ...headers }
    })
  }
  return HttpServerResponse.text(body, {
    status,
    headers: { "content-length": String(contentLength), ...headers }
  })
}

const serveStaticEffect = Effect.fn("serveStatic")(function* (
  clientDir: string,
  pathname: string,
  method: string,
  security: Record<string, string>
) {
  const file = resolveStaticFile(clientDir, pathname)
  if (file === undefined) return undefined
  const info = yield* Effect.tryPromise(() => stat(file)).pipe(Effect.orElseSucceed(() => undefined))
  if (info === undefined || !info.isFile()) return undefined
  const headers: Record<string, string> = {
    "content-type": contentTypes[extname(file)] ?? "application/octet-stream",
    "content-length": String(info.size),
    // Everything under /assets is content-hashed, so it can be cached forever.
    "cache-control": relative(clientDir, file).startsWith(`assets${sep}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
    ...security
  }
  if (method === "HEAD") {
    return HttpServerResponse.empty({ status: 200, headers })
  }
  const bytes = yield* Effect.tryPromise(() => readFile(file)).pipe(Effect.orElseSucceed(() => undefined))
  if (bytes === undefined) return undefined
  return HttpServerResponse.uint8Array(bytes, { status: 200, headers })
})

const parseRequestUrl = (target: string): URL | undefined => {
  if (target.startsWith("//") || target.startsWith("/\\") || !URL.canParse(target, "http://localhost")) {
    return undefined
  }
  const url = new URL(target, "http://localhost")
  return url.origin === "http://localhost" ? url : undefined
}

const isRpcPathname = (pathname: string): boolean => pathname === "/rpc" || pathname === "/rpc/"

/**
 * Handles static assets and SSR page routes (everything other than `/rpc`),
 * preserving all URL validation, open-redirect blocking, method checks, and
 * security headers.
 */
const handlePageOrStatic = (url: URL, method: string, security: Record<string, string>, options: AppHandlerOptions) =>
  Effect.gen(function* () {
    if (method !== "GET" && method !== "HEAD") {
      return textReply(
        method,
        405,
        { allow: "GET, HEAD", "content-type": "text/plain", ...security },
        "Method Not Allowed"
      )
    }

    if (options.clientDir !== undefined) {
      const staticReply = yield* serveStaticEffect(options.clientDir, url.pathname, method, security)
      if (staticReply !== undefined) return staticReply
    }
    if (url.pathname === "/favicon.ico") {
      return HttpServerResponse.empty({ status: 204, headers: security })
    }

    const page = yield* Render.renderPageEffect(url.pathname + url.search, options.assetsFor)
    switch (page._tag) {
      case "BadRequest":
        return textReply(method, page.status, { "content-type": "text/plain", ...security }, "Bad Request")
      case "Redirect":
        if (!Render.isSafeRelativeLocation(page.location)) {
          return textReply(method, 400, { "content-type": "text/plain", ...security }, "Bad Request")
        }
        return textReply(
          method,
          page.status,
          { location: page.location, "content-type": "text/plain", "cache-control": "no-cache", ...security },
          ""
        )
      case "Page":
        return textReply(
          method,
          page.status,
          { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache", ...security },
          page.html
        )
    }
  })

/**
 * Full Effect HTTP application layer:
 * - `POST /rpc` via `RpcServer.layerHttp` (`RpcSerialization.layerJson`)
 * - SSR + static files via `handlePageOrStatic`, sharing the SAME server stores
 *   through `Rpc.InProcessProtocolLayer` (zero TCP round-trip during SSR)
 */
export const makeHttpAppEffect = (options: AppHandlerOptions) => {
  const security = securityHeaders(options.clientDir)

  return Effect.map(
    HttpRouter.toHttpEffect(Rpc.RpcHttpLayer).pipe(
      Effect.provideService(HttpRouter.RouterConfig, { ignoreTrailingSlash: true })
    ),
    (rpcEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const method = request.method
        const url = parseRequestUrl(request.url)
        if (url === undefined) {
          return textReply(method, 400, { "content-type": "text/plain", ...security }, "Bad Request")
        }
        if (isRpcPathname(url.pathname)) {
          if (method !== "POST") {
            return textReply(
              method,
              405,
              { allow: "POST", "content-type": "text/plain", ...security },
              "Method Not Allowed"
            )
          }
          const response = yield* rpcEffect
          return HttpServerResponse.setHeaders(response, security)
        }
        return yield* handlePageOrStatic(url, method, security, options)
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logError("Unhandled server error", cause).pipe(
            Effect.as(
              HttpServerResponse.text("Internal Server Error", {
                status: 500,
                headers: { "content-type": "text/plain", ...security }
              })
            )
          )
        )
      )
  )
}

const handlersLayer = Rpc.HandlersLayer.pipe(Layer.provide(Rpc.ServerStoresLayer))

/** Complete server dependency graph: shared stores + RPC handlers + in-process SSR RPC protocol. */
export const serverRuntimeLayer = Layer.mergeAll(
  handlersLayer,
  Rpc.InProcessProtocolLayer.pipe(Layer.provide(handlersLayer))
)

export interface ManagedNodeHandler {
  readonly handler: RequestListener
  readonly dispose: () => Promise<void>
}

/**
 * Builds a Node `RequestListener` backed by the Effect HTTP + RPC server,
 * sharing one store layer instance for both `POST /rpc` and in-process SSR.
 * Call `dispose()` on shutdown to close the server scope cleanly.
 */
export const createAppServer = async (options: AppHandlerOptions): Promise<ManagedNodeHandler> => {
  const scope = Scope.makeUnsafe()
  const handler = await Effect.gen(function* () {
    const runtimeContext = yield* Layer.buildWithScope(Layer.fresh(serverRuntimeLayer), scope)
    const httpEffect = yield* makeHttpAppEffect(options).pipe(Effect.provideContext(runtimeContext))
    return yield* NodeHttpServer.makeHandler(httpEffect, { scope }).pipe(Effect.provideContext(runtimeContext))
  }).pipe(Effect.provideService(Scope.Scope, scope), Effect.runPromise)

  return {
    handler: (req, res) => handler(req, res),
    dispose: () => Effect.runPromise(Scope.close(scope, Exit.void))
  }
}
