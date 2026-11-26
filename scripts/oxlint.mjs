#!/usr/bin/env node
import { fileURLToPath } from "node:url"
import { ensureEmbeddedOxlintConfig } from "./lib/effect-diagnostics.mjs"
import { runNativeTool } from "./lib/native-toolchain.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const args = process.argv.slice(2)
const hasConfig = args.some((arg) => arg === "-c" || arg === "--config" || arg.startsWith("--config="))
const fullArgs = hasConfig ? args : ["-c", ensureEmbeddedOxlintConfig(root), ...args]

runNativeTool("oxlint", fullArgs)
