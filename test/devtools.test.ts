import { spawn, type ChildProcess } from "node:child_process"
import { request as nodeHttpRequest } from "node:http"
import { createServer } from "node:net"
import { BrowserRouter } from "@effect/ui/html"
import { DevTools } from "@effect/ui-devtools"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Layer, Schema, Scope } from "effect"
import * as Bootstrap from "../src/browser/bootstrap.ts"
import * as State from "../src/browser/state.ts"
import * as JsonString from "../src/lib/jsonString.ts"
import * as Routes from "../src/routes.ts"
import * as Helpers from "./helpers.ts"
import * as TestRpc from "./support/rpc.ts"

const repoRoot = process.cwd()

const DevToolsMetaSchema = Schema.Struct({
  url: Schema.String,
  size: Schema.Finite
})

const McpSessionSchema = Schema.Struct({
  session: Schema.String,
  app: Schema.String,
  connected: Schema.Boolean,
  controllable: Schema.Boolean,
  entries: Schema.Finite,
  instances: Schema.Finite
})

const McpListSessionsSchema = Schema.Struct({
  result: Schema.Array(McpSessionSchema)
})

const McpEntryRowSchema = Schema.Struct({
  seq: Schema.Finite,
  tag: Schema.String
})

const McpListEntriesSchema = Schema.Struct({
  result: Schema.Struct({
    total: Schema.Finite,
    rows: Schema.Array(McpEntryRowSchema)
  })
})

const McpToolCallResponseSchema = Schema.Struct({
  result: Schema.Struct({
    content: Schema.Array(
      Schema.Struct({
        type: Schema.String,
        text: Schema.optionalKey(Schema.String)
      })
    )
  })
})

const decodeMeta = Schema.decodeSync(JsonString.jsonString(DevToolsMetaSchema))
const decodeToolCallResponse = Schema.decodeSync(JsonString.jsonString(McpToolCallResponseSchema))
const decodeListSessions = Schema.decodeSync(JsonString.jsonString(McpListSessionsSchema))
const decodeListEntries = Schema.decodeSync(JsonString.jsonString(McpListEntriesSchema))

interface HttpReply {
  readonly status: number
  readonly headers: Readonly<Record<string, string | ReadonlyArray<string> | undefined>>
  readonly body: string
}

const httpRequest = (
  urlString: string,
  options: {
    readonly method?: string
    readonly headers?: Readonly<Record<string, string>>
    readonly body?: string
  } = {}
): Promise<HttpReply> =>
  new Promise((resolve, reject) => {
    const parsed = new URL(urlString)
    const req = nodeHttpRequest(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port),
        path: parsed.pathname + parsed.search,
        method: options.method ?? "GET",
        headers: options.headers
      },
      (res) => {
        const chunks: Array<Buffer> = []
        res.on("data", (chunk: Buffer) => chunks.push(chunk))
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8")
          })
        )
      }
    )
    req.on("error", reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })

const headerValue = (
  headers: Readonly<Record<string, string | ReadonlyArray<string> | undefined>>,
  name: string
): string | undefined => {
  const value = headers[name.toLowerCase()]
  return typeof value === "string" ? value : value?.[0]
}

const getFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on("error", reject)
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address()
      if (addr === null || typeof addr === "string") {
        srv.close(() => reject(new Error("Could not determine free port")))
        return
      }
      const { port } = addr
      srv.close((error) => (error ? reject(error) : resolve(port)))
    })
  })

const waitFor = async <A>(check: () => Promise<A | undefined>, label: string, timeoutMs = 15_000): Promise<A> => {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const value = await check()
      if (value !== undefined) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const detail =
    lastError === undefined
      ? ""
      : ` (last error: ${lastError instanceof Error ? lastError.message : JSON.stringify(lastError)})`
  throw new Error(`Timed out waiting for ${label}${detail}`)
}

const stopChild = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve())
  })
  child.kill("SIGTERM")
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL")
    }
  }, 5_000)
  timer.unref()
  await exited
  clearTimeout(timer)
  child.stdout?.destroy()
  child.stderr?.destroy()
}

interface RunningDevServer {
  readonly appUrl: string
  readonly devToolsUrl: string
  readonly stop: () => Promise<void>
}

const startDevServer = async (): Promise<RunningDevServer> => {
  const [appPort, dtPort] = await Promise.all([getFreePort(), getFreePort()])
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env["VITEST"]
  delete env["VITEST_WORKER_ID"]
  delete env["VITEST_POOL_ID"]
  env["PORT"] = String(appPort)
  env["DEVTOOLS_PORT"] = String(dtPort)

  const logs: Array<string> = []
  const child = spawn(process.execPath, ["scripts/dev.ts"], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  })

  let ready = false
  const onChunk = (chunk: Buffer) => {
    const text = chunk.toString("utf8")
    logs.push(text)
    if (text.includes(`http://localhost:${appPort}`)) ready = true
  }
  child.stdout.on("data", onChunk)
  child.stderr.on("data", onChunk)

  const appUrl = `http://127.0.0.1:${appPort}`
  const devToolsUrl = `http://127.0.0.1:${dtPort}`

  try {
    await waitFor(async () => {
      if (child.exitCode !== null) {
        throw new Error(`scripts/dev.ts exited early with code ${child.exitCode}:\n${logs.join("")}`)
      }
      if (!ready) return undefined
      const res = await httpRequest(`${devToolsUrl}/`)
      return res.status === 200 ? true : undefined
    }, `dev server (${appUrl}) and DevTools (${devToolsUrl})`)
  } catch (error) {
    await stopChild(child)
    throw error
  }

  return {
    appUrl,
    devToolsUrl,
    stop: () => stopChild(child)
  }
}

const parseMcpPayload = (contentType: string, raw: string): string => {
  if (!contentType.includes("text/event-stream")) return raw
  const dataLines = raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter((line) => line.length > 0)
  const last = dataLines.at(-1)
  if (last === undefined) throw new Error(`Empty SSE response from MCP:\n${raw}`)
  return last
}

const mcpInitialize = async (devToolsUrl: string): Promise<string | undefined> => {
  const res = await httpRequest(`${devToolsUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "devtools-e2e-test", version: "1.0.0" }
      }
    })
  })
  expect(res.status).toBe(200)
  return headerValue(res.headers, "mcp-session-id")
}

let nextMcpId = 2
const mcpCallTool = async (
  devToolsUrl: string,
  sessionId: string | undefined,
  name: string,
  args: Readonly<Record<string, unknown>> = {}
): Promise<string> => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream"
  }
  if (sessionId !== undefined) headers["mcp-session-id"] = sessionId
  const res = await httpRequest(`${devToolsUrl}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextMcpId++,
      method: "tools/call",
      params: { name, arguments: args }
    })
  })
  expect(res.status).toBe(200)
  const payload = parseMcpPayload(headerValue(res.headers, "content-type") ?? "", res.body)
  const parsed = decodeToolCallResponse(payload)
  const text = parsed.result.content[0]?.text
  if (text === undefined) throw new Error(`MCP tool ${name} returned no text content: ${payload}`)
  return text
}

const extractDevToolsMetaContent = (html: string): string => {
  const match = html.match(/<meta\s+name="effect-ui-devtools"\s+content=(?:"([^"]*)"|'([^']*)')/i)
  const raw = match?.[1] ?? match?.[2]
  if (raw === undefined) {
    throw new Error(`Missing <meta name="effect-ui-devtools"> in dev HTML:\n${html.slice(0, 1000)}`)
  }
  return raw.replaceAll("&quot;", '"').replaceAll("&amp;", "&")
}

const extractElementInnerHtml = (html: string, id: string): string => {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, "text/html")
  const el = doc.getElementById(id)
  if (el === null) throw new Error(`Missing #${id} in SSR HTML`)
  return el.innerHTML
}

const extractElementText = (html: string, id: string): string | undefined => {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, "text/html")
  return doc.getElementById(id)?.textContent ?? undefined
}

describe("dev server DevTools integration (end-to-end)", () => {
  it("transforms dev HTML and populates both the in-page overlay and DevToolsServer MCP live", async () => {
    const devServer = await startDevServer()
    const metaEl = document.createElement("meta")
    const appContainer = document.createElement("div")
    appContainer.id = "app"
    const scope = Scope.makeUnsafe()

    // test/setup.ts replaces requestAnimationFrame with a manual test queue; restore real timer-backed frames
    // so BrowserHost and the DevTools overlay run live without TestHost.
    const views = [
      ...new Set([window, document.defaultView].filter((v): v is Window & typeof globalThis => v !== null))
    ]
    const savedRaf = views.map((v) => [v, v.requestAnimationFrame, v.cancelAnimationFrame] as const)
    for (const view of views) {
      view.requestAnimationFrame = (cb: FrameRequestCallback) => Number(setTimeout(() => cb(Date.now()), 0))
      view.cancelAnimationFrame = (id: number) => clearTimeout(id)
    }

    try {
      // 1. Dev HTML transform: GET /products and HEAD /products
      const getRes = await httpRequest(`${devServer.appUrl}/products`)
      expect(getRes.status).toBe(200)
      const html = getRes.body

      const metaContent = extractDevToolsMetaContent(html)
      const meta = decodeMeta(metaContent)
      expect(meta.url).toBe(devServer.devToolsUrl)
      expect(meta.size).toBeGreaterThan(0)

      const viteClientMatches = html.match(/\/@vite\/client/g) ?? []
      expect(viteClientMatches).toHaveLength(1)
      expect(html).toContain("/@effect-ui/hot")
      expect(html).not.toContain("/@effect-ui/devtools")

      const headRes = await httpRequest(`${devServer.appUrl}/products`, { method: "HEAD" })
      expect(headRes.status).toBe(200)
      expect(headerValue(headRes.headers, "content-length")).toBe(String(Buffer.byteLength(html)))

      // 2. Inject the served <meta name="effect-ui-devtools"> into document.head and hydrate App
      metaEl.name = "effect-ui-devtools"
      metaEl.content = metaContent
      document.head.append(metaEl)

      window.history.replaceState(null, "", "/products")
      appContainer.innerHTML = extractElementInnerHtml(html, "app")
      document.body.append(appContainer)

      const ssrState = State.readState(extractElementText(html, "state"))
      const side = Helpers.makeSide()

      const bootLayer = Layer.mergeAll(
        BrowserRouter.layer({ routes: Routes.AppRoute }),
        DevTools.layer({ position: "BottomRight" }),
        TestRpc.makeCountingRpcProtocol()
      )

      const runtimeContext = await Effect.runPromise(Layer.buildWithScope(bootLayer, scope))
      await Effect.runPromise(
        Bootstrap.boot({
          container: appContainer,
          location: "/products",
          state: ssrState,
          bundle: side
        }).pipe(Effect.provideContext(runtimeContext), Effect.provideService(Scope.Scope, scope))
      )

      // 3. Assert in-page DevTools overlay iframe is mounted and populated
      const iframe = await waitFor(async () => {
        const el = document.querySelector("iframe[data-effect-ui-devtools]")
        if (!(el instanceof HTMLIFrameElement)) return undefined
        const inner = el.contentDocument
        return inner !== null && inner.body.childElementCount > 0 ? el : undefined
      }, "in-page DevTools overlay iframe")
      expect(iframe).toBeInstanceOf(HTMLIFrameElement)

      // 4. Assert live DevToolsServer MCP populates session + entries
      const mcpSessionId = await mcpInitialize(devServer.devToolsUrl)

      const activeSession = await waitFor(async () => {
        const text = await mcpCallTool(devServer.devToolsUrl, mcpSessionId, "list_sessions")
        const { result: sessions } = decodeListSessions(text)
        return sessions.find(
          (session) =>
            session.app === "App" &&
            session.connected &&
            session.controllable &&
            session.entries > 0 &&
            session.instances > 0
        )
      }, "connected & controllable App session in DevToolsServer MCP")

      expect(activeSession.app).toBe("App")
      expect(activeSession.connected).toBe(true)
      expect(activeSession.controllable).toBe(true)
      expect(activeSession.entries).toBeGreaterThan(0)
      expect(activeSession.instances).toBeGreaterThan(0)

      // 5. Trigger a real UI interaction (compare toggle button) and verify Update entry arrives
      const compareButton = appContainer.querySelector("li button")
      expect(compareButton).not.toBeNull()
      if (compareButton instanceof HTMLElement) {
        compareButton.click()
      }

      const entries = await waitFor(async () => {
        const text = await mcpCallTool(devServer.devToolsUrl, mcpSessionId, "list_entries", {
          session: activeSession.session
        })
        const {
          result: { rows }
        } = decodeListEntries(text)
        const tags = new Set(rows.map((entry) => entry.tag))
        return tags.has("SessionStarted") && tags.has("Mounted") && tags.has("Update") ? rows : undefined
      }, "SessionStarted, Mounted, and Update entries in MCP list_entries")

      const tags = new Set(entries.map((entry) => entry.tag))
      expect(tags.has("SessionStarted")).toBe(true)
      expect(tags.has("Mounted")).toBe(true)
      expect(tags.has("Update")).toBe(true)
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void)).catch(() => undefined)
      for (const [view, raf, caf] of savedRaf) {
        view.requestAnimationFrame = raf
        view.cancelAnimationFrame = caf
      }
      appContainer.remove()
      metaEl.remove()
      await devServer.stop()
    }
  }, 30_000)
})
