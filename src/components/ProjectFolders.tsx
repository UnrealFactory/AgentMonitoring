import { useCallback, useContext, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useApp } from "../AppContext";
import { t } from "../lib/i18n";
import { folderFor, type ProjectFolder } from "../lib/projectFolders";
import { Select } from "./Select";
import { useContextMenu, useContextMenuApi, type MenuSpec } from "./ContextMenu";
import { trapTab, useModalLock } from "../lib/modal";
import { InlineCode } from "./ui";
import { stableContext } from "../lib/stableContext";

const FolderEditor = stableContext<((folder?: ProjectFolder) => void) | null>("folder-editor", null);

/** Folder menus work from the sidebar on any screen. */
export function ProjectFoldersProvider({ children }: { children: ReactNode }) {
  const [editing, setEditing] = useState<{ folder?: ProjectFolder } | null>(null);
  const open = useCallback((folder?: ProjectFolder) => setEditing({ folder }), []);
  const close = useCallback(() => setEditing(null), []);
  return <FolderEditor.Provider value={open}>
    {children}
    {editing && <FolderDialog key={editing.folder?.id ?? "new"} folder={editing.folder} onClose={close} />}
  </FolderEditor.Provider>;
}

export function useFolderMenu() {
  const edit = useContext(FolderEditor);
  const { organization } = useApp();
  const { toast } = useContextMenuApi();
  if (!edit) throw new Error("useFolderMenu must be used inside ProjectFoldersProvider");

  return (folder?: ProjectFolder): MenuSpec | null => {
    if (organization.busy) return null;
    if (!folder) return {
      label: t("nav.projects"),
      items: [{ id: "create-folder", label: t("folder.create"), run: () => edit() }],
    };
    return {
      label: folder.name,
      items: [
        { id: "rename-folder", label: t("folder.rename"), run: () => edit(folder) },
        {
          id: "delete-folder", label: t("folder.delete"), hint: t("folder.deleteHint"),
          run: () => { void organization.remove(folder.id).then((saved) => {
            if (!saved) toast(t("folder.failed"), { tone: "warn" });
          }); },
        },
      ],
    };
  };
}

function FolderDialog({ folder, onClose }: { folder?: ProjectFolder; onClose: () => void }) {
  const { organization } = useApp();
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const location = useLocation();
  const openedAt = useRef(location.pathname);
  useModalLock(true);

  useEffect(() => {
    const back = document.activeElement;
    dialog.current?.querySelector("input")?.focus();
    return () => { if (back instanceof HTMLElement && back.isConnected) back.focus(); };
  }, []);

  useEffect(() => {
    if (location.pathname !== openedAt.current) onClose();
  }, [location.pathname, onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!organization.busy) onClose();
      } else if (event.key === "Tab" && dialog.current && trapTab(dialog.current, event.shiftKey)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [organization.busy, onClose]);

  return <div className="modal-scrim" role="presentation" onMouseDown={() => { if (!organization.busy) onClose(); }}>
    <div className="modal folder-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}
      onMouseDown={(event) => event.stopPropagation()}>
      <h2 className="modal-title" id={titleId}>{folder ? t("folder.rename") : t("folder.new")}</h2>
      <FolderNameForm folder={folder} onDone={onClose} />
    </div>
  </div>;
}

export function FolderIcon() {
  return <svg className="nav-icon" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 4h4l1.5 2H14v7H2z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>;
}

function FolderNameForm({ folder, onDone }: { folder?: ProjectFolder; onDone: () => void }) {
  const { organization } = useApp();
  const [name, setName] = useState(folder?.name ?? "");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = folder ? await organization.rename(folder.id, name) : await organization.create(name);
    if (saved) onDone();
  };
  return <form className="folder-name-form modal-form" onSubmit={submit}>
    <label className="field">
      <span className="field-label">{t("folder.name")}</span>
      <input className="input" required maxLength={80} value={name}
        placeholder={t("folder.namePlaceholder")} onChange={(event) => setName(event.target.value)} />
    </label>
    {organization.error && <p className="form-error" role="alert">
      <InlineCode text={organization.error} />{" "}
      <button className="link-button" type="button" disabled={organization.loading || organization.busy}
        onClick={() => { void organization.reload(); }}>{t("app.retry")}</button>
    </p>}
    <div className="modal-actions">
      <button className="button" type="button" disabled={organization.busy} onClick={onDone}>{t("app.cancel")}</button>
      <button className="button button-primary" type="submit" disabled={!name.trim() || organization.disabled}>
        {folder ? t("folder.save") : t("folder.create")}
      </button>
    </div>
  </form>;
}

export function FolderSection({ folder, count, children }: {
  folder: ProjectFolder; count: number; children: ReactNode;
}) {
  const contextMenu = useContextMenu();
  const folderMenu = useFolderMenu();
  const [collapsed, setCollapsed] = useState(false);
  return <section className="project-section" data-folder-id={folder.id} data-project-drop-folder={folder.id} data-folder-order-id={folder.id}>
    <header className="project-section-head folder-section-head">
      <h2 className="folder-title">
        <button className="folder-heading" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed}
          data-folder-drag-id={folder.id}
          {...contextMenu(() => folderMenu(folder))}>
          <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
          <FolderIcon />
          <span>{folder.name}</span>
          <span className="section-count tabular">{t("proj.count", count)}</span>
        </button>
      </h2>
    </header>
    {!collapsed && (count > 0 ? children : <p className="folder-empty">{t("folder.empty")}</p>)}
  </section>;
}

export function MoveToFolder({ path, name }: { path: string; name: string }) {
  const { organization } = useApp();
  if (organization.data.folders.length === 0) return null;
  return <div className="project-folder-move">
    <Select value={folderFor(organization.data, path)}
      label={t("folder.moveProject", name)} disabled={organization.disabled}
      options={[{ value: "", label: t("folder.noFolder") }, ...organization.data.folders.map((folder) => ({ value: folder.id, label: folder.name }))]}
      onChange={(folder) => { void organization.move(path, folder); }} />
  </div>;
}
