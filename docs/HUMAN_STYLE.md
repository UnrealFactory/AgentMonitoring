# The human area — explain the work and the mechanism

Writing policy v4, 2026-09-06. This document is embedded in the CLI and its compact
block is delivered by MCP. It replaces the v3 requirements for five narrative beats,
an analogy, a closing maxim, and an SVG for every paragraph. Existing records remain
valid; do not rewrite history just to give it the new shape.

<!-- compact-rules -->
The human area explains this work to someone who was not there. Use the project's language and explain necessary technical terms at first use. Name the real subject and start with the result or current state, then why it matters, how it works, and the evidence and limits the reader needs. An opening WORK states the objective and current progress, never a result that has not happened.

Record a work objective, not each conversation turn. WORK covers development, a fix, verification, or a separately assigned investigation with a deliverable and a completion condition. Ordinary questions, explanations, brainstorming and corrections of understanding create no new WORK. Continue an existing in-progress WORK for the same objective; append progress only for a material finding, decision, blocker or verification milestone. Do not append merely because you answered again. A chat ending is not completion or abandonment: unfinished work stays in progress, with a handoff if another session must continue it. Close when the objective and required checks are complete; abandon only when the work is discontinued. A closed record's factual correction starts with Correction:; a new question is not automatically a correction.

Read relevant shared notes before acting. Notes hold useful current knowledge, not a transcript of each question: update the existing topic when a fact changes, and leave it alone when nothing durable changed. A proposal is still a proposal; only adopted choices belong in a decision note. Keep the essential index short and link to the current source of each fact. A handoff names the active WORK, present state, remaining checks and next action.

Match the telling to what happened. A routine update, memory note or decision may need only one or two short paragraphs. A complex change may need several explanations. There is no required five-part story, analogy or closing lesson. Include a failed attempt only if it happened and helps explain the outcome. An analogy is optional and must not replace the mechanism. Cover every delivered change, but leave execution transcripts, exhaustive paths and repetitive test output in the technical area. Keep the identifiers needed to locate evidence, and say what each one does.

Use a visual for a central relationship, order, branch, cancellation, spatial arrangement or visible before/after change that the reader needs to understand. A short factual update does not owe a picture. Choose the form by the question: a timeline or swimlanes for order and waiting; a connection or containment diagram for relationships; before/after views for a fix; an annotated real screenshot for a screen; a table for choices; a measured plot for performance. The paragraph count does not set the picture count. A picture that only puts prose into boxes does not explain the mechanism: show the actors and the relevant links, transitions or differences. Explain what arrows, colours and dashed lines mean. Include the relevant failure or unavailable state, not only the successful end.

Keep observations, code-derived behaviour, proposals and illustrative assumptions distinct in text and image. Label a schematic or an explanatory example as such; it is not a screenshot, an execution trace or proof of an implementation. Never invent measurements, reported events, a failed attempt, a chosen design or a passed check. An example may clarify an established rule but cannot add a rule or become evidence that the feature exists. State what each check measured and what remains unchecked.

Put images under the project's assets/ and cite them as their own paragraph, with blank lines above and below: ![what the reader should learn](assets/descriptive-name.svg). Place the figure beside the explanation it supports; repeated figures for the same fact are unnecessary. SVG roots need width, height and viewBox, plus a dark background. Use meaningful shapes and free layout rather than a prescribed stack of bands. Use positive fixed root dimensions. With matching root/viewBox proportions, min(395 / viewBoxWidth, 560 / viewBoxHeight) times the effective font size must be at least 11px; otherwise measure the actual viewport transform too. Allow font fallback and leave room around labels. Prefer an overview plus a separate detail to shrinking a dense diagram. Inspect the rendered image as well as measuring it. In the AgentMonitoring source repo, check:scenes measures geometry, including drafts selected with --asset; a geometry pass does not prove an explanation is understandable.

Write short connected paragraphs. Use a bold sentence when a longer explanation needs a clear break; do not add headings just to fill a template. A ## heading is refused in the human field. A short list or comparison table is welcome when it makes the information easier to read. Stop when the useful facts are covered; 450 words is a warning ceiling for one telling, not a target or a limit on the whole record. Never cut a necessary explanation merely to fit a name count or word count.

A human beside a progress note or bug comment is appended as a dated entry. Tell only what changed in that update, without retelling the entire record. Closing also appends the ending. Human alone on an update replaces the entire human area: use that refresh deliberately, because the replaced text is not kept there. Notes are rewritten in place as current knowledge. Preserve the technical record and use tools to write records, never direct file edits.
<!-- /compact-rules -->

## Decide whether anything needs recording

The task, not the number of messages or tool calls, defines a WORK. Identify its
objective, scope and completion condition. Look for an existing in-progress WORK
with that objective. Completion can span conversations; a conversation can also
contain independent tasks. Do not reopen a completed WORK to avoid making a needed
new one for a genuinely new objective.

| Situation | Action |
|---|---|
| Someone asks how a parent reference behaves, then clarifies the relationship | Explain it. No WORK per question, and no new note for every alternative. |
| A useful fact or constraint changes during that discussion | Update the existing topic note; distinguish confirmed behaviour from an open proposal. |
| Someone explicitly assigns an engine comparison report | One investigation WORK, with the report and evidence as its completion condition. |
| Someone asks to implement an agreed readiness contract | One development WORK covering implementation and required checks. |
| The same task needs a test repair or its requested commit | Continue that WORK while it is in progress. A routine next step is not a new objective. |
| Work pauses for a later session | Leave it in progress and write a useful handoff. |
| The objective and checks are complete | Close once with the actual outcome and limits. |
| A finished record contains a factual error | Append Correction: with the specific correction. |

An essential note is a map: current state, active work and where to find authoritative
notes. It is not a copy of all past work. Search and page through the note list when
necessary, open the relevant notes, and update the one whose fact changed. Never
turn an unaccepted suggestion into a decision because a note needs a type. A
reference or handoff may explicitly hold an open question; not every question needs
persistence.

## Tell the reader what they need to understand

Start with the concrete change or current state and its consequence. Explain the
mechanism before listing inspected files. Keep full command output and exhaustive
paths in the technical area; carry the evidence needed to judge the result into the
human area too. Explain each necessary identifier once.

An opening WORK describes the intended result and present state. Progress says what
changed and whether it affects the plan. A completed fix explains the observable
problem, cause, change and relevant proof. A decision identifies the adopted choice,
scope, date and reason. Memory states the current fact and when it matters. A handoff
names the work to continue and the next useful step. These are different needs, not
five compulsory paragraphs with different titles.

Explain terms using verified sources or the ordinary purpose of a named tool; do not
invent its internals from its name. A number needs its scope and unit. A passing check
needs the question it tested. "The diagram has no overlapping labels" is narrower
than "the explanation is clear". A proposed API is not an implemented API.

Keep material limits with the result they qualify. Do not imply a check was run
because a document asks for it or the code looks plausible. Include a real failed
attempt if it explains a tradeoff; never invent one to complete a story. Optional
analogies must help explain, and never carry evidence of their own. An update may be
a single paragraph. Do not manufacture bold lead-ins, an analogy or a final maxim.

## Choose a picture by its explanatory job

The v3 rule required pictures per paragraph after agents had omitted useful diagrams.
It produced another failure: prose stacked inside identical boxes. The replacement
requires a visual for the central mechanism when the core question is about order,
interaction, branching or a visible change. A test count or updated path may be fully
explained in a sentence.

| Reader's question | What the visual should show |
|---|---|
| Which object can act first? | Actor lanes, a shared time direction, readiness, waiting and resumption. |
| Who owns or references what? | The endpoints and distinct labelled links for ownership, attachment and reference. |
| Why did this fail and how is it fixed? | Comparable before/after states with the causal difference highlighted. |
| What if the dependency vanishes? | Unavailability or cancellation and which dependent action stops. |
| Where should I click? | A real screen capture with a short annotation; label a mockup as a mockup. |
| Which option should I choose? | A table of conditions and tradeoffs. |
| Did performance improve? | Measured data, axes, units, sample conditions and uncertainty where known. |

Ask of each draft:

1. What question should the reader answer after looking?
2. Do position, links, shapes or changes carry the answer, or only copied prose?
3. Is each arrow clear about whether it means time, data, reference or action?
4. Are the relevant wait, failure, disconnection or alternative states visible?
5. Can each factual claim be traced to evidence, and are illustrative states labelled?

Several focused figures can be better than one illegible overview. Repeating the same
figure beside each update adds nothing. A relationship diagram can use simple shapes
without pretending every object is a file, folder or server. Colour reinforces
labelled state; it must not be the only cue. A comparison table is also a visual.

## Render and verify the artifact

Use `assets/<topic>-<question>.svg` or an appropriate raster format. Existing
`<record>-<beat>-<what>.svg` names remain valid. Cite an image in its own paragraph,
with blank lines above and below, near the explanation it supports. The app renders
local assets, not external image URLs or raw HTML.

An SVG root needs width, height and viewBox, for example `width="700" height="500"
viewBox="0 0 700 500"`, and an opaque dark background. The app's palette includes
`#121317` background, `#e8e9eb` primary text, `#8a8f98` supporting structure,
`#a5adf0` emphasis, `#4cb782` available/success and `#f2994a` caution. Use readable
contrast and `system-ui, "Segoe UI", sans-serif` or a suitable code font fallback.
An SVG displayed as an image does not inherit the app's bundled fonts.

There is no required stack of panels or horizontal bands. At the conservative 395px
column and 560px maximum image height, with positive fixed root dimensions whose
proportions match the viewBox, sizing is:

```text
scale = min(395 / viewBoxWidth, 560 / viewBoxHeight)
displayed label size = effective SVG font size × scale
```

When root dimensions and the viewBox have different proportions, account for the
root viewport transform and its letterboxing as well; the checker does this.
Percentage, zero and font-relative root dimensions are not a stable image size.

Keep displayed labels at least 11px, leave 14 SVG units at the outer edge, and allow
room for wider fallback fonts. Transforms change effective size too. A 22px label
on a 700-wide diagram is about 12.4px at 395px; a tall diagram may shrink further due
to the height limit. Split detail instead of reducing type. Give unfamiliar symbols
a legend and provide useful alt text.

In the AgentMonitoring source repository:

```sh
# Verify a draft before writing the record that will cite it.
node scripts/check-scenes.mjs --dir C:/path/to/project/AgentMonitoring --asset readiness.svg
# Verify all referenced diagrams afterwards.
node scripts/check-scenes.mjs --dir C:/path/to/project/AgentMonitoring
```

The checker measures bounds, fallback fonts and scaled text. It cannot judge whether
an arrow tells the truth or a reader understands the mechanism. Open the rendered
image and inspect it at the app's displayed width too. The installed CLI's doctor
checks missing human areas and malformed citations/sizes; it does not infer that
bold paragraphs require images. Without the source-repo checker, use the arithmetic
and inspect the result; do not claim the checker ran there.

## Worked examples

These examples teach content choices. They are illustrative, not test results or
claims about a project's current implementation.

### A short progress update

Technical facts: implementation is ready, focused checks pass and the required
integration check remains. The WORK is still in progress.

```md
The new parent lookup now waits until the referenced object exists. The focused
checks cover a parent that is already available and one that arrives later.
The integration check is still pending, so the task remains open.
```

No new figure is needed if the mechanism is already illustrated in the same WORK.
Do not append this again after a status question. Close only after the remaining
check is complete, reporting its actual outcome.

### A current fact and an unaccepted proposal

```md
The component's own initialization can finish before a referenced object is
available. Code inspection established these as separate conditions; it did not
verify runtime arrival order.

A callback for reference availability is under discussion. Its name and behaviour
have not been adopted, and no implementation has been made.
```

Update the existing topic note if that fact is useful later. The suggestion does
not become a decision, and the discussion does not create another WORK.

### A relationship explanation

Suppose an established contract separates each object's preparation from use of a
referenced object. A schematic should show the conditions separately:

```text
Object A: ready    - - reference unavailable - -    Object B: preparing
Object A: ready    ---- reference usable ------>    Object B: ready
Object A: remains  - - connection removed - - -     Object B: absent
```

This is a schematic of conditions, not a measured sequence or a promise that B must
prepare after A. A final SVG should show readiness and absence through state symbols
and differentiated links. Its caption states which conditions allow the connection;
its prose includes any additional execution-phase condition. An example cannot
silently remove that condition.

### A before/after explanation of a fix

For a real bug where a saved fixed time offset became stale when clocks changed,
show the earlier saved offset and the corrected rule lookup beside the same send
operation. Explain that the rule determines the offset for the send date. State
the tested dates, regions and unresolved accounts from the actual evidence. Do not
invent counts or false starts, and use a replay result as proof only if it was run.
