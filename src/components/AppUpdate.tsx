/**
 * The app's own update, told from the sidebar's foot.
 *
 * Desktop only, and quiet by design: on launch (and every half hour) the Rust side asks
 * GitHub Releases whether a newer version exists (src-tauri/src/update.rs); the ordinary
 * answer — up to date, offline, nothing published — draws nothing at all. Only an actual
 * newer release earns a card, and the card's button hands off to a splash window
 * ("updating to the new version…") while a hidden worker downloads the installer,
 * reinstalls, and relaunches — this window closes underneath it. "나중에" folds the card
 * for this run; the next launch (or a newer release) brings it back.
 */
import { useEffect, useState } from "react";
import { api, isTauri, type UpdateInfo } from "../lib/api";
import { t } from "../lib/i18n";

/** Between rechecks. One check is one small GET — half an hour notices a same-day
    release without waking the network every few minutes. */
const RECHECK_MS = 30 * 60 * 1000;

const mb = (bytes: number | null): string | null =>
  bytes == null ? null : `${(bytes / 1048576).toFixed(1)} MB`;

export function AppUpdate() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  /** The version the reader folded away — a *newer* one still surfaces. */
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    const check = () =>
      api.checkAppUpdate().then((next) => {
        // `null` is "could not check" — keep whatever the last good answer was.
        if (alive && next) setInfo(next);
      });
    check();
    const timer = setInterval(check, RECHECK_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // Nothing to say: no newer release, or a release with no installer asset to run.
  if (!info || !info.hasUpdate || !info.installerUrl) return null;
  // Folded away — until the next launch, or a release newer than the one dismissed.
  if (dismissed === info.latest && !applying) return null;

  const size = mb(info.installerSize);
  const install = () => {
    setFailure(null);
    setApplying(true);
    api.installAppUpdate(info.installerUrl!, info.latest).catch((e) => {
      // The updater refused to start — the app is *not* exiting, so give the card back.
      setApplying(false);
      setFailure(e instanceof Error ? e.message : String(e));
    });
  };

  return (
    <div className="app-update" role="status">
      <div className="app-update-head">
        <span className="app-update-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <path
              d="M8 2.5 V10 M4.8 7 L8 10.2 L11.2 7 M3 12.5 H13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="app-update-text">
          <span className="app-update-title">{t("update.title")}</span>
          <span className="app-update-meta tabular" title={info.notes || undefined}>
            {`v${info.current} → v${info.latest}`}
            {size ? ` · ${size}` : ""}
          </span>
        </span>
      </div>
      {failure && <p className="app-update-failure">{`${t("update.failed")} — ${failure}`}</p>}
      {applying ? (
        <p className="app-update-applying">{t("update.applying")}</p>
      ) : (
        <div className="app-update-actions">
          <button className="app-update-later" onClick={() => setDismissed(info.latest)}>
            {t("update.later")}
          </button>
          <button className="app-update-go" onClick={install}>
            {t("update.go")}
          </button>
        </div>
      )}
    </div>
  );
}
