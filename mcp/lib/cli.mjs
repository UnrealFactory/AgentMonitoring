// Spawning agentmon and boiling its --json envelope down to something small.
//
// Everything here exists to keep the CLI as the single source of truth: this server
// validates nothing that agentmon already validates (bodies, timestamps, state
// transitions, ids). It shapes the call, hands over the prose on stdin, and turns the
// answer into one short line.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

/** Exit codes agentmon documents. Kept here so error text can name the meaning. */
export const EXIT_MEANING = {
  0: "ok",
  1: "project has problems",
  2: "usage or timestamp rejected",
  3: "not found",
  4: "body rejected",
  5: "conflict",
  6: "invalid project",
  7: "io error",
};

/**
 * --bin > $AGENTMON_BIN > <root>/agentmon[.exe] > <repo>/target/{release,debug} >
 * agentmon on PATH. Nothing here ever discovers a project; that is `--dir` only, on
 * purpose.
 *
 * The bare `<root>` candidate is the installed desktop app: the bundle puts this server
 * at `<install>/mcp/server.mjs` and the CLI at `<install>/agentmon.exe`
 * (src-tauri/tauri.release.conf.json), so two levels up from lib/ *is* the folder the
 * binary sits in. In a source checkout that path is `<repo>/agentmon.exe`, which does
 * not exist, and the target/ candidates behind it do the work as before.
 */
export function resolveBinary(explicit) {
  const exe = process.platform === "win32" ? "agentmon.exe" : "agentmon";
  const candidates = [
    explicit,
    process.env.AGENTMON_BIN,
    path.join(repoRoot, exe),
    path.join(repoRoot, "target", "release", exe),
    path.join(repoRoot, "target", "debug", exe),
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return { bin: c, found: true };
  if (explicit) return { bin: explicit, found: false };
  return { bin: exe, found: false }; // let PATH decide, report ENOENT if it cannot
}

/** Cut the shell-shaped tail off a CLI message, collapse blank runs, cap the length. */
export function trimCliMessage(message, cap = 600) {
  let s = String(message ?? "").replace(/\r\n/g, "\n");
  // These blocks teach a *shell* caller how to retype the command, and the markdown
  // template teaches a body shape this server builds itself from the what/why/how
  // fields. An MCP caller has neither a shell nor a body to write, so both are pure
  // tokens — the diagnosis above them names what is wrong, which is the actionable part.
  for (const marker of ["\nExpected structure", "\nExample that works", "\nEXAMPLES", "\nUsage:"]) {
    const i = s.indexOf(marker);
    if (i > 0) s = s.slice(0, i);
  }
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  if (s.length > cap) s = s.slice(0, cap - 34).trimEnd() + "… (trimmed; run the CLI for all of it)";
  return s;
}

/**
 * Run agentmon once. Never throws: the failure shape is the return value.
 * `stdin` is the prose for whichever --*-file - flag is in `args`.
 */
export function runCli(cfg, args, stdin) {
  const argv = ["--dir", cfg.dir, ...args];
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cfg.bin, argv, {
        windowsHide: true,
        env: childEnv(cfg),
      });
    } catch (err) {
      return resolve(spawnFailure(cfg, err));
    }
    let out = "";
    let errText = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (errText += d));
    child.on("error", (err) => resolve(spawnFailure(cfg, err)));
    child.on("close", (code) => {
      // With --json the success envelope is on stdout and the failure envelope is on
      // stderr, so parse whichever stream actually carries JSON.
      const json = parseJson(out) ?? parseJson(errText);
      resolve({
        ok: code === 0,
        exitCode: code ?? -1,
        json,
        stdout: out.trim(),
        stderr: errText.trim(),
      });
    });
    child.stdin.on("error", () => {}); // a rejected command may exit before reading
    if (stdin != null) child.stdin.end(stdin);
    else child.stdin.end();
  });
}

/**
 * The server's identity is authoritative: a stray AGENTMON_* in the parent environment
 * must never redirect a write to another project or agent. They are *deleted*
 * rather than blanked — the CLI reads these as clap defaults, and an empty string is a
 * value, so `AGENTMON_PROJECT=""` reaches the CLI as the project named "".
 */
function childEnv(cfg) {
  const env = { ...process.env, AGENTMON_DIR: cfg.dir };
  delete env.AGENTMON_VAULT;
  delete env.AGENTMON_PROJECT;
  delete env.AGENTMON_AGENT;
  return env;
}

function spawnFailure(cfg, err) {
  const why =
    err && err.code === "ENOENT"
      ? `agentmon binary not found at '${cfg.bin}'. Build it with \`cargo build --release -p agentmon-cli\`, or start the server with --bin <path>.`
      : `could not run '${cfg.bin}': ${err?.message ?? err}`;
  return { ok: false, exitCode: -1, json: null, stdout: "", stderr: why, spawnFailed: true };
}

function parseJson(text) {
  const s = String(text ?? "").trim();
  if (!s.startsWith("{") && !s.startsWith("[")) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * The one refusal whose length is the point.
 *
 * A missing or blank human area is refused with the compact style rules inside the
 * message — that error *is* how the contract reaches an agent at write time (SPEC.md,
 * "The human area"). Trimming it to the usual 600 characters would cut the rules off and
 * leave a demand with no way to satisfy it, so this one is not length-capped at all.
 *
 * Not capped rather than capped generously, because any number here is a guess about a
 * file this module cannot see: the rules are cut out of docs/HUMAN_STYLE.md at build time
 * (crates/agentmon-core/build.rs), so the message grows whenever that doc does. A 2500
 * ceiling held until the doc was rewritten and then cut the last line off — which is the
 * line naming `agentmon human-style`, the way to the rest of the contract. The shell-tail
 * cut and the blank-run collapse still apply; only the length ceiling is lifted.
 */
const HUMAN_CONTRACT = "agentmon human-style";
const HUMAN_CAP = Number.POSITIVE_INFINITY;

/** One short line an agent can act on: what failed, which exit code, why. */
export function cliErrorText(result) {
  if (result.spawnFailed) return trimCliMessage(result.stderr);
  const envelope = result.json?.error;
  const kind = envelope?.kind ? ` (${envelope.kind})` : "";
  const meaning = EXIT_MEANING[result.exitCode] ? `, ${EXIT_MEANING[result.exitCode]}` : "";
  const body = envelope?.message ?? result.stderr ?? result.stdout ?? "agentmon failed";
  const cap = String(body).includes(HUMAN_CONTRACT) ? HUMAN_CAP : undefined;
  return `agentmon exit ${result.exitCode}${kind}${meaning}: ${trimCliMessage(body, cap)}`;
}

/** Comma-joined list flag value, from either an array or an already-joined string. */
export function listArg(value) {
  if (value == null) return null;
  const items = Array.isArray(value) ? value : String(value).split(",");
  const cleaned = items.map((v) => String(v).trim()).filter(Boolean);
  return cleaned.length ? cleaned.join(",") : null;
}
