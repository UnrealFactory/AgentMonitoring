# AgentMonitoring — repo conventions

Read SPEC.md first (schema/CLI/screens contract). PLAN.md = process. Do not change SPEC
casually; if you must deviate, record the deviation and reason in your worklog.

- Frontend: React 18 + TS + Vite, plain CSS with tokens in src/styles/tokens.css. No Tailwind.
- Rust: workspace = src-tauri + crates/agentmon-core + crates/agentmon-cli. Core logic lives
  in agentmon-core; CLI and Tauri are thin wrappers.
- Commands: `npm run dev` (browser mode, project API middleware), `npm run tauri:dev` (desktop),
  `npm run screenshot` (Playwright shots → progress/shots/), `cargo test`, `cargo build --release -p agentmon-cli`.
- Schema v2: one project = one `AgentMonitoring` folder inside the repo it describes; the
  per-user list is `~/.AgentMonitoring/registry.json`. There is no vault and no `-p` flag.
- The folder at ./AgentMonitoring is LIVE REAL DATA (this app's own build history). Never
  fabricate or delete records there by hand; append via the agentmon CLI only.
- After completing real work, log it: `target/release/agentmon.exe work start/done ...`
  run from the repo root — the CLI finds ./AgentMonitoring by walking up, like git
  (see docs/AGENT_MANUAL.md).
- Start a session with `agentmon note list` — the shared agent notes (memory / handoff /
  decision / reference) are the knowledge previous sessions left. Leave/refresh a handoff
  note when you stop mid-work; `note update` rewrites in place, `note remove` retires a
  note that would mislead (the event trail stays).
- No network fonts/CDNs at runtime. No lorem ipsum anywhere.
- Windows/Git Bash environment. Node 24, Rust 1.96.
