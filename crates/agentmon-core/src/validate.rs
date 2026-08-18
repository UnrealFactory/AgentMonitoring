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

pub const WORK_EXAMPLE: &str = r#"agentmon work start -p agent-monitoring \
  --agent cli-builder \
  --title "Implement the vault write path" \
  --tags cli,rust \
  --body "$(cat <<'EOF'
## What

Add the write half of agentmon-core: work start/update/done and the bug lifecycle,
all appending to events.jsonl.

## Why

Every record in the vault today was written by hand. Until the CLI can write, agents
cannot log their own work, which is the entire point of the product.

## How

One project-level lock file guards id allocation; record files are written to a temp
file and renamed over the target so a reader never sees a half-written record.
EOF
)""#;

pub const OUTCOME_TEMPLATE: &str = r#"What shipped (the concrete artifacts), what changed for the reader of this record,
and how it was verified — the commands you ran and what they printed."#;

pub const OUTCOME_EXAMPLE: &str = r#"agentmon work done WORK-0003 -p agent-monitoring \
  --agent cli-builder \
  --files crates/agentmon-core/src/write.rs,crates/agentmon-cli/src/main.rs \
  --outcome "$(cat <<'EOF'
Shipped the full write path: init, project create, work start/update/done and the bug
lifecycle, each appending one event to events.jsonl.

Verified: cargo test --workspace (31 passed), agentmon doctor exits 0 on the live vault,
and two concurrent `work start` runs produced WORK-0004 and WORK-0005 with no lost event.
EOF
)""#;

pub const BUG_TEMPLATE: &str = r#"## Report

What you did (numbered repro steps), what you expected, what actually happened.
Include the exact command, the error text, and where you saw it."#;

pub const BUG_EXAMPLE: &str = r#"agentmon bug create -p agent-monitoring \
  --agent cli-builder \
  --title "work done exits 0 but leaves status in_progress" \
  --severity high \
  --labels cli,data-loss \
  --body "$(cat <<'EOF'
## Report

Repro:

1. agentmon work start -p demo --agent a --title t --body "$(cat template)"
2. agentmon work done WORK-0001 -p demo --agent a --outcome "shipped it, tests green"
3. agentmon work view WORK-0001 -p demo

Expected: status is done and the frontmatter has a finished timestamp.
Actual: exit code is 0, but status is still in_progress and finished is null.
EOF
)""#;

pub const RESOLUTION_TEMPLATE: &str =
    r#"What the fix was, why it works (the root cause, not just the symptom), and how you
verified it — the command you ran and its result."#;

pub const RESOLUTION_EXAMPLE: &str = r#"agentmon bug resolve BUG-0002 -p agent-monitoring \
  --agent cli-builder \
  --resolution "$(cat <<'EOF'
Root cause: the Tauri shell never watched the vault, so the desktop app only re-read
records when a route change re-ran the loader.

Fix: src-tauri/src/lib.rs now starts a notify recommended_watcher on <vault>/projects,
debounces bursts for 250ms and emits `vault-changed` with the affected project slug —
the event `subscribeVaultChanges()` in src/lib/api.ts already listens for.

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
    Ok(text.to_string())
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
    fn start_refuses_to_carry_an_outcome() {
        let body = format!("{GOOD}\n## Outcome\n\nAlready shipped, honest.\n");
        let text = work_body(&body).unwrap_err().to_string();
        assert!(text.contains("agentmon work done"), "{text}");
    }
}
