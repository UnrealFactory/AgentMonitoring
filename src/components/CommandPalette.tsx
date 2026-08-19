/**
 * Ctrl/Cmd+K — the whole app from the keyboard.
 *
 * Three kinds of thing, in the order somebody in a hurry wants them: the work log or bug
 * they can half-remember (by id or by title), the project they want to be in, and the
 * screen they want to be on. Records are read once per vault change, for **every** project
 * rather than only the one in the URL — the palette used to be opened from /projects, where
 * it offered two projects and one screen and then told the reader to "try a record id",
 * advice that screen could not honour. After the first open everything is answered from
 * memory, so typing never waits on the vault.
 *
 * **The meta column says what each of its values is.** Ids are per-project by SPEC, so a
 * search for "WORK-2" on /p/relay/work returns two rows both headed WORK-0002 — and the
 * only thing telling them apart used to be one unlabelled slot holding "quill · done" on
 * one and "AgentMonitoring · done" on the other, which asks the reader to know that quill
 * is an agent and AgentMonitoring is a project (P5 critic). Each part now carries its own
 * class, its own colour and, for the project, the folder glyph the nav uses for one.
 *
 * Deliberately small: it navigates, it does not act. Nothing in this app is destructive
 * enough to need a command surface, and a palette that can quietly change data is a palette
 * people stop trusting with their fingers.
 *
 * **It is a modal, and it behaves like one.** The three keys printed along its bottom edge
 * work wherever the focus is, because they are handled on `window` in the capture phase for
 * as long as it is open — not on the search input, which is what it used to do: one Tab put
 * focus on a result row, and from there esc did nothing while the arrows drove the list
 * screen *behind* the scrim and ↵ navigated it. The results are not tab stops at all now;
 * they are options the input points at with `aria-activedescendant`, the way a combobox is
 * supposed to work. Tab is trapped, focus goes back where it came from on close, and the
 * modal lock (src/lib/modal.ts) tells the list screens' own key handler to stand down.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useApp } from "../AppContext";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import {
  bugStatusLabel,
  severityLabel,
  unresolvedCount,
  workLogs,
  workStatusLabel,
} from "../lib/words";
import { trapTab, useModalLock } from "../lib/modal";
import type { BugSummary, Project, WorklogSummary } from "../lib/types";
/* The avatar's monogram is the avatar's, wherever it is drawn: one function, so a Korean
   handle cannot wear two different marks on two screens (components/ui.tsx). */
import { agentInitials } from "./ui";

/** Fire this from anywhere in the app (the sidebar's search button) to open the palette. */
export const PALETTE_EVENT = "agentmon:palette";

export const openPalette = () => window.dispatchEvent(new CustomEvent(PALETTE_EVENT));

/** How many records the default (empty-query) menu shows. */
const DEFAULT_RECORDS = 6;

/** The id `aria-activedescendant` points at — the option is not focused, it is named. */
const optionId = (i: number) => `palette-option-${i}`;

/** One labelled fact in a row's meta column: what it is decides how it is drawn. */
type MetaPart =
  | { kind: "project"; text: string }
  | { kind: "agent"; text: string }
  | { kind: "severity"; text: string }
  | { kind: "state"; text: string }
  | { kind: "count"; text: string };

/** The three kinds of thing, as keys. Their headings are words, and words are translated. */
type Group = "records" | "projects" | "pages";

const GROUP_LABEL: Record<Group, () => string> = {
  records: () => t("palette.groupRecords"),
  projects: () => t("palette.groupProjects"),
  pages: () => t("palette.groupGoTo"),
};

interface Item {
  id: string;
  group: Group;
  label: string;
  hint?: string;
  meta?: MetaPart[];
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

/** What each kind of meta value is, for the tooltip and the screen reader. */
const META_KIND: Record<MetaPart["kind"], () => string> = {
  project: () => t("palette.metaProject"),
  agent: () => t("palette.metaAgent"),
  severity: () => t("palette.metaSeverity"),
  state: () => t("palette.metaState"),
  count: () => "",
};

/**
 * The meta column: one span per fact, each saying what kind of fact it is.
 *
 * Two of these are names of things a reader may never have heard of — "relay" and "nova"
 * are the same shape of word — and they used to share one slot, told apart only by a folder
 * glyph on one and a tint on the other (P5 design critic). So each value now carries the
 * mark its kind wears everywhere else in the app: a project has the nav's folder, an agent
 * has the initials avatar off every byline and row, a severity is a severity word and a
 * state is the word the lists use. The kind is also in the part's tooltip and, for a reader
 * on a screen reader, in the text — "nova (agent)" — because a glyph is not a label.
 */
function Meta({ parts }: { parts: MetaPart[] }) {
  return (
    <span className="palette-meta">
      {parts.map((part, i) => (
        <Fragment key={`${part.kind}-${part.text}`}>
          {i > 0 && (
            <span className="palette-meta-sep" aria-hidden="true">
              ·
            </span>
          )}
          <span
            className={`palette-meta-part is-${part.kind}`}
            title={META_KIND[part.kind]() ? `${META_KIND[part.kind]()}: ${part.text}` : undefined}
          >
            {part.kind === "project" && (
              <svg className="palette-meta-icon" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M2.5 4.5 h4 l1.2 1.6 h5.8 v6.4 h-11 z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            {part.kind === "agent" && (
              <span className="palette-meta-avatar" aria-hidden="true">
                {agentInitials(part.text)}
              </span>
            )}
            {part.text}
            {META_KIND[part.kind]() && (
              <span className="sr-only"> ({META_KIND[part.kind]()})</span>
            )}
          </span>
        </Fragment>
      ))}
    </span>
  );
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
  const dialogRef = useRef<HTMLDivElement>(null);
  /** Whatever had the keyboard when the palette opened, to hand it back on close. */
  const returnFocus = useRef<HTMLElement | null>(null);

  const slug = location.pathname.startsWith("/p/")
    ? location.pathname.split("/")[2]
    : undefined;

  const close = useCallback(() => setOpen(false), []);

  /** Open what the highlight is on, and get out of the way. */
  const run = useCallback(
    (item: Item | undefined) => {
      if (!item) return;
      setOpen(false);
      navigate(item.to);
    },
    [navigate]
  );

  // Every screen-level key handler in the app asks this first (src/lib/modal.ts).
  useModalLock(open);

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
    if (!open) {
      // Back where it came from — the row, the search box or the nav link the reader was on.
      const back = returnFocus.current;
      returnFocus.current = null;
      if (back && back.isConnected) back.focus();
      return;
    }
    const el = document.activeElement;
    returnFocus.current = el instanceof HTMLElement && el !== document.body ? el : null;
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
      const add = (r: WorklogSummary | BugSummary, kind: "work" | "bug", meta: MetaPart[]) => {
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
          group: "records",
          label: r.title,
          hint: r.id,
          meta: here ? meta : [{ kind: "project", text: project.name } as MetaPart, ...meta],
          to: `/p/${project.slug}/${kind === "work" ? "work" : "bugs"}/${r.id}`,
          score: s,
          kind,
        });
      };
      /* Inside the project the reader is standing in there is room for who has it; from
         the vault screen that room goes to the project name, which is the fact that stops
         them guessing. */
      /* The state and the severity are the app's own words for them (lib/words.ts), not the
         raw enum with its underscore taken out: a palette row that says `in_progress` over a
         board that says 진행 중 is the vocabulary breaking at the one surface that reaches
         every screen. */
      for (const w of works) {
        add(w, "work", [
          ...(here ? [{ kind: "agent", text: w.agent } as MetaPart] : []),
          { kind: "state", text: workStatusLabel(w.status) },
        ]);
      }
      for (const b of bugs) {
        add(b, "bug", [
          ...(here ? [{ kind: "severity", text: severityLabel(b.severity) } as MetaPart] : []),
          { kind: "state", text: bugStatusLabel(b.status) },
        ]);
      }
    }

    for (const p of projects) {
      const s = Math.max(score(p.name, q), score(p.slug, q));
      if (s > 0) {
        out.push({
          id: `project:${p.slug}`,
          group: "projects",
          label: p.name,
          hint: p.slug,
          meta: [
            { kind: "count", text: workLogs(p.counts.workTotal) },
            { kind: "count", text: unresolvedCount(p.counts.bugsOpen) },
          ],
          to: `/p/${p.slug}`,
          score: s + (p.slug === slug ? 5 : 0),
        });
      }
    }

    const pages: { label: string; to: string; hint?: string }[] = [
      ...(slug
        ? [
            { label: t("nav.dashboard"), to: `/p/${slug}`, hint: slug },
            { label: t("nav.work"), to: `/p/${slug}/work`, hint: slug },
            { label: t("nav.bugs"), to: `/p/${slug}/bugs`, hint: slug },
          ]
        : []),
      { label: t("nav.projects"), to: "/projects" },
    ];
    for (const page of pages) {
      const s = score(page.label, q);
      if (s > 0) {
        out.push({
          id: `page:${page.to}`,
          group: "pages",
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
    const order: Record<Group, number> = { records: 0, projects: 1, pages: 2 };
    const byScore = out.sort((a, b) => b.score - a.score);
    const topRecords = byScore
      .filter((i) => i.group === "records")
      .slice(0, q ? 20 : DEFAULT_RECORDS);
    const rest = byScore.filter((i) => i.group !== "records");
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

  /**
   * A modal that cannot be dismissed from the keyboard is not a modal, so its keys are bound
   * to the **window, in the capture phase**, for as long as it is open: they are answered
   * before anything below can see them, wherever the focus happens to be, and
   * `stopPropagation` keeps them off the screen behind the scrim. Bound to the input alone —
   * as they were — one Tab was enough to leave a dialog that esc could not close and arrows
   * that drove the list underneath.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      const move = (delta: number) =>
        setActive((i) => (items.length ? (i + delta + items.length) % items.length : 0));

      switch (e.key) {
        case "Escape":
          handled();
          close();
          return;
        case "ArrowDown":
          handled();
          move(1);
          return;
        case "ArrowUp":
          handled();
          move(-1);
          return;
        case "Home":
          handled();
          setActive(0);
          return;
        case "End":
          handled();
          setActive(Math.max(0, items.length - 1));
          return;
        case "Enter":
          handled();
          run(items[active]);
          return;
        case "Tab": {
          // Tab used to walk straight out of an aria-modal dialog into the sidebar behind it.
          const root = dialogRef.current;
          if (root && trapTab(root, e.shiftKey)) handled();
          return;
        }
        default:
          // A character typed while the focus has drifted (a click on the scrim, say)
          // belongs in the query box, which is the only thing here that takes typing.
          if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
            if (!dialogRef.current?.contains(document.activeElement)) inputRef.current?.focus();
          }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, items, active, close, run]);

  /* The other half of the trap: focus that lands outside the dialog by any route the keys
     do not cover (a click on the scrim's padding, the window coming back) comes home. */
  useEffect(() => {
    if (!open) return;
    const onFocusIn = (e: FocusEvent) => {
      const root = dialogRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) inputRef.current?.focus();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open]);

  if (!open) return null;

  const searchable = (records?.loaded ?? []).reduce(
    (n, l) => n + l.works.length + l.bugs.length,
    0
  );
  let lastGroup: Group | null = null;

  return (
    <div className="palette-scrim" onMouseDown={close} role="presentation">
      <div
        className="palette"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.title")}
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
          {/* A combobox over a listbox: the input keeps the focus and *names* the
              highlighted option, so the arrows can move a highlight the reader can see
              without the focus ever leaving the box they are typing in. */}
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls="palette-results"
            aria-autocomplete="list"
            aria-activedescendant={items.length ? optionId(active) : undefined}
            aria-label={t("palette.inputLabel")}
            placeholder={t("palette.placeholder")}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {items.length === 0 ? (
          <p className="palette-empty">
            {/* What the palette can actually search, said in numbers — the advice used to be
                "try a record id" on a screen where no record was loaded. */}
            {t("palette.noMatch", query)}{" "}
            {searchable > 0
              ? t("palette.searching", searchable, projects.length)
              : t("palette.nothingLoaded")}
          </p>
        ) : (
          <ul
            className="palette-list"
            ref={listRef}
            id="palette-results"
            role="listbox"
            aria-label={t("palette.results")}
          >
            {items.map((item, i) => {
              const head = item.group !== lastGroup ? item.group : null;
              lastGroup = item.group;
              /* Options, not buttons. A button here is a tab stop, and tab stops inside a
                 modal are how the focus got out of it in the first place. */
              return (
                <Fragment key={item.id}>
                  {head && (
                    <li className="palette-group" role="presentation">
                      {GROUP_LABEL[head]()}
                    </li>
                  )}
                  <li
                    id={optionId(i)}
                    className={`palette-item${i === active ? " is-active" : ""}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={() => run(item)}
                  >
                    {item.kind && (
                      <span className={`palette-kind is-${item.kind}`}>
                        {item.kind === "bug" ? t("palette.kindBug") : t("palette.kindWork")}
                      </span>
                    )}
                    <span className="palette-label">{item.label}</span>
                    {item.hint && <span className="palette-hint mono">{item.hint}</span>}
                    {item.meta && <Meta parts={item.meta} />}
                  </li>
                </Fragment>
              );
            })}
          </ul>
        )}

        <footer className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t("palette.move")}
          </span>
          <span>
            <kbd>↵</kbd> {t("palette.open")}
          </span>
          <span>
            <kbd>esc</kbd> {t("palette.close")}
          </span>
        </footer>
      </div>
    </div>
  );
}
