import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Plain JS so the screenshot tooling and the dev server share one vault reader.
// @ts-ignore -- untyped local module
import { vaultApiPlugin } from "./scripts/vite-vault-api.mjs";

// Tauri drives the dev server through `npm run tauri:dev`; the port must stay fixed
// because tauri.conf.json points devUrl at it.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), vaultApiPlugin({ root: process.cwd() })],
  clearScreen: false,
  optimizeDeps: {
    /**
     * The Tauri modules are reached through `import()` behind an `isTauri()` check, so the
     * dev server only discovers them when a page happens to run that branch — and a
     * mid-session re-optimisation reloads the page and can serve a second copy of React
     * while it does (a cold `npm run check:live` hit exactly that: three
     * "Cannot read properties of null (reading 'useState')" and a blank screen). Naming
     * them here bundles them at server start instead.
     */
    include: ["@tauri-apps/api/core", "@tauri-apps/api/event", "@tauri-apps/api/window"],
  },
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 5174 } : undefined,
    watch: {
      // The Rust side is rebuilt by cargo, not by vite. The vault is data, not source:
      // the app notices a write by polling /vault-api/cursor and refreshing in place, and
      // a dev-server reload on top of that would throw away the page it just updated.
      ignored: ["**/src-tauri/**", "**/target/**", "**/vault/**"],
    },
  },
  build: {
    // WebView2 on Windows and WKWebView on macOS both handle modern output.
    target: "es2021",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    outDir: "dist",
    emptyOutDir: true,
  },
});
