// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, request, type Server as HttpServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Deferred, Effect, Exit, Layer, Option, Ref } from "effect"
import { FetchHttpClient } from "effect/http"
import { RpcClient, type RpcClientError, RpcSerialization } from "effect/rpc"
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test"
import * as Pages from "../src/pages.ts"
import * as Handler from "../src/server/handler.ts"
import * as Rpc from "../src/server/rpc.ts"

interface Reply {
  readonly status: number
  readonly headers: Record<string, string | ReadonlyArray<string> | undefined>
  readonly body: string
}

const secret = "TOP-SECRET-OUTSIDE-THE-CLIENT-DIR"
const scriptText = "export const chunk = 1\n"

let root: string
let server: HttpServer
let dev: HttpServer
let appServer: Handler.ManagedNodeHandler
let devAppServer: Handler.ManagedNodeHandler
let port: number
let devPort: number

const listen = async (managed: Handler.ManagedNodeHandler): Promise<[HttpServer, number]> => {
  const instance = createServer(managed.handler)
  await new Promise<void>((resolve) => instance.listen(0, "127.0.0.1", resolve))
  const address = instance.address()
  if (typeof address !== "object" || address === null) throw new Error("no address")
  return [instance, address.port]
}

const assetsFor = () => ({ scripts: [], modulePreloads: [], stylesheets: [] })

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "server-test-"))
  const clientDir = join(root, "client")
  mkdirSync(join(clientDir, "assets"), { recursive: true })
  mkdirSync(join(clientDir, ".vite"), { recursive: true })
  writeFileSync(join(clientDir, "assets", "app-abc123.js"), scriptText)
  writeFileSync(join(clientDir, "robots.txt"), "User-agent: *\n")
  writeFileSync(join(clientDir, ".vite", "manifest.json"), '{"manifest":"private"}')
  writeFileSync(join(root, "secret.txt"), secret)
  appServer = await Handler.createAppServer({ clientDir, assetsFor })
  devAppServer = await Handler.createAppServer({ assetsFor })
  ;[server, port] = await listen(appServer)
  ;[dev, devPort] = await listen(devAppServer)
  // Preload lazy page modules so Vitest's cold on-demand transform does not race the 1s SSR budget on the first GET.
  await Promise.all(Object.values(Pages.pages).map((page) => page.preload()))
})

afterAll(async () => {
  await Promise.all([
    ...[server, dev].map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
    appServer.dispose(),
    devAppServer.dispose()
  ])
  rmSync(root, { recursive: true, force: true })
})

/** A raw request: the path goes on the wire exactly as written (`fetch` would normalise `..` away). */
const raw = (path: string, method = "GET", target = port): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: target, path, method }, (res) => {
      const chunks: Array<Buffer> = []
      res.on("data", (chunk: Buffer) => chunks.push(chunk))
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") })
      )
    })
    req.on("error", reject)
    req.end()
  })

const runRpc = <A, E>(
  fn: (client: RpcClient.FromGroup<typeof Rpc.AppRpcs, RpcClientError.RpcClientError>) => Effect.Effect<A, E>,
  target = port
) =>
  Effect.gen(function* () {
    const client = yield* RpcClient.make(Rpc.AppRpcs)
    return yield* fn(client)
  }).pipe(
    Effect.scoped,
    Effect.provide(
      RpcClient.layerProtocolHttp({ url: `http://127.0.0.1:${target}/rpc` }).pipe(
        Layer.provide(RpcSerialization.layerJson),
        Layer.provide(FetchHttpClient.layer)
      )
    ),
    Effect.runPromise
  )

describe("static files", () => {
  it("serves a hashed asset with an immutable cache header and the security headers", async () => {
    const reply = await raw("/assets/app-abc123.js")
    expect(reply.status).toBe(200)
    expect(reply.body).toBe(scriptText)
    expect(reply.headers["content-type"]).toBe("text/javascript; charset=utf-8")
    expect(reply.headers["cache-control"]).toBe("public, max-age=31536000, immutable")
    expect(reply.headers["x-content-type-options"]).toBe("nosniff")
    expect(reply.headers["content-security-policy"]).toBe(Handler.contentSecurityPolicy)
  })

  it("does not cache other files forever and serves .txt as text/plain", async () => {
    const reply = await raw("/robots.txt")
    expect(reply.status).toBe(200)
    expect(reply.headers["content-type"]).toBe("text/plain; charset=utf-8")
    expect(reply.headers["cache-control"]).toBe("no-cache")
  })

  it("answers HEAD for a file with its length and no body", async () => {
    const reply = await raw("/assets/app-abc123.js", "HEAD")
    expect(reply.status).toBe(200)
    expect(reply.headers["content-length"]).toBe(String(Buffer.byteLength(scriptText)))
    expect(reply.body).toBe("")
  })

  it("falls through to the NotFound page for a missing file", async () => {
    const reply = await raw("/assets/missing.js")
    expect(reply.status).toBe(404)
    expect(reply.body).toContain("Page not found")
  })

  it.each([
    "/../secret.txt",
    "/%2e%2e/secret.txt",
    "/..%2fsecret.txt",
    "/%2e%2e%2fsecret.txt",
    "/assets/../../secret.txt"
  ])("never serves a file outside the client dir (%s)", async (path) => {
    const reply = await raw(path)
    expect([400, 404]).toContain(reply.status)
    expect(reply.body).not.toContain(secret)
  })

  it.each([
    "/.vite/manifest.json",
    "/.VITE/manifest.json",
    "/.Vite/manifest.json",
    "/%2Evite/manifest.json",
    "/assets/.hidden"
  ])("never serves a dotfile path (%s)", async (path) => {
    const reply = await raw(path)
    expect([400, 404]).toContain(reply.status)
    expect(reply.body).not.toContain("private")
  })
})

describe("malformed URLs are the client's fault, never a 500", () => {
  it.each(["/%E0%A4%A", "/products/%E0%A4%A", "/products/%E0%A4%A?q=1", "/assets/%E0%A4%A"])(
    "answers 400 for %s",
    async (path) => {
      const reply = await raw(path)
      expect(reply.status).toBe(400)
      expect(reply.body).toBe("Bad Request")
    }
  )

  it("answers 400 for a request target the URL parser rejects", async () => {
    const reply = await raw("//")
    expect(reply.status).toBe(400)
  })
})

describe("methods", () => {
  it("answers 405 with Allow for POST on non-RPC routes", async () => {
    const reply = await raw("/", "POST")
    expect(reply.status).toBe(405)
    expect(reply.headers["allow"]).toBe("GET, HEAD")
  })

  it("answers HEAD with the GET's content-length and an empty body", async () => {
    const get = await raw("/products")
    const head = await raw("/products", "HEAD")
    expect(head.status).toBe(200)
    expect(Number(head.headers["content-length"])).toBeGreaterThan(0)
    expect(head.headers["content-length"]).toBe(String(Buffer.byteLength(get.body)))
    expect(head.body).toBe("")
  })

  it("counts bytes, not characters, in content-length", async () => {
    const get = await raw("/analytics")
    expect(get.status).toBe(200)
    expect(get.headers["content-length"]).toBe(String(Buffer.byteLength(get.body)))
  })
})

describe("canonical URLs", () => {
  it("301s a trailing slash to the canonical path", async () => {
    const reply = await raw("/products/")
    expect(reply.status).toBe(301)
    expect(reply.headers["location"]).toBe("/products")
  })

  it("302s a URL whose search params were dropped as invalid", async () => {
    const reply = await raw("/products?q=a&q=b")
    expect(reply.status).toBe(302)
    expect(reply.headers["location"]).toBe("/products")
  })

  it("does not redirect a canonical URL", async () => {
    const reply = await raw("/products?q=mug")
    expect(reply.status).toBe(200)
    expect(reply.headers["location"]).toBeUndefined()
  })

  it.each(["//evil.com/", "/%2F%2Fevil.com/", "/.//evil.com/", "/a/..//evil.com/"])(
    "never open-redirects for %s",
    async (path) => {
      const reply = await raw(path)
      expect([400, 404]).toContain(reply.status)
      expect(reply.headers["location"]).toBeUndefined()
    }
  )
})

describe("pages", () => {
  it("renders a page with the security headers", async () => {
    const reply = await raw("/products/42")
    expect(reply.status).toBe(200)
    expect(reply.body).toContain("Field notebook")
    expect(reply.headers["x-content-type-options"]).toBe("nosniff")
    expect(reply.headers["content-security-policy"]).toBe(Handler.contentSecurityPolicy)
  })

  it("answers 404 for an unknown product, derived from the rendered page", async () => {
    const reply = await raw("/products/999")
    expect(reply.status).toBe(404)
    expect(reply.body).toContain("Unknown product")
  })

  it("answers favicon requests with 204 when no favicon.ico exists, and serves it when present", async () => {
    expect((await raw("/favicon.ico")).status).toBe(204)

    const withFavicon = join(root, "client-with-favicon")
    mkdirSync(withFavicon, { recursive: true })
    writeFileSync(join(withFavicon, "favicon.ico"), "ICO")
    const faviconApp = await Handler.createAppServer({ clientDir: withFavicon, assetsFor })
    const [faviconServer, faviconPort] = await listen(faviconApp)
    try {
      const reply = await raw("/favicon.ico", "GET", faviconPort)
      expect(reply.status).toBe(200)
      expect(reply.headers["content-type"]).toBe("image/x-icon")
      expect(reply.body).toBe("ICO")
    } finally {
      faviconServer.closeAllConnections()
      await new Promise<void>((resolve) => faviconServer.close(() => resolve()))
      await faviconApp.dispose()
    }
  })

  it("the dev handler (no clientDir) sends nosniff but no Content-Security-Policy", async () => {
    const reply = await raw("/", "GET", devPort)
    expect(reply.status).toBe(200)
    expect(reply.headers["x-content-type-options"]).toBe("nosniff")
    expect(reply.headers["content-security-policy"]).toBeUndefined()
  })
})

describe("Effect RPC over HTTP (POST /rpc)", () => {
  it("serves searchProducts and getAnalytics over POST /rpc", async () => {
    const products = await runRpc((client) => client.searchProducts({ q: "mug" }))
    expect(products).toHaveLength(1)
    expect(products[0]?.name).toBe("Enamel camp mug")
    expect(products[0]?.bookmarked).toBe(false)

    const revenue = await runRpc((client) => client.getAnalytics({ metric: "revenue" }))
    expect(revenue).toHaveLength(12)
    expect(revenue.reduce((sum, point) => sum + point.value, 0)).toBe(237500)

    const orders = await runRpc((client) => client.getAnalytics({ metric: "orders" }))
    expect(orders.reduce((sum, point) => sum + point.value, 0)).toBe(5664)
  })

  it("persists bookmarkProduct mutations across subsequent RPC reads and in-process SSR renders", async () => {
    const before = await runRpc((client) => client.getProduct({ id: "42" }))
    expect(Option.isSome(before)).toBe(true)
    if (Option.isSome(before)) {
      expect(before.value.name).toBe("Field notebook")
      expect(before.value.bookmarked).toBe(false)
    }

    await runRpc((client) => client.bookmarkProduct({ id: "42" }))

    const after = await runRpc((client) => client.getProduct({ id: "42" }))
    expect(Option.isSome(after)).toBe(true)
    if (Option.isSome(after)) {
      expect(after.value.bookmarked).toBe(true)
    }

    // In-process SSR reads from the same server store layer instance.
    const ssrAfter = await raw("/products/42")
    expect(ssrAfter.status).toBe(200)
    expect(ssrAfter.body).toContain("Bookmarked ✓")
  })

  it("returns None for an unknown product and fails bookmarkProduct with typed ApiError", async () => {
    const missing = await runRpc((client) => client.getProduct({ id: "999" }))
    expect(Option.isNone(missing)).toBe(true)

    const exit = await runRpc((client) => Effect.exit(client.bookmarkProduct({ id: "999" })))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain('Product "999" not found')
    }
  })

  it("applies security headers to POST /rpc responses and handles query strings and non-POST methods cleanly", async () => {
    const response = await fetch(`http://127.0.0.1:${port}/rpc?x=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ _tag: "Request", id: "1", tag: "getProduct", payload: { id: "42" }, headers: [] })
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("content-security-policy")).toBe(Handler.contentSecurityPolicy)
    expect(await response.text()).toContain("Field notebook")

    for (const method of ["GET", "HEAD", "PUT"]) {
      const disallowed = await raw("/rpc", method)
      expect(disallowed.status, `${method} /rpc`).toBe(405)
      expect(disallowed.headers["allow"], `${method} /rpc`).toBe("POST")
    }

    for (const path of ["/./rpc", "/a/../rpc", "/rpc/.", "/%2e/rpc"]) {
      const nonCanonical = await raw(path, "POST")
      expect(nonCanonical.status, `POST ${path}`).toBe(405)
      expect(nonCanonical.headers["allow"], `POST ${path}`).toBe("GET, HEAD")
    }
  })

  it("evicts closed in-process RPC clients via disconnects so repeated SSR renders do not leak", async () => {
    const clientCount = 20
    const disconnected = await Effect.gen(function* () {
      const disconnectedIds = yield* Ref.make<ReadonlyArray<number>>([])
      const allDisconnected = yield* Deferred.make<void>()

      const protocolLayer = Layer.effect(
        RpcClient.Protocol,
        Rpc.makeInProcessProtocol({
          onDisconnect: (clientId) =>
            Ref.updateAndGet(disconnectedIds, (ids) => [...ids, clientId]).pipe(
              Effect.flatMap((ids) =>
                ids.length === clientCount ? Deferred.succeed(allDisconnected, undefined) : Effect.void
              )
            )
        })
      ).pipe(Layer.provide(Rpc.HandlersLayer.pipe(Layer.provide(Layer.fresh(Rpc.ServerStoresLayer)))))

      yield* Effect.gen(function* () {
        for (let index = 0; index < clientCount; index++) {
          yield* Effect.gen(function* () {
            const client = yield* RpcClient.make(Rpc.AppRpcs)
            const product = yield* client.getProduct({ id: "42" })
            expect(Option.isSome(product)).toBe(true)
          }).pipe(Effect.scoped)
        }
        yield* Deferred.await(allDisconnected).pipe(Effect.timeout("2 seconds"))
      }).pipe(Effect.provide(protocolLayer))

      return yield* Ref.get(disconnectedIds)
    }).pipe(Effect.runPromise)

    expect(disconnected).toHaveLength(clientCount)
    expect(new Set(disconnected).size).toBe(clientCount)
  })
})
