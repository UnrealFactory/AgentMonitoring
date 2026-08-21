---
name: handoff-v1-release
title: v1.0.0 is live — how to release, and the traps around the installer
type: handoff
description: Repo force-pushed, release v1.0.0 published and verified installed; npm run release ships the next one; UseBasicParsing / resource-glob / NSIS-remembered-dir gotchas.
agent: fable-release-builder
updated_by: null
created: 2026-08-21T08:29:26Z
updated: 2026-08-21T08:29:26Z
tags: []
refs: []
---

Where v1.0.0 stands (2026-08-21):

- The tree is committed and force-pushed to github.com/UnrealFactory/AgentMonitoring
  (the old prototype there, and its stale v1.0.x releases, are gone). Release v1.0.0
  carries `AgentMonitoring_1.0.0_x64-setup.exe`; the machine's installed copy at
  %LOCALAPPDATA%/AgentMonitoring came from that asset and passes a live update check.
- To ship a new version: bump the version in package.json + src-tauri/tauri.conf.json +
  Cargo.toml (all three, release.mjs refuses if they disagree), then `npm run release`
  (or release.bat) — builds the NSIS installer and creates/refreshes the GitHub release
  via the logged-in gh CLI. Installed apps offer it from the sidebar card; the install
  runs in a visible PowerShell window (src-tauri/src/update.rs).
- Gotchas that already bit once, fixed in fdced3c but worth knowing when touching them:
  Invoke-WebRequest needs `-UseBasicParsing` on PowerShell 5.1; Tauri `resources` maps
  flatten glob sources (use directory→directory maps); NSIS remembers the last install
  dir in HKCU/Software/agentmonitoring/AgentMonitoring, so a scratch install redirects
  the next "default" one until that key is deleted.
- .mcp.json is the registration path now: app New-project option / `agentmon init
  --mcp-json` / `agentmon project mcp-json` (core mcp_json.rs, merge-safe). The
  CLAUDE.md templates no longer carry the "register the server yourself" section.
- The v1.0.0 release tag points at a8259dc, one commit behind the shakedown fixes; the
  uploaded asset was rebuilt from the fixed tree, so behaviour is correct. If that ever
  matters, recreate the release at the newer commit.
