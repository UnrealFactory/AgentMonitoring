---
name: handoff-v1-release
title: v1.0.4 is live — how to release, and the traps around the installer
type: handoff
description: v1.0.4 published (prose [[note-name]] links); FB-0001 essential-demotion guard sits on main unreleased; npm run release ships it; UseBasicParsing / resource-glob / NSIS-remembered-dir gotchas.
agent: fable-release-builder
updated_by: fable-feedback-patcher
created: 2026-08-21T08:29:26Z
updated: 2026-08-22T05:43:38Z
tags: []
refs: []
---

Where things stand (2026-08-22, v1.0.4 released; main carries one unreleased patch):

- main is pushed to github.com/UnrealFactory/AgentMonitoring; release v1.0.4 carries
  AgentMonitoring_1.0.4_x64-setup.exe (prose `[[note-name]]` wiki-links render as note
  chips — WORK-0061). The machine's installed copy was last verified at v1.0.1 — the
  sidebar card offers the newest release on its next check and always installs the
  latest, so intermediate versions are skipped. Updating FROM ≤1.0.1 still shows the old
  visible-console updater; from 1.0.2 onward the update runs behind the WPF splash.
- Unreleased on main since v1.0.4: the FB-0001 patch (WORK-0063) — MCP note write and
  CLI note update warn, with the exact restore call, when a passed type takes essential
  off a note (an omitted type was always preserved); the MCP exists-probe treats only
  exit 3 as "create", so a transient view failure can no longer masquerade as a first
  write. Ships with the next release; projects registered against the installed app run
  the old behaviour until then.
- To ship a new version: bump the version in package.json + src-tauri/tauri.conf.json +
  Cargo.toml (all three, release.mjs refuses if they disagree), then `npm run release`
  (or release.bat) — builds the NSIS installer and creates/refreshes the GitHub release
  via the logged-in gh CLI. Installed apps offer it from the sidebar card; the update runs
  behind a WPF splash from a hidden PowerShell worker (src-tauri/src/update.rs, WORK-0055),
  errors surface as a message box, trail in %TEMP%/agentmonitoring-update.log.
- Gotchas that already bit once, fixed in fdced3c but worth knowing when touching them:
  Invoke-WebRequest needs `-UseBasicParsing` on PowerShell 5.1; Tauri `resources` maps
  flatten glob sources (use directory→directory maps); NSIS remembers the last install
  dir in HKCU/Software/agentmonitoring/AgentMonitoring, so a scratch install redirects
  the next "default" one until that key is deleted.
- .mcp.json is the registration path now: app New-project option / `agentmon init
  --mcp-json` / `agentmon project mcp-json` (core mcp_json.rs, merge-safe). The
  CLAUDE.md templates no longer carry the "register the server yourself" section.
- The v1.0.0 release tag points at a8259dc, one commit behind its shakedown fixes; the
  uploaded asset was rebuilt from the fixed tree, so behaviour is correct. Every release
  since has tag and asset from the same commit.
