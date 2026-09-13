/**
 * "시작 시 자동 실행" — the login-time start, told from the sidebar's foot.
 *
 * Desktop only: the browser twin has no login to start with, so it draws nothing. The
 * switch reads the real registration (Windows: the HKCU Run key, src-tauri/src/lib.rs
 * `get_autostart`) rather than a saved preference, so what it shows is what the next
 * login will do. Flipping it writes the registration and then re-reads it; a refusal
 * leaves the switch where it was and says why underneath. A launch that came from the
 * registration stays in the tray — the window opens from the tray icon, as after a close.
 */
import { useEffect, useState } from "react";
import { api, isTauri } from "../lib/api";
import { t } from "../lib/i18n";

export function Autostart() {
  /** `null` until the registration has been read — and if it cannot be, no switch. */
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    api
      .getAutostart()
      .then((on) => {
        if (alive) setEnabled(on);
      })
      .catch(() => {
        if (alive) setEnabled(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!isTauri() || enabled === null) return null;

  const toggle = () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    api
      .setAutostart(!enabled)
      .then(setEnabled)
      .catch((e) => setFailure(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="autostart">
      <button
        type="button"
        className="autostart-switch"
        role="switch"
        aria-checked={enabled}
        aria-describedby={failure ? "autostart-failure" : undefined}
        title={t("autostart.hint")}
        disabled={busy}
        onClick={toggle}
      >
        <span className="autostart-track" aria-hidden="true">
          <span className="autostart-knob" />
        </span>
        <span className="autostart-label">{t("autostart.label")}</span>
      </button>
      {failure && (
        <p className="autostart-failure" id="autostart-failure">
          {`${t("autostart.failed")} — ${failure}`}
        </p>
      )}
    </div>
  );
}
