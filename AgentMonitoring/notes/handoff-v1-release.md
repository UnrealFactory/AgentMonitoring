---
name: handoff-v1-release
title: v1.1.1 is live — how to ship, and the traps around the installer
type: handoff
description: "v1.1.1 published; UNRELEASED on this machine: WORK-0086 --message-requires---human gate. npm run release ships; keep the installer asset name; UseBasicParsing / NSIS gotchas."
agent: fable-release-builder
updated_by: fable-human-gate
created: 2026-08-21T08:29:26Z
updated: 2026-08-24T13:05:12Z
tags: []
refs: []
---

Where things stand (2026-08-24, v1.1.1 released):

- UNRELEASED, in the working tree (not yet committed): WORK-0086 — `work update` /
  `bug comment` (and `--replayed`) refuse a `--message` without `--human` (owner
  directive 2026-08-24; agents were bypassing the human area by posting real content
  as notes). Core gate in write.rs; every printed hint carries `--human` now; SPEC,
  AGENT_MANUAL, MCP.md updated; cargo + MCP (209) + tsc + smoke green. Installed apps
  and the bundled CLI keep the old optional pair until this is committed and shipped
  as the next version.

- Release v1.1.1 is live with AgentMonitoring_1.1.1_x64-setup.exe; main is pushed through
  b79b7af (WORK-0084 + WORK-0085). It ships the de-metered update check (BUG-0029: tag
  from the un-metered /releases/latest redirect, installer via un-metered HEAD, notes API
  best-effort — a spent 60/hr quota can only blank the card's tooltip) and three MCP
  fixes: `full: true` reads untruncated (FB-0003), `note write` clears tags/refs on an
  explicit empty array, and calls carrying leaked tool-call markup are refused whole
  (FB-0002; the damaged ElmwoodOnline BUG-0001 was spliced clean).
- v1.1.0 before it was the dual-record release: every record carries an agent area and a
  human area (enforced on every write path; `## For humans` is the file's last section),
  the record screens carry the Agent/사람 toggle with per-beat scene diagrams, `agentmon
  reconcile` + `--replayed` repair two-machine id collisions (BUG-0027), the boot locale
  race is fixed (BUG-0026), and updates stop resurrecting a deleted desktop shortcut
  (update.rs passes '/S','/UPDATE'; src-tauri/windows/hooks.nsi guards silent installs for
  copies still updating with /S alone).
- To ship a new version: bump the version in package.json + src-tauri/tauri.conf.json +
  Cargo.toml (root, workspace version — all three, release.mjs refuses if they disagree),
  then npm run release. The preflight also runs scripts/check-humanstyle-drift.mjs — if it
  refuses, rebuild the CLI so the embedded contract matches docs/HUMAN_STYLE.md. The
  updater's fallback constructs the installer URL from the asset name release.mjs uploads
  (AgentMonitoring_<version>_x64-setup.exe) — renaming that asset breaks the un-metered
  path (a unit test in update.rs pins it).
- Writing rules are write-time only: nothing in CLAUDE.md; the CLI rejection, the MCP first
  result and `agentmon human-style` deliver the compact rules; per-piece history is
  progress/rounds.jsonl (D1-D11).
- Gotchas that already bit once, still true: Invoke-WebRequest needs -UseBasicParsing on
  PowerShell 5.1; Tauri resources maps flatten glob sources; NSIS remembers the last
  install dir in HKCU/Software/agentmonitoring/AgentMonitoring, so a scratch install
  redirects the next "default" one until that key is deleted.
- .mcp.json is the registration path (init --mcp-json / project mcp-json); updating FROM
  ≤1.0.1 still shows the old visible-console updater, from 1.0.2 the WPF splash, and from
  1.1.0 onward silent updates leave the desktop icon state alone.

## For humans

This note is the baton between work sessions: whoever picks the project up next reads it to learn what version is out in the world and how to ship the next one. It was last rewritten on 2026-08-24, the day version 1.1.1 went out — the second release of that day.

**1.1.1 is in people's hands, and one change now waits unpublished.** On the same day, a rule was tightened on this machine but not yet committed or shipped: adding a note to a record now demands the plain-language telling alongside it, because some agents had been skipping that half. Whoever ships next carries it out with the routine below. 1.1.1's headline fix: the app's "is there a newer version?" question used to go through a channel GitHub only answers 60 times an hour per address, and on a busy day the update offer silently vanished. It now asks through a free, unmetered address. Three fixes to the record-writing tools ride along: long records come back whole instead of cut off at the tail, a note's related-records list can actually be emptied, and a call carrying machine boundary-markers in its text is refused instead of saved corrupted.

**Shipping the next version is three edits and one command.** The version number lives in three files that must agree; a script refuses to build if they differ, then builds the installer and publishes it. A guard also checks that the writing rulebook baked into the tools matches the one on disk — if it complains, rebuild the command-line tool first. One new caution: the free update route finds the installer by its exact file name, so renaming what the release script uploads would break it — an automated test stands watch over that name.

**The traps at the bottom are the scars.** Each one is a mistake that already cost an afternoon once, written down so it only ever costs a sentence to avoid.

Read this note first, ship with the three-files-one-command routine, and keep the installer's file name exactly as the release script writes it.
