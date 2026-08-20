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
import { CommandLine, ErrorState, InlineCode, RichText, Skeleton, Tag } from "../components/ui";
import { useContextMenu } from "../components/ContextMenu";
import { recordKind, useProjectMenu, useRecordMenu, type RecordRef } from "../lib/menus";
import { EventIcon } from "../components/EventIcon";
import { useNow } from "../components/charts";
import { api, vaultErrorMessage } from "../lib/api";
import { eventSummary, eventVerb, freshness, refHref, tone, verbAfterRef } from "../lib/dashboard";
import { formatDate, formatDateTimeUtc, formatRelative } from "../lib/format";
import { t } from "../lib/i18n";
import { done, inProgress, unresolvedLabel, unresolvedMeans } from "../lib/words";
import { useAsync } from "../lib/useAsync";
import type { Project, VaultEvent } from "../lib/types";

/**
 * A display name a human types, turned into the directory-safe id the vault uses.
 *
 * It can come out **empty**, and that is not a failure of this function: a slug is a
 * directory name in `projects/`, the vault format allows `[a-z0-9_-]` in it (the CLI rejects
 * anything else with `invalid id`), and a name written in Hangul — or Japanese, or Greek —
 * has nothing in it this may keep. `결제 화면 재작성`, which is this app's own Korean
 * placeholder for the name field, derives to `""`.
 *
 * The caller must therefore treat "" as *a name that needs a slug typed for it* and say so;
 * see {@link CreateProject}. It shipped as a dead button instead.
 */
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
     and how to make one, because "no vault.json" is the state a fresh machine starts in.
     This is also where the boot screen sends a failed vault resolution (App.tsx), so every
     control that can end the failure has to be here — Try again for a vault that went away
     and came back, Open vault folder… for one that is somewhere else, and Create a vault…
     for a machine that has never had one. */
  if (error) {
    return (
      <div className="page">
        <header className="page-head">
          <div>
            <h1 className="page-title">{t("vault.noneOpenTitle")}</h1>
            <p className="page-sub">{t("vault.noneOpenSub")}</p>
          </div>
        </header>
        <ErrorState
          title={t("vault.readFailed")}
          message={error}
          onRetry={reload}
          action={
            transport === "tauri" ? (
              <>
                <OpenVaultButton
                  onDone={refresh}
                  onError={setActionError}
                  label={t("vault.openFolder")}
                />
                <CreateVaultButton onDone={refresh} onError={setActionError} />
              </>
            ) : undefined
          }
        />
        {actionError && (
          <p className="form-error" role="alert">
            <InlineCode text={vaultErrorMessage(actionError)} />
          </p>
        )}
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
          <h1 className="page-title">{t("proj.title")}</h1>
          <p className="page-sub">{t("proj.sub")}</p>
        </div>
        <div className="page-head-actions">
          <button className="button button-primary" onClick={() => setCreating((v) => !v)}>
            {t("proj.new")}
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
          <InlineCode text={vaultErrorMessage(actionError)} />
        </p>
      )}

      {undo && (
        <div className="undo-bar" role="status">
          <span className="undo-text">
            <RichText text={t("proj.undoBar", `**${undo.name}**`)} />
          </span>
          <button
            className="button button-sm"
            disabled={busy === undo.slug}
            onClick={() => setStatus(undo, "active")}
          >
            {busy === undo.slug ? t("proj.restoring") : t("app.undo")}
          </button>
          <button
            className="undo-dismiss"
            aria-label={t("app.dismiss")}
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
              <h2 className="section-title">{t("proj.active")}</h2>
              <span className="section-count tabular">{t("proj.count", active.length)}</span>
            </header>
            {active.length === 0 ? (
              <p className="now-note">{t("proj.allArchived")}</p>
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
                <h2 className="section-title">{t("proj.archived")}</h2>
                <span className="section-count tabular">{t("proj.count", archived.length)}</span>
                <button
                  className="link-button"
                  aria-expanded={showArchived}
                  onClick={() => setShowArchived((v) => !v)}
                >
                  {showArchived ? t("proj.hide") : t("proj.show")}
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
const SOURCE_TEXT: Record<string, () => string> = {
  "?vault=": () => t("vault.source.query"),
  env: () => t("vault.source.env"),
  flag: () => t("vault.source.flag"),
  "cwd/vault": () => t("vault.source.cwdVault"),
  cwd: () => t("vault.source.cwd"),
  // The installed app launches from wherever the user clicked, so it also looks for a
  // vault next to its own executable. That is a different sentence from every other row
  // here — nobody opened it, nobody exported it — and it used to borrow "flag"'s.
  "exe/vault": () => t("vault.source.exeVault"),
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
  const source = vault?.source ? (SOURCE_TEXT[vault.source]?.() ?? vault.source) : null;
  return (
    <section className="vault-bar" aria-label={t("vault.bar")}>
      <div className="vault-bar-main">
        <span className="vault-bar-label">{t("vault.label")}</span>
        <h2 className="vault-bar-name">{vault?.name ?? "—"}</h2>
        <p className="vault-bar-path mono" title={vault?.path ?? ""}>
          {vault?.path ?? t("vault.resolving")}
        </p>
        {/* Where that path came from. The app used to derive this from the environment
            after the fact, so it said "cwd/vault" under ?vault= — the one place a human
            could check which vault they were on was also the one place that could lie. */}
        {source && <p className="vault-bar-source">{t("vault.openedFrom", source)}</p>}
      </div>
      <dl className="vault-bar-facts">
        <div>
          {/* Named, because the sidebar counts the active ones: two labels reading
              "Projects" with different numbers under them is the app disagreeing with
              itself about a word. */}
          <dt>{t("vault.activeProjects")}</dt>
          <dd className="tabular">
            {active}
            {archived > 0 && (
              <span className="vault-bar-aside">{t("vault.archivedAside", archived)}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>{t("vault.schema")}</dt>
          <dd className="tabular">v{vault?.version ?? "—"}</dd>
        </div>
        <div>
          <dt>{t("vault.created")}</dt>
          <dd className="tabular">{formatDate(vault?.createdAt)}</dd>
        </div>
        <div>
          <dt>{t("vault.readBy")}</dt>
          <dd>{transport === "tauri" ? t("vault.readerDesktop") : t("vault.readerBrowser")}</dd>
        </div>
      </dl>
      <div className="vault-bar-actions">
        {transport === "tauri" ? (
          <OpenVaultButton onDone={onSwitched} onError={onError} label={t("vault.openFolder")} />
        ) : (
          <span className="vault-bar-hint">
            <RichText text={t("vault.browserHint")} />
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
      {busy ? t("vault.opening") : label}
    </button>
  );
}

/**
 * `agentmon init`, for a window.
 *
 * The app is installed, there is no vault on the machine, and the error the resolver wrote
 * offers a flag, an environment variable and a command — three things a human looking at a
 * window cannot do. This makes the vault where they say, opens it, and leaves them on the
 * empty-vault screen with a New project button.
 */
function CreateVaultButton({
  onDone,
  onError,
}: {
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="button button-primary"
      disabled={busy}
      title={t("vault.createTip")}
      onClick={async () => {
        setBusy(true);
        try {
          const info = await api.createVaultFolder();
          if (info) onDone();
        } catch (err) {
          onError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? t("vault.creating") : t("vault.createVault")}
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
     filled dot and printed "Active just now" beside the word "archived".

     The row says "Last activity 3h ago" rather than "Active 3h ago" for the same reason
     the section above it is headed Active: on this screen `active` is a project's status,
     the opposite of archived, and one word may not also mean "somebody wrote something
     recently" (lib/words.ts). */
  const archived = p.status === "archived";
  const state = archived ? "stale" : freshness(p.counts.lastActivity, now);
  const c = p.counts;

  /* The row's own menu. Archive is handed back to the page rather than done by the menu,
     because this screen already answers an archive with the undo bar above the list — the
     way back has to appear where the reader is looking, and here that is the layout, not a
     toast. Off this screen the shared menu shows the same undo as a toast that does not
     fade. */
  const contextMenu = useContextMenu();
  const projectMenu = useProjectMenu({
    archive:
      onArchive || onRestore
        ? (_project, status) => (status === "archived" ? onArchive?.() : onRestore?.())
        : undefined,
  });

  return (
    <li>
      <article
        className={`project-row${archived ? " is-archived" : ""}`}
        {...contextMenu(() => projectMenu(p))}
      >
        <div className="project-row-main">
          <div className="project-row-head">
            <Link className="project-link" to={`/p/${p.slug}`}>
              <span
                className={`sdot sdot-${state}`}
                title={
                  c.lastActivity
                    ? t("dash.lastActivityTip", formatDateTimeUtc(c.lastActivity))
                    : t("proj.nothingRecordedYet")
                }
                role="img"
                aria-label={
                  archived
                    ? t("proj.dotArchived")
                    : state === "live"
                      ? t("proj.dotLive")
                      : state === "quiet"
                        ? t("proj.dotQuiet")
                        : t("proj.dotStale")
                }
              />
              <span className="project-name">{p.name}</span>
            </Link>
            <span className="project-slug mono">{p.slug}</span>
            {p.status === "archived" && (
              <span className="pill pill-archived">{t("proj.archivedPill")}</span>
            )}
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
          <span className="project-actions">
            {onArchive && (
              <button
                className="link-button"
                disabled={busy}
                onClick={onArchive}
                title={t("proj.archiveTip")}
              >
                {busy ? t("proj.archiving") : t("proj.archive")}
              </button>
            )}
            {onRestore && (
              <button className="link-button" disabled={busy} onClick={onRestore}>
                {busy ? t("proj.restoring") : t("proj.unarchive")}
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

/**
 * One line of that timeline — and the one row in the app the right button used to miss.
 *
 * These are the dashboard's feed rows read across the folder instead of inside one: same
 * class, same layout, same `refHref` destination. For two rounds they were also the only
 * record rows in the product with no menu on them, which is invisible rather than annoying —
 * the document-level suppressor eats the right-click either way, so the gesture a reader
 * learned one screen over just stops working here, with nothing on screen to say why.
 *
 * The menu is about **what the row points at**, which is the rule everywhere else: a line
 * about a record opens that record's menu, and a line about the project itself — created,
 * renamed — points at the project and opens the project's. So no row in this list is dead.
 *
 * Two things are true here and nowhere else. The row carries the project's name, so the
 * record menu it opens is the only one in the app whose Copy link can name a project other
 * than the one the sidebar is standing in. And Archive is answered by the toast rather than
 * by this screen's undo bar (which the project rows above use), because that bar is at the
 * top of a page whose feed is at the bottom: an undo the reader has to scroll to find is
 * one they will not find.
 */
function VaultFeedRow({
  event,
  project,
  now,
}: {
  event: VaultEvent;
  project: Project;
  now: number;
}) {
  const recordHref = refHref(project.slug, event.ref);
  const href = recordHref ?? `/p/${project.slug}`;
  /* No title: this feed reads events, and an event line carries a summary, not a title.
     Copy title reads the record when it is clicked (src/lib/menus.ts) rather than this
     screen reading every project's records in case somebody right-clicks one row. */
  const record: RecordRef | null =
    recordHref && event.ref
      ? { kind: recordKind(event.ref), id: event.ref, slug: project.slug }
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
  const named = name.trim().length > 0;
  const ready = named && slugOk && !taken;
  /**
   * A name that cannot become a slug — the state the form used to answer with silence.
   *
   * `slugify` keeps `[a-z0-9]` and nothing else, so every Hangul name derives to "": type
   * this dictionary's own Korean example, `결제 화면 재작성`, and the slug box stays empty,
   * 프로젝트 만들기 is disabled, and the hint under the box went on reading the neutral
   * "projects/ 아래의 디렉터리 이름입니다" — the branch that says why is `effectiveSlug &&
   * !slugOk`, and "" is falsy, so it never fired. English typed the same name and was ready
   * in the same breath. The reader this app defaults to Korean for was the only one who had
   * to already know the rule before the button would work (P9 rounds 7 and 8 critics).
   *
   * The constraint itself is right — a slug is a directory name and the CLI rejects `결제`
   * with `invalid id` — so the fix is the sentence, not the rule: the hint states it, names
   * the box to type in, and the button stays disabled and explained rather than dead. The
   * moment a slug is typed by hand the form is ready, whatever language the name is in.
   */
  const slugNeeded = named && !effectiveSlug;

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
        <h2 className="section-title">{t("proj.newTitle")}</h2>
        <p className="create-sub">
          <RichText text={t("proj.form.writes", effectiveSlug || "<slug>")} />{" "}
          <code>agentmon project create</code> {t("proj.form.writesTail")}
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
          <span className="field-label">{t("proj.form.slug")}</span>
          <input
            className="input mono"
            value={effectiveSlug}
            placeholder={t("proj.form.slugPlaceholder")}
            /* Typed here, the slug is taken as typed and at once — `slugEdited` stops the
               name from deriving over it — so a Korean name plus `gyeolje` is ready before
               the reader lifts a finger. That path always worked; nothing on screen said it
               was there. */
            aria-invalid={taken || slugNeeded || (!!effectiveSlug && !slugOk) || undefined}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value);
            }}
          />
          {/* Four states, one line, and the empty one is a state rather than the absence of
              one: taken, unusable, missing-and-underivable, and the plain rule. */}
          <span className={`field-hint${taken || slugNeeded || (effectiveSlug && !slugOk) ? " is-blocking" : ""}`}>
            {taken
              ? t("proj.form.slugTaken")
              : effectiveSlug && !slugOk
                ? t("proj.form.slugBad")
                : slugNeeded
                  ? t("proj.form.slugNeeded")
                  : t("proj.form.slugHint")}
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
      </div>

      {error && (
        <p className="form-error" role="alert">
          <InlineCode text={vaultErrorMessage(error)} />
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
  const quoted = /--vault "([^"]+)"/.exec(message)?.[1];
  if (quoted) return quoted;
  /* The other shape, and the one an installed app hits first: nothing was passed at all, so
     the resolver reports where it looked — "no vault found at C:\…\vault: looked for
     vault.json in C:\…\vault and C:\…". The first path is the directory it would have used,
     which is the one to offer to create. */
  return /no vault found at (.+?): looked for/.exec(message)?.[1] ?? null;
}

/** A path with a space in it is one argument only if it is quoted. */
const shellArg = (path: string): string => (/\s/.test(path) ? `"${path}"` : path);

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
        {opened ? t("onboard.titleEmpty") : t("onboard.titleNone")}
      </h2>
      <p className="onboarding-sub">
        <RichText text={t("onboard.sub")} />
      </p>
      <ol className="onboarding-steps">
        {!opened && (
          <li>
            <p className="onboarding-step">{t("onboard.stepVault")}</p>
            <CommandLine text={`${agentmon} init --vault "${dir}" --name "My vault"`} />
            {transport === "tauri" && (
              <p className="onboarding-note">
                <RichText text={t("onboard.noteCreateVault")} />
              </p>
            )}
          </li>
        )}
        <li>
          <p className="onboarding-step">{t("onboard.stepProject")}</p>
          <CommandLine
            text={`${agentmon} project create checkout-rewrite --name "Checkout rewrite" --description "Replace the legacy checkout flow."`}
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
            text={`${agentmon} work start -p checkout-rewrite --agent your-agent --title "Port the cart summary" --body-file note.md`}
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
