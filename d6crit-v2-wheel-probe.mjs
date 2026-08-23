/**
 * D6 (v2): does a real OS mouse wheel over the record page move the app off the record?
 *
 * Twice now a check-4 pass ended somewhere else: once on the work list (one history entry
 * back), once on the previous project (also one entry back), both times with the injected
 * log gone — i.e. a cross-document history navigation, which is what `navigate(-1)` does over
 * a `page.goto` boundary. The gesture layer maps a leftward right-drag to Back and a
 * down-right one to Close/hide-to-tray (components/MouseGestures.tsx), and this window did
 * both. So: log every pointer/wheel/history event into sessionStorage — which survives a
 * document swap — and wheel at it.
 *
 *   node d6crit-v2-wheel-probe.mjs [rounds]
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const ROUNDS = Number(process.argv[2] || 4);
const ORIGIN = "http://localhost:5173";
const REC = "/p/prj-agent-monitoring/work/WORK-0018";

const browser = await chromium.connectOverCDP("http://localhost:9223");
const page = browser.contexts()[0].pages()[0];

await page.addInitScript(() => {
  const KEY = "d6.eventlog";
  const push = (o) => {
    try {
      const a = JSON.parse(sessionStorage.getItem(KEY) || "[]");
      a.push({ t: Math.round(performance.now()), path: location.pathname, ...o });
      sessionStorage.setItem(KEY, JSON.stringify(a.slice(-200)));
    } catch {}
  };
  push({ e: "document-load" });
  addEventListener("pointerdown", (e) => push({ e: "pointerdown", btn: e.button, buttons: e.buttons, x: Math.round(e.clientX), y: Math.round(e.clientY) }), true);
  addEventListener("pointerup", (e) => push({ e: "pointerup", btn: e.button, buttons: e.buttons }), true);
  addEventListener("wheel", (e) => push({ e: "wheel", dy: Math.round(e.deltaY), x: Math.round(e.clientX), y: Math.round(e.clientY), t: e.target?.className?.toString?.().slice(0, 30) }), true);
  addEventListener("popstate", () => push({ e: "popstate" }));
  addEventListener("pagehide", () => push({ e: "pagehide" }));
  addEventListener("keydown", (e) => push({ e: "keydown", k: e.key }), true);
  addEventListener("mousedown", (e) => push({ e: "mousedown", btn: e.button }), true);
  addEventListener("contextmenu", () => push({ e: "contextmenu" }), true);
});

const PS = (args) =>
  execFileSync("powershell", ["-NoProfile", "-File", "C:/Code/AgentMonitoring/d6crit-v2-win.ps1", ...args], {
    encoding: "utf8",
  }).trim();

const log = () => page.evaluate(() => JSON.parse(sessionStorage.getItem("d6.eventlog") || "[]"));

for (let r = 1; r <= ROUNDS; r++) {
  await page.goto(ORIGIN + REC, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".human-sheet", { timeout: 20000 });
  await page.evaluate(() => sessionStorage.setItem("d6.eventlog", "[]"));
  await page.waitForTimeout(400);

  PS(["-Action", "raise"]);
  await page.waitForTimeout(300);
  const said = PS(["-Action", "scroll", "-X", "700", "-Y", "500", "-Delta", "-1200"]);
  await page.waitForTimeout(1500);

  const where = await page.evaluate(() => ({
    path: location.pathname,
    top: Math.round(document.getElementById("main")?.scrollTop ?? -1),
    sheet: !!document.querySelector(".human-sheet"),
  }));
  const events = await log();
  console.log(`round ${r}: ${said}`);
  console.log(`   ended at ${where.path} scrollTop=${where.top} sheet=${where.sheet}`);
  console.log(`   events: ${JSON.stringify(events.slice(0, 12))}`);
  if (where.path !== REC) console.log(`   *** MOVED OFF THE RECORD ***`);
}

await browser.close();
