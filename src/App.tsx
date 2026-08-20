import { useEffect } from "react";
import { Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { AppProvider, useApp } from "./AppContext";
import { CommandPalette } from "./components/CommandPalette";
import { ContextMenuProvider } from "./components/ContextMenu";
import { DeleteProjectProvider } from "./components/DeleteProject";
import { Sidebar } from "./components/Sidebar";
import { Titlebar } from "./components/Titlebar";
import { TooltipLayer } from "./components/Tooltip";
import { InlineCode, plainMarks, Skeleton } from "./components/ui";
import { isTauri, vaultErrorMessage } from "./lib/api";
import { formatDateTimeUtc } from "./lib/format";
import { t, useLocale } from "./lib/i18n";
import { isModalOpen } from "./lib/modal";
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

  /* The desktop window has no frame of its own (tauri.conf.json `decorations: false`), so
     the app draws the strip that moves, maximises and closes it — above the shell, and
     only there. Browser mode has a browser frame and renders nothing extra: same DOM, same
     `class="app"`, same screenshots (components/Titlebar.tsx). */
  const desktop = isTauri();

  // The vault subscription lives in AppProvider: every screen reads the nonce it feeds,
  // so the whole app refreshes together (AppContext.tsx).
  useWindowTitle();

  /* Backspace-free navigation: Alt+Left goes back, matching the desktop shell.
   *
   * **Not while a modal is up.** This is a `window` listener, so it is bound by the rule in
   * src/lib/modal.ts — and it was the listener that broke it. With the delete dialog open
   * and armed on /projects, one Alt+Left — the desktop app's only Back gesture, added in
   * this file — moved the page behind the scrim to another project's screen and left the
   * dialog sitting over it, still about the first project, still one ↵ from deleting it.
   * That is what it did, on disk, in the real window (P12 round 2 critic). The key is
   * swallowed rather than merely ignored: in a browser Alt+Left is also the browser's own
   * Back, and a modal the app declines to navigate out from under must not be navigated out
   * from under by the frame it is drawn in either.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.altKey && e.key === "ArrowLeft")) return;
      if (isModalOpen()) {
        e.preventDefault();
        return;
      }
      navigate(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <>
      {desktop && <Titlebar />}
      <div className={desktop ? "app has-titlebar" : "app"}>
        <Sidebar />
        <main className="main" id="main">
          <VaultTroubleBar />
          <Outlet />
        </main>
        <CommandPalette />
      </div>
    </>
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
     the screen is a banner people learn to close. Translated first, and cut afterwards:
     the clause before the dash is the diagnosis in either language. */
  const message = vaultErrorMessage(trouble.message);
  const [headline] = message.split(" — ");
  return (
    <div className="vault-alert-wrap">
      <div className="vault-alert" role="status">
        <span className="vault-alert-dot" aria-hidden="true" />
        <span className="vault-alert-text">
          <strong>{t("shell.trouble.headline")}</strong>{" "}
          {t(
            "shell.trouble.body",
            vault?.path ?? null,
            formatDateTimeUtc(new Date(trouble.since).toISOString())
          )}{" "}
          <span className="vault-alert-detail" title={plainMarks(message)}>
            <InlineCode text={headline} />
          </span>
        </span>
        <button className="button button-sm" onClick={reload}>
          {t("app.retry")}
        </button>
      </div>
    </div>
  );
}

/**
 * The screen for an address that is not one — and the only screen that has to say so itself.
 *
 * It subscribes to the language, which every other screen gets for free. A repaint reaches a
 * component two ways: its parent re-renders it, or it reads something that changed. Neither
 * happened here. `<Route path="*" element={<NotFound />} />` below is built once, when App()
 * runs, so the element object never changes; and changing the language re-renders AppProvider
 * around the *same* children, which React skips — except for the components that consume the
 * context (`useApp`) or the locale store (`useLocale`). Every other route element does one of
 * those for its data. This one has no data: it called `t()` twice and read nothing, so
 * pressing English on /nope left two Korean sentences in an English window — and the mirror —
 * until the reader navigated away. One `useLocale()` is the subscription, and the gate now
 * presses the toggle on this screen instead of only loading it (scripts/check-i18n.mjs).
 */
function NotFound() {
  useLocale();
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">{t("app.notFound.title")}</h1>
        <p className="page-sub">{t("app.notFound.sub")}</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      {/* Owns the right button for the whole document — including the parts of it that have
          no menu, where the browser's own would otherwise appear (components/ContextMenu.tsx). */}
      <ContextMenuProvider>
        {/* The confirm dialog for the app's one destructive action, above every screen
            because the menu that opens it is on every surface that names a project — the
            sidebar's list, the switcher, a record's breadcrumb, the vault feed — and a
            dialog owned by /projects could not be raised from any of them
            (components/DeleteProject.tsx). */}
        <DeleteProjectProvider>
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
        </DeleteProjectProvider>
        {/* Draws every `title` in the app, so the WebView never draws one of its own — one
            layer, document-level delegation, no component opts in (components/Tooltip.tsx). */}
        <TooltipLayer />
      </ContextMenuProvider>
    </AppProvider>
  );
}
