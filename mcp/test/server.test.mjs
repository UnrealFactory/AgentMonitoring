#!/usr/bin/env node
// End-to-end test of the agentmon MCP server.
//
// It speaks the wire protocol rather than the SDK client, for one reason: the budgets in
// this file are the whole point of the server, and the honest measurement of "what
// tools/list costs" is the number of bytes that actually cross stdio — not the size of a
// re-serialized object. Every assertion here is measured on a raw newline-delimited
// JSON-RPC frame.
//
// Everything is written to throwaway temp project folders. The repository's own
// AgentMonitoring folder is live human data; the test asserts, byte for byte, that it
// never moved.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mcpDir = path.resolve(here, "..");
const repoRoot = path.resolve(mcpDir, "..");
const serverPath = path.join(mcpDir, "server.mjs");
const liveData = path.join(repoRoot, "AgentMonitoring");
const exe = process.platform === "win32" ? "agentmon.exe" : "agentmon";
const cliPath =
  process.env.AGENTMON_BIN ||
  [path.join(repoRoot, "target", "release", exe), path.join(repoRoot, "target", "debug", exe)].find(existsSync) ||
  "";

/* ----------------------------------------------------------------- budgets */

const BUDGET = {
  // The full tools/list frame, schemas and descriptions included. Raised from 7 KB to
  // 7.5 KB when the human area landed (SPEC.md, "The human area"): six write tools each
  // gained a `human` field, and the shortest honest clause for it costs ~460 bytes with
  // the JSON around it — more than the 163 bytes of headroom that were left. The clauses
  // are already the diet version; the contract itself is not here at all, it is in
  // `agentmon human-style` and in the refusal an agent gets for leaving one out.
  toolsList: 7680,
  tools: 7,
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
function cli(args, dir) {
  const res = spawnSync(cliPath, ["--dir", dir, ...args], {
    encoding: "utf8",
    windowsHide: true,
    // A scratch registry: the test must not bookmark its temp projects on the real machine.
    env: { ...process.env, AGENTMON_REGISTRY_DIR: path.join(tmpRoot, ".registry") },
  });
  return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/* -------------------------------------------------------- live-data tripwire */

function fingerprint(dir) {
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

const liveBefore = fingerprint(liveData);
const tmpRoot = mkdtempSync(path.join(os.tmpdir(), "agentmon-mcp-test-"));
const location = path.join(tmpRoot, "mcp-test");
const DATA = path.join(location, "AgentMonitoring");
const AGENT = "mcp-tester";

console.log(`agentmon-mcp tests\n  cli      ${cliPath}\n  project  ${DATA}`);

section("setup: a throwaway project");
{
  const init = cli(["init", "--name", "MCP test project"], location);
  check("agentmon init succeeds", () => assert(init.code === 0, `exit ${init.code}: ${init.stderr}`));
}

/* ------------------------------------------------------ startup: identity rules */

section("startup: --dir is required, never discovered");
{
  const withoutDir = await new Promise((resolve) => {
    const c = spawn(process.execPath, [serverPath, "--agent", AGENT], {
      cwd: repoRoot, // an ./AgentMonitoring sits right here — the server must still refuse
      stdio: ["pipe", "pipe", "pipe"],
    });
    let err = "";
    c.stderr.on("data", (d) => (err += d));
    c.on("close", (code) => resolve({ code, err }));
    c.stdin.end();
  });
  check("refuses to start without --dir", () => assert(withoutDir.code === 2, `exit ${withoutDir.code}`));
  check("says which flag is missing", () => assertIncludes(withoutDir.err, "--dir", "stderr"));
  check("does not fall back to the repo's own project", () =>
    assert(!/ready/.test(withoutDir.err), `server announced itself ready: ${withoutDir.err}`));
}

/* ------------------------------------------------------------------- session */

const client = new McpClient(["--dir", location, "--agent", AGENT], {
  AGENTMON_BIN: cliPath,
  AGENTMON_REGISTRY_DIR: path.join(tmpRoot, ".registry"),
  // Hostile environment: if any of these leaked into a child the writes would land
  // somewhere else entirely.
  AGENTMON_DIR: liveData,
  AGENTMON_VAULT: liveData,
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
  check("the seven workflow tools are present", () => {
    const names = tools.map((t) => t.name).sort();
    assert(
      JSON.stringify(names) ===
        JSON.stringify(["app_feedback", "log_work", "note", "report_bug", "resolve_bug", "status", "update_work"]),
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
        ["Record", "Append", "File", "Claim", "Read", "Log", "Update", "Report", "Resolve", "List", "Show", "Share"].includes(opener),
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
    title: "Wire the change watcher into the desktop app",
    what: "Start a notify watcher on each registered AgentMonitoring folder in src-tauri/src/lib.rs and emit project-changed.",
    why: "The desktop app only re-read records on a route change, so a CLI write was invisible until the human clicked something.",
    how: "Coalesce filesystem bursts over a 250ms window and emit the changed folder; the watchdog re-arms watchers.",
    human: "The window used to show whatever it had read when you opened a screen, so a record written a second ago looked missing until you clicked something. This makes it notice on its own.",
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
  check("the file exists in the temp project", () =>
    assert(existsSync(path.join(DATA, "worklogs", `${workId}.md`)), "record file missing"));
  check("the body has all three sections", () => {
    const md = readFileSync(path.join(DATA, "worklogs", `${workId}.md`), "utf8");
    for (const s of ["## What", "## Why", "## How"]) assertIncludes(md, s, "record");
  });
  check("the record carries the server's agent, not the environment's", () => {
    const md = readFileSync(path.join(DATA, "worklogs", `${workId}.md`), "utf8");
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
    human: "It works: the window notices a new record about a quarter of a second after it is written, and it refreshes once rather than four times.",
    files: ["src-tauri/src/lib.rs"],
  });
  budgeted("update_work (close)", res);
  check("update_work closes the log", () => assertIncludes(res.text, "done", "result"));
  check("the record is done with an outcome and the file", () => {
    const md = readFileSync(path.join(DATA, "worklogs", `${workId}.md`), "utf8");
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
  check("the header reports the record's real status, not in_progress (FB-0001)", () => {
    assertIncludes(res.text, `${workId} done`, "result");
    assert(!res.text.includes("in_progress"), `a note on a done log claimed in_progress: ${res.text}`);
  });
}

let backdatedId = "";
{
  // One call, work already finished, both timestamps supplied.
  const res = await client.call("log_work", {
    title: "Cache project counts so the sidebar stops re-reading every record",
    what: "Cache per-project work and bug counts in src/lib/api.ts, invalidated on the project-changed event.",
    why: "The sidebar re-parsed every record on each navigation, so the product got slower the more it was used.",
    how: "An in-memory map keyed by project id, cleared from AppContext on project-changed.",
    outcome:
      "Shipped the count cache. Measured on a 41-record project: switching screens went from 180ms to 12ms. Verified with npm run build (tsc clean) and a manual pass through all six screens.",
    human: "Moving between screens used to take about a fifth of a second because the app re-read every record each time. It now remembers the counts, and the wait is gone.",
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
    const md = readFileSync(path.join(DATA, "worklogs", `${backdatedId}.md`), "utf8");
    assertIncludes(md, "started: 2026-08-18T09:12:00Z", "frontmatter");
    assertIncludes(md, "finished: 2026-08-18T11:30:00Z", "frontmatter");
  });
  check("the backdated timestamps are in events.jsonl", () => {
    const events = readFileSync(path.join(DATA, "events.jsonl"), "utf8");
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
    human: "If you narrow the list of tasks and then open one and go back, the narrowing is gone and you have to set it again.",
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
    const md = readFileSync(path.join(DATA, "bugs", `${bugId}.md`), "utf8");
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
    const md = readFileSync(path.join(DATA, "bugs", `${bugId}.md`), "utf8");
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
    human: "The narrowing now survives going back, because the page keeps it in the address bar — which also means you can send someone a link to the list you are looking at.",
  });
  budgeted("resolve_bug (claim + comment + resolve)", res);
  check("resolve_bug reports the bug resolved", () => assertIncludes(res.text, "resolved", "result"));
  check("the record is resolved, claimed and has a resolution", () => {
    const md = readFileSync(path.join(DATA, "bugs", `${bugId}.md`), "utf8");
    assertIncludes(md, "status: resolved", "frontmatter");
    assertIncludes(md, `assignee: ${AGENT}`, "frontmatter");
    assertIncludes(md, "## Resolution", "body");
  });
  check("all three steps are in events.jsonl", () => {
    const events = readFileSync(path.join(DATA, "events.jsonl"), "utf8");
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
    human: "The health check says a finished task is fine even when the part that says what it produced is blank.",
  });
  const secondBug = /BUG-\d{4}/.exec(filed.text)[0];
  const res = await client.call("resolve_bug", { id: secondBug, claim: true });
  budgeted("resolve_bug (claim only)", res);
  check("claim-only takes the bug without resolving it", () => {
    const md = readFileSync(path.join(DATA, "bugs", `${secondBug}.md`), "utf8");
    assertIncludes(md, "status: in_progress", "frontmatter");
    assertIncludes(md, `assignee: ${AGENT}`, "frontmatter");
    assert(!md.includes("## Resolution"), "claim-only wrote a resolution");
  });
}

/* -------------------------------------------------------------- note lifecycle */

section("note lifecycle: write, list, read, rewrite, remove");
let noteName = "";
{
  const res = await client.call("note", {
    action: "write",
    type: "memory",
    title: "Gate scripts must sandbox the registry",
    description: "Any script that runs agentmon init must set AGENTMON_REGISTRY_DIR to a scratch dir.",
    body: "agentmon init registers the new project in the user registry, best effort. A gate that inits a temp fixture therefore bookmarks that fixture on the real machine unless AGENTMON_REGISTRY_DIR points at a scratch directory first.",
    human: "A test script that creates a pretend project can leave it sitting in the list of real projects on this machine, unless it is pointed at a scratch folder first.",
    tags: ["gates"],
    refs: [workId],
  });
  budgeted("note (write, new)", res);
  check("write derives the kebab name from the title", () => {
    assertIncludes(res.text, "gate-scripts-must-sandbox-the-registry", "result");
    noteName = "gate-scripts-must-sandbox-the-registry";
  });
  check("the note file exists with its frontmatter", () => {
    const md = readFileSync(path.join(DATA, "notes", `${noteName}.md`), "utf8");
    assertIncludes(md, "type: memory", "frontmatter");
    assertIncludes(md, `agent: ${AGENT}`, "frontmatter");
    assertIncludes(md, workId, "frontmatter refs");
  });

  const list = await client.call("note", { action: "list" });
  budgeted("note (list)", list);
  check("list shows the name, the type and the author's description", () => {
    assertIncludes(list.text, noteName, "list");
    assertIncludes(list.text, "memory", "list");
    assertIncludes(list.text, "AGENTMON_REGISTRY_DIR", "list");
  });

  // The fifth type: essential notes are the required reading, first in every list.
  const ess = await client.call("note", {
    action: "write",
    type: "essential",
    name: "start-here",
    title: "Start here — the index",
    description: "Read this before working; it points at the notes that matter now.",
    body: "The index every session reads first. Current pointers: the registry gotcha note.",
    human: "This is the page every agent is meant to read before it starts: it points at the few notes that matter right now.",
  });
  budgeted("note (write, essential)", ess);
  check("essential is a legal type and lands in the frontmatter", () => {
    assertIncludes(ess.text, "start-here", "result");
    assertIncludes(readFileSync(path.join(DATA, "notes", "start-here.md"), "utf8"), "type: essential", "frontmatter");
  });
  const list2 = await client.call("note", { action: "list" });
  check("the list opens with the essential note and says to read it first", () => {
    assertIncludes(list2.text, "read the 1 essential first", "header");
    assert(
      list2.text.indexOf("start-here") < list2.text.indexOf(noteName),
      `essential did not sort first:\n${list2.text}`
    );
  });
  // FB-0001: a rewrite that leaves the type off must not demote the essential note,
  // and one that takes essential away on purpose must say so back.
  {
    const bodyOnly = await client.call("note", {
      action: "write",
      name: "start-here",
      body: "The index every session reads first. Rewritten with no type passed at all.",
      human: "The same page of required reading, rewritten with the type left alone.",
    });
    budgeted("note (rewrite, type left off)", bodyOnly);
    check("a body-only rewrite keeps the essential type", () => {
      assert(!bodyOnly.isError, bodyOnly.text);
      assert(!bodyOnly.text.toLowerCase().includes("warning"), `no demotion happened, no warning due: ${bodyOnly.text}`);
      assertIncludes(readFileSync(path.join(DATA, "notes", "start-here.md"), "utf8"), "type: essential", "frontmatter");
    });

    const demote = await client.call("note", {
      action: "write",
      name: "start-here",
      type: "memory",
      body: "The same note, this time with the type explicitly handed in as memory.",
      human: "The same page again, this time filed as an ordinary note instead of required reading.",
    });
    budgeted("note (rewrite, essential demoted)", demote);
    check("demoting an essential note warns and names the way back", () => {
      assert(!demote.isError, demote.text);
      assertIncludes(demote.text, "warning", "result");
      assertIncludes(demote.text, "essential", "result");
      assertIncludes(demote.text, 'type="essential"', "the restore call");
      assertIncludes(readFileSync(path.join(DATA, "notes", "start-here.md"), "utf8"), "type: memory", "frontmatter");
    });

    const restore = await client.call("note", { action: "write", name: "start-here", type: "essential" });
    check("the warned restore call puts essential back, without a warning of its own", () => {
      assert(!restore.isError, restore.text);
      assert(!restore.text.toLowerCase().includes("warning"), `restoring is not a demotion: ${restore.text}`);
      assertIncludes(readFileSync(path.join(DATA, "notes", "start-here.md"), "utf8"), "type: essential", "frontmatter");
    });
  }
  {
    const gone = await client.call("note", { action: "remove", name: "start-here" });
    check("the essential note removes like any other", () => assert(!gone.isError, gone.text));
  }

  const read = await client.call("note", { action: "read", name: noteName });
  budgeted("note (read)", read);
  check("read returns the summary shape", () => {
    assertIncludes(read.text, noteName, "read");
    assertIncludes(read.text, path.join("notes", `${noteName}.md`), "read");
  });

  const full = await client.call("note", { action: "read", name: noteName, full: true });
  budgeted("note (read, full:true)", full, BUDGET.fullResult);
  check("full:true returns the whole body", () => assertIncludes(full.text, "bookmarks that fixture", "full"));

  // One fact, one file: the same verb against the same name rewrites in place.
  const rewrite = await client.call("note", {
    action: "write",
    name: noteName,
    body: "Every gate now sets AGENTMON_REGISTRY_DIR; check before adding a new one. The old wording of this note predates check-live doing it too.",
    human: "Every test script now points itself at a scratch folder, so none of them can leave a pretend project on the machine.",
  });
  budgeted("note (write, rewrite)", rewrite);
  check("a write against an existing name rewrites it", () => {
    assertIncludes(rewrite.text, "rewritten", "result");
    const md = readFileSync(path.join(DATA, "notes", `${noteName}.md`), "utf8");
    assertIncludes(md, "check-live doing it too", "body replaced");
    assert(!md.includes("bookmarks that fixture"), "old body survived a rewrite");
    // A mutable, shared record owns up to its last rewriter in the frontmatter.
    assertIncludes(md, `updated_by: ${AGENT}`, "frontmatter");
  });
  check("the trail is on the feed", () => {
    const events = readFileSync(path.join(DATA, "events.jsonl"), "utf8");
    for (const type of ["note_created", "note_updated"]) assertIncludes(events, type, "events");
  });

  // A named write that misses is a first write and says so — not a bare demand for
  // metadata that reads as if rewriting required it (the retry after that demand,
  // type guessed, is how FB-0001's demotion started).
  {
    const miss = await client.call("note", {
      action: "write",
      name: "never-was",
      body: "A body aimed at a name that does not exist in this project.",
      human: "A retelling aimed at a note that is not there.",
    });
    check("a write against a missing name names the miss and the first-write shape", () => {
      assert(miss.isError, miss.text);
      assertIncludes(miss.text, "no note named 'never-was'", "error");
      assertIncludes(miss.text, "first write", "error");
    });

    // A note that exists but cannot be read is that error, not a first write: falling
    // through to create would conflict at best and teach the caller to re-send metadata.
    const brokenPath = path.join(DATA, "notes", "broken-frontmatter.md");
    writeFileSync(brokenPath, "no frontmatter fence at all\n");
    const broken = await client.call("note", {
      action: "write",
      name: "broken-frontmatter",
      body: "A rewrite aimed at a note whose file no longer parses.",
      human: "A retelling aimed at a note whose file is broken.",
    });
    check("a note that fails to load surfaces its own error, not the first-write demand", () => {
      assert(broken.isError, broken.text);
      assert(!broken.text.includes("first write"), `masqueraded as a first write: ${broken.text}`);
      assertIncludes(broken.text, "frontmatter", "error");
    });
    rmSync(brokenPath); // doctor --strict at the foot of this file must not trip on it
  }

  const removed = await client.call("note", { action: "remove", name: noteName });
  budgeted("note (remove)", removed);
  check("remove takes the file and says the trail survives", () => {
    assert(!existsSync(path.join(DATA, "notes", `${noteName}.md`)), "file still on disk");
    assertIncludes(removed.text, "note_removed", "result");
  });
  const gone = await client.call("note", { action: "read", name: noteName });
  check("reading a removed note is the CLI's not-found error", () => {
    assert(gone.isError, gone.text);
    assertIncludes(gone.text, "not found", "error");
  });

  // Leave one note behind so doctor --strict at the foot of this file walks a real one.
  const keep = await client.call("note", {
    action: "write",
    type: "handoff",
    title: "State for whoever runs this test next",
    description: "The MCP note lifecycle wrote, rewrote and removed one note; this one stays for doctor.",
    body: "This note exists so the doctor --strict pass at the end of the test walks a notes folder with a real record in it.",
    human: "A note left behind on purpose, so the end-of-test health check has a real one to look at.",
  });
  check("a second note stays behind for doctor", () => assert(!keep.isError, keep.text));
}

/* ------------------------------------------------------------- app feedback */

section("app feedback: about the app itself, machine-level");
{
  const bug = await client.call("app_feedback", {
    type: "bug",
    title: "status counts an abandoned log as in progress",
    body: "Repro: abandon a log, call status — the in-progress count still includes it.",
    human: "If a task is stopped rather than finished, the summary still counts it as being worked on, so the number reads high.",
  });
  budgeted("app_feedback (bug)", bug);
  check("files FB-0001 and says whose board it lands on", () => {
    assert(!bug.isError, bug.text);
    assertIncludes(bug.text, "FB-0001", "result");
    assertIncludes(bug.text, "board", "result");
  });

  const idea = await client.call("app_feedback", {
    type: "idea",
    title: "note list should filter by tag",
    human: "There is no way to narrow the notes list to one subject, so finding one means reading all of them.",
  });
  budgeted("app_feedback (idea, title only)", idea);
  check("a title alone is a legal wish", () => {
    assert(!idea.isError, idea.text);
    assertIncludes(idea.text, "FB-0002", "result");
  });

  check("items land beside the scratch registry, in no project", () => {
    const dir = path.join(tmpRoot, ".registry", "feedback");
    assert(existsSync(path.join(dir, "FB-0001.md")), "FB-0001.md missing from the machine-level folder");
    assert(existsSync(path.join(dir, "FB-0002.md")), "FB-0002.md missing from the machine-level folder");
    assert(!existsSync(path.join(DATA, "feedback")), "a feedback folder appeared inside the project");
  });

  const bad = await client.call("app_feedback", { type: "feature", title: "x" });
  check("an unknown type is the CLI's own refusal", () => {
    assert(bad.isError, bad.text);
    assertIncludes(bad.text, "bug, idea", "error");
  });
}

/* ------------------------------------------------------------- the human area */

section("the human area: required through MCP, refreshable, and the rules travel");
{
  // Every write tool declares the field, and the three that always need one require it.
  const { msg } = await client.request("tools/list", {});
  const tools = msg.result?.tools ?? [];
  const schema = (name) => tools.find((t) => t.name === name)?.inputSchema ?? {};
  check("every write tool has a human field", () => {
    for (const name of ["log_work", "update_work", "report_bug", "resolve_bug", "note", "app_feedback"]) {
      assert(schema(name).properties?.human, `${name} has no human field`);
    }
    assert(!schema("status").properties?.human, "status is a read tool");
  });
  check("the three that always need one require it in the schema", () => {
    for (const name of ["log_work", "report_bug", "app_feedback"]) {
      assert((schema(name).required ?? []).includes("human"), `${name} does not require human`);
    }
  });

  // The refusal an agent gets, and what it teaches.
  const noHuman = await client.call("log_work", {
    title: "A record with no retelling",
    what: "Write a record through MCP without a human area.",
    why: "The enforcement lives in the CLI, and the MCP wrapper must not route around it.",
    how: "Omit the human field and expect the CLI's own refusal to come back.",
    human: "   ",
  });
  check("a blank human area is refused with the CLI's exit 2", () => {
    assert(noHuman.isError, noHuman.text);
    assertIncludes(noHuman.text, "exit 2", "error");
  });
  check("…and the refusal carries the compact rules and the way to the full contract", () => {
    assertIncludes(noHuman.text, "human area", "error");
    assertIncludes(noHuman.text, "--human", "error");
    assertIncludes(noHuman.text, "agentmon human-style", "error");
    // the rules themselves, not just the demand: the first line of the block the CLI prints
    const style = cli(["human-style"], location).stdout;
    const openMarker = style.indexOf("<!-- compact-rules -->");
    const firstRule = style
      .slice(openMarker)
      .split("\n")
      .slice(1)
      .find((l) => l.trim());
    assertIncludes(noHuman.text, firstRule.trim().slice(0, 60), "error");
    // …and the *last* rule too, with nothing cut in between. This message is the only one
    // the wrapper does not shorten, because a length ceiling here is a guess about how long
    // docs/HUMAN_STYLE.md is: a 2500-character one held until that doc was rewritten and
    // then took the contract line off the end of every refusal.
    const lastRule = style
      .slice(openMarker, style.indexOf("<!-- /compact-rules -->"))
      .split("\n")
      .filter((l) => l.trim())
      .pop();
    assertIncludes(noHuman.text, lastRule.trim().slice(0, 60), "error");
    assert(!noHuman.text.includes("(trimmed"), `the refusal was shortened:\n${noHuman.text}`);
  });
  check("the rejected call wrote nothing", () => {
    const worklogs = readdirSync(path.join(DATA, "worklogs"));
    assert(worklogs.length === 2, `expected 2 worklogs, found ${worklogs.join(",")}`);
  });

  // A client whose schema slipped sends an object or a one-element array. Both used to
  // stringify into something long enough to pass every check the CLI makes — `[object
  // Object]` reached the app as a record's whole human area — so the type is checked where
  // the value arrives rather than laundered through String().
  for (const [label, value] of [
    ["an object", { text: "not a string" }],
    ["an array", ["A retelling that arrived wrapped in a list, which is not a string."]],
    ["a number", 42],
  ]) {
    const wrongType = await client.call("log_work", {
      title: `A record whose human area is ${label}`,
      what: "Send the human field as something that is not text.",
      why: "A stringified object is not a retelling, and it reaches the app looking like one.",
      how: "Pass a non-string and expect the tool to refuse before the CLI is spawned.",
      human: value,
    });
    check(`human as ${label} is refused, not stringified`, () => {
      assert(wrongType.isError, wrongType.text);
      assertIncludes(wrongType.text, "must be a string", "error");
      assert(!wrongType.text.includes("[object Object]"), wrongType.text);
    });
  }

  // A body that leaves a code fence open would swallow the `## For humans` section
  // appended after it: the record would save with no human area and could never gain one.
  const openFence = await client.call("log_work", {
    title: "A record whose how ends inside a code block",
    what: "Paste a stack trace into how and forget the closing fence.",
    why: "Agents paste logs; the missing backtick is a one-character typo with no undo.",
    how: "It printed:\n\n```\nthread main panicked\n",
    human: "A perfectly good retelling, attached to a body that would have eaten it.",
  });
  check("a body that leaves a code fence open is refused", () => {
    assert(openFence.isError, openFence.text);
    assertIncludes(openFence.text, "exit 2", "error");
    assertIncludes(openFence.text, "code fence", "error");
  });

  // The reserved heading, indented. Two leading spaces used to walk it past the guard:
  // the check read the text as sent, the writer trimmed the section body and put the
  // heading back at column 0, and the record landed with two human areas and an empty
  // `## What`. Indentation is not a way in through any field.
  for (const [label, indent] of [["two spaces", "  "], ["four spaces", "    "], ["a tab", "\t"]]) {
    const smuggled = await client.call("log_work", {
      title: `A record that indents the reserved heading by ${label}`,
      what: `Put an indented \`## For humans\` in the body, indented by ${label}.`,
      why: "agentmon owns where the human area goes; an agent-supplied one is a second copy.",
      how: `${indent}## For humans\n\n${indent}Not the record's human area at all.`,
      human: "A real retelling next to a body that tried to write the section itself.",
    });
    check(`the reserved heading indented by ${label} is refused`, () => {
      assert(smuggled.isError, smuggled.text);
      assertIncludes(smuggled.text, "exit 2", "error");
      assertIncludes(smuggled.text, "reserved", "error");
    });
  }
  check("…and none of them wrote a record", () => {
    const titles = readdirSync(path.join(DATA, "worklogs"))
      .map((f) => readFileSync(path.join(DATA, "worklogs", f), "utf8"))
      .join("\n");
    assert(!titles.includes("indents the reserved heading"), "a refused record was written");
  });

  // …and the reserved heading spelled the way the *renderer* reads one. The guard used to
  // close the hash run on `' '` alone while the app's parser closes it on `\s`, so
  // `##<TAB>For humans` in a body was written at exit 0 and the Agent view then drew a
  // level-2 heading reading "For humans" over prose saying it was not the human area. A
  // byte-order mark split the two transports instead: browser mode served the section,
  // desktop mode did not. The full list is
  // crates/agentmon-core/tests/reserved-heading-shapes.json; these are the three that got
  // through, driven over the real protocol.
  for (const [label, line] of [
    ["a tab after the hashes", "##\tFor humans"],
    ["a no-break space after the hashes", "##\u00a0For humans"],
    ["a no-break space inside the title", "## For\u00a0humans"],
    ["a byte-order mark before the hashes", "\ufeff## For humans"],
    ["a closing hash run", "## For humans ##"],
    // Then the spellings that paint nothing at all, which `\s` does not match either, so
    // the title compared different and the app drew the same eight glyphs.
    ["a zero-width space after the title", "## For humans\u200b"],
    ["a soft hyphen inside a word", "## For hu\u00admans"],
    ["a Cyrillic o inside the title", "## F\u043er humans"],
  ]) {
    const spelled = await client.call("log_work", {
      title: `A record that writes the reserved heading with ${label}`,
      what: `Spell \`## For humans\` with ${label} and hope the guard reads bytes.`,
      why: "Whatever the app draws as the reserved heading is the reserved heading.",
      how: `${line}\n\nNot the record's human area at all.`,
      human: "A real retelling next to a body that tried to write the section itself.",
    });
    check(`the reserved heading with ${label} is refused`, () => {
      assert(spelled.isError, spelled.text);
      assertIncludes(spelled.text, "exit 2", "error");
      assertIncludes(spelled.text, "reserved", "error");
    });
  }

  // The first write of a note is the one human-area refusal this server used to answer
  // itself, with a bare "needs human." — no rules, no contract. It defers to the CLI now.
  const noteNoHuman = await client.call("note", {
    action: "write",
    name: "a-note-with-no-retelling",
    title: "A note with no retelling",
    type: "memory",
    description: "A first write that leaves the human area off.",
    body: "The body is fine; the retelling is missing, which is the point of this case.",
  });
  check("a first note write with no human area gets the CLI's teaching refusal", () => {
    assert(noteNoHuman.isError, noteNoHuman.text);
    assertIncludes(noteNoHuman.text, "exit 2", "error");
    assertIncludes(noteNoHuman.text, "--human", "error");
    assertIncludes(noteNoHuman.text, "agentmon human-style", "error");
    const rules = cli(["human-style"], location).stdout;
    const firstRule = rules
      .slice(rules.indexOf("<!-- compact-rules -->"))
      .split("\n")
      .slice(1)
      .find((l) => l.trim());
    assertIncludes(noteNoHuman.text, firstRule.trim().slice(0, 60), "error");
    assert(
      !existsSync(path.join(DATA, "notes", "a-note-with-no-retelling.md")),
      "the refused note must not exist"
    );
  });

  check("none of the refused calls wrote a record", () => {
    const worklogs = readdirSync(path.join(DATA, "worklogs"));
    assert(worklogs.length === 2, `expected 2 worklogs, found ${worklogs.join(",")}`);
  });

  // The record written at the top of this run carries its section, last, and once.
  check("the human area is stored as the record's last section", () => {
    const md = readFileSync(path.join(DATA, "worklogs", `${workId}.md`), "utf8");
    assert(md.includes("## For humans"), md);
    assert(md.indexOf("## Outcome") < md.indexOf("## For humans"), `not last:\n${md}`);
    assert(md.match(/## For humans/g).length === 1, "closing replaced it rather than adding one");
    assertIncludes(md, "a quarter of a second", "the closing retelling replaced the opening one");
  });

  // A refresh: human alone, no note, one human_updated line.
  const before = readFileSync(path.join(DATA, "events.jsonl"), "utf8").split("\n").filter(Boolean).length;
  const refresh = await client.call("update_work", {
    id: workId,
    human: "Rewritten afterwards: the window now notices new records by itself.",
  });
  budgeted("update_work (human alone — a refresh)", refresh);
  check("human alone rewrites only the human area", () => {
    assert(!refresh.isError, refresh.text);
    const md = readFileSync(path.join(DATA, "worklogs", `${workId}.md`), "utf8");
    assertIncludes(md, "Rewritten afterwards", "record");
    assert(!md.includes("a quarter of a second"), "the old retelling should be gone");
    assert(md.match(/### \d{4}-/g).length === 2, "no progress note was invented");
  });
  check("…and logs exactly one human_updated event", () => {
    const lines = readFileSync(path.join(DATA, "events.jsonl"), "utf8").split("\n").filter(Boolean);
    assert(lines.length === before + 1, `${lines.length - before} events for one refresh`);
    assertIncludes(lines[lines.length - 1], "human_updated", "events");
  });

  // The same shape for a note and for a bug.
  const noteRefresh = await client.call("note", {
    action: "write",
    name: "state-for-whoever-runs-this-test-next",
    human: "Rewritten: what this leftover note is for, in plainer words.",
  });
  check("a note refresh needs no body or metadata", () => {
    assert(!noteRefresh.isError, noteRefresh.text);
    const md = readFileSync(path.join(DATA, "notes", "state-for-whoever-runs-this-test-next.md"), "utf8");
    assertIncludes(md, "Rewritten: what this leftover note is for", "note");
    assertIncludes(md, "so the doctor --strict pass", "the body is untouched");
  });
  const bugRefresh = await client.call("resolve_bug", {
    id: bugId,
    human: "Rewritten: filtering the list now survives going back.",
  });
  check("a bug refresh adds no comment", () => {
    assert(!bugRefresh.isError, bugRefresh.text);
    const md = readFileSync(path.join(DATA, "bugs", `${bugId}.md`), "utf8");
    assertIncludes(md, "Rewritten: filtering the list", "bug");
    assert(md.match(/## For humans/g).length === 1, md);
    assertIncludes(bugRefresh.text, "resolved", "the header reports the real status");
  });

  // app_feedback: required, and the CLI's refusal comes back through the tool.
  const noFeedbackHuman = await client.call("app_feedback", {
    type: "idea",
    title: "an idea with no retelling",
    human: "",
  });
  check("app_feedback without a human area is refused", () => {
    assert(noFeedbackHuman.isError, noFeedbackHuman.text);
    assertIncludes(noFeedbackHuman.text, "human", "error");
  });
  check("the feedback that was filed carries its human area", () => {
    const md = readFileSync(path.join(tmpRoot, ".registry", "feedback", "FB-0001.md"), "utf8");
    assertIncludes(md, "## For humans", "feedback file");
    assertIncludes(md, "counts it as being worked on", "feedback file");
  });

  // An item filed before the human area existed is repaired with `app-feedback update`,
  // and SPEC.md says the MCP tools mirror all of this — but the tool could only file, so
  // an agent with MCP and no shell had no way to give one a retelling. Passing an id is
  // that verb.
  writeFileSync(
    path.join(tmpRoot, ".registry", "feedback", "FB-0009.md"),
    "---\nid: FB-0009\ntitle: An item filed before the human area\ntype: idea\n" +
      "agent: old-builder\nstatus: open\ncreated: 2026-08-01T09:00:00Z\ndone: null\n" +
      "---\n\nThe wish itself, as an agent wrote it.\n"
  );
  const retell = await client.call("app_feedback", {
    id: "FB-0009",
    human: "Someone asked for this before the app kept a plain-language half, so it had none until now.",
    at: "2026-08-21T09:00:00Z",
  });
  budgeted("app_feedback (retell a legacy item)", retell);
  check("app_feedback with an id rewrites the human area of a legacy item", () => {
    assert(!retell.isError, retell.text);
    const md = readFileSync(path.join(tmpRoot, ".registry", "feedback", "FB-0009.md"), "utf8");
    assertIncludes(md, "## For humans", "feedback file");
    assertIncludes(md, "plain-language half", "feedback file");
    assertIncludes(md, "The wish itself", "the agent prose is untouched");
    // `--at` is kept now: the board has no events.jsonl, so the frontmatter carries it.
    assertIncludes(md, "updated: 2026-08-21T09:00:00Z", "feedback file");
  });
  const retellBlank = await client.call("app_feedback", { id: "FB-0009", human: "  " });
  check("…and a blank one is still the CLI's teaching refusal", () => {
    assert(retellBlank.isError, retellBlank.text);
    assertIncludes(retellBlank.text, "exit 2", "error");
    assertIncludes(retellBlank.text, "agentmon human-style", "error");
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
    assertIncludes(snapshot.text, "MCP test project", "snapshot");
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
    human: "An attempt to finish something that is already finished.",
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
    human: "A record stamped with a date that has not happened yet, which the tool should refuse.",
    started_at: "2099-01-01T00:00:00Z",
  });
  check("a future timestamp is refused with exit 2", () => {
    assert(badTime.isError, badTime.text);
    assertIncludes(badTime.text, "exit 2", "error");
  });
  check("the rejected call wrote nothing", () => {
    const worklogs = readdirSync(path.join(DATA, "worklogs"));
    assert(worklogs.length === 2, `expected 2 worklogs, found ${worklogs.join(",")}`);
  });

  const noBody = await client.call("update_work", { id: workId });
  check("update_work with nothing to say is refused locally", () => {
    assert(noBody.isError, noBody.text);
    assertIncludes(noBody.text, "note", "error");
    assertIncludes(noBody.text, "human", "error");
  });

  const badDir = await client.call("status", { dir: path.join(tmpRoot, "no-such-project") });
  check("an unknown project folder is exit 3 with the CLI's advice", () => {
    assert(badDir.isError, badDir.text);
    assertIncludes(badDir.text, "no project found", "error");
  });

  const unknown = await client.call("nope", {});
  check("an unknown tool is a protocol error", () => assert(unknown.protocolError, JSON.stringify(unknown)));
}

section("identity: overrides and required values");
{
  const otherLocation = path.join(tmpRoot, "other-project");
  const second = cli(["init", "--name", "Second project"], otherLocation);
  check("a second project exists", () => assert(second.code === 0, second.stderr));

  const res = await client.call("log_work", {
    dir: otherLocation,
    agent: "other-agent",
    title: "Prove per-call dir and agent overrides work",
    what: "Write one record into a project folder that is not the server default, as a different agent.",
    why: "One server should be able to reach a sibling project; re-launching it per folder would be absurd.",
    how: "The tool's dir and agent arguments override the server defaults for this call only.",
    human: "A record written into a second project, to show one helper can serve more than one folder.",
  });
  budgeted("log_work (overridden dir and agent)", res);
  check("the override lands in the other project", () => {
    const id = /WORK-\d{4}/.exec(res.text)[0];
    const md = readFileSync(path.join(otherLocation, "AgentMonitoring", "worklogs", `${id}.md`), "utf8");
    assertIncludes(md, "agent: other-agent", "frontmatter");
  });

  // A server started without --agent must ask for one rather than guess.
  const bare = new McpClient(["--dir", location], {
    AGENTMON_BIN: cliPath,
    AGENTMON_REGISTRY_DIR: path.join(tmpRoot, ".registry"),
  });
  await bare.initialize();
  const noAgent = await bare.call("report_bug", {
    title: "A bug filed with no agent handle anywhere",
    severity: "low",
    report: "This call should be refused before it reaches the CLI, because nobody owns the record.",
    human: "A report that nobody has put their name to.",
  });
  check("no default agent: the tool says how to supply one", () => {
    assert(noAgent.isError, noAgent.text);
    assertIncludes(noAgent.text, "agent", "error");
  });
  const readOnly = await bare.call("status", {});
  check("reads need no agent", () => assert(!readOnly.isError, readOnly.text));
  bare.close();
}

/* ------------------------------------------------------------------- doctor */

section("doctor --strict on the project this session wrote");
{
  const doctor = cli(["doctor", "--strict"], location);
  check("doctor --strict exits 0", () => assert(doctor.code === 0, `exit ${doctor.code}\n${doctor.stdout}\n${doctor.stderr}`));
  check("doctor reports no problems", () => assert(!/error/i.test(doctor.stdout), doctor.stdout));
}

section("the live data was never touched");
{
  check("repository AgentMonitoring folder is byte-for-byte unchanged", () =>
    assert(fingerprint(liveData) === liveBefore, "the live data changed during the test"));
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
