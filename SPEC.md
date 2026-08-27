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
| Human area (every record) | Beats the default `eli5` plugin's output on the same record in a blind A/B — omits less *and* reads easier; a non-expert can retell what happened accurately (jvns.ca bar); the human view looks native to this app next to its other screens |
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
                                  #        human_updated|project_created|project_updated
                                  #        (human_updated: a mutation that changed only the
                                  #         human area — see "The human area" below)
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
                                         #   agent, status (open|done), created, done,
                                         #   updated (when the human area was last
                                         #   rewritten — this board has no events.jsonl,
                                         #   so the frontmatter carries `--at` itself);
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

**An event's claim must match the record it names.** `work_updated` is the strict case:
the writer emits it in the same call that appends the `### <ts>` entry under `## Updates`,
so an event with no entry at that exact timestamp cannot have come from agentmon, and the
dashboard is announcing a progress note a reader cannot open. `doctor` pairs every
`work_updated` against its record and reports an unpaired one as an **error** — checking an
event's shape (valid JSON, known type, resolvable `ref`, parseable timestamp) was never
integrity. Where an orphan cannot be repaired — the note text is gone and the event's
truncated `summary` is all that survives — it is accounted for by name in the project's
`notes/event-reconciliation.md`, one exact `WORK-NNNN@<ts>` token per orphan plus the
reason. Tokens there stop it being an error; `doctor` still prints every accounted event on
every run, because the feed and the files do still disagree. No wildcards: a bare record id
accounts for nothing. Inventing a note body from the summary is never the repair.
`refs` values are validated at write time: record ids by shape, note names by existence —
a ref to a note that is later removed simply renders as a missing reference, which is the
legal lifecycle, not corruption.

In record **prose**, the app links `WORK-`/`BUG-` ids written bare, and notes written as
`[[note-name]]` — the double brackets are the explicit opt-in (a bare kebab word in a
sentence is usually just a word). Either shape naming a record that does not exist renders
as a visibly-stale chip, same as a missing `refs` entry.

### The human area — every record speaks to two audiences (owner directive, 2026-08-22)

Every record — work log, bug, note, app feedback — carries two areas. The **agent
area** is everything above: What/Why/How/Updates/Outcome, Report/Comments/Resolution,
the note body. The **human area** is the same events retold by the agent that did the
work, for a reader who was not there and does not program: jvns.ca-plain, concrete,
omitting nothing that matters. The full style contract lives in `docs/HUMAN_STYLE.md`;
it is **write-time reading** — embedded in the binary, printed whole by
`agentmon human-style`, and a compact extract of it is printed by a rejection that
better writing would fix — never session-start reading. (The one rejection whose repair
is neither writing nor rewriting, an agent area that leaves a code fence open, names the
command instead of spending the lines.) Human areas are written in the record's own
language.

Storage: the last body section of the record file, under the reserved heading
`## For humans`. Supplied agent bodies/messages may not contain that heading (exit 2,
"reserved"), nor may they leave a code fence open — the heading is appended *after* the
agent area, so an unclosed ``` swallows it and the record saves with no human area at all
(exit 2, naming the flag and the line; a record already in that state on disk refuses
every mutation until the fence is closed, and `agentmon doctor` lists those separately, as
an **error** — a record no write can reach is a broken project, not an untidy one).
Legacy files without it parse fine (`human: null`) — reading is lenient,
**writing is not** (`agentmon migrate` copies v1 record files across untouched, so a
migrated project arrives as legacy records and gains its human areas on first touch):

- Mutations that create or close a record **require** the human area
  (`--human s | --human-file f`): `work start`, `work done`, `work abandon`,
  `bug create`, `bug resolve`, `note add`, `note update` when `--body` is given,
  `app-feedback add`. On work logs and bugs, closing verbs **append** the ending's
  telling as the page's last node (see below); notes stay replace-in-place — they
  are knowledge, not history.
- Mutations that write agent prose onto a record require it too (owner directive,
  2026-08-24): `work update` and `bug comment` refuse a `--message` without `--human`
  — replayed or not — because a progress note or a finding is new events, and a
  retelling that omits them is stale by definition. (Before this, `--message` alone
  was legal on a record that already had a human area, and agents used the gap as a
  bypass: the real content went into `## Updates`/`## Comments` and the human area
  froze.)
- That `--human` is **one telling, appended** (owner decision, 2026-08-25): inside
  the human area it becomes a `### <ts>` node carrying the same timestamp as the
  `## Updates`/`## Comments` entry it travels with, after everything already on the
  page — so the two halves pair node for node and no earlier telling can be lost.
  A replayed note's telling is inserted at its place in that timeline instead. The
  first text a record's human area receives (`work start`, `bug create`, or the
  first touch of a legacy record) is the page's opening and carries no node heading.
  (Replace-with-the-whole-story was the rule before, taught by the compact rules,
  and it did not hold: agents kept passing only the newest round, deleting every
  telling before it at exit 0.)
- Any mutation touching a record that still lacks a human area must supply one
  (legacy records gain it on first touch). The exception is the three flagless
  status flips `app-feedback done` / `reopen` / `delete`: they take no `--agent`
  and no arguments because they are the owner's own board buttons in the app, and
  the person clicking Done has no retelling to write and nowhere to type one. An
  item filed before this change gains its human area through `app-feedback update`.
- Update verbs accept `--human` **alone** to refresh it with no other change
  (`work update`, `bug comment`, `note update`, `app-feedback update` — the last
  exists for this). A refresh never writes into `## Updates`/`## Comments`; in a
  project, a refresh-only mutation logs a `human_updated` event, otherwise the
  mutation's own event covers it. A refresh **replaces the page whole** — since the
  append rule it is the one deliberate way to curate the human area (merge tellings,
  repair an earlier one). `app-feedback update` logs nothing at all: the
  app-feedback board is machine-level, has no `events.jsonl`, and carries the time
  of the refresh in the item's own `updated` frontmatter instead.
- Missing or blank → exit 2, and the error itself prints the compact style rules
  plus how to read the full contract — the teaching cost is paid only on failure.
  The MCP tools mirror all of this: `human` fields with the same required-ness, and
  the rejection text carries the same rules.
- `human` is a `string | null` field in every `--json` view and both app transports.
  In every JSON/API payload the `body` (and parsed sections) is the agent area ONLY —
  the `## For humans` section is stripped from it; the record file is the one place
  the two areas cohabit. `agentmon <kind> view` (human-readable output) shows both,
  labelled.

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
agentmon work start   --agent <name> --title <t> (--body s | --body-file f) --human s|--human-file f [--tags] [--started-at T]
agentmon work update  <WORK-ID> --agent <name> --human s|--human-file f [--message s | --body-file|--message-file f] [--at T] [--replayed]
                      # --human alone is a refresh (replaces the page); with --message it is one telling, appended
agentmon work done    <WORK-ID> --agent <name> (--outcome s | --outcome-file f) --human s|--human-file f [--files a,b] [--finished-at T] [--started-at T]
agentmon work abandon <WORK-ID> --agent <name> (--reason s | --reason-file f) --human s|--human-file f [--at T]
agentmon work list    [--status s] [--agent a] [--json]
agentmon work view    <WORK-ID> [--json]
agentmon bug create   --agent <name> --title <t> --severity <s> (--body s | --body-file f) --human s|--human-file f [--labels] [--created-at T]
agentmon bug claim    <BUG-ID> --agent <name> [--human s|--human-file f] [--at T]
agentmon bug comment  <BUG-ID> --agent <name> --human s|--human-file f [--message s | --body-file|--message-file f] [--at T] [--replayed]
                      # --human alone is a refresh (replaces the page); with --message it is one telling, appended
agentmon bug resolve  <BUG-ID> --agent <name> (--resolution s | --resolution-file f) --human s|--human-file f [--at T]
agentmon bug list     [--status s] [--severity] [--label] [--json]
agentmon bug view     <BUG-ID> [--json]
agentmon note add     --agent <name> --title <t> --type <ty> --description <d> (--body s | --body-file f)
                      --human s|--human-file f [--name <kebab>] [--tags] [--refs] [--at T]     # alias: note create
agentmon note update  <name> --agent <name> [--title] [--type] [--description] [--tags] [--refs]
                      [--body s | --body-file f] [--human s|--human-file f] [--at T]
                      # --body REPLACES and then requires --human; --tags/--refs replace their lists
agentmon note remove  <name> --agent <name> [--at T]                  # alias: note rm — logs note_removed
agentmon note list    [--type t] [--tag] [--agent] [--search text] [--json]
agentmon note view    <name> [--json]
agentmon status                           # snapshot: active work, open bugs, latest notes, recent events
agentmon doctor       [--strict] [--json]  # validate project integrity, exit non-zero on problems
                      # errors always fail; --strict fails on warnings too
agentmon reconcile    --theirs <folder> [--apply] [--only WORK-NNNN,BUG-NNNN] [--agent <name>] [--at T]
                      [--no-gitattributes]
                                          # two-machine id collision repair: re-key the LOCAL
                                          # side, rewrite every pointer — dry run by default
                                          # (see "Reconcile" below)
agentmon migrate --from <vault> --project <slug> --to <folder>   # v1 → v2 bridge
agentmon human-style                      # print docs/HUMAN_STYLE.md (embedded) — the write-time style contract
agentmon app-feedback add     --agent <name> --type bug|idea --title <t> --human s|--human-file f [--body s] [--at T]
agentmon app-feedback update  <FB-ID> --agent <name> --human s|--human-file f [--at T]
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

**The replay exception, exactly.** `--replayed` on `work update` and `bug comment` — those
two verbs, no others — is the one sanctioned way past the "earlier than the state it
follows" rule, and it exists for reconstruction alone: a record re-created after an id
collision (see Reconcile) taking its lost notes/comments back at their real times.
It requires an explicit `--at`, a `--message` and a `--human` (exit `2` without them —
a replay writes agent prose like any note, so the `--message`-requires-`--human` rule
holds here too); the floor stays
(nothing may predate `started`/`created`, or now); the entry is inserted at its place in
the timeline instead of appended; and the `work_updated`/`bug_commented` event carries the
entry's own timestamp with a summary opening `Replayed:` — a reconstructed line never
passes for an original. The human-area rules apply unchanged. The future rule has no
exception anywhere.

**Reconcile (two-machine id collisions).** Ids are immutable and allocated from local
state, so two clones of one repo working offline allocate the same numbers for different
records and the first `git pull` collides. `agentmon reconcile --theirs <incoming copy>`
repairs that without changing the id scheme: where one id holds different content on the
two sides, the **local** (unpushed) record is re-keyed to the next id free on *both*
sides, and everything pointing at it is rewritten in the same operation — the file rename,
its frontmatter `id`, every `refs:` entry and bare prose mention across local records (the
exact `WORK-`/`BUG-` grammar the app linkifies; `[[note-names]]` never), and
`events.jsonl` `ref` fields plus id mentions in summaries. Dry run by default, printing
the full plan and a from→to mapping; `--apply` executes exactly it. Left alone with the
reason stated: an id byte-identical on both sides (already synced — and `--only` naming
one is refused outright), and one record edited on both sides (a content merge; git's
job). The incoming copy is read, never written. Re-keying moves records without changing
a word of either area, so it takes no `--human`; an applied run logs one `project_updated`
event carrying the mapping. `--apply` also installs `events.jsonl merge=union` in the
project folder's `.gitattributes` (`--no-gitattributes` opts out): the event log is
append-only and every reader sorts by `ts`, so keeping both sides' lines *is* the correct
merge. Reconcile is CLI-only — it is a git-time operation, not an MCP tool. The recovery
recipe lives in docs/AGENT_MANUAL.md, "Two machines, one repo".

## Desktop app screens

1. **Shell** — Linear-style: left sidebar (project switcher, nav: Dashboard / Work / Bugs /
   Notes, every registered project listed), dark theme, Inter font, dense-but-calm layout,
   keyboard focus visible. Routes carry the project **id**.
2. **Dashboard** (per project; Grafana bar) — current status: now-active agents & their
   in-progress work, open bug count by severity, activity timeline (events feed), charts
   (work completed over time, bugs opened vs resolved). The per-agent activity table that
   sat between the charts and the feed was removed at the owner's direction (2026-08-27):
   everything it counted, the feed and the filterable boards already say.
3. **Work list** — filterable table (status, agent, tag, search).
4. **Work detail** (vscode merged-PR bar) — title, meta (agent, status, dates, tags, files),
   rendered What/Why/How, Updates timeline, Outcome — in that order on the page, and the
   timeline **chronological** (owner decision, 2026-08-25: start edge, notes 1..N, status
   edge, the Outcome card below the trail — the page reads the way the work ran; the bug
   thread and its Resolution card follow the same rule). A reader who never saw the work
   must be able to reconstruct what/why/how.
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
Every record detail screen (4, 6, 8, and App feedback's) carries an **Agent / Human
toggle**: Agent shows the areas above; Human renders the record's human area — the
eli5 friendly-explainer concept reinterpreted strictly through this app's design
tokens, so it reads as native next to every other screen. Since the owner's
2026-08-25 decisions the Human view is the agent page's **own skeleton** carrying the
easy-language content: an Overview card (the opening telling, standfirst plus
numbered blocks, the record's start stamped on its header), the timeline rail with
one numbered node card per dated telling — chronological, paired with the agent
half's entries by timestamp — and the ending's telling inside the same outcome card
the agent half closes on. Inside a card, a telling without bold lead-ins renders
each paragraph as a numbered block; the accent-marked closing line appears only on a
page with no outcome card. The toggle defaults to
Human when the record has a human area, the choice persists for the session, and a
record without one shows a designed empty state naming the exact CLI command that
adds it.

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
