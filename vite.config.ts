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
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 5174 } : undefined,
    watch: {
      // The Rust side is rebuilt by cargo, not by vite.
      ignored: ["**/src-tauri/**", "**/target/**"],
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
