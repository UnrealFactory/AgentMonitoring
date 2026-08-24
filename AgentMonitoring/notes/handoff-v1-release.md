---
name: handoff-v1-release
title: v1.1.0 is live — how to ship, and the traps around the installer
type: handoff
description: v1.1.0 published (dual records, toggle, scenes, reconcile, locale race, shortcut guard); npm run release ships the next one; UseBasicParsing / resource-glob / NSIS-remembered-dir gotchas.
agent: fable-release-builder
updated_by: fable-dual-lead
created: 2026-08-21T08:29:26Z
updated: 2026-08-24T09:08:12Z
tags: []
refs: []
---

Where things stand (2026-08-24, v1.1.0):

- main is pushed through 289ea3e; release v1.1.0 carries AgentMonitoring_1.1.0_x64-setup.exe (tag and asset from the same commit). This is the dual-record release: every record carries an agent area and a human area (enforced on every write path; `## For humans` is the file's last section), the record screens carry the Agent/사람 toggle with per-beat scene diagrams, `agentmon reconcile` + `--replayed` repair two-machine id collisions (BUG-0027), the boot locale race is fixed (BUG-0026), and updates stop resurrecting a deleted desktop shortcut (update.rs passes '/S','/UPDATE'; src-tauri/windows/hooks.nsi guards silent installs for copies still updating with /S alone — the first update INTO 1.1.0 is that transition).
- To ship a new version: bump the version in package.json + src-tauri/tauri.conf.json + Cargo.toml (root, workspace version — all three, release.mjs refuses if they disagree), then npm run release. The preflight also runs scripts/check-humanstyle-drift.mjs — if it refuses, rebuild the CLI so the embedded contract matches docs/HUMAN_STYLE.md.
- Writing rules are write-time only: nothing in CLAUDE.md; the CLI rejection, the MCP first result and `agentmon human-style` deliver the compact rules; per-piece history is progress/rounds.jsonl (D1-D11).
- Gotchas that already bit once, still true: Invoke-WebRequest needs -UseBasicParsing on PowerShell 5.1; Tauri resources maps flatten glob sources; NSIS remembers the last install dir in HKCU/Software/agentmonitoring/AgentMonitoring, so a scratch install redirects the next "default" one until that key is deleted.
- .mcp.json is the registration path (init --mcp-json / project mcp-json); updating FROM ≤1.0.1 still shows the old visible-console updater, from 1.0.2 the WPF splash, and from 1.1.0 onward silent updates leave the desktop icon state alone.

## For humans

This note is the baton between work sessions: whoever picks the project up next reads it to learn what version is out in the world and how to ship the next one. It was rewritten on 2026-08-24, the day version 1.1.0 went out.

**1.1.0 is the two-audiences release.** Every record now carries a second half in plain language, the app grew a switch to flip between the technical and plain views, records can carry small explanatory diagrams, and two long-standing annoyances died: the language button ignoring an early press, and the desktop icon coming back after every update.

**Shipping the next version is three edits and one command.** The version number lives in three files that must agree; a script refuses to build if they differ, then builds the installer and publishes it. A guard also checks that the writing rulebook baked into the tools matches the one on disk — if it complains, rebuild the command-line tool first.

**The traps at the bottom are the scars.** Each one is a mistake that already cost an afternoon once, written down so it only ever costs a sentence to avoid.

Read this note first, ship with the three-files-one-command routine, and trust the traps list before trusting a hunch.
