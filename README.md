# AgentMonitoring

A record house for work done by AI agents. Agents write down what they did with a CLI;
people read it in a desktop app.

An agent finishes a piece of work and runs `agentmon work done` with what shipped and how
it was verified. It files what it broke with `agentmon bug create`. Each command appends
plain text files to a **vault** — a directory you can copy to another machine, read with
`cat`, and put in version control. The desktop app (Tauri 2 + React) reads that directory
and never writes to it except when you create or archive a project.

The vault in this repository is this app's own build history: every screen below is drawn
from work logs the agents that built it wrote as they went.

![The project dashboard: what is in progress now, which bugs are unresolved, the last 24 hours, two burn-ups and the activity feed](progress/shots/dashboard.png)

## What you get

- **Work logs** — what an agent did, why, how, the notes it posted while it ran, and the
  outcome it wrote when it finished. Read as a merged pull request reads.
- **Bugs** — report, comment thread, and the resolution written into the bug itself, so the
  fix is in the same place as the defect.
- **A dashboard** — what is in progress right now, which bugs still need somebody, what
  moved in the last 24 hours, and two burn-ups over the range you pick.
- **Live updates** — a record an agent writes appears in the open window in about a second,
  with no reload and without losing your scroll position.

![A work log: what, why, how, the update timeline and the outcome](progress/shots/work-detail.png)

![The bug board, grouped by status with severity and ownership on every row](progress/shots/bugs.png)

## Quickstart

Requires Node 20+ and Rust 1.77+ (the workspace's stated MSRV; built here on Node 24 and
Rust 1.96). Windows, macOS or Linux.

**The desktop app**

```bash
npm install
npm run tauri:dev          # opens the app on ./vault
```

It reads `./vault` beside the repository unless you point it elsewhere: set
`AGENTMON_VAULT=<dir>`, or use **Open vault folder…** on the Projects screen. Your choice is
remembered between runs. With no vault anywhere — a fresh machine, an unplugged drive — the
app opens on the Projects screen with **Create a vault…**, which writes `vault.json` and
`projects/` into a folder you pick, exactly as `agentmon init` would.

**The CLI**

```bash
cargo build --release -p agentmon-cli    # -> target/release/agentmon
```

`npm run tauri:build` builds it too and ships it inside the installer, so an installed copy
has `agentmon` sitting next to `agentmonitoring.exe`; the app's onboarding screen prints
command lines that name it.

Three commands, start to finish:

```bash
agentmon work start -p agent-monitoring --agent my-agent \
  --title "Cache project counts so the sidebar stops re-reading every record" \
  --body "## What
Cache the per-project counts the sidebar shows.

## Why
The sidebar re-parses every record on every navigation, so the app gets slower the more it
is used.

## How
An in-memory cache in the data layer, cleared on the vault-changed event."

agentmon work update WORK-0004 -p agent-monitoring --agent my-agent \
  --message "Cache is in: screen switch went from 180ms to 12ms on the live vault."

agentmon work done WORK-0004 -p agent-monitoring --agent my-agent \
  --files src/lib/api.ts \
  --outcome "Shipped the cache; Dashboard/Work switch 180ms -> 12ms. Verified with
npm run build and cargo test --workspace."
```

`agentmon status -p <project>` prints a snapshot; `agentmon doctor` validates the whole
vault and exits non-zero if anything is wrong.

**Agents**

Point them at [docs/AGENT_MANUAL.md](docs/AGENT_MANUAL.md). It is written to be the only
thing an agent needs to read: the body contract, three copy-pasteable recipes, backdating,
exit codes and `--json` output.

## MCP

`mcp/` is an MCP server that puts the CLI in an agent's tool list, so it records work by
calling a tool instead of writing a shell command:

```bash
claude mcp add agentmon -- node C:/Code/AgentMonitoring/mcp/server.mjs \
  --vault C:/AgentVault --project myproj --agent my-agent
```

Five tools shaped like the workflow, not sixteen mirroring the CLI. It is built to a
context budget — the whole tool list costs 4,650 bytes and a write returns about 200
characters — because both are re-read by the model on every turn. Every call shells to the
same binary, so nothing is validated twice or differently. [docs/MCP.md](docs/MCP.md) has
the tools, the exit-code mapping and an optional Stop-hook snippet.

## The vault

One directory holds everything: `vault.json` names it, and each project is a folder under
`projects/<slug>/` containing `project.json`, an append-only `events.jsonl`, and one
Markdown file per record in `worklogs/` and `bugs/` — YAML frontmatter (id, title, agent,
status, timestamps, tags, refs) followed by the prose sections the CLI validates. Ids are
per project and immutable, timestamps are UTC ISO 8601, and every mutation appends exactly
one line to the event log. Nothing else is stored anywhere, so copying the folder copies
the history.

The full schema, the CLI surface and the quality bar for each screen are in
[SPEC.md](SPEC.md).

## Layout

```
src/                    React 18 + TypeScript frontend (plain CSS, tokens in styles/)
src-tauri/              Tauri 2 shell: commands + the filesystem watcher
crates/agentmon-core/   vault schema, parsing, validation, writes — shared by both
crates/agentmon-cli/    the `agentmon` binary agents run
mcp/                    MCP server: the CLI as five tools (docs/MCP.md)
docs/AGENT_MANUAL.md    the manual agents read
progress/               build history: rounds, screenshots, the progress page
vault/                  the live vault this app reads
```

`agentmon-core` is the only code that touches the on-disk format; the CLI and the desktop
app are both thin wrappers over it, so a project created in the app is indistinguishable
from one created at a terminal.

## Development

```bash
npm run dev              # browser mode against ./vault (?vault=<dir> to point elsewhere)
npm run build            # tsc --noEmit + vite build
npm run tauri:build      # the packaged desktop app (MSI + NSIS, CLI bundled beside it)
cargo test --workspace   # Rust tests
npm run screenshot       # capture every screen to progress/shots/
```

Gates, all of which drive the real app with Playwright against real vault data:

```bash
npm run smoke            # markdown rendering across every record in the vault
npm run check:clipping   # every screen at seven widths: nothing cut, no heading truncated
npm run check:counts     # every filter control: the number it prints is the rows you get
npm run check:urlstate   # view state survives reload, Back and a pasted link
npm run check:keys       # keyboard: lists, palette, focus, one current page
npm run check:live       # a CLI write reaches an open window without a reload
npm run check:vault      # the vault opens from anywhere, and moving it changes nothing
npm run check:mcp        # the MCP server over stdio: lifecycle, errors, context budgets
```

`check:live` and `check:vault` write records, and only ever to a copy in the temp
directory; the vault in this repository is real history and is never written to by a test.
