// Boots the BUILT server (dist/server/serve.js) on a free port, requests a few
// URLs, checks the SSR HTML, <link rel="modulepreload"> tags, redirects, HTTP
// methods, security headers, and bad/attack URLs, then shuts the server down.
// Run after `pnpm build`.
import { spawn } from "node:child_process"
import { request, type IncomingHttpHeaders } from "node:http"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const server = spawn("node", ["dist/server/serve.js"], {
  cwd: root,
  env: { ...process.env, PORT: "0" },
  stdio: ["ignore", "pipe", "inherit"]
})

const startupTimeoutMs = 15_000
const base = await new Promise<string>((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error(`server did not start listening within ${startupTimeoutMs / 1000}s`)),
    startupTimeoutMs
  )
  server.once("error", reject)
  server.stdout.on("data", (chunk) => {
    const match = /listening on (http:\/\/localhost:\d+)/.exec(String(chunk))
    const url = match?.[1]
    if (url !== undefined) {
      clearTimeout(timer)
      resolve(url)
    }
  })
  server.once("exit", (code) => {
    clearTimeout(timer)
    reject(new Error(`server exited early (${code})`))
  })
}).catch((error: unknown) => {
  server.kill("SIGKILL")
  throw error
})

interface RawReply {
  readonly status: number
  readonly headers: IncomingHttpHeaders
  readonly body: string
}

/** Sends a raw HTTP request whose path goes on the wire exactly as written. */
const rawReply = (origin: string, path: string, method = "GET"): Promise<RawReply> =>
  new Promise((resolve, reject) => {
    const { hostname, port } = new URL(origin)
    const req = request({ hostname, port, path, method }, (res) => {
      const chunks: Array<Buffer> = []
      res.on("data", (chunk: Buffer) => chunks.push(chunk))
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") })
      )
    })
    req.on("error", reject)
    req.end()
  })

const checks = [
  { path: "/", status: 200, marker: "SENTINEL:home-page", preload: /HomePage-/ },
  { path: "/products?q=mug", status: 200, marker: "SENTINEL:products-page", preload: /ProductsPage-/ },
  { path: "/products/42", status: 200, marker: "SENTINEL:product-detail-page", preload: /ProductDetailPage-/ },
  { path: "/analytics", status: 200, marker: "SENTINEL:analytics-page", preload: /AnalyticsPage-/ },
  { path: "/nope", status: 404, marker: "SENTINEL:not-found-page", preload: /NotFoundPage-/ }
]
const otherPages = /(Home|Products|ProductDetail|Analytics|NotFound)Page-/

let failed = false
const report = (ok: boolean, label: string, detail: string): void => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  ${detail}`)
  failed ||= !ok
}

try {
  for (const check of checks) {
    const response = await fetch(base + check.path)
    const html = await response.text()
    const preloads = [...html.matchAll(/<link rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1] ?? "")
    const own = preloads.filter((href) => otherPages.test(href))
    const problems: Array<string> = []
    if (response.status !== check.status) problems.push(`status ${response.status}`)
    const csp = response.headers.get("content-security-policy") ?? ""
    if (!csp.includes("default-src 'self'") || !csp.includes("frame-ancestors 'none'"))
      problems.push(`missing/weak CSP: ${csp || "(none)"}`)
    if (!html.includes(`data-page-chunk="${check.marker}"`)) problems.push("page not server-rendered")
    if (!html.includes('id="state"')) problems.push("no serialized state")
    if (!own.some((href) => check.preload.test(href)) || own.length !== 1)
      problems.push(`page preloads: ${own.join(", ")}`)
    // Tailwind's stylesheet is global; the Analytics page's own stylesheet loads on /analytics only.
    const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1] ?? "")
    if (!sheets.some((href) => /\/main-.*\.css$/.test(href))) problems.push("no global stylesheet")
    const pageSheet = sheets.some((href) => /AnalyticsPage-.*\.css$/.test(href))
    if (pageSheet !== (check.path === "/analytics"))
      problems.push(`Analytics stylesheet ${pageSheet ? "present" : "missing"}`)
    // Every modulepreload must actually load: a JS module, cacheable forever.
    for (const href of preloads) {
      const asset = await fetch(base + href)
      await asset.arrayBuffer()
      if (asset.status !== 200) problems.push(`${href} -> ${asset.status}`)
      else if (!(asset.headers.get("content-type") ?? "").startsWith("text/javascript"))
        problems.push(`${href} content-type ${asset.headers.get("content-type")}`)
      else if (!(asset.headers.get("cache-control") ?? "").includes("immutable")) problems.push(`${href} not immutable`)
    }
    report(
      problems.length === 0,
      check.path,
      `${response.status}  preloads: ${preloads.map((h) => h.split("/").pop() ?? h).join(", ")}  css: ${sheets.map((h) => h.split("/").pop() ?? h).join(", ")}${problems.length ? "  ✗ " + problems.join("; ") : ""}`
    )
  }

  // Canonical redirects (301/302).
  for (const redirect of [
    { path: "/products/", status: 301, location: "/products" },
    { path: "/products?q=a&q=b", status: 302, location: "/products" }
  ]) {
    const reply = await rawReply(base, redirect.path)
    const ok = reply.status === redirect.status && reply.headers.location === redirect.location
    report(ok, redirect.path, `${reply.status} -> ${reply.headers.location ?? "(none)"}`)
  }

  // HTTP methods: 405 on POST, HEAD carries GET's real content-length and no body.
  const post = await rawReply(base, "/", "POST")
  report(post.status === 405 && post.headers.allow === "GET, HEAD", "POST /", `${post.status}`)
  const getProducts = await rawReply(base, "/products", "GET")
  const headProducts = await rawReply(base, "/products", "HEAD")
  const headOk =
    headProducts.status === 200 &&
    headProducts.body === "" &&
    headProducts.headers["content-length"] === String(Buffer.byteLength(getProducts.body))
  report(headOk, "HEAD /products", `${headProducts.status} content-length=${headProducts.headers["content-length"]}`)

  // Nothing outside the client's public files is served, and bad/open-redirect URLs never redirect off-site or crash.
  for (const attack of [
    { path: "/.vite/manifest.json", statuses: [404] },
    { path: "/.VITE/manifest.json", statuses: [404] },
    { path: "/%E0%A4%A", statuses: [400] },
    { path: "/products/%E0%A4%A", statuses: [400] },
    { path: "/../package.json", statuses: [400, 404] },
    { path: "//evil.com/", statuses: [400, 404] },
    { path: "/%2F%2Fevil.com/", statuses: [400, 404] },
    { path: "/.//evil.com/", statuses: [400, 404] },
    { path: "/a/..//evil.com/", statuses: [400, 404] }
  ]) {
    const reply = await rawReply(base, attack.path)
    const ok =
      attack.statuses.includes(reply.status) && reply.headers.location === undefined && !reply.body.includes('"file"')
    report(ok, attack.path, `${reply.status}${reply.headers.location ? ` location=${reply.headers.location}` : ""}`)
  }
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    server.kill("SIGTERM")
    await new Promise<void>((resolve) => server.once("exit", () => resolve()))
  }
}
process.exit(failed ? 1 : 0)
