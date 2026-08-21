# AgentMonitoring — SPEC (contract for all builders & critics)

AgentMonitoring is a Tauri 2 + Rust desktop app: **AI agents document their own work for
humans, next to the code the work happened in**. Agents write records via a CLI; humans
read them in the desktop app. Storage is plain files: one `AgentMonitoring` folder per
project, living inside the repo it describes — the way `.git` lives inside a repository —
so committing the folder moves the history with the code. The app shows every project
registered on the machine at once.

> **Schema v2.** The v1 design (one central vault directory holding every project) was
> replaced at the owner's direction on 2026-08-20. `agentmon migrate` is the bridge from
> v1 vaults; the app and CLI read v2 only.

## Quality bars (non-negotiable)

| Piece | Bar (real, publicly viewable) |
|---|---|
| Work log detail | A well-written merged PR page on github.com/microsoft/vscode |
| Bug board | github.com/microsoft/vscode/issues |
| Status dashboard | play.grafana.org |
| Visual design (every screen) | linear.app — must win/tie a blind side-by-side "which looks like the more polished modern product" |
| Agent CLI + manual | cli.github.com/manual — a fresh agent reading only the manual must succeed one-shot |

## Architecture

```
AgentMonitoring/          # this repo
  package.json            # npm scripts: dev, build, tauri, screenshot
  vite.config.ts          # includes project-api dev middleware (browser mode)
  src/                    # React 18 + TypeScript frontend
    styles/tokens.css     # design system: Linear-inspired dark theme
    lib/api.ts            # data layer: Tauri invoke() OR browser fetch('/project-api/...')
    ...pages/components
  src-tauri/              # Tauri 2 shell (Rust) — commands + fs watchers → events
  crates/
    agentmon-core/        # Rust lib: project schema, parse/write, validation (shared)
    agentmon-cli/         # `agentmon` binary — the agent-facing interface
  docs/
    AGENT_MANUAL.md       # THE manual agents read (gh-manual bar)
  AgentMonitoring/        # this app's own live records (real scenario data lives here)
  progress/               # live progress page (see PLAN.md)
  scripts/
    screenshot.mjs        # Playwright: capture every app screen to progress/shots/
    capture-refs.mjs      # Playwright: capture bar references to progress/refs/
    build-progress.mjs    # regenerate progress/index.html from rounds.jsonl
```

**Single source of truth = the project's `AgentMonitoring` folder (plain files).** CLI
writes, app reads. The frontend data layer has two transports: Tauri `invoke()` in the
desktop app, and `/project-api/*` (a Vite dev middleware reading the same folders) in
browser mode. Browser mode exists so critics can screenshot fast with Playwright; the
desktop app is the product.

## Storage (schema v2)

One project = one `AgentMonitoring` folder inside a directory the human picked
(typically a code repo root):

```
<location>/                       # e.g. C:\Code\MyApp — the human's repo, any folder
  AgentMonitoring/
    project.json                  # { "version": 2, id, name, description, tags,
                                  #   createdAt }      — no slug, no status
    events.jsonl                  # append-only, one JSON object per line:
                                  # { ts, actor, type, ref, summary }
                                  # type ∈ work_started|work_updated|work_done|work_abandoned|
                                  #        bug_created|bug_claimed|bug_commented|bug_resolved|
                                  #        bug_closed|note_created|note_updated|note_removed|
                                  #        project_created|project_updated
    worklogs/WORK-0001.md         # zero-padded per-project sequence
    bugs/BUG-0001.md
    notes/<name>.md               # shared agent notes — kebab-case name IS the identity
```

The folder name is always exactly `AgentMonitoring` — that constant is what makes
discovery (the CLI's walk-up, "is this already a project?") trivial. `id` (generated at
init, `prj-…`) is the stable identity the app routes by; the folder stays movable.

### The registry (per user, machine-local)

```
~/.AgentMonitoring/registry.json    # { "version": 1, "projects": [{ "path", "addedAt",
                                    #   "name"? }] }
```

Paths only — the folder is the single source of truth; the registry is a bookmark list
(the cached `name` exists so an unplugged path can be listed as *unavailable* by name).
The app reads it at launch and shows every listed project; the CLI appends on `init` /
`migrate`, best effort — a failure to register never fails the mutation, and headless
runs work with no registry at all. A missing path renders as an unavailable row, never
silently dropped. `git` moves the data, not the list: on a new machine, **Open
project…** on the cloned repo registers it.

### App feedback (per user, machine-local)

```
~/.AgentMonitoring/feedback/FB-NNNN.md   # frontmatter: id, title, type (bug|idea),
                                         #   agent, status (open|done), created, done;
                                         #   body = free markdown prose (may be empty)
```

Bugs and wishes **about the AgentMonitoring app itself**, filed by agents through
`agentmon app-feedback add` or the `app_feedback` MCP tool. Machine-level like the
registry (same `AGENTMON_REGISTRY_DIR` override) because the subject is this install of
the app, not any repo — which is also why the commands take no `--dir` and need no
project. The app's **App feedback** board lists them open-first. Items are worked with
`done` / `reopen` and cleared with `delete` — in the app or over the CLI, because the
owner delegates the cleanup to agents. Deleting is **done-first by rule**: an open item
refuses to delete, so a complaint can never vanish unread. Ids allocate under the
folder's lock exactly as project records do.

### Worklog file (`WORK-NNNN.md`) — YAML frontmatter + Markdown body

```yaml
---
id: WORK-0001
title: Implement the record parser in agentmon-core
agent: rust-core-builder
status: in_progress   # in_progress | done | abandoned
started: 2026-08-18T09:12:00Z
finished: null        # ISO8601 when done
tags: [core, rust]
refs: [BUG-0002]      # related worklogs/bugs
files: [crates/agentmon-core/src/store.rs]
---
```

Body sections (the CLI writes/validates this structure; PR-page bar):

```markdown
## What
## Why
## How
## Updates
### 2026-08-18T10:00:00Z
(progress note appended by `agentmon work update`)
## Outcome
(required when status becomes done — what shipped, what changed, verification)
```

### Bug file (`BUG-NNNN.md`)

```yaml
---
id: BUG-0001
title: App crashes when project.json is missing
reporter: ui-builder
assignee: null        # set by `bug claim`
severity: high        # critical | high | medium | low
status: open          # open | in_progress | resolved | closed
labels: [cli, crash]
created: 2026-08-18T09:12:00Z
claimed: null
resolved: null
resolved_by: null
refs: []
---
```

Body sections:

```markdown
## Report
(repro steps, expected, actual — written by reporter)
## Comments
### 2026-08-18T10:00:00Z — <agent>
(appended by `bug comment`)
## Resolution
(required on resolve — what the fix was, why it works, how it was verified)
```

### Note file (`notes/<name>.md`) — shared agent knowledge

Work logs and bugs are **history**: append-only, corrected in place by dated notes, never
removed by an agent. A note is **knowledge** — the memory, handoff, decision or reference
one agent leaves for the next — and stale knowledge misleads every reader, so notes are
the one record kind agents may rewrite in place and remove. Every one of those moves
appends a `note_*` event: the file holds what is currently true, the feed holds who
changed it and when.

```yaml
---
name: registry-gate-gotcha        # kebab-case, 2–64 chars; the identity AND the file name.
                                  # No NOTE-NNNN sequence: a note is looked up by what it
                                  # is about. Derived from the title, or passed explicitly.
title: Gate scripts must sandbox the registry
type: memory                      # essential | memory | handoff | decision | reference
description: Any script that runs agentmon init must set AGENTMON_REGISTRY_DIR.
                                  # one line, <=200 chars — the hook every list shows;
                                  # agents scan descriptions instead of opening bodies
agent: gate-builder               # the author; the frontmatter keeps them as others rewrite
updated_by: null                  # the last rewriter — whose words the current body is.
                                  # Set by every `note update`; screens that pair one agent
                                  # with the body show this one (falling back to the author)
created: 2026-08-20T09:00:00Z
updated: 2026-08-20T09:00:00Z     # updates stamp this; ordering rules apply (see below)
tags: [gates, registry]
refs: [WORK-0035]                 # WORK-/BUG- ids, or other notes' names
---
(free-form markdown body — no mandated sections; the shape is whatever the knowledge needs)
```

The five types answer five questions: **essential** — required reading before a session
starts work: the index that points at the notes that matter now, surfaced first by every
list; **memory** — a durable fact or gotcha about this project; **handoff** — state for
whoever works next, rewritten as sessions hand over; **decision** — a choice and its
reasoning, so it is not relitigated; **reference** — a pointer to something outside the
project. Names may not take a `work-N`/`bug-N` shape or
a Windows reserved device name. `agentmon note update` **replaces** what it is given
(the body wholesale) — a handoff is the current state, not a diary. `agentmon note
remove` deletes the file and logs `note_removed`; there is no equivalent for work logs
or bugs, anywhere.

Every CLI mutation also appends one line to `events.jsonl`. Timestamps: UTC ISO8601.
IDs are immutable and per-project. Parsing must be lenient on unknown keys (forward compat).
`refs` values are validated at write time: record ids by shape, note names by existence —
a ref to a note that is later removed simply renders as a missing reference, which is the
legal lifecycle, not corruption.

In record **prose**, the app links `WORK-`/`BUG-` ids written bare, and notes written as
`[[note-name]]` — the double brackets are the explicit opt-in (a bare kebab word in a
sentence is usually just a word). Either shape naming a record that does not exist renders
as a visibly-stale chip, same as a missing `refs` entry.

## CLI surface (`agentmon`, gh-style)

```
agentmon init [--dir <folder>] --name <n> [--description <d>] [--tags a,b] [--at T] [--claude-md ko|en]
              [--mcp-json [--mcp-agent h]]
                                          # creates <folder>/AgentMonitoring; --claude-md also
                                          # writes agent instructions to <folder>/CLAUDE.md
                                          # (append if the file exists; skip if already there);
                                          # --mcp-json also writes <folder>/.mcp.json registering
                                          # the agentmon MCP server (only the agentmon entry is
                                          # ever added or replaced in an existing file)
agentmon project view [--json]
agentmon project update [--name <n>] [--description <d>] [--tags a,b] [--at T]
agentmon project list                     # the machine's registry (informational)
agentmon project mcp-json [--agent h]     # write/refresh .mcp.json for an existing project
agentmon work start   --agent <name> --title <t> [--tags] [--body-file f | --body s] [--started-at T]
agentmon work update  <WORK-ID> --agent <name> (--message s | --body-file|--message-file f) [--at T]
agentmon work done    <WORK-ID> --agent <name> (--outcome s | --outcome-file f) [--files a,b] [--finished-at T] [--started-at T]
agentmon work abandon <WORK-ID> --agent <name> (--reason s | --reason-file f) [--at T]
agentmon work list    [--status s] [--agent a] [--json]
agentmon work view    <WORK-ID> [--json]
agentmon bug create   --agent <name> --title <t> --severity <s> (--body s | --body-file f) [--labels] [--created-at T]
agentmon bug claim    <BUG-ID> --agent <name> [--at T]
agentmon bug comment  <BUG-ID> --agent <name> (--message s | --body-file|--message-file f) [--at T]
agentmon bug resolve  <BUG-ID> --agent <name> (--resolution s | --resolution-file f) [--at T]
agentmon bug list     [--status s] [--severity] [--label] [--json]
agentmon bug view     <BUG-ID> [--json]
agentmon note add     --agent <name> --title <t> --type <ty> --description <d> (--body s | --body-file f)
                      [--name <kebab>] [--tags] [--refs] [--at T]     # alias: note create
agentmon note update  <name> --agent <name> [--title] [--type] [--description] [--tags] [--refs]
                      (--body s | --body-file f) [--at T]             # --body REPLACES; --tags/--refs replace their lists
agentmon note remove  <name> --agent <name> [--at T]                  # alias: note rm — logs note_removed
agentmon note list    [--type t] [--tag] [--agent] [--search text] [--json]
agentmon note view    <name> [--json]
agentmon status                           # snapshot: active work, open bugs, latest notes, recent events
agentmon doctor                           # validate project integrity, exit non-zero on problems
agentmon migrate --from <vault> --project <slug> --to <folder>   # v1 → v2 bridge
agentmon app-feedback add     --agent <name> --type bug|idea --title <t> [--body s] [--at T]
agentmon app-feedback list    [--status open|done] [--type bug|idea] [--json]
agentmon app-feedback view    <FB-ID> [--json]
agentmon app-feedback done    <FB-ID>     # also: reopen
agentmon app-feedback delete  <FB-ID>     # done items only — an open item refuses
                                          # machine-level (~/.AgentMonitoring/feedback) — no --dir
```

Project resolution (git-style): `--dir <folder>` flag > `AGENTMON_DIR` env > the nearest
`AgentMonitoring/project.json`, searching upward from the current directory. Inside a
repo that has one, no flags are needed — there is no `-p` and no `--vault`.
`work start` on `--body` expects `## What / ## Why / ## How` sections; CLI provides a
template and rejects bodies missing them (clear error). Exit codes and `--json` output are
part of the contract (agents script against them). Errors must say how to fix.

`--dir` and `--json` are **global**: they may appear before or after the subcommand.

**Backdating (`T` above).** Agents write records after doing the work, so every mutation
takes the time it really happened (`--started-at` / `--finished-at` / `--at` /
`--created-at`, UTC ISO8601). The supplied timestamp is written into the record's
frontmatter *and* into the `events.jsonl` line, so the app's timeline is the real one.
Rejected with exit `2`: a time in the future, or one earlier than the state it follows
(an update before `started`, a resolution before `claimed`, a note edit or removal
before the note's last `updated`).

## Desktop app screens

1. **Shell** — Linear-style: left sidebar (project switcher, nav: Dashboard / Work / Bugs /
   Notes, every registered project listed), dark theme, Inter font, dense-but-calm layout,
   keyboard focus visible. Routes carry the project **id**.
2. **Dashboard** (per project; Grafana bar) — current status: now-active agents & their
   in-progress work, open bug count by severity, activity timeline (events feed), charts
   (work completed over time, bugs opened vs resolved, per-agent activity).
3. **Work list** — filterable table (status, agent, tag, search).
4. **Work detail** (vscode merged-PR bar) — title, meta (agent, status, dates, tags, files),
   rendered What/Why/How, Updates timeline, Outcome. A reader who never saw the work must
   be able to reconstruct what/why/how.
5. **Bug board** (vscode issues bar) — filterable list (status, severity, label, assignee),
   open/resolved counts, severity badges.
6. **Bug detail** — report, comment thread, resolution record, status history.
7. **Notes** — the shared knowledge, filterable by type (essential / memory / handoff /
   decision / reference), tag, agent, search; each row shows the author's own one-line
   description, essential notes first and then most recently updated (the newest handoff
   is addressed to whoever just arrived; the essentials are addressed to everyone).
8. **Note detail** — the description as the lead, the free-form body, the related records,
   who wrote it and when it last changed. The app **reads** notes; writing is the CLI's
   and MCP's (agents' hands, not the human's mouse) — the human curates by telling agents,
   or by editing the plain file.
9. **Projects** — every registered folder as a row (unavailable ones dimmed, with the last
   name the registry saw); **New project** with a location picker (creates
   `<location>/AgentMonitoring`); **Open project…** (registers an existing folder);
   **Remove from list** (unregisters, touches no files); **Delete**. Delete is
   **human-only and app-only**: it removes the project's `AgentMonitoring` folder and
   every record in it from disk, permanently — never the code around it — behind a dialog
   that will not arm its button until the human types the project's name, and that owns
   the window while it is up (nothing navigates the page out from under it and nothing
   opens over it). There is no CLI subcommand and no MCP tool for it — agents write
   records and never take one away. (`agentmon note remove` is not an exception to that
   rule but its boundary: a note is knowledge, not a record of what happened, and the
   removal itself stays on the event feed. History — work logs, bugs, events — has no
   removal verb anywhere agents can reach.)

Live updates: one notify watcher per registered folder, re-armed when the roster changes;
a watchdog turns an unplugged folder into an unavailable row instead of a frozen window.

## Performance (owner requirement: no felt slowdown, no memory bloat)

- **No polling, ever.** Watching is OS-event-driven; idle CPU is zero regardless of
  project count. (Browser mode's dev-server cursor poll is the dev harness, not the app.)
- **Availability checks don't block.** The project list renders from the registry;
  reachability resolves per row. One dead network drive must not delay the others.
- **Bounded merges.** The cross-project activity feed merges per-project tails capped at
  a fixed N per root; it never grows with total history size.
- Budget: with 10 registered projects each carrying this repo's own history, cold launch
  within ~100 ms of the single-project case, and data-layer memory in the low tens of MB.

## Design system (Linear bar)

- Dark theme first. Background layers ~#0e0f11 / #16171a / #1c1d21; borders rgba-white ~6-10%;
  text #e8e9eb primary, #8a8f98 secondary; one restrained accent (indigo ~#5e6ad2).
- Inter (via @fontsource-variable/inter, bundled, no network at runtime). 13-14px base,
  tight tracking on headings, tabular-nums for tables/IDs.
- 8px spacing grid; radii 6-8px; subtle shadows; instant hover states; no gradients-noise.
- Status/severity = small dot or pill + label, muted saturated colors, consistent everywhere.
- Empty states designed, not blank. Loading = skeletons, no spinners-on-white.

## Real scenario data requirement

Critics judge screens **with real scenario data**: the repo's own AgentMonitoring folder must contain the actual build
history of this app (builders log their real work via the CLI as they build) plus one
realistic fictional team project for volume. No lorem ipsum anywhere, ever.
