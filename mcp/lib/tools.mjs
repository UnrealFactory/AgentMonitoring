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
//
// The human area every record carries (SPEC.md) is here as six `human` fields, the three
// `required: [...]` entries for the tools that always need one, one enum value, and one
// five-word clause on app_feedback's `id` — which names a route, not a rule, because the
// call it belongs to succeeds without it and no result is ever in a position to mention
// it. No rule about the human area is taught here. Anything an agent needs to be *told*
// about it is told by a result, which is paid once, rather than by a description, which is
// paid on every turn: see `handOver` below.

import path from "node:path";
import { runCli, cliErrorText, listArg, contractDelivered, markContractDelivered } from "./cli.mjs";
import {
  RESULT_CAP,
  DEFAULT_LIMIT,
  MAX_LIMIT,
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
 * The human area (SPEC.md), on six write tools — and carrying no prose at all.
 *
 * The schemas are re-sent every turn; a result is sent once. So nothing about the human
 * area that a *result* can carry is bought here. `required: [...]` says which calls demand
 * one. Who the retelling is for is the opening line of the block `handOver` below sends —
 * said once, on the session's first result, rather than six times in a tool list on every
 * turn of the conversation. That a supplied retelling *replaces* the stored one is said by
 * the result of the call that replaces it. And the rules themselves — the part that decides
 * whether the retelling is any good — are that same block, handed over whole.
 *
 * The description that used to sit here read "Retold for a non-programmer." An A/B run by
 * this initiative's critic put the same task through this schema with those bytes present
 * and with them emptied: one attempt either way, and the same four contract rules missed.
 * Read that for what it is — an audience clause measured against nothing, not a pointer
 * measured against nothing: neither arm could reach the contract, because that run's
 * schema listed `status`'s modes without `human_style`. What it settles is narrow and
 * enough: naming the audience here changed no record, and a field description that changes
 * nothing is one six tools pay for on every turn. So it is gone.
 */
const human = { type: "string" };

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
        human,
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
        human,
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
        human,
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
        human,
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
        human,
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
        // `human_style` is the fifth mode and the cheapest possible home for it: fourteen
        // bytes of enum on a tool every caller already has, instead of an eighth tool. It
        // buys the *whole* contract — the worked example the compact rules cannot carry —
        // for a caller with no shell to run `agentmon human-style` in. Fourteen bytes and
        // no sentence anywhere advertising them: what points here is the last line of the
        // rules the session's first result hands over, and the last line of every refusal,
        // both of which the agent has already read by the time it wants more.
        mode: { type: "string", enum: ["project", "work", "bugs", "view", "human_style"], description: "Default project." },
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
        // `required: [...]` cannot carry them and holds `human` alone. What it costs is one
        // round trip on a filing that forgets a title, and the handler's refusal names both
        // shapes of the call — cheaper than a clause every turn pays for.
        //
        // `id` keeps a description because deleting it deletes a route: without it, the
        // only way an agent with MCP and no shell can give a legacy item its human area
        // ("the MCP tools mirror all of this", SPEC.md) is undiscoverable from the tool
        // list, and an `id` sent while filing goes to `app-feedback update` and fails.
        id: { type: "string", description: "Rewrites that item's human area." },
        type: { type: "string", enum: ["bug", "idea"] },
        title: { type: "string", description: "One specific line." },
        body: { type: "string", description: "Repro for a bug; the situation behind an idea." },
        human,
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

/**
 * A field carrying the call's own envelope is a client-side parse slip, not prose.
 *
 * Seen once on disk (FB-0002): a bug's comment ended in a literal `</comment>`, followed
 * by `<parameter name="resolution">` and the whole resolution again — the client mangled
 * the boundary between two parameters and the text of both landed in one, saved verbatim,
 * duplicated in the record forever. No handler can repair that (splitting on tags it
 * guesses at would be inventing the caller's words), so the call is refused whole and the
 * caller re-sends with each field holding only its own text. Two signatures: a
 * `<parameter …>` / `</parameter>` tag anywhere (namespaced or not), and a field whose
 * value contains its own closing tag, `comment` holding `</comment>`.
 */
const PARAMETER_TAG = /<\/?(?:\w+:)?parameter\b/i;

function leakedMarkupField(args) {
  for (const [key, value] of Object.entries(args ?? {})) {
    const items = Array.isArray(value) ? value : [value];
    for (const v of items) {
      if (typeof v !== "string") continue;
      if (PARAMETER_TAG.test(v) || v.includes(`</${key}>`)) return key;
    }
  }
  return null;
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

/**
 * A replacement-list flag, for the one verb where lists replace rather than attach
 * (`note update`). Absent leaves the stored list alone; anything sent — an explicit
 * empty array included — replaces it, `""` being how the CLI spells "clear". Through
 * `flag()` an empty array collapsed to no flag at all, so a caller pruning a dead ref
 * had no way to say so short of removing and re-adding the note.
 */
function replaceListFlag(args, name, value) {
  if (value == null) return;
  args.push(name, listArg(value) ?? "");
}

function recordPath(at, id) {
  const sub = id.toUpperCase().startsWith("WORK") ? "worklogs" : "bugs";
  return path.join(at.dir, sub, `${id.toUpperCase()}.md`);
}

const lines = (...parts) => text(parts.filter(Boolean).join("\n"));

/* ------------------------------------------------- handing over the contract */

const RULES_OPEN = "<!-- compact-rules -->";
const RULES_CLOSE = "<!-- /compact-rules -->";

/**
 * The compact style rules, cut out of the contract the binary itself carries.
 *
 * Not a copy kept here. `agentmon human-style` prints docs/HUMAN_STYLE.md, and the rules
 * are the block between its two markers — the same bytes crates/agentmon-core/build.rs
 * extracts for every CLI refusal, so this server and the CLI can never teach two different
 * contracts. One extra spawn, once a session.
 */
async function compactRules(at) {
  const r = await runCli(at, ["human-style"]);
  if (!r.ok) return "";
  const doc = r.stdout;
  const from = doc.indexOf(RULES_OPEN);
  const to = doc.indexOf(RULES_CLOSE);
  if (from < 0 || to <= from) return "";
  return doc.slice(from + RULES_OPEN.length, to).trim();
}

/**
 * The rules themselves, once a session, on the first tool result of any kind.
 *
 * **The MCP half never receives the contract.** A shell caller reaches it two ways without
 * being told to: `work start --help` names `agentmon human-style`, and running a command
 * is free once you have a terminal; and forgetting `--human` on a verb that requires one
 * prints the compact rules whole in the refusal, the one message never trimmed. Through MCP
 * the second door is closed by construction
 * (`required: [..., "human"]` means a retelling is always supplied, so the write succeeds
 * at exit 0 and no refusal is ever built), and the first is a mode name in an enum rather
 * than a command. A clause on the `human` description was measured against no clause at
 * all — same single attempt, same four contract rules missed — and that clause named the
 * audience rather than pointing anywhere, since the schema it ran under listed no
 * `human_style` mode to point at. Narrow, and enough: prose here changed no record.
 *
 * So this hands them over instead of naming them. A tool result is paid once; the six
 * `human` descriptions were paid on every turn of the conversation and bought less.
 *
 * **And it hands them over before the first draft.** Riding the first successful write was
 * measured and failed: two graded MCP sessions wrote a human area with nothing but the
 * schema to go on, and both missed the contract's headline rules — no analogy, no beat
 * saying how the agent knew, label-shaped bold lead-ins where the contract asks for ones
 * that state something, the record's own subject never named — and one invented a purpose
 * for a number the record never explained. The block that was meant to govern that draft
 * arrived stapled to the write that ended it.
 *
 * Riding the session's first `note(action="list")` instead was better and still not right:
 * it is the call the server's `instructions` and the project's CLAUDE.md both tell a session
 * to begin with, but "told to" is not "did". A session that opened with `status`, or with a
 * note read, or with a failed call, drafted blind exactly as before — delivery depended on
 * call order, and the sessions that got the order wrong are the ones that needed the rules
 * most. So `callTool` at the bottom of this file runs this over *every* result, and the
 * first one back — list, read, snapshot, refusal, anything — carries the block. There is no
 * call order that misses it, and it still costs no always-on bytes: the rules travel in a
 * result the session was going to receive anyway.
 *
 * One shape is left that no result can reach in time, because the result comes after the
 * call: a session whose first call *is* a write. `written` catches it one draft late, with
 * a head that says so and names `repair` — the call that rewrites this very record, id
 * filled in, replacing the retelling and touching nothing else. Nothing always-on is spent
 * trying to get ahead of it: a bullet about this in the project's CLAUDE.md was written,
 * then measured against its own absence, and the repo without it saved a conforming record
 * on the same attempt as the repo with it. Those bytes are re-sent on every turn of every
 * conversation and bought nothing, so there are none — this last shape is one draft late,
 * and that is the price.
 *
 * SPEC.md calls the contract write-time reading and never session-start reading, and that
 * still holds for the *contract*: 20,000 characters, the worked example, read when a record
 * needs one, `status(mode="human_style")`. What rides the first result is the compact block
 * every refusal already carries.
 *
 * Three ways it stays cheap and quiet: whichever channel opens first claims the session and
 * silences the others (mcp/lib/cli.mjs), so a session pays once — a refusal, or the whole
 * contract read on purpose, pays for everything after it; the claim is staked before the
 * spawn, so two calls in flight cannot both pay for it, and is given back if the spawn comes
 * up empty; and a call that could not reach `human-style` at all still returns exactly what
 * it would have, because a call that succeeded must never look like it failed.
 */
// Who the retelling is for is the first line of the block itself, so this does not say it
// twice: what it adds is the tie between that block and the undescribed `human` field the
// schemas require, and the instruction the whole move exists for — read now, draft after.
const PRE_DRAFT_HEAD =
  "Every record you write here has a second half — the `human` field, held to the rules " +
  "below. They come once, this session: read them before you draft the first one, not after.";

const primerHead = (repair) =>
  `The retelling you just sent is held to the rules below. Nothing refused this call, so ` +
  `they come here instead — once, this session. Read it back against them; whatever it ` +
  `misses, fix with ${repair}, which replaces the retelling and changes nothing else ` +
  `about the record.`;

const PRIMER_TAIL = 'The whole contract, worked example included: status(mode="human_style").';

/** The same envelope, error-ness and all, with `s` in place of its text. */
const reworded = (res, s) => ({ ...res, content: [{ type: "text", text: s }] });

async function handOver(at, res, head) {
  if (contractDelivered()) return res;
  markContractDelivered(); // claim the session before the spawn, not after
  const rules = await compactRules(at);
  if (!rules) {
    markContractDelivered(false);
    return res;
  }
  const body = (res?.content ?? []).map((c) => c.text ?? "").join("\n");
  return reworded(res, `${body}\n\n${head}\n\n${rules}\n\n${PRIMER_TAIL}`);
}

async function written(at, human, repair, ...parts) {
  const body = parts.filter(Boolean).join("\n");
  if (!human) return text(body);
  return handOver(at, text(body), primerHead(repair));
}

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
    return written(
      at,
      human,
      `update_work(id="${id}", human=…)`,
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
  return written(
    at,
    human,
    `update_work(id="${id}", human=…)`,
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
    // A note without a human is refused by the CLI (SPEC.md, "The human area": --message
    // never travels without --human), and that refusal carries the style contract — the
    // teaching this wrapper must not shorten or pre-empt.
    if (!r.ok) return fail(cliErrorText(r));
    // The retelling sent with a note REPLACES the stored one while the note is appended
    // (`resolve_human` in crates/agentmon-core/src/write.rs is `(Some(new), _) => Ok(new)`).
    // Said here, on the call that did it, rather than in a schema clause every turn pays
    // for — the caller reads it at the one moment the difference is visible.
    done.push(note ? "note added, retelling replaced" : "human area rewritten");
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

  return written(
    at,
    human,
    `update_work(id="${id}", human=…)`,
    `${id} ${state} · ${done.join(", ")} · ${who}`,
    stamp ? `at ${stamp}` : null,
    file
  );
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
  const human = humanText(args, "report_bug");
  flag(a, "--human", human);
  flag(a, "--labels", listArg(args.labels));
  flag(a, "--refs", listArg(args.refs));
  flag(a, "--created-at", args.created_at);
  const r = await runCli(at, a, String(args.report).trim());
  if (!r.ok) return fail(cliErrorText(r));
  const rec = r.json?.record ?? {};
  return written(
    at,
    human,
    `resolve_bug(id="${r.json?.id}", human=…)`,
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
    // A comment without a human is refused by the CLI, exactly as in `update_work`.
    if (!r.ok) return fail(stepFailure(done, cliErrorText(r)));
    // Same replace-not-append as `update_work`, said on the call that did it: the comment
    // joins the thread, the retelling takes the old one's place.
    done.push(comment ? "commented, retelling replaced" : "human area rewritten");
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
  return written(
    at,
    human,
    `resolve_bug(id="${id}", human=…)`,
    `${id} ${shown} · ${done.join(", ")} · ${who}`,
    stamp ? `resolved ${stamp}` : null,
    file
  );
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

  // The whole contract, not the compact rules: those already reach every caller free, on
  // the session's first result whatever it was (`handOver`), or in the refusal for leaving
  // a human area out. What is only here is the worked example at the end, which a summary
  // cannot stand in for — so this is the call an agent makes when the rules it has been
  // handed are not enough. Uncapped for the same reason that refusal is (mcp/lib/cli.mjs)
  // — a contract cut off mid-rule is a demand with no way to satisfy it.
  // Printed, not read out of `--json`: the document is the whole answer here, so the
  // plain call is the shorter path *and* the one that cannot go quietly empty if a future
  // envelope renames its field.
  if (mode === "human_style") {
    const r = await runCli(at, ["human-style"]);
    if (!r.ok) return fail(cliErrorText(r));
    // This *is* the handover, in full: appending the compact block to the document it was
    // cut from would charge the session 3,800 characters to repeat itself.
    markContractDelivered();
    return text(r.stdout);
  }

  if (mode === "view") {
    need(args, ["id"], "status(mode=view)");
    const id = String(args.id).trim().toUpperCase();
    const kind = id.startsWith("BUG") ? "bug" : "work";
    if (args.full) {
      const r = await runCli(at, [kind, "view", id]);
      if (!r.ok) return fail(cliErrorText(r));
      // Whole, not clamped: the human area is the record's LAST section, so any cap
      // lands on exactly the part `full: true` was spent to reach, and the caller is
      // pushed into the file read these tools exist to replace (FB-0003).
      return text(r.stdout);
    }
    const r = await runCli(at, [kind, "view", id, "--json"]);
    if (!r.ok) return fail(cliErrorText(r));
    const file = recordPath(at, id);
    return text(kind === "work" ? renderWorkView(r.json ?? {}, file) : renderBugView(r.json ?? {}, file));
  }

  throw new ToolError(`unknown mode '${mode}': use project, work, bugs, view or human_style.`);
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
      // Whole for the same reason as status(mode=view) — a note's tail is its human area.
      return text(r.stdout);
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
      const human = humanText(args, "note(action=write)");
      flag(a, "--human", human);
      replaceListFlag(a, "--tags", args.tags);
      replaceListFlag(a, "--refs", args.refs);
      flag(a, "--at", args.at);
      const body = String(args.body ?? "").trim();
      if (body) a.push("--body-file", "-");
      const r = await runCli(at, a, body || undefined);
      if (!r.ok) return fail(cliErrorText(r));
      // A type left off is preserved; a type passed is honored — but taking `essential`
      // away unpins required reading from every list, so it never happens silently.
      const was = existing.json?.type;
      const now = r.json?.record?.type ?? was;
      return written(
        at,
        human,
        `note(action="write", name="${r.json?.id}", human=…)`,
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
    const human = humanText(args, "note(action=write)");
    flag(a, "--human", human);
    flag(a, "--name", name || null);
    flag(a, "--tags", listArg(args.tags));
    flag(a, "--refs", listArg(args.refs));
    flag(a, "--at", args.at);
    const r = await runCli(at, a, String(args.body).trim());
    if (!r.ok) return fail(cliErrorText(r));
    const rec = r.json?.record ?? {};
    return written(
      at,
      human,
      `note(action="write", name="${r.json?.id}", human=…)`,
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
  const human = humanText(args, "app_feedback");
  if (id) {
    const u = ["app-feedback", "update", id, "--agent", who, "--json"];
    flag(u, "--human", human);
    flag(u, "--at", args.at);
    const r = await runCli(at, u);
    if (!r.ok) return fail(cliErrorText(r));
    return written(
      at,
      human,
      `app_feedback(id="${r.json?.id}", human=…)`,
      `${r.json?.id} retold · ${who}`,
      "only the human area changed"
    );
  }

  // `required: [...]` holds `human` alone — `type` and `title` are meaningless on the
  // rewrite above — so this message is where a filer learns which shape it missed. Both
  // shapes, because "needs type, title" to an agent that meant to rewrite an item is a
  // second wrong guess.
  if (!String(args.type ?? "").trim() || !String(args.title ?? "").trim())
    throw new ToolError("app_feedback needs type and title to file a new item, or id to rewrite an existing one's human area.");
  const a = [
    "app-feedback", "add", "--agent", who,
    "--type", String(args.type).trim(),
    "--title", oneLine(args.title),
    "--json",
  ];
  flag(a, "--human", human);
  flag(a, "--body", String(args.body ?? "").trim() || null);
  flag(a, "--at", args.at);
  const r = await runCli(at, a);
  if (!r.ok) return fail(cliErrorText(r));
  return written(
    at,
    human,
    `app_feedback(id="${r.json?.id}", human=…)`,
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
  let res;
  const leaked = leakedMarkupField(args);
  if (leaked) {
    res = fail(
      `${name}: the '${leaked}' field contains raw tool-call markup (a literal parameter ` +
        `tag) — the call's own envelope leaked into its text, which usually means the ` +
        `boundary between two fields was parsed wrong, and saved as-is it corrupts the ` +
        `record. Nothing was written. Re-send the call with each field carrying only its ` +
        `own prose.`
    );
    return handOver(ctx, res, PRE_DRAFT_HEAD);
  }
  try {
    res = await handler(args ?? {}, ctx);
  } catch (err) {
    res = fail(err instanceof ToolError ? err.message : `agentmon-mcp failed: ${err?.message ?? err}`);
  }
  // The session's first result carries the style rules, whatever call produced it — a list,
  // a snapshot, a read, a refusal. Here rather than in a handler because "the first call"
  // has to mean the first call, not the first call of one favoured kind (`handOver` above).
  // Anything the handlers already delivered leaves the flag set and this returns untouched.
  return handOver(ctx, res, PRE_DRAFT_HEAD);
}

export { RESULT_CAP };
