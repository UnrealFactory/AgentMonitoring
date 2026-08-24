// Rendering. Every tool result is plain text shaped to a budget, because the result of
// a tool call is context the caller pays for on every subsequent turn.

/** Hard ceiling for a default-shaped tool result. `full: true` opts out of it — and out
    of ceilings entirely: the human area is a record's last section, so any cap on a full
    read cuts exactly what the read was for (FB-0003). */
export const RESULT_CAP = 600;
/** Widest a list row may get, so eight of them plus a header still fit the cap. */
export const ROW_CAP = 60;
/** Rows a list returns when the caller does not say. */
export const DEFAULT_LIMIT = 8;
export const MAX_LIMIT = 50;
/** Titles are free-form prose and a long one must not eat a whole summary. */
export const TITLE_CAP = 90;
/** How much of the outcome (or the report) a record summary quotes. */
export const GIST_CAP = 260;

export function oneLine(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

export function trunc(s, n) {
  const t = oneLine(s);
  return t.length <= n ? t : t.slice(0, Math.max(1, n - 1)).trimEnd() + "…";
}

export function clamp(s, cap) {
  const t = String(s ?? "");
  return t.length <= cap ? t : t.slice(0, cap - 30).trimEnd() + "… (truncated, read the file)";
}

/** `WORK-0004 done cli-builder Wire the watcher…` — id and state first, title last. */
function row(id, state, who, title) {
  const head = [id, state, trunc(who, 12)].filter(Boolean).join(" ");
  return `  ${trunc(`${head} ${oneLine(title)}`, ROW_CAP)}`;
}

/**
 * Join a header, some rows and a footer, dropping rows from the end until the whole
 * thing fits. The footer is rebuilt each time so the count it prints is the truth.
 */
function fit(header, rows, footer, cap = RESULT_CAP) {
  let shown = rows.length;
  for (;;) {
    const parts = [header, ...rows.slice(0, shown)];
    const f = footer ? footer(shown) : null;
    if (f) parts.push(f);
    const text = parts.filter(Boolean).join("\n");
    if (text.length <= cap) return text;
    if (shown === 0) return clamp(text, cap); // a header on its own that still overflows
    shown -= 1;
  }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function renderWorkList(records, { total, limit }) {
  if (!records.length) return "no work logs match.";
  const rows = records.map((r) => row(r.id, r.status, r.agent, r.title));
  const header = `work — ${plural(total, "record")}`;
  return fit(header, rows, (shown) =>
    shown < total ? `showing ${shown}; raise limit (max ${MAX_LIMIT}) or filter by state/agent` : null
  );
}

export function renderBugList(records, { total, limit }) {
  if (!records.length) return "no bugs match.";
  const rows = records.map((r) => row(r.id, `${r.severity}/${r.status}`, r.assignee || r.reporter, r.title));
  const header = `bugs — ${plural(total, "bug")} (id severity/status owner)`;
  return fit(header, rows, (shown) =>
    shown < total ? `showing ${shown}; raise limit (max ${MAX_LIMIT}) or filter by state/severity` : null
  );
}

export function renderNoteList(records, { total }) {
  if (!records.length) return "no notes match. Leave one: note(action=\"write\", …).";
  // The description IS the row: a note list exists so an agent can decide what to read
  // without opening bodies, and the author wrote that one line for exactly this. The
  // agent shown is whoever the current words belong to — the last rewriter, else the
  // author — since notes are shared and mutable.
  const rows = records.flatMap((n) => [
    `  ${trunc(`${n.name} ${n.type} ${trunc(n.updatedBy || n.agent, 12)}`, ROW_CAP)}`,
    `    ${trunc(n.description, ROW_CAP + 8)}`,
  ]);
  // Essential notes sort first (the store's contract); the header states the obligation.
  const essentials = records.filter((n) => n.type === "essential").length;
  const must = essentials ? ` · read the ${essentials} essential first` : "";
  const header = `notes — ${plural(total, "note")} (name type author / description)${must}`;
  return fit(header, rows, (shown) =>
    shown < rows.length ? `more exist; filter by type or query` : null
  );
}

export function renderNoteView(r, path) {
  return summary({
    meta: [
      `${r.name} ${r.type}`,
      `by ${r.agent}`,
      r.updatedBy && r.updatedBy !== r.agent ? `rewritten by ${r.updatedBy}` : null,
      `updated ${r.updated ?? r.created ?? ""}`,
    ]
      .filter(Boolean)
      .join(" · "),
    title: r.title,
    facts: [
      r.tags?.length ? `tags ${r.tags.join(",")}` : null,
      r.refs?.length ? `refs ${r.refs.join(",")}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    gist: [r.description, r.body].filter(Boolean).join(" — "),
    path,
  });
}

export function renderSnapshot(snap) {
  const c = snap.project?.counts ?? {};
  const bySeverity = {};
  for (const b of snap.openBugs ?? []) bySeverity[b.severity] = (bySeverity[b.severity] ?? 0) + 1;
  const sev = ["critical", "high", "medium", "low"]
    .filter((s) => bySeverity[s])
    .map((s) => `${bySeverity[s]} ${s}`)
    .join(", ");
  const header =
    `${snap.project?.name ?? "project"}: ${c.workTotal ?? 0} work (${c.workInProgress ?? 0} in progress), ` +
    `${c.bugsOpen ?? 0} bugs open${sev ? ` (${sev})` : ""}, last activity ${c.lastActivity ?? "never"}`;

  const active = (snap.activeWork ?? []).slice(0, 3).map((w) => row(w.id, "", w.agent, w.title));
  const bugs = (snap.openBugs ?? []).slice(0, 3).map((b) => row(b.id, b.severity, b.assignee || b.reporter, b.title));
  const rows = [];
  if (active.length) rows.push("in progress:", ...active);
  if (bugs.length) rows.push("open bugs:", ...bugs);
  if (!rows.length) rows.push("  nothing in progress, no open bugs");

  const moreWork = Math.max(0, (snap.activeWork ?? []).length - 3);
  const moreBugs = Math.max(0, (snap.openBugs ?? []).length - 3);
  const more = [moreWork ? `${moreWork} more active` : null, moreBugs ? `${moreBugs} more open` : null]
    .filter(Boolean)
    .join(", ");
  return fit(header, rows, () => (more ? `${more} — status(mode="work"|"bugs")` : null));
}

/**
 * meta / title / facts / gist / path — where only the gist is elastic. It is capped at
 * GIST_CAP, which is what makes this a summary rather than a small copy of the record:
 * enough of the outcome to decide whether to spend `full: true` on the rest. It shrinks
 * further, and is dropped entirely, when a long title or a deep file path leaves less
 * room than that, so the whole thing always comes back inside the cap.
 */
function summary({ meta, title, facts, gist, path }) {
  const head = [meta, trunc(title, TITLE_CAP), facts].filter(Boolean).join("\n");
  const tail = [path, "full:true for the whole record"].filter(Boolean).join("\n");
  const room = Math.min(GIST_CAP, RESULT_CAP - head.length - tail.length - 2);
  const middle = room >= 32 ? trunc(gist, room) : null;
  return clamp([head, middle, tail].filter(Boolean).join("\n"), RESULT_CAP);
}

export function renderWorkView(r, path) {
  return summary({
    meta: [
      `${r.id} ${r.status} ${r.agent}`,
      `started ${r.started}`,
      r.finished ? `finished ${r.finished}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    title: r.title,
    facts: [
      r.tags?.length ? `tags ${r.tags.join(",")}` : null,
      r.files?.length ? plural(r.files.length, "file") : null,
      r.refs?.length ? `refs ${r.refs.join(",")}` : null,
      plural(r.updates?.length ?? 0, "update"),
    ]
      .filter(Boolean)
      .join(" · "),
    gist: r.outcome ? `outcome: ${r.outcome}` : `what: ${r.what}`,
    path,
  });
}

export function renderBugView(r, path) {
  // One agent usually reports, claims and resolves a bug, and printing that handle three
  // times costs the summary a line of the resolution. Each name is printed when it is new.
  return summary({
    meta: [
      `${r.id} ${r.severity} ${r.status}`,
      `reported by ${r.reporter} ${r.created}`,
      r.assignee && r.assignee !== r.reporter ? `assignee ${r.assignee}` : null,
      r.resolved
        ? `resolved ${r.resolved}${r.resolvedBy && r.resolvedBy !== (r.assignee || r.reporter) ? ` by ${r.resolvedBy}` : ""}`
        : null,
    ]
      .filter(Boolean)
      .join(" · "),
    title: r.title,
    facts: [
      r.labels?.length ? `labels ${r.labels.join(",")}` : null,
      r.refs?.length ? `refs ${r.refs.join(",")}` : null,
      plural(r.comments?.length ?? 0, "comment"),
    ]
      .filter(Boolean)
      .join(" · "),
    gist: r.resolution ? `resolution: ${r.resolution}` : `report: ${r.report}`,
    path,
  });
}
