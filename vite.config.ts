import { join } from "node:path"
import { fileURLToPath } from "node:url"
import * as EffectOxlintPresets from "@effect/tsgo/oxlint-presets"
import { DevToolsVite } from "@effect/ui-devtools/node"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig, lazyPlugins } from "vite-plus"
import { parseDevToolsPort } from "./scripts/lib/dev-ports.ts"
import * as EffectDiagnostics from "./scripts/lib/effect-diagnostics.mjs"

const root = fileURLToPath(new URL(".", import.meta.url))
const baseOxlintConfig = EffectDiagnostics.loadOxlintJsonConfig(join(root, "config/oxlint.base.json"))
const strictOxlintConfig = EffectDiagnostics.loadOxlintJsonConfig(join(root, "config/oxlint.strict.json"))

export default defineConfig(({ command, isSsrBuild, mode }) => ({
  run: {
    cache: {
      scripts: true,
      tasks: true
    },
    tasks: {
      // Interactive / in-place mutating commands must never be cached (non-overlapping names
      // referenced by the matching package.json scripts so both `pnpm <name>` and `vp run <name>` stay safe).
      "dev:server": { command: "node scripts/dev.ts", cache: false },
      "start:server": { command: "node dist/server/serve.js", cache: false },
      "format:write": { command: "vp fmt", cache: false },
      "lint:autofix": { command: "effect-tsgo vp check --fix", cache: false }
    }
  },
  // DevToolsVite.plugin only applies during `vite dev` (never during `vp build`, preview, or Vitest).
  // Skip Tailwind & DevTools during `vp test` (matching the former standalone `vitest.config.ts`),
  // and use `lazyPlugins` to skip plugin initialization during `vp check` / `vp lint` / `vp fmt`.
  plugins:
    mode === "test"
      ? []
      : lazyPlugins(() => {
          if (command !== "serve") return [tailwindcss()]
          const devToolsPort = parseDevToolsPort(process.env["DEVTOOLS_PORT"])
          return [
            tailwindcss(),
            DevToolsVite.plugin({
              dispatch: true,
              // `src/main.ts` provides `DevTools.layer()` explicitly, so skip the auto-injected overlay.
              overlay: false,
              ...(devToolsPort === undefined ? {} : { port: devToolsPort })
            })
          ]
        }),
  build: isSsrBuild
    ? {
        // `vp build --ssr src/server/serve.ts --outDir dist/server`
        outDir: "dist/server",
        emptyOutDir: true
      }
    : {
        outDir: "dist/client",
        emptyOutDir: true,
        // `dist/client/.vite/manifest.json` maps each source module to its chunk,
        // its static imports and its CSS. The server reads it to preload per route.
        manifest: true,
        rollupOptions: { input: "src/main.ts" }
      },
  // Bundle every dependency into dist/server so it runs without node_modules
  // and resolves @effect/ui's `production` export condition (`#dev` -> devOff).
  // In dev (`isSsrBuild === false`), keep Node CJS deps like `ws` external for Vite's ESM module runner.
  ssr: isSsrBuild ? { noExternal: true } : { external: ["@effect/platform-node", "ws"] },
  test: {
    environment: "happy-dom",
    environmentOptions: {
      happyDOM: {
        settings: {
          handleDisabledFileLoadingAsSuccess: true
        }
      }
    },
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"]
  },
  fmt: {
    semi: false,
    singleQuote: false,
    arrowParens: "always",
    trailingComma: "none",
    printWidth: 120,
    tabWidth: 2,
    sortImports: false,
    sortPackageJson: false,
    ignorePatterns: ["**/node_modules/**", "pnpm-lock.yaml", "**/dist/**", "**/coverage/**", "**/*.tsbuildinfo"]
  },
  lint: {
    // `EffectOxlintPresets.strict` registers the native `effecttsgo` plugin; `deriveEffectRules`
    // maps every rule in `tsconfig.plugins.json` + `@effect/tsgo/schema.json` (99 errors, 55 off).
    extends: [baseOxlintConfig, strictOxlintConfig, EffectOxlintPresets.strict],
    options: {
      typeAware: true,
      typeCheck: true,
      denyWarnings: true
    },
    rules: {
      ...EffectDiagnostics.deriveEffectRules(root),
      "import/no-self-import": "error",
      "eslint/no-underscore-dangle": [
        "error",
        {
          allow: ["_tag", "_etag"]
        }
      ],
      "typescript/no-use-before-define": [
        "error",
        {
          functions: false,
          classes: true,
          variables: true
        }
      ],
      "import/no-unassigned-import": [
        "error",
        {
          allow: ["**/*.css"]
        }
      ],
      "typescript/restrict-template-expressions": "error",
      "typescript/no-misused-promises": "error",
      "typescript/no-base-to-string": "error",
      "eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: ".",
              message:
                "Please import from the specific file instead. Imports from index in the same directory are almost always wrong (circular)."
            },
            {
              name: "./",
              message:
                "Please import from the specific file instead. Imports from index in the same directory are almost always wrong (circular)."
            },
            {
              name: "./index",
              message:
                "Please import from the specific file instead. Imports from index in the same directory are almost always wrong (circular)."
            }
          ]
        }
      ]
    },
    ignorePatterns: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.d.ts",
      "**/*.css",
      "**/*.json",
      "**/*.md",
      "**/*.js",
      "**/*.jsx",
      "**/*.cjs",
      "**/coverage/**"
    ]
  }
}))
