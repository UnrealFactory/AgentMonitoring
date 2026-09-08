#!/usr/bin/env node
// Keep an existing window and an unsaved dialog alive across real Vite source updates.
// Edits happen only in a scratch source copy, never in the live developer's files.
// --without-fix restores the old context behavior to check that this gate catches it.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { chromium } from "playwright";
import { repoRoot, stopServer, waitForServer } from "./dev-server.mjs";
import { useLocale } from "./i18n.mjs";

const scratchRoot = resolve(repoRoot, ".critic-tmp");
mkdirSync(scratchRoot, { recursive: true });
const scratch = mkdtempSync(join(scratchRoot, "hmr-"));
const port = Number(process.env.HMR_PORT || 5224);
const origin = `http://localhost:${port}`;
const withoutFix = process.argv.includes("--without-fix");
let server, browser;

try {
  for (const entry of ["src", "scripts", "index.html", "package.json", "vite.config.ts"]) {
    cpSync(join(repoRoot, entry), join(scratch, entry), { recursive: true });
  }
  const config = join(scratch, "vite.config.ts");
  writeFileSync(config, readFileSync(config, "utf8")
    .replace("defineConfig({", 'defineConfig({\n  cacheDir: ".vite",')
    .replace("  server: {", `  server: {\n    fs: { allow: ${JSON.stringify([scratch, resolve(repoRoot, "node_modules")])} },`));
  if (withoutFix) {
    const file = join(scratch, "src/lib/stableContext.ts");
    writeFileSync(file, readFileSync(file, "utf8").replace("if (!import.meta.hot)", "if (true)"));
  }
  server = spawn(process.execPath, [join(repoRoot, "node_modules/vite/bin/vite.js"), "--port", String(port), "--strictPort"], {
    cwd: scratch, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env, AGENTMON_DIR: "", AGENTMON_DIRS: resolve(repoRoot, "AgentMonitoring"),
      AGENTMON_REGISTRY_DIR: join(scratch, "registry"),
      AGENTMON_BIN: process.env.AGENTMON_BIN || resolve(repoRoot, "target/release", process.platform === "win32" ? "agentmon.exe" : "agentmon"),
    },
  });
  server.stderr.on("data", (data) => process.stderr.write(data));
  server.stdout.resume();
  await waitForServer(server, origin);
  browser = await chromium.launch();
  const page = await browser.newPage();
  await useLocale(page, "ko");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/projects`);
  const heading = page.locator(".nav-projects-heading");
  await heading.waitFor();
  await heading.click({ button: "right" });
  await page.locator('.ctx-item[data-item="create-folder"]').click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("폴더 이름", { exact: true }).fill("저장하지 않은 폴더 이름");
  const marker = await page.evaluate(() => {
    window.__hmrMarker = crypto.randomUUID();
    window.__blankRoot = false;
    const root = document.getElementById("root");
    new MutationObserver(() => { if (!root.childElementCount) window.__blankRoot = true; }).observe(root, { childList: true });
    return window.__hmrMarker;
  });
  const dictionaries = ["src/lib/i18n/ko.ts"];
  const batches = [
    [],
    ["src/AppContext.tsx", "src/components/ContextMenu.tsx", "src/components/ProjectFolders.tsx", "src/lib/projectFolders.ts", "src/components/ProjectDrag.tsx"],
    ["src/lib/stableContext.ts", "src/components/DeleteProject.tsx", "src/lib/markdown.tsx"],
  ];
  let checks = 0;
  const verify = async (expected, phase) => {
    try {
      await page.waitForFunction((text) => document.querySelector(".nav-projects-heading span")?.textContent === text, expected, { timeout: 8000 });
    } catch (error) {
      throw new Error(`${phase}: update did not reach the existing window. Page errors: ${errors.join("; ")}`, { cause: error });
    }
    await page.waitForTimeout(400);
    assert.deepEqual(errors, [], `${phase}: React must not lose a context`);
    assert.equal(await page.evaluate(() => window.__hmrMarker), marker, `${phase}: the page must not reload`);
    assert.equal(await page.evaluate(() => window.__blankRoot), false, `${phase}: the app must not go blank`);
    assert.equal(await dialog.getByLabel("폴더 이름", { exact: true }).inputValue(), "저장하지 않은 폴더 이름", `${phase}: preserve the open dialog and draft`);
    checks++;
    console.log(`  ok ${phase}: code updated, no reload/errors/blank screen, unsaved dialog retained`);
  };
  for (let round = 0; round < batches.length; round++) {
    const files = [...dictionaries, ...batches[round]];
    const originals = new Map(files.map((file) => [file, readFileSync(join(scratch, file), "utf8")]));
    const label = `프로젝트 · HMR ${round + 1}`;
    for (const [file, original] of originals) {
      const next = dictionaries.includes(file)
        ? original.replace(/"nav\.vault": "[^"]+"/, `"nav.vault": "${label}"`)
        : `${original}\n// HMR regression round ${round + 1}\n`;
      assert.notEqual(next, original);
      writeFileSync(join(scratch, file), next);
    }
    await verify(label, `patch ${round + 1}`);
    for (const [file, original] of originals) writeFileSync(join(scratch, file), original);
    await verify("프로젝트", `restore ${round + 1}`);
  }
  await page.keyboard.press("Escape");
  assert.equal(await dialog.count(), 0);
  assert(await heading.evaluate((element) => element === document.activeElement));
  await heading.click({ button: "right" });
  assert.equal(await page.locator('.ctx-item[data-item="create-folder"]').count(), 1);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("html").getAttribute("data-modal"), null);
  assert.deepEqual(errors, []);
  console.log(`PASS ${checks} live source update cycles and menu/focus recovery${withoutFix ? " (without fix)" : ""}`);
} finally {
  await browser?.close();
  await stopServer(server);
  const withinScratch = relative(scratchRoot, resolve(scratch));
  if (!withinScratch || withinScratch.startsWith("..") || isAbsolute(withinScratch)) throw new Error("Unsafe HMR scratch cleanup path");
  rmSync(scratch, { recursive: true, force: true });
}
