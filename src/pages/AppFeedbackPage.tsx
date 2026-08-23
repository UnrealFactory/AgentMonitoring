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
import { BoardHumanNotice, HumanArea, RecordViewToggle } from "../components/HumanView";
import { hasHumanArea } from "../lib/human";
import { useRecordView } from "../lib/recordView";
import { Markdown } from "../lib/markdown";
import { useNow } from "../components/charts";
import { formatDateTimeUtc, formatRelative } from "../lib/format";
import { t } from "../lib/i18n";
import type { FeedbackItem, FeedbackKind } from "../lib/types";
import { tablistKeys } from "../lib/tablist";

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
     row's: one control, and every row swaps to the same half.
     ------------------------------------------------------------------------------------
     What the default reads is the whole board, not any one row of it. A detail screen's
     rule — "the retelling, if there is one" — is a question about one record and has one
     answer; asked of N records with `.some()` it lets a single retold row decide the
     opening view for all the others, and SPEC guarantees that mixed board exists (an item
     filed before this rule gains its human area through `app-feedback update`). One item
     of five opening the board onto four absences and one story is not "the retelling if
     there is one to show" — it is the retelling if *anyone* has one. So the board opens on
     the half most of it is written in, and ties (2 of 4) fall to the agent half, which is
     the half every item is guaranteed to have. */
  const retold = filtered.filter((f) => hasHumanArea(f.human));
  const missing = filtered.filter((f) => !hasHumanArea(f.human));
  const mostlyRetold = filtered.length > 0 && retold.length * 2 > filtered.length;
  const { view, choose } = useRecordView(data ? mostlyRetold : null, "app-feedback");
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
        <div className="segmented" role="tablist" aria-label={t("filter.byType")} onKeyDown={tablistKeys}>
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
          {/* `is-thin` is the "nothing under here" marker, so it reads the *none* case —
              which is not the same question as the default's. A board where one of five
              rows is retold has something under the segment and is not mostly it; the
              count says which, before the press rather than after. */}
          <RecordViewToggle
            view={view}
            onChange={choose}
            hasHuman={retold.length > 0}
            retold={{ has: retold.length, of: filtered.length }}
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
        <>
          {/* One board, one instruction (components/HumanView.tsx). Only on the half it is
              about, and only while there is a row it is about. */}
          {human && missing.length > 0 && (
            <BoardHumanNotice
              kind="feedback"
              missing={missing.length}
              total={filtered.length}
              sample={{ id: missing[0].id, agent: missing[0].agent }}
            />
          )}
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
                    up its frame (.feedback-human, src/styles/app.css).

                    A row with no retelling says so in one line and stops there: what to do
                    about it is the board's notice above, not five copies of itself. */}
                {human ? (
                  hasHumanArea(f.human) ? (
                    <div className="feedback-body feedback-human">
                      {/* No way-out button on a row: the box that carries one is a *screen's*
                          answer and is not drawn here, and the one control this board has is
                          the toggle over all of it (components/HumanView.tsx). */}
                      <HumanArea human={f.human} kind="feedback" id={f.id} agent={f.agent} />
                    </div>
                  ) : (
                    <p className="feedback-body feedback-none">{t("fb.noHuman")}</p>
                  )
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
        </>
      )}
    </div>
  );
}
