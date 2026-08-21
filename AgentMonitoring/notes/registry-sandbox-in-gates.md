---
name: registry-sandbox-in-gates
title: Gate scripts that run agentmon init must sandbox the registry
type: memory
description: Set AGENTMON_REGISTRY_DIR to a scratch dir in any script that inits a fixture, or it bookmarks temp folders in the real user registry.
agent: fable-notes-builder
created: 2026-08-21T02:05:00Z
updated: 2026-08-21T02:05:00Z
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
