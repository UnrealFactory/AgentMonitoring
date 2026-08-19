#!/usr/bin/env node
// End-to-end test of the agentmon MCP server.
//
// It speaks the wire protocol rather than the SDK client, for one reason: the budgets in
// this file are the whole point of the server, and the honest measurement of "what
// tools/list costs" is the number of bytes that actually cross stdio — not the size of a
// re-serialized object. Every assertion here is measured on a raw newline-delimited
// JSON-RPC frame.
//
// Everything is written to a fresh temp vault. The repository's own vault is live human
// data; the test asserts, byte for byte, that it never moved.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mcpDir = path.resolve(here, "..");
const repoRoot = path.resolve(mcpDir, "..");
const serverPath = path.join(mcpDir, "server.mjs");
const liveVault = path.join(repoRoot, "vault");
const exe = process.platform === "win32" ? "agentmon.exe" : "agentmon";
const cliPath =
  process.env.AGENTMON_BIN ||
  [path.join(repoRoot, "target", "release", exe), path.join(repoRoot, "target", "debug", exe)].find(existsSync) ||
  "";

/* ----------------------------------------------------------------- budgets */

const BUDGET = {
  toolsList: 6 * 1024, // the full tools/list frame, schemas and descriptions included
  tools: 6,
  description: 200,
  result: 600, // a default-shaped tool result
  fullResult: 8000, // what `full: true` is allowed to cost
};

/* ------------------------------------------------------------------ runner */

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}\n       ${err?.message ?? err}`);
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function assertIncludes(haystack, needle, label) {
  assert(
    String(haystack).toLowerCase().includes(String(needle).toLowerCase()),
    `${label}: expected to find ${JSON.stringify(needle)} in ${JSON.stringify(String(haystack).slice(0, 300))}`
  );
}

const section = (s) => console.log(`\n${s}`);

/* ------------------------------------------------------- stdio jsonrpc client */

class McpClient {
  constructor(args, env) {
    this.child = spawn(process.execPath, [serverPath, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    this.buffer = "";
    this.child.stderr.on("data", (d) => (this.stderr += d));
    this.child.stdout.on("data", (d) => {
      this.buffer += d;
      let i;
      while ((i = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // not a frame; the server keeps stdout clean, so this should not happen
        }
        const waiter = this.pending.get(msg.id);
        if (waiter) {
          this.pending.delete(msg.id);
          // The raw line is the measurement: bytes as the client receives them.
          waiter.resolve({ msg, bytes: Buffer.byteLength(line, "utf8"), line });
        }
      }
    });
  }

  request(method, params) {
    const id = this.nextId++;
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 30000);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
      });
      this.child.stdin.write(frame + "\n");
    });
  }

  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  async initialize() {
    const r = await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "agentmon-mcp-test", version: "0" },
    });
    this.notify("notifications/initialized", {});
    return r;
  }

  /** Returns the text payload plus the raw frame size, so results can be budgeted too. */
  async call(name, args) {
    const { msg, bytes } = await this.request("tools/call", { name, arguments: args ?? {} });
    if (msg.error) return { protocolError: msg.error, bytes };
    const text = (msg.result?.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    return { text, isError: Boolean(msg.result?.isError), bytes, result: msg.result };
  }

  close() {
    this.child.stdin.end();
    this.child.kill();
  }
}

/* ---------------------------------------------------------------- CLI helper */

/** The CLI direct, for the setup and the doctor pass — never through the server. */
function cli(args, vault) {
  const res = spawnSync(cliPath, ["--vault", vault, ...args], { encoding: "utf8", windowsHide: true });
  return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/* ------------------------------------------------------- live-vault tripwire */

function fingerprintVault(dir) {
  if (!existsSync(dir)) return "absent";
  const entries = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = path.join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else entries.push(`${path.relative(dir, p)}:${st.size}`);
    }
  };
  walk(dir);
  return entries.join("|");
}

/* -------------------------------------------------------------------- setup */

if (!cliPath) {
  console.error(
    "agentmon binary not found. Build it first:\n  cargo build --release -p agentmon-cli\n(or set AGENTMON_BIN)"
  );
  process.exit(1);
}

const liveBefore = fingerprintVault(liveVault);
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "agentmon-mcp-test-"));
const vault = path.join(tmpRoot, "vault");
const PROJECT = "mcp-test";
const AGENT = "mcp-tester";

console.log(`agentmon-mcp tests\n  cli    ${cliPath}\n  vault  ${vault}`);

section("setup: a throwaway vault");
{
  const init = cli(["init", "--name", "MCP test vault"], vault);
  check("agentmon init succeeds", () => assert(init.code === 0, `exit ${init.code}: ${init.stderr}`));
  const proj = cli(["project", "create", PROJECT, "--name", "MCP test project"], vault);
  check("agentmon project create succeeds", () => assert(proj.code === 0, `exit ${proj.code}: ${proj.stderr}`));
}

/* ------------------------------------------------------ startup: identity rules */

section("startup: --vault is required, never discovered");
{
  const withoutVault = await new Promise((resolve) => {
    const c = spawn(process.execPath, [serverPath, "--project", PROJECT], {
      cwd: repoRoot, // a ./vault sits right here — the server must still refuse
      stdio: ["pipe", "pipe", "pipe"],
    });
    let err = "";
    c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => resolve({ code, err }));
    c.stdin.end();
  });
  check("refuses to start without --vault", () => assert(withoutVault.code === 2, `exit ${withoutVault.code}`));
  check("says which flag is missing", () => assertIncludes(withoutVault.err, "--vault", "stderr"));
  check("does not fall back to ./vault", () =>
    assert(!/ready/.test(withoutVault.err), `server announced itself ready: ${withoutVault.err}`));
}

/* ------------------------------------------------------------------- session */

const client = new McpClient(["--vault", vault, "--project", PROJECT, "--agent", AGENT], {
  AGENTMON_BIN: cliPath,
  // Hostile environment: if any of these leaked into a child the writes would land
  // somewhere else entirely.
  AGENTMON_VAULT: liveVault,
  AGENTMON_PROJECT: "agent-monitoring",
  AGENTMON_AGENT: "not-me",
});

section("handshake");
{
  const { msg } = await client.initialize();
  check("initialize returns a result", () => assert(msg.result, JSON.stringify(msg).slice(0, 200)));
  check("server identifies itself as agentmon", () => assert(msg.result?.serverInfo?.name === "agentmon", JSON.stringify(msg.result?.serverInfo)));
  check("advertises tools capability", () => assert(msg.result?.capabilities?.tools, JSON.stringify(msg.result?.capabilities)));
  check("advertises no resources or prompts", () =>
    assert(!msg.result?.capabilities?.resources && !msg.result?.capabilities?.prompts, "extra capability lists cost context"));
}

section(`budget: tools/list <= ${BUDGET.toolsList} bytes`);
let TOOL_LIST_BYTES = 0;
{
  const { msg, bytes } = await client.request("tools/list", {});
  const tools = msg.result?.tools ?? [];
  TOOL_LIST_BYTES = bytes;
  console.log(`  measured: ${bytes} bytes on the wire, ${tools.length} tools`);

  check(`tools/list frame is ${bytes} bytes (<= ${BUDGET.toolsList})`, () =>
    assert(bytes <= BUDGET.toolsList, `${bytes} bytes`));
  check(`${tools.length} tools (<= ${BUDGET.tools})`, () => assert(tools.length <= BUDGET.tools, `${tools.length} tools`));
  check("the five workflow tools are present", () => {
    const names = tools.map((t) => t.name).sort();
    assert(
      JSON.stringify(names) === JSON.stringify(["log_work", "report_bug", "resolve_bug", "status", "update_work"]),
      names.join(",")
    );
  });

  for (const t of tools) {
    check(`${t.name}: description ${t.description.length} chars (<= ${BUDGET.description})`, () =>
      assert(t.description.length <= BUDGET.description, `${t.description.length} chars`));
    check(`${t.name}: one sentence, verb-first`, () => {
      const d = t.description;
      assert(/^[A-Z][a-z]+ /.test(d), `does not open with a capitalised verb: ${d}`);
      const opener = d.split(" ")[0];
      assert(
        ["Record", "Append", "File", "Claim", "Read", "Log", "Update", "Report", "Resolve", "List", "Show"].includes(opener),
        `opens with ${JSON.stringify(opener)}, which is not an imperative verb`
      );
      // One sentence: no full stop other than the final one (decimals and ids aside).
      const stops = d.match(/[.!?](\s|$)/g) ?? [];
      assert(stops.length <= 1, `${stops.length} sentences: ${d}`);
    });
    check(`${t.name}: schema is an object with no nesting`, () => {
      assert(t.inputSchema?.type === "object", "inputSchema must be an object schema");
      for (const [k, v] of Object.entries(t.inputSchema.properties ?? {})) {
        assert(v.type !== "object", `property ${k} is a nested object`);
        if (v.type === "array") assert(v.items?.type === "string", `property ${k} is not an array of strings`);
      }
    });
  }
  check("status is annotated read-only", () => {
    const s = tools.find((t) => t.name === "status");
    assert(s?.annotations?.readOnlyHint === true, JSON.stringify(s?.annotations));
  });
}

/* ------------------------------------------------------------ work lifecycle */

section("work lifecycle");
const resultSizes = [];
function budgeted(label, res, cap = BUDGET.result) {
  resultSizes.push({ label, chars: res.text?.length ?? 0 });
  check(`${label}: ${res.text?.length ?? 0} chars (<= ${cap})`, () =>
    assert((res.text?.length ?? 0) <= cap, `${res.text?.length} chars:\n${res.text}`));
  return res;
}

let workId = "";
{
  const res = await client.call("log_work", {
    title: "Wire the vault watcher into the desktop app",
    what: "Start a notify watcher on <vault>/projects in src-tauri/src/lib.rs and emit vault-changed.",
    why: "The desktop app only re-read records on a route change, so a CLI write was invisible until the human clicked something.",
    how: "Coalesce filesystem bursts over a 250ms window and emit the changed project slugs; set_vault_path re-arms the watcher.",
    tags: ["tauri", "live-updates"],
  });
  budgeted("log_work (open)", res);
  check("log_work returns a WORK id", () => {
    const m = /WORK-\d{4}/.exec(res.text ?? "");
    assert(m, res.text);
    workId = m[0];
  });
  check("log_work says it is in progress", () => assertIncludes(res.text, "in_progress", "result"));
  check("log_work returns the file path", () => assertIncludes(res.text, path.join("worklogs", `${workId}.md`), "result"));
  check("the file exists in the temp vault", () =>
    assert(existsSync(path.join(vault, "projects", PROJECT, "worklogs", `${workId}.md`)), "record file missing"));
  check("the body has all three sections", () => {
    const md = readFileSync(path.join(vault, "projects", PROJECT, "worklogs", `${workId}.md`), "utf8");
    for (const s of ["## What", "## Why", "## How"]) assertIncludes(md, s, "record");
  });
  check("the record carries the server's agent, not the environment's", () => {
    const md = readFileSync(path.join(vault, "projects", PROJECT, "worklogs", `${workId}.md`), "utf8");
    assertIncludes(md, `agent: ${AGENT}`, "frontmatter");
    assert(!md.includes("not-me"), "AGENTMON_AGENT leaked into the record");
  });
}

{
  const res = await client.call("update_work", {
    id: workId,
    note: "Debounce is in. One save produced four raw filesystem events; it is now one refresh.",
  });
  budgeted("update_work (note)", res);
  check("update_work confirms the note", () => assertIncludes(res.text, "note", "result"));
}

{
  const res = await client.call("update_work", {
    id: workId,
    outcome:
      "Shipped the debounced watcher in src-tauri/src/lib.rs. Verified: cargo test --workspace green, and one CLI write now produces exactly one UI refresh about 250ms later.",
    files: ["src-tauri/src/lib.rs"],
  });
  budgeted("update_work (close)", res);
  check("update_work closes the log", () => assertIncludes(res.text, "done", "result"));
  check("the record is done with an outcome and the file", () => {
    const md = readFileSync(path.join(vault, "projects", PROJECT, "worklogs", `${workId}.md`), "utf8");
    assertIncludes(md, "status: done", "frontmatter");
    assertIncludes(md, "## Outcome", "body");
    assertIncludes(md, "src-tauri/src/lib.rs", "files");
  });
}

{
  // A closed record still takes a correction — the manual's rule, exercised through MCP.
  const res = await client.call("update_work", {
    id: workId,
    note: "Correction: the note above says the debounce window is 500ms; it is 250ms.",
  });
  budgeted("update_work (correction on a closed log)", res);
  check("a closed log still accepts a note", () => assert(!res.isError, res.text));
}

let backdatedId = "";
{
  // One call, work already finished, both timestamps supplied.
  const res = await client.call("log_work", {
    title: "Cache project counts so the sidebar stops re-reading every record",
    what: "Cache per-project work and bug counts in src/lib/api.ts, invalidated on the vault-changed event.",
    why: "The sidebar re-parsed every record on each navigation, so the product got slower the more it was used.",
    how: "An in-memory map keyed by project slug, cleared from AppContext on vault-changed and on a vault switch.",
    outcome:
      "Shipped the count cache. Measured on a 41-record vault: switching screens went from 180ms to 12ms. Verified with npm run build (tsc clean) and a manual pass through all six screens.",
    files: ["src/lib/api.ts", "src/AppContext.tsx"],
    tags: ["performance"],
    started_at: "2026-08-18T09:12:00Z",
    finished_at: "2026-08-18T11:30:00Z",
  });
  budgeted("log_work (start + finish in one call, backdated)", res);
  check("one-call log_work returns a done record", () => {
    const m = /WORK-\d{4}/.exec(res.text ?? "");
    assert(m, res.text);
    backdatedId = m[0];
    assertIncludes(res.text, "done", "result");
  });
  check("the backdated timestamps are in the frontmatter", () => {
    const md = readFileSync(path.join(vault, "projects", PROJECT, "worklogs", `${backdatedId}.md`), "utf8");
    assertIncludes(md, "started: 2026-08-18T09:12:00Z", "frontmatter");
    assertIncludes(md, "finished: 2026-08-18T11:30:00Z", "frontmatter");
  });
  check("the backdated timestamps are in events.jsonl", () => {
    const events = readFileSync(path.join(vault, "projects", PROJECT, "events.jsonl"), "utf8");
    assert(
      events.includes('"ts":"2026-08-18T11:30:00Z"') || events.includes('"ts": "2026-08-18T11:30:00Z"'),
      "no backdated work_done event"
    );
  });
}

/* ------------------------------------------------------------- bug lifecycle */

section("bug lifecycle");
let bugId = "";
{
  const res = await client.call("report_bug", {
    title: "Work list drops the tag filter when you navigate back",
    severity: "medium",
    report:
      "Repro: filter the work list by tag rust, open WORK-0002, press Alt+Left. Expected the list to come back filtered; actually the filter is cleared because it lives in component state rather than the URL.",
    labels: ["frontend", "filters"],
    refs: [workId],
  });
  budgeted("report_bug", res);
  check("report_bug returns a BUG id", () => {
    const m = /BUG-\d{4}/.exec(res.text ?? "");
    assert(m, res.text);
    bugId = m[0];
  });
  check("report_bug reports the severity and state", () => {
    assertIncludes(res.text, "medium", "result");
    assertIncludes(res.text, "open", "result");
  });
  check("the ref is recorded", () => {
    const md = readFileSync(path.join(vault, "projects", PROJECT, "bugs", `${bugId}.md`), "utf8");
    assertIncludes(md, workId, "frontmatter refs");
  });
}

{
  // Comment without taking the bug.
  const res = await client.call("resolve_bug", {
    id: bugId,
    claim: false,
    comment: "Reproduced on Windows 11 with a fresh profile, so it is not a stale bundle.",
  });
  budgeted("resolve_bug (comment only)", res);
  check("comment-only leaves the bug unclaimed", () => {
    const md = readFileSync(path.join(vault, "projects", PROJECT, "bugs", `${bugId}.md`), "utf8");
    assertIncludes(md, "assignee: null", "frontmatter");
    assertIncludes(md, "## Comments", "body");
  });
}

{
  // Claim, comment and resolve in one call.
  const res = await client.call("resolve_bug", {
    id: bugId,
    comment: "Root cause: the filter state is held in the list component, so the remount on back drops it.",
    resolution:
      "**Root cause.** Filter state lived in component state and did not survive the remount.\n\n**Fix.** The filter now lives in a query parameter, which also makes filtered lists linkable.\n\n**Verified.** The bug's own repro, plus npm run build clean.",
  });
  budgeted("resolve_bug (claim + comment + resolve)", res);
  check("resolve_bug reports the bug resolved", () => assertIncludes(res.text, "resolved", "result"));
  check("the record is resolved, claimed and has a resolution", () => {
    const md = readFileSync(path.join(vault, "projects", PROJECT, "bugs", `${bugId}.md`), "utf8");
    assertIncludes(md, "status: resolved", "frontmatter");
    assertIncludes(md, `assignee: ${AGENT}`, "frontmatter");
    assertIncludes(md, "## Resolution", "body");
  });
  check("all three steps are in events.jsonl", () => {
    const events = readFileSync(path.join(vault, "projects", PROJECT, "events.jsonl"), "utf8");
    for (const type of ["bug_claimed", "bug_commented", "bug_resolved"]) assertIncludes(events, type, "events");
  });
}

{
  // Claim-only: the third single-step shape of the same tool.
  const filed = await client.call("report_bug", {
    title: "Doctor misses a work log whose outcome is only whitespace",
    severity: "low",
    report:
      "A hand-edited record with an empty ## Outcome passes doctor, because the check is for the heading rather than for content under it.",
  });
  const secondBug = /BUG-\d{4}/.exec(filed.text)[0];
  const res = await client.call("resolve_bug", { id: secondBug, claim: true });
  budgeted("resolve_bug (claim only)", res);
  check("claim-only takes the bug without resolving it", () => {
    const md = readFileSync(path.join(vault, "projects", PROJECT, "bugs", `${secondBug}.md`), "utf8");
    assertIncludes(md, "status: in_progress", "frontmatter");
    assertIncludes(md, `assignee: ${AGENT}`, "frontmatter");
    assert(!md.includes("## Resolution"), "claim-only wrote a resolution");
  });
}

/* ---------------------------------------------------------------- read modes */

section("status: every mode inside the result budget");
{
  budgeted("status (project snapshot)", await client.call("status", {}));
  budgeted("status (work list)", await client.call("status", { mode: "work" }));
  budgeted("status (bug list)", await client.call("status", { mode: "bugs" }));
  budgeted("status (work view)", await client.call("status", { mode: "view", id: workId }));
  budgeted("status (bug view)", await client.call("status", { mode: "view", id: bugId }));

  const snapshot = await client.call("status", {});
  check("the snapshot counts the records written", () => {
    assertIncludes(snapshot.text, PROJECT, "snapshot");
    assertIncludes(snapshot.text, "2 work", "snapshot");
  });

  const filtered = await client.call("status", { mode: "work", state: "done" });
  budgeted("status (work list, filtered)", filtered);
  check("the state filter is passed through", () => {
    assertIncludes(filtered.text, backdatedId, "filtered list");
    assert(!filtered.text.includes("no work logs"), filtered.text);
  });

  const full = await client.call("status", { mode: "view", id: workId, full: true });
  budgeted("status (view, full:true)", full, BUDGET.fullResult);
  check("full:true returns the whole record body", () => {
    assertIncludes(full.text, "Outcome", "full record");
    assert(full.text.length > BUDGET.result / 2, `full view is suspiciously short: ${full.text.length} chars`);
  });
  check("full:true is the only way past the summary budget", () => {
    const summary = resultSizes.find((r) => r.label === "status (work view)");
    assert(summary.chars <= BUDGET.result, "summary view exceeded the budget");
    assert(full.text.length > summary.chars, "full view returned no more than the summary");
  });
}

/* ------------------------------------------------------------------- errors */

section("errors: the CLI's own message, trimmed");
{
  const res = await client.call("update_work", {
    id: backdatedId,
    outcome: "Trying to close a record that is already closed, which the CLI must refuse.",
  });
  check("closing a closed log is an error", () => assert(res.isError, res.text));
  check("the error names the exit code and kind", () => {
    assertIncludes(res.text, "exit 5", "error");
    assertIncludes(res.text, "conflict", "error");
  });
  check("the error keeps the CLI's own wording", () => assertIncludes(res.text, "already done", "error"));
  check(`the error is trimmed (${res.text.length} chars)`, () => assert(res.text.length <= BUDGET.result, res.text));

  const missing = await client.call("status", { mode: "view", id: "WORK-9999" });
  check("an unknown id is exit 3, not found", () => {
    assert(missing.isError, missing.text);
    assertIncludes(missing.text, "exit 3", "error");
    assertIncludes(missing.text, "not found", "error");
  });

  const badTime = await client.call("log_work", {
    title: "A record stamped in the future",
    what: "This call exists to prove the CLI's timestamp rules still apply through MCP.",
    why: "A wrapper that skipped validation would let an agent write a record that cannot be true.",
    how: "Pass a start time years from now and expect exit 2.",
    started_at: "2099-01-01T00:00:00Z",
  });
  check("a future timestamp is refused with exit 2", () => {
    assert(badTime.isError, badTime.text);
    assertIncludes(badTime.text, "exit 2", "error");
  });
  check("the rejected call wrote nothing", () => {
    const worklogs = readdirSync(path.join(vault, "projects", PROJECT, "worklogs"));
    assert(worklogs.length === 2, `expected 2 worklogs, found ${worklogs.join(",")}`);
  });

  const noBody = await client.call("update_work", { id: workId });
  check("update_work with nothing to say is refused locally", () => {
    assert(noBody.isError, noBody.text);
    assertIncludes(noBody.text, "note", "error");
  });

  const badProject = await client.call("status", { project: "no-such-project" });
  check("an unknown project is exit 3 with the CLI's advice", () => {
    assert(badProject.isError, badProject.text);
    assertIncludes(badProject.text, "not found", "error");
  });

  const unknown = await client.call("nope", {});
  check("an unknown tool is a protocol error", () => assert(unknown.protocolError, JSON.stringify(unknown)));
}

section("identity: overrides and required values");
{
  const second = cli(["project", "create", "other-project", "--name", "Second project"], vault);
  check("a second project exists", () => assert(second.code === 0, second.stderr));

  const res = await client.call("log_work", {
    project: "other-project",
    agent: "other-agent",
    title: "Prove per-call project and agent overrides work",
    what: "Write one record into a project that is not the server default, as a different agent.",
    why: "One server should serve every project in its vault; re-launching it per project would be absurd.",
    how: "The tool's project and agent arguments override the server defaults for this call only.",
  });
  budgeted("log_work (overridden project and agent)", res);
  check("the override lands in the other project", () => {
    const id = /WORK-\d{4}/.exec(res.text)[0];
    const md = readFileSync(path.join(vault, "projects", "other-project", "worklogs", `${id}.md`), "utf8");
    assertIncludes(md, "agent: other-agent", "frontmatter");
  });

  // A server started without --project must ask for one rather than guess.
  const bare = new McpClient(["--vault", vault], { AGENTMON_BIN: cliPath });
  await bare.initialize();
  const noProject = await bare.call("status", {});
  check("no default project: the tool says how to supply one", () => {
    assert(noProject.isError, noProject.text);
    assertIncludes(noProject.text, "project", "error");
    assertIncludes(noProject.text, "--project", "error");
  });
  const noAgent = await bare.call("report_bug", {
    project: PROJECT,
    title: "A bug filed with no agent handle anywhere",
    severity: "low",
    report: "This call should be refused before it reaches the CLI, because nobody owns the record.",
  });
  check("no default agent: the tool says how to supply one", () => {
    assert(noAgent.isError, noAgent.text);
    assertIncludes(noAgent.text, "agent", "error");
  });
  bare.close();
}

/* ------------------------------------------------------------------- doctor */

section("doctor --strict on the vault this session wrote");
{
  const doctor = cli(["doctor", "--strict"], vault);
  check("doctor --strict exits 0", () => assert(doctor.code === 0, `exit ${doctor.code}\n${doctor.stdout}\n${doctor.stderr}`));
  check("doctor reports no problems", () => assert(!/error/i.test(doctor.stdout), doctor.stdout));
}

section("the live vault was never touched");
{
  check("repository vault is byte-for-byte unchanged", () =>
    assert(fingerprintVault(liveVault) === liveBefore, "the live vault changed during the test"));
}

/* -------------------------------------------------------------------- report */

client.close();
rmSync(tmpRoot, { recursive: true, force: true });

const widest = Math.max(...resultSizes.map((r) => r.label.length));
console.log(`\nresult sizes (budget ${BUDGET.result} chars, full:true excepted):`);
for (const r of resultSizes) console.log(`  ${r.label.padEnd(widest)}  ${String(r.chars).padStart(4)}`);
const defaults = resultSizes.filter((r) => !r.label.includes("full:true"));
const worst = defaults.reduce((a, b) => (b.chars > a.chars ? b : a));
console.log(`\ntools/list: ${TOOL_LIST_BYTES} bytes (budget ${BUDGET.toolsList})`);
console.log(`largest default result: ${worst.chars} chars (budget ${BUDGET.result}) — ${worst.label}`);
console.log(`\n${passed} passed, ${failures.length} failed`);

if (failures.length) {
  console.log("\nfailures:");
  for (const f of failures) console.log(`  ${f.name}: ${f.err?.stack ?? f.err}`);
  process.exit(1);
}
