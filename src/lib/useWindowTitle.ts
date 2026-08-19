/**
 * The window title, kept in step with where the reader is.
 *
 * A desktop window that says only the product name is a window you cannot pick out of a
 * task switcher, and this app is one people leave open beside their work. So the title
 * carries the location — the record, the screen, the project — and then the vault, because
 * "which data am I looking at" is the question a portable vault invents.
 *
 * Both shells are handled here: `document.title` for browser mode, and the native window
 * title through Tauri, which does not read the document at all.
 */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useApp } from "../AppContext";
import { isTauri } from "./api";

const APP = "AgentMonitoring";

const SCREEN: Record<string, string> = {
  work: "Work",
  bugs: "Bugs",
};

export function useWindowTitle() {
  const location = useLocation();
  const { vault, projects } = useApp();

  useEffect(() => {
    const parts = location.pathname.split("/").filter(Boolean);
    const slug = parts[0] === "p" ? parts[1] : undefined;
    const project = projects.find((p) => p.slug === slug);

    let where: string;
    if (parts[0] === "projects") where = "Projects";
    else if (!slug) where = "";
    else {
      const name = project?.name ?? slug;
      const screen = parts[2] ? (SCREEN[parts[2]] ?? parts[2]) : null;
      const record = parts[3]?.toUpperCase();
      where = record
        ? `${record} · ${name}`
        : screen
          ? `${screen} · ${name}`
          : name;
    }

    /* The vault's name only when it is not the app's own: this app's vault is called
       "AgentMonitoring", and "Projects · AgentMonitoring — AgentMonitoring" is a title bar
       saying one thing three times. */
    const vaultName = vault?.name && vault.name !== APP ? ` — ${vault.name}` : "";
    const title = where ? `${where} · ${APP}${vaultName}` : `${APP}${vaultName}`;
    document.title = title;
    if (isTauri()) {
      import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title))
        .catch(() => {
          /* an older webview, or no window: the document title is still right */
        });
    }
  }, [location.pathname, projects, vault?.name]);
}
