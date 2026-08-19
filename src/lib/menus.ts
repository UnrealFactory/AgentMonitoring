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
 *   * **Nothing here deletes.** The vault is append-only by SPEC: a project is archived,
 *     which hides it from the switcher and the default list and keeps every work log, bug
 *     and event it ever had. The item says so, in its hint, before the click — and the
 *     archive is undoable from the affordance the screen already has.
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
import { useContextMenuApi, useCopy, type MenuItem, type MenuSpec } from "../components/ContextMenu";
import { api } from "./api";
import { unresolvedCount, workLogs } from "./words";
import type { Project, ProjectStatus } from "./types";

/** A record, as much of it as a menu needs. */
export interface RecordRef {
  kind: "work" | "bug";
  id: string;
  /**
   * The record's title — omitted by the surfaces that never read one (an event feed carries
   * an id and a summary; an id written into prose carries nothing at all). Copy title then
   * reads it from the vault when it is clicked, so the item is in every copy of this menu.
   */
  title?: string;
  /** The project the record lives in — ids are per-project by SPEC. */
  slug: string;
  /** True on the record's own page: there is no "Open" for the thing already open. */
  here?: boolean;
}

/**
 * Which kind an id names.
 *
 * The vault's ids carry it (`WORK-0021`, `BUG-0004`), which is what lets a feed row and a
 * chip in a sentence open a menu about a record neither of them has loaded.
 */
export const recordKind = (id: string): RecordRef["kind"] =>
  id.toUpperCase().startsWith("BUG") ? "bug" : "work";

/**
 * The app route for a record.
 *
 * This — not `location.href` — is what "Copy link" puts on the clipboard. In browser mode
 * the full URL carries a dev-server port that is gone by tomorrow, and in the desktop app
 * the origin is an internal `tauri://` address that means nothing to anybody. The route is
 * the address of the record inside this app, and it stays true in both.
 */
export const recordRoute = (r: Pick<RecordRef, "kind" | "id" | "slug">): string =>
  `/p/${r.slug}/${r.kind === "work" ? "work" : "bugs"}/${r.id}`;

/**
 * The title of a record the screen showing it never read, read now.
 *
 * Only ever called from Copy title's own click, and only on the surfaces that have an id
 * without a title. One record file, over the transport the rest of the app uses; if it
 * cannot be read the copy says so rather than putting the wrong thing on the clipboard.
 */
const readTitle = async (r: RecordRef): Promise<string> => {
  const record =
    r.kind === "bug" ? await api.getBug(r.slug, r.id) : await api.getWorklog(r.slug, r.id);
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
      if (!r.here) items.push({ id: "open", label: "Open", run: () => navigate(route) });
      items.push(
        { id: "copy-id", label: "Copy id", hint: r.id, separator: !r.here, run: () => copy(r.id, r.id) },
        {
          id: "copy-title",
          label: "Copy title",
          run: () => copy(r.title ? r.title : () => readTitle(r), "the title"),
        },
        { id: "copy-link", label: "Copy link", hint: route, run: () => copy(route, route) }
      );
      return { label: r.id, items };
    },
    [navigate, copy]
  );
}

/**
 * Projects: where to go in one, what to take from it, and the one state it can be put in.
 *
 * `Open` is the project's dashboard, which is why it says so in its hint rather than
 * appearing twice under two names — a menu with two rows that fire the same navigation is
 * a menu padding itself out.
 *
 * `archive` lets a screen keep its own way back: the Projects screen answers an archive
 * with the undo bar it already has, in the layout beside the list. Anywhere else — the
 * switcher, the sidebar — there is no such bar, so the same undo arrives as a toast that
 * does not fade.
 */
export function useProjectMenu(overrides?: {
  archive?: (project: Project, status: ProjectStatus) => void;
}) {
  const navigate = useNavigate();
  const copy = useCopy();
  const { toast } = useContextMenuApi();
  const { refresh } = useApp();
  const override = overrides?.archive;

  // Annotated, not inferred: the Undo action calls it again, and a self-referencing
  // initializer has no type to infer from.
  const setStatus: (project: Project, status: ProjectStatus) => Promise<void> = useCallback(
    async (project: Project, status: ProjectStatus) => {
      try {
        await api.setProjectStatus(project.slug, status);
        refresh();
        if (status === "archived") {
          toast(`${project.name} is archived. Nothing was deleted.`, {
            action: { label: "Undo", run: () => void setStatus(project, "active") },
          });
        } else {
          toast(`${project.name} is back in the switcher.`);
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), { tone: "warn" });
      }
    },
    [refresh, toast]
  );

  return useCallback(
    (p: Project): MenuSpec => {
      const archived = p.status === "archived";
      const archive = (status: ProjectStatus) =>
        override ? override(p, status) : void setStatus(p, status);
      return {
        label: p.name,
        items: [
          { id: "open", label: "Open", hint: "Dashboard", run: () => navigate(`/p/${p.slug}`) },
          {
            id: "work",
            label: "Work",
            hint: workLogs(p.counts.workTotal),
            run: () => navigate(`/p/${p.slug}/work`),
          },
          {
            id: "bugs",
            label: "Bugs",
            hint: unresolvedCount(p.counts.bugsOpen),
            run: () => navigate(`/p/${p.slug}/bugs`),
          },
          {
            id: "copy-slug",
            label: "Copy slug",
            hint: p.slug,
            separator: true,
            run: () => copy(p.slug, p.slug),
          },
          archived
            ? {
                id: "unarchive",
                label: "Unarchive",
                hint: "back in the switcher",
                separator: true,
                run: () => archive("active"),
              }
            : {
                id: "archive",
                label: "Archive",
                hint: "records are kept",
                separator: true,
                run: () => archive("archived"),
              },
        ],
      };
    },
    [navigate, copy, setStatus, override]
  );
}
