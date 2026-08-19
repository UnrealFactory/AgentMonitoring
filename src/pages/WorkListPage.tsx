/**
 * Every work log in the project, as a dense keyboard-driven list.
 *
 * Filtering is client-side and instant (the vault is small enough to hold in memory and a
 * round trip per keystroke would feel like a website) and lives in the URL, so Back out of
 * a work log returns to the list as it was left and a filtered view can be linked to. Rows
 * are grouped by status — in progress, done, abandoned, the three words this app uses for
 * work everywhere (lib/words.ts) — so "what is happening right now" is always the first
 * thing on the screen. Search reads the whole work log — What, Why, How, every update and
 * the outcome — not just the line the row shows.
 */
import { useCallback, useMemo, useRef, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useProjectSlug, useVaultNonce } from "../AppContext";
import { agentColumnWidth } from "../lib/columns";
import { api, failureTitle } from "../lib/api";
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
  Skeleton,
  Tag,
  WorkStatusDot,
} from "../components/ui";
import { formatDateTimeUtc, formatRelative } from "../lib/format";
import { t } from "../lib/i18n";
import { inProgress, workLogs, workStatusLabel } from "../lib/words";
import type { WorklogSummary, WorkStatus } from "../lib/types";

/** The dimensions a filter slices on — and therefore the ones a count can be exempt from. */
type Dim = "status" | "agent" | "tag";

const STATUSES: (WorkStatus | "all")[] = ["all", "in_progress", "done", "abandoned"];
/** The tab's word: the app's one word for the state, or "All" for the tab that is not one. */
const statusText = (status: string): string =>
  status === "all" ? t("filter.all") : workStatusLabel(status as WorkStatus);
/** In progress first: the list answers "what is happening" before "what happened". */
const GROUP_ORDER: WorkStatus[] = ["in_progress", "done", "abandoned"];
const MAX_TAGS = 3;

/** Filters, and their defaults; anything at its default stays out of the URL. */
const DEFAULTS = { status: "all", agent: "all", tag: "all", q: "" };
const ALLOWED = { status: ["all", ...GROUP_ORDER] } as const;

export function WorkListPage() {
  const slug = useProjectSlug()!;
  const {
    data,
    error,
    status: httpStatus,
    loading,
    reload,
  } = useAsync(() => api.listWorklogs(slug), [slug], useVaultNonce());

  const searchRef = useRef<HTMLInputElement>(null);
  /** Right-click (or Shift+F10) on a row: open it, or take its id, title or link. */
  const contextMenu = useContextMenu();
  const recordMenu = useRecordMenu();

  const works = useMemo(() => data ?? [], [data]);

  /**
   * What the menus offer, taken from the whole project so the list does not shrink under
   * the cursor as filters change. The counts beside them are scoped to the view (`facet`).
   */
  const agents = useMemo(
    () => [...new Set(works.map((w) => w.agent))].sort((a, b) => a.localeCompare(b)),
    [works]
  );
  const tags = useMemo(
    () => [...new Set(works.flatMap((w) => w.tags))].sort((a, b) => a.localeCompare(b)),
    [works]
  );

  /**
   * An agent or tag the project has never heard of is treated the way `?status=banana`
   * already was: as not set. A pasted link that outlived the record it filtered on shows
   * the whole list, rather than an empty one under menus that all say "All".
   */
  const allowed = useMemo(
    () => ({ ...ALLOWED, agent: ["all", ...agents], tag: ["all", ...tags] }),
    [agents, tags]
  );

  const { values, set, reset, isDirty } = useUrlFilters(DEFAULTS, allowed);
  const status = values.status as WorkStatus | "all";
  const { agent, tag, q: query } = values;

  /** Sized for the names in this project; `chrome` is the avatar and its gap. */
  const agentWidth = useMemo(() => agentColumnWidth(agents, { chrome: 26, min: 96 }), [agents]);

  /**
   * Search reads the record, not the row: What/Why/How, every update and the outcome
   * (`searchText`, built by the vault reader), plus the fields the row shows. Lower-cased
   * once per load rather than once per keystroke.
   */
  const haystacks = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of works) {
      map.set(
        w.id,
        [w.id, w.title, w.agent, ...w.tags, ...w.files, w.searchText]
          .join(" ")
          .toLowerCase()
      );
    }
    return map;
  }, [works]);

  /**
   * One predicate, with the ability to leave one dimension out of it (BUG-0005).
   * A count printed *on* a control must count what choosing that control would give, with
   * every other filter still applied — otherwise "Done 9" sits above a Done group of 2, or
   * the agent menu offers "nova 4" on a tab holding one of nova's records, and the screen
   * states two different numbers for the same set.
   */
  const matches = useCallback(
    (w: WorklogSummary, skip: Dim | null = null) => {
      if (skip !== "status" && status !== "all" && w.status !== status) return false;
      if (skip !== "agent" && agent !== "all" && w.agent !== agent) return false;
      if (skip !== "tag" && tag !== "all" && !w.tags.includes(tag)) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (haystacks.get(w.id) ?? "").includes(q);
    },
    [status, agent, tag, query, haystacks]
  );

  /** How many rows picking `value` on `dim` would leave: the one number a menu may print. */
  const facet = useCallback(
    (dim: Dim, has: (w: WorklogSummary) => boolean) =>
      works.filter((w) => has(w) && matches(w, dim)).length,
    [works, matches]
  );

  const filtered = useMemo(() => works.filter((w) => matches(w)), [works, matches]);

  /** What each status tab would show if it were the one selected. */
  const statusCounts = useMemo(() => {
    const scope = works.filter((w) => matches(w, "status"));
    const counts: Record<string, number> = { all: scope.length };
    for (const s of GROUP_ORDER) counts[s] = scope.filter((w) => w.status === s).length;
    return counts;
  }, [works, matches]);

  /** Grouped for display; `flat` is the same rows in screen order, for the keyboard. */
  const groups = useMemo(
    () =>
      GROUP_ORDER.map((s) => ({ status: s, items: filtered.filter((w) => w.status === s) })).filter(
        (g) => g.items.length > 0
      ),
    [filtered]
  );
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const filtersActive = isDirty();
  const clearFilters = useCallback(() => reset(), [reset]);
  const clearQuery = useCallback(() => set("q", ""), [set]);
  const href = useCallback((w: WorklogSummary) => `/p/${slug}/work/${w.id}`, [slug]);
  const { cursor, setCursor, rowRefs } = useListKeyboard({
    items: flat,
    href,
    searchRef,
    query,
    onClearQuery: clearQuery,
    resetKey: `${status}|${agent}|${tag}|${query}`,
  });

  if (error) {
    return (
      <div className="page">
        <ErrorState
          title={failureTitle(error, httpStatus)}
          message={error}
          onRetry={httpStatus === 404 ? undefined : reload}
          action={
            <Link className="button" to="/projects">
              {t("nav.allProjects")}
            </Link>
          }
        />
      </div>
    );
  }

  const runningCount = works.filter((w) => w.status === "in_progress").length;
  let rowIndex = -1;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">{t("work.title")}</h1>
          <p className="page-sub">{t("work.sub")}</p>
        </div>
        <div className="page-head-meta tabular">
          {loading
            ? t("app.loadingShort")
            : `${workLogs(works.length)}${runningCount ? ` · ${runningCount} ${inProgress()}` : ""}`}
        </div>
      </header>

      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label={t("filter.byStatus")}>
          {STATUSES.map((s) => (
            <button
              key={s}
              role="tab"
              data-value={s}
              aria-selected={status === s}
              className={`segment${status === s ? " is-active" : ""}`}
              onClick={() => set("status", s)}
            >
              {statusText(s)}
              <span className="segment-count tabular">{statusCounts[s] ?? 0}</span>
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
                hint: facet("agent", (w) => w.agent === a),
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
                hint: facet("tag", (w) => w.tags.includes(t)),
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
              placeholder={t("work.searchPlaceholder")}
              onChange={(e) => set("q", e.target.value)}
              aria-label={t("work.searchLabel")}
            />
            {!query && <kbd className="search-kbd">/</kbd>}
          </div>
        </div>
      </div>

      {filtersActive && (
        <div className="filter-summary">
          <span className="filter-count tabular">{t("filter.matches", filtered.length)}</span>
          {status !== "all" && (
            <button className="filter-chip" onClick={() => set("status", "all")}>
              {t("filter.chipStatus", statusText(status))} <span aria-hidden="true">×</span>
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
      ) : flat.length === 0 ? (
        works.length === 0 ? (
          <EmptyState
            icon={
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <path
                  d="M3 3.5 H13 M3 8 H13 M3 12.5 H9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            }
            title={t("work.empty.title")}
            hint={
              <>
                {t("work.empty.hint")}
                <code className="empty-code">
                  agentmon work start -p {slug} --agent &lt;name&gt; --title &lt;title&gt;
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
            title={t("work.emptyFiltered.title")}
            hint={t("work.emptyFiltered.hint", works.length)}
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
            {groups.map((group) => (
              <section className="work-group" key={group.status}>
                <header className="work-group-head">
                  <WorkStatusDot status={group.status} />
                  <h2 className="work-group-title">{workStatusLabel(group.status)}</h2>
                  <span className="work-group-count tabular">{group.items.length}</span>
                </header>
                <ul className="work-rows">
                  {group.items.map((w) => {
                    rowIndex += 1;
                    const i = rowIndex;
                    return (
                      <li key={w.id}>
                        <Link
                          ref={(el) => {
                            rowRefs.current[i] = el;
                          }}
                          className={`work-row${cursor === i ? " is-cursor" : ""}`}
                          to={`/p/${slug}/work/${w.id}`}
                          onMouseEnter={() => setCursor(i)}
                          onFocus={() => setCursor(i)}
                          {...contextMenu(() =>
                            recordMenu({ kind: "work", id: w.id, title: w.title, slug })
                          )}
                        >
                          <WorkStatusDot status={w.status} />
                          <span className="work-row-id mono">{w.id}</span>
                          {/* the title is the only thing a row may ellipsise, so it
                              carries the full text for the one row in ten that does */}
                          <span className="work-row-title" title={w.title}>
                            {w.title}
                          </span>
                          <RowTags work={w} />
                          <span className="work-row-agent">
                            <AgentChip name={w.agent} />
                          </span>
                          <time
                            className="work-row-time tabular"
                            dateTime={w.lastActivity}
                            title={t("dash.lastActivityTip", formatDateTimeUtc(w.lastActivity))}
                          >
                            {formatRelative(w.lastActivity)}
                          </time>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          <p className="list-hints">
            <span className="list-hints-left">{t("work.sortNote")}</span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t("keys.move")} · <kbd>↵</kbd> {t("keys.open")} · <kbd>/</kbd>{" "}
            {t("keys.search")}
          </p>
        </>
      )}
    </div>
  );
}

/** Tags, capped so a five-tag record cannot push the agent column around. */
function RowTags({ work }: { work: WorklogSummary }) {
  if (!work.tags.length) return <span className="work-row-tags" />;
  const shown = work.tags.slice(0, MAX_TAGS);
  const rest = work.tags.length - shown.length;
  return (
    <span className="work-row-tags">
      {shown.map((t) => (
        <Tag key={t}>{t}</Tag>
      ))}
      {rest > 0 && (
        <span className="tag tag-more" title={work.tags.join(", ")}>
          +{rest}
        </span>
      )}
    </span>
  );
}
