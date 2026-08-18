# agentmon manual

`agentmon` is how an AI agent writes down what it did. It appends to a **vault** — a
directory of plain text files — and humans read that vault in the AgentMonitoring desktop
app. You are probably here because you just finished (or are about to start) a piece of
work and need to record it.

Nothing in this manual assumes you have read the project's spec or source. Everything you
need is here.

**In a hurry?** Jump to [Recipes](#recipes): three copy-pasteable sequences that cover
recording work, filing a bug, and fixing someone else's bug.

---

## Contents

1. [What a vault contains](#what-a-vault-contains)
2. [Getting the binary](#getting-the-binary)
3. [Finding the vault](#finding-the-vault)
4. [Identifying yourself](#identifying-yourself)
5. [The body contract](#the-body-contract) — the part agents get wrong
6. [Recipes](#recipes) — copy, paste, edit the prose
7. [Command reference](#command-reference)
8. [JSON output](#json-output)
9. [Exit codes](#exit-codes)
10. [Writing records worth reading](#writing-records-worth-reading)
11. [Troubleshooting](#troubleshooting)
12. [Multiple agents at once](#multiple-agents-at-once)

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
| Lifecycle | `in_progress` → `done` | `open` → `in_progress` → `resolved` |
| Body | `## What` `## Why` `## How` + `## Updates` + `## Outcome` | `## Report` + `## Comments` + `## Resolution` |
| Created by | `agentmon work start` | `agentmon bug create` |

Ids are per project and zero-padded: the first work log in every project is `WORK-0001`.
They never change. Every command that writes also appends one line to `events.jsonl`, which
is what the app's activity feed and charts are built from — you never write that file
yourself.

Timestamps are always UTC ISO8601 with second precision: `2026-08-18T09:12:00Z`.

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

`--vault` is global: it goes before or after the subcommand, either works.

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
out in full**, so every example works with nothing exported.

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

The same three forms exist for every prose flag: `--outcome` / `--outcome-file`,
`--resolution` / `--resolution-file`, `--message` / `--body-file`.

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

### Recipe 2 — file a bug

File a bug for something broken that you are **not** fixing right now. If you are fixing it
immediately, a work log is usually the better record.

```bash
agentmon bug create -p agent-monitoring \
  --agent my-agent \
  --title "Work list drops the tag filter when you navigate back" \
  --severity medium \
  --labels frontend,filters \
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

---

## Command reference

Global: `--vault <DIR>` works on every command. `--json` works on every command (see
[JSON output](#json-output)). Every command has a worked example in `--help`.

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
agentmon project create <slug> --name <n> [--description <d>] [--tags a,b] [--agent <name>] [--json]
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
                    (--body <markdown> | --body-file <file|->) [--json]
```

Creates the next `WORK-NNNN` and prints its id. Body must contain `## What`, `## Why`,
`## How` — see [the body contract](#the-body-contract). `--refs` links related records and
is what makes "this work fixed that bug" visible in the app.

```bash
agentmon work start -p agent-monitoring --agent my-agent \
  --title "Wire the vault watcher into the desktop app" \
  --tags tauri,live-updates --refs BUG-0002 \
  --body-file plan.md
```

### `agentmon work update`

```
agentmon work update <WORK-ID> -p <project> --agent <name>
                     (--message <text> | --body-file <file|->) [--json]
```

Appends a timestamped note under `## Updates`. Append-only: notes are never edited or
reordered. Fails with exit `5` on a work log that is already `done` — finished records are
history.

```bash
agentmon work update WORK-0004 -p agent-monitoring --agent my-agent \
  --message "Debounce is in. One save produced four raw filesystem events; now it is one refresh."
```

### `agentmon work done`

```
agentmon work done <WORK-ID> -p <project> --agent <name>
                   (--outcome <text> | --outcome-file <file|->)
                   [--files a,b] [--refs ...] [--json]
```

Sets `status: done`, stamps `finished`, and writes `## Outcome`. `--files` and `--refs` are
merged into whatever the record already has (never replaced, never duplicated). The outcome
needs at least ~24 characters of real content; `"done"` is rejected.

```bash
agentmon work done WORK-0004 -p agent-monitoring --agent my-agent \
  --files src-tauri/src/lib.rs \
  --outcome "Shipped the debounced watcher; cargo test --workspace green and one CLI write now produces exactly one UI refresh."
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
                    (--body <text> | --body-file <file|->) [--labels a,b] [--refs ...] [--json]
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
agentmon bug claim <BUG-ID> -p <project> --agent <name> [--json]
```

Sets `assignee` and moves the bug to `in_progress`.

```bash
agentmon bug claim BUG-0002 -p agent-monitoring --agent my-agent
```

### `agentmon bug comment`

```
agentmon bug comment <BUG-ID> -p <project> --agent <name>
                     (--message <text> | --body-file <file|->) [--json]
```

Appends `### <timestamp> — <agent>` to the thread. Allowed in any state.

```bash
agentmon bug comment BUG-0002 -p agent-monitoring --agent my-agent \
  --message "Reproduced on Windows 11. The watcher never starts, so nothing is ever emitted."
```

### `agentmon bug resolve`

```
agentmon bug resolve <BUG-ID> -p <project> --agent <name>
                     (--resolution <text> | --resolution-file <file|->) [--json]
```

Writes `## Resolution`, sets `status: resolved`, stamps `resolved` and `resolved_by`.

```bash
agentmon bug resolve BUG-0002 -p agent-monitoring --agent my-agent \
  --resolution-file resolution.md
```

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
to parse prose.

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
| `2` | Usage error: unknown flag, missing argument, bad value | Re-read the message; it names the flag and the allowed values |
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
only if you genuinely need a new one.

**`project '<slug>' not found`** — run `agentmon project list`. Slugs are the directory
names under `projects/`; `-p` takes the slug, not the display name.

**`work log body rejected: missing the ## Why section`** — read the template it printed and
add the section. Common cause: the shell ate your heredoc. Verify what the shell actually
produced with `echo "$(cat <<'EOF' ... EOF )"` before blaming the CLI.

**Everything went into `## What` and the other sections are empty** — your headings are not
at the start of a line, or they use `#`/`###` instead of `##`. Exactly two hashes, then a
space.

**`WORK-0004 is already done`** — a finished work log is immutable. Start a new one:
`agentmon work start`.

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
