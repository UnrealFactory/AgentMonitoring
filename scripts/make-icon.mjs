#!/usr/bin/env node
// Renders the app mark to a 1024x1024 PNG with Chromium, then hands it to
// `tauri icon` which produces every platform size in src-tauri/icons/.
//
//   node scripts/make-icon.mjs
//
// Run this only when the mark changes; the generated icons are committed.
import { chromium } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "src-tauri", "icon-source.png");

const html = `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;width:1024px;height:1024px;background:transparent}
  .mark{
    width:1024px;height:1024px;box-sizing:border-box;
    background:linear-gradient(160deg,#2a2c38 0%,#16171a 60%);
    border-radius:220px;display:flex;align-items:center;justify-content:center;
    box-shadow:inset 0 0 0 8px rgba(255,255,255,.06);
  }
  svg{width:560px;height:560px;overflow:visible}
</style>
<div class="mark">
  <svg viewBox="0 0 100 100" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <!-- an activity trace: what the app is, a record of work over time -->
    <path d="M6 66 L26 66 L36 40 L50 78 L62 26 L72 66 L94 66"
          stroke="#5e6ad2" stroke-width="9"/>
    <circle cx="62" cy="26" r="9" fill="#8b93e8" stroke="#0e0f11" stroke-width="5"/>
  </svg>
</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1024, height: 1024 },
  deviceScaleFactor: 1,
});
await page.setContent(html, { waitUntil: "load" });
mkdirSync(dirname(out), { recursive: true });
await page.screenshot({ path: out, omitBackground: true });
await browser.close();
console.log("wrote", out);

const cli = join(root, "node_modules", ".bin", process.platform === "win32" ? "tauri.cmd" : "tauri");
if (existsSync(cli)) {
  execFileSync(cli, ["icon", out, "-o", join(root, "src-tauri", "icons")], {
    stdio: "inherit",
    cwd: root,
    shell: process.platform === "win32",
  });
} else {
  console.error("tauri CLI not found — run `npm install` first");
  process.exit(1);
}
