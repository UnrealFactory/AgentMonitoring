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
 */
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApp } from "../AppContext";
import { CommandLine, ErrorState, Skeleton, Tag } from "../components/ui";
import { useNow } from "../components/charts";
import { api } from "../lib/api";
import { freshness } from "../lib/dashboard";
import { formatDate, formatRelative, pluralize } from "../lib/format";
import type { Project } from "../lib/types";

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
        <Onboarding vault={null} transport={transport} />
      </div>
    );
  }

  const setStatus = async (project: Project, status: "active" | "archived") => {
    setBusy(project.slug);
    setActionError(null);
    try {
      await api.setProjectStatus(project.slug, status);
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
        projects={projects.length}
      />

      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
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
        <Onboarding vault={vault?.path ?? null} transport={transport} />
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
              <div className="project-grid">
                {active.map((p) => (
                  <ProjectCard
                    key={p.slug}
                    project={p}
                    now={now}
                    busy={busy === p.slug}
                    onArchive={() => setStatus(p, "archived")}
                  />
                ))}
              </div>
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
                <div className="project-grid">
                  {archived.map((p) => (
                    <ProjectCard
                      key={p.slug}
                      project={p}
                      now={now}
                      busy={busy === p.slug}
                      onRestore={() => setStatus(p, "active")}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

/* ==========================================================================
   The vault bar
   ======================================================================= */

function VaultBar({
  vault,
  projects,
  transport,
  onSwitched,
  onError,
}: {
  vault: ReturnType<typeof useApp>["vault"];
  projects: number;
  transport: "tauri" | "browser";
  onSwitched: () => void;
  onError: (message: string) => void;
}) {
  return (
    <section className="vault-bar" aria-label="Vault">
      <div className="vault-bar-main">
        <span className="vault-bar-label">Vault</span>
        <h2 className="vault-bar-name">{vault?.name ?? "—"}</h2>
        <p className="vault-bar-path mono" title={vault?.path ?? ""}>
          {vault?.path ?? "resolving…"}
        </p>
      </div>
      <dl className="vault-bar-facts">
        <div>
          <dt>Projects</dt>
          <dd className="tabular">{projects}</dd>
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
          <dd title={vault?.source ? `resolved from ${vault.source}` : undefined}>
            {transport === "tauri" ? "desktop app" : "dev server"}
          </dd>
        </div>
      </dl>
      <div className="vault-bar-actions">
        {transport === "tauri" ? (
          <OpenVaultButton onDone={onSwitched} onError={onError} label="Open vault folder…" />
        ) : (
          <span className="vault-bar-hint">
            Browser mode reads the vault the dev server was started with. Open another with{" "}
            <code>?vault=&lt;dir&gt;</code> or <code>AGENTMON_VAULT</code>.
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

function ProjectCard({
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
  const state = freshness(p.counts.lastActivity, now);
  return (
    <article className={`project-card${p.status === "archived" ? " is-archived" : ""}`}>
      <div className="project-card-head">
        <Link className="project-link" to={`/p/${p.slug}`}>
          <span className={`sdot sdot-${state}`} aria-hidden="true" />
          <span className="project-name">{p.name}</span>
        </Link>
        <span className="project-slug mono">{p.slug}</span>
      </div>

      {/* Three lines on a card, and the whole description in the tooltip — a clamp that
          hides words without offering them anywhere is a clamp that loses them. */}
      <p className="project-desc" title={p.description || undefined}>
        {p.description || <span className="project-desc-none">No description yet.</span>}
      </p>

      {p.tags.length > 0 && (
        <div className="tag-row">
          {p.tags.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      )}

      <dl className="project-counts">
        <div title={`${p.counts.workDone} of ${p.counts.workTotal} work logs finished`}>
          <dt>Work</dt>
          <dd className="tabular">
            {p.counts.workDone}<span className="project-count-of">/{p.counts.workTotal}</span>
          </dd>
        </div>
        <div title={`${p.counts.workInProgress} work logs still open`}>
          <dt>In flight</dt>
          <dd className={`tabular${p.counts.workInProgress === 0 ? " is-zero" : ""}`}>
            {p.counts.workInProgress}
          </dd>
        </div>
        <div title={`${p.counts.bugsOpen} open of ${p.counts.bugsTotal} filed`}>
          <dt>Open bugs</dt>
          <dd className={`tabular${p.counts.bugsOpen === 0 ? " is-zero" : ""}`}>
            {p.counts.bugsOpen}
          </dd>
        </div>
        <div title={`${p.counts.events} events recorded`}>
          <dt>Events</dt>
          <dd className="tabular">{p.counts.events}</dd>
        </div>
      </dl>

      <footer className="project-card-foot">
        <span className="project-when tabular">
          {p.counts.lastActivity
            ? `Active ${formatRelative(p.counts.lastActivity, new Date(now))}`
            : "No activity yet"}
          {p.createdAt && <span className="project-since"> · started {formatDate(p.createdAt)}</span>}
        </span>
        <span className="project-actions">
          {onArchive && (
            <button
              className="link-button"
              disabled={busy}
              onClick={onArchive}
              title="Hide this project from the default view. Nothing is deleted."
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
      </footer>
    </article>
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
 * The first screen of a vault nobody has written to yet.
 *
 * Not a shrug and an icon: the three commands that take this vault from empty to a project
 * with a record in it, in the order they are run, with the real flags. An agent reading the
 * manual and a human reading this screen should be typing the same thing.
 */
function Onboarding({ vault, transport }: { vault: string | null; transport: "tauri" | "browser" }) {
  const dir = vault ?? "<vault dir>";
  return (
    <section className="onboarding">
      <h2 className="onboarding-title">
        {vault ? "This vault has no projects yet" : "There is no vault here yet"}
      </h2>
      <p className="onboarding-sub">
        A vault is a directory of plain files: <code>vault.json</code>, then one folder per
        project holding its work logs, its bugs and its event log. Agents write it with the{" "}
        <code>agentmon</code> CLI; this app reads it.
      </p>
      <ol className="onboarding-steps">
        {!vault && (
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
          <p className="onboarding-note">
            Or press <strong>New project</strong> above — it writes the same files.
          </p>
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
