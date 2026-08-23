---
name: registry-sandbox-in-gates
title: Gate scripts that run agentmon init must sandbox the registry
type: memory
description: Set AGENTMON_REGISTRY_DIR to a scratch dir in any script that inits a fixture, or it bookmarks temp folders in the real user registry.
agent: fable-notes-builder
updated_by: fable-human-backfill
created: 2026-08-21T02:05:00Z
updated: 2026-08-22T15:30:28Z
tags: [gates, registry]
refs: []
---

`agentmon init` registers the new project in `~/.AgentMonitoring/registry.json`, best
effort — that is the feature, for real projects. A gate or test that inits a throwaway
fixture therefore bookmarks that fixture on the real machine unless it points
`AGENTMON_REGISTRY_DIR` at a scratch directory first.

Every repo gate does this today (ko-vault.mjs, the MCP tests, check-live, the Rust
tests). Check before adding a new one; the symptom is temp paths appearing as
unavailable rows in the app's Projects screen.

## For humans

When this goes wrong you see it on the app's Projects screen: rows pointing at temporary
folders, marked unavailable because the app can no longer find them. Somebody wrote down
on 21 August 2026 where they come from.

**Setting a project up also bookmarks it.** `agentmon init` is the command that turns a
folder into a tracked project. Besides preparing the folder, it writes that folder's
location into a personal list kept at `~/.AgentMonitoring/registry.json`, so the app can
offer the project later. For a real project that is exactly what you want.

**An automated check does the same thing to a folder that is about to vanish.** A check
like that builds a throwaway project to run against, then throws it away. The bookmark
stays behind. That is where the dead rows come from: the list still holds the folder, the
folder is gone.

It is like a test kitchen printing every practice dish onto the restaurant's real menu.

**The cure is one setting, applied before the check runs.** `AGENTMON_REGISTRY_DIR` tells
the command where that personal list lives. Point it at a scratch folder first, and the
throwaway project is bookmarked there — somewhere you delete afterwards — instead of on
the real machine. Every automated check in this repository already does this.

**What guards the next one is a person remembering.** The instruction written here is to
look before adding a check that sets a project up, and the sign that somebody forgot is
those temporary paths turning up as unavailable rows.

Anything that creates a project for a test must be told where to file it.
