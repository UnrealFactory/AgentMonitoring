# agentmon manual

`agentmon` is how an AI agent writes down what it did. It appends to the project's
**`AgentMonitoring` folder** — a directory of plain text files that lives inside the repo
the work happened in, the way `.git` does — and humans read those folders in the
AgentMonitoring desktop app. You are probably here because you just finished (or are about
to start) a piece of work and need to record it.

Nothing in this manual assumes you have read the project's spec or source. Everything you
need is here.

**Starting a session?** Run `agentmon note list` first — it is the index of what previous
agents left for you, and the **essential** notes it surfaces on top are required reading
before any work ([Notes](#notes--shared-agent-knowledge)).

**In a hurry?** Jump to [Recipes](#recipes): four copy-pasteable sequences that cover
recording work, filing a bug, fixing someone else's bug, and leaving knowledge behind.

**Already finished the work and only now writing it down?** That is the normal case and it
is fully supported — go to
[Recording work you already finished](#recording-work-you-already-finished).

---

## Contents

1. [What a project folder contains](#what-a-project-folder-contains)
2. [Getting the binary](#getting-the-binary)
3. [Finding the project](#finding-the-project)
4. [Identifying yourself](#identifying-yourself)
5. [The body contract](#the-body-contract) — the part agents get wrong
6. [Notes — shared agent knowledge](#notes--shared-agent-knowledge) — essential (read first), memory, handoffs, decisions
7. [Recipes](#recipes) — copy, paste, edit the prose
8. [Backdating](#backdating) — recording things after they happened
9. [Command reference](#command-reference)
10. [JSON output](#json-output)
11. [Exit codes](#exit-codes)
12. [Writing records worth reading](#writing-records-worth-reading)
13. [Troubleshooting](#troubleshooting)
14. [Multiple agents at once](#multiple-agents-at-once)

---

## What a project folder contains

```
<your repo>/
  AgentMonitoring/
    project.json                   # { version: 2, id, name, description, tags, createdAt }
    events.jsonl                   # append-only activity log, one JSON object per line
    worklogs/WORK-0001.md          # what you did (YAML frontmatter + markdown)
    bugs/BUG-0001.md               # what is broken (YAML frontmatter + markdown)
    notes/<name>.md                # what you know (YAML frontmatter + free markdown)
```

One folder per project, named exactly `AgentMonitoring`, living wherever the work lives.
Commit it with the repo and the history travels with the code. The desktop app lists every
such folder registered on the machine (`~/.AgentMonitoring/registry.json` — a bookmark
list the CLI adds to on `init`; the folder itself is always the source of truth).

Three record types, and the differences matter:

| | **Work log** (`WORK-NNNN`) | **Bug** (`BUG-NNNN`) | **Note** (`kebab-name`) |
|---|---|---|---|
| What it is | something *you* are doing | something that is *broken* | something you *know* |
| Lifecycle | `in_progress` → `done` (or `abandoned`) | `open` → `in_progress` → `resolved` | rewritten in place; removed when wrong |
| Body | `## What` `## Why` `## How` + `## Updates` + `## Outcome` | `## Report` + `## Comments` + `## Resolution` | free-form markdown |
| Created by | `agentmon work start` | `agentmon bug create` | `agentmon note add` |

Work logs and bugs are **history**: append-only, corrected by dated notes, never removed.
A note is **knowledge** — see [Notes](#notes--shared-agent-knowledge) — and it is the one
record you may rewrite and remove, because stale knowledge misleads whoever reads it next.

Ids are per project and zero-padded: the first work log in every project is `WORK-0001`.
They never change. A note has no number: its kebab-case **name** is its identity and its
file name, because a note is looked up by what it is about. Every command that writes also
appends one line to `events.jsonl`, which is what the app's activity feed and charts are
built from — you never write that file yourself.

Timestamps are always UTC ISO8601 with second precision: `2026-08-18T09:12:00Z`. Every
command stamps "now" unless you tell it otherwise — and you can always tell it otherwise
([Backdating](#backdating)).

---

## Getting the binary

The compiled CLI is at **`target/release/agentmon.exe`** (`target/release/agentmon` on
macOS/Linux), relative to this repository's root.

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

## Finding the project

`agentmon` resolves the project the way `git` resolves a repository, and stops at the
first hit:

1. `--dir <folder>` on the command line — the `AgentMonitoring` directory itself, or any
   folder that contains one;
2. the `AGENTMON_DIR` environment variable (same meaning);
3. the nearest `AgentMonitoring/project.json`, searching **upward from the current
   directory** — so from anywhere inside a repo that has one, every command just works,
   with no flags at all.

```bash
cd /c/Code/MyApp/src/components     # anywhere inside the repo
agentmon status                     # finds /c/Code/MyApp/AgentMonitoring

# from outside the repo, be explicit:
agentmon --dir /c/Code/MyApp work list
```

`--dir` is global: it goes before or after the subcommand, either works. So does
`--json`.

**If each of your commands runs in a fresh shell**, the walk-up makes that safe as long as
your working directory is inside the repo. An `export AGENTMON_DIR=...` from one tool call
is gone by the next in many harnesses — if your cwd is *not* inside the repo, pass
`--dir` on every command rather than relying on the export.

⚠️ In this repository, `./AgentMonitoring` is the **live history** of AgentMonitoring
itself, which humans read in the app. Anything you write there is real: work logs, bugs
and events are kept and cannot be quietly deleted (there is no delete command for them by
design), and even removing a note leaves its `note_removed` event on the feed. Experiment
in a throwaway project instead:

```bash
agentmon init --dir /tmp/scratch --name "Scratch"
agentmon --dir /tmp/scratch work list
```

`agentmon project view` prints the folder it resolved — check it if you are unsure where
a write went.

**Creating a project** (only if the repo does not have one — `init` refuses to touch an
existing one):

```bash
cd /your/repo
agentmon init --name "Checkout rewrite" \
  --description "Replace the legacy checkout flow with the new payment provider." \
  --tags frontend,payments
# creates ./AgentMonitoring and registers it in the app's project list
```

**Moving from the old layout?** Data written by v1 (`vault/projects/<slug>/…`) is carried
forward with one command, records and timestamps byte-for-byte:

```bash
agentmon migrate --from /path/to/old-vault --project <slug> --to /your/repo
agentmon doctor --dir /your/repo         # then delete the old vault yourself
```

---

## Identifying yourself

Every record carries the agent that wrote it. Pass `--agent <handle>` — a short, stable
name for you, like `cli-builder` or `ui-builder`. It appears in the app, in the per-agent
activity rollup, and on every event.

Set it once per session instead of repeating it:

```bash
export AGENTMON_AGENT=my-agent-handle
```

With that exported, `agentmon work update WORK-0003 --message "..."` is a complete
command. Explicit flags always win over the environment. **This manual writes the flag out
in full**, so every example works with nothing exported — which also makes every example
safe in a harness that gives each command its own shell.

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

### What renders — the body vocabulary

Bodies are markdown, and the app renders more of it than you might assume. Use it — a
record a human can scan beats a wall of prose:

| You write | The reader sees |
|---|---|
| `##`/`###` headings, paragraphs, `> quotes`, `---` | the usual structure |
| ` ``` `-fenced code with a language (` ```rust `) | a code block with syntax colour (js/ts, rust, python, bash, sql, go, json, yaml, toml, css) |
| pipe tables | real tables |
| `- [x] done` / `- [ ] open` | a task list with drawn checkboxes |
| `~~text~~` | strikethrough |
| `> [!note]` first line of a quote (also `tip`, `important`, `warning`, `caution`) | a toned callout box; the marker must be alone on its line |
| `WORK-0012` / `BUG-0004` in prose | a titled link chip to that record |
| `![what it shows](assets/diagram.svg)` | **the image, rendered** — alone in a paragraph it becomes a figure with the alt text as caption |

**Images are how you put a diagram in a record.** Write the file into the project's
`AgentMonitoring` folder (an `assets/` subfolder is the convention: `AgentMonitoring/assets/`)
and reference it by relative path. Rules, enforced by every reader:

- The path must stay **inside the AgentMonitoring folder** — `../` anywhere is refused.
- Extensions: `svg png jpg jpeg gif webp`, at most 10 MB. SVG is the right choice for
  diagrams you generate: text you can write, pixels the human reads.
- The app is **dark** (`#0e0f11` window, `#121317` behind the image). Give an SVG its own
  background rectangle or use light strokes, or it will be invisible ink.
- `http(s)` image URLs are **not fetched** (this app loads nothing from the network at
  runtime); they degrade to a plain link. Raw HTML and inline `<svg>` in a body never
  render — the renderer builds its own elements, so markup in a record cannot draw over
  the app.
- The alt text is not decoration: it is the caption under the figure and the sentence a
  reader gets if the file goes missing. Say what the image shows.

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
| `note add` | `--body` | `--body-file` |
| `note update` | `--body` | `--body-file` |

(`--message-file` exists because `--message`'s file form being called `--body-file` is a
surprise; both spellings work and always will.)

---

## Notes — shared agent knowledge

A note is what you wish the previous agent had told you, written down for the next one.
The other records answer "what happened"; a note answers **"what should whoever works
here next know right now"** — and because "right now" changes, a note is the one record
you rewrite in place and remove when it stops being true. Every one of those moves lands
on the event feed (`note_created` / `note_updated` / `note_removed`), so the file holds
what is currently true and the feed holds who changed it and when.

**The reading protocol.** Start a session with the index; the **essential** notes sort
first and are required reading — read them before any work, then open only what matters:

```bash
agentmon note list                    # every note: essential first, then by recency
agentmon note list --type essential   # only the required reading
agentmon note list --type handoff     # just the handoffs
agentmon note view <name>             # the whole note
agentmon note list --search registry  # matches name, title, description, tags and body
```

The one-line `--description` is the whole recall mechanism: it is what the list shows and
what you scan instead of opening bodies. Write it as the sentence that tells a stranger
whether to open the note.

**The five types** — pick the question your note answers:

| Type | Answers | Example |
|---|---|---|
| `essential` | what must every session read before working — the index that points at the rest | "start here: the release handoff, the registry gotcha, …" |
| `memory` | a durable fact or gotcha about this project | "gate scripts must set `AGENTMON_REGISTRY_DIR`" |
| `handoff` | what state is the work in; what should the next agent do first | "P13 list page done; wire the detail page next" |
| `decision` | what was chosen, what was rejected, and why | "notes use name-as-identity; NOTE-NNNN was rejected because…" |
| `reference` | where is the external thing | "the design bar is linear.app; reference shots in progress/refs/" |

Keep `essential` rare — one or two notes, MEMORY.md-style: a short index whose refs and
body point at the notes that matter now. If everything is essential, nothing is.

**The hygiene rules** (they are what keep the notes worth reading):

- **One fact, one file.** Before adding, run `agentmon note list` — if a note already
  covers it, `note update` that note instead of writing a near-duplicate. `note add`
  refuses a name that exists and says exactly this.
- **Rewrite, don't append.** `note update --body-file …` **replaces** the body — a
  handoff is the current state, not a diary. History belongs in work logs.
- **Remove what would mislead.** A note that turned out wrong, or a handoff that has been
  fully absorbed, comes down with `note remove`. Keeping it "just in case" costs every
  future reader a wrong belief. The removal event is the audit trail.
- **Wire it in.** `--refs WORK-0012,BUG-0004,other-note-name` links the note to the
  records behind it, in both directions in the app. Refs to notes are checked against the
  notes that exist, so a typo fails at write time instead of becoming a dead link.
  In prose, `WORK-`/`BUG-` ids link on their own, and a note links when written as
  `[[note-name]]` — bare kebab words in a sentence stay words.
- **Leave a handoff before you stop.** If your session ends mid-work, `note add --type
  handoff` (or update the existing one) is the difference between the next agent
  continuing and the next agent re-discovering.

Names are kebab-case (2–64 of `a-z0-9-`), derived from the title when you do not pass
`--name`. A title with no ASCII in it (한국어 제목, for example) cannot derive one — pass
`--name` explicitly and the error says so.

---

## Recipes

Every recipe assumes your current directory is inside the repo whose work you are
recording — that is what makes the commands this short. From elsewhere, add
`--dir <folder>`.

### Recipe 1 — record a piece of work, start to finish

Run `work start` **when you begin**, not at the end. It gives you the id, and the
timestamps then describe reality.

```bash
# 1. Start. Prints "Started WORK-0004" — note the id.
agentmon work start \
  --agent my-agent \
  --title "Cache project counts so the sidebar stops re-reading every record" \
  --tags performance,frontend \
  --body "$(cat <<'EOF'
## What

Cache the per-project work/bug counts that the sidebar shows, invalidating the cache
whenever the project emits a change, instead of walking every record on each render.

## Why

The sidebar re-parses every worklog and bug in the project on every navigation. With ~40
records the switch between screens is visibly slow, and it gets worse with every record an
agent writes — the product gets slower the more it is used, which is the wrong direction.

## How

A small in-memory cache in the data layer keyed by project id, cleared on the
`project-changed` event that the desktop app already emits. No new dependency, no change
to the on-disk format.
EOF
)"

# 2. Update as you go. Any number of times; each is timestamped in order.
agentmon work update WORK-0004 \
  --agent my-agent \
  --message "Cache is in and the sidebar no longer re-parses. Measured on the live records: screen switch went from 180ms to 12ms. Invalidation on project-changed works; clearing it when the roster changes is next."

# 3. Finish. The outcome is what a human reads first.
agentmon work done WORK-0004 \
  --agent my-agent \
  --files src/lib/api.ts,src/AppContext.tsx \
  --outcome "$(cat <<'EOF'
Shipped the project-count cache in src/lib/api.ts, cleared from AppContext on
`project-changed` and on a roster change.

Measured on the live records (41 records): switching between Dashboard and Work went from
180ms to 12ms, and opening a work log no longer re-reads the bug directory at all.

Verified: npm run build (tsc clean), cargo test --workspace green, and a manual pass
through all six screens with an agent writing records in another terminal — counts update
without a refresh.
EOF
)"
```

Check your work the way a human will see it:

```bash
agentmon work view WORK-0004
```

#### Recording work you already finished

You did not run `work start` when you began — you are writing all of this up at the end.
That is normal, and it does **not** mean the record has to claim the work took four
seconds. Tell the CLI when things really happened. (`plan.md` and `outcome.md` below are
files you wrote first; `--body "..."` and `--outcome "..."` inline work exactly the same.)

```bash
# 1. Start the record with the real start time. Prints "Started WORK-0004".
agentmon work start \
  --agent my-agent \
  --title "Cache project counts so the sidebar stops re-reading every record" \
  --tags performance,frontend \
  --started-at 2026-08-18T09:12:00Z \
  --body-file plan.md

# 2. Optional: the notes you would have written along the way, each with its own time.
agentmon work update WORK-0004 --agent my-agent \
  --at 2026-08-18T10:05:00Z \
  --message "Cache is in and the sidebar no longer re-parses: screen switch went from 180ms to 12ms. Roster invalidation still missing."

# 3. Close it with the real end time.
agentmon work done WORK-0004 --agent my-agent \
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
agentmon work abandon WORK-0004 \
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
agentmon bug create \
  --agent my-agent \
  --title "Work list drops the tag filter when you navigate back" \
  --severity medium \
  --labels frontend,filters \
  --refs WORK-0004 \
  --body "$(cat <<'EOF'
## Report

Repro:

1. Open the work list.
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
agentmon bug list --status open

# 2. Read the whole thing before touching anything.
agentmon bug view BUG-0002

# 3. Claim it, so no one else starts the same fix.
agentmon bug claim BUG-0002 --agent my-agent

# 4. Comment as you learn things. Root cause first — this is what makes the record useful.
agentmon bug comment BUG-0002 \
  --agent my-agent \
  --message "Root cause: the Tauri shell never started a filesystem watcher, so the project-changed event the frontend listens for was never emitted. Browser mode looked live only because the dev server polls."

# 5. Resolve it — after the fix actually works.
agentmon bug resolve BUG-0002 \
  --agent my-agent \
  --resolution "$(cat <<'EOF'
Root cause: no filesystem watcher existed in the Tauri shell, so `project-changed` was
never emitted and the desktop app only re-read records when a route change re-ran the
loader.

Fix: src-tauri/src/lib.rs starts a notify watcher per registered AgentMonitoring folder,
coalesces bursts over a 250ms window, and emits `project-changed` with the folder and its
project id — the event src/lib/api.ts already listened for. The watchdog re-arms watchers
when a folder comes back.

Verified: cargo test --workspace (94 tests) including a test that drives the real watcher
against a temp folder, and the bug's own repro on the built desktop app — one CLI write
now produces exactly one refresh, about 250ms behind the write.
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

### Recipe 4 — pick up, and leave, the shared knowledge

The first command of a session and the last one. Everything between them is recipes 1–3.

```bash
# Arriving: what do the agents before me want me to know?
agentmon note list
agentmon note view handoff-notes-ui          # read the handoff addressed to you

# ...work happens (recipes 1-3)...

# Learned something durable the hard way? Save the next agent the trip.
agentmon note add \
  --agent my-agent \
  --type memory \
  --title "Gate scripts must sandbox the registry" \
  --description "Any script that runs agentmon init must set AGENTMON_REGISTRY_DIR to a scratch dir." \
  --tags gates,registry \
  --refs WORK-0035 \
  --body "$(cat <<'EOF'
`agentmon init` registers the new project in ~/.AgentMonitoring/registry.json, best
effort. A gate script that inits a temp fixture therefore bookmarks that fixture in the
real user registry unless it points AGENTMON_REGISTRY_DIR at a scratch directory first.

Every repo gate does this now — check before adding a new one.
EOF
)"
# prints: Added note gate-scripts-must-sandbox-the-registry  [memory]  ...

# Stopping mid-work: rewrite the handoff so it describes NOW, not last week.
agentmon note update handoff-notes-ui \
  --agent my-agent \
  --body "$(cat <<'EOF'
## State

The notes list page is done and gated; the detail page renders but has no Related block.

## Do first

Wire RelatedSection into NoteDetailPage — the index already loads notes, so it is one
component call. Then run `npm run check:keys`.
EOF
)"

# A note that turned out to be wrong does not get a correction — it comes down.
agentmon note remove stale-advice --agent my-agent
# the note_removed event stays on the feed: who, when, and what it was called
```

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
| `init` | `--at` | `createdAt` and the `project_created` event |
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
| `note add` | `--at` | `created`, `updated` and the `note_created` event |
| `note update` | `--at` | `updated` and the `note_updated` event |
| `note remove` | `--at` | the `note_removed` event |

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

Global: `--dir <FOLDER>` and `--json` work on **every** command, and go anywhere on the
line — `agentmon --json work list` and `agentmon work list --json` are the same command
(see [JSON output](#json-output)). Every command has a worked example in `--help`.

### `agentmon init`

```
agentmon init [--dir <folder>] --name <n> [--description <d>] [--tags a,b]
              [--agent <name>] [--at <ISO8601>] [--claude-md ko|en] [--json]
```

Creates a project: an `AgentMonitoring` folder inside `--dir` (default: the current
directory), holding `project.json`, `worklogs/`, `bugs/` and the `project_created` event —
and registers it in the machine's project list, so it appears in the app. Refuses (exit
`5`) if that folder already holds a project — it will never reset a live one.

`--claude-md ko|en` also writes agent instructions — record here, read the notes first,
write for the reader, in that language, and how to register the MCP server when the tools
are missing — to `CLAUDE.md` at the repo root, next to the `AgentMonitoring` folder, where
coding agents load it. A CLAUDE.md the repo already has is
never overwritten: the section is appended after a blank line, and if either language's
section is already present the file is left alone.

```bash
cd /your/repo && agentmon init --name "Checkout rewrite" \
  --description "Replace the legacy checkout flow." --tags frontend,payments \
  --claude-md ko
```

### `agentmon project view`

```
agentmon project view [--json]
```

The resolved project: name, description, tags, folder path, and the counts.

```bash
agentmon project view
```

### `agentmon project update`

```
agentmon project update [--name <n>] [--description <d>] [--tags a,b]
                        [--agent <name>] [--at <ISO8601>] [--json]
```

Changes the project's display metadata. Only the flags you pass change; `--tags` replaces
the whole list. The id never moves — it is what every URL in the app points at.

Use it instead of editing `project.json` by hand: this way the change is logged as a
`project_updated` event, which is what the app's activity feed reads.

```bash
agentmon project update \
  --description "Replace the legacy checkout flow with the new payment provider, without a big-bang cutover." \
  --tags frontend,payments,q3 \
  --agent my-agent
```

**There is no `agentmon project delete`, and there will not be one.** Deleting a project
removes its `AgentMonitoring` folder and every record in it from the disk, permanently —
that is the human's decision, taken in the desktop app, behind a dialog that will not act
until they have typed the project's name. Nothing an agent can run removes a record. If a
project should not have been created, say so in a work log and leave the history intact.

### `agentmon project list`

```
agentmon project list [--json]
```

The projects registered on this machine (`~/.AgentMonitoring/registry.json`): name and
folder per row, unavailable ones marked. Informational — an empty list means none are
registered here, not that none exist.

```bash
agentmon project list
```

### `agentmon work start`

```
agentmon work start --agent <name> --title <t>
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
agentmon work start --agent my-agent \
  --title "Wire the change watcher into the desktop app" \
  --tags tauri,live-updates --refs BUG-0002 \
  --started-at 2026-08-18T09:12:00Z \
  --body-file plan.md
```

### `agentmon work update`

```
agentmon work update <WORK-ID> --agent <name>
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
agentmon work update WORK-0004 --agent my-agent \
  --message "Debounce is in. One save produced four raw filesystem events; now it is one refresh."

agentmon work update WORK-0004 --agent my-agent \
  --at 2026-08-18T10:05:00Z --message-file note.md

# a correction to work that finished days ago, written by somebody else
agentmon work update WORK-0004 --agent reviewer \
  --message "Correction: the note above says the debounce window is 500ms; it is 250ms (src-tauri/src/lib.rs)."
```

### `agentmon work done`

```
agentmon work done <WORK-ID> --agent <name>
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
agentmon work done WORK-0004 --agent my-agent \
  --files src-tauri/src/lib.rs \
  --outcome "Shipped the debounced watcher; cargo test --workspace green and one CLI write now produces exactly one UI refresh."

# the same work, written up two hours after it ended
agentmon work done WORK-0004 --agent my-agent \
  --started-at 2026-08-18T09:12:00Z --finished-at 2026-08-18T11:30:00Z \
  --outcome-file outcome.md
```

### `agentmon work abandon`

```
agentmon work abandon <WORK-ID> --agent <name>
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
agentmon work abandon WORK-0004 --agent my-agent \
  --reason "Superseded by WORK-0009, which caches at the API layer instead and covers the same screens; nothing from this branch was kept."
```

### `agentmon work list`

```
agentmon work list [--status s] [--agent a] [--tag t] [--json]
```

`--status` is `in_progress`, `done` or `abandoned`.

```bash
agentmon work list --status in_progress
```

### `agentmon work view`

```
agentmon work view <WORK-ID> [--json]
```

```bash
agentmon work view WORK-0003
```

### `agentmon bug create`

```
agentmon bug create --agent <name> --title <t> --severity <critical|high|medium|low>
                    (--body <text> | --body-file <file|->) [--labels a,b] [--refs ...]
                    [--created-at <ISO8601>] [--json]
```

Plain prose becomes `## Report`. See [Recipe 2](#recipe-2--file-a-bug).

```bash
agentmon bug create --agent my-agent \
  --title "Work list drops the tag filter when you navigate back" \
  --severity medium --labels frontend,filters \
  --body "Repro: filter by tag, open a record, go back. Expected the filter to survive; it is cleared because filter state lives in the component, not the URL."
```

### `agentmon bug claim`

```
agentmon bug claim <BUG-ID> --agent <name> [--at <ISO8601>] [--json]
```

Sets `assignee` and moves the bug to `in_progress`. `--at` records when you took it (at or
after the bug's `created`).

```bash
agentmon bug claim BUG-0002 --agent my-agent
```

### `agentmon bug comment`

```
agentmon bug comment <BUG-ID> --agent <name>
                     (--message <text> | --body-file <file|-> | --message-file <file|->)
                     [--at <ISO8601>] [--json]
```

Appends `### <timestamp> — <agent>` to the thread. Allowed in any state.
`--message-file` and `--body-file` are the same flag; `--at` must be at or after the bug's
`created` and at or after the previous comment.

```bash
agentmon bug comment BUG-0002 --agent my-agent \
  --message "Reproduced on Windows 11. The watcher never starts, so nothing is ever emitted."
```

### `agentmon bug resolve`

```
agentmon bug resolve <BUG-ID> --agent <name>
                     (--resolution <text> | --resolution-file <file|->)
                     [--at <ISO8601>] [--json]
```

Writes `## Resolution`, sets `status: resolved`, stamps `resolved` and `resolved_by`.
`--at` records when it was actually fixed; it must be at or after everything already on the
bug (created, claimed, the last comment).

```bash
agentmon bug resolve BUG-0002 --agent my-agent \
  --resolution-file resolution.md
```

**Label the parts in bold, not with `##`.** Your text goes *inside* `## Resolution`, so a
`##` heading in it would end that section instead of nesting under it — the CLI refuses one
and tells you this. Write `**Root cause.**`, `**Fix.**`, `**Verified.**` at the start of a
paragraph: the app turns each into an anchored sub-section with its own contents row, which
is why every resolution in this project reads the same way. `###` nests too, if you prefer
it. The same rule applies to `work done --outcome` and to `work update` / `bug comment`
messages, which live inside `## Outcome` and `## Updates`.

### `agentmon bug list`

```
agentmon bug list [--status s] [--severity s] [--label l] [--assignee a] [--json]
```

`--status` is `open`, `in_progress`, `resolved` or `closed`.

```bash
agentmon bug list --status open --severity high
```

### `agentmon bug view`

```
agentmon bug view <BUG-ID> [--json]
```

```bash
agentmon bug view BUG-0002
```

### `agentmon note add`

```
agentmon note add --agent <name> --title <t> --type <essential|memory|handoff|decision|reference>
                  --description <one line>
                  (--body <markdown> | --body-file <file|->)
                  [--name <kebab>] [--tags a,b] [--refs ...] [--at <ISO8601>] [--json]
```

Creates `notes/<name>.md` and prints the name (alias: `note create`). The name is derived
from the title unless `--name` says otherwise; a name that already exists is refused with
exit `5` — one fact, one file, update the existing note instead. `--description` is
required and single-line (≤200 chars): it is the line every list shows. The body is
free-form markdown with no mandated sections; `##` headings are welcome. `--refs` takes
WORK-/BUG- ids and other notes' names (note names must exist).

```bash
agentmon note add --agent my-agent --type decision \
  --title "Notes use their name as identity, not a NOTE-NNNN sequence" \
  --description "A note is looked up by what it is about; numbered ids were rejected." \
  --body "We considered NOTE-NNNN ids for symmetry with work logs and bugs, and rejected them: a note is addressed by topic, and a stable kebab name doubles as the file name, the URL and the refs value."
```

### `agentmon note update`

```
agentmon note update <name> --agent <name>
                     [--title <t>] [--type <ty>] [--description <d>]
                     [--tags a,b] [--refs ...]
                     [--body <markdown> | --body-file <file|->]
                     [--at <ISO8601>] [--json]
```

Rewrites parts of a note in place. Only the flags you pass change; **`--body` replaces the
whole body** (a note is the current state, not a diary — history belongs in work logs),
and `--tags` / `--refs` replace their lists. Stamps `updated`, records you as
`updated_by` — the current words are yours now, and the app shows your name beside them —
and logs `note_updated` naming what changed; `agent` stays whoever wrote the note first.

Rewriting is not retyping: leave `--type` off and the note keeps the type it has. Passing
`--type` that takes `essential` away is honored but answered with a warning and the
restore command — an essential note is required session-start reading, and it must not
fall out of the front of the list unnoticed.

```bash
agentmon note update handoff-notes-ui --agent my-agent --body-file handoff.md
agentmon note update registry-gate-gotcha --agent my-agent \
  --description "Every gate must set AGENTMON_REGISTRY_DIR; check-live now does too."
```

### `agentmon note remove`

```
agentmon note remove <name> --agent <name> [--at <ISO8601>] [--json]
```

Takes the note off disk (alias: `note rm`) and logs `note_removed` — the feed keeps who
removed it, when, and what it was called. Remove a note when keeping it would mislead:
it is wrong, superseded, or a handoff that has been fully absorbed. **Notes only.** Work
logs and bugs are history and have no removal command, anywhere.

```bash
agentmon note remove stale-advice --agent my-agent
```

### `agentmon note list`

```
agentmon note list [--type t] [--tag t] [--agent a] [--search <text>] [--json]
```

Every note, most recently updated first: name, type, author, updated, and the author's
one-line description. This is the index — run it at the start of a session. `--search`
matches name, title, description, tags and body, case-insensitively.

```bash
agentmon note list --type handoff
agentmon note list --search registry
```

### `agentmon note view`

```
agentmon note view <name> [--json]
```

The whole note: frontmatter facts, description, body.

```bash
agentmon note view registry-gate-gotcha
```

### `agentmon app-feedback`

```
agentmon app-feedback add    --agent <name> --type bug|idea --title <t> [--body <prose>] [--at T]
agentmon app-feedback list   [--status open|done] [--type bug|idea] [--json]
agentmon app-feedback view   <FB-ID> [--json]
agentmon app-feedback done   <FB-ID>
agentmon app-feedback reopen <FB-ID>
agentmon app-feedback delete <FB-ID>       # done items only — an open item refuses
```

A bug in, or a wish for, **AgentMonitoring itself** — the CLI, the MCP tools, the app's
screens — as opposed to the project you are working in. Machine-level: items live in
`~/.AgentMonitoring/feedback/FB-NNNN.md` beside the registry, so the commands work from
any directory, need no project, and ignore `--dir`. `--body` is optional — a specific
title can carry a whole wish.

Filing is the everyday verb; `done` and `delete` are for **working the board**, which
the human does in the app (**App feedback** in the sidebar) or delegates: "go through
the feedback list, fix what it names, then clear it" is a legitimate task, and the
shape of it is `done <id>` after the fix really shipped, then `delete <id>`. Deleting
an open item is refused so a complaint can never vanish unread — and `done` is a claim
of fact here like everywhere else: mark nothing done that you did not actually handle.

```bash
agentmon app-feedback add --agent my-agent --type bug \
  --title "status counts an abandoned log as in progress" \
  --body "Repro: abandon a log, run status — the in-progress count still includes it."
agentmon app-feedback add --agent my-agent --type idea \
  --title "note list should filter by tag"
```

### `agentmon status`

```
agentmon status [--json]
```

The project snapshot: counts, active work, open bugs by severity, the latest notes,
per-agent activity and the last ten events. Run it before you start, to see what other
agents are doing.

```bash
agentmon status
```

### `agentmon doctor`

```
agentmon doctor [--strict] [--json]
```

Walks the whole project folder and reports **everything** wrong with it — not just the
first problem. Two levels:

- **error** — the app will render something wrong or untrue: unparseable frontmatter, a
  `done` work log with no `## Outcome`, a resolved bug with no `## Resolution`, an id (or a
  note's name) that does not match its filename, a duplicate id, a note whose `updated`
  predates its `created`, a broken line in `events.jsonl`.
- **warning** — readable, but off: an event referencing a record that no longer exists, a
  write lock left behind by a killed process, an event type this build has not heard of.

Exit `1` if there is any error; `--strict` makes warnings fail too. Run it after a batch of
writes, and before you hand work to a human.

```bash
agentmon doctor
agentmon doctor --strict --json
```

### `agentmon migrate`

```
agentmon migrate --from <vault> --project <slug> --to <folder> [--json]
```

The one bridge from the v1 layout (a central vault holding `projects/<slug>/…`) to v2.
Copies the named project's records, events and timestamps byte-for-byte into
`<folder>/AgentMonitoring`, rewrites `project.json` to v2 (version added, slug and status
dropped, the id kept so links keep working), and registers the new folder. Refuses (exit
`5`) if the target already holds a project. The vault itself is not modified — delete it
yourself once `agentmon doctor --dir <folder>` passes.

```bash
agentmon migrate --from /c/old/vault --project checkout-rewrite --to /c/Code/checkout
```

---

## JSON output

`--json` makes **all** output machine-readable, including failures, so a script never has
to parse prose. It is a global flag: put it after the subcommand
(`agentmon work list --json`) or before it (`agentmon --json work list`) — both are the
same command.

Success on a mutation:

```json
{
  "ok": true,
  "id": "WORK-0004",
  "path": "C:\\Code\\MyApp\\AgentMonitoring\\worklogs\\WORK-0004.md",
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

`kind` is stable and safe to branch on: `project_not_found`, `record_not_found`,
`invalid_project`, `invalid_argument`, `invalid_body`, `conflict`, `locked`, `io_error`,
`project_problems`.

Capturing the new id in a script:

```bash
id=$(agentmon work start --agent my-agent \
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
| `1` | The project has problems (`doctor` found errors) | Read the listed problems; each one names its fix |
| `2` | Usage error: unknown flag, missing argument, bad value — including a timestamp that will not parse, is in the future, or is out of order | Re-read the message; it names the flag and the allowed values |
| `3` | Not found: project folder or record | `agentmon project list` / `work list` to see what exists |
| `4` | Body rejected: missing sections, or placeholder text | The message prints the template — rewrite and re-run |
| `5` | Conflict: already done, already claimed, already exists | The message says the alternative command to run |
| `6` | Invalid project: corrupt frontmatter or `project.json` (including v1 data — run `migrate`) | Run `agentmon doctor` for the full list |
| `7` | I/O error: permissions, missing file, disk | Check the path in the message |

A failed command writes **nothing**: no partial record, no orphan event. Re-running after a
fix is always safe.

---

## Writing records worth reading

The records exist so a human — or an agent picking up where you stopped — can reconstruct
work they did not do. The bar is a well-written pull request description. Practically:

**Be specific instead of general.** "Fixed the watcher" tells a reader nothing. "The
watcher fired three times per write because Windows reports a directory-level Modify up to
250ms after the file events; filtering to `*.md`/`*.jsonl`/`*.json` drops those" tells them
everything, including how to recognise the same bug elsewhere.

**Name the artifacts.** Files, commands, screens, functions. `--files a,b` on `work done`
exists for exactly this.

**Say how you verified it.** A record that ends with "should work" is a record a human has
to re-verify. Put the command you ran and what it printed: `cargo test --workspace — 94
passed`, `npm run build — tsc clean`, `agentmon doctor — no problems`.

**Record what you rejected.** The most valuable line in a `## Why` is usually the option
you did not take and the reason.

**Write updates while you work, not afterwards.** `work update` is cheap and the timeline
it builds is the story of the work. Reconstructing it at the end produces a record that
reads like a summary, because it is one.

**Do not fabricate.** Never write a verification you did not run or a number you did not
measure. Everything here is read by humans checking whether the work happened.

`agentmon work view WORK-0002` shows a record written to this bar, if you want a model to
copy.

---

## Troubleshooting

**`no project found at ...`** — nothing above your current directory holds an
`AgentMonitoring/project.json`. Pass `--dir /path/to/repo`, or `cd` into the repo. Create
one with `agentmon init --name "..."` only if you genuinely need a new project. If a
command worked a moment ago and now does not, your harness probably gave that command a
different working directory — pass `--dir` on every command instead
([Finding the project](#finding-the-project)).

**`schema version is 1 but this build of agentmon speaks v2`** — the folder holds v1
vault data. Bring it forward: `agentmon migrate --from <vault> --project <slug> --to
<folder>` ([`agentmon migrate`](#agentmon-migrate)).

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
honestly: `agentmon work abandon <ID> --agent <you> --reason "..."`. Do not leave it; the
dashboard reads `in_progress` as "an agent is on this right now".

**`BUG-0002 is already claimed by <someone>`** — do not take it over. Add what you know with
`agentmon bug comment`, or pick another bug from `agentmon bug list --status open`.

**`a note named '...' already exists in this project`** — one fact, one file. Read it
(`agentmon note view <name>`), then `agentmon note update <name>` with what changed — or
pick a different `--name` if it genuinely is a different fact.

**`cannot derive a note name from the title ...`** — the title has no ASCII to slug (a
Korean title, an emoji title). Pass `--name my-kebab-name` explicitly; names are `a-z0-9-`
so they work as file names, URLs and refs.

**`no note is named '...' here`** — a `--refs` value that is not a WORK-/BUG- id is
checked against the notes that exist, so a typo fails at write time. `agentmon note list`
prints the real names.

**`another agentmon process is writing to ...`** — another agent is mid-write; wait a second
and re-run. If the message says the lock has been held for minutes, the process holding it
died: delete the `.agentmon.lock` file it names (agentmon reclaims it automatically after
120 seconds anyway).

**`doctor` reports "status is done but there is no ## Outcome"** — usually a record that was
hand-edited. Edit the file to add the section; the CLI's own `work done` cannot produce
that state.

**The desktop app is not showing what I just wrote** — the app watches every registered
folder and refreshes about a quarter of a second after a write. If it does not, confirm
you wrote to a folder the app has on its list: `agentmon project view` prints the folder
the CLI used, and the Projects screen shows every registered path.

**The desktop app does not show the project at all** — the folder is not registered on
this machine. `agentmon init` registers what it creates; for an existing folder (a clone
from another machine), use **Open project…** in the app once.

**Non-ASCII characters look wrong in the terminal** — an output encoding issue in your
terminal, not in the file. Check the record with `agentmon work view <ID> --json` or open
the `.md` file directly.

---

## Multiple agents at once

Several agents writing to one project is expected, and the CLI is built for it:

- Id allocation happens under a per-project lock file, so two simultaneous `work start`
  calls get two different ids — never the same one.
- Record files are written to a temp file and renamed into place, so a reader (including
  the desktop app) sees either the old record or the new one, never half of one.
- `events.jsonl` lines are appended in a single write each, so the log is never interleaved
  mid-line.
- Nothing is ever overwritten blind: every update re-reads the record inside the lock and
  refuses transitions that are not legal.

What is *not* handled for you: two agents doing the same work. That is what
`agentmon status` and `agentmon bug claim` are for — look before you start, claim before
you fix.
