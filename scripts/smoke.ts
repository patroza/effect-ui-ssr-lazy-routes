// Boots the BUILT server (dist/server/serve.js) on a free port, requests a few
// URLs, checks the SSR HTML and the <link rel="modulepreload"> tags, then shuts
// the server down. Run after `pnpm build`.
import { spawn } from "node:child_process"
import { request } from "node:http"
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

/** Status of a GET whose path goes on the wire exactly as written. */
const rawStatus = (origin: string, path: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const { hostname, port } = new URL(origin)
    const req = request({ hostname, port, path }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
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
try {
  for (const check of checks) {
    const response = await fetch(base + check.path)
    const html = await response.text()
    const preloads = [...html.matchAll(/<link rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1] ?? "")
    const own = preloads.filter((href) => otherPages.test(href))
    const problems: Array<string> = []
    if (response.status !== check.status) problems.push(`status ${response.status}`)
    if (!html.includes(`data-page-chunk="${check.marker}"`)) problems.push("page not server-rendered")
    if (!html.includes('id="state"')) problems.push("no serialized state")
    if (!own.some((href) => check.preload.test(href)) || own.length !== 1)
      problems.push(`page preloads: ${own.join(", ")}`)
    // Tailwind's stylesheet is global; the Analytics page's own stylesheet loads on /analytics only.
    const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1] ?? "")
    if (!sheets.some((href) => /\/client-.*\.css$/.test(href))) problems.push("no global stylesheet")
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
    console.log(
      `${problems.length === 0 ? "PASS" : "FAIL"}  ${check.path}  ${response.status}  preloads: ${preloads.map((h) => h.split("/").pop() ?? h).join(", ")}  css: ${sheets.map((h) => h.split("/").pop() ?? h).join(", ")}${problems.length ? "  ✗ " + problems.join("; ") : ""}`
    )
    failed ||= problems.length > 0
  }

  // Nothing outside the client's public files is served, and a bad URL is never a crash.
  for (const attack of [
    { path: "/.vite/manifest.json", statuses: [404] },
    { path: "/.VITE/manifest.json", statuses: [404] },
    { path: "/%E0%A4%A", statuses: [400] },
    { path: "/products/%E0%A4%A", statuses: [400] }
  ]) {
    const response = await fetch(base + attack.path)
    const body = await response.text()
    const ok = attack.statuses.includes(response.status) && !body.includes('"file"')
    console.log(`${ok ? "PASS" : "FAIL"}  ${attack.path}  ${response.status}`)
    failed ||= !ok
  }
  // `fetch` normalises `..`, so send this one over a raw socket-level request.
  const traversal = await rawStatus(base, "/../package.json")
  console.log(`${[400, 404].includes(traversal) ? "PASS" : "FAIL"}  /../package.json  ${traversal}`)
  failed ||= ![400, 404].includes(traversal)
} finally {
  server.kill("SIGTERM")
  await new Promise<void>((resolve) => server.once("exit", () => resolve()))
}
process.exit(failed ? 1 : 0)
