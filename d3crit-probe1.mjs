import { chromium } from "playwright";

const ORIGIN = "http://localhost:5417";
const FX = "prj-18ce598acf270c64";
const LIVE = "prj-agent-monitoring";
const out = (...a) => console.log(...a);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

const settle = async () => {
  await page.waitForFunction(() => !document.querySelector(".skeleton"));
  await page.waitForTimeout(120);
};

// ---------- 1. DEFAULT VIEW with no session ----------
out("\n=== 1. DEFAULT (sessionStorage cleared before each nav) ===");
const defaults = [
  ["fixture WORK-0001 (retold)", `/p/${FX}/work/WORK-0001`],
  ["fixture BUG-0001 (retold)", `/p/${FX}/bugs/BUG-0001`],
  ["fixture BUG-0003 (NO human)", `/p/${FX}/bugs/BUG-0003`],
  ["fixture note relay-queue-basics", `/p/${FX}/notes/relay-queue-basics`],
  ["app feedback board", `/app-feedback`],
];
for (const [label, path] of defaults) {
  await page.goto(`${ORIGIN}${path}`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle();
  const r = await page.evaluate(() => {
    const sel = document.querySelector('.view-toggle [role="tab"][aria-selected="true"]');
    return {
      selected: sel?.getAttribute("data-value") ?? null,
      label: sel?.textContent?.trim() ?? null,
      session: sessionStorage.getItem("agentmon.recordView"),
      hasSheet: !!document.querySelector(".human-sheet"),
      hasEmpty: !!document.querySelector(".human-empty"),
      segments: [...document.querySelectorAll('.view-toggle [role="tab"]')].map((t) => t.textContent.trim()),
    };
  });
  out(`  ${label.padEnd(34)} -> ${r.selected}  session=${r.session}  sheet=${r.hasSheet} empty=${r.hasEmpty}  segs=${JSON.stringify(r.segments)}`);
}

// ---------- 2. PERSISTENCE ----------
out("\n=== 2. PERSISTENCE across records / kinds / reload ===");
await page.goto(`${ORIGIN}/p/${FX}/work/WORK-0001`, { waitUntil: "domcontentloaded" });
await page.evaluate(() => sessionStorage.clear());
await page.reload({ waitUntil: "domcontentloaded" });
await settle();
await page.click('.view-toggle [role="tab"][data-value="agent"]');
await page.waitForTimeout(150);
out("  pinned Agent on WORK-0001, session =", await page.evaluate(() => sessionStorage.getItem("agentmon.recordView")));
for (const [label, path] of [
  ["-> fixture BUG-0001", `/p/${FX}/bugs/BUG-0001`],
  ["-> fixture note", `/p/${FX}/notes/relay-queue-basics`],
  ["-> app feedback", `/app-feedback`],
  ["-> live WORK-0067", `/p/${LIVE}/work/WORK-0067`],
]) {
  await page.goto(`${ORIGIN}${path}`, { waitUntil: "domcontentloaded" });
  await settle();
  out(`  ${label.padEnd(24)} selected=${await page.evaluate(() => document.querySelector('.view-toggle [role="tab"][aria-selected="true"]')?.getAttribute("data-value"))}`);
}
await page.reload({ waitUntil: "domcontentloaded" });
await settle();
out("  after reload            selected=", await page.evaluate(() => document.querySelector('.view-toggle [role="tab"][aria-selected="true"]')?.getAttribute("data-value")));

// now pin Human and walk to a record without one
await page.goto(`${ORIGIN}/p/${FX}/work/WORK-0001`, { waitUntil: "domcontentloaded" });
await settle();
await page.click('.view-toggle [role="tab"][data-value="human"]');
await page.waitForTimeout(150);
await page.goto(`${ORIGIN}/p/${FX}/bugs/BUG-0003`, { waitUntil: "domcontentloaded" });
await settle();
out("  Human pinned, on BUG-0003 (no human):", await page.evaluate(() => ({
  selected: document.querySelector('.view-toggle [role="tab"][aria-selected="true"]')?.getAttribute("data-value"),
  empty: !!document.querySelector(".human-empty"),
  session: sessionStorage.getItem("agentmon.recordView"),
})));
// press the escape button
const escBtn = page.locator(".human-empty button").first();
out("  empty-box button text:", (await escBtn.textContent())?.trim());
await escBtn.click();
await page.waitForTimeout(200);
out("  after pressing it:", await page.evaluate(() => ({
  selected: document.querySelector('.view-toggle [role="tab"][aria-selected="true"]')?.getAttribute("data-value"),
  session: sessionStorage.getItem("agentmon.recordView"),
  peek: document.querySelector(".view-peek")?.textContent?.trim() ?? null,
})));
await page.goto(`${ORIGIN}/p/${FX}/bugs/BUG-0001`, { waitUntil: "domcontentloaded" });
await settle();
out("  next retold record opens on:", await page.evaluate(() => document.querySelector('.view-toggle [role="tab"][aria-selected="true"]')?.getAttribute("data-value")));

// ---------- 3. KEYBOARD ----------
out("\n=== 3. KEYBOARD ===");
await page.goto(`${ORIGIN}/p/${FX}/work/WORK-0001`, { waitUntil: "domcontentloaded" });
await page.evaluate(() => sessionStorage.clear());
await page.reload({ waitUntil: "domcontentloaded" });
await settle();
await page.evaluate(() => document.body.focus());
let stops = 0, reached = false, path = [];
for (let i = 0; i < 40; i++) {
  await page.keyboard.press("Tab");
  stops++;
  const info = await page.evaluate(() => {
    const a = document.activeElement;
    return { cls: a?.className ?? "", tag: a?.tagName, dv: a?.getAttribute?.("data-value"), inToggle: !!a?.closest?.(".view-toggle") };
  });
  path.push(`${info.tag}.${String(info.cls).split(" ")[0]}`);
  if (info.inToggle) { reached = true; break; }
}
out(`  Tab reaches the toggle in ${stops} stops: ${reached}`);
if (reached) {
  const ring = await page.evaluate(() => {
    const a = document.activeElement;
    const s = getComputedStyle(a);
    return { outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`, offset: s.outlineOffset, dv: a.getAttribute("data-value"), sel: a.getAttribute("aria-selected"), role: a.getAttribute("role") };
  });
  out("  focus ring:", JSON.stringify(ring));
  for (const key of ["ArrowRight", "ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "]) {
    await page.keyboard.press(key === " " ? "Space" : key);
    await page.waitForTimeout(120);
    const st = await page.evaluate(() => ({
      focused: document.activeElement?.getAttribute?.("data-value"),
      selected: document.querySelector('.view-toggle [role="tab"][aria-selected="true"]')?.getAttribute("data-value"),
      sheet: !!document.querySelector(".human-sheet"),
    }));
    out(`   ${key.padEnd(11)} focus=${st.focused} selected=${st.selected} sheet=${st.sheet}`);
  }
}

// ---------- 4. CHIPS AND WIKI LINKS INSIDE HUMAN TEXT ----------
out("\n=== 4. CHIPS / WIKI-LINKS / INLINE CODE inside the retelling ===");
await page.goto(`${ORIGIN}/p/${FX}/work/WORK-0001`, { waitUntil: "domcontentloaded" });
await settle();
await page.click('.view-toggle [role="tab"][data-value="human"]').catch(() => {});
await page.waitForTimeout(200);
const refs = await page.evaluate(() => {
  const sheet = document.querySelector(".human-sheet");
  return {
    refs: [...sheet.querySelectorAll("a.ref-inline, a[class*=ref]")].map((a) => ({ t: a.textContent.trim(), href: a.getAttribute("href"), cls: a.className })),
    code: [...sheet.querySelectorAll("code")].map((c) => {
      const s = getComputedStyle(c);
      return { t: c.textContent.slice(0, 40), fs: s.fontSize, ff: s.fontFamily.split(",")[0], bg: s.backgroundColor, wrap: s.overflowWrap || s.wordWrap };
    }),
    strong: [...sheet.querySelectorAll(".human-beat-body strong, .human-lede strong")].map((s) => ({ t: s.textContent.slice(0, 24), w: getComputedStyle(s).fontWeight, c: getComputedStyle(s).color })),
  };
});
out("  refs:", JSON.stringify(refs.refs, null, 1));
out("  inline code:", JSON.stringify(refs.code.slice(0, 4)));
out("  figures/strong:", JSON.stringify(refs.strong.slice(0, 6)));

await browser.close();
