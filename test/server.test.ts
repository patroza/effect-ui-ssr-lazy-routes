// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, request, type Server as HttpServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test"
import * as Handler from "../src/server/handler.ts"

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
let port: number
let devPort: number

const listen = async (handler: ReturnType<typeof Handler.createAppHandler>): Promise<[HttpServer, number]> => {
  const instance = createServer(handler)
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
  ;[server, port] = await listen(Handler.createAppHandler({ clientDir, assetsFor }))
  ;[dev, devPort] = await listen(Handler.createAppHandler({ assetsFor }))
})

afterAll(async () => {
  await Promise.all([server, dev].map((s) => new Promise<void>((resolve) => s.close(() => resolve()))))
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
  it("answers 405 with Allow for POST", async () => {
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
    const [faviconServer, faviconPort] = await listen(Handler.createAppHandler({ clientDir: withFavicon, assetsFor }))
    try {
      const reply = await raw("/favicon.ico", "GET", faviconPort)
      expect(reply.status).toBe(200)
      expect(reply.headers["content-type"]).toBe("image/x-icon")
      expect(reply.body).toBe("ICO")
    } finally {
      faviconServer.closeAllConnections()
      await new Promise<void>((resolve) => faviconServer.close(() => resolve()))
    }
  })

  it("the dev handler (no clientDir) sends nosniff but no Content-Security-Policy", async () => {
    const reply = await raw("/", "GET", devPort)
    expect(reply.status).toBe(200)
    expect(reply.headers["x-content-type-options"]).toBe("nosniff")
    expect(reply.headers["content-security-policy"]).toBeUndefined()
  })
})
