/* D6 (v2): evidence for the retellings that render with no landmarks at all. */
import { chromium } from "playwright";
import { shot } from "./d6crit-v2-shot.mjs";
const ORIGIN = "http://localhost:5173";
const b = await chromium.connectOverCDP("http://localhost:9223");
const p = b.contexts()[0].pages()[0];
/* back to the language this machine was on when the pass started */
await p.goto(ORIGIN + "/p/prj-agent-monitoring", { waitUntil: "domcontentloaded" });
await p.waitForSelector(".locale-toggle"); await p.waitForTimeout(3000);
if ((await p.evaluate(() => document.documentElement.lang)) !== "ko") {
  await p.locator('.locale-toggle [data-value="ko"]').click(); await p.waitForTimeout(2500);
}
for (const [name, href] of [
  ["v2-5-wall-note-chart-colour", "/p/prj-agent-monitoring/notes/chart-note-series-colour"],
  ["v2-5-wall-work-0060", "/p/prj-agent-monitoring/work/WORK-0060"],
  ["v2-5-no-takeaway-bug-0024", "/p/prj-agent-monitoring/bugs/BUG-0024"],
]) {
  await p.goto(ORIGIN + href, { waitUntil: "domcontentloaded" });
  await p.waitForSelector(".human-sheet", { timeout: 20000 });
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => ({
    beats: document.querySelectorAll(".human-beat").length,
    paras: document.querySelectorAll(".human-sheet p").length,
    takeaway: (document.querySelector(".human-takeaway")?.textContent ?? "").trim().slice(0, 60),
    foot: !!document.querySelector(".human-foot"),
  }));
  const s = await shot(p, name);
  console.log(`${href}: beats=${r.beats} paragraphs=${r.paras} takeaway=${JSON.stringify(r.takeaway)} byline=${r.foot} -> ${s.file} ok=${s.ok}`);
}
await b.close();
