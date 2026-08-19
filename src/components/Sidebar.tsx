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
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useApp, useCurrentProject } from "../AppContext";
import { openPalette } from "./CommandPalette";
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
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
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
          onClick={() => setMenuOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <span className="switcher-label">
            <span className="switcher-name">{current?.name ?? "All projects"}</span>
            <span className="switcher-meta tabular">
              {current
                ? `${current.counts.workInProgress} active · ${pluralize(
                    current.counts.bugsOpen,
                    "open bug"
                  )}`
                : pluralize(active.length, "project")}
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
            {switchable.map((p) => (
              <button
                key={p.slug}
                role="menuitem"
                className={`switcher-item${p.slug === current?.slug ? " is-current" : ""}`}
                onClick={() => navigate(`/p/${p.slug}`)}
              >
                <span className="switcher-item-name">
                  {p.name}
                  {p.status === "archived" && (
                    <span className="switcher-item-flag"> archived</span>
                  )}
                </span>
                {/* Both numbers, both named: a bare "12" beside a bare "2" invites the
                    reader to compare two things that are not the same measure. */}
                <span className="switcher-item-meta tabular">
                  {p.counts.workTotal} logs
                  {p.counts.bugsOpen > 0 && ` · ${p.counts.bugsOpen} open`}
                </span>
              </button>
            ))}
            <div className="switcher-sep" />
            <button
              role="menuitem"
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
                  different things — every log ever written against only the open bugs. Each
                  count now says which it is. */}
              {current.counts.workTotal > 0 && (
                <span
                  className="nav-count tabular"
                  title={`${current.counts.workTotal} work logs in this project, ${current.counts.workInProgress} still open`}
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
                  title={`${current.counts.bugsOpen} open of ${current.counts.bugsTotal} bugs ever filed here`}
                >
                  {current.counts.bugsOpen} open
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

        {listed.map((p) => (
          <NavLink
            key={p.slug}
            to={`/p/${p.slug}`}
            className={`nav-item nav-sub${p.slug === current?.slug ? " is-current" : ""}`}
            title={`${p.name} — ${pluralize(p.counts.workTotal, "work log")}, ${pluralize(
              p.counts.bugsOpen,
              "open bug"
            )}`}
          >
            <span
              className={`nav-bullet${p.status === "archived" ? " is-archived" : ""}`}
              aria-hidden="true"
            />
            <span className="nav-sub-name">{p.name}</span>
            {/* One measure only, and it says which: a bare number here would be the third
                different denominator in this column. */}
            {p.counts.bugsOpen > 0 && (
              <span className="nav-count nav-count-open tabular">{p.counts.bugsOpen} open</span>
            )}
          </NavLink>
        ))}
        {switchable.length > listed.length && (
          <NavLink to="/projects" className="nav-item nav-sub nav-more">
            <span className="nav-bullet" aria-hidden="true" />
            <span className="nav-sub-name">
              {switchable.length - listed.length} more…
            </span>
          </NavLink>
        )}
      </nav>

      <div className="sidebar-foot">
        {/* The vault, named once. Its path is on the Projects screen, which is where the
            reader can act on it — and is one click away through this link. */}
        <NavLink className="vault-path" to="/projects" title={vault?.path ?? ""}>
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
        </NavLink>
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
