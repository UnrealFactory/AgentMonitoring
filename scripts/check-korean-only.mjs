#!/usr/bin/env node
// Upgrading an English profile or following an old English URL must still show Korean.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { repoRoot, startServer, stopServer, waitForServer } from "./dev-server.mjs";

const port = Number(process.env.KOREAN_PORT || 5228);
const origin = `http://localhost:${port}`;
const shots = join(repoRoot, ".critic-tmp", "korean-only");
let server, browser;
let checks = 0;
try {
  server = startServer(port);
  await waitForServer(server, origin);
  browser = await chromium.launch();
  mkdirSync(shots, { recursive: true });
  for (const profile of ["english", "fresh", "denied"]) {
    const context = await browser.newContext({ locale: "en-US", timezoneId: "Asia/Seoul", viewport: { width: 1280, height: 1000 } });
    await context.addInitScript((profile) => {
      if (profile === "english") localStorage.setItem("agentmon.locale", "en");
      if (profile === "denied") Object.defineProperty(window, "localStorage", {
        get() { throw new DOMException("Storage denied", "SecurityError"); },
      });
    }, profile);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/projects?lang=en`);
    for (const reload of [false, true]) {
      if (reload) await page.reload();
      await page.getByRole("heading", { name: "프로젝트", exact: true }).waitFor();
      assert.equal(await page.locator("html").getAttribute("lang"), "ko");
      assert.equal(await page.locator(".locale-toggle, .locale-option").count(), 0);
      await page.getByRole("button", { name: "새 프로젝트", exact: true }).click();
      const form = page.locator(".create-panel");
      assert.deepEqual(await form.locator('[aria-labelledby="scaffold-label"] [role="radio"]').allTextContents(), ["추가", "추가 안 함"]);
      const dates = await page.evaluate(async () => {
        const { formatDate, formatDateTimeUtc } = await import("/src/lib/format.ts");
        return [formatDate("2026-09-08T11:00:00Z"), formatDateTimeUtc("2026-09-08T11:00:00Z")];
      });
      assert.deepEqual(dates, ["2026년 9월 8일", "2026년 9월 8일 11:00 UTC"]);
      if (profile === "english" && !reload) await page.screenshot({ path: join(shots, "korean-only.png") });
      checks++;
    }
    await page.goto(`${origin}/nope?lang=en`);
    await page.getByRole("heading", { name: "화면이 없습니다", exact: true }).waitFor();
    assert.deepEqual(errors, []);
    checks++;
    console.log(`  ok ${profile}: Korean on first load, reload, creation form, dates and missing route`);
    await context.close();
  }
  console.log(`PASS ${checks} Korean-only upgrade and startup checks`);
} finally {
  await browser?.close();
  await stopServer(server);
}
