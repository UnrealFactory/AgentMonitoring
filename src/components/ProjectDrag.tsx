import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../AppContext";
import { t } from "../lib/i18n";
import { folderFor, orderedProjects } from "../lib/projectFolders";
import { isModalOpen, onModalChange } from "../lib/modal";
import { useContextMenuApi } from "./ContextMenu";

type Drag = {
  name: string;
  source: HTMLElement;
  pointer: number;
  x: number;
  y: number;
} & ({ kind: "project"; path: string } | { kind: "folder"; id: string });

type Destination = { element: HTMLElement; label: string } & (
  { kind: "project"; id: string } | { kind: "folder"; id: string; edge: "before" | "after" }
  | { kind: "project-order"; path: string; edge: "before" | "after" }
);

interface Preview {
  kind: Drag["kind"];
  name: string;
  x: number;
  y: number;
  destination: string | null;
}

/** Projects move between folders; folders move before/after other folders.
 * A plain click opens or folds; moving at least 6px while holding starts a drag. */
export function ProjectDragLayer() {
  const { rows, organization } = useApp();
  const { toast } = useContextMenuApi();
  const latest = useRef({ rows, organization, toast });
  latest.current = { rows, organization, toast };
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    let drag: Drag | null = null;
    let active = false;
    let target: HTMLElement | null = null;
    let suppressClick = false;

    const highlight = (next: Destination | null) => {
      target?.removeAttribute("data-project-drag-over");
      target?.removeAttribute("data-folder-order-edge");
      target?.removeAttribute("data-project-order-edge");
      target = next?.element ?? null;
      if (next?.kind === "folder") target?.setAttribute("data-folder-order-edge", next.edge);
      else if (next?.kind === "project-order") target?.setAttribute("data-project-order-edge", next.edge);
      else if (next) target?.setAttribute("data-project-drag-over", "true");
    };

    const finish = () => {
      if (active) suppressClick = true;
      drag?.source.removeAttribute("data-project-drag-source");
      if (drag?.source.hasPointerCapture(drag.pointer)) drag.source.releasePointerCapture(drag.pointer);
      drag = null;
      active = false;
      highlight(null);
      document.documentElement.removeAttribute("data-project-dragging");
      setPreview(null);
    };

    const destinationAt = (x: number, y: number): Destination | null => {
      const { rows, organization } = latest.current;
      const moving = drag;
      if (!moving || organization.disabled || isModalOpen()) return null;
      const hovered = document.elementFromPoint(x, y);
      if (moving.kind === "folder") {
        const element = hovered?.closest<HTMLElement>("[data-folder-order-id]");
        if (!element) return null;
        const id = element.dataset.folderOrderId!;
        const from = organization.data.folders.findIndex((folder) => folder.id === moving.id);
        const to = organization.data.folders.findIndex((folder) => folder.id === id);
        if (from < 0 || to < 0 || from === to) return null;
        const header = element.querySelector<HTMLElement>("[data-folder-drag-id]") ?? element;
        const bounds = header.getBoundingClientRect();
        const edge = y < bounds.top + bounds.height / 2 ? "before" : "after";
        if ((edge === "before" && from === to - 1) || (edge === "after" && from === to + 1)) return null;
        const name = organization.data.folders[to].name;
        return { kind: "folder", element, id, edge, label: t(edge === "before" ? "folder.orderBefore" : "folder.orderAfter", name) };
      }
      if (!rows.some((row) => row.path === moving.path)) return null;
      const projectTarget = hovered?.closest<HTMLElement>("[data-project-drag-path]");
      const targetPath = projectTarget?.dataset.projectDragPath;
      const sourceFolder = folderFor(organization.data, moving.path);
      if (projectTarget && targetPath && rows.some((row) => row.path === targetPath) && folderFor(organization.data, targetPath) === sourceFolder) {
        const members = orderedProjects(rows.filter((row) => folderFor(organization.data, row.path) === sourceFolder), organization.data, sourceFolder);
        const from = members.findIndex((row) => row.path === moving.path);
        const to = members.findIndex((row) => row.path === targetPath);
        if (from === to) return null;
        const bounds = projectTarget.getBoundingClientRect();
        const edge = y < bounds.top + bounds.height / 2 ? "before" : "after";
        if ((edge === "before" && from === to - 1) || (edge === "after" && from === to + 1)) return null;
        const name = projectTarget.dataset.projectDragName || targetPath;
        return { kind: "project-order", element: projectTarget, path: targetPath, edge,
          label: t(edge === "before" ? "folder.projectBefore" : "folder.projectAfter", name) };
      }
      const element = hovered?.closest<HTMLElement>("[data-project-drop-folder]");
      if (!element) return null;
      const id = element.dataset.projectDropFolder!;
      const folder = organization.data.folders.find((item) => item.id === id);
      if (id !== "" && !folder) return null;
      if (folderFor(organization.data, moving.path) === id) return null;
      return { kind: "project", element, id, label: folder ? t("folder.dragInto", folder.name) : t("folder.dragOut") };
    };

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || event.pointerType === "touch") return;
      finish();
      suppressClick = false;
      if (latest.current.organization.disabled || isModalOpen() || !(event.target instanceof Element)) return;
      const source = event.target.closest<HTMLElement>("[data-project-drag-path], [data-folder-drag-id]");
      if (!source) return;
      const control = event.target.closest("button, input, textarea, select, [contenteditable], .select-root");
      if (control && control !== source) return;
      const origin = {
        source,
        pointer: event.pointerId, x: event.clientX, y: event.clientY,
      };
      const folder = latest.current.organization.data.folders.find((item) => item.id === source.dataset.folderDragId);
      if (folder) {
        drag = { ...origin, kind: "folder", id: folder.id, name: folder.name };
      } else {
        const path = source.dataset.projectDragPath;
        if (!path || !latest.current.rows.some((row) => row.path === path)) return;
        drag = { ...origin, kind: "project", path, name: source.dataset.projectDragName || path };
      }
    };

    const onMove = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointer) return;
      if (!(event.buttons & 1) || !drag.source.isConnected || isModalOpen()) return finish();
      if (!active) {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
        active = true;
        drag.source.setPointerCapture(drag.pointer);
        drag.source.setAttribute("data-project-drag-source", "true");
        document.documentElement.setAttribute("data-project-dragging", "true");
        window.getSelection()?.removeAllRanges();
      }
      event.preventDefault();
      const destination = destinationAt(event.clientX, event.clientY);
      highlight(destination);
      setPreview({ kind: drag.kind, name: drag.name, x: event.clientX, y: event.clientY, destination: destination?.label ?? null });
    };

    const onUp = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointer) return;
      const moving = drag;
      const destination = active ? destinationAt(event.clientX, event.clientY) : null;
      finish();
      if (moving.kind === "folder" && destination?.kind === "folder") {
        void latest.current.organization.reorder(moving.id, destination.id, destination.edge).then((saved) => {
          if (!saved) latest.current.toast(t("folder.reorderFailed"), { tone: "warn" });
        });
      } else if (moving.kind === "project" && destination?.kind === "project-order") {
        void latest.current.organization.reorderProject(moving.path, destination.path, destination.edge, latest.current.rows.map((row) => row.path)).then((saved) => {
          if (!saved) latest.current.toast(t("folder.projectReorderFailed"), { tone: "warn" });
        });
      } else if (moving.kind === "project" && destination?.kind === "project") {
        void latest.current.organization.move(moving.path, destination.id).then((saved) => {
          if (!saved) latest.current.toast(t("folder.moveFailed"), { tone: "warn" });
          else if (destination.element instanceof HTMLDetailsElement) destination.element.open = true;
        });
      }
    };

    const onClick = (event: MouseEvent) => {
      if (!suppressClick || event.button !== 0) return;
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    const onKey = (event: KeyboardEvent) => {
      if (!drag || event.key !== "Escape") return;
      if (active) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      finish();
    };

    // Links must not start the webview's native URL drag before pointerup reaches us.
    const onNativeDrag = (event: DragEvent) => {
      if (drag) event.preventDefault();
    };
    const onCancel = () => finish();
    const stopWatchingModals = onModalChange(() => { if (isModalOpen()) finish(); });
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, { capture: true, passive: false });
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("blur", onCancel);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("dragstart", onNativeDrag, true);
    return () => {
      stopWatchingModals();
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
      window.removeEventListener("blur", onCancel);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("dragstart", onNativeDrag, true);
      finish();
    };
  }, []);

  if (!preview) return null;
  return createPortal(
    <div className="project-drag-preview" role="status" style={{
      left: Math.max(8, Math.min(preview.x + 16, window.innerWidth - 256)),
      top: Math.max(8, Math.min(preview.y + 16, window.innerHeight - 76)),
    }}>
      <strong>{preview.name}</strong>
      <span>{preview.destination ?? t(preview.kind === "folder" ? "folder.reorderHint" : "folder.dragHint")}</span>
    </div>,
    document.body,
  );
}
