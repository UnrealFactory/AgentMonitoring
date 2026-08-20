/**
 * The window's own title bar — the desktop app's, not Windows'.
 *
 * The native bar drew an icon and the words "프로젝트 · AgentMonitoring" in Segoe UI on a
 * grey band, three shades and one typeface away from everything under it: the one part of
 * this window that was not this app. `decorations: false` in tauri.conf.json takes it away,
 * and this strip stands in its place.
 *
 * What it is: 34px of nothing, with three buttons at the right end. No app name, no icon,
 * no menu — the sidebar already says which app this is, and the screen already says where
 * you are. The **taskbar and Alt+Tab still get the full title**, which is a different
 * surface and a different job (lib/useWindowTitle.ts sets it, and none of that changed).
 *
 * What it is not: a place. It carries `data-tauri-drag-region`, so the strip is the window
 * handle — drag it and the window moves, double-click it and the window maximises, exactly
 * as the native bar behaved. Tauri's own drag script does both (tauri/src/window/scripts/
 * drag.js): a bare attribute means *this element only*, and the three buttons are `<button>`
 * elements, which that script treats as clickable and never as a handle. That is why they
 * are direct children of the strip rather than sitting in a wrapper: a wrapper would be a
 * child element with no attribute of its own, and the gap around the buttons would stop
 * dragging the window. The rail that continues the sidebar's colour is a `::before`, which
 * is paint rather than an element, so it cannot break that either.
 *
 * Rendered only when {@link isTauri} (src/App.tsx). Browser mode has a real browser frame
 * around it and must stay pixel-identical to what every screenshot gate has recorded.
 *
 * ## The four commands, and the capability behind them
 *
 * `start_dragging` (the attribute), `minimize`, `toggle_maximize` and `close` are each
 * granted by name in src-tauri/capabilities/default.json. Two more that this file needs are
 * already in `core:window:default`, which `core:default` bundles, so they are not repeated
 * there: `is_maximized` (which glyph the middle button shows) and `internal_toggle_maximize`
 * (what a double-click on the drag region invokes). Both were read out of
 * src-tauri/gen/schemas/acl-manifests.json rather than assumed.
 *
 * A denied command is reported, never swallowed: this app has already shipped a round with
 * a silently rejected `set_title` (see lib/useWindowTitle.ts), and a window button that does
 * nothing is the same failure with a bigger blast radius.
 */
import { useEffect, useState } from "react";
import { t, useLocale } from "../lib/i18n";

/** Ask the window to do something, and say so out loud when it will not. */
async function ask(action: "minimize" | "toggleMaximize" | "close", permission: string) {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow()[action]();
  } catch (err) {
    console.warn(
      `agentmonitoring: the window would not ${action}. Check core:window:${permission} in ` +
        `src-tauri/capabilities/default.json.`,
      err
    );
  }
}

export function Titlebar() {
  /* The buttons are words to a screen reader, so the strip repaints with the language —
     the shell around it does not re-render this component for anything else. */
  useLocale();
  const [maximized, setMaximized] = useState(false);

  /*
   * Which glyph the middle button wears is a fact about the window, and the window is not
   * only changed from here: Win+↑, a double-click on the strip, a drag off the top of the
   * screen and the aero-snap corners all maximise or restore it. So the state is read from
   * the window itself and re-read on every resize — `onResized` fires for maximise, restore
   * and snap alike — rather than toggled optimistically on click, which would be a lie the
   * first time somebody used the keyboard.
   */
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const read = async () => {
          const is = await win.isMaximized();
          if (!cancelled) setMaximized(is);
        };
        await read();
        const un = await win.onResized(() => void read());
        // Unmounted while the listener was still being registered (StrictMode does exactly
        // this in dev): drop it rather than leaving an orphan behind.
        if (cancelled) un();
        else unlisten = un;
      } catch (err) {
        console.warn(
          "agentmonitoring: could not follow the window's maximised state — the middle " +
            "button will keep showing the maximise glyph.",
          err
        );
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const restore = maximized ? t("window.restore") : t("window.maximize");

  return (
    <div className="titlebar" data-tauri-drag-region>
      <button
        type="button"
        className="titlebar-button"
        aria-label={t("window.minimize")}
        title={t("window.minimize")}
        onClick={() => void ask("minimize", "allow-minimize")}
      >
        <svg className="titlebar-glyph" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path d="M1.5 6.5h9" />
        </svg>
      </button>
      <button
        type="button"
        className="titlebar-button"
        aria-label={restore}
        title={restore}
        onClick={() => void ask("toggleMaximize", "allow-toggle-maximize")}
      >
        {maximized ? (
          <svg className="titlebar-glyph" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            {/* the sheet in front, and the one behind it that is still half visible */}
            <path d="M1.5 4.5h6v6h-6z" />
            <path d="M4.5 4.5v-3h6v6h-3" />
          </svg>
        ) : (
          <svg className="titlebar-glyph" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path d="M1.5 1.5h9v9h-9z" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="titlebar-button titlebar-close"
        aria-label={t("window.close")}
        title={t("window.close")}
        onClick={() => void ask("close", "allow-close")}
      >
        <svg className="titlebar-glyph" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <path d="M1.7 1.7l8.6 8.6M10.3 1.7l-8.6 8.6" />
        </svg>
      </button>
    </div>
  );
}
