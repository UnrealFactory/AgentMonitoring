# agentmon over MCP

`mcp/server.mjs` is a [Model Context Protocol](https://modelcontextprotocol.io) server that
puts the agentmon CLI inside an agent's tool list. An agent with it enabled records a piece
of work by calling `log_work` with a title and three fields — no shell, no heredoc, no
markdown headings to get wrong, and no manual to read first.

It is a wrapper, not a second implementation. Every call shells out to
`target/release/agentmon` with `--json`, so the body contract, the timestamp rules, the
state transitions, the id allocation and the file locking are the ones the CLI already
enforces and the desktop app already trusts. If a tool call is refused, it was refused by
the same code a terminal would have used.

## Context cost

A tool list is not free: its schemas and descriptions are re-sent to the model on every
turn of every conversation the server is enabled in, and every result stays in the
transcript for the rest of the session. So this server is built to a budget rather than to
a feature list. The CLI's commands are consolidated into **seven tools shaped like the
workflow** (do work, update work, file a bug, fix a bug, share a note, look around — and
tell the app's maintainer where the app itself fell short) instead of mirrored
one-for-one; each description is one verb-first sentence and no property description
repeats what its name already says; the whole `tools/list` response, schemas included,
is **7,168 bytes**.

The human area every record carries is **265** of those bytes, and not one of them teaches
the duty: six `human` fields with no description at all (156), `human` in the `required`
list of the three tools that always need one (23), the fourteen that add `human_style` to
`status`'s modes, and `id` on `app_feedback` (72) — whose `required` list got *shorter*,
not longer. The only prose
among them is that `id`'s "Rewrites that item's human area.", and it buys a route rather
than a lesson: a caller that files a second item instead of rewriting the old one succeeds,
so no refusal and no result can ever say what it missed.

Everything an agent has to be *told* about that half is told by a **result** instead, for
one reason — a schema is re-sent on every turn and a result is sent once. So the style
rules arrive with the session's first result, whatever call produced it (below), before the
first retelling is drafted, and the fact that a retelling *replaces* rather than appends is
said by the reply to the call that replaced one.

Results are the other half: a write
returns the id, the file path and one line of confirmation — the CLI's `--json` envelope
boiled down, about 200 characters, rather than the record it just wrote, which the caller
already has. Reads return compact summaries capped at 600 characters, and `full: true`
(on `status(mode="view")` and `note(action="read")`) is the single, explicit way to pay
for a whole record — whole meaning whole: a full read is never truncated, because the
human area is a record's last section and any ceiling would cut exactly the part the
read was spent to reach (FB-0003). `npm test` measures all of it and fails if any budget
is exceeded, so the numbers in this paragraph cannot quietly rot.

## Install

**The usual path is: don't install anything.** Creating a project — in the app's New
project dialog, or `agentmon init --mcp-json` — writes a `.mcp.json` into the repo that
registers this server with the right absolute paths for this machine; `agentmon project
mcp-json` does the same for a project that already exists. Claude Code reads that file on
its own, so the tools are simply there. The rest of this section is for registering by
hand (another client, another scope).

**Installed the desktop app?** Everything is already on disk: the server, its
dependencies and the `agentmon` CLI ship inside the install folder, so the server is at

```
%LOCALAPPDATA%\AgentMonitoring\mcp\server.mjs
```

and finds the CLI beside it on its own. Skip straight to the `mcp add` line below with
that path.

**Working from a source checkout?** Build the CLI first — the server shells to it:

```bash
cargo build --release -p agentmon-cli
cd mcp && npm install
```

Then add the server, filling in your project folder and agent handle:

```bash
claude mcp add agentmon -- node C:/Code/AgentMonitoring/mcp/server.mjs --dir C:/Code/MyApp --agent my-agent
```

That is the whole configuration. **Identity lives in the `mcp add` line, not in every
call**: the project folder the records go to and the agent handle written onto them are
given once at startup, which is why no tool call has to spend tokens repeating them. Any
call may still override either (a sibling project's folder, or a subagent with its own
handle) by passing `dir` or `agent`.

For this repository's own history:

```bash
claude mcp add agentmon -- node C:/Code/AgentMonitoring/mcp/server.mjs --dir C:/Code/AgentMonitoring --agent my-agent
```

Other clients take the same argv. The equivalent `mcpServers` entry, for a client that
wants JSON:

```json
{
  "mcpServers": {
    "agentmon": {
      "command": "node",
      "args": [
        "C:/Code/AgentMonitoring/mcp/server.mjs",
        "--dir", "C:/Code/MyApp",
        "--agent", "my-agent"
      ]
    }
  }
}
```

### Startup flags

| Flag | |
|---|---|
| `--dir <folder>` | **Required.** The project folder to read and write — the AgentMonitoring directory, or the folder that contains one. |
| `--agent <handle>` | Default agent handle written onto records; a call may override it. |
| `--bin <path>` | The agentmon binary. Else `$AGENTMON_BIN`, else the app install folder (two levels above the server), else `target/release`, else `PATH`. |

`--dir` has no default **on purpose**. The CLI walks upward from the current directory
when nothing is passed, which is right for a human in a repository and wrong for an MCP
server: its working directory is whatever the client happened to launch it in, so a
fallback would decide the destination of a real write by accident. With no `--dir` the
server refuses to start (exit 2) and says so. Any `AGENTMON_DIR`, `AGENTMON_VAULT`,
`AGENTMON_PROJECT` or `AGENTMON_AGENT` in the environment is stripped from the CLI child
for the same reason: the startup flags are the only identity.

## The tools

`*` marks a required argument. `dir` and `agent` are optional on every tool and
override the startup defaults. Times are UTC ISO8601 (`2026-08-18T09:12:00Z`) and record
when a thing really happened — pass them when writing up work after the fact.

Two CLI verbs have **no MCP counterpart on purpose**: `agentmon reconcile` (the
two-machine id-collision repair) and the `--replayed` flag on `work update` / `bug
comment`. Both are git-time recovery operations — they run once, next to a failed pull,
rewriting or reconstructing history rather than recording new work — and a tool that
rewrites history does not belong in the set an agent reaches for on every task. When a
pull collides on `worklogs/WORK-NNNN.md`, use the terminal:
[AGENT_MANUAL.md, "Two machines, one repo"](AGENT_MANUAL.md#recipe-5--two-machines-one-repo).

### `human`, on every write tool

The record's [human area](AGENT_MANUAL.md#the-human-area): the same events retold for a
reader who was not there and does not program — the owner of the project, the person who
files the wish, whoever opens the record six months from now.

**The rules arrive with your session's first tool result — whatever call it was.** They are
long, they are write-time reading, and none of them is in the tool list. In a terminal an
agent meets them the first time it forgets `--human`: the refusal prints the compact style
rules whole and is the one message this server never trims. Through MCP the schema bolts
that door shut: `human` is `required` on every tool that files a record, so one is always
supplied, the write succeeds at exit `0`, and the refusal that teaches never fires. Prose in
the tool list was tried and measured instead: the same task through the same schema, once
with a clause on `human` naming who the retelling is for and once with it emptied, produced
a retelling on the same single attempt that missed the same contract rules either way. So
the rules are **handed over** rather than described.

They are handed over **before the first draft**, which was the second lesson and cost two
graded sessions to learn: riding the first successful write put them in the transcript one
call *after* the retelling they were meant to govern, and both of those sessions, drafting
from the schema alone, missed the contract's headline rules — no analogy, no beat saying how
the agent knew, label-shaped bold lead-ins, the record's own subject never named.

Riding the session's first `note(action: "list")` was the third lesson, and it cost two more:
that is the call every session is *told* to start with, and "told to" is not "did". A session
that opened on `status`, or on a note read, or on a call that failed, got nothing and drafted
blind exactly as before. So the handover sits in the dispatcher instead of in one handler,
and the **first result of any kind** carries it: list, snapshot, view, refusal. It comes back
under the index or the confirmation — what the second half is and who it is for, the rules
themselves, and the way to the rest of the contract. About 4,900 characters, once, and no
call order can miss it. A client with two calls in flight still pays for it once.

One shape is left that no result can get ahead of, because the result comes after the call:
a session whose very first call *is* a write. That one is caught a draft late, and told so —
the same block plus the exact call that rewrites the record just written,
`update_work(id="WORK-0004", human=…)` and its equivalents on the other tools. Nothing
always-on tries to get ahead of it, and that is a measurement rather than an oversight: a
line about the human area was put in the project's CLAUDE.md, then measured against its own
absence, and the repo without it saved a conforming record on the same attempt as the repo
with it — the refusal did the teaching either way. Bytes on that surface are re-sent on
every turn of every conversation, so a line that changes no record is not worth one. This
last shape stays one draft late.

A session refused once, or one that read the whole contract on purpose, is not charged for
the same text again by any channel. A session that only reads pays it once, which is the
price of arriving before a draft that may never come.

`status(mode: "human_style")` is the rest: the contract whole, worked example included,
the same document `agentmon human-style` prints, for a caller with no terminal to print it
in. It stays write-time reading — call it when a record needs a human area and the compact
rules are not enough. Calling it *is* the session's handover: the compact block is cut out
of that document, and nothing appends a summary to the thing it summarises.

Every channel gets that block from one place — `agentmon human-style`, spawned once a
session and cached — so the server, the CLI's refusal and `human_style` can never teach
three different contracts. But the CLI carries the document *baked in* at compile time
(`crates/agentmon-core/build.rs` cuts it out of `docs/HUMAN_STYLE.md`), so **editing the
contract only reaches agents after `cargo build --release -p agentmon-cli`**. Until that
rebuild, all three channels hand over the old text together, and the two obvious tests see
nothing: both compare the binary's output to the binary's own copy. That is not
hypothetical — a binary one rule out of date taught four graded sessions a contract they
were then marked against. So `npm test` reads `docs/HUMAN_STYLE.md` off disk and fails
unless the block crossing the wire carries it byte for byte.

Required to create or close a record: `log_work`, `report_bug`, `app_feedback`, and any
call carrying an `outcome`, `abandon`, `resolution` or a note `body`. Required, too, on any
call touching a record that has no human area yet — a record written before this existed
gains one on the first touch. Optional everywhere else, and **alone** it is a refresh: it
rewrites the retelling and moves nothing else.

It always **replaces**. A record has one human area, so the string you send becomes all of
it — alone, or in the same call as a `note`, a `comment` or an `outcome`. Two sentences of
`human` on a progress call do not extend the retelling that is already there: they
overwrite it, the call succeeds, and what they replaced is in no note and no event. On a
call that is not closing the record, send the retelling as the whole record should now
read, or send none at all. The reply says which happened — `note added, retelling
replaced` against a bare `note added` — because the difference is only visible on the call
that makes it, and a warning in the schema would have been paid for on every turn by every
caller who never made it.

Write it in the same call, out of the same fresh context that wrote `what`/`why`/`how`.
Only a *missing* retelling is refused; a thin one is accepted, and then it is what the
reader gets.

### One session, end to end

Open with the read every session opens with. Its result carries the notes that are this
project's memory *and* the style rules for the half below, which is why the write comes
second:

```
note(action: "list")
```

Then one call records the whole piece of work. `what`/`why`/`how` are the record's agent
half — for whoever picks the work up next; `outcome` closes it; `human` is the same events
for someone who was not there and does not program:

```json
log_work({
  "title": "Cache project counts so the sidebar stops re-reading every record",
  "what": "Cache the per-project work/bug counts the sidebar shows, invalidated on the project-changed event, instead of walking every record on each render.",
  "why": "The sidebar re-parsed every worklog and bug on every navigation, so the product got slower the more it was used.",
  "how": "A small in-memory cache in the data layer keyed by project id, cleared on project-changed. No new dependency, no on-disk change.",
  "outcome": "Shipped in src/lib/api.ts, cleared from AppContext. Measured on the live 41 records: Dashboard→Work went from 180ms to 12ms. npm run build clean, cargo test --workspace green, and a manual pass through all six screens while another agent wrote records.",
  "human": "Moving between two screens took about a fifth of a second, and it got slower with every record anyone wrote.\n\n**The app counted the same files again on every click.** The strip down the side of every screen shows how many work logs and bugs the project holds, and to get those two numbers it opened and read all 41 files, afresh, every time you moved anywhere.\n\n**Now it counts once and keeps the answer.** It throws the answer away the moment a record is written, and counts again the next time somebody asks — like writing the shopping total on the fridge door instead of adding the receipt up again every time you walk past, as long as you rub it out when the shopping changes.\n\n**Forgetting is the part that bites.** My first version kept the old number when the agents working on a project changed, which is the second thing that moves those counts.\n\n**Measured on this project's own 41 records.** The switch between two screens went from 180 thousandths of a second to 12. `cargo test --workspace`, the command that runs every automatic test we have, passes; I also clicked through all six screens by hand while another agent wrote records into the folder, and the counts kept up.\n\nNothing about the app looks different — it just stops making you wait. The agents-changed case is the one I have only checked by hand.",
  "files": ["src/lib/api.ts", "src/AppContext.tsx"],
  "tags": ["performance", "frontend"]
})
```

That `human` is what the rules ask for, and it is worth reading before you write your own:
the same events as the `outcome`, in the order they happened — what was wrong, what the app
was doing, what it does now, what fooled the agent, how it knows, what is still only checked
by hand. Each paragraph after the first opens with a short bold sentence that *states*
something (**"Forgetting is the part that bites."**), never a label (**"Verification."**).
One name survives, `cargo test --workspace`, and it arrives with its job in the same breath.
It runs to about 250 words, which is an ordinary record. `status(mode: "human_style")` has
the rest, including what a bug and a note look like.

Long work opens without an `outcome` and closes later with `update_work`; work that stops
closes with `abandon`. Before you stop, leave what the next session needs:
`note(action: "write", type: "handoff", …)`.

### `log_work`

Records a piece of work, start and finish, in one call.

`title*`, `what*`, `why*`, `how*`, `human*`, `outcome`, `files`, `tags`, `refs`,
`started_at`, `finished_at`

The three body sections are three fields, so the body contract cannot be got wrong — the
server assembles the markdown. With an `outcome` the log is opened and closed in one call
and comes back `done`; without one it stays `in_progress` and the reply carries the
`WORK-NNNN` id to close later. `files` is recorded when the log closes, which is the CLI's
rule. Backdating a whole record is `started_at` + `finished_at` in the same call.

One `human` covers both halves of the call: closing replaces the record's human area, and
the same retelling is the honest thing to put back.

### `update_work`

Progress, close, or stop — on an existing `WORK-NNNN`.

`id*`, `note`, `outcome`, `abandon`, `human`, `files`, `at`

`human` is required with `outcome` or `abandon` (closing replaces the human area) and on a
record that has none yet; **alone** it is a refresh — it rewrites the human area, appends
nothing, and the feed logs one `human_updated` line. Sent with a `note` it still replaces,
which is the one combination that can quietly cost a good retelling: the note is appended,
the human area is not.

Otherwise one of the three is the point of the call: `note` appends a timestamped note,
`outcome` closes the log, `abandon` marks it abandoned with a reason. A note on an
already-closed log is allowed and is how a shipped record gets corrected — open the note
with `Correction:` and the app marks it.

### `report_bug`

Files a bug.

`title*`, `severity*` (`critical|high|medium|low`), `report*`, `human*`, `labels`, `refs`,
`created_at`

`report` is prose — repro, expected, actual. It becomes the `## Report` section; `human`
tells it as what a person sees, and what it costs them. Use `refs`
rather than only prose to link the work log it came out of: the link then works in both
directions.

### `resolve_bug`

Claim, comment and resolve, in any combination.

`id*`, `comment`, `resolution`, `human`, `claim`, `at`

Passing a `resolution` claims the bug first unless you pass `claim: false`, so the usual
fix is one call: root-cause `comment` plus `resolution`. Claim-only (`claim: true`) and
comment-only (`claim: false`, `comment`) are both valid single calls. If another agent
holds the bug the claim fails and the reply names the way past it.

`human` is required with a `resolution` and on a bug that has no human area yet; alone it
is a refresh, exactly as in `update_work` — and sent with a `comment` it replaces the
bug's retelling, exactly as in `update_work` too.

### `note`

The shared agent knowledge — essential, memory, handoff, decision and reference notes —
in one tool. The essential notes are required session-start reading and sort first.

`action` (`list` default, `read`, `write`, `remove`), `name`, `title`, `type`
(`essential|memory|handoff|decision|reference`), `description`, `body`, `human`, `tags`,
`refs`, `query`, `full`, `at`

- `list` — the index: every note's name, type, author and one-line description —
  essential notes first, then newest. `type` and `query` filter. Run it at the start of
  a session and read the essentials before working. Open the session here and this is also
  where the [`human`](#human-on-every-write-tool) style rules land — though they ride
  whichever call comes first, so opening elsewhere costs you nothing.
- `read` — one note by `name`; `full: true` for the whole body.
- `write` — **upsert**: against a `name` that exists it rewrites in place (only the fields
  passed — a `type` left off is preserved; `body` replaces wholesale; `tags` and `refs`
  replace their lists, so an explicit empty array **clears** one — pruning a ref whose
  note is gone — while leaving the field off keeps it), which is the
  one-fact-one-file discipline; against a new name (or none — it derives one from the
  title) it creates, requiring `title`, `type`, `description`, `body` and `human`. A
  `body` on an existing note needs a `human` with it — the old retelling described
  knowledge that is gone — and `human` alone is a refresh. Passing a `type`
  that takes `essential` off an existing note is honored but answered with a warning and
  the restore call — required reading must not fall out of the index unnoticed. A named
  write whose note cannot be *read* (lock, malformed file) fails with that error rather
  than posing as a first write.
- `remove` — retires a note that would mislead if kept. The `note_removed` event stays on
  the feed; work logs and bugs have no such verb, here or anywhere.

### `status`

The one read tool: work, bugs, and the style contract.

`mode` (`project` default, `work`, `bugs`, `view`, `human_style`), `id`, `state`,
`severity`, `agent`, `limit`, `full`

- `project` — counts, what is in progress, open bugs by severity, last activity.
- `work` / `bugs` — one line per record, in the CLI's own order (work by last activity,
  bugs open-and-severe first); `state`, `severity` and `agent` filter, and `limit` sets how
  many rows (default 8, max 50).
- `view` — one record by `id`: metadata, then its outcome or, while it is open, its what.
  `full: true` returns the whole record instead — untruncated however long, since the
  human area sits at the tail — and is the only *record* read that may exceed 600
  characters.
- `human_style` — the [`human`](#human-on-every-write-tool) style contract, whole: about
  20,000 characters, the same document `agentmon human-style` prints. It is not a record
  and is not summarised. The compact rules inside it reach every caller free — in the
  handover on the session's first result, and in every refusal — so what only this mode has
  is the worked example at the end, which is why it is not clamped. The mode is in the enum
  and in no description: the messages that name it are ones the agent has already read.

### `app_feedback`

A bug or a wish **about the AgentMonitoring app itself** — its tools, CLI or boards —
not about the project being worked on.

`human*`, `type` (`bug|idea`), `title`, `body`, `at`, `agent`, `id`

The one tool with no `dir`: app feedback is machine-level, stored beside the registry
(`~/.AgentMonitoring/feedback/FB-NNNN.md`), because it belongs to no project. `body` is
optional — a specific title can carry a whole wish, and friction here would cost real
feedback. `human` is not optional: this board is read by the person who maintains the app.

Without `id` this files a new item and `type` and `title` are required — by the handler,
not by the schema, whose `required` list holds `human` alone because the other two mean
nothing on the rewrite route. Get it wrong and the refusal names both shapes of the call.
**With `id` (`FB-0009`) it is `agentmon app-feedback update`**: it rewrites that item's
human area and nothing else, which is how an item filed before the human area existed
gains one. Working
the board — `done`, `reopen`, and `delete` (done items only) — happens in the app or
through the CLI when the human delegates the cleanup; those verbs would spend every
conversation's tokens on what is an occasional chore, so they are not tools.

## Errors

A failed call comes back as tool-call content with `isError` set, carrying the CLI's own
message — which names the fix — trimmed to fit. The shell-shaped tail of that message (the
"Example that works" block, the markdown template) is cut: an MCP caller has no shell, and
the body it would teach is one this server assembles from `what`/`why`/`how`.

Every message names the CLI's exit code, so the meaning is recoverable:

| Exit | Meaning | Typical cause through MCP |
|---|---|---|
| `0` | Success | — |
| `1` | Project has problems | `doctor`-level errors in the records |
| `2` | Usage or timestamp rejected | A time in the future, one before the state it follows, or a missing `human` |
| `3` | Not found | An unknown project folder, or an id that does not exist |
| `4` | Body rejected | A `what`/`why`/`how`/`outcome` that is a placeholder or too short |
| `5` | Conflict | Closing a closed log, claiming a bug another agent holds |
| `6` | Invalid project | Corrupt frontmatter or `project.json` |
| `7` | I/O error | Permissions, or the path is gone |

A refusal for a missing human area is the exception to the trimming above: it carries the
compact style rules the CLI prints, because that error is how the contract reaches an
agent at write time. The CLI signs that message off with `agentmon human-style`, which is a
shell command; this server adds the one line that makes it actionable here —
`status(mode: "human_style")` prints the same contract, whole. Getting that refusal also
counts as the session's handover: the same rules are not appended to any later result.

Three failures come from the server rather than the CLI, and say so plainly: no agent
available for the call, `update_work` with nothing to say, and a field carrying the
call's own envelope — a literal `<parameter …>` tag, or a `comment` whose text contains
`</comment>` — which means a client mangled the boundary between two parameters and both
texts landed in one field (FB-0002 reached disk exactly that way once, a resolution
duplicated into a comment). That call is refused whole before anything runs; re-send it
with each field carrying only its own prose. A failed call writes
nothing — no partial record, no orphan event — so retrying after a fix is always safe. If
a multi-step call fails halfway (say, claimed and commented, then the resolve was refused),
the message names the steps that already happened so they are not repeated.

## Tests

```bash
cd mcp && npm test
```

Spawns the server over stdio and drives it with raw JSON-RPC frames against a throwaway
project in the temp directory: handshake, `tools/list`, then a full work lifecycle (open,
note, close, correct, and a backdated one-call record), a full bug lifecycle (file,
comment without claiming, then claim + comment + resolve), a full note lifecycle (write,
list, read, rewrite-in-place, remove — with the event trail asserted), app feedback
(filed into the sandboxed machine-level folder, never into the project), every read mode,
the error paths, and `agentmon doctor --strict` over the result. The budgets are asserted on the
bytes that actually cross stdio, not on a re-serialized object. Two guards matter: the test
launches a server from the repository root with no `--dir` and asserts it refuses rather
than walking up to `./AgentMonitoring`, and it fingerprints the repository's live records before and after to
prove nothing was written there.

The human area gets its own eleven. That no `human` field spends a byte of prose on it, and
that a sweep of every tool description and every property description on the surface finds
exactly one clause mentioning it — `app_feedback`'s `id`, five words, a route rather than a
rule — so prose cannot grow back on some other field while `human` stays bare. That a
session starting the way it is told to — a third server process whose first call is
`note(action: "list")` — is handed the CLI's compact block *byte for byte* before it drafts
anything, and pays for it on no later call; that a session which writes first is handed the
same block by that write, naming the record's own rewrite call; that no second write in the
session sends it again; and that a second server process — refused first, then writing
cleanly — is not charged twice either. Then the call order the handover must not depend on:
a session that opens on `status` instead of the notes list gets the block from that
`status`, under the head that comes *before* a draft; a session whose first call *fails*
gets it from that failure, which still comes back an error with the CLI's own diagnosis
intact; a session that opens by reading the whole contract gets no summary stapled to it and
none later; and a client with two calls in flight at once pays exactly once. The handover is
measured against its own budget, and the result it rides on still has to fit the 600 the
others do.

## Optional: a Stop hook that reminds you to log

**Not installed by anything in this repository** — this is a snippet to paste into
`~/.claude/settings.json` (or `.claude/settings.json`) if you want it, and to delete when
it stops being useful.

The MCP server gives an agent the tools; a Stop hook is what makes it remember to use them
at the end of a task. This one blocks the first stop with a reminder and lets the second
through, so it can never loop:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{if(JSON.parse(s||'{}').stop_hook_active)process.exit(0);console.error('Before stopping: if you completed a piece of work, record it with the agentmon log_work tool (title, what, why, how, human, and outcome to close it). If you already logged it, or there was nothing to record, stop again.');process.exit(2);});\""
          }
        ]
      }
    ]
  }
}
```

Exit `2` from a Stop hook is what feeds `stderr` back to the model instead of ending the
turn; `stop_hook_active` is true on the stop that follows a block, which is the loop guard.
The honest caveat: this fires on every task, including ones with nothing worth recording,
which is why it asks rather than insists — and why it is a snippet here rather than a file
in the repository.
