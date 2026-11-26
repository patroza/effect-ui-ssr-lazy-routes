import { createServer } from "node:net"

export const DEFAULT_APP_PORT = 5173
export const DEFAULT_DEVTOOLS_PORT = 4774
export const DEVTOOLS_PORT_OFFSET = 2
export const MAX_DEVTOOLS_PORT_ATTEMPTS = 20
export const DEVTOOLS_HOST = "127.0.0.1"

const STRICT_DIGITS_RE = /^[0-9]+$/

const getErrorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined

const parseStrictPort = (raw: string, min: number, name: string): number => {
  if (!STRICT_DIGITS_RE.test(raw)) {
    throw new RangeError(`Invalid ${name} "${raw}": expected integer between ${min} and 65535`)
  }
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < min || parsed > 65535) {
    throw new RangeError(`Invalid ${name} "${raw}": expected integer between ${min} and 65535`)
  }
  return parsed
}

export const parseAppPort = (raw: string | undefined): number => {
  if (raw === undefined || raw === "") return DEFAULT_APP_PORT
  return parseStrictPort(raw, 0, "PORT")
}

export const parseDevToolsPort = (raw: string | undefined): number | undefined => {
  if (raw === undefined || raw === "") return undefined
  return parseStrictPort(raw, 1, "DEVTOOLS_PORT")
}

export const isPortAvailable = (port: number, host: string = DEVTOOLS_HOST): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once("error", (error) => {
      if (getErrorCode(error) === "EADDRINUSE") {
        resolve(false)
        return
      }
      reject(error)
    })
    server.once("listening", () => {
      server.close((closeError) => (closeError ? reject(closeError) : resolve(true)))
    })
    server.listen(port, host)
  })

export const getEphemeralPort = (host: string = DEVTOOLS_HOST): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once("error", reject)
    server.once("listening", () => {
      const address = server.address()
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("Could not determine ephemeral port")))
        return
      }
      const { port } = address
      server.close((closeError) => (closeError ? reject(closeError) : resolve(port)))
    })
    server.listen(0, host)
  })

const nextCandidatePort = (port: number): number => (port >= 65535 ? DEFAULT_DEVTOOLS_PORT : port + 1)

export interface ResolveDevToolsPortOptions {
  readonly actualAppPort: number
  readonly appPortEnv?: string | undefined
  readonly devToolsPortEnv?: string | undefined
  readonly host?: string
  readonly maxAttempts?: number
}

export const resolveDevToolsPort = async (options: ResolveDevToolsPortOptions): Promise<number> => {
  const {
    actualAppPort,
    appPortEnv,
    devToolsPortEnv,
    host = DEVTOOLS_HOST,
    maxAttempts = MAX_DEVTOOLS_PORT_ATTEMPTS
  } = options

  if (devToolsPortEnv !== undefined && devToolsPortEnv !== "" && devToolsPortEnv !== "0") {
    return parseStrictPort(devToolsPortEnv, 1, "DEVTOOLS_PORT")
  }

  const hasExplicitAppPort = appPortEnv !== undefined && appPortEnv !== ""
  const useOffset = hasExplicitAppPort || devToolsPortEnv === "0"
  let candidate = useOffset
    ? actualAppPort + DEVTOOLS_PORT_OFFSET <= 65535
      ? actualAppPort + DEVTOOLS_PORT_OFFSET
      : DEFAULT_DEVTOOLS_PORT
    : DEFAULT_DEVTOOLS_PORT

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (candidate === actualAppPort) {
      candidate = nextCandidatePort(candidate)
    }
    if (await isPortAvailable(candidate, host)) {
      return candidate
    }
    candidate = nextCandidatePort(candidate)
  }

  return getEphemeralPort(host)
}
