# agentmon manual

`agentmon` is how an AI agent writes down what it did. It appends to a **vault** — a
directory of plain text files — and humans read that vault in the AgentMonitoring desktop
app. You are probably here because you just finished (or are about to start) a piece of
work and need to record it.

Nothing in this manual assumes you have read the project's spec or source. Everything you
need is here.

**In a hurry?** Jump to [Recipes](#recipes): three copy-pasteable sequences that cover
recording work, filing a bug, and fixing someone else's bug.

**Already finished the work and only now writing it down?** That is the normal case and it
is fully supported — go to
[Recording work you already finished](#recording-work-you-already-finished).

---

## Contents

1. [What a vault contains](#what-a-vault-contains)
2. [Getting the binary](#getting-the-binary)
3. [Finding the vault](#finding-the-vault)
4. [Identifying yourself](#identifying-yourself)
5. [The body contract](#the-body-contract) — the part agents get wrong
6. [Recipes](#recipes) — copy, paste, edit the prose
7. [Backdating](#backdating) — recording things after they happened
8. [Command reference](#command-reference)
9. [JSON output](#json-output)
10. [Exit codes](#exit-codes)
11. [Writing records worth reading](#writing-records-worth-reading)
12. [Troubleshooting](#troubleshooting)
13. [Multiple agents at once](#multiple-agents-at-once)

---

## What a vault contains

```
vault/
  vault.json                       # { version, name, createdAt }
  projects/<slug>/
    project.json                   # { id, slug, name, description, status, tags, createdAt }
    events.jsonl                   # append-only activity log, one JSON object per line
    worklogs/WORK-0001.md          # what you did (YAML frontmatter + markdown)
    bugs/BUG-0001.md               # what is broken (YAML frontmatter + markdown)
```

Two record types, and the difference matters:

| | **Work log** (`WORK-NNNN`) | **Bug** (`BUG-NNNN`) |
|---|---|---|
| What it is | something *you* are doing | something that is *broken* |
| Lifecycle | `in_progress` → `done` (or `abandoned`) | `open` → `in_progress` → `resolved` |
| Body | `## What` `## Why` `## How` + `## Updates` + `## Outcome` | `## Report` + `## Comments` + `## Resolution` |
| Created by | `agentmon work start` | `agentmon bug create` |

Ids are per project and zero-padded: the first work log in every project is `WORK-0001`.
They never change. Every command that writes also appends one line to `events.jsonl`, which
is what the app's activity feed and charts are built from — you never write that file
yourself.

Timestamps are always UTC ISO8601 with second precision: `2026-08-18T09:12:00Z`. Every
command stamps "now" unless you tell it otherwise — and you can always tell it otherwise
([Backdating](#backdating)).

---

## Getting the binary

The compiled CLI is at **`target/release/agentmon.exe`** (`target/release/agentmon` on
macOS/Linux), relative to the repository root.

If it is not there, build it — one command, no configuration:

```bash
cargo build --release -p agentmon-cli
```

Check it works:

```bash
./target/release/agentmon.exe --version
./target/release/agentmon.exe --help
```

Every example below writes `agentmon` for brevity. From the repository root, use
`./target/release/agentmon.exe`. To type less, alias it for your session:

```bash
alias agentmon="$PWD/target/release/agentmon.exe"
```

A debug build (`cargo build -p agentmon-cli` → `target/debug/agentmon.exe`) behaves
identically and compiles faster; use it if you are iterating on the CLI itself.

---

## Finding the vault

`agentmon` looks for the vault in this order and stops at the first hit:

1. `--vault <dir>` on the command line;
2. the `AGENTMON_VAULT` environment variable;
3. `./vault` in the current directory, if it contains a `vault.json`;
4. the current directory itself, if it contains a `vault.json`.

So from the repository root you can just run `agentmon status -p agent-monitoring` and it
finds `./vault`. From anywhere else, be explicit:

```bash
agentmon --vault /c/Code/AgentMonitoring/vault status -p agent-monitoring
# or, once per session:
export AGENTMON_VAULT=/c/Code/AgentMonitoring/vault
```

`--vault` is global: it goes before or after the subcommand, either works. So does
`--json`.

**If each of your commands runs in a fresh shell, `export` does not survive it.** Many
agent harnesses start a new process per tool call, so an `export AGENTMON_VAULT=...` you
ran in one call is gone by the next one — and rule 3 then quietly picks `./vault` in
whatever directory you happen to be in. Two safe options:

```bash
# 1. pass the vault on every command (the reliable one)
agentmon --vault /c/Code/AgentMonitoring/vault work list -p agent-monitoring

# 2. or re-export inside the same command as the write
export AGENTMON_VAULT=/c/Code/AgentMonitoring/vault && agentmon work list -p agent-monitoring
```

⚠️ The `./vault` fallback in this repository is the **live vault**: the real build history
of AgentMonitoring, which humans read in the app. Anything you write there is real, is
kept, and cannot be quietly deleted (there is no delete command by design). Experiment in
a throwaway vault instead:

```bash
agentmon init --vault /tmp/scratch-vault --name "Scratch"
agentmon --vault /tmp/scratch-vault project create demo --name "Demo"
```

`agentmon project list` prints the vault path it used as its first line — check it if you
are unsure which vault a write went to.

**Creating a vault** (only if you are starting from nothing — an existing project already
has one, and `init` refuses to touch it):

```bash
agentmon init --name "AgentMonitoring"                 # creates ./vault
agentmon project create checkout-rewrite \
  --name "Checkout rewrite" \
  --description "Replace the legacy checkout flow with the new payment provider." \
  --tags frontend,payments
```

---

## Identifying yourself

Every record carries the agent that wrote it. Pass `--agent <handle>` — a short, stable
name for you, like `cli-builder` or `ui-builder`. It appears in the app, in the per-agent
activity rollup, and on every event.

Set it once per session instead of repeating it:

```bash
export AGENTMON_AGENT=my-agent-handle
export AGENTMON_PROJECT=agent-monitoring   # supplies -p as well
```

With those exported, `agentmon work update WORK-0003 --message "..."` is a complete
command. Explicit flags always win over the environment. **This manual writes both flags
out in full**, so every example works with nothing exported — which also makes every
example safe in a harness that gives each command its own shell (see
[Finding the vault](#finding-the-vault)).

---

## The body contract

This is the one part of `agentmon` that will reject you, so read it before your first
write.

A work log answers three questions. The CLI checks that all three are present and that
none of them is a placeholder:

```markdown
## What

What you are building or changing, concretely enough that a reader can picture the diff.
Name files, commands, screens.

## Why

The reason this work exists: the problem, the constraint, the alternative you rejected.
A reader who disagrees with the change should still understand the reasoning.

## How

The approach: the design you chose, the tricky parts, anything a reviewer would otherwise
have to reverse-engineer from the code.
```

Rules, in full:

- All three headings are required, spelled `## What`, `## Why`, `## How` (case-insensitive,
  a trailing colon is tolerated). Order is up to you; the CLI writes them in this order.
- Each section needs at least ~12 characters of real content. `TODO`, `n/a`, `wip`,
  `fixed`, `-` and friends are rejected by name.
- Extra sections are welcome and are preserved wherever you put them: `## Alternatives
  considered`, `## Risks`, `## Follow-ups`.
- **Do not** include `## Outcome` at start — outcomes are written by `work done`. Same for
  `## Resolution` on a bug: that is `bug resolve`'s job.
- `## Updates` is written for you by `work update`; do not hand-write it.

Bugs are looser: plain prose becomes the `## Report` section automatically, so
`--body "Steps: ... Expected: ... Actual: ..."` is valid. Write `## Report` yourself only
if you want extra sections alongside it.

If you get it wrong, the CLI prints exactly what is missing, the full template, and a
command that would have worked. Exit code is `4`. Nothing is written — no half-record, no
event. Fix the body and re-run.

### Passing multi-line text in Git Bash

Use a quoted heredoc inside command substitution. The quotes around `'EOF'` matter: they
stop the shell from expanding `$`, backticks and `\` inside your prose.

```bash
--body "$(cat <<'EOF'
## What

...

## Why

...

## How

...
EOF
)"
```

Two alternatives when a heredoc is awkward (for example, when your harness mangles them):

```bash
--body-file notes.md      # read from a file
cat notes.md | agentmon work start ... --body-file -    # read from stdin
```

The same three forms exist for every prose flag — inline, from a file, or from stdin with
`-`:

| Command | Inline | From a file |
|---|---|---|
| `work start` | `--body` | `--body-file` |
| `work update` | `--message` | `--body-file`, or `--message-file` (same flag) |
| `work done` | `--outcome` | `--outcome-file` |
| `work abandon` | `--reason` | `--reason-file` |
| `bug create` | `--body` | `--body-file` |
| `bug comment` | `--message` | `--body-file`, or `--message-file` (same flag) |
| `bug resolve` | `--resolution` | `--resolution-file` |

(`--message-file` exists because `--message`'s file form being called `--body-file` is a
surprise; both spellings work and always will.)

---

## Recipes

### Recipe 1 — record a piece of work, start to finish

Run `work start` **when you begin**, not at the end. It gives you the id, and the
timestamps then describe reality.

```bash
# 1. Start. Prints "Started WORK-0004" — note the id.
agentmon work start -p agent-monitoring \
  --agent my-agent \
  --title "Cache project counts so the sidebar stops re-reading every record" \
  --tags performance,frontend \
  --body "$(cat <<'EOF'
## What

Cache the per-project work/bug counts that the sidebar shows, invalidating the cache
whenever the vault emits a change, instead of walking every record on each render.

## Why

The sidebar re-parses every worklog and bug in the project on every navigation. With ~40
records the switch between screens is visibly slow, and it gets worse with every record an
agent writes — the product gets slower the more it is used, which is the wrong direction.

## How

A small in-memory cache in the data layer keyed by project slug, cleared on the
`vault-changed` event that the desktop app already emits. No new dependency, no change to
the on-disk format.
EOF
)"

# 2. Update as you go. Any number of times; each is timestamped in order.
agentmon work update WORK-0004 -p agent-monitoring \
  --agent my-agent \
  --message "Cache is in and the sidebar no longer re-parses. Measured on the live vault: screen switch went from 180ms to 12ms. Invalidation on vault-changed works, but a vault switch needs to clear it too — doing that next."

# 3. Finish. The outcome is what a human reads first.
agentmon work done WORK-0004 -p agent-monitoring \
  --agent my-agent \
  --files src/lib/api.ts,src/AppContext.tsx \
  --outcome "$(cat <<'EOF'
Shipped the project-count cache in src/lib/api.ts, cleared from AppContext on both
`vault-changed` and an explicit vault switch.

Measured on the live vault (41 records): switching between Dashboard and Work went from
180ms to 12ms, and opening a work log no longer re-reads the bug directory at all.

Verified: npm run build (tsc clean), cargo test --workspace green, and a manual pass
through all six screens with an agent writing records in another terminal — counts update
without a refresh.
EOF
)"
```

Check your work the way a human will see it:

```bash
agentmon work view WORK-0004 -p agent-monitoring
```

#### Recording work you already finished

You did not run `work start` when you began — you are writing all of this up at the end.
That is normal, and it does **not** mean the record has to claim the work took four
seconds. Tell the CLI when things really happened. (`plan.md` and `outcome.md` below are
files you wrote first; `--body "..."` and `--outcome "..."` inline work exactly the same.)

```bash
# 1. Start the record with the real start time. Prints "Started WORK-0004".
agentmon work start -p agent-monitoring \
  --agent my-agent \
  --title "Cache project counts so the sidebar stops re-reading every record" \
  --tags performance,frontend \
  --started-at 2026-08-18T09:12:00Z \
  --body-file plan.md

# 2. Optional: the notes you would have written along the way, each with its own time.
agentmon work update WORK-0004 -p agent-monitoring --agent my-agent \
  --at 2026-08-18T10:05:00Z \
  --message "Cache is in and the sidebar no longer re-parses: screen switch went from 180ms to 12ms. Invalidation on a vault switch still missing."

# 3. Close it with the real end time.
agentmon work done WORK-0004 -p agent-monitoring --agent my-agent \
  --files src/lib/api.ts,src/AppContext.tsx \
  --finished-at 2026-08-18T11:30:00Z \
  --outcome-file outcome.md
```

That is a record a human cannot tell apart from one written live: `started`, `finished`,
every note, **and every line in `events.jsonl`** carry the times you gave, so the
dashboard's timeline, the durations and the activity feed are all the real ones.

Two details worth knowing:

- `--finished-at` belongs to `work done`, not to `work start` (a work log gains its end
  time when it is closed). Passing it to `work start` fails with exit `2` and prints the
  two commands above.
- Forgot `--started-at` and the record now says the work began when you typed it?
  `work done --started-at <when it really began> --finished-at <when it ended>` corrects
  both in one go.

The full set of timestamp flags, and the two rules that can reject one, are in
[Backdating](#backdating).

#### If the work stops instead of finishing

Work that will never be finished should say so, rather than sitting `in_progress` forever
on the dashboard with your name on it:

```bash
agentmon work abandon WORK-0004 -p agent-monitoring \
  --agent my-agent \
  --reason "Superseded by WORK-0009, which caches at the API layer instead and covers the same screens; nothing from this branch was kept."
```

Status becomes `abandoned`, the reason is appended under `## Updates`, and the clock stops
(`finished` is stamped with the moment it stopped, or with `--at <when>` if it stopped
earlier).

### Recipe 2 — file a bug

File a bug for something broken that you are **not** fixing right now. If you are fixing it
immediately, a work log is usually the better record.

(The `## Report` heading below is optional — plain prose becomes the report on its own. It
is written out here because it makes the example easy to extend with a second section.)

```bash
agentmon bug create -p agent-monitoring \
  --agent my-agent \
  --title "Work list drops the tag filter when you navigate back" \
  --severity medium \
  --labels frontend,filters \
  --refs WORK-0004 \
  --body "$(cat <<'EOF'
## Report

Repro:

1. Open the work list for `agent-monitoring`.
2. Filter by tag `rust`; the list narrows to 3 records.
3. Click into WORK-0002, then press Alt+Left to go back.

Expected: the list comes back filtered by `rust`, the way the browser back button behaves
everywhere else.

Actual: the filter is cleared and all records are shown. The tag chip is unselected, so it
is not just a display bug — the state is gone.

The filter lives in component state rather than in the URL, so nothing survives the
remount. Putting it in a query parameter would fix this and make filtered lists linkable.
EOF
)"
```

**Found it while doing something else? Say so with `--refs`, not only in the prose.**
`--refs WORK-0004` is what makes the link work in both directions: the bug lists that work
log under **References**, and — the half prose cannot do — the work log lists this bug under
**Referenced by**, so the next reader of the work meets the bug it produced. Writing
"noticed while working on WORK-0004" in the body is still worth it (ids in prose render as
links to the record they name), but that link only points one way. Same flag, same reason,
on `bug create`, `work start` and `work done`.

Severity, so you pick the same one a human would:

| | |
|---|---|
| `critical` | the product is unusable, or data is being lost |
| `high` | a core flow is broken and there is no workaround |
| `medium` | broken with a workaround, or visibly wrong but survivable |
| `low` | cosmetic, or an edge case nobody hits often |

### Recipe 3 — take a bug and fix it

```bash
# 1. See what is open.
agentmon bug list -p agent-monitoring --status open

# 2. Read the whole thing before touching anything.
agentmon bug view BUG-0002 -p agent-monitoring

# 3. Claim it, so no one else starts the same fix.
agentmon bug claim BUG-0002 -p agent-monitoring --agent my-agent

# 4. Comment as you learn things. Root cause first — this is what makes the record useful.
agentmon bug comment BUG-0002 -p agent-monitoring \
  --agent my-agent \
  --message "Root cause: the Tauri shell never started a filesystem watcher, so the vault-changed event the frontend listens for was never emitted. Browser mode looked live only because Vite's own watcher pushes a page reload."

# 5. Resolve it — after the fix actually works.
agentmon bug resolve BUG-0002 -p agent-monitoring \
  --agent my-agent \
  --resolution "$(cat <<'EOF'
Root cause: no filesystem watcher existed in the Tauri shell, so `vault-changed` was never
emitted and the desktop app only re-read records when a route change re-ran the loader.

Fix: src-tauri/src/lib.rs starts a notify watcher on <vault>/projects, coalesces bursts
over a 250ms window, and emits `vault-changed` with the changed project slugs — the event
src/lib/api.ts already listened for. set_vault_path re-arms it so vault switching keeps
working.

Verified: cargo test --workspace (52 tests) including a new test that drives the real
watcher against a temp vault, and the bug's own repro on the built desktop app — one CLI
write now produces exactly one refresh, about 250ms behind the write.
EOF
)"
```

Rules the CLI enforces along the way, so you are not surprised:

- Claiming a bug someone else holds fails with exit `5` and tells you to comment instead.
  Re-claiming your own is a no-op, so re-running a script is safe.
- Commenting works in any state — threads outlive the fix.
- Resolving a bug you never claimed assigns it to you (you did the work).
- Resolving an already-resolved bug fails with exit `5`; if it regressed, file a new bug
  with `--refs BUG-0002`.

Filing all of this after the fact? Every step takes the time it really happened:
`bug create --created-at`, and `--at` on `claim`, `comment` and `resolve` — see
[Backdating](#backdating).

#### Write it so the reader can navigate it

Open each paragraph of a resolution (or of a work `## Outcome`) with a short **bold label**,
the way the example above does:

```markdown
**Root cause.** `dispatcher.rs` held the transaction across the HTTP send.

**Fix**, in `dispatcher.rs` and `queue.rs`:

1. The claim commits immediately.
2. The send holds no connection.

**Verified.**

- `cargo test --workspace` — 71 passed.
- Killed a worker mid-batch: 41 deliveries left in flight, all 41 reclaimed 90s later.
```

The record page turns each label into a heading, an anchor and a row in its contents rail
with the number of items under it, and a label beginning `Verified` or `Verification` is
drawn as an evidence panel with its checks counted — so the proof of a fix is the part a
reader lands on rather than the part they scroll past.

None of it is required: fewer than two labels renders exactly as you wrote it. And the app
never lifts a number out of your prose to summarise it — figures are set in full-strength
numerals inside the evidence panel, in the sentence you put them in. Write the before and
the after in that sentence ("peaked at 3, against 94 before") and the reader gets both.

---

## Backdating

Agents almost always write the record *after* doing the thing. Every mutation therefore
takes the time it really happened; nothing is inferred from when you typed it.

| Command | Flag | What it sets |
|---|---|---|
| `project create` | `--at` | `createdAt` and the `project_created` event |
| `project update` | `--at` | the `project_updated` event |
| `work start` | `--started-at` | `started` and the `work_started` event |
| `work update` | `--at` | the `### <timestamp>` note heading and its event |
| `work done` | `--finished-at` | `finished` and the `work_done` event |
| `work done` | `--started-at` | corrects `started` on a record that was logged late |
| `work abandon` | `--at` | `finished`, the note heading, and the `work_abandoned` event |
| `bug create` | `--created-at` | `created` and the `bug_created` event |
| `bug claim` | `--at` | `claimed` and the `bug_claimed` event |
| `bug comment` | `--at` | the comment heading and the `bug_commented` event |
| `bug resolve` | `--at` | `resolved` and the `bug_resolved` event |

**Accepted spellings.** UTC ISO8601 is the canonical one; the rest are conveniences and
are stored normalized to it:

```
2026-08-18T09:12:00Z        canonical — what ends up in the file
2026-08-18T09:12            seconds optional, read as UTC
"2026-08-18 09:12:00"       space instead of T (quote it, the shell splits on spaces)
2026-08-18                  midnight UTC
2026-08-18T11:12:00+02:00   an offset, converted to UTC (this one is 09:12Z)
```

Two rules, both enforced with exit `2` before anything is written:

1. **Not the future.** A record documents work that already happened. (A minute of clock
   skew is tolerated, so `--at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"` is always safe.)
2. **Not before the state it follows.** An update cannot predate `started` or the note
   before it; a resolution cannot predate the claim or the last comment. The error names
   both times, so the fix is arithmetic, not guesswork:

   ```
   agentmon: invalid --at '2026-08-18T10:00:00Z': expected a time at or after the work
   log's started time (2026-08-18T11:00:00Z) — timelines are rendered in order, so an
   out-of-order timestamp would show the work happening backwards
   ```

If you genuinely do not know when something happened, leave the flag off: `now` is honest,
and a wrong timestamp is worse than an imprecise one.

Getting the current time to build a stamp from:

```bash
date -u +%Y-%m-%dT%H:%M:%SZ          # 2026-08-18T12:41:07Z
date -u -d '2 hours ago' +%Y-%m-%dT%H:%M:%SZ
```

**Careful with multi-unit `ago`.** GNU date negates only the trailing unit, so
`date -u -d '4 hours 15 minutes ago'` resolves to the *future* (now **+** 3h45m), not
4h15m back. Use a single unit (`'255 minutes ago'`) or write the literal timestamp.
agentmon rejects future stamps with exit 2, so the mistake fails loudly instead of
writing a wrong time into the record — if you hit that error, this is usually why.

---

## Command reference

Global: `--vault <DIR>` and `--json` work on **every** command, and go anywhere on the
line — `agentmon --json work list -p x` and `agentmon work list -p x --json` are the same
command (see [JSON output](#json-output)). Every command has a worked example in `--help`.

### `agentmon init`

```
agentmon init [--vault <dir>] [--name <vault name>] [--json]
```

Creates a vault: `vault.json` plus an empty `projects/` directory. Target directory is
`--vault`, else `$AGENTMON_VAULT`, else `./vault`. Refuses (exit `5`) if a `vault.json` is
already there — it will never reset a live vault.

```bash
agentmon init --name "Team records" --vault /srv/records
```

### `agentmon project create`

```
agentmon project create <slug> --name <n> [--description <d>] [--tags a,b]
                       [--agent <name>] [--at <ISO8601>] [--json]
```

`<slug>` is the directory name and the value you pass to `-p` afterwards: lowercase
letters, digits, `-` and `_`, up to 64 characters.

```bash
agentmon project create checkout-rewrite \
  --name "Checkout rewrite" \
  --description "Replace the legacy checkout flow with the new payment provider." \
  --tags frontend,payments \
  --agent my-agent
```

### `agentmon project update`

```
agentmon project update <slug> [--name <n>] [--description <d>] [--tags a,b]
                       [--status active|archived] [--agent <name>] [--at <ISO8601>] [--json]
```

Changes a project's display metadata. Only the flags you pass change; `--tags` replaces the
whole list. The slug and id never move — they are what every record and URL points at.

Use it instead of editing `project.json` by hand: this way the change is logged as a
`project_updated` event, which is what the app's activity feed reads.

```bash
agentmon project update checkout-rewrite \
  --description "Replace the legacy checkout flow with the new payment provider, without a big-bang cutover." \
  --tags frontend,payments,q3 \
  --agent my-agent
```

`--status archived` puts a project out of the way: the app's Projects screen moves it under
"Archived" and stops offering it in the switcher. It deletes nothing — every record stays
exactly where it is, and `--status active` brings it back. The app's Archive button runs
this same code.

```bash
agentmon project update checkout-rewrite --status archived --agent my-agent
```

### `agentmon project list`

```
agentmon project list [--json]
```

Slug, name, work count, open-bug count, status and last activity per project.

```bash
agentmon project list
```

### `agentmon work start`

```
agentmon work start -p <project> --agent <name> --title <t>
                    [--tags a,b] [--refs WORK-0001,BUG-0002]
                    (--body <markdown> | --body-file <file|->)
                    [--started-at <ISO8601>] [--json]
```

Creates the next `WORK-NNNN` and prints its id. Body must contain `## What`, `## Why`,
`## How` — see [the body contract](#the-body-contract). `--refs` links related records and
is what makes "this work fixed that bug" visible in the app.

`--started-at` is for work that began before you got round to recording it; it sets
`started` and stamps the `work_started` event ([Backdating](#backdating)). There is no
`--finished-at` here: a work log gains its end time from `work done`.

```bash
agentmon work start -p agent-monitoring --agent my-agent \
  --title "Wire the vault watcher into the desktop app" \
  --tags tauri,live-updates --refs BUG-0002 \
  --started-at 2026-08-18T09:12:00Z \
  --body-file plan.md
```

### `agentmon work update`

```
agentmon work update <WORK-ID> -p <project> --agent <name>
                     (--message <text> | --body-file <file|-> | --message-file <file|->)
                     [--at <ISO8601>] [--json]
```

Appends a timestamped note under `## Updates`. Append-only: notes are never edited or
reordered, and nothing above `## Updates` is touched.

**A finished record still takes notes**, and that is how a shipped record gets corrected:
append a note opening with `Correction:` and the record page marks it and says
"1 correction — see Updates" under the title, above the sentence that is wrong. The status,
the timestamps and the outcome do not move, and the event is still `work_updated`. (What is
refused is *changing* a closed record: `work done` and `work abandon` still fail with exit
`5` on one.)

`--message-file` and `--body-file` are the same flag under two names. `--at` stamps the
note with the time it describes, which must be at or after `started`, at or after the
previous note, and — on a record that has closed — at or after `finished`
([Backdating](#backdating)).

```bash
agentmon work update WORK-0004 -p agent-monitoring --agent my-agent \
  --message "Debounce is in. One save produced four raw filesystem events; now it is one refresh."

agentmon work update WORK-0004 -p agent-monitoring --agent my-agent \
  --at 2026-08-18T10:05:00Z --message-file note.md

# a correction to work that finished days ago, written by somebody else
agentmon work update WORK-0004 -p agent-monitoring --agent reviewer \
  --message "Correction: the note above says the debounce window is 500ms; it is 250ms (src-tauri/src/lib.rs)."
```

### `agentmon work done`

```
agentmon work done <WORK-ID> -p <project> --agent <name>
                   (--outcome <text> | --outcome-file <file|->)
                   [--files a,b] [--refs ...]
                   [--finished-at <ISO8601>] [--started-at <ISO8601>] [--json]
```

Sets `status: done`, stamps `finished`, and writes `## Outcome`. `--files` and `--refs` are
merged into whatever the record already has (never replaced, never duplicated). The outcome
needs at least ~24 characters of real content; `"done"` is rejected.

`--finished-at` records when the work actually ended (it must be at or after `started` and
at or after the last note). `--started-at` corrects a start time on a record you created
late — use it when `work start` stamped "now" for work that began hours earlier.

```bash
agentmon work done WORK-0004 -p agent-monitoring --agent my-agent \
  --files src-tauri/src/lib.rs \
  --outcome "Shipped the debounced watcher; cargo test --workspace green and one CLI write now produces exactly one UI refresh."

# the same work, written up two hours after it ended
agentmon work done WORK-0004 -p agent-monitoring --agent my-agent \
  --started-at 2026-08-18T09:12:00Z --finished-at 2026-08-18T11:30:00Z \
  --outcome-file outcome.md
```

### `agentmon work abandon`

```
agentmon work abandon <WORK-ID> -p <project> --agent <name>
                      (--reason <text> | --reason-file <file|->)
                      [--at <ISO8601>] [--json]
```

Sets `status: abandoned`, stamps `finished` with the moment it stopped, appends the reason
as a timestamped note under `## Updates`, and logs a `work_abandoned` event.

Use it when work stops for good — superseded, blocked forever, or the approach turned out
to be wrong. The alternative is a work log that claims to be in progress on a dashboard
nobody is working from. Say what a reader should look at instead; that is the useful part
of the reason. Abandoning finished work fails with exit `5` (it happened; write a new
record referencing it instead), and so does abandoning it twice.

```bash
agentmon work abandon WORK-0004 -p agent-monitoring --agent my-agent \
  --reason "Superseded by WORK-0009, which caches at the API layer instead and covers the same screens; nothing from this branch was kept."
```

### `agentmon work list`

```
agentmon work list -p <project> [--status s] [--agent a] [--tag t] [--json]
```

`--status` is `in_progress`, `done` or `abandoned`.

```bash
agentmon work list -p agent-monitoring --status in_progress
```

### `agentmon work view`

```
agentmon work view <WORK-ID> -p <project> [--json]
```

```bash
agentmon work view WORK-0003 -p agent-monitoring
```

### `agentmon bug create`

```
agentmon bug create -p <project> --agent <name> --title <t> --severity <critical|high|medium|low>
                    (--body <text> | --body-file <file|->) [--labels a,b] [--refs ...]
                    [--created-at <ISO8601>] [--json]
```

Plain prose becomes `## Report`. See [Recipe 2](#recipe-2--file-a-bug).

```bash
agentmon bug create -p agent-monitoring --agent my-agent \
  --title "Work list drops the tag filter when you navigate back" \
  --severity medium --labels frontend,filters \
  --body "Repro: filter by tag, open a record, go back. Expected the filter to survive; it is cleared because filter state lives in the component, not the URL."
```

### `agentmon bug claim`

```
agentmon bug claim <BUG-ID> -p <project> --agent <name> [--at <ISO8601>] [--json]
```

Sets `assignee` and moves the bug to `in_progress`. `--at` records when you took it (at or
after the bug's `created`).

```bash
agentmon bug claim BUG-0002 -p agent-monitoring --agent my-agent
```

### `agentmon bug comment`

```
agentmon bug comment <BUG-ID> -p <project> --agent <name>
                     (--message <text> | --body-file <file|-> | --message-file <file|->)
                     [--at <ISO8601>] [--json]
```

Appends `### <timestamp> — <agent>` to the thread. Allowed in any state.
`--message-file` and `--body-file` are the same flag; `--at` must be at or after the bug's
`created` and at or after the previous comment.

```bash
agentmon bug comment BUG-0002 -p agent-monitoring --agent my-agent \
  --message "Reproduced on Windows 11. The watcher never starts, so nothing is ever emitted."
```

### `agentmon bug resolve`

```
agentmon bug resolve <BUG-ID> -p <project> --agent <name>
                     (--resolution <text> | --resolution-file <file|->)
                     [--at <ISO8601>] [--json]
```

Writes `## Resolution`, sets `status: resolved`, stamps `resolved` and `resolved_by`.
`--at` records when it was actually fixed; it must be at or after everything already on the
bug (created, claimed, the last comment).

```bash
agentmon bug resolve BUG-0002 -p agent-monitoring --agent my-agent \
  --resolution-file resolution.md
```

**Label the parts in bold, not with `##`.** Your text goes *inside* `## Resolution`, so a
`##` heading in it would end that section instead of nesting under it — the CLI refuses one
and tells you this. Write `**Root cause.**`, `**Fix.**`, `**Verified.**` at the start of a
paragraph: the app turns each into an anchored sub-section with its own contents row, which
is why every resolution in this vault reads the same way. `###` nests too, if you prefer it.
The same rule applies to `work done --outcome` and to `work update` / `bug comment`
messages, which live inside `## Outcome` and `## Updates`.

### `agentmon bug list`

```
agentmon bug list -p <project> [--status s] [--severity s] [--label l] [--assignee a] [--json]
```

`--status` is `open`, `in_progress`, `resolved` or `closed`.

```bash
agentmon bug list -p agent-monitoring --status open --severity high
```

### `agentmon bug view`

```
agentmon bug view <BUG-ID> -p <project> [--json]
```

```bash
agentmon bug view BUG-0002 -p agent-monitoring
```

### `agentmon status`

```
agentmon status -p <project> [--json]
```

The project snapshot: counts, active work, open bugs by severity, per-agent activity and
the last ten events. Run it before you start, to see what other agents are doing.

```bash
agentmon status -p agent-monitoring
```

### `agentmon doctor`

```
agentmon doctor [--strict] [--json]
```

Walks the whole vault and reports **everything** wrong with it — not just the first
problem. Two levels:

- **error** — the app will render something wrong or untrue: unparseable frontmatter, a
  `done` work log with no `## Outcome`, a resolved bug with no `## Resolution`, an id that
  does not match its filename, a duplicate id, a broken line in `events.jsonl`.
- **warning** — readable, but off: an event referencing a record that no longer exists, a
  project directory with no `project.json`, a write lock left behind by a killed process.

Exit `1` if there is any error; `--strict` makes warnings fail too. Run it after a batch of
writes, and before you hand work to a human.

```bash
agentmon doctor
agentmon doctor --strict --json
```

---

## JSON output

`--json` makes **all** output machine-readable, including failures, so a script never has
to parse prose. It is a global flag: put it after the subcommand
(`agentmon work list -p x --json`) or before it (`agentmon --json work list -p x`) —
both are the same command.

Success on a mutation:

```json
{
  "ok": true,
  "id": "WORK-0004",
  "path": "C:\\Code\\AgentMonitoring\\vault\\projects\\agent-monitoring\\worklogs\\WORK-0004.md",
  "event": {
    "ts": "2026-08-18T11:47:59Z",
    "actor": "my-agent",
    "type": "work_started",
    "ref": "WORK-0004",
    "summary": "Cache project counts so the sidebar stops re-reading every record"
  },
  "record": { "id": "WORK-0004", "title": "...", "status": "in_progress", "what": "...", "...": "..." }
}
```

Failure, on any command:

```json
{
  "ok": false,
  "error": {
    "kind": "conflict",
    "message": "WORK-0004 is already done (finished 2026-08-18T11:48:03Z) (fix: ...)",
    "exitCode": 5
  }
}
```

`kind` is stable and safe to branch on: `vault_not_found`, `project_not_found`,
`record_not_found`, `invalid_vault`, `invalid_argument`, `invalid_body`, `conflict`,
`locked`, `io_error`, `vault_problems`.

Capturing the new id in a script:

```bash
id=$(agentmon work start -p agent-monitoring --agent my-agent \
       --title "..." --body-file plan.md --json | grep -o '"id": "[^"]*"' | head -1 | cut -d'"' -f4)
echo "started $id"
```

With `jq` available, `... --json | jq -r .id` is the same thing.

Note that read commands print the record itself (`work view --json`, `bug list --json`),
not an envelope — those are the shapes the desktop app consumes.

---

## Exit codes

| Code | Meaning | What to do |
|---|---|---|
| `0` | Success | — |
| `1` | The vault has problems (`doctor` found errors) | Read the listed problems; each one names its fix |
| `2` | Usage error: unknown flag, missing argument, bad value — including a timestamp that will not parse, is in the future, or is out of order | Re-read the message; it names the flag and the allowed values |
| `3` | Not found: vault, project or record | `agentmon project list` / `work list` to see what exists |
| `4` | Body rejected: missing sections, or placeholder text | The message prints the template — rewrite and re-run |
| `5` | Conflict: already done, already claimed, already exists | The message says the alternative command to run |
| `6` | Invalid vault: corrupt frontmatter or `vault.json` | Run `agentmon doctor` for the full list |
| `7` | I/O error: permissions, missing file, disk | Check the path in the message |

A failed command writes **nothing**: no partial record, no orphan event. Re-running after a
fix is always safe.

---

## Writing records worth reading

The vault exists so a human — or an agent picking up where you stopped — can reconstruct
work they did not do. The bar is a well-written pull request description. Practically:

**Be specific instead of general.** "Fixed the watcher" tells a reader nothing. "The
watcher fired three times per write because Windows reports a directory-level Modify up to
250ms after the file events; filtering to `*.md`/`*.jsonl`/`*.json` drops those" tells them
everything, including how to recognise the same bug elsewhere.

**Name the artifacts.** Files, commands, screens, functions. `--files a,b` on `work done`
exists for exactly this.

**Say how you verified it.** A record that ends with "should work" is a record a human has
to re-verify. Put the command you ran and what it printed: `cargo test --workspace — 52
passed`, `npm run build — tsc clean`, `agentmon doctor — no problems`.

**Record what you rejected.** The most valuable line in a `## Why` is usually the option
you did not take and the reason.

**Write updates while you work, not afterwards.** `work update` is cheap and the timeline
it builds is the story of the work. Reconstructing it at the end produces a record that
reads like a summary, because it is one.

**Do not fabricate.** Never write a verification you did not run or a number you did not
measure. Everything here is read by humans checking whether the work happened.

`agentmon work view WORK-0002 -p agent-monitoring` shows a record written to this bar, if
you want a model to copy.

---

## Troubleshooting

**`no vault found at ...`** — you are not in the repository root, or the vault is elsewhere.
Pass `--vault /path/to/vault`, or `export AGENTMON_VAULT=/path/to/vault`. `agentmon init`
only if you genuinely need a new one. If it worked a moment ago and now does not, your
harness probably gave that command a fresh shell and lost the export — pass `--vault` on
every command instead ([Finding the vault](#finding-the-vault)).

**`invalid --started-at '18/08/2026': expected UTC ISO8601 ...`** — the message lists every
accepted spelling; the canonical one is `2026-08-18T09:12:00Z`. Build one with
`date -u +%Y-%m-%dT%H:%M:%SZ`.

**`invalid --at '...': expected a time at or after ...`** — the timestamp lands before the
thing it follows (the start of the work, the previous note, the claim). The message prints
the time you have to beat; pick a later one, or drop the flag and let it stamp now.

**`invalid --finished-at '...': expected a time at or before now`** — a clock or a typo:
records document work that already happened. Check the year and the timezone (an offset
form like `+02:00` is fine, it is converted for you).

**`--finished-at is not a flag of 'work start'`** — a work log gains its end time when it
is closed. Run `work start --started-at <began>` first, then
`work done <ID> --finished-at <ended> --outcome "..."`
([Recording work you already finished](#recording-work-you-already-finished)).

**`project '<slug>' not found`** — run `agentmon project list`. Slugs are the directory
names under `projects/`; `-p` takes the slug, not the display name.

**`work log body rejected: missing the ## Why section`** — read the template it printed and
add the section. Common cause: the shell ate your heredoc. Verify what the shell actually
produced with `echo "$(cat <<'EOF' ... EOF )"` before blaming the CLI.

**Everything went into `## What` and the other sections are empty** — your headings are not
at the start of a line, or they use `#`/`###` instead of `##`. Exactly two hashes, then a
space.

**`WORK-0004 is already done`** — a finished work log cannot be finished again, re-started
or rewritten; start a new one with `agentmon work start`. The same applies to `abandoned`
records. It can still be *added to*: `agentmon work update` appends a note to a closed
record, which is how a shipped record is corrected without editing history (see
[`agentmon work update`](#agentmon-work-update)).

**A work log of mine is stuck `in_progress` and I am not working on it** — close it
honestly: `agentmon work abandon <ID> -p <project> --agent <you> --reason "..."`. Do not
leave it; the dashboard reads `in_progress` as "an agent is on this right now".

**`BUG-0002 is already claimed by <someone>`** — do not take it over. Add what you know with
`agentmon bug comment`, or pick another bug from `agentmon bug list --status open`.

**`another agentmon process is writing to ...`** — another agent is mid-write; wait a second
and re-run. If the message says the lock has been held for minutes, the process holding it
died: delete the `.agentmon.lock` file it names (agentmon reclaims it automatically after
120 seconds anyway).

**`doctor` reports "status is done but there is no ## Outcome"** — usually a record that was
hand-edited. Edit the file to add the section; the CLI's own `work done` cannot produce
that state.

**The desktop app is not showing what I just wrote** — the app watches the vault and
refreshes about a quarter of a second after a write. If it does not, confirm you wrote to
the vault it opened: `agentmon project list` prints the vault path the CLI used, and the
app shows its own path in the sidebar.

**Non-ASCII characters look wrong in the terminal** — an output encoding issue in your
terminal, not in the file. Check the record with `agentmon work view <ID> -p <project>
--json` or open the `.md` file directly.

---

## Multiple agents at once

Several agents writing to one vault is expected, and the CLI is built for it:

- Id allocation happens under a per-project lock file, so two simultaneous `work start`
  calls get two different ids — never the same one.
- Record files are written to a temp file and renamed into place, so a reader (including
  the desktop app) sees either the old record or the new one, never half of one.
- `events.jsonl` lines are appended in a single write each, so the log is never interleaved
  mid-line.
- Nothing is ever overwritten blind: every update re-reads the record inside the lock and
  refuses transitions that are not legal.

What is *not* handled for you: two agents doing the same work. That is what
`agentmon status -p <project>` and `agentmon bug claim` are for — look before you start,
claim before you fix.
