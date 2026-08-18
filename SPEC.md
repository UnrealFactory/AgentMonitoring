# AgentMonitoring — SPEC (contract for all builders & critics)

AgentMonitoring is a Tauri 2 + Rust desktop app: a **central record house where AI agents
document their own work for humans**. Agents write records via a CLI; humans read them in
the desktop app. Storage is plain files (portable across machines).

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
AgentMonitoring/
  package.json            # npm scripts: dev, build, tauri, screenshot
  vite.config.ts          # includes vault-api dev middleware (browser mode)
  src/                    # React 18 + TypeScript frontend
    styles/tokens.css     # design system: Linear-inspired dark theme
    lib/api.ts            # data layer: Tauri invoke() OR browser fetch('/vault-api/...')
    ...pages/components
  src-tauri/              # Tauri 2 shell (Rust) — commands + fs watch → events
  crates/
    agentmon-core/        # Rust lib: vault schema, parse/write, validation (shared)
    agentmon-cli/         # `agentmon` binary — the agent-facing interface
  docs/
    AGENT_MANUAL.md       # THE manual agents read (gh-manual bar)
  vault/                  # the live data vault (real scenario data lives here)
  progress/               # live progress page (see PLAN.md)
  scripts/
    screenshot.mjs        # Playwright: capture every app screen to progress/shots/
    capture-refs.mjs      # Playwright: capture bar references to progress/refs/
    build-progress.mjs    # regenerate progress/index.html from rounds.jsonl
```

**Single source of truth = the vault directory (plain files).** CLI writes, app reads.
The frontend data layer has two transports: Tauri `invoke()` in the desktop app, and
`/vault-api/*` (a Vite dev middleware reading the same vault) in browser mode. Browser
mode exists so critics can screenshot fast with Playwright; the desktop app is the product.

## Vault schema (v1)

```
vault/
  vault.json                      # { "version": 1, "name": "...", "createdAt": ISO8601 }
  projects/<slug>/
    project.json                  # { id, slug, name, description, status: active|archived,
                                  #   tags: [...], createdAt }
    events.jsonl                  # append-only, one JSON object per line:
                                  # { ts, actor, type, ref, summary }
                                  # type ∈ work_started|work_updated|work_done|work_abandoned|
                                  #        bug_created|bug_claimed|bug_commented|bug_resolved|
                                  #        bug_closed|project_created
    worklogs/WORK-0001.md         # zero-padded per-project sequence
    bugs/BUG-0001.md
```

### Worklog file (`WORK-NNNN.md`) — YAML frontmatter + Markdown body

```yaml
---
id: WORK-0001
title: Implement vault parser in agentmon-core
agent: rust-core-builder
status: in_progress   # in_progress | done | abandoned
started: 2026-08-18T09:12:00Z
finished: null        # ISO8601 when done
tags: [core, rust]
refs: [BUG-0002]      # related worklogs/bugs
files: [crates/agentmon-core/src/vault.rs]
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
title: App crashes when vault.json is missing
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

Every CLI mutation also appends one line to `events.jsonl`. Timestamps: UTC ISO8601.
IDs are immutable and per-project. Parsing must be lenient on unknown keys (forward compat).

## CLI surface (`agentmon`, gh-style)

```
agentmon init [--vault <dir>] [--name <vault name>]
agentmon project create <slug> --name <n> [--description <d>] [--tags a,b]
agentmon project list
agentmon work start   -p <project> --agent <name> --title <t> [--tags] [--body-file f | --body s]
agentmon work update  <WORK-ID> -p <project> --agent <name> (--message s | --body-file f)
agentmon work done    <WORK-ID> -p <project> --agent <name> (--outcome s | --outcome-file f) [--files a,b]
agentmon work list    -p <project> [--status s] [--agent a] [--json]
agentmon work view    <WORK-ID> -p <project> [--json]
agentmon bug create   -p <project> --agent <name> --title <t> --severity <s> (--body s | --body-file f) [--labels]
agentmon bug claim    <BUG-ID> -p <project> --agent <name>
agentmon bug comment  <BUG-ID> -p <project> --agent <name> (--message s | --body-file f)
agentmon bug resolve  <BUG-ID> -p <project> --agent <name> (--resolution s | --resolution-file f)
agentmon bug list     -p <project> [--status s] [--severity] [--label] [--json]
agentmon bug view     <BUG-ID> -p <project> [--json]
agentmon status       -p <project>        # snapshot: active work, open bugs, recent events
agentmon doctor       # validate vault integrity, exit non-zero on problems
```

Vault resolution: `--vault` flag > `AGENTMON_VAULT` env > `./vault` if it contains vault.json.
`work start` on `--body` expects `## What / ## Why / ## How` sections; CLI provides a
template and rejects bodies missing them (clear error). Exit codes and `--json` output are
part of the contract (agents script against them). Errors must say how to fix.

## Desktop app screens

1. **Shell** — Linear-style: left sidebar (project switcher, nav: Dashboard / Work / Bugs),
   dark theme, Inter font, dense-but-calm layout, keyboard focus visible.
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
7. **Projects** — list/create/switch; vault path display + "open different vault folder".

Live updates: Tauri watches the vault (notify crate) and emits events → UI refreshes.

## Design system (Linear bar)

- Dark theme first. Background layers ~#0e0f11 / #16171a / #1c1d21; borders rgba-white ~6-10%;
  text #e8e9eb primary, #8a8f98 secondary; one restrained accent (indigo ~#5e6ad2).
- Inter (via @fontsource-variable/inter, bundled, no network at runtime). 13-14px base,
  tight tracking on headings, tabular-nums for tables/IDs.
- 8px spacing grid; radii 6-8px; subtle shadows; instant hover states; no gradients-noise.
- Status/severity = small dot or pill + label, muted saturated colors, consistent everywhere.
- Empty states designed, not blank. Loading = skeletons, no spinners-on-white.

## Real scenario data requirement

Critics judge screens **with real scenario data**: the vault must contain the actual build
history of this app (builders log their real work via the CLI as they build) plus one
realistic fictional team project for volume. No lorem ipsum anywhere, ever.
