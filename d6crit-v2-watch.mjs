/**
 * D6 (v2): who is hiding the window?
 *
 * The app hides to the tray on close (src-tauri/src/lib.rs:944-953), and mid-run the window
 * went is_visible=false with is_minimized=false — a hide, not a minimise. Before blaming any
 * of the checks, watch an idle window: if it hides while nothing is driving it, something
 * outside this pass is doing it.
 *
 *   node d6crit-v2-watch.mjs [seconds] [--show]
 */
import { chromium } from "playwright";

const secs = Number(process.argv[2] || 30);
const show = process.argv.includes("--show");
const browser = await chromium.connectOverCDP("http://localhost:9223");
const page = browser.contexts()[0].pages()[0];

const ask = (cmd) =>
  page.evaluate(
    (c) => window.__TAURI_INTERNALS__.invoke("plugin:window|" + c).catch((e) => "ERR " + String(e).slice(0, 40)),
    cmd
  );

if (show) {
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|show"));
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("plugin:window|set_focus").catch(() => {}));
  console.log("asked the app to show its window");
}

const t0 = Date.now();
let last = null;
while ((Date.now() - t0) / 1000 < secs) {
  const state = {
    visible: await ask("is_visible"),
    minimized: await ask("is_minimized"),
    focused: await ask("is_focused"),
    url: await page.evaluate(() => location.pathname),
  };
  const line = JSON.stringify(state);
  if (line !== last) {
    console.log(`  +${((Date.now() - t0) / 1000).toFixed(1)}s ${line}`);
    last = line;
  }
  await page.waitForTimeout(1500);
}
console.log("done watching");
await browser.close();
