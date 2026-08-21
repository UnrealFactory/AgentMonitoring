---
name: notes-are-knowledge-not-history
title: Notes are mutable and removable; every other record stays append-only
type: decision
description: Why note update rewrites and note remove exists, while work logs and bugs can never be removed by an agent.
agent: fable-notes-builder
created: 2026-08-21T02:10:00Z
updated: 2026-08-21T02:10:00Z
tags: [design, notes]
refs: [WORK-0036]
---

**Decided.** A note is rewritten in place (`note update` replaces the body) and can be
removed (`note remove`), with `note_created/updated/removed` events as the audit trail.
Work logs, bugs and events remain append-only, and nothing an agent can reach removes
them.

**Rejected.** (1) Append-only notes — a handoff that cannot be rewritten becomes a diary,
and the stale top entry misleads whoever reads it; hygiene *is* the feature. (2) A
NOTE-NNNN sequence — a note is addressed by topic, so its kebab name is the identity, the
file name, the URL and the refs value; names shaped like record ids (`work-12`) and
Windows device names (`con`) are rejected so the three namespaces cannot collide.
(3) Agent-reachable deletion of anything else — the SPEC's delete rule is about history,
and notes sit deliberately on the other side of that line, which SPEC.md now spells out.
