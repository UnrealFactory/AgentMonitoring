/** D6: does the real OS wheel move the reading column of the human sheet? */
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://localhost:9223");
const page = browser.contexts()[0].pages()[0];
const ps = (...args) =>
  execFileSync("powershell", ["-NoProfile", "-File", "C:\\Code\\AgentMonitoring\\scripts\\win-window.ps1", ...args], {
    encoding: "utf8",
  }).trim();

const top = () =>
  page.evaluate(() => {
    const m = document.getElementById("main");
    return { top: Math.round(m.scrollTop), h: Math.round(m.scrollHeight), c: Math.round(m.clientHeight) };
  });

await page.goto("http://localhost:5173/p/prj-agent-monitoring/work/WORK-0018", { waitUntil: "domcontentloaded" });
await page.waitForSelector(".view-toggle", { timeout: 15000 });
await page.locator('.view-toggle [role="tab"][data-value="human"]').first().click();
await page.waitForTimeout(800);
await page.evaluate(() => (document.getElementById("main").scrollTop = 0));
console.log("start", JSON.stringify(await top()));

/* what is under the point we aim at */
const under = await page.evaluate(() => {
  const el = document.elementFromPoint(700, 500);
  const path = [];
  for (let n = el; n && path.length < 6; n = n.parentElement)
    path.push(n.tagName.toLowerCase() + (n.className ? "." + String(n.className).split(" ").slice(0, 2).join(".") : ""));
  return path.join(" < ");
});
console.log("elementFromPoint(700,500):", under);

console.log("--- one big notch (-2400) ---");
console.log(ps("-Action", "scroll", "-X", "700", "-Y", "500", "-Delta", "-2400"));
await page.waitForTimeout(900);
console.log("after", JSON.stringify(await top()));

console.log("--- five ordinary notches (-120 x5) ---");
for (let i = 0; i < 5; i++) {
  ps("-Action", "scroll", "-X", "700", "-Y", "500", "-Delta", "-120");
  await page.waitForTimeout(160);
}
await page.waitForTimeout(900);
console.log("after", JSON.stringify(await top()));

console.log("--- playwright's own wheel ---");
await page.mouse.move(700, 500);
await page.mouse.wheel(0, 800);
await page.waitForTimeout(700);
console.log("after", JSON.stringify(await top()));

console.log("--- keyboard: click the sheet, then PageDown ---");
await page.evaluate(() => (document.getElementById("main").scrollTop = 0));
await page.mouse.click(700, 500);
await page.keyboard.press("PageDown");
await page.waitForTimeout(700);
console.log("after PageDown", JSON.stringify(await top()));
await page.keyboard.press("End");
await page.waitForTimeout(700);
console.log("after End", JSON.stringify(await top()));

await browser.close();
