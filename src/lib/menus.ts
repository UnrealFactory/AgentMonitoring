/**
 * The two menus this app actually has, defined once.
 *
 * A project row appears in three places (the switcher, the sidebar's vault list, the
 * Projects screen) and a record row in four (the work list, the bug board, and the head of
 * each record) — so the menu they open is built here rather than beside each of them. Three
 * copies of a menu is how the same action ends up with two labels and one screen quietly
 * loses an item.
 *
 * Two rules the items obey:
 *
 *   * **Nothing here deletes.** The vault is append-only by SPEC: a project is archived,
 *     which hides it from the switcher and the default list and keeps every work log, bug
 *     and event it ever had. The item says so, in its hint, before the click — and the
 *     archive is undoable from the affordance the screen already has.
 *   * **A hint is the value.** "Copy slug · relay" tells the reader what is about to be on
 *     their clipboard; a menu that says only "Copy link" has to be tried to be understood.
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
  title: string;
  /** The project the record lives in — ids are per-project by SPEC. */
  slug: string;
  /** True on the record's own page: there is no "Open" for the thing already open. */
  here?: boolean;
}

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
        { id: "copy-title", label: "Copy title", run: () => copy(r.title, "the title") },
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
