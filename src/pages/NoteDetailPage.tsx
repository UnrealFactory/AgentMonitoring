/**
 * One note, rendered the way it is meant to be consumed: the author's one-line
 * description first — the claim — then the body that backs it, then what it is wired to.
 *
 * Unlike a work log, a note has no mandated sections and no timeline: it is the *current*
 * state of a piece of knowledge, rewritten in place by `agentmon note update` and removed
 * outright when keeping it would mislead. What this page owes the reader is therefore
 * different from the PR-shaped pages: who is speaking, what kind of note this is (memory /
 * handoff / decision / reference), when it was last true, and the trail-hint that every
 * change is on the activity feed.
 */
import { Link, useParams } from "react-router-dom";
import { useCurrentProject, useProjectId, useDataNonce } from "../AppContext";
import { api, failureTitle, nothingToRetry } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { Markdown, RecordTitles } from "../lib/markdown";
import { RelatedSection, useRelated } from "../components/Related";
import { AgentHereNote, HumanArea, RecordViewToggle } from "../components/HumanView";
import { useContextMenu } from "../components/ContextMenu";
import { hasHumanArea } from "../lib/human";
import { useRecordView } from "../lib/recordView";
import { useProjectMenu, useRecordMenu } from "../lib/menus";
import {
  AgentChip,
  ErrorState,
  NoteTypePill,
  RecordTitle,
  RichText,
  Skeleton,
  StaleRecordBar,
  Tag,
} from "../components/ui";
import { formatDateTime, formatDateTimeUtc, formatRelative } from "../lib/format";
import { t, useLocale } from "../lib/i18n";

/** A stable empty array, so the related-index memo is not invalidated every render. */
const EMPTY: string[] = [];

/** A timestamp shown as a real date, with the relative time next to it. */
function Stamp({ iso, relative = true }: { iso: string; relative?: boolean }) {
  return (
    <>
      <time className="tabular" dateTime={iso} title={formatDateTimeUtc(iso)}>
        {formatDateTime(iso)}
      </time>
      {relative && <span className="stamp-rel"> · {formatRelative(iso)}</span>}
    </>
  );
}

export function NoteDetailPage() {
  const projectId = useProjectId()!;
  const project = useCurrentProject();
  const { id = "" } = useParams<{ id: string }>();
  const { data, error, refreshError, status, loading, reload } = useAsync(
    () => api.getNote(projectId, id),
    [projectId, id],
    useDataNonce()
  );

  const note = data;
  const contextMenu = useContextMenu();
  const recordMenu = useRecordMenu();
  const projectMenu = useProjectMenu();
  const related = useRelated(projectId, id, note?.refs ?? EMPTY);
  /* Which half of the note is on screen — the reader's choice for the session. */
  const { view, choose, peekAgent, peeking } = useRecordView(
    note ? hasHumanArea(note.human) : null,
    note?.name ?? id
  );
  const human = view === "human";
  /* No memoized words on this page, but the sentences below are built at render and the
     subscription keeps a language change from leaving the last one behind. */
  useLocale();

  if (error) {
    const noRetry = nothingToRetry(error, status);
    return (
      <div className="page">
        <ErrorState
          title={failureTitle(error, status, id)}
          message={error}
          onRetry={noRetry ? undefined : reload}
          action={
            <Link className="button" to={`/p/${projectId}/notes`}>
              {t("nd.backToList")}
            </Link>
          }
        />
      </div>
    );
  }
  if (loading || !note) {
    return (
      <div className="page">
        <Skeleton rows={7} />
      </div>
    );
  }

  const revised = note.updated > note.created;
  /* A *removed* note has no copy worth promising to keep the way a deleted work log does —
     but the bar's contract is the same: say what happened, offer the way out, and never a
     retry that would throw the last copy away. */
  const gone = refreshError !== undefined && nothingToRetry(refreshError, status);

  return (
    <RecordTitles.Provider value={related.titles}>
      <div className="page page-detail">
        {refreshError && (
          <StaleRecordBar
            id={note.name}
            message={refreshError}
            status={status}
            onRetry={gone ? undefined : reload}
            action={
              gone ? (
                <Link className="button button-sm" to={`/p/${projectId}/notes`}>
                  {t("nd.notesList")}
                </Link>
              ) : undefined
            }
          />
        )}
        <nav className="breadcrumb">
          <Link
            to={`/p/${projectId}`}
            {...contextMenu(() => (project ? projectMenu(project) : null))}
          >
            {project?.name ?? projectId}
          </Link>
          <span aria-hidden="true">/</span>
          <Link to={`/p/${projectId}/notes`}>{t("nav.notes")}</Link>
          <span aria-hidden="true">/</span>
          <span className="mono">{note.name}</span>
        </nav>

        <header
          className="record-head"
          {...contextMenu(() =>
            recordMenu({ kind: "note", id: note.name, title: note.title, projectId, here: true })
          )}
        >
          {/* The note's name and which half of it is being read; the type, the author and
              the dates below are the note's identity and are the same in both. */}
          <div className="record-head-top">
            <RecordTitle title={note.title} id={note.name} />
            <RecordViewToggle view={view} onChange={choose} hasHuman={hasHumanArea(note.human)} />
          </div>

          <div className="rec-byline">
            <NoteTypePill type={note.type} />
            <AgentChip name={note.agent} size="md" />
            <span className="rec-byline-text">
              {t("nd.bylineLeft")} <Stamp iso={note.created} />
            </span>
            {/* A note is shared and mutable, so the byline owns up to it: when somebody
                else rewrote this, the current words are theirs and the header says so —
                otherwise a body B wrote would sit under A's name. Same-author revisions
                stay a quiet timestamp. */}
            {revised &&
              (note.updatedBy && note.updatedBy !== note.agent ? (
                <span className="rec-byline-text">
                  · {t("nd.revisedBy")} <AgentChip name={note.updatedBy} />{" "}
                  <span className="stamp-rel">{formatRelative(note.updated)}</span>
                </span>
              ) : (
                <span className="rec-byline-text stamp-rel">
                  · {t("dash.updatedWhen", formatRelative(note.updated))}
                </span>
              ))}
          </div>

          {note.tags.length > 0 && (
            <div className="rec-facts">
              <div className="rec-chips">
                {note.tags.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </div>
            </div>
          )}
        </header>

        <div className="detail-layout">
          <article className="detail-main">
            {/* The author's own hook, at the altitude it was written for: the line every
                list shows, ahead of the body it summarises.

                In **both** halves. It reads like the body's first sentence and it is not
                one: `description` is the note's own frontmatter field, the line the notes
                list prints under every title and the one SPEC calls this screen's lead
                (screen 8) — which puts it with the title, the type and the dates on the side
                of the page that does not swap. Dropping it on the human half took the note's
                one-line claim away from exactly the reader who most needs a claim before
                eight paragraphs, and did it in the name of a rule about *areas* that this
                line was never part of (D3 rounds 1 and 2 critic).

                Over there it spans the record column, which is what the sheet under it spans:
                the two *cards* share both edges at every width. Their **text** does not, and
                this comment said it did — the sheet centres one measure inside itself, so its
                first line starts 96px in at 1600 and 138px at 1900 while this one starts at
                its own 16px of padding. That is the page composition working (a lead is a
                pull quote across the column; the retelling is a column of text on a sheet),
                not an alignment, and the reason it reads is the shared card edge. */}
            <p className={`note-lead${human ? " is-human" : ""}`}>{note.description}</p>

            {human && (
              <HumanArea
                human={note.human}
                kind="note"
                id={note.name}
                /* Whoever's words the note currently is — the same rule the byline uses. */
                agent={note.updatedBy ?? note.agent}
                onShowAgent={peekAgent}
              />
            )}

            {/* …and, when that offer was taken, what it cost: this record only
                (lib/recordView.ts). */}
            {peeking && <AgentHereNote id={note.name} />}

            {!human && (
              <section className="record-section" id="body">
                <Markdown source={note.body} />
              </section>
            )}

            <RelatedSection projectId={projectId} id={note.name} kind="note" related={related} />

            {/* The contract, said where a reader who wants to act on the note is looking:
                notes are rewritten in place, and the feed keeps the trail. It is a sentence
                about editing the note, so it is drawn for the reader who is reading the
                note's own words. */}
            {!human && (
              <p className="note-foot muted">
                <RichText text={t("nd.updateHint", note.name)} />
              </p>
            )}
          </article>

          <aside className="detail-side">
            <div className="side-card">
              <div className="side-card-title">{t("nd.note")}</div>
              <dl className="side-facts">
                <div>
                  <dt>{t("nd.type")}</dt>
                  <dd>
                    <NoteTypePill type={note.type} />
                  </dd>
                </div>
                <div>
                  <dt>{t("nd.agent")}</dt>
                  <dd>
                    <AgentChip name={note.agent} />
                  </dd>
                </div>
                <div>
                  <dt>{t("nd.created")}</dt>
                  <dd className="tabular" title={formatDateTimeUtc(note.created)}>
                    {formatDateTime(note.created)}
                    <span className="side-rel">{formatRelative(note.created)}</span>
                  </dd>
                </div>
                <div>
                  <dt>{t("nd.updated")}</dt>
                  <dd className="tabular" title={revised ? formatDateTimeUtc(note.updated) : ""}>
                    {revised ? (
                      <>
                        {formatDateTime(note.updated)}
                        <span className="side-rel">{formatRelative(note.updated)}</span>
                        {note.updatedBy && note.updatedBy !== note.agent && (
                          <span className="side-editor">
                            <AgentChip name={note.updatedBy} />
                          </span>
                        )}
                      </>
                    ) : (
                      /* Answers the label instead of repeating the created stamp: a note
                         nobody has touched since it was written says so in words. */
                      <span className="muted">{t("nd.neverRevised")}</span>
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          </aside>
        </div>
      </div>
    </RecordTitles.Provider>
  );
}
