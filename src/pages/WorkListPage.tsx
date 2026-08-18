/**
 * Every work record in the project, as a dense keyboard-driven list.
 *
 * Filtering is client-side and instant: the vault is small enough to hold in memory and
 * a round trip per keystroke would feel like a website. Rows are grouped by status so
 * "what is happening right now" is always the first thing on the screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useProjectSlug } from "../AppContext";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import {
  AgentChip,
  EmptyState,
  ErrorState,
  Skeleton,
  Tag,
  WorkStatusDot,
} from "../components/ui";
import { formatDateTimeUtc, formatRelative, pluralize, WORK_STATUS_LABEL } from "../lib/format";
import type { WorklogSummary, WorkStatus } from "../lib/types";

const STATUSES: (WorkStatus | "all")[] = ["all", "in_progress", "done", "abandoned"];
const STATUS_TEXT: Record<string, string> = { all: "All", ...WORK_STATUS_LABEL };
/** In progress first: the list answers "what is happening" before "what happened". */
const GROUP_ORDER: WorkStatus[] = ["in_progress", "done", "abandoned"];
const MAX_TAGS = 3;

export function WorkListPage() {
  const slug = useProjectSlug()!;
  const navigate = useNavigate();
  const { data, error, loading, reload } = useAsync(() => api.listWorklogs(slug), [slug]);

  const [status, setStatus] = useState<WorkStatus | "all">("all");
  const [agent, setAgent] = useState("all");
  const [tag, setTag] = useState("all");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(-1);

  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  const works = useMemo(() => data ?? [], [data]);

  const agents = useMemo(
    () => [...new Set(works.map((w) => w.agent))].sort((a, b) => a.localeCompare(b)),
    [works]
  );
  const tags = useMemo(
    () => [...new Set(works.flatMap((w) => w.tags))].sort((a, b) => a.localeCompare(b)),
    [works]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return works.filter((w) => {
      if (status !== "all" && w.status !== status) return false;
      if (agent !== "all" && w.agent !== agent) return false;
      if (tag !== "all" && !w.tags.includes(tag)) return false;
      if (!q) return true;
      return (
        w.title.toLowerCase().includes(q) ||
        w.id.toLowerCase().includes(q) ||
        w.agent.toLowerCase().includes(q) ||
        w.excerpt.toLowerCase().includes(q) ||
        w.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [works, status, agent, tag, query]);

  /** Grouped for display; `flat` is the same rows in screen order, for the keyboard. */
  const groups = useMemo(
    () =>
      GROUP_ORDER.map((s) => ({ status: s, items: filtered.filter((w) => w.status === s) })).filter(
        (g) => g.items.length > 0
      ),
    [filtered]
  );
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const filtersActive = status !== "all" || agent !== "all" || tag !== "all" || query.trim() !== "";
  const clearFilters = useCallback(() => {
    setStatus("all");
    setAgent("all");
    setTag("all");
    setQuery("");
  }, []);

  // A new result set invalidates the old cursor position.
  useEffect(() => setCursor(-1), [status, agent, tag, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");

      if (e.key === "Escape") {
        if (query) setQuery("");
        el?.blur();
        return;
      }
      if (!typing && (e.key === "/" || (e.key === "f" && (e.metaKey || e.ctrlKey)))) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      // Arrows belong to a <select> when one has focus; everywhere else they drive the list.
      if (el?.tagName === "SELECT") return;
      if (typing && e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
      if (!flat.length) return;

      const move = (delta: number) => {
        e.preventDefault();
        setCursor((c) => {
          const next = Math.min(flat.length - 1, Math.max(0, c < 0 ? 0 : c + delta));
          rowRefs.current[next]?.scrollIntoView({ block: "nearest" });
          return next;
        });
      };
      if (e.key === "ArrowDown" || (!typing && e.key === "j")) move(1);
      else if (e.key === "ArrowUp" || (!typing && e.key === "k")) move(-1);
      else if (e.key === "Enter" && cursor >= 0 && flat[cursor]) {
        e.preventDefault();
        navigate(`/p/${slug}/work/${flat[cursor].id}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flat, cursor, navigate, slug, query]);

  if (error) {
    return (
      <div className="page">
        <ErrorState message={error} onRetry={reload} />
      </div>
    );
  }

  const inProgress = works.filter((w) => w.status === "in_progress").length;
  let rowIndex = -1;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Work</h1>
          <p className="page-sub">
            What every agent did, why they did it, and how it went — one record per unit of work.
          </p>
        </div>
        <div className="page-head-meta tabular">
          {loading
            ? "loading…"
            : `${pluralize(works.length, "record")}${inProgress ? ` · ${inProgress} in progress` : ""}`}
        </div>
      </header>

      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label="Filter by status">
          {STATUSES.map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={status === s}
              className={`segment${status === s ? " is-active" : ""}`}
              onClick={() => setStatus(s)}
            >
              {STATUS_TEXT[s]}
              <span className="segment-count tabular">
                {s === "all" ? works.length : works.filter((w) => w.status === s).length}
              </span>
            </button>
          ))}
        </div>

        <div className="toolbar-right">
          <select
            className="select"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            aria-label="Filter by agent"
          >
            <option value="all">All agents</option>
            {agents.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            aria-label="Filter by tag"
          >
            <option value="all">All tags</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
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
              placeholder="Search work"
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search work logs"
            />
            {!query && <kbd className="search-kbd">/</kbd>}
          </div>
        </div>
      </div>

      {filtersActive && (
        <div className="filter-summary">
          <span className="filter-count tabular">
            {pluralize(filtered.length, "match", "matches")}
          </span>
          {status !== "all" && (
            <button className="filter-chip" onClick={() => setStatus("all")}>
              Status: {STATUS_TEXT[status]} <span aria-hidden="true">×</span>
            </button>
          )}
          {agent !== "all" && (
            <button className="filter-chip" onClick={() => setAgent("all")}>
              Agent: {agent} <span aria-hidden="true">×</span>
            </button>
          )}
          {tag !== "all" && (
            <button className="filter-chip" onClick={() => setTag("all")}>
              Tag: {tag} <span aria-hidden="true">×</span>
            </button>
          )}
          {query.trim() && (
            <button className="filter-chip" onClick={() => setQuery("")}>
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
            title="No work recorded yet"
            hint={
              <>
                Agents open a record before they start, so the reasoning is written down while it
                is still true:
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
            title="No work matches these filters"
            hint={`${pluralize(works.length, "record")} in this project, none of them matching all of the filters above.`}
            action={
              <button className="button" onClick={clearFilters}>
                Clear filters
              </button>
            }
          />
        )
      ) : (
        <>
          <div className="work-list">
            {groups.map((group) => (
              <section className="work-group" key={group.status}>
                <header className="work-group-head">
                  <WorkStatusDot status={group.status} />
                  <h2 className="work-group-title">{WORK_STATUS_LABEL[group.status]}</h2>
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
                            title={`Last activity ${formatDateTimeUtc(w.lastActivity)}`}
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
            <kbd>↑</kbd>
            <kbd>↓</kbd> move · <kbd>↵</kbd> open · <kbd>/</kbd> search
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
