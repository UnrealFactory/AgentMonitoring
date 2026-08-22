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
is **6,664 bytes**. Results are the other half: a write
returns the id, the file path and one line of confirmation — the CLI's `--json` envelope
boiled down, about 200 characters, rather than the record it just wrote, which the caller
already has. Reads return compact summaries capped at 600 characters, and `full: true`
(on `status(mode="view")` and `note(action="read")`) is the single, explicit way to pay
for a whole record. `npm test` measures all of it and fails if any budget is exceeded, so
the numbers in this paragraph cannot quietly rot.

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

### `log_work`

Records a piece of work, start and finish, in one call.

`title*`, `what*`, `why*`, `how*`, `outcome`, `files`, `tags`, `refs`, `started_at`,
`finished_at`

The three body sections are three fields, so the body contract cannot be got wrong — the
server assembles the markdown. With an `outcome` the log is opened and closed in one call
and comes back `done`; without one it stays `in_progress` and the reply carries the
`WORK-NNNN` id to close later. `files` is recorded when the log closes, which is the CLI's
rule. Backdating a whole record is `started_at` + `finished_at` in the same call.

### `update_work`

Progress, close, or stop — on an existing `WORK-NNNN`.

`id*`, `note`, `outcome`, `abandon`, `files`, `at`

Exactly one of the three is the point of the call: `note` appends a timestamped note,
`outcome` closes the log, `abandon` marks it abandoned with a reason. A note on an
already-closed log is allowed and is how a shipped record gets corrected — open the note
with `Correction:` and the app marks it.

### `report_bug`

Files a bug.

`title*`, `severity*` (`critical|high|medium|low`), `report*`, `labels`, `refs`,
`created_at`

`report` is prose — repro, expected, actual. It becomes the `## Report` section. Use `refs`
rather than only prose to link the work log it came out of: the link then works in both
directions.

### `resolve_bug`

Claim, comment and resolve, in any combination.

`id*`, `comment`, `resolution`, `claim`, `at`

Passing a `resolution` claims the bug first unless you pass `claim: false`, so the usual
fix is one call: root-cause `comment` plus `resolution`. Claim-only (`claim: true`) and
comment-only (`claim: false`, `comment`) are both valid single calls. If another agent
holds the bug the claim fails and the reply names the way past it.

### `note`

The shared agent knowledge — essential, memory, handoff, decision and reference notes —
in one tool. The essential notes are required session-start reading and sort first.

`action` (`list` default, `read`, `write`, `remove`), `name`, `title`, `type`
(`essential|memory|handoff|decision|reference`), `description`, `body`, `tags`, `refs`,
`query`, `full`, `at`

- `list` — the index: every note's name, type, author and one-line description —
  essential notes first, then newest. `type` and `query` filter. Run it at the start of
  a session and read the essentials before working.
- `read` — one note by `name`; `full: true` for the whole body.
- `write` — **upsert**: against a `name` that exists it rewrites in place (only the fields
  passed — a `type` left off is preserved; `body` replaces wholesale), which is the
  one-fact-one-file discipline; against a new name (or none — it derives one from the
  title) it creates, requiring `title`, `type`, `description` and `body`. Passing a `type`
  that takes `essential` off an existing note is honored but answered with a warning and
  the restore call — required reading must not fall out of the index unnoticed. A named
  write whose note cannot be *read* (lock, malformed file) fails with that error rather
  than posing as a first write.
- `remove` — retires a note that would mislead if kept. The `note_removed` event stays on
  the feed; work logs and bugs have no such verb, here or anywhere.

### `status`

The one read tool for work and bugs.

`mode` (`project` default, `work`, `bugs`, `view`), `id`, `state`, `severity`, `agent`,
`limit`, `full`

- `project` — counts, what is in progress, open bugs by severity, last activity.
- `work` / `bugs` — one line per record, in the CLI's own order (work by last activity,
  bugs open-and-severe first); `state`, `severity` and `agent` filter, and `limit` sets how
  many rows (default 8, max 50).
- `view` — one record by `id`: metadata, then its outcome or, while it is open, its what.
  `full: true` returns the whole record instead, and is the only call that may exceed 600
  characters.

### `app_feedback`

A bug or a wish **about the AgentMonitoring app itself** — its tools, CLI or boards —
not about the project being worked on.

`type*` (`bug|idea`), `title*`, `body`, `at`, `agent`

The one tool with no `dir`: app feedback is machine-level, stored beside the registry
(`~/.AgentMonitoring/feedback/FB-NNNN.md`), because it belongs to no project. `body` is
optional — a specific title can carry a whole wish, and friction here would cost real
feedback. This tool only files. Working the board — `done`, `reopen`, and `delete`
(done items only) — happens in the app or through the CLI when the human delegates the
cleanup; those verbs would spend every conversation's tokens on what is an occasional
chore, so they are not tools.

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
| `2` | Usage or timestamp rejected | A time in the future, or one before the state it follows |
| `3` | Not found | An unknown project folder, or an id that does not exist |
| `4` | Body rejected | A `what`/`why`/`how`/`outcome` that is a placeholder or too short |
| `5` | Conflict | Closing a closed log, claiming a bug another agent holds |
| `6` | Invalid project | Corrupt frontmatter or `project.json` |
| `7` | I/O error | Permissions, or the path is gone |

Two failures come from the server rather than the CLI, and say so plainly: no agent
available for the call, and `update_work` with nothing to say. A failed call writes
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
            "command": "node -e \"let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{if(JSON.parse(s||'{}').stop_hook_active)process.exit(0);console.error('Before stopping: if you completed a piece of work, record it with the agentmon log_work tool (title, what, why, how, and outcome to close it). If you already logged it, or there was nothing to record, stop again.');process.exit(2);});\""
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
