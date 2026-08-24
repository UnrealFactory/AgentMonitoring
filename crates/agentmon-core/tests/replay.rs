//! The replay exception (SPEC.md, "Backdating"): reconstruction may write an update at a
//! time the normal ordering guard refuses — before the record's close, before later
//! entries — and only reconstruction. The guard itself does not move for normal writes.

use std::fs;
use std::path::PathBuf;

use agentmon_core::doctor;
use agentmon_core::{FinishWork, NewBug, NewProject, Severity, StartWork, Store};

struct TempProject {
    location: PathBuf,
    store: Store,
}

impl TempProject {
    fn new(tag: &str) -> TempProject {
        let location = std::env::temp_dir().join(format!(
            "agentmon-replay-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&location).unwrap();
        let store = Store::init(
            &location,
            &NewProject {
                name: "Replay".into(),
                actor: "test-runner".into(),
                ..Default::default()
            },
        )
        .expect("init");
        TempProject { location, store }
    }
}

impl Drop for TempProject {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.location);
    }
}

const HUMAN: &str = "A plain-words retelling of this record, long enough to be a real one.";
const T0: &str = "2026-08-18T09:00:00Z"; // started / created
const T1: &str = "2026-08-18T10:00:00Z"; // a surviving note
const T1_5: &str = "2026-08-18T10:30:00Z"; // the lost note being replayed
const T2: &str = "2026-08-18T11:30:00Z"; // finished

/// A record re-created the way BUG-0027's recovery re-creates one: real start, one
/// surviving note, real finish — with the in-progress note at T1_5 lost to the collision.
fn reconstructed_worklog(tp: &TempProject) -> String {
    let id = tp
        .store
        .start_work(&StartWork {
            agent: "recovery-agent".into(),
            title: "A record rebuilt from the past".into(),
            body: "## What\n\nA reconstruction fixture.\n\n## Why\n\nThe original was lost \
                   to an id collision.\n\n## How\n\nRe-created with its real timestamps.\n"
                .into(),
            human: HUMAN.into(),
            started_at: Some(T0.into()),
            ..Default::default()
        })
        .expect("work start")
        .id;
    tp.store
        .update_work(&id, "recovery-agent", Some("The note that survived the collision."), None, Some(T1))
        .expect("surviving note");
    tp.store
        .finish_work(
            &id,
            &FinishWork {
                agent: "recovery-agent".into(),
                outcome: "Reconstructed; verified against the original machine's copy.".into(),
                human: HUMAN.into(),
                finished_at: Some(T2.into()),
                ..Default::default()
            },
        )
        .expect("work done");
    id
}

#[test]
fn a_replayed_note_lands_at_its_real_time_inside_a_closed_record() {
    let tp = TempProject::new("work");
    let id = reconstructed_worklog(&tp);

    // The normal guard is exactly why this exception exists: the same write without the
    // replay path is refused, because a note before the close is normally a lie.
    let err = tp
        .store
        .update_work(&id, "recovery-agent", Some("The lost in-progress note."), None, Some(T1_5))
        .expect_err("normal writes keep the ordering guard");
    assert_eq!(err.kind(), "invalid_argument", "{err}");
    assert!(err.to_string().contains("closed"), "{err}");

    let w = tp
        .store
        .replay_work_note(&id, "recovery-agent", "The lost in-progress note.", None, T1_5)
        .expect("replay");

    // In the timeline, not at the end: T1, then the replayed T1_5 — under a T2 close.
    let stamps: Vec<&str> = w.record.updates.iter().map(|u| u.ts.as_str()).collect();
    assert_eq!(stamps, [T1, T1_5], "{stamps:?}");
    assert_eq!(w.record.updates[1].body, "The lost in-progress note.");
    assert_eq!(w.record.meta.finished.as_deref(), Some(T2), "the close did not move");

    // The event carries the note's own time and says it is a replay — a reconstructed
    // line must never pass for an original.
    assert_eq!(w.event.ts, T1_5);
    assert_eq!(w.event.event_type, "work_updated");
    assert!(w.event.summary.starts_with("Replayed:"), "{}", w.event.summary);

    // And doctor pairs the replayed event against its entry like any other: strict-clean.
    let report = doctor::check(&tp.store).unwrap();
    assert_eq!(report.errors(), 0, "{:#?}", report.problems);
    assert_eq!(report.warnings(), 0, "{:#?}", report.problems);
}

#[test]
fn the_floor_stays_a_replay_cannot_predate_the_record() {
    let tp = TempProject::new("floor");
    let id = reconstructed_worklog(&tp);
    let err = tp
        .store
        .replay_work_note(&id, "recovery-agent", "Before the work began.", None, "2026-08-18T08:00:00Z")
        .expect_err("nothing on a record predates started");
    assert!(err.to_string().contains("started"), "{err}");

    // The future is still the future, replay or not.
    let err = tp
        .store
        .replay_work_note(&id, "recovery-agent", "From tomorrow.", None, "2036-01-01T00:00:00Z")
        .expect_err("a replay documents the past");
    assert!(err.to_string().contains("at or before now"), "{err}");
}

#[test]
fn a_replayed_bug_comment_lands_in_thread_order_with_a_marked_event() {
    let tp = TempProject::new("bug");
    let id = tp
        .store
        .create_bug(&NewBug {
            agent: "recovery-agent".into(),
            title: "A bug rebuilt from the past".into(),
            severity: Severity::High,
            labels: vec![],
            refs: vec![],
            body: "## Report\n\nRepro: lose a bug to an id collision. Expected: its thread \
                   comes back at the real times.\n"
                .into(),
            human: HUMAN.into(),
            created_at: Some(T0.into()),
        })
        .expect("bug create")
        .id;
    tp.store
        .comment_bug(&id, "recovery-agent", Some("The comment that survived."), None, Some(T2))
        .expect("surviving comment");

    // Normal write: refused before the previous comment. Replay: inserted before it.
    let err = tp
        .store
        .comment_bug(&id, "recovery-agent", Some("The lost comment."), None, Some(T1))
        .expect_err("normal writes keep the ordering guard");
    assert_eq!(err.kind(), "invalid_argument", "{err}");

    let b = tp
        .store
        .replay_bug_comment(&id, "recovery-agent", "The lost comment.", None, T1)
        .expect("replay");
    let stamps: Vec<&str> = b.record.comments.iter().map(|c| c.ts.as_str()).collect();
    assert_eq!(stamps, [T1, T2], "{stamps:?}");
    assert_eq!(b.record.comments[0].body, "The lost comment.");
    assert_eq!(b.record.comments[0].agent, "recovery-agent");
    assert_eq!(b.event.ts, T1);
    assert_eq!(b.event.event_type, "bug_commented");
    assert!(b.event.summary.starts_with("Replayed:"), "{}", b.event.summary);

    // The floor stays here too: nothing on a bug predates created.
    let err = tp
        .store
        .replay_bug_comment(&id, "recovery-agent", "Before the bug existed.", None, "2026-08-18T08:00:00Z")
        .expect_err("created is the floor");
    assert!(err.to_string().contains("created"), "{err}");

    let report = doctor::check(&tp.store).unwrap();
    assert_eq!(report.errors(), 0, "{:#?}", report.problems);
    assert_eq!(report.warnings(), 0, "{:#?}", report.problems);
}

/// The human-area law holds on the replay path exactly as on the normal one: a record
/// with no `## For humans` refuses a replay that would leave it without one, and gains
/// one when the replay supplies it.
#[test]
fn a_replay_onto_a_legacy_record_still_demands_the_human_area() {
    let tp = TempProject::new("legacy");
    let id = reconstructed_worklog(&tp);
    // Strip the human area by hand, the way a legacy record arrives.
    let path = tp.location.join("AgentMonitoring/worklogs").join(format!("{id}.md"));
    let raw = fs::read_to_string(&path).unwrap();
    let cut = raw.split("## For humans").next().unwrap().trim_end().to_string();
    fs::write(&path, format!("{cut}\n")).unwrap();

    let err = tp
        .store
        .replay_work_note(&id, "recovery-agent", "The lost in-progress note.", None, T1_5)
        .expect_err("no write may leave a record without a human area");
    assert_eq!(err.kind(), "invalid_argument", "{err}");
    assert!(err.to_string().contains("--human"), "{err}");

    tp.store
        .replay_work_note(&id, "recovery-agent", "The lost in-progress note.", Some(HUMAN), T1_5)
        .expect("the same replay with --human lands, and the record gains its human area");
    let w = tp.store.worklog(&id).unwrap();
    assert_eq!(w.human.as_deref(), Some(HUMAN));
}
