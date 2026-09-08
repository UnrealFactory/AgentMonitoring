import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { t } from "./i18n";

export interface ProjectFolder {
  id: string;
  name: string;
}

/** Personal organization only. Paths identify registrations, including unavailable ones. */
export interface ProjectFolders {
  folders: ProjectFolder[];
  assignments: Record<string, string>;
  /** Missing in older settings; an empty folder id is the root project list. */
  projectOrder?: Record<string, string[]>;
}

export const emptyProjectFolders = (): ProjectFolders => ({ folders: [], assignments: {}, projectOrder: {} });

export function folderFor(data: ProjectFolders, path: string): string {
  const id = data.assignments[path];
  return data.folders.some((folder) => folder.id === id) ? id : "";
}

/** Unranked projects retain the API's activity order after the manually ordered ones. */
export function orderedProjects<T extends { path: string }>(projects: T[], data: ProjectFolders, folder: string): T[] {
  const order = data.projectOrder?.[folder];
  if (!order?.length) return projects;
  const ranks = new Map(order.map((path, index) => [path, index]));
  return [...projects].sort((a, b) =>
    (ranks.get(a.path) ?? Number.MAX_SAFE_INTEGER) - (ranks.get(b.path) ?? Number.MAX_SAFE_INTEGER));
}

export function useProjectFolders() {
  const [data, setData] = useState<ProjectFolders>(emptyProjectFolders);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(data);
  const locked = useRef(true);
  const loaded = useRef(false);
  const loadVersion = useRef(0);

  const reload = useCallback(async () => {
    const version = ++loadVersion.current;
    locked.current = true;
    loaded.current = false;
    setLoading(true);
    try {
      const next = await api.getProjectFolders();
      if (version !== loadVersion.current) return;
      current.current = next;
      setData(next);
      loaded.current = true;
      setError(null);
    } catch (err) {
      if (version === loadVersion.current) setError(String(err instanceof Error ? err.message : err));
    } finally {
      if (version === loadVersion.current) {
        locked.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const change = async (update: (previous: ProjectFolders) => ProjectFolders): Promise<boolean> => {
    if (locked.current || !loaded.current) return false;
    locked.current = true;
    setBusy(true);
    try {
      const next = update(current.current);
      if (next === current.current) {
        setError(null);
        return true;
      }
      await api.setProjectFolders(next);
      current.current = next;
      setData(next);
      setError(null);
      return true;
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  const nameFor = (previous: ProjectFolders, name: string, except?: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) throw new Error(t("folder.invalidName"));
    if (previous.folders.some((folder) => folder.id !== except && folder.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error(t("folder.duplicateName"));
    }
    return trimmed;
  };

  return {
    data, loading, busy, error, reload,
    disabled: loading || busy || !loaded.current,
    create: (name: string) => change((previous) => ({
      ...previous,
      folders: [...previous.folders, { id: crypto.randomUUID(), name: nameFor(previous, name) }],
    })),
    rename: (id: string, name: string) => change((previous) => {
      const trimmed = nameFor(previous, name, id);
      return { ...previous, folders: previous.folders.map((folder) => folder.id === id ? { ...folder, name: trimmed } : folder) };
    }),
    remove: (id: string) => change((previous) => {
      const projectOrder = { ...previous.projectOrder };
      delete projectOrder[id];
      return {
        ...previous,
        folders: previous.folders.filter((folder) => folder.id !== id),
        assignments: Object.fromEntries(Object.entries(previous.assignments).filter(([, folder]) => folder !== id)),
        projectOrder,
      };
    }),
    move: (path: string, folder: string) => change((previous) => {
      const destination = previous.folders.some((item) => item.id === folder) ? folder : "";
      if (folderFor(previous, path) === destination) return previous;
      const assignments = { ...previous.assignments };
      if (destination) assignments[path] = destination;
      else delete assignments[path];
      const projectOrder = Object.fromEntries(Object.entries(previous.projectOrder ?? {})
        .map(([id, paths]) => [id, paths.filter((item) => item !== path)]));
      if (projectOrder[destination]) projectOrder[destination].push(path);
      return { ...previous, assignments, projectOrder };
    }),
    reorder: (id: string, target: string, edge: "before" | "after") => change((previous) => {
      const moving = previous.folders.find((folder) => folder.id === id);
      if (!moving || id === target || !previous.folders.some((folder) => folder.id === target)) return previous;
      const folders = previous.folders.filter((folder) => folder.id !== id);
      const at = folders.findIndex((folder) => folder.id === target) + (edge === "after" ? 1 : 0);
      folders.splice(at, 0, moving);
      if (folders.every((folder, index) => folder.id === previous.folders[index].id)) return previous;
      return { ...previous, folders };
    }),
    reorderProject: (path: string, target: string, edge: "before" | "after", paths: string[]) => change((previous) => {
      const folder = folderFor(previous, path);
      if (path === target || folderFor(previous, target) !== folder) return previous;
      const members = [...new Set(paths)].filter((item) => folderFor(previous, item) === folder).map((item) => ({ path: item }));
      const currentOrder = orderedProjects(members, previous, folder).map((item) => item.path);
      if (!currentOrder.includes(path) || !currentOrder.includes(target)) return previous;
      const order = currentOrder.filter((item) => item !== path);
      order.splice(order.indexOf(target) + (edge === "after" ? 1 : 0), 0, path);
      if (order.every((item, index) => item === currentOrder[index])) return previous;
      return { ...previous, projectOrder: { ...previous.projectOrder, [folder]: order } };
    }),
  };
}
