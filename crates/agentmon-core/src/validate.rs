//! Content validation: the reason a record written by an agent is worth reading later.
//!
//! SPEC.md fixes the shape (`## What` / `## Why` / `## How`, `## Outcome` on done,
//! `## Report` on a bug, `## Resolution` on resolve). This module enforces that shape and
//! — just as importantly — rejects the placeholder text agents reach for when they are in
//! a hurry ("TODO", "n/a", "fixed"). A rejection always carries the template and a
//! working example, so the next attempt succeeds without guessing.

use crate::body;
use crate::error::{BodyRejection, CoreError, Result};
use crate::model::Section;

/// Canonical section order in a work log.
pub const WORK_SECTIONS: &[&str] = &["What", "Why", "How", "Updates", "Outcome"];
/// Canonical section order in a bug.
pub const BUG_SECTIONS: &[&str] = &["Report", "Comments", "Resolution"];

/// Minimum real content per section. Low enough that any honest sentence passes, high
/// enough that "TODO" and "wip" do not.
const MIN_SECTION: usize = 12;
const MIN_OUTCOME: usize = 24;
const MIN_REPORT: usize = 24;
const MIN_RESOLUTION: usize = 24;
const MIN_NOTE_BODY: usize = 12;
/// A description is the line every list shows; longer than this and it is a paragraph
/// that belongs in the body.
const MAX_DESCRIPTION: usize = 200;

/// Words that are never an acceptable whole answer.
const PLACEHOLDERS: &[&str] = &[
    "todo", "tbd", "n/a", "na", "none", "-", "--", "...", "wip", "fixed", "done", "x", "?",
    "later", "see above", "same", "lorem ipsum", "placeholder", "asdf", "test",
];

pub const WORK_TEMPLATE: &str = r#"## What

One or two paragraphs: what you are building or changing, concretely enough that a
reader can picture the diff. Name files, commands, screens.

## Why

The reason this work exists: the problem, the constraint, the alternative you rejected.
A reader who disagrees with the change should still understand the reasoning.

## How

The approach: the design you chose, the tricky parts, anything a reviewer would
otherwise have to reverse-engineer from the code."#;

pub const WORK_EXAMPLE: &str = r#"agentmon work start \
  --agent cli-builder \
  --title "Implement the record write path" \
  --tags cli,rust \
  --body "$(cat <<'EOF'
## What

Add the write half of agentmon-core: work start/update/done and the bug lifecycle,
all appending to events.jsonl.

## Why

Every record in this project today was written by hand. Until the CLI can write, agents
cannot log their own work, which is the entire point of the product.

## How

One project-level lock file guards id allocation; record files are written to a temp
file and renamed over the target so a reader never sees a half-written record.
EOF
)""#;

pub const OUTCOME_TEMPLATE: &str = r#"What shipped (the concrete artifacts), what changed for the reader of this record,
and how it was verified — the commands you ran and what they printed."#;

pub const OUTCOME_EXAMPLE: &str = r#"agentmon work done WORK-0003 \
  --agent cli-builder \
  --files crates/agentmon-core/src/write.rs,crates/agentmon-cli/src/main.rs \
  --outcome "$(cat <<'EOF'
Shipped the full write path: init, work start/update/done and the bug lifecycle, each
appending one event to events.jsonl.

Verified: cargo test --workspace (31 passed), agentmon doctor exits 0 on the live
project, and two concurrent `work start` runs produced WORK-0004 and WORK-0005 with no
lost event.
EOF
)""#;

pub const BUG_TEMPLATE: &str = r#"## Report

What you did (numbered repro steps), what you expected, what actually happened.
Include the exact command, the error text, and where you saw it."#;

pub const BUG_EXAMPLE: &str = r#"agentmon bug create \
  --agent cli-builder \
  --title "work done exits 0 but leaves status in_progress" \
  --severity high \
  --labels cli,data-loss \
  --body "$(cat <<'EOF'
## Report

Repro:

1. agentmon work start --agent a --title t --body "$(cat template)"
2. agentmon work done WORK-0001 --agent a --outcome "shipped it, tests green"
3. agentmon work view WORK-0001

Expected: status is done and the frontmatter has a finished timestamp.
Actual: exit code is 0, but status is still in_progress and finished is null.
EOF
)""#;

pub const RESOLUTION_TEMPLATE: &str =
    r#"What the fix was, why it works (the root cause, not just the symptom), and how you
verified it — the command you ran and its result."#;

pub const RESOLUTION_EXAMPLE: &str = r#"agentmon bug resolve BUG-0002 \
  --agent cli-builder \
  --resolution "$(cat <<'EOF'
Root cause: the Tauri shell never watched the project folder, so the desktop app only
re-read records when a route change re-ran the loader.

Fix: src-tauri/src/lib.rs now starts a notify recommended_watcher on each registered
AgentMonitoring folder, debounces bursts for 250ms and emits `project-changed` with the
project id — the event `subscribeProjectChanges()` in src/lib/api.ts already listens for.

Verified: cargo check -p agentmonitoring is clean; with the app open, `agentmon work
update ...` in another terminal refreshed the dashboard without navigation.
EOF
)""#;

fn reject(
    subject: &str,
    problems: Vec<String>,
    template: &str,
    example: &str,
) -> CoreError {
    CoreError::InvalidBody(Box::new(BodyRejection {
        subject: subject.to_string(),
        problems,
        template: template.to_string(),
        example: example.to_string(),
    }))
}

/// Content that is present but says nothing.
fn is_placeholder(text: &str) -> bool {
    let flat = text
        .trim()
        .trim_end_matches(['.', '!', ','])
        .to_ascii_lowercase();
    PLACEHOLDERS.iter().any(|p| flat == *p)
}

fn meaningful_len(text: &str) -> usize {
    text.split_whitespace().collect::<Vec<_>>().join(" ").len()
}

/// The sections of a validated work-log body, ready to render.
#[derive(Debug, Clone)]
pub struct WorkBody {
    pub sections: Vec<Section>,
}

/// Validate the `--body` of `work start`: `## What`, `## Why`, `## How` must all be
/// present and actually say something. Extra sections are kept in place.
pub fn work_body(raw: &str) -> Result<WorkBody> {
    let mut problems: Vec<String> = Vec::new();
    let text = raw.trim();

    if text.is_empty() {
        return Err(reject(
            "work log body",
            vec!["the body is empty".into()],
            WORK_TEMPLATE,
            WORK_EXAMPLE,
        ));
    }

    let sections = body::sections(text);
    let has_any_heading = sections.iter().any(|s| !s.title.is_empty());
    if !has_any_heading {
        return Err(reject(
            "work log body",
            vec![
                "no `## ` headings found — the body must be markdown with the three required sections"
                    .into(),
                format!(
                    "got instead: {:?}",
                    crate::body::excerpt(text, 80)
                ),
            ],
            WORK_TEMPLATE,
            WORK_EXAMPLE,
        ));
    }

    for name in ["What", "Why", "How"] {
        let mut probe = sections.clone();
        match body::take_section(&mut probe, name) {
            None => problems.push(format!("missing the `## {name}` section")),
            Some(content) if content.trim().is_empty() => {
                problems.push(format!("`## {name}` is empty"))
            }
            Some(content) if is_placeholder(&content) => problems.push(format!(
                "`## {name}` says only {:?} — write the real answer",
                content.trim()
            )),
            Some(content) if meaningful_len(&content) < MIN_SECTION => problems.push(format!(
                "`## {name}` has {} characters of content; write at least {MIN_SECTION}",
                meaningful_len(&content)
            )),
            Some(_) => {}
        }
    }

    // `## Outcome` is written by `work done`; accepting one at start would let a record
    // claim an outcome it does not have yet.
    let mut probe = sections.clone();
    if let Some(o) = body::take_section(&mut probe, "Outcome") {
        if !o.trim().is_empty() {
            problems.push(
                "the body contains `## Outcome` — outcomes are written by `agentmon work done`, \
                 not at start"
                    .into(),
            );
        }
    }

    if problems.is_empty() {
        Ok(WorkBody { sections })
    } else {
        Err(reject("work log body", problems, WORK_TEMPLATE, WORK_EXAMPLE))
    }
}

/// Validate `--outcome`. A bare `## Outcome` heading in the text is accepted and
/// unwrapped, so passing the same file to `--outcome-file` twice behaves the same way.
pub fn outcome(raw: &str) -> Result<String> {
    let text = unwrap_section(raw, "Outcome");
    reject_section_headings(&text, "outcome", OUTCOME_TEMPLATE, OUTCOME_EXAMPLE)?;
    check_prose(
        &text,
        "outcome",
        MIN_OUTCOME,
        OUTCOME_TEMPLATE,
        OUTCOME_EXAMPLE,
    )
}

/// Validate the `--body` of `bug create`. Prose without headings is accepted and becomes
/// the `## Report` section; a body that already has `## Report` keeps its own structure.
pub fn bug_body(raw: &str) -> Result<Vec<Section>> {
    let text = raw.trim();
    if text.is_empty() {
        return Err(reject(
            "bug report",
            vec!["the body is empty".into()],
            BUG_TEMPLATE,
            BUG_EXAMPLE,
        ));
    }
    let mut sections = body::sections(text);
    let has_report = {
        let mut probe = sections.clone();
        body::take_section(&mut probe, "Report").is_some()
    };
    if !has_report {
        // Plain prose: wrap it. Any `##` sections the author did write are preserved
        // after the report.
        let lead = if sections.first().map(|s| s.title.is_empty()).unwrap_or(false) {
            sections.remove(0).body
        } else {
            String::new()
        };
        if lead.trim().is_empty() {
            return Err(reject(
                "bug report",
                vec![format!(
                    "no `## Report` section, and nothing before the first heading to use as one"
                )],
                BUG_TEMPLATE,
                BUG_EXAMPLE,
            ));
        }
        sections.insert(
            0,
            Section {
                title: "Report".into(),
                body: lead.trim().to_string(),
            },
        );
    }

    let report = {
        let mut probe = sections.clone();
        body::take_section(&mut probe, "Report").unwrap_or_default()
    };
    check_prose(&report, "bug report", MIN_REPORT, BUG_TEMPLATE, BUG_EXAMPLE)?;

    let mut probe = sections.clone();
    if let Some(r) = body::take_section(&mut probe, "Resolution") {
        if !r.trim().is_empty() {
            return Err(reject(
                "bug report",
                vec![
                    "the body contains `## Resolution` — resolutions are written by \
                     `agentmon bug resolve`, not when filing"
                        .into(),
                ],
                BUG_TEMPLATE,
                BUG_EXAMPLE,
            ));
        }
    }

    Ok(sections)
}

/// Validate `--resolution`.
pub fn resolution(raw: &str) -> Result<String> {
    let text = unwrap_section(raw, "Resolution");
    reject_section_headings(&text, "resolution", RESOLUTION_TEMPLATE, RESOLUTION_EXAMPLE)?;
    check_prose(
        &text,
        "resolution",
        MIN_RESOLUTION,
        RESOLUTION_TEMPLATE,
        RESOLUTION_EXAMPLE,
    )
}

/// Validate a `work update` / `bug comment` message. Short is fine here — "the watcher
/// fires twice per save" is a legitimate progress note — but empty is not.
pub fn note(raw: &str, subject: &str, example: &str) -> Result<String> {
    let text = raw.trim();
    if text.is_empty() {
        return Err(reject(
            subject,
            vec!["the message is empty".into()],
            "A sentence or two: what changed since the last note, what you learned,\nwhat you are doing next.",
            example,
        ));
    }
    if is_placeholder(text) {
        return Err(reject(
            subject,
            vec![format!("the message says only {text:?}")],
            "A sentence or two: what changed since the last note, what you learned,\nwhat you are doing next.",
            example,
        ));
    }
    // A note lands under `### <timestamp>` inside `## Updates` / `## Comments`; a `##` in it
    // would end that section and orphan every note written after it.
    reject_section_headings(
        text,
        subject,
        "A sentence or two: what changed since the last note, what you learned,\nwhat you are doing next.",
        example,
    )?;
    Ok(text.to_string())
}

pub const NOTE_TEMPLATE: &str = r#"Free-form markdown — a note has no mandated sections. Write what a future agent
(or the human) needs: the fact and why it matters, the handoff state and what to do
first, the decision and what was rejected, or the link and what it is for."#;

pub const NOTE_EXAMPLE: &str = r#"agentmon note add \
  --agent cli-builder \
  --type memory \
  --title "Gate scripts must sandbox the registry" \
  --description "Any script that runs agentmon init must set AGENTMON_REGISTRY_DIR to a scratch dir." \
  --tags gates,registry \
  --body "$(cat <<'EOF'
`agentmon init` registers the new project in ~/.AgentMonitoring/registry.json, best
effort. A gate script that inits a temp fixture therefore bookmarks that fixture in the
real user registry unless it points AGENTMON_REGISTRY_DIR at a scratch directory first.

Every repo gate does this now — check before adding a new one.
EOF
)""#;

/// Validate a note body: free-form markdown, but it must actually say something.
/// Unlike an outcome or a resolution, `##` headings are welcome — a note is a whole
/// document, not text inside someone else's section.
pub fn note_body(raw: &str) -> Result<String> {
    check_prose(raw, "note body", MIN_NOTE_BODY, NOTE_TEMPLATE, NOTE_EXAMPLE)
}

/// Validate a note description: the one line every list shows, and the hook an agent
/// scans to decide whether the body is worth opening.
pub fn note_description(raw: &str) -> Result<String> {
    let text = raw.trim();
    let mut problems: Vec<String> = Vec::new();
    if text.is_empty() {
        problems.push("the description is empty".into());
    } else if is_placeholder(text) {
        problems.push(format!("the description says only {text:?} — write the real hook"));
    } else if text.contains('\n') {
        problems.push(
            "the description spans multiple lines — keep it to one; detail goes in the body"
                .into(),
        );
    } else if text.chars().count() > MAX_DESCRIPTION {
        problems.push(format!(
            "the description is {} characters; the limit is {MAX_DESCRIPTION} — it is a \
             list line, not a paragraph",
            text.chars().count()
        ));
    }
    if problems.is_empty() {
        Ok(text.to_string())
    } else {
        Err(reject(
            "note description",
            problems,
            "One line: what this note knows and when to read it, e.g.\n\
             \"Any script that runs agentmon init must set AGENTMON_REGISTRY_DIR.\"",
            NOTE_EXAMPLE,
        ))
    }
}

fn check_prose(
    text: &str,
    subject: &str,
    min: usize,
    template: &str,
    example: &str,
) -> Result<String> {
    let t = text.trim();
    let mut problems = Vec::new();
    if t.is_empty() {
        problems.push(format!("the {subject} is empty"));
    } else if is_placeholder(t) {
        problems.push(format!("the {subject} says only {t:?} — write the real answer"));
    } else if meaningful_len(t) < min {
        problems.push(format!(
            "the {subject} has {} characters of content; write at least {min} — say what \
             changed and how it was verified",
            meaningful_len(t)
        ));
    }
    if problems.is_empty() {
        Ok(t.to_string())
    } else {
        Err(reject(subject, problems, template, example))
    }
}

/// Refuse text that would break out of the section it is being written into.
///
/// An outcome, a resolution, an update note and a bug comment are all *inside* a section of
/// the record: `## Outcome`, `## Resolution`, `## Updates`. A `##` heading in that text does
/// not become a sub-heading — it ends the section and starts a sibling one, so the record
/// lands with an empty `## Resolution` followed by loose `## Root cause` / `## Fix`
/// sections. The write succeeds, the app renders the resolution as blank, and
/// `agentmon doctor` reports the record as broken (vault BUG-0015 did exactly this).
///
/// The house style for these labels is a bold lead-in, which every screen in the app turns
/// into a landmark with its own anchor and contents row; `###` also works. Both are in the
/// message, because the fix has to be obvious from the error alone.
fn reject_section_headings(
    text: &str,
    subject: &str,
    template: &str,
    example: &str,
) -> Result<()> {
    let titles: Vec<String> = body::sections(text)
        .into_iter()
        .filter(|s| !s.title.is_empty())
        .map(|s| s.title)
        .collect();
    if titles.is_empty() {
        return Ok(());
    }
    let first = &titles[0];
    Err(reject(
        subject,
        vec![format!(
            "the {subject} contains the level-2 heading{} {} — a `##` heading ends the \
             section this text is written into, which would leave the record with an empty \
             one. Write the label as `**{first}.**` (the style every record in this vault \
             uses, and what the app turns into a navigable landmark) or demote it to `###`",
            if titles.len() == 1 { "" } else { "s" },
            titles
                .iter()
                .map(|t| format!("`## {t}`"))
                .collect::<Vec<_>>()
                .join(", ")
        )],
        template,
        example,
    ))
}

/// If the text is exactly one `## <name>` section, return its body; otherwise return the
/// text unchanged.
fn unwrap_section(raw: &str, name: &str) -> String {
    let text = raw.trim();
    let mut secs = body::sections(text);
    secs.retain(|s| !(s.title.is_empty() && s.body.trim().is_empty()));
    if secs.len() == 1 {
        if let Some(inner) = body::take_section(&mut secs, name) {
            return inner.trim().to_string();
        }
    }
    text.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = "## What\n\nAdd the write path to agentmon-core.\n\n## Why\n\nAgents cannot log their own work until the CLI can write records.\n\n## How\n\nA project lock guards id allocation; records are written temp-then-rename.\n";

    #[test]
    fn accepts_a_real_body() {
        let parsed = work_body(GOOD).expect("valid body");
        assert_eq!(parsed.sections.len(), 3);
    }

    #[test]
    fn rejects_missing_sections_and_shows_the_template() {
        let err = work_body("## What\n\nSomething real happened here.\n").unwrap_err();
        let text = err.to_string();
        assert!(text.contains("missing the `## Why` section"), "{text}");
        assert!(text.contains("missing the `## How` section"), "{text}");
        assert!(text.contains("## What"), "template is printed: {text}");
        assert!(text.contains("agentmon work start"), "example is printed: {text}");
    }

    #[test]
    fn rejects_placeholder_content() {
        let body = "## What\n\nTODO\n\n## Why\n\nn/a\n\n## How\n\nSomething genuinely explanatory.\n";
        let text = work_body(body).unwrap_err().to_string();
        assert!(text.contains("`## What` says only"), "{text}");
        assert!(text.contains("`## Why` says only"), "{text}");
    }

    #[test]
    fn rejects_prose_without_headings() {
        let text = work_body("I added the write path and it works fine now.")
            .unwrap_err()
            .to_string();
        assert!(text.contains("no `## ` headings found"), "{text}");
    }

    #[test]
    fn outcome_unwraps_its_own_heading() {
        let o = outcome("## Outcome\n\nShipped the write path; cargo test --workspace is green.")
            .unwrap();
        assert!(o.starts_with("Shipped"), "{o}");
        assert!(outcome("done").is_err());
        assert!(outcome("").is_err());
    }

    /// vault BUG-0015: a resolution written with `## Root cause` / `## Fix` headings was
    /// accepted, and left the record with an empty `## Resolution` and loose sections after
    /// it — a write that succeeded and produced a broken record.
    #[test]
    fn rejects_a_resolution_that_would_break_out_of_its_section() {
        let text = resolution(
            "## Root cause\n\nThe watcher fired on directory events.\n\n\
             ## Fix\n\nFilter them out and debounce the rest.\n",
        )
        .unwrap_err()
        .to_string();
        assert!(text.contains("`## Root cause`"), "{text}");
        assert!(text.contains("`## Fix`"), "{text}");
        assert!(text.contains("**Root cause.**"), "says what to write instead: {text}");

        // The house style, and a demoted heading, both pass.
        assert!(resolution(
            "**Root cause.** The watcher fired on directory events, three times per save.\n\n\
             **Verified.** cargo test -p agentmonitoring is green, and one save now reloads once."
        )
        .is_ok());
        assert!(resolution(
            "### Root cause\n\nThe watcher fired on directory events, three times per save, \
             which the debounce window never saw."
        )
        .is_ok());
        // …and so does a body that is exactly the `## Resolution` section, which is unwrapped.
        assert!(resolution(
            "## Resolution\n\nFiltered directory events out of the watcher; one save now \
             produces exactly one refresh."
        )
        .is_ok());
    }

    #[test]
    fn rejects_an_outcome_or_note_that_would_break_out_of_its_section() {
        assert!(outcome(
            "## Shipped\n\nThe write path, the doctor and the manual, with tests for each."
        )
        .unwrap_err()
        .to_string()
        .contains("`## Shipped`"));
        assert!(note("## Progress\n\nHalf of it is done.", "note", "agentmon work update …")
            .unwrap_err()
            .to_string()
            .contains("`## Progress`"));
    }

    #[test]
    fn bug_body_wraps_plain_prose_as_report() {
        let secs = bug_body("Running `agentmon doctor` on an empty vault panics instead of \
                             printing a message.")
            .unwrap();
        assert_eq!(secs[0].title, "Report");
        assert!(secs[0].body.contains("panics"));
    }

    #[test]
    fn bug_body_keeps_an_explicit_report_and_extra_sections() {
        let secs = bug_body(
            "## Report\n\nThe watcher fires twice for one save, so the UI reloads twice.\n\n\
             ## Environment\n\nWindows 11, notify 8.2.\n",
        )
        .unwrap();
        assert_eq!(secs.len(), 2);
        assert_eq!(secs[1].title, "Environment");
    }

    #[test]
    fn note_bodies_are_free_form_but_not_empty_or_placeholder() {
        assert!(note_body("The registry env var must point at a scratch dir in gates.").is_ok());
        assert!(
            note_body("## State\n\nP13 list page done.\n\n## Next\n\nWire the detail page.").is_ok(),
            "headings are allowed — a note is a whole document"
        );
        assert!(note_body("").is_err());
        assert!(note_body("TODO").is_err());
        let text = note_body("wip").unwrap_err().to_string();
        assert!(text.contains("agentmon note add"), "example is printed: {text}");
    }

    #[test]
    fn note_descriptions_are_one_real_line() {
        assert!(note_description("Any gate running `agentmon init` must sandbox the registry.").is_ok());
        assert!(note_description("").is_err());
        assert!(note_description("n/a").is_err());
        assert!(note_description("two\nlines").is_err());
        assert!(note_description(&"long ".repeat(50)).is_err());
    }

    #[test]
    fn start_refuses_to_carry_an_outcome() {
        let body = format!("{GOOD}\n## Outcome\n\nAlready shipped, honest.\n");
        let text = work_body(&body).unwrap_err().to_string();
        assert!(text.contains("agentmon work done"), "{text}");
    }
}
