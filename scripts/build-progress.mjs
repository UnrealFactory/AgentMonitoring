#!/usr/bin/env node
// Regenerates progress/index.html from progress/rounds.jsonl.
// Usage: node scripts/build-progress.mjs
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const roundsPath = join(root, "progress", "rounds.jsonl");
const outPath = join(root, "progress", "index.html");

const PIECES = {
  P0: "Foundation (scaffold, shell, screenshot infra)",
  P1: "agentmon CLI + manual",
  P2: "Work detail + list",
  P3: "Bug board + detail",
  P4: "Dashboard",
  P5: "Shell/projects/portability",
  P6: "Final gate",
  D1: "Dual: human-area style contract",
  D2: "Dual: storage + validation + CLI/MCP",
  D3: "Dual: Agent/Human toggle UI",
  D4: "Dual: live-data backfill",
  D5: "Dual: instruction diet",
  D6: "Dual: final gate",
};

const rounds = existsSync(roundsPath)
  ? readFileSync(roundsPath, "utf8").split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean)
  : [];

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const byPiece = {};
for (const r of rounds) (byPiece[r.piece] ??= []).push(r);

/**
 * A piece's status, from every critic who graded its latest round — not from whichever one
 * appended last.
 *
 * A round is graded by several critics at once (design, comprehension, desktop, CLI), and
 * taking the last row let one pass overwrite three fails written minutes earlier: the P6
 * badge read PASS while the design critic's fail was still open, which the desktop critic
 * had to warn the manager about in prose. A round passes when nobody failed it, and the
 * badge says how many graded it.
 */
const statusOf = (id) => {
  const rs = byPiece[id] ?? [];
  if (!rs.length) return { label: "not started", cls: "idle" };
  const critics = rs.filter((r) => r.role === "critic");
  if (!critics.length) return { label: "building…", cls: "run" };
  const latest = Math.max(...critics.map((r) => Number(r.round) || 0));
  const graded = critics.filter((r) => (Number(r.round) || 0) === latest);
  const failed = graded.filter((r) => r.verdict !== "pass");
  const of = graded.length > 1 ? ` of ${graded.length}` : "";
  if (failed.length) {
    return { label: `round ${latest}: ${failed.length}${of} FAIL`, cls: "fail" };
  }
  return { label: `PASS (round ${latest}${of ? `, ${graded.length} critics` : ""})`, cls: "pass" };
};

const shotsDir = join(root, "progress", "shots");
const shots = existsSync(shotsDir)
  ? readdirSync(shotsDir).filter((f) => f.endsWith(".png")).sort()
  : [];

const pieceRows = Object.entries(PIECES).map(([id, name]) => {
  const s = statusOf(id);
  return `<tr><td class="id">${id}</td><td>${esc(name)}</td><td><span class="badge ${s.cls}">${esc(s.label)}</span></td><td class="num">${(byPiece[id] ?? []).length}</td></tr>`;
}).join("\n");

const roundRows = [...rounds].reverse().slice(0, 120).map((r) => `
  <div class="round">
    <div class="round-head">
      <span class="badge ${r.verdict === "pass" ? "pass" : r.role === "critic" ? "fail" : "run"}">${esc(r.piece)} · r${esc(r.round)} · ${esc(r.role)}${r.verdict ? " · " + esc(r.verdict) : ""}</span>
      <span class="ts">${esc(r.ts ?? "")}</span>
    </div>
    ${r.biggestGap ? `<div class="gap"><b>Biggest gap:</b> ${esc(r.biggestGap)}</div>` : ""}
    ${r.notes ? `<div class="notes">${esc(r.notes)}</div>` : ""}
  </div>`).join("\n");

const shotCells = shots.map((f) => `
  <figure><img src="shots/${esc(f)}" loading="lazy"/><figcaption>${esc(f)}</figcaption></figure>`).join("\n");

writeFileSync(outPath, `<!doctype html>
<html><head><meta charset="utf-8"/>
<meta http-equiv="refresh" content="15"/>
<title>AgentMonitoring — build progress</title>
<style>
  :root{color-scheme:dark}
  body{background:#0e0f11;color:#e8e9eb;font:14px/1.55 ui-sans-serif,system-ui,"Segoe UI",sans-serif;margin:0;padding:32px;max-width:1100px;margin-inline:auto}
  h1{font-size:20px;letter-spacing:-.02em} h2{font-size:15px;color:#8a8f98;margin-top:36px;text-transform:uppercase;letter-spacing:.06em;font-weight:600}
  table{border-collapse:collapse;width:100%;margin-top:12px}
  td,th{border-bottom:1px solid rgba(255,255,255,.07);padding:8px 12px;text-align:left;font-size:13.5px}
  .id{color:#8a8f98;font-family:ui-monospace,monospace}.num{text-align:right;color:#8a8f98}
  .badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600}
  .pass{background:rgba(52,199,123,.15);color:#4ade80}.fail{background:rgba(245,101,101,.13);color:#f87171}
  .run{background:rgba(94,106,210,.16);color:#a5b0f5}.idle{background:rgba(255,255,255,.06);color:#8a8f98}
  .round{border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:12px 14px;margin-top:10px;background:#16171a}
  .round-head{display:flex;justify-content:space-between;gap:12px}.ts{color:#62666d;font-size:12px}
  .gap{margin-top:6px;color:#fbbf24;font-size:13px}.notes{margin-top:4px;color:#8a8f98;font-size:13px;white-space:pre-wrap}
  figure{margin:0}figcaption{color:#62666d;font-size:12px;margin-top:4px}
  img{width:100%;border:1px solid rgba(255,255,255,.08);border-radius:8px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px}
  .meta{color:#62666d;font-size:12.5px}
</style></head><body>
<h1>AgentMonitoring — live build progress</h1>
<div class="meta">Auto-refreshes every 15s · ${rounds.length} recorded rounds · generated from progress/rounds.jsonl</div>
<h2>Pieces</h2>
<table><tr><th></th><th>Piece</th><th>Status</th><th>Rounds</th></tr>
${pieceRows}
</table>
<h2>Latest screenshots</h2>
<div class="grid">${shotCells || "<div class='meta'>none yet</div>"}</div>
<h2>Round history (newest first)</h2>
${roundRows || "<div class='meta'>none yet</div>"}
</body></html>`);
console.log(`progress/index.html regenerated (${rounds.length} rounds, ${shots.length} shots)`);
