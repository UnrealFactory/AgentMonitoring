//! The note lifecycle, end to end: add → list/view → update in place → remove, with the
//! event trail that makes a mutable record honest. Notes are the third record kind and
//! the only one agents may rewrite and take away — these tests pin down exactly how far
//! that permission goes.

use std::fs;
use std::path::PathBuf;

use agentmon_core::{doctor, NewNote, NewProject, NoteType, StartWork, Store, UpdateNote};

fn tmp_location(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!(
        "agentmon-notes-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&d).unwrap();
    d
}

fn project(tag: &str) -> (PathBuf, Store) {
    let location = tmp_location(tag);
    let store = Store::init(
        &location,
        &NewProject {
            name: "Notes".into(),
            actor: "tester".into(),
            ..Default::default()
        },
    )
    .expect("init");
    (location, store)
}

fn new_note(title: &str, body: &str) -> NewNote {
    NewNote {
        agent: "tester".into(),
        name: None,
        title: title.into(),
        note_type: NoteType::Memory,
        description: "One line that says when this note is worth opening.".into(),
        tags: vec!["test".into()],
        refs: vec![],
        body: body.into(),
        at: None,
    }
}

#[test]
fn a_note_round_trips_and_its_name_comes_from_the_title() {
    let (location, store) = project("roundtrip");

    let written = store
        .add_note(&new_note(
            "Gate scripts must sandbox the registry",
            "Set AGENTMON_REGISTRY_DIR to a scratch dir in every gate that runs init.",
        ))
        .expect("note add");
    assert_eq!(written.id, "gate-scripts-must-sandbox-the-registry");
    assert!(PathBuf::from(&written.path).is_file(), "{}", written.path);
    assert_eq!(written.event.event_type, "note_created");
    assert_eq!(written.event.r#ref.as_deref(), Some(written.id.as_str()));

    let listed = store.notes().expect("note list");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].meta.note_type, NoteType::Memory);
    assert!(
        listed[0].search_text.contains("AGENTMON_REGISTRY_DIR"),
        "search reaches the body: {}",
        listed[0].search_text
    );

    let detail = store.note(&written.id).expect("note view");
    assert!(detail.body.contains("scratch dir"));
    assert_eq!(detail.meta.created, detail.meta.updated);

    let counts = store.project().unwrap().counts;
    assert_eq!(counts.notes_total, 1);
    // project_created + note_created
    assert_eq!(counts.events, 2);
    fs::remove_dir_all(&location).ok();
}

#[test]
fn a_duplicate_name_is_refused_with_the_update_hint() {
    let (location, store) = project("dup");
    store.add_note(&new_note("The same fact", "The body of the first note.")).unwrap();
    let err = store
        .add_note(&new_note("The same fact", "A near-duplicate of the first note."))
        .expect_err("one fact, one file");
    let text = err.to_string();
    assert!(text.contains("already exists"), "{text}");
    assert!(text.contains("agentmon note update"), "the fix is named: {text}");
    fs::remove_dir_all(&location).ok();
}

#[test]
fn update_replaces_in_place_and_stamps_updated() {
    let (location, store) = project("update");
    let added = store
        .add_note(&NewNote {
            at: Some("2026-08-19T10:00:00Z".into()),
            ..new_note("Handoff for the next builder", "State: the list page is done.")
        })
        .unwrap();

    let updated = store
        .update_note(
            &added.id,
            &UpdateNote {
                agent: "second-agent".into(),
                body: Some("State: list and detail pages are done; wire the events next.".into()),
                description: Some("Read this before touching the notes UI.".into()),
                at: Some("2026-08-19T12:00:00Z".into()),
                ..Default::default()
            },
        )
        .expect("note update");
    let rec = &updated.record;
    assert!(rec.body.contains("detail pages are done"));
    assert!(!rec.body.contains("the list page is done"), "the body was replaced, not appended");
    assert_eq!(rec.meta.created, "2026-08-19T10:00:00Z");
    assert_eq!(rec.meta.updated, "2026-08-19T12:00:00Z");
    assert_eq!(rec.meta.agent, "tester", "the author stays");
    assert_eq!(
        rec.meta.updated_by.as_deref(),
        Some("second-agent"),
        "the current body belongs to its last rewriter, and the record says so"
    );
    assert_eq!(rec.meta.current_agent(), "second-agent");
    assert_eq!(updated.event.actor, "second-agent");
    assert_eq!(updated.event.event_type, "note_updated");
    assert!(updated.event.summary.contains("description"), "{}", updated.event.summary);
    assert!(updated.event.summary.contains("body"), "{}", updated.event.summary);

    // A backdated edit cannot land before the state it follows.
    let err = store
        .update_note(
            &added.id,
            &UpdateNote {
                agent: "tester".into(),
                title: Some("Too early".into()),
                at: Some("2026-08-19T11:00:00Z".into()),
                ..Default::default()
            },
        )
        .expect_err("an edit cannot predate the last update");
    assert!(err.to_string().contains("last update"), "{err}");

    // …and an update that changes nothing is refused with the flag list.
    let err = store
        .update_note(&added.id, &UpdateNote { agent: "tester".into(), ..Default::default() })
        .expect_err("nothing to update");
    assert!(err.to_string().contains("--body"), "{err}");
    fs::remove_dir_all(&location).ok();
}

#[test]
fn remove_takes_the_file_and_leaves_the_event() {
    let (location, store) = project("remove");
    let added = store
        .add_note(&new_note("A note that turns out wrong", "This claim was later disproven."))
        .unwrap();

    let gone = store
        .remove_note(&added.id, "second-agent", None)
        .expect("note remove");
    assert_eq!(gone.record.title, "A note that turns out wrong");
    assert!(!PathBuf::from(&gone.path).exists(), "the file is gone");
    assert_eq!(gone.event.event_type, "note_removed");
    assert_eq!(gone.event.actor, "second-agent");
    assert!(gone.event.summary.contains("A note that turns out wrong"));

    // The trail survives: events still count the whole story.
    let events = store.events(None).unwrap();
    assert!(events.iter().any(|e| e.event_type == "note_removed"));
    assert_eq!(store.project().unwrap().counts.notes_total, 0);

    // A second removal is a missing record, not a second delete.
    assert!(store.remove_note(&added.id, "tester", None).is_err());
    fs::remove_dir_all(&location).ok();
}

#[test]
fn refs_may_point_at_records_by_shape_and_at_notes_only_if_they_exist() {
    let (location, store) = project("refs");
    store
        .add_note(&new_note("The decision behind the notes design", "Names are identity."))
        .unwrap();

    // A work log may ref the note by name — and a typo'd name fails loudly.
    let ok = store
        .start_work(&StartWork {
            agent: "tester".into(),
            title: "Use the decision note".into(),
            refs: vec!["the-decision-behind-the-notes-design".into()],
            body: "## What\nWork that leans on a decision.\n## Why\nBecause the note says so.\n## How\nBy reading it.".into(),
            ..Default::default()
        })
        .expect("a work log can ref an existing note");
    assert_eq!(ok.record.meta.refs, vec!["the-decision-behind-the-notes-design"]);

    let err = store
        .start_work(&StartWork {
            agent: "tester".into(),
            title: "Ref a note that is not there".into(),
            refs: vec!["no-such-note".into()],
            body: "## What\nA doomed record.\n## Why\nTo prove the guard.\n## How\nBy failing loudly.".into(),
            ..Default::default()
        })
        .expect_err("a dangling note ref is refused");
    assert!(err.to_string().contains("no note is named"), "{err}");

    // A note may ref records and other notes; its own name is dropped, not linked.
    let n = store
        .add_note(&NewNote {
            name: Some("self-ref-check".into()),
            refs: vec![
                "WORK-0001".into(),
                "the-decision-behind-the-notes-design".into(),
                "self-ref-check".into(),
            ],
            ..new_note("Self ref check", "A note that tries to reference itself.")
        })
        .expect("note refs accept ids and existing names");
    assert_eq!(
        n.record.meta.refs,
        vec!["WORK-0001".to_string(), "the-decision-behind-the-notes-design".to_string()]
    );
    fs::remove_dir_all(&location).ok();
}

#[test]
fn non_ascii_titles_need_an_explicit_name_and_reserved_names_are_refused() {
    let (location, store) = project("names");
    let err = store
        .add_note(&new_note("핸드오프 노트", "A body that is long enough to pass."))
        .expect_err("no ascii to slug from");
    assert!(err.to_string().contains("--name"), "the fix is named: {err}");

    let ok = store
        .add_note(&NewNote {
            name: Some("handoff-korean".into()),
            ..new_note("핸드오프 노트", "A body that is long enough to pass.")
        })
        .expect("an explicit name unblocks a non-ascii title");
    assert_eq!(ok.id, "handoff-korean");

    for bad in ["con", "work-0001", "UPPER CASE", "-x-"] {
        let err = store
            .add_note(&NewNote {
                name: Some(bad.into()),
                ..new_note("Bad name attempt", "A body that is long enough to pass.")
            })
            .expect_err("bad name refused");
        assert!(!err.to_string().is_empty(), "{bad}");
    }
    fs::remove_dir_all(&location).ok();
}

#[test]
fn doctor_reads_notes_and_reports_what_is_wrong_with_them() {
    let (location, store) = project("doctor");
    store
        .add_note(&new_note("A healthy note", "Nothing is wrong with this one at all."))
        .unwrap();
    let report = doctor::check(&store).expect("doctor runs");
    assert_eq!(report.notes, 1);
    assert_eq!(report.errors(), 0, "{:?}", report.problems);

    // Break one by hand the way a merge conflict would: name/file mismatch + bad type.
    fs::write(
        store.root().join("notes").join("broken-note.md"),
        "---\nname: something-else\ntitle: \"\"\ntype: musing\ndescription: d\nagent: a\ncreated: 2026-08-19T10:00:00Z\nupdated: 2026-08-19T09:00:00Z\ntags: []\nrefs: []\n---\n\nBody.\n",
    )
    .unwrap();
    let report = doctor::check(&store).expect("doctor still runs");
    assert_eq!(report.notes, 2);
    assert!(report.errors() >= 1, "{:?}", report.problems);
    let all = format!("{:?}", report.problems);
    assert!(all.contains("broken-note"), "{all}");
    fs::remove_dir_all(&location).ok();
}

#[test]
fn note_events_ride_the_feed_and_the_status_snapshot_carries_recent_notes() {
    let (location, store) = project("status");
    store
        .add_note(&new_note("First note", "The first of two notes in this project."))
        .unwrap();
    store
        .add_note(&NewNote {
            note_type: NoteType::Handoff,
            ..new_note("Second note", "The second of two notes in this project.")
        })
        .unwrap();

    let snap = store.status().expect("status");
    assert_eq!(snap.recent_notes.len(), 2);
    assert_eq!(snap.project.counts.notes_total, 2);
    let tester = snap
        .agents
        .iter()
        .find(|a| a.agent == "tester")
        .expect("note authors appear in the per-agent rollup");
    assert_eq!(tester.notes, 2);
    assert!(snap
        .recent_events
        .iter()
        .any(|e| e.event_type == "note_created"));
    fs::remove_dir_all(&location).ok();
}
