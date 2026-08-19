// The tool surface and what each tool does.
//
// The schemas below are the whole context cost of this server: they are sent to the
// model on every conversation that has it enabled. Five tools, one sentence each, no
// property description that repeats what its name already says. The body contract that
// takes a page of the manual to explain is encoded as three required fields — what, why,
// how — so a caller cannot get the markdown shape wrong and no prose has to teach it.

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
  renderSnapshot,
  renderWorkList,
  renderWorkView,
} from "./format.mjs";

const str = { type: "string" };
const strList = { type: "array", items: { type: "string" } };
const project = { type: "string", description: "Override the server default." };
const agent = { type: "string", description: "Override the server default." };
const when = { type: "string", description: "UTC ISO8601 of when it really happened." };

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
        files: { ...strList, description: "Paths touched; recorded when the log closes." },
        tags: strList,
        refs: { ...strList, description: "Related WORK/BUG ids." },
        started_at: when,
        finished_at: when,
        project,
        agent,
      },
      required: ["title", "what", "why", "how"],
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
        files: { ...strList, description: "Paths touched." },
        at: when,
        project,
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
        labels: strList,
        refs: { ...strList, description: "Related WORK/BUG ids." },
        created_at: when,
        project,
        agent,
      },
      required: ["title", "severity", "report"],
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
        claim: { type: "boolean", description: "Take the bug; refuses if another agent holds it." },
        at: when,
        project,
        agent,
      },
      required: ["id"],
    },
  },
  {
    name: "status",
    description:
      "Read the vault: a project snapshot, the work list, the bug list, or one record — compact summaries unless full is set.",
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
        project,
      },
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

function ident(args, ctx, wantAgent = true) {
  const slug = String(args?.project ?? "").trim() || ctx.project;
  const who = String(args?.agent ?? "").trim() || ctx.agent;
  if (!slug) throw new ToolError('no project: pass project, or start the server with --project <slug>.');
  if (wantAgent && !who) throw new ToolError('no agent: pass agent, or start the server with --agent <handle>.');
  return { slug, who };
}

function flag(args, name, value) {
  if (value != null && value !== "") args.push(name, String(value));
}

function recordPath(ctx, slug, id) {
  const dir = id.toUpperCase().startsWith("WORK") ? "worklogs" : "bugs";
  return path.join(ctx.vault, "projects", slug, dir, `${id.toUpperCase()}.md`);
}

const lines = (...parts) => text(parts.filter(Boolean).join("\n"));

/* ------------------------------------------------------------------ handlers */

async function logWork(args, ctx) {
  const { slug, who } = ident(args, ctx);
  need(args, ["title", "what", "why", "how"], "log_work");
  const body = `## What\n\n${args.what.trim()}\n\n## Why\n\n${args.why.trim()}\n\n## How\n\n${args.how.trim()}\n`;

  const startArgs = ["work", "start", "-p", slug, "--agent", who, "--title", oneLine(args.title), "--body-file", "-", "--json"];
  flag(startArgs, "--tags", listArg(args.tags));
  flag(startArgs, "--refs", listArg(args.refs));
  flag(startArgs, "--started-at", args.started_at);
  const started = await runCli(ctx, startArgs, body);
  if (!started.ok) return fail(cliErrorText(started));

  const id = started.json?.id ?? "the work log";
  const file = started.json?.path ?? "";
  const startedAt = started.json?.record?.started ?? started.json?.event?.ts ?? "";

  if (!String(args.outcome ?? "").trim()) {
    // `work start` has no --files: the CLI attaches files when the log closes. Say so
    // rather than dropping the caller's list without a word.
    const held = listArg(args.files) ? ", with the files" : "";
    return lines(
      `${id} in_progress · ${slug} · ${who}`,
      `started ${startedAt}`,
      file,
      `close it with update_work(id="${id}", outcome=…${held})`
    );
  }

  const doneArgs = ["work", "done", id, "-p", slug, "--agent", who, "--outcome-file", "-", "--json"];
  flag(doneArgs, "--files", listArg(args.files));
  flag(doneArgs, "--finished-at", args.finished_at);
  const done = await runCli(ctx, doneArgs, String(args.outcome).trim());
  if (!done.ok) {
    return fail(
      `${id} exists and is in progress — only closing it failed, so do not log the work again; retry with update_work(id="${id}", outcome=…).\n${cliErrorText(done)}`
    );
  }
  const rec = done.json?.record ?? {};
  return lines(
    `${id} done · ${slug} · ${who}`,
    `started ${rec.started ?? startedAt} · finished ${rec.finished ?? ""}`,
    file
  );
}

async function updateWork(args, ctx) {
  const { slug, who } = ident(args, ctx);
  need(args, ["id"], "update_work");
  const id = String(args.id).trim().toUpperCase();
  const note = String(args.note ?? "").trim();
  const outcome = String(args.outcome ?? "").trim();
  const abandon = String(args.abandon ?? "").trim();
  if (!note && !outcome && !abandon) throw new ToolError("update_work needs one of note, outcome or abandon.");
  if (abandon && (note || outcome)) throw new ToolError("abandon cannot be combined with note or outcome.");

  const done = [];
  let file = "";
  let stamp = "";

  if (note) {
    const a = ["work", "update", id, "-p", slug, "--agent", who, "--message-file", "-", "--json"];
    flag(a, "--at", args.at);
    const r = await runCli(ctx, a, note);
    if (!r.ok) return fail(cliErrorText(r));
    done.push("note added");
    file = r.json?.path ?? file;
    stamp = r.json?.event?.ts ?? stamp;
  }

  if (outcome) {
    const a = ["work", "done", id, "-p", slug, "--agent", who, "--outcome-file", "-", "--json"];
    flag(a, "--files", listArg(args.files));
    flag(a, "--finished-at", args.at);
    const r = await runCli(ctx, a, outcome);
    if (!r.ok) return fail(stepFailure(done, cliErrorText(r)));
    done.push("closed");
    file = r.json?.path ?? file;
    stamp = r.json?.record?.finished ?? r.json?.event?.ts ?? stamp;
  }

  if (abandon) {
    const a = ["work", "abandon", id, "-p", slug, "--agent", who, "--reason-file", "-", "--json"];
    flag(a, "--at", args.at);
    const r = await runCli(ctx, a, abandon);
    if (!r.ok) return fail(cliErrorText(r));
    done.push("abandoned");
    file = r.json?.path ?? file;
    stamp = r.json?.record?.finished ?? r.json?.event?.ts ?? stamp;
  }

  const state = abandon ? "abandoned" : outcome ? "done" : "in_progress";
  return lines(`${id} ${state} · ${done.join(", ")} · ${who}`, stamp ? `at ${stamp}` : null, file);
}

async function reportBug(args, ctx) {
  const { slug, who } = ident(args, ctx);
  need(args, ["title", "severity", "report"], "report_bug");
  const a = [
    "bug", "create", "-p", slug, "--agent", who,
    "--title", oneLine(args.title),
    "--severity", String(args.severity).trim(),
    "--body-file", "-", "--json",
  ];
  flag(a, "--labels", listArg(args.labels));
  flag(a, "--refs", listArg(args.refs));
  flag(a, "--created-at", args.created_at);
  const r = await runCli(ctx, a, String(args.report).trim());
  if (!r.ok) return fail(cliErrorText(r));
  const rec = r.json?.record ?? {};
  return lines(
    `${r.json?.id} open · ${rec.severity} · ${slug} · reported by ${who}`,
    `created ${rec.created ?? r.json?.event?.ts ?? ""}`,
    r.json?.path ?? ""
  );
}

async function resolveBug(args, ctx) {
  const { slug, who } = ident(args, ctx);
  need(args, ["id"], "resolve_bug");
  const id = String(args.id).trim().toUpperCase();
  const comment = String(args.comment ?? "").trim();
  const resolution = String(args.resolution ?? "").trim();
  const wantClaim = args.claim === undefined ? Boolean(resolution) : Boolean(args.claim);
  if (!wantClaim && !comment && !resolution)
    throw new ToolError("resolve_bug needs one of claim, comment or resolution.");

  const done = [];
  let file = "";
  let stamp = "";

  if (wantClaim) {
    const a = ["bug", "claim", id, "-p", slug, "--agent", who, "--json"];
    flag(a, "--at", args.at);
    const r = await runCli(ctx, a);
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

  if (comment) {
    const a = ["bug", "comment", id, "-p", slug, "--agent", who, "--message-file", "-", "--json"];
    flag(a, "--at", args.at);
    const r = await runCli(ctx, a, comment);
    if (!r.ok) return fail(stepFailure(done, cliErrorText(r)));
    done.push("commented");
    file = r.json?.path ?? file;
  }

  if (resolution) {
    const a = ["bug", "resolve", id, "-p", slug, "--agent", who, "--resolution-file", "-", "--json"];
    flag(a, "--at", args.at);
    const r = await runCli(ctx, a, resolution);
    if (!r.ok) return fail(stepFailure(done, cliErrorText(r)));
    done.push("resolved");
    file = r.json?.path ?? file;
    stamp = r.json?.record?.resolved ?? r.json?.event?.ts ?? "";
  }

  const state = resolution ? "resolved" : "in_progress";
  return lines(`${id} ${state} · ${done.join(", ")} · ${who}`, stamp ? `resolved ${stamp}` : null, file);
}

async function status(args, ctx) {
  const { slug } = ident(args, ctx, false);
  const mode = String(args.mode ?? "project").trim() || "project";
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(args.limit) || DEFAULT_LIMIT));

  if (mode === "project") {
    const r = await runCli(ctx, ["status", "-p", slug, "--json"]);
    if (!r.ok) return fail(cliErrorText(r));
    return text(renderSnapshot(r.json ?? {}, { project: slug }));
  }

  if (mode === "work" || mode === "bugs") {
    const a = mode === "work" ? ["work", "list", "-p", slug] : ["bug", "list", "-p", slug];
    flag(a, "--status", args.state);
    if (mode === "work") flag(a, "--agent", args.agent);
    else {
      flag(a, "--assignee", args.agent);
      flag(a, "--severity", args.severity);
    }
    a.push("--json");
    const r = await runCli(ctx, a);
    if (!r.ok) return fail(cliErrorText(r));
    const all = Array.isArray(r.json) ? r.json : [];
    const shown = all.slice(0, limit);
    const opts = { project: slug, total: all.length, limit };
    return text(mode === "work" ? renderWorkList(shown, opts) : renderBugList(shown, opts));
  }

  if (mode === "view") {
    need(args, ["id"], "status(mode=view)");
    const id = String(args.id).trim().toUpperCase();
    const kind = id.startsWith("BUG") ? "bug" : "work";
    if (args.full) {
      const r = await runCli(ctx, [kind, "view", id, "-p", slug]);
      if (!r.ok) return fail(cliErrorText(r));
      return text(clamp(r.stdout, FULL_CAP));
    }
    const r = await runCli(ctx, [kind, "view", id, "-p", slug, "--json"]);
    if (!r.ok) return fail(cliErrorText(r));
    const file = recordPath(ctx, slug, id);
    return text(kind === "work" ? renderWorkView(r.json ?? {}, file) : renderBugView(r.json ?? {}, file));
  }

  throw new ToolError(`unknown mode '${mode}': use project, work, bugs or view.`);
}

function stepFailure(done, message) {
  const already = done.length ? `${done.join(" and ")} already — do not repeat ${done.length > 1 ? "those steps" : "that step"}. ` : "";
  return `${already}${message}`;
}

const HANDLERS = { log_work: logWork, update_work: updateWork, report_bug: reportBug, resolve_bug: resolveBug, status };

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
