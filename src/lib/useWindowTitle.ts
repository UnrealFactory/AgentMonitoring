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
import { t } from "./i18n";

const APP = "AgentMonitoring";

/** The screen's own name, in the language on screen — "Work · relay" / "작업 · relay". */
const screenName = (segment: string): string =>
  segment === "work"
    ? t("nav.work")
    : segment === "bugs"
      ? t("nav.bugs")
      : segment === "notes"
        ? t("nav.notes")
        : segment;

export function useWindowTitle() {
  const location = useLocation();
  const { projects, locale } = useApp();

  useEffect(() => {
    const parts = location.pathname.split("/").filter(Boolean);
    const id = parts[0] === "p" ? parts[1] : undefined;
    const project = projects.find((p) => p.id === id);

    let where: string;
    if (parts[0] === "projects") where = t("nav.projects");
    else if (!id) where = "";
    else {
      const name = project?.name ?? id;
      const screen = parts[2] ? screenName(parts[2]) : null;
      /* WORK-0012 and BUG-0004 are ids and wear their canonical upper case; a note's name
         is a kebab word and upper-casing it would print REGISTRY-GATE-GOTCHA in the task
         switcher — a name nobody typed. */
      const record =
        parts[3] && (parts[2] === "notes" ? parts[3] : parts[3].toUpperCase());
      where = record
        ? `${record} · ${name}`
        : screen
          ? `${screen} · ${name}`
          : name;
    }

    const title = where ? `${where} · ${APP}` : APP;
    document.title = title;
    if (isTauri()) {
      import("@tauri-apps/api/window")
        .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(title))
        .catch((err) => {
          /* The document title is still right, so nothing on screen is wrong — but this is
             exactly how the packaged app came to sit on a bare "AgentMonitoring" for a
             whole round: `core:window:allow-set-title` was not in the capability, every
             call was denied, and a bare `.catch(() => {})` ate the rejection while browser
             mode (which never makes the call) passed every gate (P6 round 2 desktop
             critic). A swallowed permission error is a silent feature. */
          console.warn(
            `agentmonitoring: could not set the window title to "${title}" — the document ` +
              `title is still correct. Check core:window:allow-set-title in ` +
              `src-tauri/capabilities/default.json.`,
            err
          );
        });
    }
    // `locale` is in the dependency list because the title is words: the window in the task
    // switcher has to change language with the screen it names.
  }, [location.pathname, projects, locale]);
}
