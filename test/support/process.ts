import type { ChildProcess } from "node:child_process"

// eslint-disable-next-line no-control-regex
export const ANSI_ESCAPE_RE = /\u001b\[[0-9;]*m/g

export const waitFor = async <A>(
  check: () => Promise<A | undefined>,
  label: string,
  timeoutMs = 20_000
): Promise<A> => {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const value = await check()
      if (value !== undefined) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  const detail =
    lastError === undefined
      ? ""
      : ` (last error: ${lastError instanceof Error ? lastError.message : JSON.stringify(lastError)})`
  throw new Error(`Timed out waiting for ${label}${detail}`)
}

export const stopChild = async (child: ChildProcess): Promise<void> => {
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

export const cleanChildEnv = (
  overrides: {
    readonly PORT?: string
    readonly DEVTOOLS_PORT?: string
  } = { PORT: "0" }
): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env["VITEST"]
  delete env["VITEST_WORKER_ID"]
  delete env["VITEST_POOL_ID"]
  delete env["PORT"]
  delete env["DEVTOOLS_PORT"]
  if (overrides.PORT !== undefined) env["PORT"] = overrides.PORT
  if (overrides.DEVTOOLS_PORT !== undefined) env["DEVTOOLS_PORT"] = overrides.DEVTOOLS_PORT
  return env
}
