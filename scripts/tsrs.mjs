#!/usr/bin/env node
import { runNativeTool } from "./lib/native-toolchain.mjs"

runNativeTool("tsrs", process.argv.slice(2))
