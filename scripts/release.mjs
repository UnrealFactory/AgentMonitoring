#!/usr/bin/env node
/**
 * Build the Windows installer and publish it as a GitHub release.
 *
 *   npm run release              (or double-click release.bat)
 *   npm run release -- --notes "One line about what changed"
 *
 * What one run does, in order:
 *
 *   1. checks the three version fields agree (package.json / tauri.conf.json / Cargo.toml)
 *   2. checks the style contract in target/release/agentmon matches docs/HUMAN_STYLE.md,
 *      whole — the installer ships that binary, and a stale one teaches a superseded
 *      contract
 *   3. makes sure mcp/node_modules exists — the installer bundles the MCP server whole
 *   4. `npm run tauri:build` — CLI staged as externalBin, NSIS installer built
 *   5. creates (or updates) the GitHub release `v<version>` and uploads the installer
 *
 * Publishing is what makes the in-app updater (src-tauri/src/update.rs) fire: installed
 * apps poll `releases/latest`, compare the tag against their own version, and offer the
 * `*-setup.exe` asset this script uploads. Uses the `gh` CLI's stored login; run
 * `gh auth login` once on a new machine.
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "UnrealFactory/AgentMonitoring";
const log = (...m) => console.log("[release]", ...m);
const die = (msg) => {
  console.error("[release] STOP:", msg);
  process.exit(1);
};

const readJson = (rel) => JSON.parse(readFileSync(join(repoRoot, rel), "utf8"));

// ── 1 · one version, three files ────────────────────────────────────────────
const version = readJson("package.json").version;
const tauriVersion = readJson("src-tauri/tauri.conf.json").version;
const cargoVersion = /^version = "([^"]+)"$/m.exec(
  readFileSync(join(repoRoot, "Cargo.toml"), "utf8")
)?.[1];
if (version !== tauriVersion || version !== cargoVersion) {
  die(
    `version fields disagree — package.json ${version}, tauri.conf.json ${tauriVersion}, ` +
      `Cargo.toml ${cargoVersion}. Make them one number and re-run.`
  );
}
const tag = `v${version}`;
const notesArg = process.argv.indexOf("--notes");
const notes = notesArg > -1 ? process.argv[notesArg + 1] : `AgentMonitoring ${tag}`;
log(`releasing ${tag} to github.com/${REPO}`);

// ── 2 · the doc and the binary teach one contract ───────────────────────────
/* Same shape of failure as a version field left behind, and the same moment to catch it:
   two files that have to say one thing, checked before anything is built or published.
   The human-area style contract lives in docs/HUMAN_STYLE.md, but every agent meets it
   through the binary — `agentmon human-style`, a `--human` refusal, the MCP hand-over —
   which froze a copy of that doc at its last build. Editing prose is not a code change, so
   the rebuild gets skipped, and the installer ships rules nobody wrote. */
try {
  execSync("node scripts/check-humanstyle-drift.mjs", { cwd: repoRoot, stdio: "inherit" });
} catch {
  die("the style contract in target/release disagrees with docs/HUMAN_STYLE.md (above). Rebuild and re-run.");
}

// ── 3 · the MCP server's dependencies ship inside the installer ─────────────
if (!existsSync(join(repoRoot, "mcp", "node_modules"))) {
  log("mcp/node_modules missing — npm install (the bundle needs it)…");
  execSync("npm install", { cwd: join(repoRoot, "mcp"), stdio: "inherit" });
}

// ── 4 · build ───────────────────────────────────────────────────────────────
log("npm run tauri:build (CLI + app + NSIS installer)…");
execSync("npm run tauri:build", { cwd: repoRoot, stdio: "inherit" });

// The workspace has one shared target/ at the repo root (src-tauri is a member).
const installer = join(
  repoRoot,
  "target",
  "release",
  "bundle",
  "nsis",
  `AgentMonitoring_${version}_x64-setup.exe`
);
if (!existsSync(installer)) die(`the build finished but ${installer} is not there`);

// ── 5 · publish ─────────────────────────────────────────────────────────────
const gh = (args, opts = {}) => {
  // With stdio "inherit" (the create/upload calls, so gh's progress shows) execFileSync
  // returns null — only stringify what was actually piped back.
  const out = execFileSync("gh", args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], ...opts });
  return out == null ? "" : out.toString().trim();
};

let exists = true;
try {
  gh(["release", "view", tag, "--repo", REPO, "--json", "tagName"]);
} catch {
  exists = false;
}

if (exists) {
  log(`release ${tag} already exists — replacing its installer asset`);
  gh(["release", "upload", tag, installer, "--repo", REPO, "--clobber"], { stdio: "inherit" });
} else {
  log(`creating release ${tag}`);
  gh(
    [
      "release",
      "create",
      tag,
      installer,
      "--repo",
      REPO,
      "--title",
      `AgentMonitoring ${tag}`,
      "--notes",
      notes,
    ],
    { stdio: "inherit" }
  );
}

log(`done — https://github.com/${REPO}/releases/tag/${tag}`);
log("installed apps see it on their next check (launch, or the half-hour recheck).");
