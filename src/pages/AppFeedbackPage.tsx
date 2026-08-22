/**
 * The App feedback board: bugs and wishes agents filed about this app itself.
 *
 * The one screen whose subject is the tool rather than a project. Items are
 * machine-level (`~/.AgentMonitoring/feedback`, beside the registry), filed by agents
 * through the `app_feedback` MCP tool or `agentmon app-feedback add`, and worked here
 * (or by a delegated agent over the CLI): read, fix, mark done — then clear. Done items
 * sink dimmed to the bottom; Reopen undoes a wrong close; Delete removes a done item
 * for good, and only a done one, so a complaint can never vanish unread.
 */
import { useMemo, useState } from "react";
import { useApp, useDataNonce } from "../AppContext";
import { api, failureTitle, nothingToRetry } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useUrlFilters } from "../lib/useUrlFilters";
import { AgentChip, EmptyState, ErrorState, InlineCode, RichText, Skeleton } from "../components/ui";
import { HumanArea, RecordViewToggle } from "../components/HumanView";
import { hasHumanArea } from "../lib/human";
import { useRecordView } from "../lib/recordView";
import { Markdown } from "../lib/markdown";
import { useNow } from "../components/charts";
import { formatDateTimeUtc, formatRelative } from "../lib/format";
import { t } from "../lib/i18n";
import type { FeedbackItem, FeedbackKind } from "../lib/types";

const KINDS: (FeedbackKind | "all")[] = ["all", "bug", "idea"];
const kindText = (k: string): string =>
  k === "bug" ? t("fb.kindBug") : k === "idea" ? t("fb.kindIdea") : t("filter.all");

const DEFAULTS = { type: "all" };
const ALLOWED = { type: ["all", "bug", "idea"] } as const;

export function AppFeedbackPage() {
  /* refresh() bumps the app-wide nonce, which is what the sidebar's open count listens
     to — without it, marking an item done here left the old number standing out there. */
  const { refresh } = useApp();
  const { data, error, status, loading, reload } = useAsync(
    () => api.listAppFeedback(),
    [],
    useDataNonce()
  );
  const { values, set } = useUrlFilters(DEFAULTS, ALLOWED);
  const kind = values.type as FeedbackKind | "all";
  const now = useNow(60_000);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /* The delete button arms on the first click and deletes on the second — the light
     version of the project-delete dialog, for a row that must already be done. */
  const [armed, setArmed] = useState<string | null>(null);

  const items = useMemo(() => data ?? [], [data]);
  const counts = useMemo(() => {
    const by: Record<string, number> = { all: items.length, bug: 0, idea: 0 };
    for (const f of items) by[f.type] += 1;
    return by;
  }, [items]);
  const open = items.filter((f) => f.status === "open").length;
  const filtered = kind === "all" ? items : items.filter((f) => f.type === kind);
  /* The board is a list of small records, so its toggle is the board's rather than each
     row's: one control, and every row swaps to the same half. The default follows the same
     rule a detail screen's does — the retelling if there is one to show. */
  const { view, choose } = useRecordView(
    data ? items.some((f) => hasHumanArea(f.human)) : null,
    "app-feedback"
  );
  const human = view === "human";

  const toggle = async (f: FeedbackItem) => {
    setBusyId(f.id);
    setActionError(null);
    setArmed(null);
    try {
      await api.setAppFeedbackStatus(f.id, f.status === "open" ? "done" : "open");
      reload();
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (f: FeedbackItem) => {
    if (armed !== f.id) {
      setArmed(f.id);
      return;
    }
    setBusyId(f.id);
    setActionError(null);
    try {
      await api.deleteAppFeedback(f.id);
      setArmed(null);
      reload();
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  if (error) {
    return (
      <div className="page">
        <ErrorState
          title={failureTitle(error, status)}
          message={error}
          onRetry={nothingToRetry(error, status) ? undefined : reload}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">{t("fb.title")}</h1>
          <p className="page-sub">{t("fb.sub")}</p>
        </div>
        <div className="page-head-meta tabular">
          {loading ? t("app.loadingShort") : t("fb.count", items.length, open)}
        </div>
      </header>

      <div className="toolbar">
        <div className="segmented" role="tablist" aria-label={t("filter.byType")}>
          {KINDS.map((k) => (
            <button
              key={k}
              role="tab"
              data-value={k}
              aria-selected={kind === k}
              className={`segment${kind === k ? " is-active" : ""}`}
              onClick={() => set("type", k)}
            >
              {kindText(k)}
              <span className="segment-count tabular">{counts[k] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <RecordViewToggle
            view={view}
            onChange={choose}
            hasHuman={items.some((f) => hasHumanArea(f.human))}
          />
        </div>
      </div>

      {actionError && (
        <p className="form-error" role="alert">
          <InlineCode text={actionError} />
        </p>
      )}

      {loading ? (
        <Skeleton rows={4} />
      ) : filtered.length === 0 ? (
        items.length === 0 ? (
          <EmptyState title={t("fb.emptyTitle")} hint={<RichText text={t("fb.emptyHint")} />} />
        ) : (
          <EmptyState title={t("fb.noMatch")} />
        )
      ) : (
        <div className="feedback-list">
          {filtered.map((f) => (
            <article
              key={f.id}
              className={`feedback-row${f.status === "done" ? " is-done" : ""}`}
            >
              <div className="feedback-head">
                <span className={`fb-kind fb-kind-${f.type}`}>{kindText(f.type)}</span>
                <h2 className="feedback-title">{f.title}</h2>
                <span className="feedback-id tabular">{f.id}</span>
              </div>
              {/* The item's two halves, the same way a record's detail screen draws them:
                  what the agent filed, or the same wish said for the person who has to
                  decide about it. The row itself is the card, so the sheet inside it gives
                  up its frame (.feedback-human, src/styles/app.css). */}
              {human ? (
                <div className="feedback-body feedback-human">
                  <HumanArea
                    human={f.human}
                    kind="feedback"
                    id={f.id}
                    agent={f.agent}
                    onShowAgent={() => choose("agent")}
                  />
                </div>
              ) : (
                f.body && (
                  <div className="feedback-body">
                    <Markdown source={f.body} />
                  </div>
                )
              )}
              <div className="feedback-meta">
                <AgentChip name={f.agent} />
                <time
                  className="feedback-time tabular"
                  dateTime={f.created}
                  title={formatDateTimeUtc(f.created)}
                >
                  {formatRelative(f.created, new Date(now))}
                </time>
                {f.status === "done" && f.done && (
                  <span className="feedback-done-at" title={formatDateTimeUtc(f.done)}>
                    {t("fb.doneOn", formatRelative(f.done, new Date(now)))}
                  </span>
                )}
                <span className="feedback-actions">
                  <button
                    className="button"
                    onClick={() => toggle(f)}
                    disabled={busyId === f.id}
                  >
                    {f.status === "open" ? t("fb.markDone") : t("fb.reopen")}
                  </button>
                  {/* Delete exists only on a done row: the path is always read → done →
                      delete, so an open complaint cannot vanish unread (core refuses it
                      too). Two clicks, the second armed and red. */}
                  {f.status === "done" && (
                    <button
                      className={`button${armed === f.id ? " button-danger" : ""}`}
                      onClick={() => remove(f)}
                      disabled={busyId === f.id}
                      title={t("fb.deleteTip")}
                    >
                      {armed === f.id ? t("fb.deleteArmed") : t("fb.delete")}
                    </button>
                  )}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
