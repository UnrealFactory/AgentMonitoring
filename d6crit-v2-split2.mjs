/* D6 (v2): the split, captured fast enough to show it.
   The OS window grab costs ~2s, so it always arrives after the flip and photographs English
   twice. These two frames come from the same real WebView2 window through CDP, which is quick
   enough to catch the language the window opens in before settings.json overrules it. */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const ORIGIN = "http://localhost:5173", PRJ = "/p/prj-agent-monitoring";
const SHOTS = "C:/Code/AgentMonitoring/progress/critic-d6";
const S = `${process.env.APPDATA}/com.agentmonitoring.app/settings.json`;
const disk = () => { try { return JSON.parse(readFileSync(S, "utf8")).locale; } catch { return null; } };
const b = await chromium.connectOverCDP("http://localhost:9223");
const p = b.contexts()[0].pages()[0];
const lang = () => p.evaluate(() => document.documentElement.lang);
const ls = () => p.evaluate(() => localStorage.getItem("agentmon.locale"));

await p.goto(ORIGIN + PRJ, { waitUntil: "domcontentloaded" });
await p.waitForSelector(".locale-toggle"); await p.waitForTimeout(3000);
if ((await lang()) !== "ko") { await p.locator('.locale-toggle [data-value="ko"]').click(); await p.waitForTimeout(2500); }
console.log(`settled: screen=${await lang()} localStorage=${await ls()} settings.json=${disk()}`);

await p.goto(ORIGIN + PRJ, { waitUntil: "domcontentloaded" });
await p.waitForSelector(".locale-toggle");
await p.locator('.locale-toggle [data-value="en"]').click();
await p.waitForTimeout(2500);
console.log(`after the discarded press: screen=${await lang()} localStorage=${await ls()} settings.json=${disk()}`);

await p.goto(ORIGIN + PRJ, { waitUntil: "domcontentloaded" });
await p.waitForSelector(".locale-toggle");
const early = await lang();
await p.screenshot({ path: `${SHOTS}/v2-3-split-A-opens-${early}.png` });
await p.waitForTimeout(3000);
const late = await lang();
await p.screenshot({ path: `${SHOTS}/v2-3-split-B-flips-${late}.png` });
console.log(`the next start opened in ${early} and turned ${late}`);

/* leave the machine on the language it was on when this pass began */
if ((await lang()) !== "ko") { await p.locator('.locale-toggle [data-value="ko"]').click(); await p.waitForTimeout(2500); }
console.log(`restored: screen=${await lang()} localStorage=${await ls()} settings.json=${disk()}`);
await b.close();
