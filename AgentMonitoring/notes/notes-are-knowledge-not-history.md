---
name: notes-are-knowledge-not-history
title: Notes are mutable and removable; every other record stays append-only
type: decision
description: Why note update rewrites and note remove exists, while work logs and bugs can never be removed by an agent.
agent: fable-notes-builder
updated_by: fable-human-backfill
created: 2026-08-21T02:10:00Z
updated: 2026-08-22T23:45:57Z
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

## For humans

On 21 August 2026 somebody settled how the written notes in this project may change. A note can be rewritten over the top of itself, and it can be taken away. Every other record here can only be added to — the work logs, the bug reports, the trail of events. Nothing an assistant can reach will remove one.

**Rewriting is the point, not something grudgingly allowed.** `note update` replaces a note's text outright, and `note remove` takes the note away. Either way an entry goes into the trail of events: `note_created`, `note_updated`, `note_removed`. So the fact that somebody changed it stays on the record.

**Notes that could only be added to were considered and turned down.** A hand-over note you can only append to becomes a diary, and the stale entry sitting at the top of it misleads whoever reads next. Tidying up is the feature here, not chores around the feature.

It is like a whiteboard by the door rather than the logbook in the drawer. You wipe the board when the plan changes; you never tear a page out of the logbook.

**Notes were also refused serial numbers.** The other records are numbered; a note is looked up by its subject instead. Its dashed name does every job at once. It is what you call it, the file it lives in, its web address, and the way other notes point at it.

**Two shapes of name are refused outright.** One is a name shaped like a record number, such as `work-12`. The other is a name Windows reserves for its own devices, such as `con`. So those three kinds of name can never be taken for each other.

**The line is written down, not merely agreed.** The rule against deleting history lives in `SPEC.md`, the file stating what this project must do. It now spells out that notes sit deliberately on the other side of that line. So an out-of-date note gets fixed in place, and one that would now mislead gets taken away.

A note is what is true now; a log is what happened.
