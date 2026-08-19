import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useApp, useCurrentProject } from "../AppContext";
import { openPalette } from "./CommandPalette";
import { pluralize } from "../lib/format";

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
  const { vault, projects, error } = useApp();
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

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-badge">
          <AppMark />
        </span>
        <span className="brand-text">
          <span className="brand-name">AgentMonitoring</span>
          <span className="brand-sub">{vault?.name ?? "vault"}</span>
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
            {active.map((p) => (
              <button
                key={p.slug}
                role="menuitem"
                className={`switcher-item${p.slug === current?.slug ? " is-current" : ""}`}
                onClick={() => navigate(`/p/${p.slug}`)}
              >
                <span className="switcher-item-name">{p.name}</span>
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
            <p className="nav-section" title={current.name}>
              {current.name}
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
      </nav>

      <div className="sidebar-foot">
        <NavLink className="vault-path" to="/projects" title={vault?.path ?? ""}>
          <span className="vault-path-label">Vault</span>
          <span className="vault-path-name">{vault?.name ?? (error ? "none open" : "—")}</span>
          {/* Never "resolving…" forever: a vault that failed to open says so, and the link
              goes to the screen that can open another one. */}
          <span className="vault-path-value mono">
            {vault?.path ?? (error ? "no vault could be read — open one" : "resolving…")}
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
