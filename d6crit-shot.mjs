/**
 * A screen grab of the real desktop window that is actually of the real desktop window.
 *
 * The plain grab (scripts/win-window.ps1) photographs the app's screen rectangle after a
 * SetForegroundWindow that this machine refuses — so a File Explorer window sitting over the
 * app landed in the picture, and the real mouse wheel went to Explorer. Both were silent.
 * Here the rectangle is cleared first (d6crit-clear.ps1, which minimises whatever is over
 * the app and remembers it for a restore) and only then photographed.
 */
import { execFileSync } from "node:child_process";

const PS = (file, args) =>
  execFileSync("powershell", ["-NoProfile", "-File", `C:/Code/AgentMonitoring/${file}`, ...args], {
    encoding: "utf8",
  }).trim();

export const clearRect = () => PS("d6crit-clear.ps1", ["-Action", "hide"]);
export const restoreWindows = () => PS("d6crit-clear.ps1", ["-Action", "restore"]);

const SHOTS = "C:/Code/AgentMonitoring/progress/critic-d6";

export function shot(name) {
  clearRect();
  PS("d6crit-win.ps1", ["-Action", "shot", "-Out", `${SHOTS}/${name}.png`]);
  return `${name}.png`;
}

/** The real wheel, one notch at a time, over a point in the app's client area. */
export function wheel(x, y, delta) {
  clearRect();
  return PS("d6crit-win.ps1", ["-Action", "scroll", "-X", String(x), "-Y", String(y), "-Delta", String(delta)]);
}
