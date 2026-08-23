---
name: event-reconciliation
title: The nine work_updated events with no progress note, and why they stay
type: decision
description: Accounts for the 9 orphaned work_updated events in events.jsonl; doctor reads the WORK-NNNN@ts list here. Read before touching events.jsonl or the activity feed.
agent: d6-final-gate-builder
updated_by: null
created: 2026-08-23T10:34:15Z
updated: 2026-08-23T10:34:15Z
tags: []
refs: [WORK-0059, WORK-0066, WORK-0068, WORK-0069, WORK-0070, WORK-0071, WORK-0072, WORK-0073, WORK-0075]
---

Nine `work_updated` events in `events.jsonl` announce a progress note that their work log does not contain. They are accounted for here: `agentmon doctor` reads this note, pairs each `WORK-NNNN@<ts>` listed below against the orphans it finds, and reports those as reconciled instead of as errors. Nothing else in the file is exempt, and nothing wider than an exact `ref@ts` is accepted.

## The nine

- WORK-0071@2026-08-23T08:05:35Z
- WORK-0068@2026-08-23T08:07:17Z
- WORK-0059@2026-08-23T08:13:28Z
- WORK-0066@2026-08-23T08:13:28Z
- WORK-0069@2026-08-23T08:13:28Z
- WORK-0070@2026-08-23T08:13:28Z
- WORK-0072@2026-08-23T08:13:39Z
- WORK-0073@2026-08-23T08:13:39Z
- WORK-0075@2026-08-23T08:13:39Z

All nine carry `actor: fable-human-backfill` and a `summary` opening `Human area: `.

## What happened: the record half was never written

`write.rs` emits `EV_WORK_UPDATED` only inside the `Some(note)` branch of `update_work`, and that branch calls `body::append_entry(.., "Updates", ..)` first. The event and the `### <ts>` entry are written together or not at all, so this shape is unreachable through the CLI. The evidence says the entries never existed rather than that they were stripped:

- Seven of the nine work logs (0066, 0068, 0070, 0071, 0072, 0073, 0075) were created in commit 07b3f9c and carry no `## Updates` section in any committed state.
- WORK-0059 has no `## Updates` section in 07b3f9c or in its parent.
- WORK-0069 holds exactly one entry, `2026-08-22T13:40:00Z` by `d3-human-view-builder`, unchanged across 07b3f9c. A strip would have had to remove the new entry and leave the old one untouched.
- Four events share the second `2026-08-23T08:13:28Z` and three share `2026-08-23T08:13:39Z`. Each `agentmon work update` is one process that takes the project lock and stamps its own now.
- The same actor logged 381 `human_updated` events in the same sweep, including WORK-0014 at 08:13:20Z and WORK-0015 at 08:13:49Z, eight seconds either side of the orphan run.
- Every summary describes a human-area sweep. Per SPEC that is what `human_updated` records; `work_updated` is a progress note.

Read together: the backfill rewrote the human areas of these nine records, and that work is real and present in each record's `## For humans`. What is wrong is the event type on nine of the lines it logged, and the missing `## Updates` entry that a genuine `work_updated` would have been written beside.

## Why the entries were not restored

The note text is gone. All nine summaries run 152 to 160 characters, cut on a word boundary with a trailing ellipsis: the shape `body::excerpt(text, 160)` produces, so a longer text existed. It survives nowhere else in this repo. Searching `AgentMonitoring/`, `progress/`, `docs/`, `scripts/` and `.tmp-restore/` for any of their opening phrases matches `events.jsonl` and nothing else.

Writing a truncated summary into a live record as though it were the note would put invented history into the corpus, which CLAUDE.md forbids outright. Backdating a fresh note with `--at` would stamp today's words `2026-08-23T08:13:28Z` and emit a second event at that same timestamp, leaving two events for one entry. Neither is a repair, so the events stand and this note carries the explanation.

## What the app still shows

`src/lib/dashboard.ts` buckets `work_updated` into `recent.notes` (rendered "updates" / "진행 노트"), and the activity feed renders the verb as "posted an update on". While these nine sit inside the feed's window, that count is nine higher than the number of progress notes the records hold. `agentmon doctor` prints the nine on every run for the same reason: accounted for is not the same as gone.

## Adding to this list

One line per orphan, exactly `WORK-NNNN@<ISO8601>`, and a sentence saying what happened to it. If a missing note is real and its text survives, post it with `agentmon work update <id> --agent <you> --at <ts> --message "…"` instead. It belongs in the record, not here.

## For humans

This app's dashboard keeps a running count of progress notes, the short updates an agent writes onto a job while the work is still going. On 23 August someone checked that count against the jobs themselves and found nine it could not account for: nine lines in `events.jsonl`, the file that records everything that happens in this project, each announcing an update to a job that carries no such update.

**A batch run wrote those nine lines, and the app did not.** The run was `fable-human-backfill`, a sweep that went through every record adding a plain-English retelling for readers who do not program. It logged 381 of those retellings under the right name. On nine it used the name the app reserves for a progress note, and a progress note is the one kind of line the app never writes on its own: it writes the note into the job file in the same breath. It is like a receipt printed without the sale being rung up.

**The obvious repair would have been an invention.** Each of the nine lines keeps the first 160 characters of what was written, cut off mid-sentence. Copying that fragment into the job file would look like a fix, but nobody knows what the rest of it said, and the rule here is that live records never carry made-up history. So the nine stay where they are and this note says why they are there.

**Seven of the nine jobs have never had an update section at all**, in any saved version of the file, going back to the day they were created. Four of the nine lines share one second, which commands run one at a time cannot produce. That is how we know the notes were never written rather than deleted later.

**`agentmon doctor`, the command that checks this project for damage, can now see this.** It compares every progress-note line against the job it names and fails on any it cannot match. It could not do that before, and it printed "No problems found" over all nine.

If the count of updates and the updates you can actually open ever disagree again, doctor will say so before a person has to notice.
