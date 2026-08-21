/**
 * The shell's left column: which project, which screen.
 *
 * Two rules it has to keep, both learned from critics:
 *
 *   * **Say a thing once.** The app is named at the top, the reader's place is named by
 *     the switcher, and the Projects screen owns every path.
 *   * **Never leave the column empty.** Off a project — on /projects — the nav used to hold
 *     a single row. The registered projects are always listed, so there is somewhere to go
 *     from every screen, and the list doubles as the switcher's flat form.
 */
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useApp, useCurrentProject, useDataNonce } from "../AppContext";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { openPalette } from "./CommandPalette";
import { useContextMenu } from "./ContextMenu";
import { useProjectMenu } from "../lib/menus";
import {
  bugTip,
  bugTipHere,
  inProgressOf,
  unresolvedCount,
  workLogs,
  workTip,
  workTipHere,
} from "../lib/words";
import { t } from "../lib/i18n";
import { AppUpdate } from "./AppUpdate";
import { LocaleToggle } from "./LocaleToggle";
import type { Project } from "../lib/types";

/** How many projects the nav lists before it stops and points at the Projects screen. */
const NAV_PROJECT_LIMIT = 8;

const AppMark = () => (
  <svg className="brand-mark" viewBox="0 0 100 100" aria-hidden="true">
    <path
      d="M6 66 L26 66 L36 40 L50 78 L62 26 L72 66 L94 66"
      fill="none"
      stroke="currentColor"
      strokeWidth="10"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export function Sidebar() {
  const { projects, transport } = useApp();
  const current = useCurrentProject();
  /* The App feedback board's open count. Errors stay silent here — the board's own page
     reports them; a column of navigation is no place for a load failure. */
  const feedback = useAsync(() => api.listAppFeedback(), [], useDataNonce());
  const feedbackOpen = (feedback.data ?? []).filter((f) => f.status === "open").length;
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  /* Right-click (and Shift+F10) on anything in this column that names a project — the
     switcher card, the rows in its dropdown, the vault list under Projects — opens the same
     menu the Projects screen's rows do. The reader should not have to remember which of the
     three lists they are looking at, nor find that one copy of a project answers and
     another does not. */
  const contextMenu = useContextMenu();
  const projectMenu = useProjectMenu();
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** The menu's items in screen order, for the arrow keys. */
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  /* A role="menu" whose arrows do nothing is a menu in name only. Opening puts the keyboard
     on the project you are standing in; ↑ ↓ walk the list, Home/End jump, esc closes and
     gives the button back its focus, Tab leaves the way it does in every other menu. */
  useEffect(() => {
    if (!menuOpen) return;
    const items = () =>
      itemRefs.current.filter((el): el is HTMLButtonElement => !!el && el.isConnected);
    const focusAt = (i: number) => {
      const list = items();
      if (list.length) list[(i + list.length) % list.length].focus();
    };
    const current = itemRefs.current.findIndex(
      (el) => el?.classList.contains("is-current") ?? false
    );
    focusAt(Math.max(0, current));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (!menuRef.current?.contains(document.activeElement)) return;
      const list = items();
      const at = list.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        focusAt(at + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        focusAt(at - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        focusAt(0);
      } else if (e.key === "End") {
        e.preventDefault();
        focusAt(list.length - 1);
      } else if (e.key === "Tab") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const base = current ? `/p/${current.id}` : undefined;
  /* Every readable registered project, and no filter in front of it. Archiving is gone
     (P12): a project you have finished with is removed from the list or deleted, not
     filed away. Unavailable rows (an unplugged drive) live on the Projects screen, which
     can explain them; a nav row that goes nowhere belongs nowhere. */
  const switchable: Project[] = projects;
  const listed = switchable.slice(0, NAV_PROJECT_LIMIT);

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-badge">
          <AppMark />
        </span>
        <span className="brand-text">
          <span className="brand-name">AgentMonitoring</span>
        </span>
      </div>

      <div className="project-switcher" ref={menuRef}>
        <button
          className="switcher-button"
          ref={buttonRef}
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          /* The card that names the project you are standing in is the first project row a
             reader meets, and it was the only one the right button did nothing on: the
             switcher's *dropdown* items and the vault list below both had this menu, so the
             same project answered 300px lower down and not here (P8 round 2 critic). Off a
             project — "All projects" on /projects — there is no one project to act on, so
             there is no menu and the browser's stays suppressed. */
          {...contextMenu(() => (current ? projectMenu(current) : null))}
        >
          <span className="switcher-label">
            <span className="switcher-name">{current?.name ?? t("nav.allProjects")}</span>
            {/* One measure, in the app's words, with what it is out of. The bug number is
                on the Bugs row three lines below — printing it here too, in a second
                vocabulary, is how one fact came to have four names in one column. */}
            <span
              className="switcher-meta tabular"
              title={
                current
                  ? `${workTip(current.counts.workTotal, current.counts.workInProgress)} · ${bugTip(
                      current.counts.bugsOpen,
                      current.counts.bugsTotal
                    )}`
                  : undefined
              }
            >
              {!current
                ? t("proj.count", projects.length)
                : current.counts.workTotal === 0
                  ? t("nav.noWorkYet")
                  : inProgressOf(current.counts.workInProgress, current.counts.workTotal)}
            </span>
          </span>
          <svg className="switcher-caret" viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M3 4.5 L6 7.5 L9 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {menuOpen && (
          <div className="switcher-menu" role="menu">
            {switchable.map((p, i) => (
              <button
                key={p.id}
                role="menuitem"
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                className={`switcher-item${p.id === current?.id ? " is-current" : ""}`}
                onClick={() => navigate(`/p/${p.id}`)}
                {...contextMenu(() => projectMenu(p))}
              >
                <span className="switcher-item-name">{p.name}</span>
                {/* Both numbers, both named: a bare "12" beside a bare "2" invites the
                    reader to compare two things that are not the same measure. */}
                <span
                  className="switcher-item-meta tabular"
                  title={`${workTip(p.counts.workTotal, p.counts.workInProgress, p.name)} · ${bugTip(
                    p.counts.bugsOpen,
                    p.counts.bugsTotal
                  )}`}
                >
                  {workLogs(p.counts.workTotal)}
                  {p.counts.bugsOpen > 0 && ` · ${unresolvedCount(p.counts.bugsOpen)}`}
                </span>
              </button>
            ))}
            <div className="switcher-sep" />
            <button
              role="menuitem"
              ref={(el) => {
                itemRefs.current[switchable.length] = el;
              }}
              className="switcher-item"
              onClick={() => navigate("/projects")}
            >
              <span className="switcher-item-name">{t("nav.manageProjects")}</span>
            </button>
          </div>
        )}
      </div>

      <button className="sidebar-search" onClick={openPalette} title={t("nav.searchTip")}>
        <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z M10.4 10.4 L13.5 13.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        {t("nav.search")}
        <kbd className="sidebar-kbd">Ctrl K</kbd>
      </button>

      <nav className="nav" aria-label={t("app.mainNav")}>
        {/* The three project screens only exist inside a project: pointing them at "/" when
            there is no current one gives a reader three links that all go somewhere else. */}
        {current && base && (
          <>
            {/* Not the project's name: the switcher two rows up already says it, and the
                list below marks it again — three copies of one word in a 232px column is
                the defect this shell was pulled up for. */}
            <p className="nav-section" title={current.name}>
              {t("nav.project")}
            </p>
            <NavLink to={base} end className="nav-item">
              <NavIcon name="dashboard" />
              {t("nav.dashboard")}
            </NavLink>
            <NavLink to={`${base}/work`} className="nav-item">
              <NavIcon name="work" />
              {t("nav.work")}
              {/* "Work 12" and "Bugs 2" used to sit here identically styled while counting
                  different things — every work log ever written against only the bugs that
                  still need somebody. Each count now says which it is. */}
              {current.counts.workTotal > 0 && (
                <span
                  className="nav-count tabular"
                  title={workTip(current.counts.workTotal, current.counts.workInProgress)}
                >
                  {current.counts.workTotal}
                </span>
              )}
            </NavLink>
            <NavLink to={`${base}/bugs`} className="nav-item">
              <NavIcon name="bug" />
              {t("nav.bugs")}
              {current.counts.bugsOpen > 0 && (
                <span
                  className="nav-count nav-count-open tabular"
                  title={bugTipHere(current.counts.bugsOpen, current.counts.bugsTotal)}
                >
                  {unresolvedCount(current.counts.bugsOpen)}
                </span>
              )}
            </NavLink>
            <NavLink to={`${base}/notes`} className="nav-item">
              <NavIcon name="notes" />
              {t("nav.notes")}
              {current.counts.notesTotal > 0 && (
                <span
                  className="nav-count tabular"
                  title={t("word.noteTipHere", current.counts.notesTotal)}
                >
                  {current.counts.notesTotal}
                </span>
              )}
            </NavLink>
          </>
        )}

        <p className="nav-section">{t("nav.vault")}</p>
        <NavLink to="/projects" className="nav-item">
          <NavIcon name="projects" />
          {t("nav.projects")}
          <span className="nav-count tabular" title={t("nav.projectCount", projects.length)}>
            {projects.length}
          </span>
        </NavLink>

        {/* A list of places in the vault, not a second set of screen links — so these mark
            themselves with aria-current="location" (where you are in the vault) and leave
            "page" to the nav item above that names the screen you are actually on. As
            NavLinks they matched by prefix, so standing on /p/relay/work lit both "Work" and
            "Relay" as the current page: two rows, two claims, one reader. */}
        {listed.map((p) => (
          <Link
            key={p.id}
            to={`/p/${p.id}`}
            className={`nav-item nav-sub${p.id === current?.id ? " is-current" : ""}`}
            aria-current={p.id === current?.id ? "location" : undefined}
            title={`${p.name} — ${workTipHere(
              p.counts.workTotal,
              p.counts.workInProgress
            )} · ${bugTip(p.counts.bugsOpen, p.counts.bugsTotal)}`}
            {...contextMenu(() => projectMenu(p))}
          >
            <span className="nav-bullet" aria-hidden="true" />
            <span className="nav-sub-name">{p.name}</span>
            {/* One measure only, and it says which: a bare number here would be the third
                different denominator in this column. */}
            {p.counts.bugsOpen > 0 && (
              <span
                className="nav-count nav-count-open tabular"
                title={bugTip(p.counts.bugsOpen, p.counts.bugsTotal, p.name)}
              >
                {unresolvedCount(p.counts.bugsOpen)}
              </span>
            )}
          </Link>
        ))}
        {/* Deliberately a plain link, not a NavLink: it points at the Projects screen, and
            a NavLink would mark itself current there — so standing on /projects lit two rows
            at once and the shell told the reader they were in two places. It is a pointer to
            the rest of the list, not a second name for where you are. */}
        {switchable.length > listed.length && (
          <Link
            to="/projects"
            className="nav-item nav-sub nav-more"
            title={t("nav.moreTip", switchable.length)}
          >
            <span className="nav-bullet" aria-hidden="true" />
            <span className="nav-sub-name">
              {t("nav.moreOnProjects", switchable.length - listed.length)}
            </span>
          </Link>
        )}

        {/* About the app itself, not any project — which is why it sits at the section's
            end rather than among the project rows above. */}
        <NavLink to="/app-feedback" className="nav-item">
          <NavIcon name="feedback" />
          {t("nav.appFeedback")}
          {feedbackOpen > 0 && (
            <span
              className="nav-count nav-count-open tabular"
              title={t("nav.appFeedbackTip", feedbackOpen)}
            >
              {feedbackOpen}
            </span>
          )}
        </NavLink>
      </nav>

      <div className="sidebar-foot">
        {/* A newer release of the app itself, when there is one — desktop only, silent
            otherwise (src/components/AppUpdate.tsx). First in the foot: it is news about
            the app the foot describes, and it leaves when acted on. */}
        <AppUpdate />
        {/* The language, where a reader looks for it: at the bottom of the shell, under the
            vault it names. One control, two words, applied to the whole window on click
            (src/components/LocaleToggle.tsx). */}
        <LocaleToggle />
        {/* Where the projects are managed, one click away. Every path is on the Projects
            screen, which is where the reader can act on them. A plain Link: as a NavLink
            this footer marked itself the current page on /projects, which lit two rows in
            one column at once. */}
        <Link className="vault-path" to="/projects" title={t("nav.projectCount", projects.length)}>
          <svg className="vault-path-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M2.5 4.5 h4 l1.2 1.6 h5.8 v6.4 h-11 z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
          <span className="vault-path-text">
            <span className="vault-path-name">{t("proj.count", projects.length)}</span>
            <span className="vault-path-value">
              {transport === "tauri" ? t("vault.readerDesktop") : t("vault.readerBrowser")}
            </span>
          </span>
        </Link>
      </div>
    </aside>
  );
}

function NavIcon({ name }: { name: "dashboard" | "work" | "bug" | "notes" | "projects" | "feedback" }) {
  const paths: Record<string, string> = {
    dashboard: "M2.5 9.5 L6 5.5 L8.5 8 L13.5 3",
    work: "M3 3.5 H13 M3 8 H13 M3 12.5 H9",
    bug: "M8 3.5 a3 3 0 0 1 3 3 v3 a3 3 0 0 1 -6 0 v-3 a3 3 0 0 1 3 -3 z M3 7 H5 M11 7 H13 M3 11 H5 M11 11 H13",
    // A page with a folded corner — the same glyph the feed draws for a note event.
    notes: "M4 2.5 h5.5 l2.5 2.5 v8.5 h-8 z M9.5 2.5 v2.5 h2.5 M6 8 h4 M6 10.5 h4",
    projects: "M2.5 4.5 h4 l1.2 1.6 h5.8 v6.4 h-11 z",
    // A speech bubble: feedback is agents talking to the app's maintainer.
    feedback: "M2.5 3.5 h11 v7 h-6.5 l-2.5 2.5 v-2.5 h-2 z M5.5 7 h5",
  };
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={paths[name]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
