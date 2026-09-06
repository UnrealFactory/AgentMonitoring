<!-- agentmon:instructions version=2 lang=en -->
# Work records — AgentMonitoring

AgentMonitoring holds this project's development history and shared memory.
Agents in later sessions and parallel agents read these records too. Use agentmon
MCP tools instead of private memory files or scratch notes. Write every record in **English**.

## Read memory before starting

- Run `note(action: "list")` first and read the essential index. Check `status`
  for work in progress and open bugs, then search and read notes relevant to this
  topic. When continuing a conversation, first check existing facts, decisions and unfinished WORK.
- Keep the essential index focused on current state and links to relevant notes.
  Detailed history belongs in WORK; current knowledge belongs in topic notes.

## A WORK is an independent task, not a conversation

- Open a WORK with its **objective, scope and completion criteria** when starting
  development, fixes or verification. A separately assigned investigation or
  comparison with its own deliverable also qualifies. For a short task already
  finished, fill in outcome in `log_work` to record it in one call.
- Questions, explanations, ideas, corrections of understanding and ending a chat
  do not justify a new WORK or a progress entry. Do not split everyday discussion
  such as investigation → proposal → user correction into separate completed WORKs.
  Do not rewrite notes either when no fact has changed.
- Continue the existing **unfinished WORK** for implementation, verification and
  follow-up fixes serving the same objective. Open long work without an outcome;
  use `update_work` notes only for significant implementation results, verification
  or plan changes. Close it with an outcome when its completion criteria are met.
  Do not reopen completed WORK; link a separate follow-up task to it with refs.
- A session change or temporary pause leaves the WORK `in_progress`; leave a
  handoff with current state, remaining work and the next action. Use abandon
  with a reason only for permanent discontinuation. For records written later,
  put the real times in started_at / finished_at.

## Maintain bugs and memory

- Use `report_bug` (repro, expected, actual) for bugs and `resolve_bug` (root-cause
  comment + resolution) for fixes. Link related WORK ids with refs.
- When a fact needed in future sessions changes, update the existing topic note
  using `note(action: "write")`. Distinguish verified facts, proposals under
  consideration and adopted decisions. Use **decision only for adopted decisions**.
  Update or remove notes that are wrong.
- Bugs or feature suggestions about AgentMonitoring itself go to `app_feedback`.

## Write for someone who was not there

- Explain what changed and why first. Name file paths, commands and screens as
  specifically as the reader needs. WORK-NNNN / BUG-NNNN become record links automatically.
- Use a visual to explain a difficult relationship, sequence or change. Do not
  match pictures to paragraph counts or move explanatory sentences into boxes.
  Choose a timeline for order, connections for structure, before/after for change,
  annotations for screens or a table for choices. Check that the central relationship
  remains visible without the sentences. Simple facts need only brief prose or a table.
- Put image files in `AgentMonitoring/assets/` and reference them as
  `![what it shows](assets/file.svg)` (svg, png, jpg, gif, webp, 10 MB max).
  Give SVGs a background colour and width, height and viewBox attributes.
  External image URLs and raw HTML do not render.

## Rules

- Record only what really happened. Never claim a check ran when it did not.
- Never create or edit AgentMonitoring record files by hand. Records go through
  the tools; within that data folder, only images under assets/ may be written directly.
- To correct a closed log, append a note that starts with `Correction:`.
<!-- /agentmon:instructions -->
