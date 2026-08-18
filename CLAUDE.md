# AgentMonitoring — repo conventions

Read SPEC.md first (schema/CLI/screens contract). PLAN.md = process. Do not change SPEC
casually; if you must deviate, record the deviation and reason in your worklog.

- Frontend: React 18 + TS + Vite, plain CSS with tokens in src/styles/tokens.css. No Tailwind.
- Rust: workspace = src-tauri + crates/agentmon-core + crates/agentmon-cli. Core logic lives
  in agentmon-core; CLI and Tauri are thin wrappers.
- Commands: `npm run dev` (browser mode, vault API middleware), `npm run tauri:dev` (desktop),
  `npm run screenshot` (Playwright shots → progress/shots/), `cargo test`, `cargo build --release -p agentmon-cli`.
- The vault at ./vault is LIVE REAL DATA (this app's own build history). Never fabricate or
  delete records there by hand; append via the agentmon CLI only.
- After completing real work, log it: `target/release/agentmon.exe work start/done ...`
  (see docs/AGENT_MANUAL.md). Project slug for this app's own history: `agent-monitoring`.
- No network fonts/CDNs at runtime. No lorem ipsum anywhere.
- Windows/Git Bash environment. Node 24, Rust 1.96.
