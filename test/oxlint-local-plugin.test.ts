// @vitest-environment node
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vite-plus/test"

const rootReq = createRequire(import.meta.url)
const vpReq = createRequire(rootReq.resolve("vite-plus/package.json"))
const oxlintBin = join(dirname(vpReq.resolve("oxlint/package.json")), "bin/oxlint")
const pluginPath = fileURLToPath(new URL("../config/oxlint-local-plugin.mjs", import.meta.url))

const runOxlint = (
  dir: string,
  filename: string,
  code: string,
  rules: Readonly<Record<string, unknown>>
): { readonly status: number; readonly output: string } => {
  const target = join(dir, filename)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, code)
  const configPath = join(dir, "oxlint.config.json")
  writeFileSync(
    configPath,
    JSON.stringify({
      jsPlugins: [pluginPath],
      rules
    })
  )
  const res = spawnSync(process.execPath, [oxlintBin, "--config", configPath, target], {
    encoding: "utf8",
    shell: false
  })
  return { status: res.status ?? 1, output: `${res.stdout}${res.stderr}` }
}

const withTempDir = (run: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), "local-oxlint-plugin-"))
  try {
    run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe("config/oxlint-local-plugin.mjs", () => {
  it("enforces local/require-suppression-reason on directives without rationale", () => {
    withTempDir((dir) => {
      const rule = { "local/require-suppression-reason": "error" }

      const bareDisable = runOxlint(
        dir,
        "bare.ts",
        "// oxlint-disable-next-line no-console\nexport const x = 1\n",
        rule
      )
      expect(bareDisable.status).not.toBe(0)
      expect(bareDisable.output).toContain("local(require-suppression-reason)")

      const explainedSuffix = runOxlint(
        dir,
        "explained-suffix.ts",
        "// oxlint-disable-next-line no-console -- smoke script stdout\nexport const x = 1\n",
        rule
      )
      expect(explainedSuffix.status, explainedSuffix.output).toBe(0)

      const explainedAbove = runOxlint(
        dir,
        "explained-above.ts",
        "// Why: regex intentionally matches ANSI ESC.\n// oxlint-disable-next-line no-control-regex\nexport const x = 1\n",
        rule
      )
      expect(explainedAbove.status, explainedAbove.output).toBe(0)
    })
  })

  it("enforces local/no-inline-schema-compile for Schema codecs compiled inside functions", () => {
    withTempDir((dir) => {
      const rule = { "local/no-inline-schema-compile": "error" }

      const inline = runOxlint(
        dir,
        "inline.ts",
        [
          'import { Schema } from "effect"',
          "const ItemSchema = Schema.Struct({ id: Schema.String })",
          "export const decodeItem = (raw: unknown) => Schema.decodeUnknownSync(ItemSchema)(raw)",
          ""
        ].join("\n"),
        rule
      )
      expect(inline.status).not.toBe(0)
      expect(inline.output).toContain("local(no-inline-schema-compile)")

      const hoisted = runOxlint(
        dir,
        "hoisted.ts",
        [
          'import { Schema } from "effect"',
          "const ItemSchema = Schema.Struct({ id: Schema.String })",
          "const decode = Schema.decodeUnknownSync(ItemSchema)",
          "export const decodeItem = (raw: unknown) => decode(raw)",
          ""
        ].join("\n"),
        rule
      )
      expect(hoisted.status, hoisted.output).toBe(0)
    })
  })

  it("enforces local/no-manual-effect-runtime-in-tests with maxOccurrences ceilings", () => {
    withTempDir((dir) => {
      const bad = runOxlint(
        dir,
        "sample.test.ts",
        [
          'import { Effect } from "effect"',
          "export const run = () => Effect.runPromise(Effect.void)",
          "export const piped = () => Effect.void.pipe(Effect.runSync)",
          ""
        ].join("\n"),
        { "local/no-manual-effect-runtime-in-tests": "error" }
      )
      expect(bad.status).not.toBe(0)
      expect(bad.output).toContain("local(no-manual-effect-runtime-in-tests)")

      const cappedPass = runOxlint(
        dir,
        "capped.test.ts",
        [
          'import { Effect } from "effect"',
          "export const one = () => Effect.runPromise(Effect.void)",
          "export const two = () => Effect.runSync(Effect.void)",
          ""
        ].join("\n"),
        { "local/no-manual-effect-runtime-in-tests": ["error", { maxOccurrences: 2 }] }
      )
      expect(cappedPass.status, cappedPass.output).toBe(0)

      const nonTest = runOxlint(
        dir,
        "runtime.ts",
        ['import { Effect } from "effect"', "export const boot = () => Effect.runFork(Effect.void)", ""].join("\n"),
        { "local/no-manual-effect-runtime-in-tests": "error" }
      )
      expect(nonTest.status, nonTest.output).toBe(0)
    })
  })

  it("enforces local/no-test-in-loop on for-loops around Vitest / @effect/vitest declarations", () => {
    withTempDir((dir) => {
      const rule = { "local/no-test-in-loop": "error" }

      const loop = runOxlint(
        dir,
        "loop.test.ts",
        [
          'import { it } from "@effect/vitest"',
          'for (const x of ["a", "b"]) {',
          "  it.effect(x, () => { return undefined })",
          "}",
          ""
        ].join("\n"),
        rule
      )
      expect(loop.status).not.toBe(0)
      expect(loop.output).toContain("local(no-test-in-loop)")

      const each = runOxlint(
        dir,
        "each.test.ts",
        [
          'import { it } from "@effect/vitest"',
          'it.effect.each(["a", "b"])("%s", () => { return undefined })',
          ""
        ].join("\n"),
        rule
      )
      expect(each.status, each.output).toBe(0)
    })
  })

  it("enforces local/no-outset-state-indicators and local/no-unscoped-has on Tailwind class strings", () => {
    withTempDir((dir) => {
      const outsetClass = ["focus-visible:outline", "offset-2"].join("-")
      const unscopedHasClass = ["[&_:", "has(input)]:p-2"].join("")
      const scopedHasClass = ["[&:", "has([data-slot=icon])]:ps-2"].join("")

      const badOutset = runOxlint(dir, "outset.ts", `export const cls = ${JSON.stringify(outsetClass)}\n`, {
        "local/no-outset-state-indicators": "error"
      })
      expect(badOutset.status).not.toBe(0)
      expect(badOutset.output).toContain("local(no-outset-state-indicators)")

      const goodInward = runOxlint(
        dir,
        "inward.ts",
        `export const cls = ${JSON.stringify(["focus-visible:", "-outline-offset-2"].join(""))}\n`,
        { "local/no-outset-state-indicators": "error" }
      )
      expect(goodInward.status, goodInward.output).toBe(0)

      const badHas = runOxlint(dir, "bad-has.ts", `export const cls = ${JSON.stringify(unscopedHasClass)}\n`, {
        "local/no-unscoped-has": "error"
      })
      expect(badHas.status).not.toBe(0)
      expect(badHas.output).toContain("local(no-unscoped-has)")

      const goodHas = runOxlint(dir, "good-has.ts", `export const cls = ${JSON.stringify(scopedHasClass)}\n`, {
        "local/no-unscoped-has": "error"
      })
      expect(goodHas.status, goodHas.output).toBe(0)
    })
  })
})
