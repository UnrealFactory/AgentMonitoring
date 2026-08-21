/**
 * The project's shared notes: what the agents know and want each other to know.
 *
 * A note is the third record kind and the only mutable one — memory, handoffs, decisions
 * and references, rewritten in place as the truth changes (SPEC.md, notes). This list is
 * the index an arriving agent (or the human) scans: the newest handoff first, each row
 * carrying the author's own one-line description, because that line — not the body — is
 * how a reader decides what to open. Filters live in the URL and count what choosing them
 * would show, exactly as the work list's do.
 */
import { useCallback, useMemo, useRef, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useProjectId, useDataNonce } from "../AppContext";
import { agentColumnWidth } from "../lib/columns";
import { api, failureTitle, nothingToRetry, projectGone } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useListKeyboard } from "../lib/useListKeyboard";
import { useUrlFilters } from "../lib/useUrlFilters";
import { Select } from "../components/Select";
import { useContextMenu } from "../components/ContextMenu";
import { useRecordMenu } from "../lib/menus";
import {
  AgentChip,
  EmptyState,
  ErrorState,
  NoteTypeDot,
  Skeleton,
  Tag,
} from "../components/ui";
import { formatDateTimeUtc, formatRelative } from "../lib/format";
import { t } from "../lib/i18n";
import { noteCount, noteTypeLabel } from "../lib/words";
import type { NoteSummary, NoteType } from "../lib/types";

/** The dimensions a filter slices on — and therefore the ones a count can be exempt from. */
type Dim = "type" | "agent" | "tag";

const TYPES: (NoteType | "all")[] = ["all", "memory", "handoff", "decision", "reference"];
const TYPE_ORDER: NoteType[] = ["memory", "handoff", "decision", "reference"];
const typeText = (type: string): string =>
  type === "all" ? t("filter.all") : noteTypeLabel(type as NoteType);
/** Why each tab exists, one sentence — the type IS the reading protocol. */
const typeTip = (type: string): string =>
  type === "memory"
    ? t("notes.tipMemory")
    : type === "handoff"
      ? t("notes.tipHandoff")
      : type === "decision"
        ? t("notes.tipDecision")
        : type === "reference"
          ? t("notes.tipReference")
          : t("notes.tabAllTip");
const MAX_TAGS = 3;

/** Filters, and their defaults; anything at its default stays out of the URL. */
const DEFAULTS = { type: "all", agent: "all", tag: "all", q: "" };
const ALLOWED = { type: ["all", ...TYPE_ORDER] } as const;

export function NotesPage() {
  const projectId = useProjectId()!;
  const {
    data,
    error,
    refreshError,
    status: httpStatus,
    loading,
    reload,
  } = useAsync(() => api.listNotes(projectId), [projectId], useDataNonce());
  /* The project went out from under an open list — same rule as the work list: a list of a
     project that is gone becomes the stale-project screen; any other failed refresh keeps
     the last good rows and is the shell's line to say (lib/api.ts, `projectGone`). */
  const failure = error ?? (projectGone(refreshError, httpStatus) ? refreshError : undefined);

  const searchRef = useRef<HTMLInputElement>(null);
  const contextMenu = useContextMenu();
  const recordMenu = useRecordMenu();

  const notes = useMemo(() => data ?? [], [data]);

  /* The filter slices on the same agent the rows display — the one the current words
     belong to — or a filtered list would drop rows that visibly carry the chosen name. */
  const agents = useMemo(
    () => [...new Set(notes.map((n) => n.updatedBy ?? n.agent))].sort((a, b) => a.localeCompare(b)),
    [notes]
  );
  const tags = useMemo(
    () => [...new Set(notes.flatMap((n) => n.tags))].sort((a, b) => a.localeCompare(b)),
    [notes]
  );

  const allowed = useMemo(
    () => ({ ...ALLOWED, agent: ["all", ...agents], tag: ["all", ...tags] }),
    [agents, tags]
  );

  const { values, set, reset, isDirty } = useUrlFilters(DEFAULTS, allowed);
  const type = values.type as NoteType | "all";
  const { agent, tag, q: query } = values;

  const agentWidth = useMemo(() => agentColumnWidth(agents, { chrome: 26, min: 96 }), [agents]);

  /**
   * Search reads the whole note — name, title, description, tags and body (`searchText`,
   * built by the reader) — lower-cased once per load rather than once per keystroke.
   */
  const haystacks = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of notes) {
      map.set(
        n.name,
        [n.name, n.title, n.agent, n.updatedBy ?? "", ...n.tags, n.searchText]
          .join(" ")
          .toLowerCase()
      );
    }
    return map;
  }, [notes]);

  /** One predicate, with the ability to leave one dimension out (the counts rule). */
  const matches = useCallback(
    (n: NoteSummary, skip: Dim | null = null) => {
      if (skip !== "type" && type !== "all" && n.type !== type) return false;
      if (skip !== "agent" && agent !== "all" && (n.updatedBy ?? n.agent) !== agent) return false;
      if (skip !== "tag" && tag !== "all" && !n.tags.includes(tag)) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (haystacks.get(n.name) ?? "").includes(q);
    },
    [type, agent, tag, query, haystacks]
  );

  const facet = useCallback(
    (dim: Dim, has: (n: NoteSummary) => boolean) =>
      notes.filter((n) => has(n) && matches(n, dim)).length,
    [notes, matches]
  );

  /** Already sorted by the reader: most recently updated first — no grouping on top. */
  const filtered = useMemo(() => notes.filter((n) => matches(n)), [notes, matches]);

  const typeCounts = useMemo(() => {
    const scope = notes.filter((n) => matches(n, "type"));
    const counts: Record<string, number> = { all: scope.length };
    for (const ty of TYPE_ORDER) counts[ty] = scope.filter((n) => n.type === ty).length;
    return counts;
  }, [notes, matches]);

  const filtersActive = isDirty();
  const clearFilters = useCallback(() => reset(), [reset]);
  const clearQuery = useCallback(() => set("q", ""), [set]);
  const href = useCallback((n: NoteSummary) => `/p/${projectId}/notes/${n.name}`, [projectId]);
  const { cursor, setCursor, rowRefs } = useListKeyboard({
    items: filtered,
    href,
    searchRef,
    query,
    onClearQuery: clearQuery,
    resetKey: `${type}|${agent}|${tag}|${query}`,
  });

  if (failure) {
    return (
      <div className="page">
        <ErrorState
          title={failureTitle(failure, httpStatus)}
          message={failure}
          onRetry={nothingToRetry(failure, httpStatus) ? undefined : reload}
          action={
            <Link className="button" to="/projects">
              {t("nav.allProjects")}
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">{t("notes.title")}</h1>
          <p className="page-sub">{t("notes.sub")}</p>
        </div>
        <div className="page-head-meta tabular">
          {loading ? t("app.loadingShort") : noteCount(notes.length)}
        </div>
      </header>

      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label={t("filter.byType")}>
          {TYPES.map((ty) => (
            <button
              key={ty}
              role="tab"
              data-value={ty}
              aria-selected={type === ty}
              className={`segment${type === ty ? " is-active" : ""}`}
              title={typeTip(ty)}
              onClick={() => set("type", ty)}
            >
              {typeText(ty)}
              <span className="segment-count tabular">{typeCounts[ty] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="toolbar-right">
          <Select
            label={t("filter.byAgent")}
            value={agent}
            onChange={(v) => set("agent", v)}
            options={[
              { value: "all", label: t("filter.allAgents") },
              ...agents.map((a) => ({
                value: a,
                label: a,
                hint: facet("agent", (n) => (n.updatedBy ?? n.agent) === a),
              })),
            ]}
          />
          <Select
            label={t("filter.byTag")}
            value={tag}
            onChange={(v) => set("tag", v)}
            options={[
              { value: "all", label: t("filter.allTags") },
              ...tags.map((t) => ({
                value: t,
                label: t,
                hint: facet("tag", (n) => n.tags.includes(t)),
              })),
            ]}
          />
          <div className="search">
            <svg className="search-icon" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10.2 10.2 L13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <input
              ref={searchRef}
              className="input search-input"
              type="search"
              value={query}
              placeholder={t("notes.searchPlaceholder")}
              onChange={(e) => set("q", e.target.value)}
              aria-label={t("notes.searchLabel")}
            />
            {!query && <kbd className="search-kbd">/</kbd>}
          </div>
        </div>
      </div>

      {filtersActive && (
        <div className="filter-summary">
          <span className="filter-count tabular">{t("filter.matches", filtered.length)}</span>
          {type !== "all" && (
            <button className="filter-chip" onClick={() => set("type", "all")}>
              {t("filter.chipType", typeText(type))} <span aria-hidden="true">×</span>
            </button>
          )}
          {agent !== "all" && (
            <button className="filter-chip" onClick={() => set("agent", "all")}>
              {t("filter.chipAgent", agent)} <span aria-hidden="true">×</span>
            </button>
          )}
          {tag !== "all" && (
            <button className="filter-chip" onClick={() => set("tag", "all")}>
              {t("filter.chipTag", tag)} <span aria-hidden="true">×</span>
            </button>
          )}
          {query.trim() && (
            <button className="filter-chip" onClick={clearQuery}>
              {t("filter.chipQuery", query.trim())} <span aria-hidden="true">×</span>
            </button>
          )}
          <button className="filter-clear" onClick={clearFilters}>
            {t("filter.clearAll")}
          </button>
        </div>
      )}

      {loading ? (
        <Skeleton rows={6} />
      ) : filtered.length === 0 ? (
        notes.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <path
                  d="M4 2.5 h5.5 l2.5 2.5 v8.5 h-8 z M9.5 2.5 v2.5 h2.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              </svg>
            }
            title={t("notes.empty.title")}
            hint={
              <>
                {t("notes.empty.hint")}
                <code className="empty-code">
                  agentmon note add --agent &lt;name&gt; --type memory --title "&lt;fact&gt;"
                  --description "&lt;one line&gt;" --body "…"
                </code>
              </>
            }
          />
        ) : (
          <EmptyState
            icon={
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <path
                  d="M10.2 10.2 L13.5 13.5"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            }
            title={t("notes.emptyFiltered.title")}
            hint={t("notes.emptyFiltered.hint", notes.length)}
            action={
              <button className="button" onClick={clearFilters}>
                {t("filter.clear")}
              </button>
            }
          />
        )
      ) : (
        <>
          <div className="work-list" style={{ "--agent-col": agentWidth } as CSSProperties}>
            <ul className="work-rows note-rows">
              {filtered.map((n, i) => (
                <li key={n.name}>
                  <Link
                    ref={(el) => {
                      rowRefs.current[i] = el;
                    }}
                    className={`work-row note-row${cursor === i ? " is-cursor" : ""}`}
                    to={`/p/${projectId}/notes/${n.name}`}
                    onMouseEnter={() => setCursor(i)}
                    onFocus={() => setCursor(i)}
                    {...contextMenu(() =>
                      recordMenu({ kind: "note", id: n.name, title: n.title, projectId })
                    )}
                  >
                    <NoteTypeDot type={n.type} />
                    <span className="note-row-main">
                      <span className="note-row-head">
                        <span className="note-row-title" title={n.title}>
                          {n.title}
                        </span>
                        <span className="note-row-name mono" title={n.name}>
                          {n.name}
                        </span>
                      </span>
                      {/* The author's own hook — the line the CLI requires so this row can
                          exist. It is what an agent scans instead of opening the body. */}
                      <span className="note-row-desc" title={n.description}>
                        {n.description}
                      </span>
                    </span>
                    <RowTags note={n} />
                    <span className="work-row-agent">
                      {/* Whoever the current words belong to: the last rewriter, else the
                          author. This chip sits beside the *updated* time, and a shared,
                          mutable note under one fixed byline would credit A with what B
                          wrote. The author and the full trail are on the detail page. */}
                      <AgentChip name={n.updatedBy ?? n.agent} />
                    </span>
                    <time
                      className="work-row-time tabular"
                      dateTime={n.lastActivity}
                      title={t("dash.lastActivityTip", formatDateTimeUtc(n.lastActivity))}
                    >
                      {formatRelative(n.lastActivity)}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <p className="list-hints">
            <span className="list-hints-left">{t("notes.sortNote")}</span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t("keys.move")} · <kbd>↵</kbd> {t("keys.open")} · <kbd>/</kbd>{" "}
            {t("keys.search")}
          </p>
        </>
      )}
    </div>
  );
}

/** Tags, capped so a five-tag note cannot push the agent column around. */
function RowTags({ note }: { note: NoteSummary }) {
  if (!note.tags.length) return <span className="work-row-tags" />;
  const shown = note.tags.slice(0, MAX_TAGS);
  const rest = note.tags.length - shown.length;
  return (
    <span className="work-row-tags">
      {shown.map((t) => (
        <Tag key={t}>{t}</Tag>
      ))}
      {rest > 0 && (
        <span className="tag tag-more" title={note.tags.join(", ")}>
          +{rest}
        </span>
      )}
    </span>
  );
}
