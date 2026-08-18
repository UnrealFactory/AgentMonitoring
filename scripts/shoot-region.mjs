#!/usr/bin/env node
/**
 * Shoot one element (or a slice of a page) against an already-running dev server.
 *
 *   node scripts/shoot-region.mjs <path> <css-selector> <out.png> [--width 1600] [--port 5173]
 *
 * A working tool for reading one's own screens closely: the whole-page shot is often
 * 5,000px tall, and a builder who only ever looks at the thumbnail ships what a thumbnail
 * hides. Not part of the product; scripts/screenshot.mjs is what the critics run.
 */
import { chromium } from "playwright";

const args = process.argv.slice(2);
const [path, selector, out] = args;
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

if (!path || !selector || !out) {
  console.error("usage: shoot-region.mjs <path> <selector> <out.png> [--width N] [--height N] [--port N]");
  process.exit(1);
}

const width = Number(value("--width", 1600));
const height = Number(value("--height", 1000));
const port = Number(value("--port", 5173));

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: 2,
  colorScheme: "dark",
  reducedMotion: "reduce",
});
await page.goto(`http://localhost:${port}${path}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(selector, { state: "visible", timeout: 20_000 });
await page.waitForFunction(() => !document.querySelector(".skeleton"));
await page.evaluate(() => document.fonts.ready);
await page.locator(selector).first().screenshot({ path: out });
console.log(`${out}  ${path}  ${selector}`);
await browser.close();
