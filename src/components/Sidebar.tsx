import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useApp, useCurrentProject } from "../AppContext";
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
  const { vault, projects } = useApp();
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
                : pluralize(projects.length, "project")}
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
            {projects.map((p) => (
              <button
                key={p.slug}
                role="menuitem"
                className={`switcher-item${p.slug === current?.slug ? " is-current" : ""}`}
                onClick={() => navigate(`/p/${p.slug}`)}
              >
                <span className="switcher-item-name">{p.name}</span>
                <span className="switcher-item-meta tabular">{p.counts.workTotal} logs</span>
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

      <nav className="nav" aria-label="Main">
        <NavLink to={base ?? "/"} end className="nav-item">
          <NavIcon name="dashboard" />
          Dashboard
        </NavLink>
        <NavLink to={base ? `${base}/work` : "/"} className="nav-item">
          <NavIcon name="work" />
          Work
          {current && current.counts.workTotal > 0 && (
            <span className="nav-count tabular">{current.counts.workTotal}</span>
          )}
        </NavLink>
        <NavLink to={base ? `${base}/bugs` : "/"} className="nav-item">
          <NavIcon name="bug" />
          Bugs
          {current && current.counts.bugsOpen > 0 && (
            <span className="nav-count tabular">{current.counts.bugsOpen}</span>
          )}
        </NavLink>
        <NavLink to="/projects" className="nav-item">
          <NavIcon name="projects" />
          Projects
        </NavLink>
      </nav>

      <div className="sidebar-foot">
        <div className="vault-path" title={vault?.path ?? ""}>
          <span className="vault-path-label">Vault</span>
          <span className="vault-path-value mono">{vault?.path ?? "resolving…"}</span>
        </div>
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
