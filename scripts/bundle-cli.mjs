#!/usr/bin/env node
/**
 * Put the `agentmon` CLI where the Tauri bundler can ship it with the app.
 *
 *   node scripts/bundle-cli.mjs        (run by `npm run tauri:build`)
 *
 * Why the desktop app ships a CLI at all: the app only *reads* the vault — agents write it,
 * with `agentmon`. Until this existed, the installer contained exactly one file,
 * agentmonitoring.exe, so a human who installed the release and had no vault was handed a
 * screen whose three instructions all began with a command they did not have and could not
 * get from inside the window. Now the binary sits beside the app, `cli_path()`
 * (src-tauri/src/lib.rs) finds it, and the onboarding prints command lines that name it.
 *
 * Tauri's `bundle.externalBin` wants the file suffixed with the Rust target triple, which is
 * how one build can carry binaries for several targets; the bundler strips the suffix again
 * when it installs it. That naming is the whole reason this script exists rather than a
 * `cp` in package.json.
 *
 * The externalBin entry lives in src-tauri/tauri.release.conf.json, merged in only by
 * `npm run tauri:build` — deliberately not in tauri.conf.json, because Tauri's build script
 * fails when a declared external binary is missing, and that would make plain
 * `cargo build` / `cargo test --workspace` on a fresh clone fail until this had been run.
 *
 * That same release config bundles the MCP server (`resources`: mcp/server.mjs + lib +
 * node_modules → <install>/mcp/...). Its entries are directory→directory maps on purpose:
 * a glob source ("../mcp/lib/" + two stars + "/(star)": "mcp/lib/") flattens every match
 * to its bare file name inside the target — tauri-utils resources.rs treats globs and
 * directories differently — and a flattened node_modules is 3,500 files collapsing onto
 * each other. (The glob is paraphrased here because its own characters end a JS comment.)
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const log = (...m) => console.log("[bundle-cli]", ...m);

/** The triple this machine builds for, from the toolchain itself — never guessed. */
function hostTriple() {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const host = /^host:\s*(\S+)$/m.exec(out)?.[1];
  if (!host) throw new Error(`could not read the host triple from \`rustc -vV\`:\n${out}`);
  return host;
}

const triple = hostTriple();
const exe = process.platform === "win32" ? ".exe" : "";

log(`building agentmon for ${triple}…`);
execFileSync("cargo", ["build", "--release", "-p", "agentmon-cli"], {
  cwd: repoRoot,
  stdio: "inherit",
});

const built = join(repoRoot, "target", "release", `agentmon${exe}`);
const dir = join(repoRoot, "src-tauri", "binaries");
const dest = join(dir, `agentmon-${triple}${exe}`);
mkdirSync(dir, { recursive: true });
copyFileSync(built, dest);

log(`${dest} (${statSync(dest).size.toLocaleString()} bytes)`);
