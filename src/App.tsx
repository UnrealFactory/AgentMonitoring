import { useEffect } from "react";
import { Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { AppProvider, useApp } from "./AppContext";
import { Sidebar } from "./components/Sidebar";
import { ErrorState, Skeleton } from "./components/ui";
import { subscribeVaultChanges } from "./lib/api";
import { DashboardPage } from "./pages/DashboardPage";
import { WorkListPage } from "./pages/WorkListPage";
import { WorkDetailPage } from "./pages/WorkDetailPage";
import { BugsPage } from "./pages/BugsPage";
import { BugDetailPage } from "./pages/BugDetailPage";
import { ProjectsPage } from "./pages/ProjectsPage";

/** Boot screen: send the human to the project that moved most recently. */
function Home() {
  const { projects, loading, error, reload } = useApp();
  if (loading) {
    return (
      <div className="page">
        <Skeleton rows={5} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="page">
        <ErrorState message={error} onRetry={reload} />
      </div>
    );
  }
  if (!projects.length) return <Navigate to="/projects" replace />;
  return <Navigate to={`/p/${projects[0].slug}`} replace />;
}

function Shell() {
  const { reload } = useApp();
  const navigate = useNavigate();

  // The desktop app watches the vault and pushes a change event; browser mode is inert.
  useEffect(() => {
    let cancelled = false;
    let dispose = () => {};
    subscribeVaultChanges(() => reload()).then((fn) => {
      // Unmounted while the listener was still being registered: drop it immediately
      // rather than leaving an orphan behind.
      if (cancelled) fn();
      else dispose = fn;
    });
    return () => {
      cancelled = true;
      dispose();
    };
  }, [reload]);

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
      <main className="main">
        <Outlet />
      </main>
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
