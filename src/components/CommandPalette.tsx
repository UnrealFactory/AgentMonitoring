/**
 * Ctrl/Cmd+K — the whole app from the keyboard.
 *
 * Three kinds of thing, in the order somebody in a hurry wants them: the record they can
 * half-remember (by id or by title), the project they want to be in, and the screen they
 * want to be on. Records are read once per vault change, for **every** project rather than
 * only the one in the URL — the palette used to be opened from /projects, where it offered
 * two projects and one screen and then told the reader to "try a record id", advice that
 * screen could not honour. After the first open everything is answered from memory, so
 * typing never waits on the vault.
 *
 * Deliberately small: it navigates, it does not act. Nothing in this app is destructive
 * enough to need a command surface, and a palette that can quietly change data is a palette
 * people stop trusting with their fingers.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useApp } from "../AppContext";
import { api } from "../lib/api";
import { pluralize } from "../lib/format";
import type { BugSummary, Project, WorklogSummary } from "../lib/types";

/** Fire this from anywhere in the app (the sidebar's search button) to open the palette. */
export const PALETTE_EVENT = "agentmon:palette";

export const openPalette = () => window.dispatchEvent(new CustomEvent(PALETTE_EVENT));

/** How many records the default (empty-query) menu shows. */
const DEFAULT_RECORDS = 6;

interface Item {
  id: string;
  group: "Records" | "Projects" | "Go to";
  label: string;
  hint?: string;
  meta?: string;
  to: string;
  /** How well it matched the query; higher sorts first inside its group. */
  score: number;
  kind?: "work" | "bug";
}

/** One project's records, as the palette holds them. */
interface Loaded {
  project: Project;
  works: WorklogSummary[];
  bugs: BugSummary[];
}

/** Word-start beats mid-word; a prefix beats both. 0 means "not a match". */
function score(text: string, query: string): number {
  if (!query) return 1;
  const haystack = text.toLowerCase();
  const i = haystack.indexOf(query);
  if (i < 0) return 0;
  if (i === 0) return 100 - Math.min(50, text.length / 4);
  return (/[\s\-_/]/.test(haystack[i - 1]) ? 60 : 30) - Math.min(20, i / 4);
}

/** "w12", "work 12", "WORK-0012", "12" → the id a record would have. */
function idGuesses(query: string): string[] {
  const m = /^(work|bug|w|b)?[\s-]*0*(\d{1,8})$/.exec(query.trim());
  if (!m) return [];
  const n = m[2].padStart(4, "0");
  const kind = m[1]?.[0];
  if (kind === "w") return [`WORK-${n}`];
  if (kind === "b") return [`BUG-${n}`];
  return [`WORK-${n}`, `BUG-${n}`];
}

export function CommandPalette() {
  const { projects, vaultNonce } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [records, setRecords] = useState<{ nonce: number; key: string; loaded: Loaded[] } | null>(
    null
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const slug = location.pathname.startsWith("/p/")
    ? location.pathname.split("/")[2]
    : undefined;

  const close = useCallback(() => setOpen(false), []);

  // Ctrl/Cmd+K anywhere, including from inside a search box — and the same key closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onEvent = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(PALETTE_EVENT, onEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(PALETTE_EVENT, onEvent);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  }, [open]);

  /* Every project's records, read once per vault change. Two requests per project on the
     first open of a session — a vault has a handful of projects, and the alternative is a
     search box that can only see the folder the URL happens to name. */
  const key = projects.map((p) => p.slug).join(",");
  useEffect(() => {
    if (!open || !projects.length) return;
    if (records?.key === key && records.nonce === vaultNonce) return;
    let cancelled = false;
    Promise.all(
      projects.map(async (project) => {
        try {
          const [works, bugs] = await Promise.all([
            api.listWorklogs(project.slug),
            api.listBugs(project.slug),
          ]);
          return { project, works, bugs };
        } catch {
          // One project mid-write (or with a record that will not parse) must not take
          // the other projects' records out of the palette with it.
          return { project, works: [], bugs: [] };
        }
      })
    )
      .then((loaded) => {
        if (!cancelled) setRecords({ nonce: vaultNonce, key, loaded });
      })
      .catch(() => {
        /* the palette still switches projects and screens without them */
      });
    return () => {
      cancelled = true;
    };
  }, [open, key, vaultNonce, projects, records?.key, records?.nonce]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const out: Item[] = [];
    const ids = idGuesses(q);

    /* With no query the palette is a menu, and a menu of the vault's most recent records is
       the useful default. It used to score every record 1 and push the work logs in first,
       so a bug filed a minute ago could never reach it: five work logs, every time. */
    const recency = new Map<string, number>();
    if (records) {
      const all: { id: string; slug: string; at: string }[] = [];
      for (const { project, works, bugs } of records.loaded) {
        for (const w of works) all.push({ id: w.id, slug: project.slug, at: w.lastActivity });
        for (const b of bugs) all.push({ id: b.id, slug: project.slug, at: b.lastActivity });
      }
      all.sort((a, b) => b.at.localeCompare(a.at));
      all.forEach((r, i) => recency.set(`${r.slug}/${r.id}`, all.length - i));
    }

    for (const { project, works, bugs } of records?.loaded ?? []) {
      const here = project.slug === slug;
      /* Inside a project the useful second fact is who has it; from the vault screen it is
         which project it is in — the two together do not fit on one row and would cut the
         project name in half, which is the fact that stops the reader guessing. */
      const add = (r: WorklogSummary | BugSummary, kind: "work" | "bug", meta: string) => {
        const byId = ids.includes(r.id) ? 200 : score(r.id, q);
        const byTitle = score(r.title, q);
        let s = Math.max(byId, byTitle);
        if (s <= 0) return;
        // An empty query ranks by when the record last moved, not by which kind it is.
        if (!q) s = recency.get(`${project.slug}/${r.id}`) ?? 0;
        // A tie between two projects goes to the one the reader is standing in.
        if (here) s += q ? 4 : 0.5;
        out.push({
          id: `${project.slug}/${r.id}`,
          group: "Records",
          label: r.title,
          hint: r.id,
          meta: here ? meta : `${project.name} · ${meta}`,
          to: `/p/${project.slug}/${kind === "work" ? "work" : "bugs"}/${r.id}`,
          score: s,
          kind,
        });
      };
      for (const w of works) {
        add(w, "work", here ? `${w.agent} · ${w.status.replace("_", " ")}` : w.status.replace("_", " "));
      }
      for (const b of bugs) {
        add(b, "bug", here ? `${b.severity} · ${b.status.replace("_", " ")}` : b.status.replace("_", " "));
      }
    }

    for (const p of projects) {
      const s = Math.max(score(p.name, q), score(p.slug, q));
      if (s > 0) {
        out.push({
          id: `project:${p.slug}`,
          group: "Projects",
          label: p.name,
          hint: p.slug,
          meta: `${pluralize(p.counts.workTotal, "log")} · ${p.counts.bugsOpen} open`,
          to: `/p/${p.slug}`,
          score: s + (p.slug === slug ? 5 : 0),
        });
      }
    }

    const pages: { label: string; to: string; hint?: string }[] = [
      ...(slug
        ? [
            { label: "Dashboard", to: `/p/${slug}`, hint: slug },
            { label: "Work", to: `/p/${slug}/work`, hint: slug },
            { label: "Bugs", to: `/p/${slug}/bugs`, hint: slug },
          ]
        : []),
      { label: "Projects", to: "/projects" },
    ];
    for (const page of pages) {
      const s = score(page.label, q);
      if (s > 0) {
        out.push({
          id: `page:${page.to}`,
          group: "Go to",
          label: page.label,
          hint: page.hint,
          to: page.to,
          score: s,
        });
      }
    }

    /* On an empty query the record group is capped: enough to make the shape obvious, and
       it leaves the projects and the screens on screen instead of pushing them under
       thirty rows nobody asked for. */
    const order = { Records: 0, Projects: 1, "Go to": 2 } as const;
    const byScore = out.sort((a, b) => b.score - a.score);
    const topRecords = byScore
      .filter((i) => i.group === "Records")
      .slice(0, q ? 20 : DEFAULT_RECORDS);
    const rest = byScore.filter((i) => i.group !== "Records");
    return [...topRecords, ...rest].sort(
      (a, b) => order[a.group] - order[b.group] || b.score - a.score
    );
  }, [query, projects, records, slug]);

  useEffect(() => setActive(0), [query]);

  // Keep the highlighted row in view when the arrows walk past the fold.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(".palette-item.is-active")?.scrollIntoView({
      block: "nearest",
    });
  }, [active, items.length]);

  if (!open) return null;

  const run = (item: Item | undefined) => {
    if (!item) return;
    close();
    navigate(item.to);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (items.length ? (i + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(items[active]);
    }
  };

  const searchable = (records?.loaded ?? []).reduce(
    (n, l) => n + l.works.length + l.bugs.length,
    0
  );
  let lastGroup: Item["group"] | null = null;

  return (
    <div className="palette-scrim" onMouseDown={close} role="presentation">
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="palette-input-row">
          <svg className="palette-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z M10.4 10.4 L13.5 13.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            aria-label="Search records, projects and screens"
            placeholder="Record id or title, project, screen…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>

        {items.length === 0 ? (
          <p className="palette-empty">
            {/* What the palette can actually search, said in numbers — the advice used to be
                "try a record id" on a screen where no record was loaded. */}
            Nothing matches “{query}”.{" "}
            {searchable > 0
              ? `Searching ${pluralize(searchable, "record")} across ${pluralize(
                  projects.length,
                  "project"
                )} by id (WORK-12) and by title.`
              : "No records are loaded yet — this vault has none, or they could not be read."}
          </p>
        ) : (
          <ul className="palette-list" ref={listRef} role="listbox" aria-label="Results">
            {items.map((item, i) => {
              const head = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              return (
                <li key={item.id}>
                  {head && <p className="palette-group">{head}</p>}
                  <button
                    className={`palette-item${i === active ? " is-active" : ""}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={() => run(item)}
                  >
                    {item.kind && <span className={`palette-kind is-${item.kind}`}>{item.kind}</span>}
                    <span className="palette-label">{item.label}</span>
                    {item.hint && <span className="palette-hint mono">{item.hint}</span>}
                    {item.meta && <span className="palette-meta">{item.meta}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <footer className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </footer>
      </div>
    </div>
  );
}
