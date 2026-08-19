import { useEffect } from "react";
import { Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { AppProvider, useApp } from "./AppContext";
import { CommandPalette } from "./components/CommandPalette";
import { Sidebar } from "./components/Sidebar";
import { Skeleton } from "./components/ui";
import { formatDateTimeUtc } from "./lib/format";
import { useWindowTitle } from "./lib/useWindowTitle";
import { DashboardPage } from "./pages/DashboardPage";
import { WorkListPage } from "./pages/WorkListPage";
import { WorkDetailPage } from "./pages/WorkDetailPage";
import { BugsPage } from "./pages/BugsPage";
import { BugDetailPage } from "./pages/BugDetailPage";
import { ProjectsPage } from "./pages/ProjectsPage";

/** Boot screen: send the human to the project that moved most recently. */
function Home() {
  const { projects, loading, error } = useApp();
  if (loading) {
    return (
      <div className="page">
        <Skeleton rows={5} />
      </div>
    );
  }
  /*
   * No vault, or a vault that will not open, is not an error card with one button on it.
   *
   * This screen used to answer it with <ErrorState onRetry> — and Try again re-runs the
   * identical resolution, so on a machine that has no vault (the installed app, a moved
   * copy, a renamed folder) it fails identically every time, forever. The only remedies in
   * the message are a CLI flag, an environment variable and a command, none of which a
   * human can act on from inside the window. /projects is the screen that recovers: it
   * shows the same error, plus Open vault folder…, Create a vault…, and the three commands
   * with the real directory in them. So the boot screen goes there, exactly as it does for
   * a vault that opened and holds nothing yet.
   */
  if (error || !projects.length) return <Navigate to="/projects" replace />;
  return <Navigate to={`/p/${projects[0].slug}`} replace />;
}

function Shell() {
  const navigate = useNavigate();

  // The vault subscription lives in AppProvider: every screen reads the nonce it feeds,
  // so the whole app refreshes together (AppContext.tsx).
  useWindowTitle();

  // Backspace-free navigation: Alt+Left goes back, matching the desktop shell.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === "ArrowLeft") navigate(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <div className="app">
      <Sidebar />
      <main className="main" id="main">
        <VaultTroubleBar />
        <Outlet />
      </main>
      <CommandPalette />
    </div>
  );
}

/**
 * One line, above whatever screen is open, when the vault has stopped answering.
 *
 * The app keeps the last good data on screen when a refresh fails — replacing a page
 * somebody is reading with an error because one poll missed would be worse. But silence
 * has a failure mode of its own: a board frozen on numbers from ten minutes ago looks
 * exactly like a quiet project. This says which it is, and stays out of the way otherwise.
 * When nothing could be read at all the page itself carries the error, so the bar defers.
 */
function VaultTroubleBar() {
  const { trouble, error, reload, vault } = useApp();
  if (!trouble || error) return null;
  /* The backend's message is written for somebody who can act on it and can run to four
     lines. One line here, the rest in the tooltip: a banner that shouts a paragraph over
     the screen is a banner people learn to close. */
  const [headline] = trouble.message.split(" — ");
  return (
    <div className="vault-alert-wrap">
      <div className="vault-alert" role="status">
        <span className="vault-alert-dot" aria-hidden="true" />
        <span className="vault-alert-text">
          <strong>Not reading the vault right now.</strong> Everything below is the last good
          data{vault?.path ? ` from ${vault.path}` : ""}, as of{" "}
          {formatDateTimeUtc(new Date(trouble.since).toISOString())}.{" "}
          <span className="vault-alert-detail" title={trouble.message}>
            {headline}
          </span>
        </span>
        <button className="button button-sm" onClick={reload}>
          Try again
        </button>
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Nothing here</h1>
        <p className="page-sub">That address does not match a screen in this app.</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="p/:project" element={<DashboardPage />} />
          <Route path="p/:project/work" element={<WorkListPage />} />
          <Route path="p/:project/work/:id" element={<WorkDetailPage />} />
          <Route path="p/:project/bugs" element={<BugsPage />} />
          <Route path="p/:project/bugs/:id" element={<BugDetailPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AppProvider>
  );
}
