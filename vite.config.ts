import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [tailwindcss()],
  build: isSsrBuild
    ? {
        // `vite build --ssr src/serve.ts --outDir dist/server`
        outDir: "dist/server",
        emptyOutDir: true
      }
    : {
        outDir: "dist/client",
        emptyOutDir: true,
        // `dist/client/.vite/manifest.json` maps each source module to its chunk,
        // its static imports and its CSS. The server reads it to preload per route.
        manifest: true,
        rollupOptions: { input: "src/client.ts" }
      },
  // Bundle every dependency into dist/server so it runs without node_modules
  // and resolves @effect/ui's `production` export condition (`#dev` -> devOff).
  ssr: { noExternal: true }
}))
