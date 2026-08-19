/**
 * The bug board: every defect in the project, what state it is in, how bad it is, and who
 * is holding it.
 *
 * It is a triage screen first and an archive second, so the defaults are triage defaults:
 * it opens on the bugs that still need somebody, sorts them by severity and then by
 * recency, and puts the severity pill in the first column where the eye lands. Filtering is
 * client-side and instant — the vault is small enough to hold in memory, and a round trip
 * per keystroke would feel like a website rather than an app — but it is *kept* in the URL,
 * so Back, reload and a pasted link all reproduce the view (see lib/useUrlFilters).
 *
 * Two words for two different things, which used to be one word for both: the tabs slice
 * the board by whether a bug still needs somebody (**Unresolved** / Resolved / All), and
 * the group headings name the exact status underneath — Open, In progress, Resolved,
 * Closed, the four words this app uses for a bug everywhere (lib/words.ts).
 *
 * The tab is deliberately *not* called "Open". It holds two states, and spending the name
 * of one of them on the pair is what put an "Open 5" tab above an "Open 3" group — and,
 * worse, a claimed bug under a heading that said nobody had it.
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
import {
  BugStatusDot,
  CommentCount,
  EmptyState,
  ErrorState,
  Handoff,
  SeverityBadge,
  Skeleton,
  Tag,
} from "../components/ui";
import { formatDateTimeUtc, formatRelative, pluralize } from "../lib/format";
import {
  BUG_STATUS_LABEL,
  bugCount,
  SEVERITY_LABEL,
  UNASSIGNED,
  UNASSIGNED_LABEL,
  UNRESOLVED,
  UNRESOLVED_LABEL,
  UNRESOLVED_MEANS,
} from "../lib/words";
import type { BugStatus, BugSummary, Severity } from "../lib/types";

type Tab = "unresolved" | "resolved" | "all";
/**
 * The dimensions a filter can slice on — and therefore the ones a count can be *exempt*
 * from. A count printed on a control must not be filtered by that control (see `matches`).
 */
type Dim = "tab" | "severity" | "label" | "assignee" | "reporter";

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
/** Open first, and inside the unresolved half the ones nobody holds come first. */
const GROUP_ORDER: BugStatus[] = ["open", "in_progress", "resolved", "closed"];
/** Group headings: the status itself, in the app's one word for it. */
const GROUP_LABEL = BUG_STATUS_LABEL;
const MAX_LABELS = 2;

/** Filters, and their defaults; anything at its default stays out of the URL. */
const DEFAULTS = {
  tab: "unresolved",
  severity: "all",
  label: "all",
  assignee: "all",
  reporter: "all",
  q: "",
};
const ALLOWED = {
  tab: ["unresolved", "resolved", "all"],
  severity: ["all", ...SEVERITIES],
} as const;

const isUnresolvedStatus = (s: BugStatus) => s === "open" || s === "in_progress";
const isUnresolved = (b: BugSummary) => isUnresolvedStatus(b.status);

/** What the row's time column measures: how old, or how long since it was resolved. */
const rowTime = (b: BugSummary) =>
  isUnresolved(b) ? b.created : (b.resolved ?? b.lastActivity);

/**
 * The footer describes the sort of what is actually on the screen — on the All tab that is
 * two different sorts, and a note claiming one of them is a note the reader can catch out.
 */
function sortNote(groups: { status: BugStatus }[]): string {
  const unresolved = groups.some((g) => isUnresolvedStatus(g.status));
  const settled = groups.some((g) => !isUnresolvedStatus(g.status));
  if (unresolved && settled) {
    return "Unresolved bugs sort by severity, then by when they were filed; the rest by when they were resolved.";
  }
  if (unresolved) return "Sorted by severity, then by how recently they were filed.";
  return "Sorted by when they were resolved, newest first.";
}

export function BugsPage() {
  const slug = useProjectSlug()!;
  const {
    data,
    error,
    status: httpStatus,
    loading,
    reload,
  } = useAsync(() => api.listBugs(slug), [slug], useVaultNonce());

  const searchRef = useRef<HTMLInputElement>(null);
  const bugs = useMemo(() => data ?? [], [data]);
  /** The project's own numbers, ignoring the filters — for the page header. */
  const totalUnresolved = bugs.filter(isUnresolved).length;

  /**
   * The values each menu offers, taken from the whole project rather than the current view:
   * a menu that drops entries as you filter is a menu that moves under the cursor, and
   * "quill 0" is a more useful answer than a missing line. The *counts* are scoped (below).
   */
  const labels = useMemo(
    () => [...new Set(bugs.flatMap((b) => b.labels))].sort((a, b) => a.localeCompare(b)),
    [bugs]
  );
  const assignees = useMemo(
    () =>
      [...new Set(bugs.map((b) => b.assignee).filter((a): a is string => !!a))].sort((a, b) =>
        a.localeCompare(b)
      ),
    [bugs]
  );
  const reporters = useMemo(
    () => [...new Set(bugs.map((b) => b.reporter))].sort((a, b) => a.localeCompare(b)),
    [bugs]
  );

  /**
   * The same list the menus offer is the list the URL is checked against. `?label=frontend`
   * in a project with no frontend label is a stale or hand-typed link, and the honest
   * answer to it is the unfiltered board — the same answer `?tab=banana` already got.
   * Without this the board silently showed nothing while every control claimed to be off.
   */
  const allowed = useMemo(
    () => ({
      ...ALLOWED,
      label: ["all", ...labels],
      assignee: ["all", "none", ...assignees],
      reporter: ["all", ...reporters],
    }),
    [labels, assignees, reporters]
  );

  const { values, set, reset, isDirty } = useUrlFilters(DEFAULTS, allowed);
  const tab = values.tab as Tab;
  const severity = values.severity as Severity | "all";
  const { label, assignee, reporter, q: query } = values;
  const setTab = useCallback((t: Tab) => set("tab", t), [set]);

  /**
   * The handoff column is sized for the names this project actually uses — `nova` and a
   * board of `p0-foundation-builder` cannot share one width. Computed from every bug rather
   * than the filtered ones, so the column does not twitch while somebody types in search.
   * `chrome` is the two avatars, the arrow and their gaps, measured: 62px.
   */
  const peopleWidth = useMemo(
    () => agentColumnWidth(bugs.map((b) => b.assignee ?? "unassigned"), { chrome: 62, min: 118 }),
    [bugs]
  );

  /**
   * Search reaches the whole record, not the row: the report, every comment in the thread
   * and the resolution (`searchText`, built by the vault reader), plus the fields the row
   * shows. A reader who remembers `pg_stat_activity` from a bug's repro steps types that,
   * not the title they have forgotten. Lower-cased once per load rather than per keystroke.
   */
  const haystacks = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of bugs) {
      map.set(
        b.id,
        [b.id, b.title, b.reporter, b.assignee ?? "", ...b.labels, b.searchText]
          .join(" ")
          .toLowerCase()
      );
    }
    return map;
  }, [bugs]);

  /**
   * One predicate, with the ability to leave one dimension out of it.
   *
   * A count shown *on* a control must not be filtered by that control, and must count what
   * choosing that control would actually put on the screen — every other filter still
   * applied. "Open 2 / Resolved 6" answers "how many will I see if I switch tabs"; the
   * severity chips and the severity menu answer "how many if I pick this one". That is how
   * facet counts work everywhere a human has met them, and the alternative is a control
   * that promises four rows and delivers one (round 3).
   */
  const matches = useCallback(
    (b: BugSummary, skip: Dim | null = null) => {
      if (skip !== "tab" && tab !== "all" && isUnresolved(b) !== (tab === "unresolved"))
        return false;
      if (skip !== "severity" && severity !== "all" && b.severity !== severity) return false;
      if (skip !== "label" && label !== "all" && !b.labels.includes(label)) return false;
      if (
        skip !== "assignee" &&
        assignee !== "all" &&
        (b.assignee ?? "") !== (assignee === "none" ? "" : assignee)
      )
        return false;
      if (skip !== "reporter" && reporter !== "all" && b.reporter !== reporter) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (haystacks.get(b.id) ?? "").includes(q);
    },
    [tab, severity, label, assignee, reporter, query, haystacks]
  );

  /** How many rows picking `value` on `dim` would leave: the one number a menu may print. */
  const facet = useCallback(
    (dim: Dim, has: (b: BugSummary) => boolean) =>
      bugs.filter((b) => has(b) && matches(b, dim)).length,
    [bugs, matches]
  );

  const tabCounts = useMemo(() => {
    const scope = bugs.filter((b) => matches(b, "tab"));
    const unresolved = scope.filter(isUnresolved).length;
    return { unresolved, resolved: scope.length - unresolved, all: scope.length };
  }, [bugs, matches]);

  /**
   * One array, two controls: the chip row under the toolbar and the severity menu inside it
   * are the same four numbers, so they cannot drift apart the way they did in round 3.
   */
  const severityCounts = useMemo(
    () =>
      SEVERITIES.map((s) => ({ severity: s, count: facet("severity", (b) => b.severity === s) })),
    [facet]
  );

  const filtered = useMemo(() => bugs.filter((b) => matches(b)), [bugs, matches]);

  /**
   * Grouped by state; open groups sort by severity then recency (a critical filed today
   * outranks a low filed today, and a critical filed today outranks one from last week),
   * closed groups sort by when they were closed.
   */
  const groups = useMemo(
    () =>
      GROUP_ORDER.map((status) => ({
        status,
        items: filtered
          .filter((b) => b.status === status)
          .sort((a, b) =>
            isUnresolved(a)
              ? SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
                rowTime(b).localeCompare(rowTime(a))
              : rowTime(b).localeCompare(rowTime(a))
          ),
      })).filter((g) => g.items.length > 0),
    [filtered]
  );
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  /** The tab is not a filter here: it is which half of the board you are looking at. */
  const filtersActive = isDirty(["tab"]);

  // The tab survives "clear filters": it is the view, not a filter on it.
  const clearFilters = useCallback(() => reset(["tab"]), [reset]);

  const clearQuery = useCallback(() => set("q", ""), [set]);
  const href = useCallback((b: BugSummary) => `/p/${slug}/bugs/${b.id}`, [slug]);
  const { cursor, setCursor, rowRefs } = useListKeyboard({
    items: flat,
    href,
    searchRef,
    query,
    onClearQuery: clearQuery,
    resetKey: `${tab}|${severity}|${label}|${assignee}|${reporter}|${query}`,
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
              All projects
            </Link>
          }
        />
      </div>
    );
  }

  let rowIndex = -1;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Bugs</h1>
          <p className="page-sub">
            Every defect an agent found, who owns it now, and how each one was resolved.
          </p>
        </div>
        <div
          className="page-head-meta tabular"
          title={loading ? undefined : `Unresolved means ${UNRESOLVED_MEANS}`}
        >
          {loading
            ? "loading…"
            : `${bugCount(bugs.length)} · ${
                totalUnresolved ? `${totalUnresolved} ${UNRESOLVED}` : `none ${UNRESOLVED}`
              }`}
        </div>
      </header>

      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label="Filter by status">
          {/* Each tab says which statuses it holds, so the one word on it never has to
              stand in for two. */}
          <button
            role="tab"
            data-value="unresolved"
            aria-selected={tab === "unresolved"}
            className={`segment${tab === "unresolved" ? " is-active" : ""}`}
            onClick={() => setTab("unresolved")}
            title={`Bugs that are ${UNRESOLVED_MEANS}`}
          >
            <span className="sdot sdot-bug-open" aria-hidden="true" />
            {UNRESOLVED_LABEL}
            <span className="segment-count tabular">{tabCounts.unresolved}</span>
          </button>
          <button
            role="tab"
            data-value="resolved"
            aria-selected={tab === "resolved"}
            className={`segment${tab === "resolved" ? " is-active" : ""}`}
            onClick={() => setTab("resolved")}
            title="Bugs that are resolved or closed"
          >
            <span className="sdot sdot-bug-resolved" aria-hidden="true" />
            Resolved<span className="segment-count tabular">{tabCounts.resolved}</span>
          </button>
          <button
            role="tab"
            data-value="all"
            aria-selected={tab === "all"}
            className={`segment${tab === "all" ? " is-active" : ""}`}
            onClick={() => setTab("all")}
            title="Every bug ever filed in this project"
          >
            All<span className="segment-count tabular">{tabCounts.all}</span>
          </button>
        </div>

        <div className="toolbar-right">
          <Select
            label="Filter by severity"
            value={severity}
            onChange={(v) => set("severity", v)}
            options={[
              { value: "all", label: "All severities" },
              ...severityCounts.map(({ severity: s, count }) => ({
                value: s,
                label: SEVERITY_LABEL[s],
                hint: count,
              })),
            ]}
          />
          <Select
            label="Filter by label"
            value={label}
            onChange={(v) => set("label", v)}
            options={[
              { value: "all", label: "All labels" },
              ...labels.map((l) => ({
                value: l,
                label: l,
                hint: facet("label", (b) => b.labels.includes(l)),
              })),
            ]}
          />
          <Select
            label="Filter by assignee"
            value={assignee}
            onChange={(v) => set("assignee", v)}
            options={[
              { value: "all", label: "All assignees" },
              {
                value: "none",
                label: UNASSIGNED_LABEL,
                hint: facet("assignee", (b) => !b.assignee),
              },
              ...assignees.map((a) => ({
                value: a,
                label: a,
                hint: facet("assignee", (b) => b.assignee === a),
              })),
            ]}
          />
          <Select
            label="Filter by reporter"
            value={reporter}
            onChange={(v) => set("reporter", v)}
            options={[
              { value: "all", label: "All reporters" },
              ...reporters.map((r) => ({
                value: r,
                label: r,
                hint: facet("reporter", (b) => b.reporter === r),
              })),
            ]}
          />
          <div className="search">
            <svg className="search-icon" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M10.2 10.2 L13.5 13.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
            <input
              ref={searchRef}
              className="input search-input"
              type="search"
              value={query}
              placeholder="Search bugs"
              onChange={(e) => set("q", e.target.value)}
              aria-label="Search bugs"
            />
            {!query && <kbd className="search-kbd">/</kbd>}
          </div>
        </div>
      </div>

      {!loading && bugs.length > 0 && (
        <div className="sev-bar" aria-label="Severity breakdown">
          {severityCounts.map(({ severity: s, count }) => (
            <button
              key={s}
              data-value={s}
              className={`sev-chip sev-chip-${s}${severity === s ? " is-active" : ""}${
                count === 0 ? " is-zero" : ""
              }`}
              onClick={() => set("severity", severity === s ? "all" : s)}
              aria-pressed={severity === s}
              title={`${count} ${SEVERITY_LABEL[s].toLowerCase()}-severity ${
                count === 1 ? "bug" : "bugs"
              } in this tab`}
            >
              <span className="sev-chip-dot" aria-hidden="true" />
              <span className="sev-chip-label">{SEVERITY_LABEL[s]}</span>
              <span className="sev-chip-count tabular">{count}</span>
            </button>
          ))}
        </div>
      )}

      {filtersActive && (
        <div className="filter-summary">
          <span className="filter-count tabular">
            {pluralize(filtered.length, "match", "matches")}
          </span>
          {severity !== "all" && (
            <button className="filter-chip" onClick={() => set("severity", "all")}>
              Severity: {SEVERITY_LABEL[severity]} <span aria-hidden="true">×</span>
            </button>
          )}
          {label !== "all" && (
            <button className="filter-chip" onClick={() => set("label", "all")}>
              Label: {label} <span aria-hidden="true">×</span>
            </button>
          )}
          {assignee !== "all" && (
            <button className="filter-chip" onClick={() => set("assignee", "all")}>
              Assignee: {assignee === "none" ? UNASSIGNED : assignee}{" "}
              <span aria-hidden="true">×</span>
            </button>
          )}
          {reporter !== "all" && (
            <button className="filter-chip" onClick={() => set("reporter", "all")}>
              Reporter: {reporter} <span aria-hidden="true">×</span>
            </button>
          )}
          {query.trim() && (
            <button className="filter-chip" onClick={clearQuery}>
              “{query.trim()}” <span aria-hidden="true">×</span>
            </button>
          )}
          <button className="filter-clear" onClick={clearFilters}>
            Clear all
          </button>
        </div>
      )}

      {loading ? (
        <Skeleton rows={6} />
      ) : flat.length === 0 ? (
        <BoardEmpty
          slug={slug}
          total={bugs.length}
          tab={tab}
          filtersActive={filtersActive}
          unresolvedCount={totalUnresolved}
          resolvedCount={bugs.length - totalUnresolved}
          onClear={clearFilters}
          onSwitchTab={setTab}
        />
      ) : (
        <>
          <div className="work-list" style={{ "--people-col": peopleWidth } as CSSProperties}>
            {groups.map((group) => (
              <section className="work-group" key={group.status}>
                <header className="work-group-head">
                  <BugStatusDot status={group.status} />
                  <h2 className="work-group-title">{GROUP_LABEL[group.status]}</h2>
                  <span className="work-group-count tabular">{group.items.length}</span>
                  {group.items.length > 1 && (
                    <span className="work-group-note">
                      {isUnresolvedStatus(group.status)
                        ? "severity, then newest"
                        : "newest first"}
                    </span>
                  )}
                </header>
                <ul className="work-rows">
                  {group.items.map((b) => {
                    rowIndex += 1;
                    const i = rowIndex;
                    return (
                      <li key={b.id}>
                        <Link
                          ref={(el) => {
                            rowRefs.current[i] = el;
                          }}
                          className={`work-row bug-row${cursor === i ? " is-cursor" : ""}`}
                          to={`/p/${slug}/bugs/${b.id}`}
                          onMouseEnter={() => setCursor(i)}
                          onFocus={() => setCursor(i)}
                        >
                          <span className="bug-row-sev">
                            <SeverityBadge severity={b.severity} />
                          </span>
                          <span className="work-row-id mono">{b.id}</span>
                          <span className="work-row-title" title={b.title}>
                            {b.title}
                          </span>
                          <RowLabels bug={b} />
                          <span className="bug-row-people">
                            <Handoff from={b.reporter} to={b.assignee} />
                          </span>
                          <span className="bug-row-comments">
                            <CommentCount count={b.commentCount} />
                          </span>
                          <time
                            className="work-row-time tabular"
                            dateTime={rowTime(b)}
                            title={
                              isUnresolved(b)
                                ? `Filed ${formatDateTimeUtc(b.created)} · last activity ${formatDateTimeUtc(b.lastActivity)}`
                                : `Resolved ${formatDateTimeUtc(b.resolved ?? b.lastActivity)} · filed ${formatDateTimeUtc(b.created)}`
                            }
                          >
                            {formatRelative(rowTime(b))}
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
            <span className="list-hints-left">{sortNote(groups)}</span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move · <kbd>↵</kbd> open · <kbd>/</kbd> search
          </p>
        </>
      )}
    </div>
  );
}

/** Labels, capped so a five-label bug cannot push the people column around. */
function RowLabels({ bug }: { bug: BugSummary }) {
  if (!bug.labels.length) return <span className="work-row-tags" />;
  const shown = bug.labels.slice(0, MAX_LABELS);
  const rest = bug.labels.length - shown.length;
  return (
    <span className="work-row-tags">
      {shown.map((l) => (
        <Tag key={l}>{l}</Tag>
      ))}
      {rest > 0 && (
        <span className="tag tag-more" title={bug.labels.join(", ")}>
          +{rest}
        </span>
      )}
    </span>
  );
}

/**
 * Three different nothings, told apart: an empty project, a filter that matches nothing,
 * and the good one — a board with no open bugs left.
 */
function BoardEmpty({
  slug,
  total,
  tab,
  filtersActive,
  unresolvedCount,
  resolvedCount,
  onClear,
  onSwitchTab,
}: {
  slug: string;
  total: number;
  tab: Tab;
  filtersActive: boolean;
  unresolvedCount: number;
  resolvedCount: number;
  onClear: () => void;
  onSwitchTab: (tab: Tab) => void;
}) {
  if (total === 0) {
    return (
      <EmptyState
        icon={
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path
              d="M8 3.2a2.4 2.4 0 0 1 2.4 2.4v3.2A2.4 2.4 0 0 1 8 11.2a2.4 2.4 0 0 1-2.4-2.4V5.6A2.4 2.4 0 0 1 8 3.2Z M3 6.2h2.6 M10.4 6.2H13 M3 9.4h2.6 M10.4 9.4H13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        }
        title="No bugs filed"
        hint={
          <>
            Agents file a bug the moment they find one, with the repro in the body so the next
            agent can reproduce it without asking:
            <code className="empty-code">
              agentmon bug create -p {slug} --agent &lt;name&gt; --severity high --title &lt;title&gt;
            </code>
          </>
        }
      />
    );
  }

  if (!filtersActive && tab === "unresolved") {
    return (
      <EmptyState
        icon={
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path
              d="M3.5 8.5 L6.5 11.5 L12.5 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        }
        title="Nothing unresolved"
        hint={`Every one of the ${bugCount(resolvedCount)} filed in this project has been resolved, and each one carries the written fix.`}
        action={
          <button className="button" onClick={() => onSwitchTab("resolved")}>
            Read the resolved ones
          </button>
        }
      />
    );
  }

  if (!filtersActive && tab === "resolved") {
    return (
      <EmptyState
        icon={
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M8 5.2v3.2l2 1.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        }
        title="Nothing resolved yet"
        hint={`${bugCount(unresolvedCount)} unresolved in this project. A bug leaves this tab when an agent writes the fix into it with \`agentmon bug resolve\`.`}
        action={
          <button className="button" onClick={() => onSwitchTab("unresolved")}>
            Show the unresolved ones
          </button>
        }
      />
    );
  }

  return (
    <EmptyState
      icon={
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M10.2 10.2 L13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      }
      title="No bugs match these filters"
      hint={`${bugCount(total)} in this project, none of them matching all of the filters above.`}
      action={
        <button className="button" onClick={onClear}>
          Clear filters
        </button>
      }
    />
  );
}
