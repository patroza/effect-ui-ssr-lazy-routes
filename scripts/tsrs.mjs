#!/usr/bin/env node
import * as NativeToolchain from "./lib/native-toolchain.mjs"

NativeToolchain.runNativeTool("tsrs", process.argv.slice(2))
