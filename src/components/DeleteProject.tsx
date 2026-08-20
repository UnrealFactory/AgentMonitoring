/**
 * Deleting a project — the one thing in this app that destroys data, and the only one a
 * human does that an agent cannot.
 *
 * The app used to file projects away instead ("archive"), which kept every record and could
 * be undone. That was removed: a project you have stopped using should leave the vault, and
 * a status that only half-hides it is a second state to reason about for no benefit the
 * reader asked for. What replaces it deletes for real — `projects/<slug>/` and everything
 * inside it, off the disk, with no recycle bin and no undo — so the whole design of this
 * file is about the moment *before* the click:
 *
 *   * **The item that opens it says what it costs.** 삭제, red, under a divider, hinting
 *     "영구 삭제 — 되돌릴 수 없습니다" (src/lib/menus.ts). Nothing here is a surprise.
 *   * **The dialog states what will be lost**, in counts read from the project a moment
 *     ago — 작업 로그 27개 · 버그 4개 · 이벤트 61건 — rather than saying "are you sure?"
 *     over a name.
 *   * **The confirmation is the slug, typed.** Not a second button: typing `relay` is an
 *     act you cannot perform by reflex, and it is the same string the reader can see one
 *     line above. The button stays disabled until it matches exactly, and ↵ in an empty
 *     field does nothing at all.
 *   * **Every way out is cheap.** esc, the scrim, Cancel — and none of them ask twice.
 *   * **It owns the window while it is up.** The keys that move the app all stand down for
 *     it: Alt+Left does not walk the page out from under it, Ctrl+K does not open the
 *     palette over it, and a right-click raises no menu on top of it. That is not
 *     housekeeping — every one of those was a way for the confirmation to end up floating
 *     over a screen about a *different* project, armed, with ↵ still pointed at this one.
 *     Alt+Left did it, and `nav-victim` left the disk from a screen about Relay (P12 round 2
 *     critic). The rules live in src/lib/modal.ts; this dialog is the reason they are rules.
 *
 * It lives here, above the screens, rather than on /projects: the menu that opens it is on
 * every surface that names a project (the sidebar's list, the switcher and its dropdown, the
 * breadcrumb of every record, the vault feed), and a dialog owned by one screen could not be
 * raised from the other five.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useApp } from "../AppContext";
import { api, vaultErrorMessage } from "../lib/api";
import { t } from "../lib/i18n";
import { dialogDepth, modalDepth, onModalChange, trapTab, useModalLock } from "../lib/modal";
import { bugCount, eventCount, workLogs } from "../lib/words";
import { useContextMenuApi } from "./ContextMenu";
import { InlineCode, RichText } from "./ui";
import type { Project } from "../lib/types";

/** Ask for a project to be deleted: opens the dialog. Nothing happens without the human. */
type Request = (project: Project) => void;

const Ctx = createContext<Request | null>(null);

export function useDeleteProject(): Request {
  const request = useContext(Ctx);
  if (!request) throw new Error("useDeleteProject must be used inside <DeleteProjectProvider>");
  return request;
}

export function DeleteProjectProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<Project | null>(null);
  const request = useCallback((p: Project) => setProject(p), []);
  // Stable, because the dialog binds window listeners to it: an `onClose` rebuilt on every
  // render of this provider would tear down and re-register them on every keystroke.
  const close = useCallback(() => setProject(null), []);
  return (
    <Ctx.Provider value={request}>
      {children}
      {/* Keyed by slug: asking about a second project must not inherit the first one's
          half-typed confirmation. */}
      {project && <DeleteDialog key={project.slug} project={project} onClose={close} />}
    </Ctx.Provider>
  );
}

function DeleteDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const { refresh } = useApp();
  const { toast } = useContextMenuApi();
  const navigate = useNavigate();
  const location = useLocation();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Whatever had the keyboard when the dialog opened, to hand it back on close. */
  const returnFocus = useRef<HTMLElement | null>(null);

  /* Only the exact slug arms the button. Trimmed, because a slug pasted out of the row
     above it can arrive with a space on the end and that is not a different intention;
     not lower-cased, because a slug *is* lower case and "RELAY" is a reader who has not
     read the field. */
  const armed = typed.trim() === project.slug;
  const c = project.counts;

  /* Every screen-level key handler in the app asks this first (src/lib/modal.ts) — so the
     list underneath does not answer the arrows while this is up, and the app's Back gesture
     does not walk the page out from under it (src/App.tsx). As a *dialog*: nothing may open
     over it, which is what the palette's Ctrl+K and the context menu now check. */
  useModalLock(true);

  /* Where this dialog sits in the modal stack, read after its own lock is taken (effects run
     in declaration order, so the count above already includes it). Two rules come out of it:

       * anything **above** it answers the keyboard first. Without that, its esc below would
         close the dialog out from under a menu the reader is actually looking at — which is
         precisely the defect it was written to avoid, upside down.
       * a **dialog** arriving over it would bury it, so it stands down, the way the context
         menu does (components/ContextMenu.tsx). Nothing opens one today; this is what keeps
         that true when a third modal is written. */
  const mine = useRef(0);
  useEffect(() => {
    mine.current = modalDepth();
    const mineDialogs = dialogDepth();
    return onModalChange(() => {
      if (dialogDepth() > mineDialogs) onClose();
    });
  }, [onClose]);

  /* And if the page underneath moves, the dialog goes with it.
     Nothing should be able to move it now — Alt+Left stands down, the palette will not open,
     the scrim eats the clicks — but a confirmation that outlives the screen it was raised
     from is how "delete this project" comes to be answered on a screen about another one.
     It cost `nav-victim` its directory once already (P12 round 2 critic). The delete's own
     navigation is not this: submit closes the dialog before it navigates. */
  const openedAt = useRef(location.pathname);
  useEffect(() => {
    if (location.pathname !== openedAt.current) onClose();
  }, [location.pathname, onClose]);

  useEffect(() => {
    const el = document.activeElement;
    returnFocus.current = el instanceof HTMLElement && el !== document.body ? el : null;
    inputRef.current?.focus();
    return () => {
      const back = returnFocus.current;
      if (back?.isConnected) back.focus();
    };
  }, []);

  /* esc and Tab on the window, in the capture phase, for the reason the palette does it:
     a dismissal that only works while the focus is where the component put it is not one.
     A delete dialog nobody can leave with the keyboard would be the worst thing in the app
     to get wrong. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // Something is open over this dialog: it answers first, and this stays where it is.
      if (modalDepth() > mine.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (!busy) onClose();
        return;
      }
      if (e.key === "Tab") {
        const root = dialogRef.current;
        if (root && trapTab(root, e.shiftKey)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      /* A character typed while the focus has drifted — a click on this dialog's own
         warning text is enough, since prose is not focusable and the browser hands the
         focus to <body> — belongs in the box the dialog is asking to be typed into. The
         palette answers stray typing the same way; here it matters more, because the only
         way out of this dialog other than leaving is typing. */
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
        if (!dialogRef.current?.contains(document.activeElement)) inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy, onClose]);

  /**
   * The delete itself.
   *
   * Guarded rather than merely disabled: `armed` is checked here too, so ↵ in an empty
   * field — the browser's implicit submit, which does not care what a button's `disabled`
   * attribute says in every engine — cannot delete a project.
   */
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!armed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const gone = await api.deleteProject(project.slug);
      onClose();
      /* The reader may be standing inside the project that just stopped existing — from the
         sidebar, the switcher, the breadcrumb of one of its records. Leaving them on a
         screen whose data is gone would answer their delete with "could not read the
         vault". */
      if (location.pathname === `/p/${project.slug}` ||
          location.pathname.startsWith(`/p/${project.slug}/`)) {
        navigate("/projects");
      }
      refresh();
      toast(t("del.doneToast", gone.name || project.name));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-scrim"
      role="presentation"
      onMouseDown={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="modal is-danger"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-project-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 className="modal-title" id="delete-project-title">
            {t("del.title")}
          </h2>
          <p className="modal-project">
            <span className="modal-project-name">{project.name}</span>
            <span className="modal-project-slug mono">{project.slug}</span>
          </p>
        </header>

        <dl className="modal-facts">
          <dt>{t("del.contains")}</dt>
          <dd className="tabular">
            {workLogs(c.workTotal)} · {bugCount(c.bugsTotal)} · {eventCount(c.events)}
          </dd>
        </dl>

        <p className="modal-warn">
          <RichText text={t("del.warn", project.slug)} />
        </p>
        <p className="modal-note">{t("del.warnRefs")}</p>

        <form className="modal-form" onSubmit={submit}>
          <label className="field">
            <span className="field-label">{t("del.confirmLabel")}</span>
            <input
              ref={inputRef}
              className="input mono"
              value={typed}
              spellCheck={false}
              autoComplete="off"
              /* No placeholder, deliberately: a greyed copy of the exact string this box
                 wants reads as a box that is already filled in, and the reader would be
                 looking for the slug in three places at once — the line above, the hint
                 below, and a value that is not there. */
              aria-describedby="delete-project-hint"
              onChange={(e) => setTyped(e.target.value)}
            />
            <span className="field-hint" id="delete-project-hint">
              {t("del.confirmHint", project.slug)}
            </span>
          </label>

          {error && (
            <p className="form-error" role="alert">
              <InlineCode text={vaultErrorMessage(error)} />
            </p>
          )}

          <div className="modal-actions">
            <button
              className="button button-danger"
              type="submit"
              disabled={!armed || busy}
              title={armed ? undefined : t("del.confirmHint", project.slug)}
            >
              {busy ? t("del.deleting") : t("del.confirm")}
            </button>
            <button className="button" type="button" disabled={busy} onClick={onClose}>
              {t("app.cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
