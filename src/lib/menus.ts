/**
 * The two menus this app actually has, defined once.
 *
 * **Every link to a project opens the project menu; every link to a record opens the record
 * menu.** That is the whole rule, and it is written as a rule because three rounds of
 * enumerating surfaces one at a time lost one each time: the round that introduced this file
 * wired five surfaces and missed the dashboard and the switcher card; the round that fixed
 * those missed the vault-wide feed on /projects — twelve rows, byte-identical in class and
 * layout to the dashboard rows one screen over, every one of them pointing at a real record,
 * and not one of them answering the right button or Shift+F10. The failure is silent, since
 * the document-level suppressor eats the event either way, so a reader who learned the
 * gesture anywhere else simply finds it dead.
 *
 * The surfaces, as of this round. A project: the switcher card, the rows in its dropdown, the
 * sidebar's vault list, the Projects screen's rows, the breadcrumb at the head of every record,
 * and the vault feed's project-event lines. A record: the work list, the bug board, the head of
 * each record, the Related block, an id written into prose, the dashboard's four (working-right-
 * now, last-finished, unresolved-bug, activity feed) and the vault-wide feed on /projects,
 * whose rows are the only ones in the app that can name a project other than the one the
 * sidebar is standing in. Deliberately *not* a numbered list: the count is not the contract,
 * the rule above it is, and a surface that links to a record and takes no menu from here is the
 * same defect again whatever the number says.
 *
 * Three rules the items obey:
 *
 *   * **Nothing about a *record* deletes.** Work logs and bugs are append-only by SPEC:
 *     they are corrected, resolved and abandoned in place, never removed, and no menu over
 *     one offers otherwise. A **project** can be deleted — by the human, in this app, after
 *     typing its slug into the dialog the item opens (components/DeleteProject.tsx) — and
 *     the item says exactly that in its hint, in red, under a divider, before the click.
 *     Nothing an agent can reach deletes anything: there is no CLI verb and no MCP tool.
 *   * **A hint is the value.** "Copy slug · relay" tells the reader what is about to be on
 *     their clipboard; a menu that says only "Copy link" has to be tried to be understood.
 *   * **The same items in the same order, wherever the row is drawn.** A menu that drops
 *     Copy title on the screens that happen not to have read one would teach the reader that
 *     the gesture means different things in different places; instead the title is fetched
 *     at the moment it is asked for (see {@link readTitle}).
 */
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../AppContext";
import { useCopy, type MenuItem, type MenuSpec } from "../components/ContextMenu";
import { useDeleteProject } from "../components/DeleteProject";
import { api, isTauri } from "./api";
import { t } from "./i18n";
import { noteCount, unresolvedCount, workLogs } from "./words";
import type { Project } from "./types";

/** A record, as much of it as a menu needs. */
export interface RecordRef {
  kind: "work" | "bug" | "note";
  id: string;
  /**
   * The record's title — omitted by the surfaces that never read one (an event feed carries
   * an id and a summary; an id written into prose carries nothing at all). Copy title then
   * reads it from the vault when it is clicked, so the item is in every copy of this menu.
   */
  title?: string;
  /** The id of the project the record lives in — record ids are per-project by SPEC. */
  projectId: string;
  /** True on the record's own page: there is no "Open" for the thing already open. */
  here?: boolean;
}

/**
 * Which kind an id names.
 *
 * The vault's ids carry it (`WORK-0021`, `BUG-0004`), which is what lets a feed row and a
 * chip in a sentence open a menu about a record neither of them has loaded. Anything that
 * is not a work log's or a bug's id is a note's name — the third shape an event's ref can
 * take, and note names are validated at write time so they can never wear the other two.
 */
export const recordKind = (id: string): RecordRef["kind"] => {
  const upper = id.toUpperCase();
  return upper.startsWith("BUG") ? "bug" : upper.startsWith("WORK") ? "work" : "note";
};

/**
 * The app route for a record.
 *
 * This — not `location.href` — is what "Copy link" puts on the clipboard. In browser mode
 * the full URL carries a dev-server port that is gone by tomorrow, and in the desktop app
 * the origin is an internal `tauri://` address that means nothing to anybody. The route is
 * the address of the record inside this app, and it stays true in both.
 */
export const recordRoute = (r: Pick<RecordRef, "kind" | "id" | "projectId">): string =>
  `/p/${r.projectId}/${r.kind === "work" ? "work" : r.kind === "bug" ? "bugs" : "notes"}/${r.id}`;

/**
 * The title of a record the screen showing it never read, read now.
 *
 * Only ever called from Copy title's own click, and only on the surfaces that have an id
 * without a title. One record file, over the transport the rest of the app uses; if it
 * cannot be read the copy says so rather than putting the wrong thing on the clipboard.
 */
const readTitle = async (r: RecordRef): Promise<string> => {
  const record =
    r.kind === "bug"
      ? await api.getBug(r.projectId, r.id)
      : r.kind === "note"
        ? await api.getNote(r.projectId, r.id)
        : await api.getWorklog(r.projectId, r.id);
  return record.title;
};

/** Work logs and bugs: open it, or take a piece of it away with you. */
export function useRecordMenu() {
  const navigate = useNavigate();
  const copy = useCopy();
  return useCallback(
    (r: RecordRef): MenuSpec => {
      const route = recordRoute(r);
      const items: MenuItem[] = [];
      if (!r.here) items.push({ id: "open", label: t("menu.open"), run: () => navigate(route) });
      items.push(
        {
          id: "copy-id",
          label: t("menu.copyId"),
          hint: r.id,
          separator: !r.here,
          run: () => copy(r.id, r.id),
        },
        {
          id: "copy-title",
          label: t("menu.copyTitle"),
          run: () => copy(r.title ? r.title : () => readTitle(r), t("menu.theTitle")),
        },
        { id: "copy-link", label: t("menu.copyLink"), hint: route, run: () => copy(route, route) }
      );
      return { label: r.id, items };
    },
    [navigate, copy]
  );
}

/**
 * Projects: where to go in one, what to take from it, and the one way to be rid of it.
 *
 * `Open` is the project's dashboard, which is why it says so in its hint rather than
 * appearing twice under two names — a menu with two rows that fire the same navigation is
 * a menu padding itself out.
 *
 * `delete` is last, alone under a divider, drawn in red, and it does not delete: it opens
 * the dialog that asks for the slug (components/DeleteProject.tsx). A menu item that
 * destroys a folder of records on one click is a menu item that eventually destroys the
 * wrong one, and the two-inch gap between a right-click and a row's real name is exactly
 * where that mistake lives. Its hint is the whole cost of the action in five words, so the
 * reader knows before the pointer moves.
 */
export function useProjectMenu() {
  const navigate = useNavigate();
  const copy = useCopy();
  const requestDelete = useDeleteProject();
  const { refresh } = useApp();

  return useCallback(
    (p: Project): MenuSpec => ({
      label: p.name,
      items: [
        {
          id: "open",
          label: t("menu.open"),
          hint: t("menu.openHint"),
          run: () => navigate(`/p/${p.id}`),
        },
        {
          id: "work",
          label: t("nav.work"),
          hint: workLogs(p.counts.workTotal),
          run: () => navigate(`/p/${p.id}/work`),
        },
        {
          id: "bugs",
          label: t("nav.bugs"),
          hint: unresolvedCount(p.counts.bugsOpen),
          run: () => navigate(`/p/${p.id}/bugs`),
        },
        {
          id: "notes",
          label: t("nav.notes"),
          hint: noteCount(p.counts.notesTotal),
          run: () => navigate(`/p/${p.id}/notes`),
        },
        {
          id: "copy-path",
          label: t("menu.copyPath"),
          hint: p.path,
          separator: true,
          run: () => copy(p.path, p.path),
        },
        /* The undoable way off the list, above the destructive one and nothing like it:
           removing unregisters the path and touches no files. Desktop only — browser
           mode serves a fixed set of folders and has no list to remove from. */
        ...(isTauri()
          ? [
              {
                id: "remove",
                label: t("proj.remove"),
                hint: t("proj.removeHint"),
                separator: true,
                run: () => {
                  void api.removeProject(p.path).then(refresh);
                },
              } as MenuItem,
            ]
          : []),
        {
          id: "delete",
          label: t("menu.delete"),
          hint: t("menu.deleteHint"),
          separator: !isTauri(),
          danger: true,
          run: () => requestDelete(p),
        },
      ],
    }),
    [navigate, copy, requestDelete, refresh]
  );
}
