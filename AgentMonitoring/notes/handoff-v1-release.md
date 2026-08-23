---
name: handoff-v1-release
title: v1.0.5 is live — how to release, and the traps around the installer
type: handoff
description: v1.0.5 published (FB-0001 essential-demotion guard); npm run release ships the next one; UseBasicParsing / resource-glob / NSIS-remembered-dir gotchas.
agent: fable-release-builder
updated_by: d4-doc-surgeon
created: 2026-08-21T08:29:26Z
updated: 2026-08-23T07:26:10Z
tags: []
refs: []
---

Where things stand (2026-08-22, v1.0.5):

- main is pushed to github.com/UnrealFactory/AgentMonitoring; release v1.0.5 carries
  AgentMonitoring_1.0.5_x64-setup.exe (FB-0001 guard: MCP note write and CLI note update
  warn, with the exact restore call, when a passed type takes essential off a note — an
  omitted type was always preserved; the MCP exists-probe treats only exit 3 as "create",
  so a transient view failure no longer masquerades as a first write — WORK-0063).
  v1.0.4 carried the prose `[[note-name]]` wiki-link chips (WORK-0061). The machine's
  installed copy was last verified at v1.0.1 — the sidebar card offers the newest release
  on its next check and always installs the latest, so intermediate versions are skipped.
  Updating FROM ≤1.0.1 still shows the old visible-console updater; from 1.0.2 onward the
  update runs behind the WPF splash.
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

## For humans

Version 1.0.5 is out and anyone can install it, as of 22 August 2026. An older copy is offered it by a card in the app's sidebar, which always installs the newest, so a machine several releases behind jumps straight there. This machine's copy was last confirmed at 1.0.1.

**1.0.5 stops a note quietly losing its rank.** A note can be marked `essential`, the kind nobody may skip. Rewriting it under a different kind used to take that mark off in silence; leaving the kind out never did. Both ways of writing one warn instead: the command line and the go-between server agents call. Each prints the exact command that puts it back.

**The same release stopped a rewrite passing as a first draft.** Before rewriting a note by name, that server asks whether it exists. Any failure of that question used to read as "there is no such note", so a rewrite was taken for a first write. Only the answer that really means "there is none" counts now.

1.0.4 turned a note's name written in double square brackets into a link you can click.

**Joining a project to that server is now a file inside it, `.mcp.json`.** The app writes it from its New project option; two commands do it too. Anything already in it is kept, and the starter instructions no longer tell you to register by hand.

**Publishing the next version is one command.** The version number sits in three files, and `npm run release` refuses to start unless they agree. It builds the Windows installer and puts it on the project's GitHub page, through the GitHub command-line tool it is signed in to.

**Three traps have already caught somebody here.** All three are fixed, but worth knowing when you touch that area. The download step needs the flag `-UseBasicParsing` under PowerShell 5.1, the scripting tool Windows runs these steps with. The step that bundles extra files into the app flattens folders when pointed at a pattern; point it at a folder.

**The installer remembers where you last installed it,** at `HKCU/Software/agentmonitoring/AgentMonitoring`. One scratch install sends every later "default" one there until you delete that entry.

It is like a shop that keeps your last delivery address and quietly starts calling it home.

**Updating from 1.0.1 or older still shows the old updater: a visible text window.** From 1.0.2 on it runs behind a small window. A failure shows a message box, and the trail goes to `%TEMP%/agentmonitoring-update.log`.

The `v1.0.0` marker sits one change before its own fixes, but what people downloaded was built from the fixed code, so the app is right. Marker and download have matched ever since.

Before you ship anything here, check the version number in all three files.
