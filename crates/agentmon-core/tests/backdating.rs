//! Recording things after they happened: `--started-at` / `--finished-at` / `--at` /
//! `--created-at`, `work abandon`, and `project update`.
//!
//! The rule under test is one sentence: a backdated mutation writes the time the agent
//! gave into the record **and** into `events.jsonl`, or it writes nothing at all.

use std::fs;
use std::path::PathBuf;

use agentmon_core::doctor;
use agentmon_core::{
    AbandonWork, FinishWork, NewBug, NewProject, ProjectStatus, Severity, StartWork, UpdateProject,
    Vault, WorkStatus,
};

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

struct TempVault {
    dir: PathBuf,
    vault: Vault,
}

impl TempVault {
    fn new(tag: &str) -> TempVault {
        let dir = std::env::temp_dir().join(format!(
            "agentmon-backdate-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let vault = Vault::init(&dir, "Test vault").expect("init");
        vault
            .create_project(&NewProject {
                slug: "demo".into(),
                name: "Demo".into(),
                description: "A project used by the agentmon-core tests.".into(),
                tags: vec!["test".into()],
                actor: "test-runner".into(),
                at: None,
            })
            .expect("create project");
        TempVault { dir, vault }
    }
}

impl Drop for TempVault {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

const BODY: &str = "## What\n\nRecord work in the vault after it is already finished.\n\n\
## Why\n\nAgents write the log at the end of a task, so a CLI that can only stamp `now` \
produces a vault where every record looks like it took a second.\n\n## How\n\nEvery \
mutation takes an optional timestamp, validated against the state it follows.\n";

const OUTCOME: &str = "Shipped --started-at/--finished-at/--at across the write path; \
cargo test --workspace is green and agentmon doctor reports no problems.";

const REPORT: &str = "## Report\n\nRepro: run `agentmon work start` an hour after starting \
the work.\n\nExpected: a way to say when it really began.\nActual: `started` is always now.\n";

const T0: &str = "2026-08-18T09:12:00Z"; // started
const T1: &str = "2026-08-18T10:05:00Z"; // a progress note
const T2: &str = "2026-08-18T11:30:00Z"; // finished

fn start_at(tv: &TempVault, when: Option<&str>) -> String {
    tv.vault
        .start_work(
            "demo",
            &StartWork {
                agent: "cli-builder".into(),
                title: "Record work that was already finished".into(),
                body: BODY.into(),
                started_at: when.map(str::to_string),
                ..Default::default()
            },
        )
        .expect("work start")
        .id
}

fn finish(
    tv: &TempVault,
    id: &str,
    finished_at: Option<&str>,
    started_at: Option<&str>,
) -> agentmon_core::Result<()> {
    tv.vault
        .finish_work(
            "demo",
            id,
            &FinishWork {
                agent: "cli-builder".into(),
                outcome: OUTCOME.into(),
                finished_at: finished_at.map(str::to_string),
                started_at: started_at.map(str::to_string),
                ..Default::default()
            },
        )
        .map(|_| ())
}

fn event_ts(tv: &TempVault, event_type: &str) -> String {
    tv.vault
        .events("demo", None)
        .unwrap()
        .into_iter()
        .find(|e| e.event_type == event_type)
        .unwrap_or_else(|| panic!("{event_type} was logged"))
        .ts
}

// ---------------------------------------------------------------------------
// work
// ---------------------------------------------------------------------------

#[test]
fn work_finished_earlier_can_be_recorded_now() {
    let tv = TempVault::new("work");
    let id = start_at(&tv, Some(T0));
    tv.vault
        .update_work(
            "demo",
            &id,
            "cli-builder",
            "Halfway: the parser round-trips, the writer still drops unknown keys.",
            Some(T1),
        )
        .unwrap();
    finish(&tv, &id, Some(T2), None).unwrap();

    let d = tv.vault.worklog("demo", &id).unwrap();
    assert_eq!(d.meta.started, T0, "the start the agent gave is what is stored");
    assert_eq!(d.meta.finished.as_deref(), Some(T2));
    assert_eq!(d.updates[0].ts, T1);
    assert_eq!(d.last_activity, T2);

    // the event log agrees, so the activity feed is not a lie
    assert_eq!(event_ts(&tv, "work_started"), T0);
    assert_eq!(event_ts(&tv, "work_updated"), T1);
    assert_eq!(event_ts(&tv, "work_done"), T2);
    let order: Vec<String> = tv
        .vault
        .events("demo", None)
        .unwrap()
        .into_iter()
        .filter(|e| e.event_type.starts_with("work_"))
        .map(|e| e.event_type)
        .collect();
    assert_eq!(order, ["work_done", "work_updated", "work_started"], "newest first");
    assert_eq!(doctor::check(&tv.vault).unwrap().errors(), 0);
}

#[test]
fn odd_timestamp_spellings_are_normalized_to_one_shape() {
    let tv = TempVault::new("formats");
    for spelling in [
        "2026-08-18T09:12:00Z",
        "2026-08-18 09:12",
        "2026-08-18T09:12:00.500Z",
        "2026-08-18T11:12:00+02:00",
    ] {
        let id = start_at(&tv, Some(spelling));
        assert_eq!(
            tv.vault.worklog("demo", &id).unwrap().meta.started,
            T0,
            "{spelling}"
        );
    }
}

#[test]
fn a_timestamp_that_will_not_parse_names_the_flag_and_the_forms() {
    let tv = TempVault::new("parse");
    let err = tv
        .vault
        .start_work(
            "demo",
            &StartWork {
                agent: "cli-builder".into(),
                title: "Yesterday".into(),
                body: BODY.into(),
                started_at: Some("yesterday afternoon".into()),
                ..Default::default()
            },
        )
        .unwrap_err();
    assert_eq!(err.kind(), "invalid_argument");
    let text = err.to_string();
    assert!(text.contains("--started-at"), "{text}");
    assert!(text.contains("2026-08-18T09:12:00Z"), "shows the form to copy: {text}");
    assert!(tv.vault.worklogs("demo").unwrap().is_empty(), "nothing was written");
}

#[test]
fn a_timestamp_in_the_future_is_refused_everywhere() {
    let tv = TempVault::new("future");
    let future = "2099-01-01T00:00:00Z";

    let err = tv
        .vault
        .start_work(
            "demo",
            &StartWork {
                agent: "cli-builder".into(),
                title: "Work from the future".into(),
                body: BODY.into(),
                started_at: Some(future.into()),
                ..Default::default()
            },
        )
        .unwrap_err();
    assert_eq!(err.kind(), "invalid_argument");
    assert!(err.to_string().contains("at or before now"), "{err}");
    assert!(tv.vault.worklogs("demo").unwrap().is_empty());

    let id = start_at(&tv, Some(T0));
    let err = tv
        .vault
        .update_work("demo", &id, "cli-builder", "From the future.", Some(future))
        .unwrap_err();
    assert_eq!(err.kind(), "invalid_argument", "{err}");
    let err = finish(&tv, &id, Some(future), None).unwrap_err();
    assert_eq!(err.kind(), "invalid_argument", "{err}");

    let d = tv.vault.worklog("demo", &id).unwrap();
    assert_eq!(d.meta.status, WorkStatus::InProgress, "both failures wrote nothing");
    assert!(d.updates.is_empty());
}

#[test]
fn a_timestamp_before_the_state_it_follows_is_refused() {
    let tv = TempVault::new("order");
    let id = start_at(&tv, Some(T1));

    // an update before the work started
    let err = tv
        .vault
        .update_work("demo", &id, "cli-builder", "Time travel.", Some(T0))
        .unwrap_err();
    assert!(
        err.to_string().contains("at or after the work log's started time"),
        "{err}"
    );
    assert!(err.to_string().contains(T1), "names the time to beat: {err}");

    // an update before the previous update
    tv.vault
        .update_work("demo", &id, "cli-builder", "First note, in order.", Some(T2))
        .unwrap();
    let err = tv
        .vault
        .update_work("demo", &id, "cli-builder", "Second note, backwards.", Some(T1))
        .unwrap_err();
    assert!(err.to_string().contains("at or after the previous note"), "{err}");
    assert_eq!(tv.vault.worklog("demo", &id).unwrap().updates.len(), 1);

    // finishing before the last note, and before the start
    for bad in [T1, T0] {
        let err = finish(&tv, &id, Some(bad), None).unwrap_err();
        assert_eq!(err.kind(), "invalid_argument", "{err}");
        assert!(err.to_string().contains("--finished-at"), "{err}");
    }
    assert_eq!(
        tv.vault.worklog("demo", &id).unwrap().meta.status,
        WorkStatus::InProgress,
        "a rejected timestamp leaves the record alone"
    );
}

#[test]
fn work_done_can_correct_the_start_but_not_break_the_order() {
    let tv = TempVault::new("restart");
    let id = start_at(&tv, Some(T1));

    // --started-at after --finished-at
    let err = finish(&tv, &id, Some(T1), Some(T2)).unwrap_err();
    assert!(err.to_string().contains("at or after --started-at"), "{err}");

    // --started-at after a note that is already on the record
    tv.vault
        .update_work("demo", &id, "cli-builder", "A note at T1.", Some(T1))
        .unwrap();
    let err = finish(&tv, &id, Some(T2), Some(T2)).unwrap_err();
    assert!(
        err.to_string().contains("at or before this record's first progress note"),
        "{err}"
    );

    // correcting the start backwards is what the flag is for
    finish(&tv, &id, Some(T2), Some(T0)).unwrap();
    let d = tv.vault.worklog("demo", &id).unwrap();
    assert_eq!(d.meta.started, T0);
    assert_eq!(d.meta.finished.as_deref(), Some(T2));
    assert_eq!(doctor::check(&tv.vault).unwrap().errors(), 0);
}

// ---------------------------------------------------------------------------
// bugs
// ---------------------------------------------------------------------------

fn file_bug(tv: &TempVault, created_at: Option<&str>) -> String {
    tv.vault
        .create_bug(
            "demo",
            &NewBug {
                agent: "ui-builder".into(),
                title: "Desktop app shows stale records".into(),
                severity: Severity::High,
                labels: vec![],
                refs: vec![],
                body: REPORT.into(),
                created_at: created_at.map(str::to_string),
            },
        )
        .expect("bug create")
        .id
}

#[test]
fn a_bug_can_be_filed_claimed_and_resolved_after_the_fact() {
    let tv = TempVault::new("bug");
    let id = file_bug(&tv, Some(T0));
    tv.vault.claim_bug("demo", &id, "cli-builder", Some(T1)).unwrap();
    tv.vault
        .comment_bug(
            "demo",
            &id,
            "cli-builder",
            "Root cause: the Tauri shell never started a watcher.",
            Some(T1),
        )
        .unwrap();
    tv.vault
        .resolve_bug(
            "demo",
            &id,
            "cli-builder",
            "Started the watcher in setup(); verified with cargo test and a live refresh.",
            Some(T2),
        )
        .unwrap();

    let b = tv.vault.bug("demo", &id).unwrap();
    assert_eq!(b.meta.created, T0);
    assert_eq!(b.meta.claimed.as_deref(), Some(T1));
    assert_eq!(b.comments[0].ts, T1);
    assert_eq!(b.meta.resolved.as_deref(), Some(T2));
    assert_eq!(b.last_activity, T2);
    assert_eq!(event_ts(&tv, "bug_created"), T0);
    assert_eq!(event_ts(&tv, "bug_claimed"), T1);
    assert_eq!(event_ts(&tv, "bug_commented"), T1);
    assert_eq!(event_ts(&tv, "bug_resolved"), T2);
    assert_eq!(doctor::check(&tv.vault).unwrap().errors(), 0);
}

#[test]
fn out_of_order_bug_mutations_are_refused() {
    let tv = TempVault::new("bug-order");
    let id = file_bug(&tv, Some(T1));

    let err = tv
        .vault
        .claim_bug("demo", &id, "cli-builder", Some(T0))
        .unwrap_err();
    assert!(
        err.to_string().contains("at or after the bug's created time"),
        "{err}"
    );
    assert_eq!(
        tv.vault.bug("demo", &id).unwrap().meta.claimed,
        None,
        "the rejected claim wrote nothing"
    );

    tv.vault.claim_bug("demo", &id, "cli-builder", Some(T2)).unwrap();
    let err = tv
        .vault
        .resolve_bug("demo", &id, "cli-builder", OUTCOME, Some(T1))
        .unwrap_err();
    assert!(
        err.to_string()
            .contains("at or after the bug's last recorded activity"),
        "{err}"
    );

    let err = tv
        .vault
        .comment_bug("demo", &id, "cli-builder", "Backwards comment.", Some(T0))
        .unwrap_err();
    assert_eq!(err.kind(), "invalid_argument", "{err}");
    assert!(tv.vault.bug("demo", &id).unwrap().comments.is_empty());
}

// ---------------------------------------------------------------------------
// work abandon
// ---------------------------------------------------------------------------

#[test]
fn abandoning_work_records_the_reason_and_stops_the_clock() {
    let tv = TempVault::new("abandon");
    let id = start_at(&tv, Some(T0));
    tv.vault
        .update_work("demo", &id, "cli-builder", "Tried the naive approach first.", Some(T1))
        .unwrap();

    let w = tv
        .vault
        .abandon_work(
            "demo",
            &id,
            &AbandonWork {
                agent: "cli-builder".into(),
                reason: "Superseded by WORK-0009, which solves the same problem in \
                         agentmon-core; nothing from this branch was kept."
                    .into(),
                at: Some(T2.into()),
            },
        )
        .unwrap();
    assert_eq!(w.event.event_type, "work_abandoned");
    assert_eq!(w.event.ts, T2);

    let d = tv.vault.worklog("demo", &id).unwrap();
    assert_eq!(d.meta.status, WorkStatus::Abandoned);
    assert_eq!(d.meta.finished.as_deref(), Some(T2), "the clock stops when it stops");
    assert_eq!(d.updates.len(), 2, "the reason is a timestamped note");
    assert_eq!(d.updates[1].ts, T2);
    assert!(
        d.updates[1].body.contains("Superseded by WORK-0009"),
        "{:?}",
        d.updates[1]
    );
    assert!(d.outcome.is_none(), "abandoned work has no outcome");
    assert_eq!(doctor::check(&tv.vault).unwrap().errors(), 0);
    assert_eq!(
        tv.vault.status("demo").unwrap().active_work.len(),
        0,
        "the dashboard stops showing it as active"
    );

    // an abandoned record is closed: no more notes, no second abandon, no completion
    let err = tv
        .vault
        .update_work("demo", &id, "cli-builder", "One more thought.", None)
        .unwrap_err();
    assert_eq!(err.kind(), "conflict");
    let err = tv
        .vault
        .abandon_work(
            "demo",
            &id,
            &AbandonWork {
                agent: "cli-builder".into(),
                reason: "Abandoning it twice for good measure.".into(),
                at: None,
            },
        )
        .unwrap_err();
    assert!(err.to_string().contains("already abandoned"), "{err}");
    assert_eq!(finish(&tv, &id, None, None).unwrap_err().kind(), "conflict");
}

#[test]
fn abandon_needs_a_real_reason_and_refuses_finished_work() {
    let tv = TempVault::new("abandon-guards");
    let id = start_at(&tv, None);
    for bad in ["", "wip", "   "] {
        let err = tv
            .vault
            .abandon_work(
                "demo",
                &id,
                &AbandonWork {
                    agent: "cli-builder".into(),
                    reason: bad.into(),
                    at: None,
                },
            )
            .unwrap_err();
        assert_eq!(err.kind(), "invalid_body", "{bad:?} should be rejected");
        assert!(err.to_string().contains("agentmon work abandon"), "{err}");
    }
    assert_eq!(
        tv.vault.worklog("demo", &id).unwrap().meta.status,
        WorkStatus::InProgress
    );

    finish(&tv, &id, None, None).unwrap();
    let err = tv
        .vault
        .abandon_work(
            "demo",
            &id,
            &AbandonWork {
                agent: "cli-builder".into(),
                reason: "Changed my mind about this one.".into(),
                at: None,
            },
        )
        .unwrap_err();
    assert_eq!(err.kind(), "conflict");
    assert!(err.to_string().contains("already done"), "{err}");
}

// ---------------------------------------------------------------------------
// project update
// ---------------------------------------------------------------------------

#[test]
fn project_update_changes_metadata_and_logs_an_event() {
    let tv = TempVault::new("project-update");
    let w = tv
        .vault
        .update_project(
            "demo",
            &UpdateProject {
                name: Some("Demo, renamed".into()),
                description: Some("The project the agentmon-core tests write into.".into()),
                tags: Some(vec!["test".into(), "core".into(), "test".into()]),
                status: None,
                actor: "cli-builder".into(),
                at: None,
            },
        )
        .unwrap();
    assert_eq!(w.event.event_type, "project_updated");
    assert!(w.event.summary.contains("Demo, renamed"), "{}", w.event.summary);

    let p = tv.vault.project("demo").unwrap();
    assert_eq!(p.name, "Demo, renamed");
    assert_eq!(p.description, "The project the agentmon-core tests write into.");
    assert_eq!(p.tags, vec!["test", "core"], "duplicates are dropped");
    assert_eq!(p.slug, "demo", "the slug and id never move");
    assert_eq!(p.id, "prj-demo");
    assert!(p.created_at.is_some(), "createdAt survives the rewrite");

    // one field changes alone
    tv.vault
        .update_project(
            "demo",
            &UpdateProject {
                description: Some("Only the description this time.".into()),
                actor: "cli-builder".into(),
                ..Default::default()
            },
        )
        .unwrap();
    let p = tv.vault.project("demo").unwrap();
    assert_eq!(p.name, "Demo, renamed", "untouched fields survive");
    assert_eq!(p.description, "Only the description this time.");

    // nothing to change is an error, not a silent no-op
    let err = tv
        .vault
        .update_project(
            "demo",
            &UpdateProject {
                actor: "cli-builder".into(),
                ..Default::default()
            },
        )
        .unwrap_err();
    assert_eq!(err.kind(), "conflict");
    assert!(err.to_string().contains("--name"), "{err}");

    assert_eq!(
        tv.vault
            .update_project(
                "nope",
                &UpdateProject {
                    name: Some("x".into()),
                    actor: "cli-builder".into(),
                    ..Default::default()
                }
            )
            .unwrap_err()
            .kind(),
        "project_not_found"
    );

    let report = doctor::check(&tv.vault).unwrap();
    assert_eq!(report.errors(), 0, "{:#?}", report.problems);
    assert_eq!(report.warnings(), 0, "project_updated is a known event type");
}

/// Archiving is the one piece of project state a human sets, from the app's Projects
/// screen or from `agentmon project update --status archived`. It has to be reversible and
/// it has to delete nothing — an archived project is out of the way, not gone.
#[test]
fn project_archive_hides_nothing_and_is_reversible() {
    let tv = TempVault::new("project-archive");
    tv.vault
        .start_work(
            "demo",
            &StartWork {
                agent: "nova".into(),
                title: "Something worth keeping".into(),
                body: BODY.into(),
                ..Default::default()
            },
        )
        .unwrap();

    let archived = tv
        .vault
        .update_project(
            "demo",
            &UpdateProject {
                status: Some(ProjectStatus::Archived),
                actor: "app".into(),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(archived.event.event_type, "project_updated");
    assert!(
        archived.event.summary.contains("archived"),
        "the event says what happened: {}",
        archived.event.summary
    );
    assert_eq!(archived.record.status, ProjectStatus::Archived);

    let p = tv.vault.project("demo").unwrap();
    assert_eq!(p.status, ProjectStatus::Archived);
    assert_eq!(p.counts.work_total, 1, "archiving deletes no records");
    assert_eq!(p.name, "Demo", "and changes nothing else");
    assert_eq!(tv.vault.worklogs("demo").unwrap().len(), 1);
    assert!(
        tv.vault.projects().unwrap().iter().any(|x| x.slug == "demo"),
        "an archived project is still in the vault listing; the app decides what to show"
    );

    // …and back again.
    tv.vault
        .update_project(
            "demo",
            &UpdateProject {
                status: Some(ProjectStatus::Active),
                actor: "app".into(),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(tv.vault.project("demo").unwrap().status, ProjectStatus::Active);

    let report = doctor::check(&tv.vault).unwrap();
    assert_eq!(report.errors(), 0, "{:#?}", report.problems);
}
