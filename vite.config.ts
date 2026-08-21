import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Plain JS so the screenshot tooling and the dev server share one project reader.
// @ts-ignore -- untyped local module
import { projectApiPlugin } from "./scripts/vite-project-api.mjs";

// Tauri drives the dev server through `npm run tauri:dev`; the port must stay fixed
// because tauri.conf.json points devUrl at it.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), projectApiPlugin({ root: process.cwd() })],
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
      // The Rust side is rebuilt by cargo, not by vite. The AgentMonitoring folder is data:
      // the app notices a write by polling /project-api/cursor and refreshing in place, and
      // a dev-server reload on top of that would throw away the page it just updated.
      //
      // The data-folder pattern is **anchored to the repo root**, not `**/AgentMonitoring/**`:
      // this repo's own directory is *named* AgentMonitoring, so the any-depth glob matched
      // every source file in the project and silently killed file watching — the dev server
      // (and tauri:dev's) then served stale transforms of edited files until it was
      // restarted, and HMR never fired at all (found while WORK-0039's hook refused to
      // exist in a running session; BUG-0025).
      ignored: [
        "**/src-tauri/**",
        "**/target/**",
        resolve(process.cwd(), "AgentMonitoring").replace(/\\/g, "/") + "/**",
      ],
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
