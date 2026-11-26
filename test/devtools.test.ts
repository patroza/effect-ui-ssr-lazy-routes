import { spawn, type ChildProcess } from "node:child_process"
import { request as nodeHttpRequest } from "node:http"
import { createServer, type Server as NetServer } from "node:net"
import { BrowserRouter } from "@effect/ui/html"
import { DevTools } from "@effect/ui-devtools"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Layer, Schema, Scope } from "effect"
import {
  DEFAULT_APP_PORT,
  DEFAULT_DEVTOOLS_PORT,
  DEVTOOLS_HOST,
  DEVTOOLS_PORT_OFFSET,
  getEphemeralPort,
  isPortAvailable,
  parseAppPort,
  parseDevToolsPort,
  resolveDevToolsPort
} from "../scripts/lib/dev-ports.ts"
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
    req.setTimeout(5_000, () => {
      req.destroy(new Error(`HTTP request timed out: ${options.method ?? "GET"} ${urlString}`))
    })
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

const occupyPort = (port: number, host: string = DEVTOOLS_HOST): Promise<NetServer> =>
  new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.once("error", reject)
    srv.once("listening", () => resolve(srv))
    srv.listen(port, host)
  })

const closeServer = (server: NetServer): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => resolve())
  })

const findFreePortRange = async (count: number): Promise<number> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const base = await getEphemeralPort()
    if (base + count - 1 > 65535) continue
    let allFree = true
    for (let offset = 0; offset < count; offset += 1) {
      if (!(await isPortAvailable(base + offset))) {
        allFree = false
        break
      }
    }
    if (allFree) return base
  }
  throw new Error(`Could not find ${count} consecutive free ports`)
}

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
  readonly appPort: number
  readonly devToolsPort: number
  readonly appUrl: string
  readonly devToolsUrl: string
  readonly stop: () => Promise<void>
}

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_RE = /\u001b\[[0-9;]*m/g
const DEV_SERVER_LINE_RE = /dev server on http:\/\/localhost:(\d+)/
const DEVTOOLS_LINE_RE = /Effect UI DevTools:\s*http:\/\/127\.0\.0\.1:(\d+)/

const parseAnnouncedPorts = (
  output: string
): { readonly appPort: number; readonly devToolsPort: number } | undefined => {
  const clean = output.replace(ANSI_ESCAPE_RE, "")
  const appMatch = clean.match(DEV_SERVER_LINE_RE)
  const dtMatch = clean.match(DEVTOOLS_LINE_RE)
  if (appMatch?.[1] === undefined || dtMatch?.[1] === undefined) return undefined
  return {
    appPort: Number(appMatch[1]),
    devToolsPort: Number(dtMatch[1])
  }
}

const startDevServer = async (
  envOverrides: {
    readonly PORT?: string
    readonly DEVTOOLS_PORT?: string
  } = { PORT: "0" }
): Promise<RunningDevServer> => {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env["VITEST"]
  delete env["VITEST_WORKER_ID"]
  delete env["VITEST_POOL_ID"]
  delete env["PORT"]
  delete env["DEVTOOLS_PORT"]
  if (envOverrides.PORT !== undefined) env["PORT"] = envOverrides.PORT
  if (envOverrides.DEVTOOLS_PORT !== undefined) env["DEVTOOLS_PORT"] = envOverrides.DEVTOOLS_PORT

  let output = ""
  const child = spawn(process.execPath, ["scripts/dev.ts"], {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  })

  const onChunk = (chunk: Buffer) => {
    output += chunk.toString("utf8")
  }
  child.stdout.on("data", onChunk)
  child.stderr.on("data", onChunk)

  let announced: { readonly appPort: number; readonly devToolsPort: number }
  try {
    announced = await waitFor(async () => {
      if (child.exitCode !== null) {
        throw new Error(`scripts/dev.ts exited early with code ${child.exitCode}:\n${output}`)
      }
      const ports = parseAnnouncedPorts(output)
      if (ports === undefined) return undefined
      const res = await httpRequest(`http://127.0.0.1:${ports.devToolsPort}/`)
      return res.status === 200 ? ports : undefined
    }, "dev server and DevTools startup")
  } catch (error) {
    await stopChild(child)
    throw error
  }

  return {
    appPort: announced.appPort,
    devToolsPort: announced.devToolsPort,
    appUrl: `http://127.0.0.1:${announced.appPort}`,
    devToolsUrl: `http://127.0.0.1:${announced.devToolsPort}`,
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

interface McpClient {
  readonly callTool: (name: string, args?: Readonly<Record<string, unknown>>) => Promise<string>
}

const createMcpClient = async (devToolsUrl: string): Promise<McpClient> => {
  let nextId = 1
  const initRes = await httpRequest(`${devToolsUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextId++,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "devtools-e2e-test", version: "1.0.0" }
      }
    })
  })
  expect(initRes.status).toBe(200)
  const sessionId = headerValue(initRes.headers, "mcp-session-id")

  return {
    callTool: async (name: string, args: Readonly<Record<string, unknown>> = {}): Promise<string> => {
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
          id: nextId++,
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
  }
}

const extractDevToolsMetaContent = (html: string): string => {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, "text/html")
  const content = doc.querySelector('meta[name="effect-ui-devtools"]')?.getAttribute("content")
  if (content === null || content === undefined) {
    throw new Error(`Missing <meta name="effect-ui-devtools"> in dev HTML:\n${html.slice(0, 1000)}`)
  }
  return content
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

describe("dev server port parsing and automatic DevTools port selection", () => {
  it("parses PORT strictly (unset/empty -> 5173, 0..65535 valid, rejects malformed inputs)", () => {
    expect(parseAppPort(undefined)).toBe(DEFAULT_APP_PORT)
    expect(parseAppPort("")).toBe(DEFAULT_APP_PORT)
    expect(parseAppPort("0")).toBe(0)
    expect(parseAppPort("5180")).toBe(5180)
    expect(parseAppPort("65535")).toBe(65535)

    for (const invalid of ["5173 ", " 5173", "0x10", "1e3", "5173.0", "-1", "65536", "abc"]) {
      expect(() => parseAppPort(invalid)).toThrow(RangeError)
    }
  })

  it("parses DEVTOOLS_PORT strictly (unset/empty -> undefined, 1..65535 valid, rejects malformed inputs)", () => {
    expect(parseDevToolsPort(undefined)).toBeUndefined()
    expect(parseDevToolsPort("")).toBeUndefined()
    expect(parseDevToolsPort("1")).toBe(1)
    expect(parseDevToolsPort("4774")).toBe(4774)
    expect(parseDevToolsPort("65535")).toBe(65535)

    for (const invalid of ["0", "4774 ", " 4774", "0x10", "1e3", "4774.0", "-1", "65536", "abc"]) {
      expect(() => parseDevToolsPort(invalid)).toThrow(RangeError)
    }
  })

  it("keeps an explicitly requested DEVTOOLS_PORT fixed even when busy", async () => {
    const busyPort = await getEphemeralPort()
    const blocker = await occupyPort(busyPort)
    try {
      const resolved = await resolveDevToolsPort({
        actualAppPort: 5180,
        appPortEnv: "5180",
        devToolsPortEnv: String(busyPort)
      })
      expect(resolved).toBe(busyPort)
    } finally {
      await closeServer(blocker)
    }
  })

  it("starts at actualAppPort + 2 for dynamic/custom ports and cycles upward when occupied", async () => {
    const basePort = await findFreePortRange(5)
    const expectedStart = basePort + DEVTOOLS_PORT_OFFSET

    const freeResolved = await resolveDevToolsPort({
      actualAppPort: basePort,
      appPortEnv: "0",
      devToolsPortEnv: undefined
    })
    expect(freeResolved).toBe(expectedStart)

    const blocker1 = await occupyPort(expectedStart)
    const blocker2 = await occupyPort(expectedStart + 1)
    try {
      const cycled = await resolveDevToolsPort({
        actualAppPort: basePort,
        appPortEnv: "0",
        devToolsPortEnv: undefined
      })
      expect(cycled).toBe(expectedStart + 2)

      const cycledWithZeroDevTools = await resolveDevToolsPort({
        actualAppPort: basePort,
        appPortEnv: undefined,
        devToolsPortEnv: "0"
      })
      expect(cycledWithZeroDevTools).toBe(expectedStart + 2)
    } finally {
      await Promise.all([closeServer(blocker1), closeServer(blocker2)])
    }
  })

  it("wraps to 4774 when actualAppPort + 2 exceeds 65535 and falls back to an ephemeral port after maxAttempts", async () => {
    const basePort = await findFreePortRange(4)
    const blocker1 = await occupyPort(basePort + 2)
    const blocker2 = await occupyPort(basePort + 3)
    try {
      const fallback = await resolveDevToolsPort({
        actualAppPort: basePort,
        appPortEnv: String(basePort),
        devToolsPortEnv: undefined,
        maxAttempts: 2
      })
      expect(fallback).toBeGreaterThan(0)
      expect(fallback).toBeLessThanOrEqual(65535)
      expect(fallback).not.toBe(basePort + 2)
      expect(fallback).not.toBe(basePort + 3)
    } finally {
      await Promise.all([closeServer(blocker1), closeServer(blocker2)])
    }

    const wrapped = await resolveDevToolsPort({
      actualAppPort: 65535,
      appPortEnv: "65535",
      devToolsPortEnv: undefined
    })
    expect(wrapped).toBeGreaterThanOrEqual(DEFAULT_DEVTOOLS_PORT)
  })
})

describe("dev server DevTools integration (end-to-end)", () => {
  it("runs cleanly with PORT=0 and DEVTOOLS_PORT unset, populating overlay and DevToolsServer MCP live", async () => {
    const devServer = await startDevServer({ PORT: "0" })
    const metaEl = document.createElement("meta")
    const appContainer = document.createElement("div")
    appContainer.id = "app"
    const scope = Scope.makeUnsafe()
    const savedLocation = window.location.pathname + window.location.search + window.location.hash

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
      expect(devServer.appPort).toBeGreaterThan(0)
      expect(devServer.devToolsPort).toBeGreaterThan(0)
      expect(devServer.devToolsPort).not.toBe(devServer.appPort)
      if (devServer.appPort + DEVTOOLS_PORT_OFFSET <= 65535) {
        expect(devServer.devToolsPort).toBeGreaterThanOrEqual(devServer.appPort + DEVTOOLS_PORT_OFFSET)
      }

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
      const mcp = await createMcpClient(devServer.devToolsUrl)

      const activeSession = await waitFor(async () => {
        const text = await mcp.callTool("list_sessions")
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
        const text = await mcp.callTool("list_entries", {
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
      window.history.replaceState(null, "", savedLocation)
      for (const [view, raf, caf] of savedRaf) {
        view.requestAnimationFrame = raf
        view.cancelAnimationFrame = caf
      }
      appContainer.remove()
      metaEl.remove()
      await devServer.stop()
    }
  }, 30_000)

  it("skips an occupied appPort + 2 DevTools port and binds the next free port automatically", async () => {
    const appPort = await findFreePortRange(4)
    const occupiedDevToolsPort = appPort + DEVTOOLS_PORT_OFFSET
    const blocker = await occupyPort(occupiedDevToolsPort)
    let devServer: RunningDevServer | undefined

    try {
      devServer = await startDevServer({ PORT: String(appPort) })
      expect(devServer.appPort).toBe(appPort)
      expect(devServer.devToolsPort).not.toBe(occupiedDevToolsPort)
      expect(devServer.devToolsPort).toBe(occupiedDevToolsPort + 1)

      const res = await httpRequest(`${devServer.appUrl}/products`)
      expect(res.status).toBe(200)
      const meta = decodeMeta(extractDevToolsMetaContent(res.body))
      expect(meta.url).toBe(devServer.devToolsUrl)
    } finally {
      await devServer?.stop()
      await closeServer(blocker)
    }
  }, 30_000)
})
