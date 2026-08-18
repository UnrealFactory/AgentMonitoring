#!/usr/bin/env node
/**
 * Find text this app cuts in half.
 *
 *   node scripts/check-clipping.mjs [--port 5173] [--widths 1600,1440,1280,1152,960]
 *
 * A fixed-width box with `overflow: hidden` guillotines whatever sticks out of it, and
 * `text-overflow: ellipsis` on an inner element does not fire — that element believes it
 * fits, because it does; it is the *ancestor* that is too small. The result is a name
 * sliced down the middle of a glyph with nothing to warn the reader ("p3-bugs-builc"),
 * which on a page whose whole job is to show a record faithfully is a correctness bug and
 * not a cosmetic one.
 *
 * So: walk every screen at every width, find each element that clips, and report any
 * descendant whose ink leaves that element's padding box without the descendant itself
 * being the one doing the truncating. Exit non-zero if anything is cut.
 *
 * Run it against a dev server that is already up (npm run dev, or the screenshot script's
 * --keep-server). Not part of the product; a builder's tool, like shoot-region.mjs.
 */
import { chromium } from "playwright";

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const port = Number(value("--port", 5173));
const origin = `http://localhost:${port}`;
const widths = value("--widths", "1600,1440,1280,1152,960")
  .split(",")
  .map((w) => Number(w.trim()))
  .filter(Boolean);

const api = async (path) => {
  const res = await fetch(`${origin}/vault-api${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return res.json();
};

/**
 * Runs in the page. `slack` (px) is the tolerance: sub-pixel rounding of a rect against a
 * padding box is not a clip, a third of a character is.
 */
const FIND_CLIPPED = (slack) => {
  const out = [];
  const style = (el) => getComputedStyle(el);
  // `hidden`/`clip` cut; `auto`/`scroll` can be reached by the reader, so they do not.
  const clipsHorizontally = (el) => {
    const s = style(el);
    return s.overflowX === "hidden" || s.overflowX === "clip";
  };
  const label = (el) => {
    const cls = typeof el.className === "string" ? el.className.split(/\s+/)[0] : "";
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`;
  };

  for (const el of document.querySelectorAll("*")) {
    if (!clipsHorizontally(el)) continue;
    const box = el.getBoundingClientRect();
    if (box.width === 0) continue;
    const padRight = box.right - parseFloat(style(el).borderRightWidth || "0");
    const padLeft = box.left + parseFloat(style(el).borderLeftWidth || "0");

    for (const child of el.querySelectorAll("*")) {
      if (child.children.length) continue; // only leaves carry ink
      const text = (child.textContent || "").trim();
      if (!text) continue;
      // Purely geometric on purpose. `text-overflow: ellipsis` on the child proves
      // nothing: when the child fits its own box and the box is what sticks out, the
      // ellipsis never fires and the ancestor cuts a glyph in half — the exact defect
      // this script exists to catch.
      const r = child.getBoundingClientRect();
      if (r.width === 0) continue;
      const over = Math.max(r.right - padRight, padLeft - r.left);
      if (over > slack) {
        out.push({
          clipper: label(el),
          cut: label(child),
          text: text.slice(0, 60),
          overflowPx: Math.round(over * 10) / 10,
        });
      }
    }
  }
  return out;
};

const browser = await chromium.launch();
let failures = 0;

try {
  const projects = await api("/projects");
  const paths = [];
  for (const p of projects) {
    const bugs = await api(`/projects/${p.slug}/bugs`);
    const works = await api(`/projects/${p.slug}/worklogs`);
    paths.push(`/p/${p.slug}`, `/p/${p.slug}/work`, `/p/${p.slug}/bugs`);
    if (works[0]) paths.push(`/p/${p.slug}/work/${works[0].id}`);
    if (bugs[0]) paths.push(`/p/${p.slug}/bugs/${bugs[0].id}`);
  }
  paths.push("/projects");

  for (const width of widths) {
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    for (const path of paths) {
      await page.goto(`${origin}${path}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".page-title, .record-title", { state: "visible" });
      await page.waitForFunction(() => !document.querySelector(".skeleton"));
      await page.evaluate(() => document.fonts.ready);
      // Bug boards open on "Open"; the dense view is All, so judge that one too.
      const tab = page.getByRole("tab", { name: /^All/ });
      if (await tab.count()) {
        await tab.click();
        await page.waitForTimeout(80);
      }
      const found = await page.evaluate(FIND_CLIPPED, 0.75);
      for (const f of found) {
        failures += 1;
        console.log(
          `CLIPPED ${String(width).padEnd(5)} ${path.padEnd(34)} ${f.clipper} cuts ${f.cut} ` +
            `by ${f.overflowPx}px — "${f.text}"`,
        );
      }
    }
    await page.close();
    console.log(`[check-clipping] ${width}px — ${paths.length} screens checked`);
  }
} finally {
  await browser.close();
}

console.log(
  failures === 0
    ? "[check-clipping] clean: nothing is cut without an ellipsis"
    : `[check-clipping] ${failures} clipped element(s)`,
);
process.exit(failures === 0 ? 0 : 1);
