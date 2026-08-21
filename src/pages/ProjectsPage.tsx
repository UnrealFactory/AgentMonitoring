/**
 * Projects — every AgentMonitoring folder this machine knows about.
 *
 * This is the screen that has to make the app's central claim true: a project's records
 * are one folder of plain files living inside the repo they describe, so they travel with
 * the code — commit the folder, clone the repo elsewhere, open it here. That means three
 * things have to be visible and workable here rather than documented elsewhere — which
 * folders are on the list and where they are, how to open another one, and how to start a
 * new project in a repo.
 *
 * Everything that writes goes through the same `agentmon-core` code the CLI writes with
 * (see src/lib/api.ts), so a project created here is indistinguishable from one an agent
 * created at a terminal, event log included.
 *
 * The projects are laid out as full-width rows, not as a card grid: the row is the form
 * this app already uses for "a list of things you can open". An *unavailable* row — an
 * unplugged drive, a moved folder — stays on the list, dimmed, with the name the registry
 * last saw and a Remove action: a row that silently vanished would look exactly like a
 * project that never existed.
 */
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp, useDataNonce } from "../AppContext";
import { CommandLine, ErrorState, InlineCode, RichText, Skeleton, Tag } from "../components/ui";
import { useContextMenu } from "../components/ContextMenu";
import { useDeleteProject } from "../components/DeleteProject";
import { recordKind, useProjectMenu, useRecordMenu, type RecordRef } from "../lib/menus";
import { EventIcon } from "../components/EventIcon";
import { useNow } from "../components/charts";
import { api, projectErrorMessage } from "../lib/api";
import { eventSummary, eventVerb, freshness, refHref, tone, verbAfterRef } from "../lib/dashboard";
import { formatDate, formatDateTimeUtc, formatRelative } from "../lib/format";
import { t } from "../lib/i18n";
import { done, inProgress, unresolvedLabel, unresolvedMeans } from "../lib/words";
import { useAsync } from "../lib/useAsync";
import type { Project, ProjectRow as Row, VaultEvent } from "../lib/types";

export function ProjectsPage() {
  const { rows, projects, loading, error, reload, refresh, transport } = useApp();
  const navigate = useNavigate();
  const now = useNow(60_000);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  /* The list itself failing to load is not an empty list: the screen says so, with the
     ways out — Try again, and (on the desktop) the buttons that change what is on the
     list. Per-folder failures are not this; they are unavailable rows below. */
  if (error) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <h1 className="page-title">{t("proj.title")}</h1>
            <p className="page-sub">{t("proj.sub")}</p>
          </div>
        </header>
        <ErrorState
          title={t("proj.readFailed")}
          message={error}
          onRetry={reload}
          action={
            transport === "tauri" ? (
              <OpenProjectButton onDone={refresh} onError={setActionError} />
            ) : undefined
          }
        />
        {actionError && (
          <p className="form-error" role="alert">
            <InlineCode text={projectErrorMessage(actionError)} />
          </p>
        )}
        <Onboarding hasProjects={false} canCreate={false} transport={transport} />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">{t("proj.title")}</h1>
          <p className="page-sub">
            <RichText text={t("proj.sub")} />
          </p>
        </div>
        <div className="page-head-actions">
          {transport === "tauri" && (
            <OpenProjectButton
              onDone={(project) => {
                refresh();
                if (project) navigate(`/p/${project.id}`);
              }}
              onError={setActionError}
            />
          )}
          <button className="button button-primary" onClick={() => setCreating((v) => !v)}>
            {t("proj.new")}
          </button>
        </div>
      </header>

      {actionError && (
        <p className="form-error" role="alert">
          <InlineCode text={projectErrorMessage(actionError)} />
        </p>
      )}

      {creating && (
        <CreateProject
          transport={transport}
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            refresh();
            // Straight into the project that was just made: the next thing anybody does
            // with a new project is look at it.
            navigate(`/p/${id}`);
          }}
        />
      )}

      {loading && rows.length === 0 ? (
        <Skeleton rows={3} />
      ) : rows.length === 0 ? (
        <Onboarding hasProjects={false} canCreate transport={transport} />
      ) : (
        <>
          <section className="project-section">
            <header className="project-section-head">
              <h2 className="section-title">{t("proj.inVault")}</h2>
              <span className="section-count tabular">{t("proj.count", rows.length)}</span>
            </header>
            <ul className="project-rows">
              {rows.map((row) =>
                row.available && row.project ? (
                  <AvailableRow
                    key={row.project.id}
                    project={row.project}
                    now={now}
                    transport={transport}
                    onError={setActionError}
                    onChanged={refresh}
                  />
                ) : (
                  <UnavailableRow
                    key={row.path}
                    row={row}
                    transport={transport}
                    onError={setActionError}
                    onChanged={refresh}
                  />
                )
              )}
            </ul>
          </section>

          {projects.length === 0 && rows.length > 0 ? null : (
            <AllProjectsActivity projects={projects} now={now} />
          )}
          {/* A list with rows but nothing readable still deserves the how-to. */}
          {projects.length === 0 && (
            <Onboarding hasProjects={false} canCreate transport={transport} />
          )}
        </>
      )}
    </div>
  );
}

/* ==========================================================================
   Opening an existing project
   ======================================================================= */

/**
 * The desktop's picker for a project that already exists somewhere on this machine — a
 * repo cloned from another computer, a drive plugged back in. Registers it and shows it.
 */
function OpenProjectButton({
  onDone,
  onError,
}: {
  onDone: (project: Project | null) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="button"
      disabled={busy}
      title={t("proj.openTip")}
      onClick={async () => {
        setBusy(true);
        try {
          const project = await api.openProject();
          // null is a dismissed dialog, which is not an event worth reporting.
          if (project) onDone(project);
        } catch (err) {
          onError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? t("proj.opening") : t("proj.openFolder")}
    </button>
  );
}

/* ==========================================================================
   One project
   ======================================================================= */

function AvailableRow({
  project: p,
  now,
  transport,
  onError,
  onChanged,
}: {
  project: Project;
  now: number;
  transport: "tauri" | "browser";
  onError: (message: string) => void;
  onChanged: () => void;
}) {
  /* The row says "Last activity 3h ago" rather than "Active 3h ago": in this app `active`
     was once a project's *status*, and one word may not also mean "somebody wrote
     something recently" (lib/words.ts). */
  const state = freshness(p.counts.lastActivity, now);
  const c = p.counts;

  /* The row's own menu — the same one the sidebar, the switcher and every breadcrumb open,
     built in one place (lib/menus.ts). The Delete item in it opens the confirm dialog,
     which is mounted above every screen (components/DeleteProject.tsx) because the menu is
     not this screen's. */
  const contextMenu = useContextMenu();
  const projectMenu = useProjectMenu();
  const requestDelete = useDeleteProject();

  return (
    <li>
      <article className="project-row" {...contextMenu(() => projectMenu(p))}>
        <div className="project-row-main">
          <div className="project-row-head">
            <Link className="project-link" to={`/p/${p.id}`}>
              <span
                className={`sdot sdot-${state}`}
                title={
                  c.lastActivity
                    ? t("dash.lastActivityTip", formatDateTimeUtc(c.lastActivity))
                    : t("proj.nothingRecordedYet")
                }
                role="img"
                aria-label={
                  state === "live"
                    ? t("proj.dotLive")
                    : state === "quiet"
                      ? t("proj.dotQuiet")
                      : t("proj.dotStale")
                }
              />
              <span className="project-name">{p.name}</span>
            </Link>
            {/* The folder, where the slug used to be: the fact that tells two projects
                with one name apart is where each one lives. */}
            <span className="project-slug mono" title={p.path}>
              {p.path}
            </span>
            {p.tags.length > 0 && (
              <span className="tag-row">
                {p.tags.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </span>
            )}
          </div>

          {/* Never clamped. A one-or-two-sentence description cut to "In GA hardenin…" is
              the same defect the bug board was pulled up on: the row is as wide as the
              window, so it wraps instead. */}
          <p className="project-desc">
            {p.description || (
              <span className="project-desc-none">{t("proj.noDescription")}</span>
            )}
          </p>
        </div>

        <dl className="project-figures">
          <div className="project-figure">
            <dt>{t("proj.workLogs")}</dt>
            <dd className="tabular">{c.workTotal}</dd>
            <span className="project-figure-note">
              {c.workTotal === 0
                ? t("proj.noneYet")
                : t("proj.workNote", c.workDone, c.workInProgress, done(), inProgress())}
            </span>
          </div>
          <div
            className="project-figure"
            title={t("bugs.unresolvedMeansTip", unresolvedLabel(), unresolvedMeans())}
          >
            <dt>{t("proj.unresolvedBugs")}</dt>
            <dd className={`tabular${c.bugsOpen === 0 ? " is-zero" : ""}`}>{c.bugsOpen}</dd>
            <span className="project-figure-note">
              {c.bugsTotal === 0 ? t("proj.noneFiled") : t("proj.ofFiled", c.bugsTotal)}
            </span>
          </div>
          <div className="project-figure">
            <dt>{t("proj.events")}</dt>
            <dd className="tabular">{c.events}</dd>
            <span className="project-figure-note">{t("proj.eventsNote")}</span>
          </div>
        </dl>

        <div className="project-row-end">
          <span className="project-when tabular">
            {c.lastActivity ? (
              <>
                {t("proj.lastActivity")}
                {formatRelative(c.lastActivity, new Date(now))}
                <span className="project-since">
                  {t("proj.startedOn", formatDate(p.createdAt))}
                </span>
              </>
            ) : (
              <>
                {t("proj.noActivity")}
                <span className="project-since">
                  {t("proj.createdOn", formatDate(p.createdAt))}
                </span>
              </>
            )}
          </span>
          {/* The two ways off this list, side by side and nothing alike: Remove keeps every
              file and can be undone by opening the folder again, Delete is the app's one
              destructive act and opens the dialog that says so. Visible here without a
              right-click, because this is the screen a reader comes to *to manage*
              projects, and an action that exists only behind a gesture is an action half
              the readers of this app will never find. */}
          <span className="project-actions">
            {transport === "tauri" && (
              <RemoveButton path={p.path} onError={onError} onChanged={onChanged} />
            )}
            <button
              className="link-button is-danger"
              onClick={() => requestDelete(p)}
              title={t("menu.deleteHint")}
            >
              {t("menu.delete")}
            </button>
          </span>
        </div>
      </article>
    </li>
  );
}

/**
 * A registered path whose folder cannot be read right now — an unplugged drive, a moved
 * folder, a repo whose AgentMonitoring folder was deleted by hand. The row stays, dimmed,
 * so the reader can see *what* is missing; Remove is the way to say it is gone for good.
 */
function UnavailableRow({
  row,
  transport,
  onError,
  onChanged,
}: {
  row: Row;
  transport: "tauri" | "browser";
  onError: (message: string) => void;
  onChanged: () => void;
}) {
  return (
    <li>
      <article className="project-row is-unavailable" title={t("proj.unavailableHint")}>
        <div className="project-row-main">
          <div className="project-row-head">
            <span className="project-link">
              <span className="sdot sdot-stale" role="img" aria-label={t("proj.unavailable")} />
              <span className="project-name">{row.name ?? t("proj.unavailable")}</span>
            </span>
            <span className="project-slug mono" title={row.path}>
              {row.path}
            </span>
          </div>
          <p className="project-desc">
            <span className="project-desc-none">
              {row.error ? projectErrorMessage(row.error) : t("proj.unavailableHint")}
            </span>
          </p>
        </div>
        <div className="project-row-end">
          <span className="project-actions">
            {transport === "tauri" && (
              <RemoveButton path={row.path} onError={onError} onChanged={onChanged} />
            )}
          </span>
        </div>
      </article>
    </li>
  );
}

function RemoveButton({
  path,
  onError,
  onChanged,
}: {
  path: string;
  onError: (message: string) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="link-button"
      disabled={busy}
      title={t("proj.removeHint")}
      onClick={async () => {
        setBusy(true);
        try {
          await api.removeProject(path);
          onChanged();
        } catch (err) {
          onError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {t("proj.remove")}
    </button>
  );
}

/* ==========================================================================
   Every project, as one timeline
   ======================================================================= */

/**
 * Every readable project's events, merged.
 *
 * The per-project dashboards answer "what is happening here"; this screen is the only
 * place that can answer "what is happening at all" — which is the question somebody
 * arriving at the app with two projects actually has. Bounded per project (SPEC v2,
 * performance): the merge reads a tail of each feed, never a whole history.
 */
function AllProjectsActivity({ projects, now }: { projects: Project[]; now: number }) {
  const nonce = useDataNonce();
  const key = projects.map((p) => p.id).join(",");
  const feed = useAsync(
    async () => {
      const per = await Promise.all(
        projects.map(async (p) =>
          (await api.listEvents(p.id, 12)).map((event) => ({ event, project: p }))
        )
      );
      return per
        .flat()
        .sort((a, b) => b.event.ts.localeCompare(a.event.ts))
        .slice(0, 12);
    },
    [key],
    nonce
  );

  if (!projects.length) return null;

  return (
    <section className="project-section">
      <header className="project-section-head">
        <h2 className="section-title">{t("proj.acrossVault")}</h2>
        <span className="section-count tabular">
          {feed.data?.length ? t("proj.newest", feed.data.length) : t("proj.recent")}
        </span>
      </header>
      {feed.loading && !feed.data ? (
        <Skeleton rows={4} />
      ) : !feed.data?.length ? (
        <p className="now-note">
          {t("proj.vaultEmptyFeed")} <code>agentmon work start</code>{" "}
          {t("proj.vaultEmptyFeedTail")}
        </p>
      ) : (
        <ol className="vault-feed">
          {feed.data.map(({ event, project }, i) => (
            <FeedRow
              key={`${project.id}-${event.ts}-${event.ref ?? ""}-${i}`}
              event={event}
              project={project}
              now={now}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * One line of that timeline — the dashboard's feed rows read across every project instead
 * of inside one: same class, same layout, same `refHref` destination.
 *
 * The menu is about **what the row points at**, which is the rule everywhere else: a line
 * about a record opens that record's menu, and a line about the project itself — created,
 * renamed — points at the project and opens the project's. So no row in this list is dead.
 *
 * One thing is true here and nowhere else: the row carries the project's name, so the
 * record menu it opens is the only one in the app whose Copy link can name a project other
 * than the one the sidebar is standing in.
 */
function FeedRow({
  event,
  project,
  now,
}: {
  event: VaultEvent;
  project: Project;
  now: number;
}) {
  const recordHref = refHref(project.id, event.ref);
  const href = recordHref ?? `/p/${project.id}`;
  /* No title: this feed reads events, and an event line carries a summary, not a title.
     Copy title reads the record when it is clicked (src/lib/menus.ts) rather than this
     screen reading every project's records in case somebody right-clicks one row. */
  const record: RecordRef | null =
    recordHref && event.ref
      ? { kind: recordKind(event.ref), id: event.ref, projectId: project.id }
      : null;
  const contextMenu = useContextMenu();
  const recordMenu = useRecordMenu();
  const projectMenu = useProjectMenu();
  return (
    <li>
      <Link
        className={`feed-row tone-${tone(event.type)}`}
        to={href}
        {...contextMenu(() => (record ? recordMenu(record) : projectMenu(project)))}
      >
        <span className="feed-icon" aria-hidden="true">
          <EventIcon type={event.type} />
        </span>
        <span className="feed-body">
          {/* Same order rule as the dashboard's feed: Korean closes the clause with the
              verb, so the record it is about comes first. */}
          <span className="feed-head">
            <span className="feed-project">{project.name}</span>
            <span className="feed-actor">{event.actor}</span>
            {verbAfterRef() ? (
              <>
                {event.ref && <span className="feed-ref mono">{event.ref}</span>}
                <span className="feed-verb">{eventVerb(event.type)}</span>
              </>
            ) : (
              <>
                <span className="feed-verb">{eventVerb(event.type)}</span>
                {event.ref && <span className="feed-ref mono">{event.ref}</span>}
              </>
            )}
          </span>
          {event.summary && (
            <span className="feed-summary">{eventSummary(event.summary)}</span>
          )}
        </span>
        <time className="feed-time tabular" dateTime={event.ts} title={formatDateTimeUtc(event.ts)}>
          {formatRelative(event.ts, new Date(now))}
        </time>
      </Link>
    </li>
  );
}

/* ==========================================================================
   Create
   ======================================================================= */

function CreateProject({
  transport,
  onCancel,
  onCreated,
}: {
  transport: "tauri" | "browser";
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [claudeMd, setClaudeMd] = useState<"" | "ko" | "en">("");
  /* On by default: the app is the one party that knows where its bundled mcp/server.mjs
     lives, so registering it here is the difference between tools that are simply there
     and a CLAUDE.md that assigns the agent homework. */
  const [mcpJson, setMcpJson] = useState(true);
  const [mcpAgent, setMcpAgent] = useState("claude");
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const named = name.trim().length > 0;
  const located = location.trim().length > 0;
  const ready = named && located;

  const pick = async () => {
    setPicking(true);
    try {
      const picked = await api.pickProjectLocation();
      if (picked) setLocation(picked);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPicking(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const project = await api.createProject({
        location: location.trim(),
        name: name.trim(),
        description: description.trim(),
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        claudeMd: claudeMd || undefined,
        mcpJson,
        mcpAgent: mcpJson ? mcpAgent.trim() || undefined : undefined,
      });
      onCreated(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <form className="create-panel" onSubmit={submit}>
      <div className="create-head">
        <h2 className="section-title">{t("proj.newTitle")}</h2>
        <p className="create-sub">
          <RichText text={t("proj.form.writes", location.trim() || "<location>")} />{" "}
          <code>agentmon init</code> {t("proj.form.writesTail")}
        </p>
      </div>

      <div className="create-grid">
        <label className="field">
          <span className="field-label">{t("proj.form.name")}</span>
          <input
            className="input"
            autoFocus
            value={name}
            placeholder={t("proj.form.namePlaceholder")}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">{t("proj.form.location")}</span>
          {/* The one field this redesign exists for. On the desktop the picker fills it
              (and typing a path by hand still works); in browser mode there is no native
              dialog, so the path is typed. */}
          <span className="field-with-action">
            <input
              className="input mono"
              value={location}
              placeholder={t("proj.form.locationPlaceholder")}
              aria-invalid={!located && named ? true : undefined}
              onChange={(e) => setLocation(e.target.value)}
            />
            {transport === "tauri" && (
              <button className="button" type="button" disabled={picking} onClick={pick}>
                {t("proj.form.browse")}
              </button>
            )}
          </span>
          <span className={`field-hint${named && !located ? " is-blocking" : ""}`}>
            {named && !located ? t("proj.form.locationNeeded") : t("proj.form.locationHint")}
          </span>
        </label>
        <label className="field field-wide">
          <span className="field-label">{t("proj.form.description")}</span>
          <input
            className="input"
            value={description}
            placeholder={t("proj.form.descriptionPlaceholder")}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="field field-wide">
          <span className="field-label">{t("proj.form.tags")}</span>
          <input
            className="input"
            value={tags}
            placeholder={t("proj.form.tagsPlaceholder")}
            onChange={(e) => setTags(e.target.value)}
          />
        </label>
        <div className="field field-wide claude-md-field">
          <span className="field-label" id="claude-md-label">
            {t("proj.form.claudeMd")}
          </span>
          {/* Each language names itself in its own language, like the locale toggle: the
              label tells you what the generated file will read like. */}
          <div
            className="segmented claude-md-choice"
            role="radiogroup"
            aria-labelledby="claude-md-label"
          >
            {(["", "ko", "en"] as const).map((v) => (
              <button
                key={v || "none"}
                type="button"
                role="radio"
                aria-checked={claudeMd === v}
                className={`segment${claudeMd === v ? " is-active" : ""}`}
                onClick={() => setClaudeMd(v)}
              >
                {v === "" ? t("proj.form.claudeMdNone") : v === "ko" ? "한국어" : "English"}
              </button>
            ))}
          </div>
          <span className="field-hint">{t("proj.form.claudeMdHint")}</span>
        </div>
        <div className="field field-wide claude-md-field">
          <span className="field-label" id="mcp-json-label">
            {t("proj.form.mcpJson")}
          </span>
          <div className="mcp-json-row">
            <div
              className="segmented claude-md-choice"
              role="radiogroup"
              aria-labelledby="mcp-json-label"
            >
              {([true, false] as const).map((v) => (
                <button
                  key={String(v)}
                  type="button"
                  role="radio"
                  aria-checked={mcpJson === v}
                  className={`segment${mcpJson === v ? " is-active" : ""}`}
                  onClick={() => setMcpJson(v)}
                >
                  {v ? t("proj.form.mcpJsonOn") : t("proj.form.mcpJsonOff")}
                </button>
              ))}
            </div>
            {mcpJson && (
              <input
                className="input mcp-agent-input"
                value={mcpAgent}
                aria-label={t("proj.form.mcpAgent")}
                placeholder="claude"
                onChange={(e) => setMcpAgent(e.target.value)}
              />
            )}
          </div>
          <span className="field-hint">{t("proj.form.mcpJsonHint")}</span>
        </div>
      </div>

      {error && (
        <p className="form-error" role="alert">
          <InlineCode text={projectErrorMessage(error)} />
        </p>
      )}

      <div className="create-actions">
        <button className="button button-primary" type="submit" disabled={!ready || busy}>
          {busy ? t("proj.creating") : t("proj.create")}
        </button>
        <button className="button" type="button" onClick={onCancel}>
          {t("app.cancel")}
        </button>
      </div>
    </form>
  );
}

/* ==========================================================================
   Onboarding
   ======================================================================= */

/** A path with a space in it is one argument only if it is quoted. */
const shellArg = (path: string): string => (/\s/.test(path) ? `"${path}"` : path);

/**
 * The first screen of a machine with nothing on the list yet.
 *
 * Not a shrug and an icon: the commands that take a repo from bare to a project with a
 * record in it, in the order they are run, with the real flags. An agent reading the
 * manual and a human reading this screen should be typing the same thing.
 */
function Onboarding({
  hasProjects,
  canCreate,
  transport,
}: {
  hasProjects: boolean;
  canCreate: boolean;
  transport: "tauri" | "browser";
}) {
  /* The installed app ships the CLI beside itself but not on PATH, so a line beginning
     `agentmon` is not a line the reader can run. When the app knows where its binary is,
     the commands name it; in browser mode and in dev builds the bare name is right. */
  const cli = useAsync(() => api.cliPath(), []);
  const agentmon = cli.data ? shellArg(cli.data) : "agentmon";
  /* Where to send a reader who wants the rest of the commands. An installed copy is two
     executables and no docs directory, so the manual is named only where it is: everywhere
     else the pointer is `--help`, which is inside the binary the reader already has. */
  const manual = useAsync(() => api.manualPath(), []);
  return (
    <section className="onboarding">
      <h2 className="onboarding-title">
        {hasProjects ? t("onboard.titleEmpty") : t("onboard.titleNone")}
      </h2>
      <p className="onboarding-sub">
        <RichText text={t("onboard.sub")} />
      </p>
      <ol className="onboarding-steps">
        <li>
          <p className="onboarding-step">{t("onboard.stepProject")}</p>
          <CommandLine
            text={`cd /your/repo && ${agentmon} init --name "Checkout rewrite" --description "Replace the legacy checkout flow."`}
          />
          {canCreate && (
            <p className="onboarding-note">
              <RichText text={t("onboard.noteNewProject")} />
            </p>
          )}
        </li>
        <li>
          <p className="onboarding-step">{t("onboard.stepWork")}</p>
          <CommandLine
            text={`${agentmon} work start --agent your-agent --title "Port the cart summary" --body-file note.md`}
          />
          <p className="onboarding-note">
            <RichText text={t("onboard.noteBody")} />
          </p>
        </li>
      </ol>
      {cli.data && (
        <p className="onboarding-foot">
          <RichText text={t("onboard.footCli", cli.data)} />
        </p>
      )}
      <p className="onboarding-foot">
        <RichText
          text={transport === "tauri" ? t("onboard.footDesktop") : t("onboard.footBrowser")}
        />
        <RichText text={t("onboard.footHelp", agentmon)} />
        {manual.data && <RichText text={t("onboard.footManual", manual.data)} />}
      </p>
    </section>
  );
}
