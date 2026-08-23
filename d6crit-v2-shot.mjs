/**
 * D6 (v2): a screen grab that is of the app, now.
 *
 * Three ways the first helper (d6crit-shot.mjs + d6crit-win.ps1) lied on this machine, all
 * silent, all seen live in this pass:
 *
 * 1. `Get-Process().MainWindowHandle` sometimes answers with a 16x16 stub at 0,0 (the tray's
 *    message window). The grab then throws inside PowerShell, exits 0, and the caller happily
 *    reports a filename that was never written. d6crit-v2-win.ps1 picks the window by
 *    enumerating the process's own top-level windows instead.
 * 2. The app hides to the tray on close (src-tauri/src/lib.rs:944). A hidden window still has
 *    a client rect, so the grab photographs the desktop behind it. So: ask the app whether it
 *    is visible (the note verify-desktop-via-cdp: ask whoever owns the window), and bring it
 *    back through the single-instance plugin if it is not.
 * 3. WebView2 stops painting while the window is covered, and the revealed window keeps the
 *    stale frame for a few hundred ms — progress/critic-d6/2-a…png caught the bugs board on a
 *    record page that way. So: reveal, then wait, then grab.
 */
import { execFileSync, spawn } from "node:child_process";
import { statSync } from "node:fs";

const ROOT = "C:/Code/AgentMonitoring";
const SHOTS = `${ROOT}/progress/critic-d6`;
const EXE = `${ROOT}/target/debug/agentmonitoring.exe`;

const PS = (file, args) => {
  try {
    return execFileSync("powershell", ["-NoProfile", "-File", `${ROOT}/${file}`, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (e) {
    return `PSFAIL ${String(e.stderr || e.message).split("\n")[0].slice(0, 120)}`;
  }
};

const ask = (page, cmd) =>
  page.evaluate(
    (c) => window.__TAURI_INTERNALS__.invoke("plugin:window|" + c).catch((e) => "ERR " + String(e).slice(0, 30)),
    cmd
  );

/** The window is the app's to show: a second launch surfaces it (single-instance plugin). */
async function ensureVisible(page) {
  if ((await ask(page, "is_visible")) === true) return "was visible";
  spawn(EXE, [], { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(500);
    if ((await ask(page, "is_visible")) === true) return "re-shown from the tray";
  }
  return "STILL HIDDEN";
}

/**
 * Grab the window. Returns { file, ok, note } — `ok` false means the picture cannot be
 * trusted and the caller should say so rather than cite it.
 */
export async function shot(page, name) {
  const out = `${SHOTS}/${name}.png`;
  const shown = await ensureVisible(page);
  const raised = PS("d6crit-v2-win.ps1", ["-Action", "raise"]);
  await page.waitForTimeout(700); // let WebView2 repaint what it stopped painting while covered
  const said = PS("d6crit-v2-win.ps1", ["-Action", "shot", "-Out", out]);
  let size = 0;
  let fresh = false;
  try {
    const st = statSync(out);
    size = st.size;
    fresh = Date.now() - st.mtimeMs < 20000;
  } catch {}
  const ok = fresh && size > 20000 && /1440x900|1440 x 900|\(1440x900\)/.test(said.replace(/\s/g, ""));
  return {
    file: `${name}.png`,
    ok,
    note: `${shown}; ${raised}; ${said}; ${size}B`,
  };
}

/** A real OS wheel over the app; falls back to a CDP wheel and says which one moved it. */
export async function wheelOver(page, x, y, delta) {
  await ensureVisible(page);
  PS("d6crit-v2-win.ps1", ["-Action", "raise"]);
  const said = PS("d6crit-v2-win.ps1", ["-Action", "scroll", "-X", String(x), "-Y", String(y), "-Delta", String(delta)]);
  await page.waitForTimeout(700);
  let top = await page.evaluate(() => Math.round(document.getElementById("main").scrollTop));
  if (top > 0) return { top, how: `real OS wheel (${said})` };
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -delta > 0 ? -delta : Math.abs(delta));
  await page.waitForTimeout(700);
  top = await page.evaluate(() => Math.round(document.getElementById("main").scrollTop));
  return { top, how: `CDP wheel after the OS wheel missed (${said})` };
}
