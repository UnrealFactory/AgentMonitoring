#!/usr/bin/env node
// Drive the real desktop app over CDP and prove the login-time start end to end:
//   1. the sidebar switch reads the registration (off on a dev machine),
//   2. turning it on writes the HKCU Run key with `--autostart`, turning it off removes it,
//   3. a launch with `--autostart` keeps the window hidden (tray only), a plain one shows it.
// Prerequisites: `npm run dev` on 5173 and target/debug/agentmonitoring.exe built. This
// script launches the exe itself (with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS for the CDP
// port), so no other instance may be running — single-instance would just surface it.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const repoRoot = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const exe = process.env.AGENTMONITORING_EXE || join(repoRoot, "target", "debug", "agentmonitoring.exe");
const cdp = "http://localhost:9223";
assert(existsSync(exe), `no desktop build at ${exe} — run npm run tauri:dev once first`);

const runKey = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
function runEntries() {
  const ps = spawnSync("powershell", ["-NoProfile", "-Command",
    `(Get-Item '${runKey}').Property | ForEach-Object { $_ + '=' + (Get-ItemProperty -Path '${runKey}' -Name $_).$_ }`],
    { encoding: "utf8", windowsHide: true });
  return ps.stdout.split(/\r?\n/).filter(Boolean);
}
const ourEntry = () => runEntries().find((line) => line.toLowerCase().includes("agentmonitoring.exe"));

let checks = 0;
function ok(name) { checks++; console.log(`  ok ${name}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(args) {
  const child = spawn(exe, args, {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9223" },
    stdio: "ignore", detached: false, windowsHide: false,
  });
  let browser;
  for (let i = 0; i < 100 && !browser; i++) {
    try { browser = await chromium.connectOverCDP(cdp); } catch { await sleep(200); }
  }
  assert(browser, "could not attach to the desktop webview on 9223");
  let page;
  for (let i = 0; i < 50 && !page; i++) {
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => /localhost:5173|tauri\.localhost/.test(p.url()));
    if (!page) await sleep(200);
  }
  assert(page, "no app page in the webview");
  await page.locator(".sidebar").waitFor({ timeout: 20000 });
  return { child, browser, page };
}
const isVisible = (page) => page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" }));
async function quit({ child, browser }) {
  await browser.close().catch(() => {});
  child.kill();
  for (let i = 0; i < 50 && child.exitCode === null; i++) await sleep(100);
  spawnSync("taskkill", ["/IM", "agentmonitoring.exe", "/F"], { windowsHide: true, stdio: "ignore" });
  await sleep(500);
}

let app;
try {
  assert.equal(ourEntry(), undefined, `a Run entry already exists: ${ourEntry()} — remove it before running this check`);

  // 1. A plain launch shows the window; the switch reflects the (absent) registration.
  app = await launch([]);
  assert.equal(await isVisible(app.page), true, "a plain launch must show the window");
  const sw = app.page.locator(".autostart-switch");
  await sw.waitFor({ timeout: 10000 });
  assert.equal(await sw.getAttribute("aria-checked"), "false");
  assert.equal(await sw.locator(".autostart-label").textContent(), "시작 시 자동 실행");
  ok("plain launch shows the window and the switch reads the registration as off");

  // 2. On: the Run key appears, pointing at this exe with --autostart. Off: it goes.
  await sw.click();
  await app.page.locator('.autostart-switch[aria-checked="true"]').waitFor({ timeout: 10000 });
  const entry = ourEntry();
  assert(entry, `no Run entry after turning the switch on: ${runEntries().join(" | ")}`);
  assert.match(entry, /--autostart/);
  assert(entry.toLowerCase().includes(exe.toLowerCase().replace(/\//g, "\\")), entry);
  ok(`turning the switch on writes the Run key: ${entry}`);
  await app.page.reload();
  await app.page.locator('.autostart-switch[aria-checked="true"]').waitFor({ timeout: 20000 });
  ok("after a reload the switch still reads the registration as on");
  await app.page.locator(".autostart-switch").click();
  await app.page.locator('.autostart-switch[aria-checked="false"]').waitFor({ timeout: 10000 });
  assert.equal(ourEntry(), undefined, "the Run entry must be gone after turning the switch off");
  ok("turning the switch off removes the Run key");
  await quit(app);
  app = null;

  // 3. The login-time launch stays in the tray; a later plain launch shows the window.
  app = await launch(["--autostart"]);
  await sleep(1500);
  assert.equal(await isVisible(app.page), false, "an --autostart launch must keep the window hidden");
  ok("a launch with --autostart keeps the window hidden (tray only)");
  await quit(app);
  app = null;
  app = await launch([]);
  assert.equal(await isVisible(app.page), true);
  ok("the next plain launch shows the window again");
  await quit(app);
  app = null;
  console.log(`[check:autostart] ${checks} checks passed`);
} finally {
  if (app) await quit(app);
  const leftover = ourEntry();
  if (leftover) {
    console.error(`cleanup: removing leftover Run entry ${leftover}`);
    spawnSync("powershell", ["-NoProfile", "-Command", `Remove-ItemProperty -Path '${runKey}' -Name '${leftover.split("=")[0]}'`], { windowsHide: true });
  }
}
