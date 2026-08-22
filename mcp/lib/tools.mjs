// The tool surface and what each tool does.
//
// The schemas below are the whole context cost of this server: they are sent to the
// model on every conversation that has it enabled. Seven tools, one sentence each, no
// property description that repeats what its name already says. The body contract that
// takes a page of the manual to explain is encoded as three required fields — what, why,
// how — so a caller cannot get the markdown shape wrong and no prose has to teach it.
// `note` is one tool, not four: its verbs share every field, and the upsert rule (write
// rewrites an existing name in place) is exactly the one-fact-one-file discipline the
// manual teaches.

import path from "node:path";
import { runCli, cliErrorText, listArg } from "./cli.mjs";
import {
  RESULT_CAP,
  FULL_CAP,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  clamp,
  oneLine,
  renderBugList,
  renderBugView,
  renderNoteList,
  renderNoteView,
  renderSnapshot,
  renderWorkList,
  renderWorkView,
} from "./format.mjs";

const str = { type: "string" };
const strList = { type: "array", items: { type: "string" } };
const dir = { type: "string", description: "Another project folder; overrides the server default." };
const agent = { type: "string", description: "Override the server default." };
const when = { type: "string", description: "UTC ISO8601 of when it really happened." };
/**
 * The human area (SPEC.md). One clause per tool and nothing more: the rules live in
 * `agentmon human-style`, and the refusal for a missing one prints their short form — so
 * the schema carries the requirement and the error carries the contract.
 */
const human = { type: "string", description: "Retold for a non-programmer." };

export const TOOLS = [
  {
    name: "log_work",
    description:
      "Record a piece of work: what, why and how now, plus an outcome to close it in the same call — leave outcome off and it stays in progress under the id returned.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "One specific line." },
        what: { type: "string", description: "What changed; name files, commands, screens." },
        why: { type: "string", description: "The problem, the constraint, the option rejected." },
        how: { type: "string", description: "The approach and the tricky parts." },
        outcome: { type: "string", description: "What shipped and how it was verified; closes the log." },
        human: { ...human, description: "Required; retold for a non-programmer." },
        files: { ...strList, description: "Paths touched; recorded when the log closes." },
        tags: strList,
        refs: { ...strList, description: "Related WORK/BUG ids." },
        started_at: when,
        finished_at: when,
        dir,
        agent,
      },
      required: ["title", "what", "why", "how", "human"],
    },
  },
  {
    name: "update_work",
    description:
      "Append a progress note to a work log, close it with an outcome, or abandon it with a reason; a closed log still takes notes, which is how it gets corrected.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "WORK-NNNN." },
        note: { type: "string", description: "Progress note, or a correction on a closed log." },
        outcome: { type: "string", description: "What shipped and how it was verified; closes the log." },
        abandon: { type: "string", description: "Why the work stopped for good; marks it abandoned." },
        human: { ...human, description: "Retold for a non-programmer; alone, it rewrites that." },
        files: { ...strList, description: "Paths touched." },
        at: when,
        dir,
        agent,
      },
      required: ["id"],
    },
  },
  {
    name: "report_bug",
    description: "File a bug with the repro, the expected result and the actual one.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "One specific line." },
        severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
        report: { type: "string", description: "Repro steps, expected, actual." },
        human: { ...human, description: "Required; retold for a non-programmer." },
        labels: strList,
        refs: { ...strList, description: "Related WORK/BUG ids." },
        created_at: when,
        dir,
        agent,
      },
      required: ["title", "severity", "report", "human"],
    },
  },
  {
    name: "resolve_bug",
    description:
      "Claim a bug, comment on it and resolve it in one call — pass only the parts you want, and claiming happens by default when a resolution is given.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "BUG-NNNN." },
        comment: { type: "string", description: "Root cause or a finding, for the thread." },
        resolution: { type: "string", description: "The fix, why it works, how it was verified." },
        human: { ...human, description: "Retold for a non-programmer; required to resolve." },
        claim: { type: "boolean", description: "Take the bug; refuses if another agent holds it." },
        at: when,
        dir,
        agent,
      },
      required: ["id"],
    },
  },
  {
    name: "note",
    description:
      "Share the agents' memory across sessions — list scans it, read opens one, write adds or rewrites, remove retires; knowledge, not history: rewrite a note whose fact changed, remove one that misleads.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "read", "write", "remove"], description: "Default list." },
        name: { type: "string", description: "Kebab-case identity; derived from title on a first write." },
        title: { type: "string", description: "One specific line." },
        type: {
          type: "string",
          enum: ["essential", "memory", "handoff", "decision", "reference"],
          description: "essential: required session-start reading, the index · memory: durable gotcha · handoff: state for whoever continues · decision: settled choice and why · reference: pointer to a resource.",
        },
        description: { type: "string", description: "One line a scanner reads instead of the body." },
        body: { type: "string", description: "Free-form markdown; write replaces it." },
        human: { ...human, description: "Retold for a non-programmer; required with body." },
        tags: strList,
        refs: { ...strList, description: "Related WORK/BUG ids or note names." },
        query: { type: "string", description: "list: match name, title, description, body." },
        full: { type: "boolean", description: "read: the whole body instead of a summary." },
        at: when,
        dir,
        agent,
      },
    },
  },
  {
    name: "status",
    description:
      "Read the project: a snapshot, the work list, the bug list, or one record — compact summaries unless full is set.",
    // The one hint worth its bytes: a client that knows this tool cannot write can run it
    // without asking the human first.
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["project", "work", "bugs", "view"], description: "Default project." },
        id: { type: "string", description: "Record id, for mode=view." },
        state: { type: "string", description: "in_progress|done|abandoned, or open|in_progress|resolved|closed." },
        severity: { type: "string", description: "Bugs only." },
        agent: { type: "string", description: "Filter: work by author, bugs by assignee." },
        limit: { type: "integer", description: `Rows, default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.` },
        full: { type: "boolean", description: "mode=view: the whole record instead of a summary." },
        dir,
      },
    },
  },
  {
    name: "app_feedback",
    description:
      "File a bug or a wish about the AgentMonitoring app itself — its tools, CLI or boards — not about the project you are working in.",
    inputSchema: {
      type: "object",
      // No dir: feedback about the app is machine-level and belongs to no project.
      properties: {
        // `type` and `title` are required for a new item and meaningless for a rewrite, so
        // the schema cannot require them and the handler asks for them instead. Without
        // this, an agent with only MCP had no way to give a legacy item a human area at
        // all, which SPEC.md ("the MCP tools mirror all of this") says it must.
        id: { type: "string", description: "FB id: rewrite that item's human area instead of filing." },
        type: { type: "string", enum: ["bug", "idea"] },
        title: { type: "string", description: "One specific line." },
        body: { type: "string", description: "Repro for a bug; the situation behind an idea." },
        human: { ...human, description: "Required; retold for a non-programmer." },
        at: when,
        agent,
      },
      required: ["human"],
    },
  },
];

class ToolError extends Error {}

const text = (s) => ({ content: [{ type: "text", text: s }] });
const fail = (s) => ({ content: [{ type: "text", text: s }], isError: true });

function need(args, names, tool) {
  const missing = names.filter((n) => !String(args?.[n] ?? "").trim());
  if (missing.length) throw new ToolError(`${tool} needs ${missing.join(", ")}.`);
}

/**
 * The human area exactly as the client sent it — a string, or nothing.
 *
 * Never `String(args.human)`: an object stringifies to `[object Object]` and a
 * one-element array to its element, both long enough to satisfy every check the CLI
 * makes. A client whose schema slipped would then file a record whose plain-language
 * half is punctuation, and it reaches the app that way. Absent is *not* rejected here —
 * whether this verb requires one is the CLI's rule, and the CLI's refusal is the one
 * that carries the style contract.
 */
function humanText(args, tool) {
  const value = args?.human;
  if (value == null) return "";
  if (typeof value !== "string") {
    const got = Array.isArray(value) ? "an array" : `a ${typeof value}`;
    throw new ToolError(
      `${tool}: human must be a string, and this call sent ${got}. It is the record's ` +
        "plain-language retelling for a reader who was not there and does not program — " +
        "one piece of text. Run `agentmon human-style` for the contract."
    );
  }
  return value.trim();
}

function ident(args, ctx, wantAgent = true) {
  const dirArg = String(args?.dir ?? "").trim();
  const at = dirArg ? { ...ctx, dir: dirArg } : ctx;
  const who = String(args?.agent ?? "").trim() || ctx.agent;
  if (wantAgent && !who) throw new ToolError('no agent: pass agent, or start the server with --agent <handle>.');
  return { at, who };
}

function flag(args, name, value) {
  if (value != null && value !== "") args.push(name, String(value));
}

function recordPath(at, id) {
  const sub = id.toUpperCase().startsWith("WORK") ? "worklogs" : "bugs";
  return path.join(at.dir, sub, `${id.toUpperCase()}.md`);
}

const lines = (...parts) => text(parts.filter(Boolean).join("\n"));

/* ------------------------------------------------------------------ handlers */

async function logWork(args, ctx) {
  const { at, who } = ident(args, ctx);
  need(args, ["title", "what", "why", "how"], "log_work");
  const body = `## What\n\n${args.what.trim()}\n\n## Why\n\n${args.why.trim()}\n\n## How\n\n${args.how.trim()}\n`;
  // One human field for a call that may open *and* close the record: closing replaces the
  // human area, and the same retelling is the honest thing to put back.
  const human = humanText(args, "log_work");

  const startArgs = ["work", "start", "--agent", who, "--title", oneLine(args.title), "--body-file", "-", "--json"];
  flag(startArgs, "--human", human);
  flag(startArgs, "--tags", listArg(args.tags));
  flag(startArgs, "--refs", listArg(args.refs));
  flag(startArgs, "--started-at", args.started_at);
  const started = await runCli(at, startArgs, body);
  if (!started.ok) return fail(cliErrorText(started));

  const id = started.json?.id ?? "the work log";
  const file = started.json?.path ?? "";
  const startedAt = started.json?.record?.started ?? started.json?.event?.ts ?? "";

  if (!String(args.outcome ?? "").trim()) {
    // `work start` has no --files: the CLI attaches files when the log closes. Say so
    // rather than dropping the caller's list without a word.
    const held = listArg(args.files) ? ", with the files" : "";
    return lines(
      `${id} in_progress · ${who}`,
      `started ${startedAt}`,
      file,
      `close it with update_work(id="${id}", outcome=…${held})`
    );
  }

  const doneArgs = ["work", "done", id, "--agent", who, "--outcome-file", "-", "--json"];
  flag(doneArgs, "--human", human);
  flag(doneArgs, "--files", listArg(args.files));
  flag(doneArgs, "--finished-at", args.finished_at);
  const done = await runCli(at, doneArgs, String(args.outcome).trim());
  if (!done.ok) {
    return fail(
      `${id} exists and is in progress — only closing it failed, so do not log the work again; retry with update_work(id="${id}", outcome=…).\n${cliErrorText(done)}`
    );
  }
  const rec = done.json?.record ?? {};
  return lines(
    `${id} done · ${who}`,
    `started ${rec.started ?? startedAt} · finished ${rec.finished ?? ""}`,
    file
  );
}

async function updateWork(args, ctx) {
  const { at, who } = ident(args, ctx);
  need(args, ["id"], "update_work");
  const id = String(args.id).trim().toUpperCase();
  const note = String(args.note ?? "").trim();
  const outcome = String(args.outcome ?? "").trim();
  const abandon = String(args.abandon ?? "").trim();
  // `human` alone is a legal call: it rewrites the record's human area and touches nothing
  // else (SPEC.md's refresh), which is how a record written before it existed gains one.
  const human = humanText(args, "update_work");
  if (!note && !outcome && !abandon && !human)
    throw new ToolError("update_work needs one of note, outcome, abandon or human.");
  if (abandon && (note || outcome)) throw new ToolError("abandon cannot be combined with note or outcome.");

  const done = [];
  let file = "";
  let stamp = "";
  // The header's status. A note alone does not move the record, so take the status the
  // CLI reports back — appending to a closed log must not read as "in_progress" (FB-0001).
  let state = "in_progress";

  if (note || (human && !outcome && !abandon)) {
    // A note with no message is the refresh: `work update --human` alone.
    const a = ["work", "update", id, "--agent", who, "--json"];
    if (note) a.push("--message-file", "-");
    flag(a, "--human", human);
    flag(a, "--at", args.at);
    const r = await runCli(at, a, note || undefined);
    if (!r.ok) return fail(cliErrorText(r));
    done.push(note ? "note added" : "human area rewritten");
    file = r.json?.path ?? file;
    stamp = r.json?.event?.ts ?? stamp;
    state = r.json?.record?.status ?? state;
  }

  if (outcome) {
    const a = ["work", "done", id, "--agent", who, "--outcome-file", "-", "--json"];
    flag(a, "--human", human);
    flag(a, "--files", listArg(args.files));
    flag(a, "--finished-at", args.at);
    const r = await runCli(at, a, outcome);
    if (!r.ok) return fail(stepFailure(done, cliErrorText(r)));
    done.push("closed");
    file = r.json?.path ?? file;
    stamp = r.json?.record?.finished ?? r.json?.event?.ts ?? stamp;
    state = "done";
  }

  if (abandon) {
    const a = ["work", "abandon", id, "--agent", who, "--reason-file", "-", "--json"];
    flag(a, "--human", human);
    flag(a, "--at", args.at);
    const r = await runCli(at, a, abandon);
    if (!r.ok) return fail(cliErrorText(r));
    done.push("abandoned");
    file = r.json?.path ?? file;
    stamp = r.json?.record?.finished ?? r.json?.event?.ts ?? stamp;
    state = "abandoned";
  }

  return lines(`${id} ${state} · ${done.join(", ")} · ${who}`, stamp ? `at ${stamp}` : null, file);
}

async function reportBug(args, ctx) {
  const { at, who } = ident(args, ctx);
  need(args, ["title", "severity", "report"], "report_bug");
  const a = [
    "bug", "create", "--agent", who,
    "--title", oneLine(args.title),
    "--severity", String(args.severity).trim(),
    "--body-file", "-", "--json",
  ];
  flag(a, "--human", humanText(args, "report_bug"));
  flag(a, "--labels", listArg(args.labels));
  flag(a, "--refs", listArg(args.refs));
  flag(a, "--created-at", args.created_at);
  const r = await runCli(at, a, String(args.report).trim());
  if (!r.ok) return fail(cliErrorText(r));
  const rec = r.json?.record ?? {};
  return lines(
    `${r.json?.id} open · ${rec.severity} · reported by ${who}`,
    `created ${rec.created ?? r.json?.event?.ts ?? ""}`,
    r.json?.path ?? ""
  );
}

async function resolveBug(args, ctx) {
  const { at, who } = ident(args, ctx);
  need(args, ["id"], "resolve_bug");
  const id = String(args.id).trim().toUpperCase();
  const comment = String(args.comment ?? "").trim();
  const resolution = String(args.resolution ?? "").trim();
  // Passed to every step that runs, not only the last: each step is a mutation, and a bug
  // filed before the human area existed has to gain one on the first of them.
  const human = humanText(args, "resolve_bug");
  const wantClaim = args.claim === undefined ? Boolean(resolution) : Boolean(args.claim);
  if (!wantClaim && !comment && !resolution && !human)
    throw new ToolError("resolve_bug needs one of claim, comment, resolution or human.");

  const done = [];
  let file = "";
  let stamp = "";
  // The status the CLI reports back, not the one this call assumed: a refresh alone leaves
  // the bug wherever it was, and a header that guessed "in_progress" would be a lie.
  let state = "";

  if (wantClaim) {
    const a = ["bug", "claim", id, "--agent", who, "--json"];
    flag(a, "--human", human);
    flag(a, "--at", args.at);
    const r = await runCli(at, a);
    if (!r.ok) {
      // Claiming is implicit when a resolution is given, so a bug another agent holds
      // would otherwise dead-end here — name the way past it.
      const escape =
        args.claim === undefined && (comment || resolution)
          ? ` Pass claim=false to ${resolution ? "resolve" : "comment"} without taking it.`
          : "";
      return fail(`${cliErrorText(r)}${escape}`);
    }
    done.push("claimed");
    file = r.json?.path ?? file;
  }

  if (comment || (human && !wantClaim && !resolution)) {
    // A comment with no message is the refresh: `bug comment --human` alone.
    const a = ["bug", "comment", id, "--agent", who, "--json"];
    if (comment) a.push("--message-file", "-");
    flag(a, "--human", human);
    flag(a, "--at", args.at);
    const r = await runCli(at, a, comment || undefined);
    if (!r.ok) return fail(stepFailure(done, cliErrorText(r)));
    done.push(comment ? "commented" : "human area rewritten");
    file = r.json?.path ?? file;
    state = r.json?.record?.status ?? state;
  }

  if (resolution) {
    const a = ["bug", "resolve", id, "--agent", who, "--resolution-file", "-", "--json"];
    flag(a, "--human", human);
    flag(a, "--at", args.at);
    const r = await runCli(at, a, resolution);
    if (!r.ok) return fail(stepFailure(done, cliErrorText(r)));
    done.push("resolved");
    file = r.json?.path ?? file;
    stamp = r.json?.record?.resolved ?? r.json?.event?.ts ?? "";
  }

  const shown = resolution ? "resolved" : state || "in_progress";
  return lines(`${id} ${shown} · ${done.join(", ")} · ${who}`, stamp ? `resolved ${stamp}` : null, file);
}

async function status(args, ctx) {
  const { at } = ident(args, ctx, false);
  const mode = String(args.mode ?? "project").trim() || "project";
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(args.limit) || DEFAULT_LIMIT));

  if (mode === "project") {
    const r = await runCli(at, ["status", "--json"]);
    if (!r.ok) return fail(cliErrorText(r));
    return text(renderSnapshot(r.json ?? {}));
  }

  if (mode === "work" || mode === "bugs") {
    const a = mode === "work" ? ["work", "list"] : ["bug", "list"];
    flag(a, "--status", args.state);
    if (mode === "work") flag(a, "--agent", args.agent);
    else {
      flag(a, "--assignee", args.agent);
      flag(a, "--severity", args.severity);
    }
    a.push("--json");
    const r = await runCli(at, a);
    if (!r.ok) return fail(cliErrorText(r));
    const all = Array.isArray(r.json) ? r.json : [];
    const shown = all.slice(0, limit);
    const opts = { total: all.length, limit };
    return text(mode === "work" ? renderWorkList(shown, opts) : renderBugList(shown, opts));
  }

  if (mode === "view") {
    need(args, ["id"], "status(mode=view)");
    const id = String(args.id).trim().toUpperCase();
    const kind = id.startsWith("BUG") ? "bug" : "work";
    if (args.full) {
      const r = await runCli(at, [kind, "view", id]);
      if (!r.ok) return fail(cliErrorText(r));
      return text(clamp(r.stdout, FULL_CAP));
    }
    const r = await runCli(at, [kind, "view", id, "--json"]);
    if (!r.ok) return fail(cliErrorText(r));
    const file = recordPath(at, id);
    return text(kind === "work" ? renderWorkView(r.json ?? {}, file) : renderBugView(r.json ?? {}, file));
  }

  throw new ToolError(`unknown mode '${mode}': use project, work, bugs or view.`);
}

async function note(args, ctx) {
  const action = String(args.action ?? "list").trim() || "list";
  const name = String(args.name ?? "").trim().toLowerCase();

  if (action === "list") {
    const { at } = ident(args, ctx, false);
    const a = ["note", "list", "--json"];
    flag(a, "--type", args.type);
    flag(a, "--search", args.query);
    const r = await runCli(at, a);
    if (!r.ok) return fail(cliErrorText(r));
    const all = Array.isArray(r.json) ? r.json : [];
    return text(renderNoteList(all, { total: all.length }));
  }

  if (action === "read") {
    const { at } = ident(args, ctx, false);
    need(args, ["name"], "note(action=read)");
    if (args.full) {
      const r = await runCli(at, ["note", "view", name]);
      if (!r.ok) return fail(cliErrorText(r));
      return text(clamp(r.stdout, FULL_CAP));
    }
    const r = await runCli(at, ["note", "view", name, "--json"]);
    if (!r.ok) return fail(cliErrorText(r));
    return text(renderNoteView(r.json ?? {}, path.join(at.dir, "notes", `${name}.md`)));
  }

  if (action === "write") {
    const { at, who } = ident(args, ctx);
    // One fact, one file: a write against a name that exists rewrites it in place, so a
    // caller never has to know whether it is creating or correcting.
    const existing = name ? await runCli(at, ["note", "view", name, "--json"]) : null;
    // Only "no such note" (exit 3) may mean create. Any other view failure falling
    // through would demand first-write metadata for a note that exists — and a caller
    // re-sent with a guessed type is how an essential index got demoted once (FB-0001).
    if (existing && !existing.ok && existing.exitCode !== 3) return fail(cliErrorText(existing));

    if (existing?.ok) {
      const a = ["note", "update", name, "--agent", who, "--json"];
      flag(a, "--title", args.title ? oneLine(args.title) : null);
      flag(a, "--type", args.type);
      flag(a, "--description", args.description ? oneLine(args.description) : null);
      // Alone, this is the refresh: it rewrites the human area and nothing else.
      flag(a, "--human", humanText(args, "note(action=write)"));
      flag(a, "--tags", listArg(args.tags));
      flag(a, "--refs", listArg(args.refs));
      flag(a, "--at", args.at);
      const body = String(args.body ?? "").trim();
      if (body) a.push("--body-file", "-");
      const r = await runCli(at, a, body || undefined);
      if (!r.ok) return fail(cliErrorText(r));
      // A type left off is preserved; a type passed is honored — but taking `essential`
      // away unpins required reading from every list, so it never happens silently.
      const was = existing.json?.type;
      const now = r.json?.record?.type ?? was;
      return lines(
        `${r.json?.id} rewritten · ${who}`,
        r.json?.event?.summary ?? "",
        was === "essential" && now !== "essential"
          ? `warning: this note was essential — required session-start reading, listed first — and is now ${now}; if that was not meant, restore with note(action="write", name="${r.json?.id}", type="essential")`
          : null,
        r.json?.path ?? ""
      );
    }

    // `human` is deliberately not in this list. Every other refusal of a missing human
    // area in this server comes back from the CLI, which prints the compact style rules
    // and the way to the full contract; a local `needs human.` here would be the one
    // rejection in the whole surface that teaches nothing. Leave it off and `note add`
    // refuses it — the message an agent needs, not the message we could afford to write.
    need(
      args,
      ["title", "type", "description", "body"],
      name ? `no note named '${name}' here — this is a first write, and it` : "note(action=write)"
    );
    const a = [
      "note", "add", "--agent", who,
      "--title", oneLine(args.title),
      "--type", String(args.type).trim(),
      "--description", oneLine(args.description),
      "--body-file", "-", "--json",
    ];
    flag(a, "--human", humanText(args, "note(action=write)"));
    flag(a, "--name", name || null);
    flag(a, "--tags", listArg(args.tags));
    flag(a, "--refs", listArg(args.refs));
    flag(a, "--at", args.at);
    const r = await runCli(at, a, String(args.body).trim());
    if (!r.ok) return fail(cliErrorText(r));
    const rec = r.json?.record ?? {};
    return lines(
      `${r.json?.id} added · ${rec.type} · ${who}`,
      `rewrite it later with note(action="write", name="${r.json?.id}", …)`,
      r.json?.path ?? ""
    );
  }

  if (action === "remove") {
    const { at, who } = ident(args, ctx);
    need(args, ["name"], "note(action=remove)");
    const r = await runCli(at, ["note", "remove", name, "--agent", who, "--json"]);
    if (!r.ok) return fail(cliErrorText(r));
    return lines(
      `${r.json?.name} removed · ${who}`,
      "the note_removed event keeps the trail on the feed"
    );
  }

  throw new ToolError(`unknown action '${action}': use list, read, write or remove.`);
}

async function appFeedback(args, ctx) {
  const { at, who } = ident(args, ctx);

  // With an id this is `app-feedback update`: the one verb that can give an item filed
  // before the human area existed a good one. The board has no other update and no event
  // feed, so nothing else about the item moves.
  const id = String(args?.id ?? "").trim();
  if (id) {
    const u = ["app-feedback", "update", id, "--agent", who, "--json"];
    flag(u, "--human", humanText(args, "app_feedback"));
    flag(u, "--at", args.at);
    const r = await runCli(at, u);
    if (!r.ok) return fail(cliErrorText(r));
    return lines(`${r.json?.id} retold · ${who}`, "only the human area changed");
  }

  need(args, ["type", "title"], "app_feedback");
  const a = [
    "app-feedback", "add", "--agent", who,
    "--type", String(args.type).trim(),
    "--title", oneLine(args.title),
    "--json",
  ];
  flag(a, "--human", humanText(args, "app_feedback"));
  flag(a, "--body", String(args.body ?? "").trim() || null);
  flag(a, "--at", args.at);
  const r = await runCli(at, a);
  if (!r.ok) return fail(cliErrorText(r));
  return lines(
    `${r.json?.id} filed · ${r.json?.type} · ${who}`,
    "about the app itself — the maintainer works these on the App feedback board"
  );
}

function stepFailure(done, message) {
  const already = done.length ? `${done.join(" and ")} already — do not repeat ${done.length > 1 ? "those steps" : "that step"}. ` : "";
  return `${already}${message}`;
}

const HANDLERS = { log_work: logWork, update_work: updateWork, report_bug: reportBug, resolve_bug: resolveBug, note, status, app_feedback: appFeedback };

export async function callTool(name, args, ctx) {
  const handler = HANDLERS[name];
  if (!handler) return null; // caller turns this into a protocol-level error
  try {
    return await handler(args ?? {}, ctx);
  } catch (err) {
    if (err instanceof ToolError) return fail(err.message);
    return fail(`agentmon-mcp failed: ${err?.message ?? err}`);
  }
}

export { RESULT_CAP };
