/**
 * One work record, rendered the way a good merged pull request reads: what was done, why,
 * how, which files moved, the notes posted while it was running, and — visually separate
 * from everything above it — the outcome.
 *
 * The reader is assumed never to have seen the work. Nothing that carries meaning is
 * truncated, every id in the prose is a link, and every timestamp is shown both as a real
 * date and as "how long ago".
 */
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useCurrentProject, useProjectSlug, useVaultNonce } from "../AppContext";
import { api, failureTitle, nothingToRetry } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useActiveSection } from "../lib/useActiveSection";
import { Markdown, RecordTitles } from "../lib/markdown";
import {
  ContentsRail,
  PartsBody,
  PartsJump,
  partsToc,
  useLabelledParts,
  type TocEntry,
} from "../components/RecordBody";
import { RelatedSection, useRelated } from "../components/Related";
import { useContextMenu } from "../components/ContextMenu";
import { useProjectMenu, useRecordMenu } from "../lib/menus";
import {
  AgentChip,
  CorrectionMark,
  CorrectionNotice,
  ErrorState,
  RecordTitle,
  RichText,
  Skeleton,
  StaleRecordBar,
  Tag,
  WorkStatusPill,
} from "../components/ui";
import { authorText, countCorrections, isCorrection, updateAuthor } from "../lib/updates";
import {
  formatDateTime,
  formatDateTimeUtc,
  formatDuration,
  formatRelative,
} from "../lib/format";
import { t, useLocale } from "../lib/i18n";
import type { WorklogDetail } from "../lib/types";

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

export function WorkDetailPage() {
  const slug = useProjectSlug()!;
  const project = useCurrentProject();
  const { id = "" } = useParams<{ id: string }>();
  const { data, error, refreshError, status, loading, reload } = useAsync(
    () => api.getWorklog(slug, id),
    [slug, id],
    useVaultNonce()
  );

  const work = data;
  /* The record's own head takes the same menu its row on the list does, minus Open — the
     reader is already on it. Copying an id or a link out of a record is how one record
     comes to reference another. */
  const contextMenu = useContextMenu();
  const recordMenu = useRecordMenu();
  const projectMenu = useProjectMenu();
  const related = useRelated(slug, id, work?.refs ?? EMPTY);
  /** Notes their authors opened with "Correction:" — see src/lib/updates.ts. */
  const corrections = countCorrections(work?.updates ?? []);
  /** The outcome's own parts (Shipped / Verified / Known gaps), as its author labelled them. */
  const outcome = useLabelledParts(work?.outcome);
  /* The contents rail is words, so the language is one of its inputs. Left out of this
     list, a rail built in English stayed English under a Korean record when the reader
     changed the language, because nothing else it depends on had changed (P9 round 1
     critic, who caught the same omission on the dashboard). */
  const locale = useLocale();
  const sections = useMemo(() => {
    if (!work) return [] as TocEntry[];
    const out: TocEntry[] = [
      { id: "what", label: t("wd.what"), count: 0 },
      { id: "why", label: t("wd.why"), count: 0 },
      { id: "how", label: t("wd.how"), count: 0 },
    ];
    if (work.files.length) {
      out.push({ id: "files", label: t("wd.files"), count: work.files.length });
    }
    out.push({ id: "updates", label: t("wd.updates"), count: work.updates.length });
    if (work.outcome) {
      out.push({ id: "outcome", label: t("wd.outcome"), count: 0 }, ...partsToc(outcome));
    }
    if (related.count) out.push({ id: "related", label: t("rec.related"), count: related.count });
    return out;
  }, [work, related.count, outcome, locale]);
  const active = useActiveSection(sections.map((s) => s.id));

  if (error) {
    const noRetry = nothingToRetry(error, status);
    return (
      <div className="page">
        <ErrorState
          title={failureTitle(error, status, id)}
          message={error}
          onRetry={noRetry ? undefined : reload}
          action={
            <Link className="button" to={`/p/${slug}/work`}>
              {t("wd.backToList")}
            </Link>
          }
        />
      </div>
    );
  }
  if (loading || !work) {
    return (
      <div className="page">
        <Skeleton rows={7} />
      </div>
    );
  }

  const duration = formatDuration(work.started, work.finished);

  return (
    <RecordTitles.Provider value={related.titles}>
      <div className="page page-detail">
        {/* The record moved out from under the reader — deleted, or the vault stopped
            answering. The page keeps what it had and says so. */}
        {refreshError && (
          <StaleRecordBar
            id={work.id}
            message={refreshError}
            status={status}
            onRetry={reload}
            action={
              nothingToRetry(refreshError, status) ? (
                <Link className="button button-sm" to={`/p/${slug}/work`}>
                  {t("wd.workList")}
                </Link>
              ) : undefined
            }
          />
        )}
        <nav className="breadcrumb">
          {/* The crumb is a link to the project, so it opens the project's menu — the same
              one the sidebar row for it opens. Only "Work" between them stays plain: a list
              screen is not a thing there is a slug to copy or a folder to delete for. */}
          <Link
            to={`/p/${slug}`}
            {...contextMenu(() => (project ? projectMenu(project) : null))}
          >
            {project?.name ?? slug}
          </Link>
          <span aria-hidden="true">/</span>
          <Link to={`/p/${slug}/work`}>{t("nav.work")}</Link>
          <span aria-hidden="true">/</span>
          <span className="mono">{work.id}</span>
        </nav>

        <header
          className="record-head"
          {...contextMenu(() =>
            recordMenu({ kind: "work", id: work.id, title: work.title, slug, here: true })
          )}
        >
          <RecordTitle title={work.title} id={work.id} />

          {/* Above What/Why/How, because a correction the reader meets after the sentence it
              corrects is a correction they have already believed the wrong version of. */}
          <CorrectionNotice count={corrections} href="#updates" where={t("rec.inUpdates")} />

          <div className="rec-byline">
            <WorkStatusPill status={work.status} />
            <AgentChip name={work.agent} size="md" />
            <span className="rec-byline-text">
              {work.status === "done" && work.finished ? (
                <>
                  {t("wd.bylineDone")} <Stamp iso={work.finished} />
                </>
              ) : work.status === "abandoned" && work.finished ? (
                <>
                  {t("wd.bylineAbandoned")} <Stamp iso={work.finished} />
                </>
              ) : (
                <>
                  {t("wd.bylineRunning")} <Stamp iso={work.started} />
                </>
              )}
            </span>
          </div>

          <div className="rec-facts">
            <ul className="rec-fact-list">
              <li>
                <span className="rec-fact-label">{t("wd.started")}</span>
                <Stamp iso={work.started} relative={false} />
              </li>
              <li>
                <span className="rec-fact-label">{t("wd.finished")}</span>
                {work.finished ? (
                  <Stamp iso={work.finished} relative={false} />
                ) : (
                  /* Not the bare state word: under the label 완료 it read as a
                     contradiction — the app's word for the end of a work log as the label,
                     and its word for the middle of one as the value, on one line (P9 round 1
                     critic). "아직 진행 중" answers the label instead of arguing with it, and
                     is the same phrase the timeline below already uses. */
                  <span className="muted">{t("wd.endRunning")}</span>
                )}
              </li>
              <li>
                <span className="rec-fact-label">{t("wd.duration")}</span>
                <span className="tabular">{duration}</span>
              </li>
              <li>
                <span className="rec-fact-label">{t("wd.updates")}</span>
                <span className="tabular">{work.updates.length}</span>
              </li>
              <li>
                <span className="rec-fact-label">{t("wd.files")}</span>
                <span className="tabular">{work.files.length}</span>
              </li>
            </ul>

            {work.tags.length > 0 && (
              <div className="rec-chips">
                {work.tags.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </div>
            )}
          </div>
        </header>

        <div className="detail-layout">
          <article className="detail-main">
            {/* `section` is the literal heading in the record file (`## What`), which stays
                English because it is what the vault holds; `title` is what this screen calls
                it. The empty-state sentence names the literal one, so a reader who goes to
                fix the record knows what to type. */}
            <Body id="what" title={t("wd.what")} section="What" source={work.what} />
            <Body id="why" title={t("wd.why")} section="Why" source={work.why} />
            <Body id="how" title={t("wd.how")} section="How" source={work.how} />

            {work.files.length > 0 && <FilesSection files={work.files} />}

            <UpdatesSection work={work} />

            {work.outcome && (
              <section className="record-section" id="outcome">
                <div className="outcome-card">
                  <header className="outcome-head">
                    <span className="outcome-mark" aria-hidden="true">
                      <svg viewBox="0 0 16 16" width="11" height="11">
                        <path
                          d="M3.5 8.5 L6.5 11.5 L12.5 4.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    <h2 className="outcome-title">{t("wd.outcome")}</h2>
                    <span className="outcome-when">
                      {work.finished ? (
                        <>
                          {t("wd.shipped")} <Stamp iso={work.finished} />
                        </>
                      ) : (
                        t("wd.recorded")
                      )}
                    </span>
                  </header>
                  <PartsJump result={outcome} label={t("wd.insideOutcome")} />
                  <div className="outcome-body">
                    <PartsBody result={outcome} />
                  </div>
                </div>
              </section>
            )}

            <RelatedSection slug={slug} id={work.id} kind="work" related={related} />

            {work.extraSections.map((s) => (
              <section className="record-section" key={s.title}>
                {/* The heading is the author’s own `## …` line, not one of the app’s: it is
                    printed as written, in whatever language they wrote it (P6). Marked so
                    the Korean gate can tell it from the headings beside it, which are the
                    app’s and must be translated. */}
                <h2 className="section-title is-author">{s.title}</h2>
                <Markdown source={s.body} />
              </section>
            ))}
          </article>

          <aside className="detail-side">
            <ContentsRail entries={sections} active={active} />

            <div className="side-card">
              {/* The object's own noun, the way the bug page's twin card says Bug. "Record"
                  is the word lib/words.ts exists to keep off the screens. */}
              <div className="side-card-title">{t("wd.workLog")}</div>
              <dl className="side-facts">
                <div>
                  <dt>{t("wd.status")}</dt>
                  <dd>
                    <WorkStatusPill status={work.status} />
                  </dd>
                </div>
                <div>
                  <dt>{t("wd.agent")}</dt>
                  <dd>
                    <AgentChip name={work.agent} />
                  </dd>
                </div>
                <div>
                  <dt>{t("wd.started")}</dt>
                  <dd className="tabular" title={formatDateTimeUtc(work.started)}>
                    {formatDateTime(work.started)}
                    <span className="side-rel">{formatRelative(work.started)}</span>
                  </dd>
                </div>
                <div>
                  <dt>{t("wd.finished")}</dt>
                  <dd className="tabular" title={work.finished ? formatDateTimeUtc(work.finished) : ""}>
                    {work.finished ? (
                      <>
                        {formatDateTime(work.finished)}
                        <span className="side-rel">{formatRelative(work.finished)}</span>
                      </>
                    ) : (
                      <span className="muted">{t("wd.endRunning")}</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>{t("wd.duration")}</dt>
                  <dd className="tabular">
                    {duration}
                    {!work.finished && <span className="side-rel">{t("wd.andCounting")}</span>}
                  </dd>
                </div>
                <div>
                  <dt>{t("wd.lastActivity")}</dt>
                  <dd className="tabular" title={formatDateTimeUtc(work.lastActivity)}>
                    {formatRelative(work.lastActivity)}
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

/** One of the three body sections. A section the agent left empty says so. */
function Body({
  id,
  title,
  section,
  source,
}: {
  id: string;
  title: string;
  /** The heading as it is written in the record file — never translated. */
  section: string;
  source: string;
}) {
  return (
    <section className="record-section" id={id}>
      <h2 className="section-title">{title}</h2>
      {source.trim() ? (
        <Markdown source={source} />
      ) : (
        <p className="muted">
          <RichText text={t("wd.noSection", section)} />
        </p>
      )}
    </section>
  );
}

/** Files touched, grouped the way a reader scans them: directory muted, file bright. */
function FilesSection({ files }: { files: string[] }) {
  const sorted = [...files].sort((a, b) => a.localeCompare(b));
  const dirs = new Set(sorted.map((f) => (f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "")));
  return (
    <section className="record-section" id="files">
      <h2 className="section-title">
        {t("wd.filesTouched")} <span className="section-count tabular">{files.length}</span>
      </h2>
      <div className="files-card">
        <div className="files-head">
          <svg className="files-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M4 2.5 h5 l3 3 v8 h-8 z M9 2.5 v3 h3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
          <span>{t("wd.filesAcross", files.length, dirs.size)}</span>
        </div>
        <ul className="file-grid">
          {sorted.map((f) => {
            const cut = f.lastIndexOf("/");
            const dir = cut >= 0 ? f.slice(0, cut + 1) : "";
            const name = cut >= 0 ? f.slice(cut + 1) : f;
            return (
              <li key={f} className="file-item mono" title={f}>
                <span className="file-dir">{dir}</span>
                <span className="file-name">{name}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/**
 * The progress notes as a timeline: it opens with the moment the work started, carries
 * each update, and closes on the moment the status changed (or on "still running").
 */
function UpdatesSection({ work }: { work: WorklogDetail }) {
  const endLabel =
    work.status === "done"
      ? t("wd.endDone")
      : work.status === "abandoned"
        ? t("wd.endAbandoned")
        : t("wd.endRunning");
  const endTone =
    work.status === "done" ? "done" : work.status === "abandoned" ? "abandoned" : "open";

  return (
    <section className="record-section" id="updates">
      <h2 className="section-title">
        {t("wd.updates")}
        {work.updates.length > 0 && (
          <span className="section-count tabular">{work.updates.length}</span>
        )}
      </h2>

      <ol className="timeline-rail">
        <li className="trail-node trail-edge">
          <span className="trail-dot trail-dot-start" aria-hidden="true" />
          <div className="trail-edge-text">
            <span className="trail-edge-label">{t("wd.startedThisWork", work.agent)}</span>
            <span className="trail-edge-time tabular" title={formatDateTimeUtc(work.started)}>
              {formatDateTime(work.started)} · {formatRelative(work.started)}
            </span>
          </div>
        </li>

        {work.updates.length === 0 && (
          <li className="trail-node trail-empty">
            <span className="trail-dot trail-dot-muted" aria-hidden="true" />
            <p className="trail-empty-text">
              {t("wd.noNotes")}{" "}
              <code>agentmon work update {work.id} --message …</code>
            </p>
          </li>
        )}

        {work.updates.map((u, i) => {
          /* A note whose author opened it with "Correction:" is drawn as one. The word is
             theirs; the page only stops it reading like the next progress note. */
          const fix = isCorrection(u.body);
          /* Notes are the record agent's unless the CLI wrote a byline into this one. */
          const author = updateAuthor(u.body);
          return (
            <li className="trail-node" key={`${u.ts}-${i}`}>
              <span className={`trail-dot${fix ? " trail-dot-correction" : ""}`} aria-hidden="true" />
              <article className={`update-card${fix ? " is-correction" : ""}`}>
                <header className="update-head">
                  <AgentChip name={author ?? work.agent} />
                  {fix ? (
                    <span className="update-flag">
                      <CorrectionMark />
                      {t("rec.correction")}
                    </span>
                  ) : (
                    <span className="update-verb">{t("wd.postedUpdate", i + 1)}</span>
                  )}
                  <time className="update-ts tabular" dateTime={u.ts} title={formatDateTimeUtc(u.ts)}>
                    {formatDateTime(u.ts)} · {formatRelative(u.ts)}
                  </time>
                </header>
                <div className="update-body">
                  <Markdown source={authorText(u.body)} />
                </div>
              </article>
            </li>
          );
        })}

        <li className="trail-node trail-edge">
          <span className={`trail-dot trail-dot-${endTone}`} aria-hidden="true" />
          <div className="trail-edge-text">
            <span className="trail-edge-label">{endLabel}</span>
            <span className="trail-edge-time tabular">
              {work.finished ? (
                <span title={formatDateTimeUtc(work.finished)}>
                  {formatDateTime(work.finished)} · {formatRelative(work.finished)} ·{" "}
                  {t("wd.inTotal", formatDuration(work.started, work.finished))}
                </span>
              ) : (
                <span>{t("wd.soFar", formatDuration(work.started, null))}</span>
              )}
            </span>
          </div>
        </li>
      </ol>
    </section>
  );
}
