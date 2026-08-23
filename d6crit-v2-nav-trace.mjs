/**
 * D6 (v2): the en pass ended check 4 on the work list instead of the record it was reading.
 * Same document (the sentinel survived), so something navigated the app. This traces what:
 * every pushState / replaceState / popstate, with the stack that caused it, while the same
 * wheel-and-scroll sequence runs.
 *
 *   node d6crit-v2-nav-trace.mjs [rounds]
 */
import { chromium } from "playwright";
import { wheelOver } from "./d6crit-v2-shot.mjs";

const ROUNDS = Number(process.argv[2] || 3);
const ORIGIN = "http://localhost:5173";
const REC = "/p/prj-agent-monitoring/work/WORK-0018";

const browser = await chromium.connectOverCDP("http://localhost:9223");
const page = browser.contexts()[0].pages()[0];

for (let r = 1; r <= ROUNDS; r++) {
  await page.goto(ORIGIN + REC, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".human-sheet", { timeout: 20000 });
  await page.waitForTimeout(800);

  await page.evaluate(() => {
    window.__navLog = [];
    const stamp = (kind, url) =>
      window.__navLog.push({
        at: Math.round(performance.now()),
        kind,
        url: String(url ?? location.pathname),
        where: location.pathname,
        stack: (new Error().stack || "").split("\n").slice(2, 6).join(" | "),
      });
    for (const m of ["pushState", "replaceState"]) {
      const orig = history[m].bind(history);
      history[m] = (s, t, u) => {
        stamp(m, u);
        return orig(s, t, u);
      };
    }
    addEventListener("popstate", () => stamp("popstate"));
    addEventListener("keydown", (e) => stamp("keydown:" + e.key));
    addEventListener("mousedown", (e) => stamp(`mousedown:btn${e.button}@${Math.round(e.clientX)},${Math.round(e.clientY)}`));
    addEventListener("auxclick", (e) => stamp("auxclick:btn" + e.button));
    addEventListener("click", (e) => stamp(`click@${Math.round(e.clientX)},${Math.round(e.clientY)}:${(e.target.closest("a")?.getAttribute("href") ?? e.target.tagName)}`));
    window.__t0 = performance.now();
  });

  const w = await wheelOver(page, 700, 500, -1200);
  await page.evaluate(() => {
    const main = document.getElementById("main");
    main.scrollTop = main.scrollHeight;
  });
  await page.waitForTimeout(1200);

  const out = await page.evaluate(() => ({
    path: location.pathname,
    sheet: !!document.querySelector(".human-sheet"),
    takeaway: document.querySelector(".human-takeaway")?.textContent.trim().slice(0, 50) ?? null,
    log: window.__navLog,
  }));
  console.log(
    `round ${r}: wheel -> ${w.how.slice(0, 40)} top=${w.top} | ended at ${out.path} sheet=${out.sheet} takeaway=${JSON.stringify(out.takeaway)}`
  );
  for (const e of out.log) console.log(`   ${e.at}ms ${e.kind} url=${e.url} at=${e.where}\n      ${e.stack}`);
}

await browser.close();
