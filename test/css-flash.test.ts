// @vitest-environment node
import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Schema } from "effect"
import { afterAll, describe, expect, it } from "vite-plus/test"
import * as JsonString from "../src/lib/jsonString.ts"
import * as Proc from "./support/process.ts"

const repoRoot = process.cwd()

interface RunningServer {
  readonly url: string
  readonly stop: () => Promise<void>
}

const startDevServer = async (): Promise<RunningServer> => {
  let output = ""
  const child = spawn(process.execPath, ["scripts/dev.ts"], {
    cwd: repoRoot,
    env: Proc.cleanChildEnv(),
    stdio: ["ignore", "pipe", "pipe"]
  })
  const onChunk = (chunk: Buffer) => {
    output += chunk.toString("utf8")
  }
  child.stdout.on("data", onChunk)
  child.stderr.on("data", onChunk)

  try {
    const port = await Proc.waitFor(async () => {
      if (child.exitCode !== null) {
        throw new Error(`scripts/dev.ts exited early (${child.exitCode}):\n${output}`)
      }
      const clean = output.replace(Proc.ANSI_ESCAPE_RE, "")
      const match = /dev server on http:\/\/localhost:(\d+)/.exec(clean)
      return match?.[1] === undefined ? undefined : Number(match[1])
    }, "dev server startup")
    return {
      url: `http://127.0.0.1:${port}`,
      stop: () => Proc.stopChild(child)
    }
  } catch (error) {
    await Proc.stopChild(child)
    throw error
  }
}

const startProdServer = async (): Promise<RunningServer> => {
  let output = ""
  const child = spawn(process.execPath, ["dist/server/serve.js"], {
    cwd: repoRoot,
    env: Proc.cleanChildEnv(),
    stdio: ["ignore", "pipe", "pipe"]
  })
  const onChunk = (chunk: Buffer) => {
    output += chunk.toString("utf8")
  }
  child.stdout.on("data", onChunk)
  child.stderr.on("data", onChunk)

  try {
    const port = await Proc.waitFor(async () => {
      if (child.exitCode !== null) {
        throw new Error(`dist/server/serve.js exited early (${child.exitCode}):\n${output}`)
      }
      const match = /listening on http:\/\/localhost:(\d+)/.exec(output)
      return match?.[1] === undefined ? undefined : Number(match[1])
    }, "production server startup")
    return {
      url: `http://127.0.0.1:${port}`,
      stop: () => Proc.stopChild(child)
    }
  } catch (error) {
    await Proc.stopChild(child)
    throw error
  }
}

const findChromiumBinary = (): string | undefined => {
  for (const candidate of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    try {
      const resolved = execFileSync("which", [candidate], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim()
      if (resolved.length > 0 && existsSync(resolved)) return resolved
    } catch {
      // Try next candidate
    }
  }
  for (const fallback of ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"]) {
    if (existsSync(fallback)) return fallback
  }
  return undefined
}

const TargetInfoSchema = Schema.Struct({
  type: Schema.String,
  webSocketDebuggerUrl: Schema.optionalKey(Schema.String)
})
const decodeTargets = Schema.decodeUnknownSync(JsonString.jsonString(Schema.Array(TargetInfoSchema)))

const CdpResponseSchema = Schema.Struct({
  id: Schema.optionalKey(Schema.Finite),
  method: Schema.optionalKey(Schema.String),
  result: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  error: Schema.optionalKey(
    Schema.Struct({
      code: Schema.Finite,
      message: Schema.String
    })
  )
})
const decodeCdpResponse = Schema.decodeUnknownSync(JsonString.jsonString(CdpResponseSchema))

const RuntimeEvalEnvelopeSchema = Schema.Struct({
  result: Schema.Struct({
    value: Schema.optionalKey(Schema.String),
    description: Schema.optionalKey(Schema.String)
  }),
  exceptionDetails: Schema.optionalKey(
    Schema.Struct({
      text: Schema.String,
      exception: Schema.optionalKey(
        Schema.Struct({
          description: Schema.optionalKey(Schema.String)
        })
      )
    })
  )
})
const decodeEvalEnvelope = Schema.decodeUnknownSync(JsonString.jsonString(RuntimeEvalEnvelopeSchema))

const StyleSampleSchema = Schema.Struct({
  phase: Schema.String,
  readyState: Schema.String,
  bodyMaxWidth: Schema.String,
  bodyPaddingTop: Schema.String,
  activeLocaleBg: Schema.NullOr(Schema.String),
  inactiveLocaleBg: Schema.NullOr(Schema.String),
  activeBorderRadius: Schema.NullOr(Schema.String),
  chartDisplay: Schema.NullOr(Schema.String),
  chartRadius: Schema.NullOr(Schema.String),
  directLinkCount: Schema.Finite,
  stylesheetLinkCount: Schema.Finite,
  viteStyleCount: Schema.Finite,
  sheetCount: Schema.Finite
})

const ChartFirstSeenSchema = Schema.Struct({
  display: Schema.String,
  borderTopLeftRadius: Schema.String,
  bodyMaxWidth: Schema.String,
  directLinkCount: Schema.Finite,
  viteStyleCount: Schema.Finite
})

const PageSnapshotSchema = Schema.Struct({
  lang: Schema.String,
  pathname: Schema.String,
  hydrated: Schema.Boolean,
  markerOldPage: Schema.Boolean,
  samples: Schema.Array(StyleSampleSchema),
  firstPaintMs: Schema.NullOr(Schema.Finite),
  blockingCssEndMs: Schema.NullOr(Schema.Finite),
  directLinkCount: Schema.Finite,
  viteStyleCount: Schema.Finite,
  sheetCount: Schema.Finite,
  bodyMaxWidth: Schema.String,
  hasOrderPage: Schema.Boolean,
  chartFirstSeen: Schema.NullOr(ChartFirstSeenSchema),
  chartDisplay: Schema.NullOr(Schema.String),
  chartRadius: Schema.NullOr(Schema.String)
})
type PageSnapshot = typeof PageSnapshotSchema.Type

const documentProbeScript = `(() => {
  const sample = (phase) => {
    const body = document.body
    if (body === null) return null
    const bodyStyle = getComputedStyle(body)
    const activeBtn = document.querySelector('button[data-testid^="locale-switch-"][aria-pressed="true"]')
    const inactiveBtn = document.querySelector('button[data-testid^="locale-switch-"][aria-pressed="false"]')
    const activeStyle = activeBtn ? getComputedStyle(activeBtn) : null
    const inactiveStyle = inactiveBtn ? getComputedStyle(inactiveBtn) : null
    const chart = document.querySelector(".analytics-chart")
    const chartStyle = chart ? getComputedStyle(chart) : null
    return {
      phase,
      readyState: document.readyState,
      bodyMaxWidth: bodyStyle.maxWidth,
      bodyPaddingTop: bodyStyle.paddingTop,
      activeLocaleBg: activeStyle ? activeStyle.backgroundColor : null,
      inactiveLocaleBg: inactiveStyle ? inactiveStyle.backgroundColor : null,
      activeBorderRadius: activeStyle ? activeStyle.borderRadius : null,
      chartDisplay: chartStyle ? chartStyle.display : null,
      chartRadius: chartStyle ? chartStyle.borderTopLeftRadius : null,
      directLinkCount: document.querySelectorAll('link[rel="stylesheet"][href*="?direct"]').length,
      stylesheetLinkCount: document.querySelectorAll('link[rel="stylesheet"]').length,
      viteStyleCount: document.querySelectorAll('style[data-vite-dev-id]').length,
      sheetCount: document.styleSheets.length
    }
  }

  const samples = []
  window.cssFlashSamples = samples
  window.csrAnalyticsFirstSeen = null

  const push = (phase) => {
    const s = sample(phase)
    if (s !== null) samples.push(s)
  }

  let frames = 25
  const pump = () => {
    push("raf-" + (25 - frames))
    frames -= 1
    if (frames > 0) requestAnimationFrame(pump)
  }
  requestAnimationFrame(pump)

  const observer = new MutationObserver(() => {
    if (document.readyState === "complete" && window.csrAnalyticsFirstSeen === null) {
      const chart = document.querySelector(".analytics-chart")
      if (chart !== null) {
        const chartStyle = getComputedStyle(chart)
        const bodyStyle = document.body ? getComputedStyle(document.body) : null
        window.csrAnalyticsFirstSeen = {
          display: chartStyle.display,
          borderTopLeftRadius: chartStyle.borderTopLeftRadius,
          bodyMaxWidth: bodyStyle ? bodyStyle.maxWidth : "none",
          directLinkCount: document.querySelectorAll('link[rel="stylesheet"][href*="?direct"]').length,
          viteStyleCount: document.querySelectorAll('style[data-vite-dev-id]').length
        }
      }
    }
  })
  // Observe document rather than document.documentElement because documentElement is null at NewDocument time.
  observer.observe(document, { childList: true, subtree: true })

  document.addEventListener("DOMContentLoaded", () => push("domcontentloaded"))
  window.addEventListener("load", () => push("load"))
})()`

interface BrowserSession {
  readonly send: (method: string, params?: Readonly<Record<string, unknown>>) => Promise<string>
  readonly evaluateRawJson: (expression: string) => Promise<string>
  readonly exceptions: ReadonlyArray<string>
  readonly clearExceptions: () => void
  readonly close: () => Promise<void>
}

const openChromiumSession = async (executablePath: string): Promise<BrowserSession> => {
  // Keep TMPDIR and --user-data-dir short so Linux Chromium's SingletonSocket stays under the 107-byte sun_path limit.
  const shortTmp = existsSync("/tmp") ? "/tmp" : tmpdir()
  const userDataDir = mkdtempSync(join(shortTmp, "chr-css-"))
  let stderr = ""
  const browser = spawn(
    executablePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "about:blank"
    ],
    { cwd: repoRoot, env: { ...process.env, TMPDIR: shortTmp }, stdio: ["ignore", "ignore", "pipe"] }
  )
  browser.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8")
  })

  try {
    const debugPort = await Proc.waitFor(async () => {
      if (browser.exitCode !== null) {
        throw new Error(`Chromium exited early (${browser.exitCode}):\n${stderr}`)
      }
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderr)
      if (match?.[1] === undefined) return undefined
      return new URL(match[1]).port
    }, "Chromium DevTools WebSocket port")

    const pageWsUrl = await Proc.waitFor(async () => {
      const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      if (!res.ok) return undefined
      const targets = decodeTargets(await res.text())
      return targets.find((target) => target.type === "page")?.webSocketDebuggerUrl
    }, "Chromium page target")

    const ws = new WebSocket(pageWsUrl)
    await new Promise<void>((resolve, reject) => {
      function onError() {
        ws.removeEventListener("open", onOpen)
        reject(new Error(`Failed to open CDP WebSocket: ${pageWsUrl}`))
      }
      function onOpen() {
        ws.removeEventListener("error", onError)
        resolve()
      }
      ws.addEventListener("open", onOpen, { once: true })
      ws.addEventListener("error", onError, { once: true })
    })

    let nextId = 1
    const pending = new Map<
      number,
      { readonly resolve: (resultJson: string) => void; readonly reject: (error: Error) => void }
    >()
    const exceptions: Array<string> = []

    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return
      const msg = decodeCdpResponse(event.data)
      if (msg.id !== undefined) {
        const waiter = pending.get(msg.id)
        if (waiter === undefined) return
        pending.delete(msg.id)
        if (msg.error !== undefined) {
          waiter.reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`))
        } else {
          waiter.resolve(typeof msg.result === "object" ? JSON.stringify(msg.result) : "{}")
        }
        return
      }
      if (msg.method === "Runtime.exceptionThrown") {
        exceptions.push(event.data)
      }
    })

    const send = (method: string, params: Readonly<Record<string, unknown>> = {}): Promise<string> =>
      new Promise((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        ws.send(JSON.stringify({ id, method, params }))
      })

    const evaluateRawJson = async (expression: string): Promise<string> => {
      const envelope = decodeEvalEnvelope(
        await send("Runtime.evaluate", {
          expression: `JSON.stringify((${expression}))`,
          returnByValue: true,
          awaitPromise: true
        })
      )
      if (envelope.exceptionDetails !== undefined) {
        throw new Error(
          envelope.exceptionDetails.exception?.description ?? envelope.exceptionDetails.text ?? "Runtime.evaluate error"
        )
      }
      if (envelope.result.value === undefined) {
        throw new Error(`Expected JSON string result, got ${envelope.result.description ?? "undefined"}`)
      }
      return envelope.result.value
    }

    await send("Page.enable")
    await send("Runtime.enable")
    await send("Page.addScriptToEvaluateOnNewDocument", { source: documentProbeScript })

    return {
      send,
      evaluateRawJson,
      exceptions,
      clearExceptions: () => {
        exceptions.length = 0
      },
      close: async () => {
        for (const waiter of pending.values()) {
          waiter.reject(new Error("Browser session closed"))
        }
        pending.clear()
        ws.close()
        await Proc.stopChild(browser)
        rmSync(userDataDir, { recursive: true, force: true })
      }
    }
  } catch (error) {
    await Proc.stopChild(browser)
    rmSync(userDataDir, { recursive: true, force: true })
    throw error
  }
}

const readSnapshotExpr = `(() => {
  const app = document.getElementById("app")
  const chart = document.querySelector(".analytics-chart")
  const chartStyle = chart ? getComputedStyle(chart) : null
  const bodyStyle = document.body ? getComputedStyle(document.body) : null
  const paints = performance.getEntriesByType("paint")
  const fcp = paints.find((e) => e.name === "first-contentful-paint") ?? paints.find((e) => e.name === "first-paint") ?? null
  const mainCss = performance.getEntriesByType("resource").filter((e) =>
    e.name.includes("/src/index.css?direct") ||
    e.name.includes("/src/analytics/components/chart.css?direct") ||
    /\\/assets\\/(main|AnalyticsPage)-.*\\.css$/.test(new URL(e.name).pathname)
  )
  const blockingCssEndMs = mainCss.length > 0 ? Math.max(...mainCss.map((e) => e.responseEnd)) : null
  return {
    lang: document.documentElement.lang,
    pathname: window.location.pathname,
    hydrated: app?.getAttribute("data-hydrated") === "true",
    markerOldPage: window.cssOldPageMarker === true,
    samples: Array.isArray(window.cssFlashSamples) ? window.cssFlashSamples : [],
    firstPaintMs: fcp ? fcp.startTime : null,
    blockingCssEndMs,
    directLinkCount: document.querySelectorAll('link[rel="stylesheet"][href*="?direct"]').length,
    viteStyleCount: document.querySelectorAll('style[data-vite-dev-id]').length,
    sheetCount: document.styleSheets.length,
    bodyMaxWidth: bodyStyle ? bodyStyle.maxWidth : "none",
    hasOrderPage: document.querySelector('[data-page-chunk="SENTINEL:order-form-page"]') !== null,
    chartFirstSeen: window.csrAnalyticsFirstSeen ?? null,
    chartDisplay: chartStyle ? chartStyle.display : null,
    chartRadius: chartStyle ? chartStyle.borderTopLeftRadius : null
  }
})()`

const assertZeroFoucLoad = (snap: PageSnapshot, label: string): void => {
  expect(snap.blockingCssEndMs, `${label}: missing blocking main stylesheet ResourceTiming`).not.toBeNull()
  expect(snap.firstPaintMs, `${label}: missing PaintTiming entry`).not.toBeNull()
  if (snap.firstPaintMs !== null && snap.blockingCssEndMs !== null) {
    expect(snap.firstPaintMs, `${label}: painted before main CSS finished loading`).toBeGreaterThanOrEqual(
      snap.blockingCssEndMs - 1
    )
  }

  const samples = snap.samples
  expect(samples.length, `${label}: expected multiple style samples`).toBeGreaterThanOrEqual(8)
  expect(
    samples.some((s) => s.phase === "domcontentloaded"),
    `${label}: missing domcontentloaded sample`
  ).toBe(true)

  for (const sample of samples) {
    expect(sample.bodyMaxWidth, `${label} @ ${sample.phase}: body maxWidth`).toBe("768px")
    expect(sample.bodyPaddingTop, `${label} @ ${sample.phase}: body paddingTop`).toBe("16px")
    expect(sample.activeLocaleBg, `${label} @ ${sample.phase}: active locale bg`).not.toBeNull()
    expect(sample.inactiveLocaleBg, `${label} @ ${sample.phase}: inactive locale bg`).not.toBeNull()
    expect(sample.activeLocaleBg, `${label} @ ${sample.phase}: active vs inactive bg`).not.toBe(sample.inactiveLocaleBg)
    expect(sample.activeBorderRadius, `${label} @ ${sample.phase}: border radius`).toBe("6px")
  }

  const distinctActiveBgs = new Set(samples.map((s) => s.activeLocaleBg))
  expect(
    distinctActiveBgs.size,
    `${label}: active button background changed across frames (CSS transition flash)`
  ).toBe(1)
  const distinctRadii = new Set(samples.map((s) => s.activeBorderRadius))
  expect(distinctRadii.size, `${label}: active button border radius changed across frames`).toBe(1)
}

const decodeSnapshot = Schema.decodeUnknownSync(JsonString.jsonString(PageSnapshotSchema))
const decodeBoolean = Schema.decodeUnknownSync(JsonString.jsonString(Schema.Boolean))

const evaluateSnapshot = async (browser: BrowserSession): Promise<PageSnapshot> =>
  decodeSnapshot(await browser.evaluateRawJson(readSnapshotExpr))

const clickAndConfirm = async (browser: BrowserSession, expression: string): Promise<void> => {
  const ok = decodeBoolean(await browser.evaluateRawJson(expression))
  expect(ok).toBe(true)
}

const waitForHydratedLoad = (
  browser: BrowserSession,
  mode: "dev" | "prod",
  expectedLang: string
): Promise<PageSnapshot> =>
  Proc.waitFor(async () => {
    const snap = await evaluateSnapshot(browser)
    if (!snap.hydrated || snap.markerOldPage || snap.lang !== expectedLang) return undefined
    if (snap.firstPaintMs === null || snap.blockingCssEndMs === null) return undefined
    const rafCount = snap.samples.filter((s) => s.phase.startsWith("raf-")).length
    if (rafCount < 8 || !snap.samples.some((s) => s.phase === "domcontentloaded")) return undefined
    if (mode === "dev" && (snap.directLinkCount !== 0 || snap.viteStyleCount < 1)) return undefined
    return snap
  }, `${mode} hydrated page (${expectedLang})`)

const verifyServerZeroFlash = async (browser: BrowserSession, baseUrl: string, mode: "dev" | "prod"): Promise<void> => {
  browser.clearExceptions()

  // 1. Cold SSR load on /warehouse
  await browser.send("Page.navigate", { url: `${baseUrl}/warehouse` })
  const cold = await waitForHydratedLoad(browser, mode, "en")
  assertZeroFoucLoad(cold, `${mode} SSR cold /warehouse`)

  // 2. Reload on /warehouse
  await browser.send("Page.reload", { ignoreCache: false })
  const reloaded = await waitForHydratedLoad(browser, mode, "en")
  assertZeroFoucLoad(reloaded, `${mode} SSR reload /warehouse`)

  // 3. Progressive-enhancement locale switch EN -> DE (POST /locale -> 303 /warehouse)
  await clickAndConfirm(
    browser,
    `(() => {
      window.cssOldPageMarker = true
      const btn = document.querySelector('[data-testid="locale-switch-de"]')
      if (!(btn instanceof HTMLElement)) return false
      btn.click()
      return true
    })()`
  )
  const switchedDe = await waitForHydratedLoad(browser, mode, "de")
  assertZeroFoucLoad(switchedDe, `${mode} POST /locale DE reload`)

  // Switch back to EN so subsequent visits use default locale
  await clickAndConfirm(
    browser,
    `(() => {
      window.cssOldPageMarker = true
      const btn = document.querySelector('[data-testid="locale-switch-en"]')
      if (!(btn instanceof HTMLElement)) return false
      btn.click()
      return true
    })()`
  )
  await waitForHydratedLoad(browser, mode, "en")

  // 4. CSR navigation /warehouse -> /analytics (route-specific chart.css must apply on first frame!)
  await clickAndConfirm(
    browser,
    `(() => {
      const link = document.querySelector('a[href="/analytics"]')
      if (!(link instanceof HTMLElement)) return false
      link.click()
      return true
    })()`
  )
  const csrAnalytics = await Proc.waitFor(async () => {
    const snap = await evaluateSnapshot(browser)
    if (snap.pathname !== "/analytics" || snap.chartFirstSeen === null || snap.chartDisplay === null) return undefined
    if (mode === "dev" && (snap.directLinkCount !== 0 || snap.viteStyleCount < 2)) return undefined
    return snap
  }, `${mode} CSR navigation to /analytics`)
  expect(csrAnalytics.chartFirstSeen).not.toBeNull()
  expect(csrAnalytics.chartFirstSeen?.display).toBe("block")
  expect(csrAnalytics.chartFirstSeen?.borderTopLeftRadius).toBe("8px")
  expect(csrAnalytics.chartFirstSeen?.bodyMaxWidth).toBe("768px")
  expect(csrAnalytics.chartDisplay).toBe("block")
  expect(csrAnalytics.chartRadius).toBe("8px")

  // 5. CSR navigation /analytics -> /order (global styles stay active cleanly)
  await clickAndConfirm(
    browser,
    `(() => {
      const link = document.querySelector('a[href="/order"]')
      if (!(link instanceof HTMLElement)) return false
      link.click()
      return true
    })()`
  )
  const csrOrder = await Proc.waitFor(async () => {
    const snap = await evaluateSnapshot(browser)
    return snap.pathname === "/order" && snap.hasOrderPage ? snap : undefined
  }, `${mode} CSR navigation to /order`)
  expect(csrOrder.bodyMaxWidth).toBe("768px")
  expect(csrOrder.sheetCount).toBeGreaterThanOrEqual(1)

  // 6. Cold SSR load directly on /analytics (global CSS + route CSS both in <head> before paint)
  await browser.send("Page.navigate", { url: `${baseUrl}/analytics` })
  const ssrAnalytics = await Proc.waitFor(async () => {
    const snap = await evaluateSnapshot(browser)
    if (!snap.hydrated || snap.pathname !== "/analytics" || snap.chartDisplay === null) return undefined
    if (snap.firstPaintMs === null || snap.blockingCssEndMs === null) return undefined
    const rafCount = snap.samples.filter((s) => s.phase.startsWith("raf-")).length
    if (rafCount < 8 || !snap.samples.some((s) => s.phase === "domcontentloaded")) return undefined
    if (mode === "dev" && (snap.directLinkCount !== 0 || snap.viteStyleCount < 2)) return undefined
    return snap
  }, `${mode} SSR cold /analytics`)
  assertZeroFoucLoad(ssrAnalytics, `${mode} SSR cold /analytics`)
  for (const sample of ssrAnalytics.samples) {
    if (sample.chartDisplay !== null) {
      expect(sample.chartDisplay, `${mode} SSR cold /analytics @ ${sample.phase}`).toBe("block")
      expect(sample.chartRadius, `${mode} SSR cold /analytics @ ${sample.phase}`).toBe("8px")
    }
  }
  expect(ssrAnalytics.chartDisplay).toBe("block")
  expect(ssrAnalytics.chartRadius).toBe("8px")

  expect(browser.exceptions).toEqual([])
}

const chromiumBinary = findChromiumBinary()

describe("CSS zero-flash contract (dev SSR, HMR CSS cache isolation, and real Chromium)", () => {
  it("ships render-blocking ?direct stylesheets in dev SSR <head> without MIME cache collisions", async () => {
    const dev = await startDevServer()
    try {
      for (const route of [
        { path: "/", hasChartCss: false },
        { path: "/warehouse", hasChartCss: false },
        { path: "/order", hasChartCss: false },
        { path: "/analytics", hasChartCss: true }
      ]) {
        const res = await fetch(`${dev.url}${route.path}`)
        expect(res.status).toBe(200)
        const html = await res.text()
        const headEnd = html.indexOf("</head>")
        const bodyStart = html.indexOf("<body")
        const mainCssTag = '<link rel="stylesheet" href="/src/index.css?direct">'
        const chartCssTag = '<link rel="stylesheet" href="/src/analytics/components/chart.css?direct">'
        const mainScriptTag = '<script type="module" crossorigin src="/src/main.ts"></script>'

        expect(headEnd).toBeGreaterThan(-1)
        expect(html).toContain(mainCssTag)
        expect(html.indexOf(mainCssTag)).toBeLessThan(headEnd)
        expect(html.indexOf(mainCssTag)).toBeLessThan(bodyStart)
        expect(html.indexOf(mainCssTag)).toBeLessThan(html.indexOf(mainScriptTag))
        expect(html.includes(chartCssTag)).toBe(route.hasChartCss)
        if (route.hasChartCss) {
          expect(html.indexOf(chartCssTag)).toBeLessThan(headEnd)
        }
      }

      // Localized SSR (Cookie: locale=de) also ships blocking dev CSS in <head>
      const deRes = await fetch(`${dev.url}/warehouse`, { headers: { cookie: "locale=de" } })
      expect(deRes.status).toBe(200)
      const deHtml = await deRes.text()
      expect(deHtml).toContain('lang="de"')
      expect(deHtml).toContain('<link rel="stylesheet" href="/src/index.css?direct">')

      // `?direct` CSS requests return pure CSS (never JS wrapper); module CSS import returns Vite HMR JS module
      const directMainRes = await fetch(`${dev.url}/src/index.css?direct`, {
        headers: { accept: "text/css,*/*;q=0.1" }
      })
      const directMainCss = await directMainRes.text()
      expect(directMainRes.status).toBe(200)
      expect(directMainRes.headers.get("content-type") ?? "").toMatch(/^text\/css/)
      expect(directMainCss).toContain("bg-primary")
      expect(directMainCss).toContain("border-input")
      expect(directMainCss).not.toContain("__vite__updateStyle")

      const directChartRes = await fetch(`${dev.url}/src/analytics/components/chart.css?direct`, {
        headers: { accept: "text/css,*/*;q=0.1" }
      })
      const directChartCss = await directChartRes.text()
      expect(directChartRes.status).toBe(200)
      expect(directChartRes.headers.get("content-type") ?? "").toMatch(/^text\/css/)
      expect(directChartCss).toContain(".analytics-chart")

      const moduleMainRes = await fetch(`${dev.url}/src/index.css`, {
        headers: { accept: "*/*" }
      })
      const moduleMainJs = await moduleMainRes.text()
      expect(moduleMainRes.status).toBe(200)
      expect(moduleMainRes.headers.get("content-type") ?? "").toMatch(/^text\/javascript/)
      expect(moduleMainJs).toContain("__vite__updateStyle")
    } finally {
      await dev.stop()
    }
  }, 30_000)

  const itWithChromium = chromiumBinary === undefined ? it.skip : it
  let activeSession: BrowserSession | undefined
  afterAll(async () => {
    await activeSession?.close()
  })

  itWithChromium(
    "paints zero unstyled frames across dev and prod SSR load, reload, EN->DE switch, and CSR navigation",
    async () => {
      if (chromiumBinary === undefined) return
      const dev = await startDevServer()
      const hasProdBuild = existsSync(join(repoRoot, "dist/server/serve.js"))
      const prod = hasProdBuild ? await startProdServer() : undefined
      const browser = await openChromiumSession(chromiumBinary)
      activeSession = browser
      try {
        await verifyServerZeroFlash(browser, dev.url, "dev")
        if (prod !== undefined) {
          await verifyServerZeroFlash(browser, prod.url, "prod")
        }
      } finally {
        activeSession = undefined
        await Promise.all([browser.close(), dev.stop(), prod?.stop()])
      }
    },
    60_000
  )
})
