/**
 * The cross-reference block, shared by the work log, bug and note pages.
 *
 * A `refs:` list in a record's frontmatter is a relationship, and a relationship has two
 * ends. Showing only the end the author happened to type is how a reader misses that the
 * follow-ups from a piece of work became three separate bugs. So this block shows both:
 *
 *   References     — what this one points at
 *   Referenced by  — every work log, bug and note in the project that points back here
 *
 * Each row carries the id, the *title*, and the other record's own status (dot + pill),
 * because "BUG-0008" alone tells a reader nothing they can act on.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useDataNonce } from "../AppContext";
import { useAsync } from "../lib/useAsync";
import { recordPath } from "../lib/markdown";
import { useContextMenu } from "./ContextMenu";
import { useRecordMenu } from "../lib/menus";
import { BugStatusPill, NoteTypeDot, NoteTypePill, RecordStatusDot, SeverityBadge, WorkStatusPill } from "./ui";
import { bugNoun, noteNoun, workNoun } from "../lib/words";
import { formatDateTimeUtc, formatRelative } from "../lib/format";
import { t } from "../lib/i18n";
import type { BugSummary, NoteSummary, WorklogSummary } from "../lib/types";

type RecordKind = "work" | "bug" | "note";

interface RelatedItem {
  id: string;
  title: string;
  kind: RecordKind;
  work?: WorklogSummary;
  bug?: BugSummary;
  note?: NoteSummary;
  lastActivity: string;
}

/* Tagged at the call site, never duck-typed: a note has an `agent` field too, so the old
   `"agent" in r` test would have read every note as a work log. */
const workItem = (r: WorklogSummary): RelatedItem => ({
  id: r.id,
  title: r.title,
  kind: "work",
  work: r,
  lastActivity: r.lastActivity,
});
const bugItem = (r: BugSummary): RelatedItem => ({
  id: r.id,
  title: r.title,
  kind: "bug",
  bug: r,
  lastActivity: r.lastActivity,
});
const noteItem = (r: NoteSummary): RelatedItem => ({
  id: r.name,
  title: r.title,
  kind: "note",
  note: r,
  lastActivity: r.lastActivity,
});

export type RelatedIndex = ReturnType<typeof useRelated>;

/**
 * Both directions of the index for one record. The page calls this once and hands the
 * result to the section below, so a record page never asks the vault for the same three
 * lists twice.
 */
export function useRelated(projectId: string, id: string, refs: string[]) {
  const nonce = useDataNonce();
  const works = useAsync(() => api.listWorklogs(projectId), [projectId], nonce);
  const bugs = useAsync(() => api.listBugs(projectId), [projectId], nonce);
  const notes = useAsync(() => api.listNotes(projectId), [projectId], nonce);

  return useMemo(() => {
    const loading = works.loading || bugs.loading || notes.loading;
    const all: RelatedItem[] = [
      ...(works.data ?? []).map(workItem),
      ...(bugs.data ?? []).map(bugItem),
      ...(notes.data ?? []).map(noteItem),
    ];
    const byId = new Map(all.map((r) => [r.id, r]));

    const outgoing = refs.map((ref) => byId.get(ref) ?? { ref });
    const incoming = all
      .filter((r) => r.id !== id)
      .filter((r) => (r.work?.refs ?? r.bug?.refs ?? r.note?.refs ?? []).includes(id))
      .filter((r) => !refs.includes(r.id))
      .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));

    /* The same index, keyed for the prose: an id written into a sentence gets the title of
       the record it names (lib/markdown.tsx). Withheld until every list is in, so a chip
       is never drawn as "no such record" while the vault is still being read. */
    const titles = loading ? null : new Map(all.map((r) => [r.id, r.title]));

    return { loading, outgoing, incoming, titles, count: outgoing.length + incoming.length };
  }, [works.data, works.loading, bugs.data, bugs.loading, notes.data, notes.loading, refs, id]);
}

function RelatedRow({ projectId, item }: { projectId: string; item: RelatedItem }) {
  /* A row here is a work log or a bug, so it is the same row the list screens draw and gets
     the same right-button menu. `here` is deliberately not set: this is the *other* record,
     the one the reader is not on, so Open is the item that matters most on it. */
  const contextMenu = useContextMenu();
  const recordMenu = useRecordMenu();
  return (
    <li>
      <Link
        className="rel-row"
        to={recordPath(projectId, item.id)}
        {...contextMenu(() =>
          recordMenu({ kind: item.kind, id: item.id, title: item.title, projectId })
        )}
      >
        {item.note ? (
          <NoteTypeDot type={item.note.type} />
        ) : (
          <RecordStatusDot
            status={item.work ? item.work.status : item.bug!.status}
            kind={item.kind as "work" | "bug"}
          />
        )}
        <span className="rel-id mono">{item.id}</span>
        <span className="rel-title" title={item.title}>
          {item.title}
        </span>
        <span className="rel-side">
          {item.bug && <SeverityBadge severity={item.bug.severity} />}
          {item.work ? (
            <WorkStatusPill status={item.work.status} />
          ) : item.note ? (
            <NoteTypePill type={item.note.type} />
          ) : (
            <BugStatusPill status={item.bug!.status} />
          )}
          <time
            className="rel-time tabular"
            dateTime={item.lastActivity}
            title={t("dash.lastActivityTip", formatDateTimeUtc(item.lastActivity))}
          >
            {formatRelative(item.lastActivity)}
          </time>
        </span>
      </Link>
    </li>
  );
}

/** An id in `refs:` that no record in this project answers to. */
function MissingRow({ id }: { id: string }) {
  return (
    <li>
      <span className="rel-row is-missing">
        <span className="sdot sdot-missing" aria-hidden="true" />
        <span className="rel-id mono">{id}</span>
        <span className="rel-title muted">{t("rec.missingRef")}</span>
      </span>
    </li>
  );
}

export function RelatedSection({
  projectId,
  id,
  kind,
  related,
}: {
  projectId: string;
  id: string;
  kind: RecordKind;
  related: RelatedIndex;
}) {
  const { outgoing, incoming, count } = related;
  /* The object's own noun, from lib/words.ts: a work log is a work log on every screen. */
  const noun = kind === "bug" ? bugNoun() : kind === "note" ? noteNoun() : workNoun();

  if (count === 0) return null;

  return (
    <section className="record-section" id="related">
      <h2 className="section-title">
        {t("rec.related")}
        <span className="section-count tabular">{count}</span>
      </h2>

      <div className="rel-card">
        {outgoing.length > 0 && (
          <div className="rel-group">
            <div className="rel-group-head">
              <span className="rel-arrow" aria-hidden="true">
                →
              </span>
              <span className="rel-group-label">{t("rec.references")}</span>
              <span className="rel-group-hint">{t("rec.referencesHint", noun)}</span>
            </div>
            <ul className="rel-rows">
              {outgoing.map((item) =>
                "ref" in item ? (
                  <MissingRow key={item.ref} id={item.ref} />
                ) : (
                  <RelatedRow key={item.id} projectId={projectId} item={item} />
                )
              )}
            </ul>
          </div>
        )}

        {incoming.length > 0 && (
          <div className="rel-group">
            <div className="rel-group-head">
              <span className="rel-arrow" aria-hidden="true">
                ←
              </span>
              <span className="rel-group-label">{t("rec.referencedBy")}</span>
              <span className="rel-group-hint">{t("rec.referencedByHint", id)}</span>
            </div>
            <ul className="rel-rows">
              {incoming.map((item) => (
                <RelatedRow key={item.id} projectId={projectId} item={item} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
