# Scenario data brief (for the scenario-generator agent)

The vault must contain TWO projects with real-feeling data:

1. `agent-monitoring` — the TRUE build history of this very app. Builders append their real
   work via the CLI as they go. Never fabricate entries here.

2. `relay` — a FICTIONAL but realistic project: a small team of AI agents building "Relay",
   a webhook delivery service (Rust + Postgres + a React dashboard). Agents: `nova`
   (backend), `sable` (frontend), `patch` (infra/CI), `quill` (docs/API design).
   Requirements for the generated records:
   - 8–12 worklogs spanning ~3 weeks (mix of done / in_progress / one abandoned with reasons),
     each with substantive What/Why/How at the quality of a good vscode merged-PR description:
     concrete file paths, design trade-offs considered, verification steps, follow-ups.
   - 6–8 bugs: at least 3 filed by an agent OUTSIDE the owning area (e.g. sable hits a backend
     500 and files it; nova claims and resolves with a real root-cause + fix narrative).
     Mix of severities/labels; 1–2 still open, 1 in_progress, rest resolved.
   - Comments on bugs that show back-and-forth (repro confirmed, root cause hypothesis, fix).
   - Events timeline dense enough for a live-looking dashboard (work_started/updated/done,
     bug_created/claimed/resolved interleaved across days, several "today").
   - Timestamps: spread over the 3 weeks ending today; several entries within the last 24h so
     the dashboard "now" view has active in_progress work.
   - Zero lorem ipsum, zero placeholder names, no repeated template sentences.

The generator MUST create every record through the `agentmon` CLI (this doubles as a CLI
stress test) and simultaneously write `scenario/GROUND_TRUTH.md`: for each worklog/bug, 2–4
bullet points stating the intended what/why/how (and for bugs: root cause + fix). This file
is the grading key for comprehension critics and must NEVER be shown to them — only to graders.
