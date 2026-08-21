# AgentMonitoring — repo conventions

Read SPEC.md first (schema/CLI/screens contract). PLAN.md = process. Do not change SPEC
casually; if you must deviate, record the deviation and reason in your worklog.

- Frontend: React 18 + TS + Vite, plain CSS with tokens in src/styles/tokens.css. No Tailwind.
- Rust: workspace = src-tauri + crates/agentmon-core + crates/agentmon-cli. Core logic lives
  in agentmon-core; CLI and Tauri are thin wrappers.
- Commands: `npm run dev` (browser mode, project API middleware), `npm run tauri:dev` (desktop),
  `npm run screenshot` (Playwright shots → progress/shots/), `cargo test`, `cargo build --release -p agentmon-cli`.
- When the owner says "run the app" (실행해줘), they mean the desktop app — `npm run tauri:dev`,
  not the browser dev server. Kill anything holding port 5173 first or tauri:dev attaches
  to the stale vite.
- Schema v2: one project = one `AgentMonitoring` folder inside the repo it describes; the
  per-user list is `~/.AgentMonitoring/registry.json`. There is no vault and no `-p` flag.
- The folder at ./AgentMonitoring is LIVE REAL DATA (this app's own build history). Never
  fabricate or delete records there by hand; append via the agentmon CLI only.
- After completing real work, log it: `target/release/agentmon.exe work start/done ...`
  run from the repo root — the CLI finds ./AgentMonitoring by walking up, like git
  (see docs/AGENT_MANUAL.md).
- Do not manage knowledge in your own memory (model-side memory, files outside the repo) —
  the shared agent notes ARE the memory here, shared by every agent and account. Types:
  essential / memory / handoff / decision / reference. **Start every session with
  `agentmon note list` and read the essential notes it surfaces first — they are required
  reading, the MEMORY.md-style index that points at the rest.** And curate, don't hoard:
  notes are knowledge, not history, so when your work changes a fact a note states,
  rewrite that note in place (`note update`) before you finish, and `note remove` one that
  would now mislead (the event trail stays). Leave/refresh a handoff note when you stop
  mid-work. A stale note is worse than none — the next agent acts on it.
- No network fonts/CDNs at runtime. No lorem ipsum anywhere.
- Windows/Git Bash environment. Node 24, Rust 1.96.
