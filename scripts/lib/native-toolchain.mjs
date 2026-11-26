// Runs the native toolchain (tsrs type-check, type-aware oxlint with embedded Effect
// diagnostics) through the `effect-tsgo` launcher shipped by `@effect/tsgo`.
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL("../../", import.meta.url))

/**
 * @param {string} repoRoot
 * @returns {string}
 */
export const readTsrsPin = (repoRoot = root) => {
  /** @type {unknown} */
  const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))
  const devDependencies =
    typeof manifest === "object" && manifest !== null && "devDependencies" in manifest
      ? manifest.devDependencies
      : undefined
  const version =
    typeof devDependencies === "object" && devDependencies !== null && "tsrs" in devDependencies
      ? devDependencies.tsrs
      : undefined
  if (typeof version !== "string" || version.length === 0) {
    throw new Error("package.json must pin devDependencies.tsrs")
  }
  return version
}

/**
 * @param {"tsrs" | "oxlint"} tool
 * @param {ReadonlyArray<string>} args
 * @returns {never}
 */
export const runNativeTool = (tool, args) => {
  const version = readTsrsPin(root)
  const cli = join(dirname(require.resolve("@effect/tsgo/package.json")), "dist/effect-tsgo.cjs")
  const command = tool === "tsrs" ? [`tsrs@${version}`] : [`--tsrs-lint=${version}`, "oxlint"]
  const result = spawnSync(process.execPath, [cli, ...command, ...args], { stdio: "inherit" })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}
