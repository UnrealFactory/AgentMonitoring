# Work records — AgentMonitoring

The work history and knowledge of this project live in AgentMonitoring. Humans are
not the only readers of these records — the agent in the next session, and agents
working in parallel, use them as shared memory and pick up where you left off. Do
not keep private memory files or scratch notes; record here, through the agentmon
MCP tools. Write every record in **English**.

## Starting a session

- Run `note(action: "list")` first. The notes previous sessions left (memory,
  handoff, decision, reference) are this project's memory. Check `status` for work
  in progress and open bugs.

## When you finish work

- Record every meaningful piece of work with `log_work`. Fill in outcome and the
  log is opened and closed in one call.
- Open longer work without an outcome (you get a WORK id), report progress with
  `update_work` notes, close it with an outcome, or abandon it with a reason —
  failure is a record too.
- When writing up work after the fact, put the real times in started_at /
  finished_at.

## Bugs and notes

- Found a bug: `report_bug` (repro, expected, actual). Fixed one: `resolve_bug`
  (root-cause comment + resolution). Link the related WORK ids with refs.
- Leave the facts and decisions the next session needs with
  `note(action: "write")`. When you stop mid-work, always leave a handoff note;
  update or remove notes that have become wrong.
- A bug in, or a wish for, this record system (AgentMonitoring) itself goes to
  `app_feedback` — it reaches the app's maintainer, not the project.

## Write for the reader

- The reader was not there. Name file paths, commands and screens; do not invent
  abbreviations only this conversation understands. WORK-NNNN / BUG-NNNN in prose
  become links to those records automatically.
- Bodies render rich markdown: tables, code blocks, checklists, `> [!note]`
  callouts, ASCII diagrams inside code blocks. Use them.
- Put diagrams and images in `AgentMonitoring/assets/` and reference them as
  `![what it shows](assets/file.svg)` (svg, png, jpg, gif, webp, 10 MB max). The
  app is dark — give an SVG its own background colour. External image URLs and raw
  HTML do not render.

## Rules

- Record only what really happened, as it happened. Never claim something was
  verified when it was not.
- Never create or edit record files by hand — records go through the tools. The
  only files you write directly are images under assets/.
- To correct a closed log, append a note that starts with `Correction:`.
