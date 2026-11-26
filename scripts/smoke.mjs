// Boots the BUILT server (dist/server/serve.js) on a free port, requests a few
// URLs, checks the SSR HTML and the <link rel="modulepreload"> tags, then shuts
// the server down. Run after `pnpm build`.
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const server = spawn("node", ["dist/server/serve.js"], {
  cwd: root,
  env: { ...process.env, PORT: "0" },
  stdio: ["ignore", "pipe", "inherit"]
})

const base = await new Promise((resolve, reject) => {
  server.once("error", reject)
  server.stdout.on("data", (chunk) => {
    const match = /listening on (http:\/\/localhost:\d+)/.exec(String(chunk))
    if (match) resolve(match[1])
  })
  server.once("exit", (code) => reject(new Error(`server exited early (${code})`)))
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
    const preloads = [...html.matchAll(/<link rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1])
    const own = preloads.filter((href) => otherPages.test(href))
    const problems = []
    if (response.status !== check.status) problems.push(`status ${response.status}`)
    if (!html.includes(`data-page-chunk="${check.marker}"`)) problems.push("page not server-rendered")
    if (!html.includes('id="state"')) problems.push("no serialized state")
    if (!own.some((href) => check.preload.test(href)) || own.length !== 1) problems.push(`page preloads: ${own.join(", ")}`)
    // Tailwind's stylesheet is global; the Analytics page's own stylesheet loads on /analytics only.
    const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1])
    if (!sheets.some((href) => /\/client-.*\.css$/.test(href))) problems.push("no global stylesheet")
    const pageSheet = sheets.some((href) => /AnalyticsPage-.*\.css$/.test(href))
    if (pageSheet !== (check.path === "/analytics")) problems.push(`Analytics stylesheet ${pageSheet ? "present" : "missing"}`)
    console.log(`${problems.length === 0 ? "PASS" : "FAIL"}  ${check.path}  ${response.status}  preloads: ${preloads.map((h) => h.split("/").pop()).join(", ")}  css: ${sheets.map((h) => h.split("/").pop()).join(", ")}${problems.length ? "  ✗ " + problems.join("; ") : ""}`)
    failed ||= problems.length > 0
  }
} finally {
  server.kill("SIGTERM")
  await new Promise((resolve) => server.once("exit", resolve))
}
process.exit(failed ? 1 : 0)
