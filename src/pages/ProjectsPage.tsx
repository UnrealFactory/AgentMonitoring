/**
 * Projects, and the vault they live in.
 *
 * This is the screen that has to make the app's central claim true: the vault is a folder
 * of plain files, so it can be copied to another machine and opened there. That means three
 * things have to be visible and workable here rather than documented elsewhere — which
 * vault is open and where it is, how to open a different one, and how to start a project in
 * the one you have.
 *
 * Everything that writes goes through the same `agentmon-core` code the CLI writes with
 * (see src/lib/api.ts), so a project created here is indistinguishable from one an agent
 * created at a terminal, event log included.
 *
 * The projects are laid out as full-width rows, not as a card grid. A grid of
 * `auto-fill, minmax(330px, 1fr)` gave a vault with two projects three tracks: two cards in
 * the top-left and a dead one on the right, under a section rule that ran 400px past the
 * last card — while /work and /bugs, one click away, fill the same container edge to edge.
 * A vault screen that looks weaker than the list screens beside it is the wrong screen; the
 * row is the form this app already uses for "a list of things you can open".
 */
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp, useVaultNonce } from "../AppContext";
import { CommandLine, ErrorState, Skeleton, Tag } from "../components/ui";
import { EventIcon } from "../components/EventIcon";
import { useNow } from "../components/charts";
import { api } from "../lib/api";
import { eventSummary, eventVerb, freshness, refHref, tone } from "../lib/dashboard";
import { formatDate, formatDateTimeUtc, formatRelative, pluralize } from "../lib/format";
import { DONE, IN_PROGRESS, UNRESOLVED_MEANS } from "../lib/words";
import { useAsync } from "../lib/useAsync";
import type { Project, VaultEvent } from "../lib/types";

/** A display name a human types, turned into the directory-safe id the vault uses. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

const SLUG_RE = /^[a-z0-9_-]{1,64}$/;

export function ProjectsPage() {
  const { vault, projects, loading, error, reload, refresh, transport } = useApp();
  const navigate = useNavigate();
  const now = useNow(60_000);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /**
   * The project the last Archive click moved, so it can be moved back.
   *
   * Archiving is one click, it is the only action on this screen that changes what the app
   * shows, and it happens to a row that then leaves the list — which is the shape of thing
   * that needs a way back (P5 critic). Not a toast that fades: it stays until it is used,
   * dismissed or the screen is left, because a reader who looks up three seconds later has
   * the same right to it as one who was watching.
   */
  const [undo, setUndo] = useState<Project | null>(null);

  const active = useMemo(() => projects.filter((p) => p.status !== "archived"), [projects]);
  const archived = useMemo(() => projects.filter((p) => p.status === "archived"), [projects]);

  /* A vault that cannot be read is not an empty vault: the screen says which one it is,
     and how to make one, because "no vault.json" is the state a fresh machine starts in. */
  if (error) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <h1 className="page-title">No vault open</h1>
            <p className="page-sub">
              The app reads one directory of plain files. This one could not be read.
            </p>
          </div>
        </header>
        <ErrorState
          title="Could not read the vault"
          message={error}
          onRetry={reload}
          action={
            transport === "tauri" ? (
              <OpenVaultButton onDone={refresh} onError={setActionError} label="Open vault folder…" />
            ) : undefined
          }
        />
        {/* The directory the failure was about, taken out of the message two inches above:
            this screen used to print "<vault dir>" as a placeholder in the init command
            while the error beside it named the real path. And no "press New project" here —
            there is no such button on this screen. */}
        <Onboarding
          dir={vaultDirFromError(error)}
          opened={false}
          canCreate={false}
          transport={transport}
        />
      </div>
    );
  }

  const setStatus = async (project: Project, status: "active" | "archived") => {
    setBusy(project.slug);
    setActionError(null);
    try {
      await api.setProjectStatus(project.slug, status);
      setUndo(status === "archived" ? project : null);
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-sub">
            Everything in one vault directory of plain files — copy it to another machine and the
            history comes with it.
          </p>
        </div>
        <div className="page-head-actions">
          <button className="button button-primary" onClick={() => setCreating((v) => !v)}>
            New project
          </button>
        </div>
      </header>

      <VaultBar
        onSwitched={refresh}
        onError={setActionError}
        transport={transport}
        vault={vault}
        active={active.length}
        archived={archived.length}
      />

      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}

      {undo && (
        <div className="undo-bar" role="status">
          <span className="undo-text">
            <strong>{undo.name}</strong> is archived. Nothing was deleted — its work logs,
            bugs and events are still in the vault, and the project is still readable.
          </span>
          <button
            className="button button-sm"
            disabled={busy === undo.slug}
            onClick={() => setStatus(undo, "active")}
          >
            {busy === undo.slug ? "Restoring…" : "Undo"}
          </button>
          <button
            className="undo-dismiss"
            aria-label="Dismiss"
            onClick={() => setUndo(null)}
          >
            ×
          </button>
        </div>
      )}

      {creating && (
        <CreateProject
          existing={projects}
          onCancel={() => setCreating(false)}
          onCreated={(slug) => {
            setCreating(false);
            refresh();
            // Straight into the project that was just made: the next thing anybody does
            // with a new project is look at it.
            navigate(`/p/${slug}`);
          }}
        />
      )}

      {loading && projects.length === 0 ? (
        <Skeleton rows={3} />
      ) : projects.length === 0 ? (
        <Onboarding dir={vault?.path ?? null} opened canCreate transport={transport} />
      ) : (
        <>
          <section className="project-section">
            <header className="project-section-head">
              <h2 className="section-title">Active</h2>
              <span className="section-count tabular">{pluralize(active.length, "project")}</span>
            </header>
            {active.length === 0 ? (
              <p className="now-note">
                Every project in this vault is archived. Bring one back below, or start a new one.
              </p>
            ) : (
              <ul className="project-rows">
                {active.map((p) => (
                  <ProjectRow
                    key={p.slug}
                    project={p}
                    now={now}
                    busy={busy === p.slug}
                    onArchive={() => setStatus(p, "archived")}
                  />
                ))}
              </ul>
            )}
          </section>

          {archived.length > 0 && (
            <section className="project-section">
              <header className="project-section-head">
                <h2 className="section-title">Archived</h2>
                <span className="section-count tabular">
                  {pluralize(archived.length, "project")}
                </span>
                <button
                  className="link-button"
                  aria-expanded={showArchived}
                  onClick={() => setShowArchived((v) => !v)}
                >
                  {showArchived ? "Hide" : "Show"}
                </button>
              </header>
              {showArchived && (
                <ul className="project-rows">
                  {archived.map((p) => (
                    <ProjectRow
                      key={p.slug}
                      project={p}
                      now={now}
                      busy={busy === p.slug}
                      onRestore={() => setStatus(p, "active")}
                    />
                  ))}
                </ul>
              )}
            </section>
          )}

          <VaultActivity projects={projects} now={now} />
        </>
      )}
    </div>
  );
}

/* ==========================================================================
   The vault bar
   ======================================================================= */

/** Where the app got the vault it is showing, in words a human can act on. */
const SOURCE_TEXT: Record<string, string> = {
  "?vault=": "?vault= in this window's address",
  env: "the AGENTMON_VAULT environment variable",
  flag: "the folder opened in this app",
  "cwd/vault": "./vault beside the app",
  cwd: "the working directory",
};

function VaultBar({
  vault,
  active,
  archived,
  transport,
  onSwitched,
  onError,
}: {
  vault: ReturnType<typeof useApp>["vault"];
  active: number;
  archived: number;
  transport: "tauri" | "browser";
  onSwitched: () => void;
  onError: (message: string) => void;
}) {
  const source = vault?.source ? SOURCE_TEXT[vault.source] ?? vault.source : null;
  return (
    <section className="vault-bar" aria-label="Vault">
      <div className="vault-bar-main">
        <span className="vault-bar-label">Vault</span>
        <h2 className="vault-bar-name">{vault?.name ?? "—"}</h2>
        <p className="vault-bar-path mono" title={vault?.path ?? ""}>
          {vault?.path ?? "resolving…"}
        </p>
        {/* Where that path came from. The app used to derive this from the environment
            after the fact, so it said "cwd/vault" under ?vault= — the one place a human
            could check which vault they were on was also the one place that could lie. */}
        {source && <p className="vault-bar-source">Opened from {source}</p>}
      </div>
      <dl className="vault-bar-facts">
        <div>
          {/* Named, because the sidebar counts the active ones: two labels reading
              "Projects" with different numbers under them is the app disagreeing with
              itself about a word. */}
          <dt>Active projects</dt>
          <dd className="tabular">
            {active}
            {archived > 0 && <span className="vault-bar-aside"> · {archived} archived</span>}
          </dd>
        </div>
        <div>
          <dt>Schema</dt>
          <dd className="tabular">v{vault?.version ?? "—"}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd className="tabular">{formatDate(vault?.createdAt)}</dd>
        </div>
        <div>
          <dt>Read by</dt>
          <dd>{transport === "tauri" ? "desktop app" : "dev server"}</dd>
        </div>
      </dl>
      <div className="vault-bar-actions">
        {transport === "tauri" ? (
          <OpenVaultButton onDone={onSwitched} onError={onError} label="Open vault folder…" />
        ) : (
          <span className="vault-bar-hint">
            Open another vault with <code>?vault=&lt;dir&gt;</code>, or start the dev server
            with <code>AGENTMON_VAULT</code>.
          </span>
        )}
      </div>
    </section>
  );
}

function OpenVaultButton({
  onDone,
  onError,
  label,
}: {
  onDone: () => void;
  onError: (message: string) => void;
  label: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const info = await api.chooseVaultFolder();
          // null is a dismissed dialog, which is not an event worth reporting.
          if (info) onDone();
        } catch (err) {
          onError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Opening…" : label}
    </button>
  );
}

/* ==========================================================================
   One project
   ======================================================================= */

function ProjectRow({
  project: p,
  now,
  busy,
  onArchive,
  onRestore,
}: {
  project: Project;
  now: number;
  busy: boolean;
  onArchive?: () => void;
  onRestore?: () => void;
}) {
  /* An archived project is never "live", whatever the clock says. Archiving is itself an
     event, so the last thing that happened in one is usually the archiving — which lit the
     filled dot and printed "Active just now" beside the word "archived". */
  const archived = p.status === "archived";
  const state = archived ? "stale" : freshness(p.counts.lastActivity, now);
  const c = p.counts;
  return (
    <li>
      <article className={`project-row${archived ? " is-archived" : ""}`}>
        <div className="project-row-main">
          <div className="project-row-head">
            <Link className="project-link" to={`/p/${p.slug}`}>
              <span
                className={`sdot sdot-${state}`}
                title={
                  c.lastActivity
                    ? `Last activity ${formatDateTimeUtc(c.lastActivity)}`
                    : "Nothing recorded yet"
                }
                role="img"
                aria-label={
                  archived
                    ? "archived project"
                    : state === "live"
                      ? "active in the last two hours"
                      : `${state} project`
                }
              />
              <span className="project-name">{p.name}</span>
            </Link>
            <span className="project-slug mono">{p.slug}</span>
            {p.status === "archived" && <span className="pill pill-archived">archived</span>}
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
            {p.description || <span className="project-desc-none">No description yet.</span>}
          </p>
        </div>

        <dl className="project-figures">
          <div className="project-figure">
            <dt>Work logs</dt>
            <dd className="tabular">{c.workTotal}</dd>
            <span className="project-figure-note">
              {c.workTotal === 0
                ? "none yet"
                : `${c.workDone} ${DONE} · ${c.workInProgress} ${IN_PROGRESS}`}
            </span>
          </div>
          <div className="project-figure" title={`Unresolved means ${UNRESOLVED_MEANS}`}>
            <dt>Unresolved bugs</dt>
            <dd className={`tabular${c.bugsOpen === 0 ? " is-zero" : ""}`}>{c.bugsOpen}</dd>
            <span className="project-figure-note">
              {c.bugsTotal === 0 ? "none filed" : `of ${c.bugsTotal} filed`}
            </span>
          </div>
          <div className="project-figure">
            <dt>Events</dt>
            <dd className="tabular">{c.events}</dd>
            <span className="project-figure-note">recorded</span>
          </div>
        </dl>

        <div className="project-row-end">
          <span className="project-when tabular">
            {c.lastActivity ? (
              <>
                {archived ? "Last active " : "Active "}
                {formatRelative(c.lastActivity, new Date(now))}
                <span className="project-since">started {formatDate(p.createdAt)}</span>
              </>
            ) : (
              <>
                No activity yet
                <span className="project-since">created {formatDate(p.createdAt)}</span>
              </>
            )}
          </span>
          <span className="project-actions">
            {onArchive && (
              <button
                className="link-button"
                disabled={busy}
                onClick={onArchive}
                title="Hide this project from the switcher and the default list. Nothing is deleted, and the next line offers Undo."
              >
                {busy ? "Archiving…" : "Archive"}
              </button>
            )}
            {onRestore && (
              <button className="link-button" disabled={busy} onClick={onRestore}>
                {busy ? "Restoring…" : "Unarchive"}
              </button>
            )}
          </span>
        </div>
      </article>
    </li>
  );
}

/* ==========================================================================
   The vault, as one timeline
   ======================================================================= */

/**
 * Every project's events, merged.
 *
 * The per-project dashboards answer "what is happening here"; this screen is the only place
 * that can answer "what is happening in this vault at all" — which is the question somebody
 * arriving at the app with two projects actually has. It is also what makes this a screen
 * rather than a menu: the same real records, read across the folder instead of inside one.
 */
function VaultActivity({ projects, now }: { projects: Project[]; now: number }) {
  const nonce = useVaultNonce();
  const key = projects.map((p) => p.slug).join(",");
  const feed = useAsync(
    async () => {
      const per = await Promise.all(
        projects.map(async (p) =>
          (await api.listEvents(p.slug, 12)).map((event) => ({ event, project: p }))
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
        <h2 className="section-title">Across the vault</h2>
        <span className="section-count tabular">
          {feed.data?.length ? `newest ${feed.data.length}` : "recent"}
        </span>
      </header>
      {feed.loading && !feed.data ? (
        <Skeleton rows={4} />
      ) : !feed.data?.length ? (
        <p className="now-note">
          Nothing has been recorded in this vault yet. The first <code>agentmon work start</code>{" "}
          shows up here.
        </p>
      ) : (
        <ol className="vault-feed">
          {feed.data.map(({ event, project }, i) => (
            <VaultFeedRow
              key={`${project.slug}-${event.ts}-${event.ref ?? ""}-${i}`}
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

function VaultFeedRow({
  event,
  project,
  now,
}: {
  event: VaultEvent;
  project: Project;
  now: number;
}) {
  const href = refHref(project.slug, event.ref) ?? `/p/${project.slug}`;
  return (
    <li>
      <Link className={`feed-row tone-${tone(event.type)}`} to={href}>
        <span className="feed-icon" aria-hidden="true">
          <EventIcon type={event.type} />
        </span>
        <span className="feed-body">
          <span className="feed-head">
            <span className="feed-project">{project.name}</span>
            <span className="feed-actor">{event.actor}</span>
            <span className="feed-verb">{eventVerb(event.type)}</span>
            {event.ref && <span className="feed-ref mono">{event.ref}</span>}
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
  existing,
  onCancel,
  onCreated,
}: {
  existing: Project[];
  onCancel: () => void;
  onCreated: (slug: string) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveSlug = slugEdited ? slug : slugify(name);
  const taken = existing.some((p) => p.slug === effectiveSlug);
  const slugOk = SLUG_RE.test(effectiveSlug);
  const ready = name.trim().length > 0 && slugOk && !taken;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const project = await api.createProject({
        slug: effectiveSlug,
        name: name.trim(),
        description: description.trim(),
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      onCreated(project.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <form className="create-panel" onSubmit={submit}>
      <div className="create-head">
        <h2 className="section-title">New project</h2>
        <p className="create-sub">
          Writes <code>projects/{effectiveSlug || "<slug>"}/project.json</code> and its first
          event, exactly as <code>agentmon project create</code> would.
        </p>
      </div>

      <div className="create-grid">
        <label className="field">
          <span className="field-label">Name</span>
          <input
            className="input"
            autoFocus
            value={name}
            placeholder="Checkout rewrite"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Slug</span>
          <input
            className="input mono"
            value={effectiveSlug}
            placeholder="checkout-rewrite"
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value);
            }}
          />
          <span className="field-hint">
            {taken
              ? "A project with this slug already exists in the vault."
              : effectiveSlug && !slugOk
                ? "Lowercase letters, digits, - or _ only."
                : "The directory name under projects/. Immutable once created."}
          </span>
        </label>
        <label className="field field-wide">
          <span className="field-label">Description</span>
          <input
            className="input"
            value={description}
            placeholder="One or two sentences a reader who has never seen this project can start from."
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="field field-wide">
          <span className="field-label">Tags</span>
          <input
            className="input"
            value={tags}
            placeholder="frontend, payments"
            onChange={(e) => setTags(e.target.value)}
          />
        </label>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="create-actions">
        <button className="button button-primary" type="submit" disabled={!ready || busy}>
          {busy ? "Creating…" : "Create project"}
        </button>
        <button className="button" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ==========================================================================
   Empty vault
   ======================================================================= */

/**
 * The directory a failed vault read was about, read out of the message the backend wrote.
 *
 * Every one of those messages ends in the exact `agentmon init --vault "<dir>"` for the
 * directory it could not open, because it is written for somebody who can act on it. That
 * makes the path recoverable here, so the onboarding below can print the command for the
 * real directory instead of a `<vault dir>` placeholder under an error that names it.
 */
function vaultDirFromError(message: string): string | null {
  return /--vault "([^"]+)"/.exec(message)?.[1] ?? null;
}

/**
 * The first screen of a vault nobody has written to yet.
 *
 * Not a shrug and an icon: the three commands that take this vault from empty to a project
 * with a record in it, in the order they are run, with the real flags. An agent reading the
 * manual and a human reading this screen should be typing the same thing.
 *
 * `opened` is whether there is a vault at all (an empty one, or none); `dir` is the best
 * known directory for the command lines either way; `canCreate` is whether the screen this
 * is on actually carries the New project button it would otherwise point at.
 */
function Onboarding({
  dir: known,
  opened,
  canCreate,
  transport,
}: {
  dir: string | null;
  opened: boolean;
  canCreate: boolean;
  transport: "tauri" | "browser";
}) {
  const dir = known ?? "<vault dir>";
  return (
    <section className="onboarding">
      <h2 className="onboarding-title">
        {opened ? "This vault has no projects yet" : "There is no vault here yet"}
      </h2>
      <p className="onboarding-sub">
        A vault is a directory of plain files: <code>vault.json</code>, then one folder per
        project holding its work logs, its bugs and its event log. Agents write it with the{" "}
        <code>agentmon</code> CLI; this app reads it.
      </p>
      <ol className="onboarding-steps">
        {!opened && (
          <li>
            <p className="onboarding-step">Make the vault</p>
            <CommandLine text={`agentmon init --vault "${dir}" --name "My vault"`} />
          </li>
        )}
        <li>
          <p className="onboarding-step">Create a project</p>
          <CommandLine
            text={`agentmon project create checkout-rewrite --name "Checkout rewrite" --description "Replace the legacy checkout flow."`}
          />
          {canCreate && (
            <p className="onboarding-note">
              Or press <strong>New project</strong> above — it writes the same files.
            </p>
          )}
        </li>
        <li>
          <p className="onboarding-step">Record the first piece of work</p>
          <CommandLine
            text={`agentmon work start -p checkout-rewrite --agent your-agent --title "Port the cart summary" --body-file note.md`}
          />
          <p className="onboarding-note">
            The body needs <code>## What</code>, <code>## Why</code> and <code>## How</code>; the
            CLI prints a template if it is missing.
          </p>
        </li>
      </ol>
      <p className="onboarding-foot">
        {transport === "tauri" ? (
          <>
            Already have a vault on this machine? Use <strong>Open vault folder…</strong> above.
          </>
        ) : (
          <>
            Already have a vault? Point the dev server at it with <code>AGENTMON_VAULT</code>, or
            this window at it with <code>?vault=&lt;dir&gt;</code>.
          </>
        )}{" "}
        The full command set is in <code>docs/AGENT_MANUAL.md</code>.
      </p>
    </section>
  );
}
