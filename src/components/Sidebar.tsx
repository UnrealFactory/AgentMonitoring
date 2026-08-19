/**
 * The shell's left column: which vault, which project, which screen.
 *
 * Two rules it has to keep, both learned from critics:
 *
 *   * **Say a thing once.** The brand, its subtitle and the footer all used to print the
 *     vault's name, with its path on screen twice at the same time — three copies of one
 *     word beside 668px of empty column. The app is named at the top, the vault is named at
 *     the bottom, and the Projects screen owns the path.
 *   * **Never leave the column empty.** Off a project — on /projects — the nav used to hold
 *     a single row. The vault's projects are always listed, so there is somewhere to go
 *     from every screen, and the list doubles as the switcher's flat form.
 */
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useApp, useCurrentProject } from "../AppContext";
import { openPalette } from "./CommandPalette";
import { useContextMenu } from "./ContextMenu";
import { useProjectMenu } from "../lib/menus";
import {
  bugTip,
  inProgressOf,
  unresolvedCount,
  workLogs,
  workTip,
} from "../lib/words";
import { pluralize } from "../lib/format";
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
  const { vault, projects, error, transport } = useApp();
  const current = useCurrentProject();
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

  const base = current ? `/p/${current.slug}` : undefined;
  const active = projects.filter((p) => p.status !== "archived");
  /* An archived project is still readable, and somebody standing on one must not find
     themselves in a place the switcher denies exists. It is listed while it is open. */
  const switchable: Project[] =
    current && current.status === "archived" ? [...active, current] : active;
  const listed = switchable.slice(0, NAV_PROJECT_LIMIT);
  /** The vault's own directory name — "…/Temp/vault-live-test" against "…/AgentMonitoring/vault". */
  const folder = vault?.path?.split(/[\\/]/).filter(Boolean).pop() ?? "";

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
            <span className="switcher-name">{current?.name ?? "All projects"}</span>
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
                ? pluralize(active.length, "project")
                : current.counts.workTotal === 0
                  ? "no work logs yet"
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
                key={p.slug}
                role="menuitem"
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                className={`switcher-item${p.slug === current?.slug ? " is-current" : ""}`}
                onClick={() => navigate(`/p/${p.slug}`)}
                {...contextMenu(() => projectMenu(p))}
              >
                <span className="switcher-item-name">
                  {p.name}
                  {p.status === "archived" && (
                    <span className="switcher-item-flag"> archived</span>
                  )}
                </span>
                {/* Both numbers, both named: a bare "12" beside a bare "2" invites the
                    reader to compare two things that are not the same measure. */}
                <span
                  className="switcher-item-meta tabular"
                  title={`${workTip(p.counts.workTotal, p.counts.workInProgress, `in ${p.name}`)} · ${bugTip(
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
              <span className="switcher-item-name">Manage projects…</span>
            </button>
          </div>
        )}
      </div>

      <button className="sidebar-search" onClick={openPalette} title="Search (Ctrl+K)">
        <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9z M10.4 10.4 L13.5 13.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        Search
        <kbd className="sidebar-kbd">Ctrl K</kbd>
      </button>

      <nav className="nav" aria-label="Main">
        {/* The three project screens only exist inside a project: pointing them at "/" when
            there is no current one gives a reader three links that all go somewhere else. */}
        {current && base && (
          <>
            {/* Not the project's name: the switcher two rows up already says it, and the
                list below marks it again — three copies of one word in a 232px column is
                the defect this shell was pulled up for. */}
            <p className="nav-section" title={current.name}>
              Project
            </p>
            <NavLink to={base} end className="nav-item">
              <NavIcon name="dashboard" />
              Dashboard
            </NavLink>
            <NavLink to={`${base}/work`} className="nav-item">
              <NavIcon name="work" />
              Work
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
              Bugs
              {current.counts.bugsOpen > 0 && (
                <span
                  className="nav-count nav-count-open tabular"
                  title={bugTip(current.counts.bugsOpen, current.counts.bugsTotal, "filed here")}
                >
                  {unresolvedCount(current.counts.bugsOpen)}
                </span>
              )}
            </NavLink>
          </>
        )}

        <p className="nav-section">Vault</p>
        <NavLink to="/projects" className="nav-item">
          <NavIcon name="projects" />
          Projects
          <span className="nav-count tabular" title={`${active.length} active projects`}>
            {active.length}
          </span>
        </NavLink>

        {/* A list of places in the vault, not a second set of screen links — so these mark
            themselves with aria-current="location" (where you are in the vault) and leave
            "page" to the nav item above that names the screen you are actually on. As
            NavLinks they matched by prefix, so standing on /p/relay/work lit both "Work" and
            "Relay" as the current page: two rows, two claims, one reader. */}
        {listed.map((p) => (
          <Link
            key={p.slug}
            to={`/p/${p.slug}`}
            className={`nav-item nav-sub${p.slug === current?.slug ? " is-current" : ""}`}
            aria-current={p.slug === current?.slug ? "location" : undefined}
            title={`${p.name} — ${workTip(
              p.counts.workTotal,
              p.counts.workInProgress,
              "here"
            )} · ${bugTip(p.counts.bugsOpen, p.counts.bugsTotal)}`}
            {...contextMenu(() => projectMenu(p))}
          >
            <span
              className={`nav-bullet${p.status === "archived" ? " is-archived" : ""}`}
              aria-hidden="true"
            />
            <span className="nav-sub-name">{p.name}</span>
            {/* One measure only, and it says which: a bare number here would be the third
                different denominator in this column. */}
            {p.counts.bugsOpen > 0 && (
              <span
                className="nav-count nav-count-open tabular"
                title={bugTip(p.counts.bugsOpen, p.counts.bugsTotal, `filed in ${p.name}`)}
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
            title={`This vault has ${switchable.length} projects. See them all on the Projects screen.`}
          >
            <span className="nav-bullet" aria-hidden="true" />
            <span className="nav-sub-name">
              {switchable.length - listed.length} more on Projects…
            </span>
          </Link>
        )}
      </nav>

      <div className="sidebar-foot">
        {/* The vault, named once. Its path is on the Projects screen, which is where the
            reader can act on it — and is one click away through this link. A plain Link:
            as a NavLink this footer marked itself the current page on /projects, which lit
            two rows in one column at once. */}
        <Link className="vault-path" to="/projects" title={vault?.path ?? ""}>
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
            <span className="vault-path-name">
              {vault?.name ?? (error ? "no vault open" : "—")}
            </span>
            {/* The folder, not the whole path: enough to tell two vaults apart from any
                screen — which is how a reader notices they are not where they thought —
                without printing the path twice on the screen that owns it. The full path is
                the tooltip, and the Projects screen prints it. And never "resolving…"
                forever: a vault that failed to open says so. */}
            <span className="vault-path-value">
              {vault
                ? `${transport === "tauri" ? "desktop app" : "dev server"} · ${folder}`
                : error
                  ? "could not be read — open one"
                  : "resolving…"}
            </span>
          </span>
        </Link>
      </div>
    </aside>
  );
}

function NavIcon({ name }: { name: "dashboard" | "work" | "bug" | "projects" }) {
  const paths: Record<string, string> = {
    dashboard: "M2.5 9.5 L6 5.5 L8.5 8 L13.5 3",
    work: "M3 3.5 H13 M3 8 H13 M3 12.5 H9",
    bug: "M8 3.5 a3 3 0 0 1 3 3 v3 a3 3 0 0 1 -6 0 v-3 a3 3 0 0 1 3 -3 z M3 7 H5 M11 7 H13 M3 11 H5 M11 11 H13",
    projects: "M2.5 4.5 h4 l1.2 1.6 h5.8 v6.4 h-11 z",
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
