import { chromium } from "playwright";
const ORIGIN = "http://localhost:5199";
const P = "prj-18ce28a0e9013418";
const out = [];
const say = (...m) => { console.log(...m); out.push(m.join(" ")); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("pageerror", (e) => say("PAGEERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error") say("CONSOLE-ERROR:", m.text()); });

const active = async () => page.evaluate(() => {
  const on = document.querySelector('.view-toggle [role="tab"][aria-selected="true"]');
  return on?.getAttribute("data-value") ?? null;
});
const goto = async (p) => { await page.goto(ORIGIN + p, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !document.querySelector(".skeleton") && (document.querySelector(".human-sheet, .human-empty, .record-section")));
  await page.waitForTimeout(150); };

// 1. default = human when human exists
await goto(`/p/${P}/work/WORK-0001`);
say("1a default on WORK-0001 (has human):", await active(), "· sheet visible:", await page.locator(".human-sheet").isVisible());
// 2. default = agent when none
await goto(`/p/${P}/bugs/BUG-0002`);
say("1b default on BUG-0002 (no human):", await active(), "· empty box:", await page.locator(".human-empty").count());
say("    sessionStorage after untouched visits:", await page.evaluate(() => window.sessionStorage.getItem("agentmon.recordView")));

// 3. choose agent, walk records
await goto(`/p/${P}/work/WORK-0001`);
await page.locator('.view-toggle [data-value="agent"]').click();
say("2a pressed Agent on WORK-0001 ->", await active(), "· storage:", await page.evaluate(() => sessionStorage.getItem("agentmon.recordView")));
await goto(`/p/${P}/bugs/BUG-0001`);
say("2b BUG-0001 after choosing Agent ->", await active());
await goto(`/p/${P}/notes/terminal-ux-rules`);
say("2c note after choosing Agent ->", await active());
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !document.querySelector(".skeleton"));
say("2d after reload ->", await active());

// 4. choose human, walk to a record with none -> empty state (not silently agent)
await page.locator('.view-toggle [data-value="human"]').click();
await goto(`/p/${P}/bugs/BUG-0002`);
say("3a Human chosen, then a record with none ->", await active(), "· empty box:", await page.locator(".human-empty").count());
// in-app navigation (no reload) via sidebar
await goto(`/p/${P}/work/WORK-0001`);

say("3b back on WORK-0001 ->", await active());

// 5. keyboard: tab reach + focus ring + Enter/Space + arrows
await goto(`/p/${P}/work/WORK-0001`);
await page.evaluate(() => sessionStorage.removeItem("agentmon.recordView"));
await goto(`/p/${P}/work/WORK-0001`);
await page.keyboard.press("Tab");
let hops = 0, info = null;
for (; hops < 40; hops++) {
  info = await page.evaluate(() => {
    const el = document.activeElement;
    return { cls: el?.className ?? "", tag: el?.tagName, dv: el?.getAttribute?.("data-value") ?? null,
             txt: (el?.textContent ?? "").trim().slice(0, 24) };
  });
  if (info.dv === "agent" || info.dv === "human") break;
  await page.keyboard.press("Tab");
}
say("4a tab stops to reach the toggle:", hops + 1, JSON.stringify(info));
const ring = await page.evaluate(() => {
  const el = document.activeElement; const s = getComputedStyle(el);
  return { outline: s.outlineWidth + " " + s.outlineStyle + " " + s.outlineColor, boxShadow: s.boxShadow.slice(0,80) };
});
say("4b focus ring on the focused segment:", JSON.stringify(ring));
say("4c active before keys:", await active());
await page.keyboard.press("ArrowRight");
say("4d after ArrowRight:", await active(), "· focused:", await page.evaluate(()=>document.activeElement?.getAttribute("data-value")));
await page.keyboard.press("Enter");
say("4e after Enter on focused segment:", await active());
await page.keyboard.press("Tab");
await page.keyboard.press("Space");
say("4f after Tab+Space on the other segment:", await active());

// 6. chips + wiki links inside human text are real links
await goto(`/p/${P}/work/WORK-0001`);
await page.locator('.view-toggle [data-value="human"]').click();
const chips = await page.evaluate(() => {
  const sheet = document.querySelector(".human-sheet");
  return [...sheet.querySelectorAll("a")].map((a) => ({ t: a.textContent.trim(), href: a.getAttribute("href"), cls: a.className }));
});
say("5a links inside the human sheet:", JSON.stringify(chips));
const codeCount = await page.locator(".human-sheet code").count();
say("5b inline code spans in the sheet:", codeCount);
const figs = await page.evaluate(() => {
  const f = [...document.querySelectorAll(".human-sheet .figure")].map(e=>e.textContent);
  const s = f.length ? getComputedStyle(document.querySelector(".human-sheet .figure")) : null;
  return { count: f.length, sample: f.slice(0,8), weight: s?.fontWeight, color: s?.color, size: s?.fontSize };
});
say("5c figures marked:", JSON.stringify(figs));
// wiki-link chip click actually navigates
await page.locator('.human-sheet a').filter({ hasText: "terminal-ux-rules" }).first().click();
await page.waitForTimeout(500);
say("5d clicking the [[wiki-link]] chip landed on:", page.url().replace(ORIGIN, ""));
say("5e view on the landed record:", await active());

// 7. measure the sheet
await goto(`/p/${P}/work/WORK-0001`);
const box = await page.evaluate(() => {
  const s = document.querySelector(".human-sheet").getBoundingClientRect();
  const cs = getComputedStyle(document.querySelector(".human-sheet"));
  const lede = document.querySelector(".human-lede");
  const p = lede ? getComputedStyle(lede) : null;
  const body = document.querySelector(".human-beat-body p") || document.querySelector(".human-beat-body");
  const b = body ? getComputedStyle(body) : null;
  return { sheet: { w: Math.round(s.width), h: Math.round(s.height), left: Math.round(s.left) },
           bg: cs.backgroundColor, border: cs.borderColor, radius: cs.borderRadius, pad: cs.padding,
           ledeSize: p?.fontSize, ledeColor: p?.color, bodySize: b?.fontSize, bodyLh: b?.lineHeight };
});
say("6a sheet metrics:", JSON.stringify(box));
const tk = await page.evaluate(() => { const e = document.querySelector(".human-takeaway"); if (!e) return null;
  const s = getComputedStyle(e); return { bg: s.backgroundColor, borderLeft: s.borderLeftColor + " " + s.borderLeftWidth, size: s.fontSize, weight: s.fontWeight }; });
say("6b takeaway:", JSON.stringify(tk));

await browser.close();
