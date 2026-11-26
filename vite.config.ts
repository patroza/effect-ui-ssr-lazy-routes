import { DevToolsVite } from "@effect/ui-devtools/node"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

export default defineConfig(({ isSsrBuild }) => ({
  // DevToolsVite.plugin only applies during `vite dev` (never during `vite build`, preview, or Vitest).
  plugins: [tailwindcss(), DevToolsVite.plugin({ dispatch: true })],
  build: isSsrBuild
    ? {
        // `vite build --ssr src/server/serve.ts --outDir dist/server`
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
  ssr: { noExternal: true }
}))
