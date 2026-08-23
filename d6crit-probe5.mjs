/** D6: ask the app to raise its own window (a cross-process z-order change is refused). */
import { chromium } from "playwright";

const on = process.argv[2] !== "off";
const browser = await chromium.connectOverCDP("http://localhost:9223");
const page = browser.contexts()[0].pages()[0];

const out = await page.evaluate(async (value) => {
  const inv = window.__TAURI_INTERNALS__?.invoke;
  const tries = {};
  const call = async (cmd, args) => {
    try {
      return { ok: true, v: await inv(cmd, args) };
    } catch (e) {
      return { ok: false, e: String(e).slice(0, 160) };
    }
  };
  tries.alwaysOnTop = await call("plugin:window|set_always_on_top", { value });
  tries.focus = await call("plugin:window|set_focus", {});
  tries.visible = await call("plugin:window|is_visible", {});
  tries.focused = await call("plugin:window|is_focused", {});
  return tries;
}, on);
console.log(JSON.stringify(out, null, 1));
await browser.close();
