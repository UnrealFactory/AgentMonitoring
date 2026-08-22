//! The human area, end to end: storage, the enforcement matrix, refreshes and the wire.
//!
//! SPEC.md, "The human area — every record speaks to two audiences". The rules under test:
//! reading is lenient (a record written before the section existed still parses), writing
//! is not (creating or closing a record requires one, and any mutation of a record that
//! lacks one has to supply it), a refresh writes only the human area and logs exactly one
//! `human_updated` event, the reserved heading cannot arrive through an agent-area flag,
//! and `human` is a `string | null` field on every view and list row.

use std::fs;
use std::path::PathBuf;

use agentmon_core::{
    AbandonWork, FinishWork, NewBug, NewNote, NewProject, NoteType, Severity, StartWork, Store,
    UpdateNote, DATA_DIR,
};

const HUMAN: &str = "Two agents kept overwriting each other's notes. Now they cannot: the \
                     app asks the operating system for the file instead of guessing.";
const BODY: &str = "## What\n\nAdd the human area to every write path.\n\n## Why\n\nA record \
                    only agents can read is a record the owner cannot check.\n\n## How\n\nOne \
                    reserved last section, validated in agentmon-core so every wrapper \
                    inherits it.";

struct Fixture {
    location: PathBuf,
    store: Store,
}

impl Fixture {
    fn new(tag: &str) -> Fixture {
        let location = std::env::temp_dir().join(format!(
            "agentmon-human-{tag}-{}-{}",
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
                name: "Human area".into(),
                actor: "test-runner".into(),
                ..Default::default()
            },
        )
        .expect("init");
        Fixture { location, store }
    }

    fn raw(&self, rel: &str) -> String {
        fs::read_to_string(self.location.join(DATA_DIR).join(rel)).unwrap()
    }

    fn start(&self) -> String {
        self.store
            .start_work(&StartWork {
                agent: "cli-builder".into(),
                title: "Give every record a human area".into(),
                body: BODY.into(),
                human: HUMAN.into(),
                ..Default::default()
            })
            .expect("work start")
            .id
    }

    fn file_bug(&self) -> String {
        self.store
            .create_bug(&NewBug {
                agent: "cli-builder".into(),
                title: "The board loses the filter on back".into(),
                severity: Severity::Medium,
                labels: vec![],
                refs: vec![],
                body: "## Report\n\nFilter by tag, open a record, press back: the filter is gone."
                    .into(),
                human: "If you filter the list and then come back to it, the filter is gone \
                        and you have to set it again."
                    .into(),
                created_at: None,
            })
            .expect("bug create")
            .id
    }

    fn add_note(&self, name: &str) -> String {
        self.store
            .add_note(&NewNote {
                agent: "cli-builder".into(),
                name: Some(name.into()),
                title: "What the next session needs".into(),
                note_type: NoteType::Handoff,
                description: "Where the human-area work stands right now.".into(),
                tags: vec![],
                refs: vec![],
                body: "Storage and validation are in; the screens are not.".into(),
                human: "This is a note to whoever works on this next: the saving part is \
                        finished, the screens are not."
                    .into(),
                at: None,
            })
            .expect("note add")
            .id
    }

    /// A record as it was written before the human area existed: no `## For humans`
    /// anywhere. There is no way to produce one through the write path any more — which is
    /// the point of the leniency rules — so the fixture is written as a file, in a temp
    /// directory, exactly as the doctor tests build their broken records.
    fn legacy_work(&self, id: &str) {
        let text = format!(
            "---\nid: {id}\ntitle: A record from before the human area\nagent: old-builder\n\
             status: in_progress\nstarted: 2026-08-01T09:00:00Z\nfinished: null\ntags: []\n\
             refs: []\nfiles: []\n---\n\n## What\n\nSomething real.\n\n## Why\n\nA reason.\n\n\
             ## How\n\nAn approach.\n"
        );
        let dir = self.location.join(DATA_DIR).join("worklogs");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{id}.md")), text).unwrap();
    }

    fn legacy_bug(&self, id: &str) {
        let text = format!(
            "---\nid: {id}\ntitle: A bug from before the human area\nreporter: old-builder\n\
             assignee: null\nseverity: low\nstatus: open\nlabels: []\n\
             created: 2026-08-01T09:00:00Z\nclaimed: null\nresolved: null\nresolved_by: null\n\
             refs: []\n---\n\n## Report\n\nRepro, expected, actual — all of it, for agents.\n"
        );
        let dir = self.location.join(DATA_DIR).join("bugs");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{id}.md")), text).unwrap();
    }

    fn legacy_note(&self, name: &str) {
        let text = format!(
            "---\nname: {name}\ntitle: A note from before the human area\ntype: memory\n\
             description: An old fact, written for agents only.\nagent: old-builder\n\
             updated_by: null\ncreated: 2026-08-01T09:00:00Z\nupdated: 2026-08-01T09:00:00Z\n\
             tags: []\nrefs: []\n---\n\nThe fact itself, in the agents' own words.\n"
        );
        let dir = self.location.join(DATA_DIR).join("notes");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(format!("{name}.md")), text).unwrap();
    }

    fn events(&self, kind: &str) -> usize {
        self.store
            .events(None)
            .unwrap()
            .iter()
            .filter(|e| e.event_type == kind)
            .count()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.location);
    }
}

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------

#[test]
fn the_human_area_is_the_last_section_and_comes_back_out_as_a_field() {
    let f = Fixture::new("storage");
    let id = f.start();

    let raw = f.raw(&format!("worklogs/{id}.md"));
    assert!(raw.contains("## For humans"), "{raw}");
    let heading = raw.find("## For humans").unwrap();
    for other in ["## What", "## Why", "## How"] {
        assert!(raw.find(other).unwrap() < heading, "the human area is last:\n{raw}");
    }

    let d = f.store.worklog(&id).unwrap();
    assert_eq!(d.human.as_deref(), Some(HUMAN));
    assert!(!d.body.contains("## For humans"), "the agent area does not carry it");
    assert!(
        d.extra_sections.is_empty(),
        "it is a known section, not an unknown one: {:?}",
        d.extra_sections
    );

    // …and on the wire, on the detail and on the list row.
    let json = serde_json::to_value(&d).unwrap();
    assert_eq!(json["human"], serde_json::Value::String(HUMAN.to_string()));
    let rows = f.store.worklogs().unwrap();
    let row = serde_json::to_value(&rows[0]).unwrap();
    assert_eq!(row["human"], serde_json::Value::String(HUMAN.to_string()));
    // the list's search reaches it, because those are the words a reader remembers
    assert!(rows[0].search_text.contains("overwriting"), "{}", rows[0].search_text);
}

#[test]
fn every_record_kind_carries_one_and_a_legacy_file_reads_as_null() {
    let f = Fixture::new("kinds");
    f.start();
    f.file_bug();
    f.add_note("current-handoff");
    f.legacy_work("WORK-0900");
    f.legacy_bug("BUG-0900");
    f.legacy_note("old-memory");

    let works = f.store.worklogs().unwrap();
    let bugs = f.store.bugs().unwrap();
    let notes = f.store.notes().unwrap();
    assert_eq!(works.iter().filter(|w| w.human.is_some()).count(), 1);
    assert_eq!(bugs.iter().filter(|b| b.human.is_some()).count(), 1);
    assert_eq!(notes.iter().filter(|n| n.human.is_some()).count(), 1);

    // Lenient reading: null, not an error, and the rest of the record is untouched.
    let legacy = f.store.worklog("WORK-0900").unwrap();
    assert!(legacy.human.is_none());
    assert!(legacy.what.contains("Something real."));
    assert!(f.store.bug("BUG-0900").unwrap().human.is_none());
    let legacy_note = f.store.note("old-memory").unwrap();
    assert!(legacy_note.human.is_none());
    assert!(legacy_note.body.contains("agents' own words"));
    // …and `human` is present as null on the wire rather than missing.
    let json = serde_json::to_value(&legacy).unwrap();
    assert_eq!(json["human"], serde_json::Value::Null);
    assert!(json.as_object().unwrap().contains_key("human"));

    // doctor names them: a warning with the count and the ids, never an error.
    let report = agentmon_core::doctor::check(&f.store).unwrap();
    assert_eq!(report.errors(), 0, "{:?}", report.problems);
    let mut missing = report.missing_human.clone();
    missing.sort();
    assert_eq!(missing, ["BUG-0900", "WORK-0900", "old-memory"]);
    let warning = report
        .problems
        .iter()
        .find(|p| p.scope == "human area")
        .expect("doctor reports the gap");
    assert!(warning.message.contains("3 record(s)"), "{}", warning.message);
    assert!(warning.message.contains("WORK-0900"), "{}", warning.message);
    assert!(warning.fix.contains("--human"), "{}", warning.fix);
}

#[test]
fn a_reserved_heading_inside_a_code_fence_is_still_just_text() {
    let f = Fixture::new("fenced");
    // The body of a note explaining the feature quotes the heading in a fence — legal.
    let name = f
        .store
        .add_note(&NewNote {
            agent: "cli-builder".into(),
            name: Some("how-the-human-area-is-stored".into()),
            title: "How the human area is stored".into(),
            note_type: NoteType::Memory,
            description: "The reserved section, quoted safely inside a fence.".into(),
            tags: vec![],
            refs: vec![],
            body: "A record ends with:\n\n```md\n## For humans\n\n…the retelling…\n```\n\nThat \
                   heading is written by agentmon, never by hand."
                .into(),
            human: "This note explains where the plain-language part of a record is kept.".into(),
            at: None,
        })
        .expect("a fenced example is not the reserved section")
        .id;

    let n = f.store.note(&name).unwrap();
    assert!(n.body.contains("## For humans"), "the fenced example survives");
    assert_eq!(
        n.human.as_deref(),
        Some("This note explains where the plain-language part of a record is kept.")
    );
}

// ---------------------------------------------------------------------------
// the enforcement matrix
// ---------------------------------------------------------------------------

#[test]
fn creating_or_closing_a_record_without_one_is_refused_at_exit_2_with_the_rules() {
    let f = Fixture::new("required");

    let check = |err: agentmon_core::CoreError, what: &str| {
        assert_eq!(err.kind(), "invalid_argument", "{what}: {err}");
        let text = err.to_string();
        assert!(text.contains("--human"), "{what} names the flag: {text}");
        assert!(text.contains("--human-file"), "{what} names the file flag: {text}");
        assert!(
            text.contains("agentmon human-style"),
            "{what} points at the contract: {text}"
        );
        let first_rule = agentmon_core::HUMAN_COMPACT_RULES.lines().next().unwrap();
        assert!(text.contains(first_rule.trim()), "{what} prints the rules: {text}");
    };

    // work start
    check(
        f.store
            .start_work(&StartWork {
                agent: "a".into(),
                title: "No retelling".into(),
                body: BODY.into(),
                human: String::new(),
                ..Default::default()
            })
            .unwrap_err(),
        "work start",
    );

    let id = f.start();
    // work done
    check(
        f.store
            .finish_work(
                &id,
                &FinishWork {
                    agent: "a".into(),
                    outcome: "Shipped it, and the tests are green after two runs.".into(),
                    human: "   ".into(),
                    ..Default::default()
                },
            )
            .unwrap_err(),
        "work done",
    );
    // work abandon
    check(
        f.store
            .abandon_work(
                &id,
                &AbandonWork {
                    agent: "a".into(),
                    reason: "Superseded by a different approach entirely.".into(),
                    human: String::new(),
                    at: None,
                },
            )
            .unwrap_err(),
        "work abandon",
    );
    // bug create
    check(
        f.store
            .create_bug(&NewBug {
                agent: "a".into(),
                title: "No retelling".into(),
                severity: Severity::Low,
                labels: vec![],
                refs: vec![],
                body: "## Report\n\nRepro, expected, actual, all present and correct.".into(),
                human: String::new(),
                created_at: None,
            })
            .unwrap_err(),
        "bug create",
    );
    // bug resolve
    let bug = f.file_bug();
    check(
        f.store
            .resolve_bug(
                &bug,
                "a",
                "Root cause, fix and verification, all written out properly.",
                "",
                None,
            )
            .unwrap_err(),
        "bug resolve",
    );
    // note add
    check(
        f.store
            .add_note(&NewNote {
                agent: "a".into(),
                name: Some("no-retelling".into()),
                title: "No retelling".into(),
                note_type: NoteType::Memory,
                description: "A fact with nothing said to the human.".into(),
                tags: vec![],
                refs: vec![],
                body: "The fact itself, long enough to pass validation.".into(),
                human: String::new(),
                at: None,
            })
            .unwrap_err(),
        "note add",
    );
    // note update --body
    let note = f.add_note("handoff-now");
    check(
        f.store
            .update_note(
                &note,
                &UpdateNote {
                    agent: "a".into(),
                    body: Some("Different knowledge entirely, and no word to the human.".into()),
                    ..Default::default()
                },
            )
            .unwrap_err(),
        "note update --body",
    );

    // Every refusal left the disk alone.
    assert_eq!(f.store.worklogs().unwrap().len(), 1);
    assert_eq!(f.store.bugs().unwrap().len(), 1);
    assert_eq!(f.store.notes().unwrap().len(), 1);
    assert_eq!(f.store.worklog(&id).unwrap().meta.status.as_str(), "in_progress");
}

#[test]
fn a_placeholder_or_a_section_breaking_retelling_is_refused_too() {
    let f = Fixture::new("quality");
    for bad in ["TODO", "n/a", "ok", "x"] {
        let err = f
            .store
            .start_work(&StartWork {
                agent: "a".into(),
                title: "Placeholder retelling".into(),
                body: BODY.into(),
                human: bad.into(),
                ..Default::default()
            })
            .unwrap_err();
        assert_eq!(err.kind(), "invalid_argument", "{bad}: {err}");
    }
    // A `##` heading inside the human text would end the section it lives in.
    let err = f
        .store
        .start_work(&StartWork {
            agent: "a".into(),
            title: "Heading in the retelling".into(),
            body: BODY.into(),
            human: "## The story\n\nIt broke, then it did not.".into(),
            ..Default::default()
        })
        .unwrap_err();
    assert!(err.to_string().contains("`## The story`"), "{err}");
    assert!(err.to_string().contains("**The story.**"), "says what to write: {err}");
}

#[test]
fn the_reserved_heading_cannot_arrive_through_an_agent_area_flag() {
    let f = Fixture::new("reserved");
    let smuggled = format!("{BODY}\n\n## For humans\n\nSmuggled in through the body.");
    let err = f
        .store
        .start_work(&StartWork {
            agent: "a".into(),
            title: "Reserved section in the body".into(),
            body: smuggled,
            human: HUMAN.into(),
            ..Default::default()
        })
        .unwrap_err();
    assert_eq!(err.kind(), "invalid_argument", "{err}");
    assert!(err.to_string().contains("reserved"), "{err}");
    assert!(err.to_string().contains("--body"), "names the flag: {err}");

    let id = f.start();
    // …and through every other agent-area flag too.
    let outcome = f
        .store
        .finish_work(
            &id,
            &FinishWork {
                agent: "a".into(),
                outcome: "Shipped.\n\n## For humans\n\nNot here either.".into(),
                human: HUMAN.into(),
                ..Default::default()
            },
        )
        .unwrap_err();
    assert!(outcome.to_string().contains("--outcome"), "{outcome}");
    let message = f
        .store
        .update_work(
            &id,
            "a",
            Some("Progress.\n\n## For humans\n\nNot here either."),
            None,
            None,
        )
        .unwrap_err();
    assert!(message.to_string().contains("--message"), "{message}");
    let bug = f.file_bug();
    let resolution = f
        .store
        .resolve_bug(
            &bug,
            "a",
            "Fixed it.\n\n## For humans\n\nNot here either.",
            HUMAN,
            None,
        )
        .unwrap_err();
    assert!(resolution.to_string().contains("--resolution"), "{resolution}");

    // Nothing was written by any of them.
    assert_eq!(f.store.worklog(&id).unwrap().updates.len(), 0);
    assert_eq!(f.store.worklog(&id).unwrap().meta.status.as_str(), "in_progress");
}

/// Two leading spaces used to walk the reserved heading past the guard and onto disk.
///
/// The guard read the text the caller passed; the renderer wrote something else. `heading`
/// anchored at column 0, so `  ## For humans` was ordinary prose to it — but `sections`
/// trims a section body, stripping the indent off its first line, and `render` then wrote
/// the heading back flush left. Everything downstream believed it: the record held *two*
/// `## For humans` sections, `## What` came back empty although the CLI had just validated
/// it as non-empty, `view --json` carried a reserved-titled entry in `extraSections` (the
/// agent-area payload the app draws), and `doctor` failed the file the write had accepted.
#[test]
fn an_indented_reserved_heading_never_reaches_the_disk() {
    let f = Fixture::new("indented-reserved");

    for indent in ["  ", "    ", "\t"] {
        let body = format!(
            "## What\n\n{indent}## For humans\n\n{indent}Not the record's human area.\n\n\
             ## Why\n\nA real reason sentence here.\n\n## How\n\nA real approach sentence here."
        );
        let err = f
            .store
            .start_work(&StartWork {
                agent: "r".into(),
                title: "Reserved heading through --body".into(),
                body: body.clone(),
                human: HUMAN.into(),
                ..Default::default()
            })
            .unwrap_err();
        assert_eq!(err.kind(), "invalid_argument", "indent {indent:?}: {err}");
        assert!(err.to_string().contains("reserved"), "indent {indent:?}: {err}");
        assert!(err.to_string().contains("--body"), "names the flag: {err}");

        // …and the same body through `bug create`, the other section-shaped create.
        let bug = f
            .store
            .create_bug(&NewBug {
                agent: "r".into(),
                title: "Reserved heading through --body".into(),
                severity: Severity::Low,
                labels: vec![],
                refs: vec![],
                body: body.replace("## What", "## Report"),
                human: HUMAN.into(),
                created_at: None,
            })
            .unwrap_err();
        assert!(bug.to_string().contains("reserved"), "indent {indent:?}: {bug}");
        assert!(bug.to_string().contains("--body"), "{bug}");
    }

    // Nothing was written by any of them: no id was burned, no file exists.
    assert!(f.store.worklogs().unwrap().is_empty());
    assert!(f.store.bugs().unwrap().is_empty());

    // A legal record still writes, and holds exactly one reserved heading — at column 0,
    // last, with the agent area intact above it.
    let id = f.start();
    let raw = f.raw(&format!("worklogs/{id}.md"));
    assert_eq!(raw.matches("\n## For humans").count(), 1, "{raw}");
    let detail = f.store.worklog(&id).unwrap();
    assert!(!detail.what.trim().is_empty(), "the validated `## What` survives");
    assert!(detail.extra_sections.is_empty(), "{:?}", detail.extra_sections);
    assert_eq!(detail.human.as_deref(), Some(HUMAN));
    assert!(!detail.body.contains("For humans"), "the agent area is stripped: {}", detail.body);
}

#[test]
fn a_mutation_of_a_record_that_lacks_one_has_to_supply_it() {
    let f = Fixture::new("legacy-touch");
    f.legacy_work("WORK-0900");
    f.legacy_bug("BUG-0900");
    f.legacy_note("old-memory");

    // Every verb that can touch a legacy record refuses until it is given one…
    let refused = |err: agentmon_core::CoreError, what: &str| {
        assert_eq!(err.kind(), "invalid_argument", "{what}: {err}");
        assert!(err.to_string().contains("--human"), "{what}: {err}");
    };
    refused(
        f.store
            .update_work("WORK-0900", "a", Some("A note on an old record."), None, None)
            .unwrap_err(),
        "work update",
    );
    refused(
        f.store
            .comment_bug("BUG-0900", "a", Some("A comment on an old bug."), None, None)
            .unwrap_err(),
        "bug comment",
    );
    refused(
        f.store.claim_bug("BUG-0900", "a", None, None).unwrap_err(),
        "bug claim",
    );
    refused(
        f.store
            .update_note(
                "old-memory",
                &UpdateNote {
                    agent: "a".into(),
                    description: Some("A better one-line description.".into()),
                    ..Default::default()
                },
            )
            .unwrap_err(),
        "note update",
    );

    // …and gains one on that first touch.
    f.store
        .update_work(
            "WORK-0900",
            "a",
            Some("A note on an old record."),
            Some("This is an old piece of work, told plainly for the first time."),
            None,
        )
        .expect("the first touch may supply it");
    let w = f.store.worklog("WORK-0900").unwrap();
    assert!(w.human.as_deref().unwrap().starts_with("This is an old piece"));
    assert_eq!(w.updates.len(), 1, "the note landed too");

    f.store
        .claim_bug(
            "BUG-0900",
            "a",
            Some("Somebody has taken this one on; here is what it is about."),
            None,
        )
        .expect("claiming a legacy bug may supply it");
    assert!(f.store.bug("BUG-0900").unwrap().human.is_some());

    // Once a record has one, later mutations do not have to repeat it — it is kept.
    f.store
        .update_work("WORK-0900", "a", Some("A second note, no --human."), None, None)
        .expect("the record already has one");
    assert!(f
        .store
        .worklog("WORK-0900")
        .unwrap()
        .human
        .as_deref()
        .unwrap()
        .starts_with("This is an old piece"));
}

// ---------------------------------------------------------------------------
// refreshes
// ---------------------------------------------------------------------------

#[test]
fn a_refresh_writes_only_the_human_area_and_logs_one_human_updated() {
    let f = Fixture::new("refresh");
    let id = f.start();
    let bug = f.file_bug();
    let note = f.add_note("handoff-now");
    let before = f.store.events(None).unwrap().len();

    let w = f
        .store
        .update_work(&id, "second-agent", None, Some("A clearer retelling of the same work."), None)
        .expect("--human alone is a refresh");
    assert_eq!(w.event.event_type, "human_updated");
    assert_eq!(w.event.r#ref.as_deref(), Some(id.as_str()));
    assert_eq!(w.event.actor, "second-agent");
    assert!(w.event.summary.contains("clearer retelling"), "{}", w.event.summary);
    assert!(w.record.updates.is_empty(), "## Updates is untouched by a refresh");
    assert_eq!(w.record.human.as_deref(), Some("A clearer retelling of the same work."));
    assert_eq!(w.record.meta.status.as_str(), "in_progress", "nothing else moved");

    let b = f
        .store
        .comment_bug(&bug, "second-agent", None, Some("A clearer retelling of the same bug."), None)
        .expect("--human alone is a refresh");
    assert_eq!(b.event.event_type, "human_updated");
    assert!(b.record.comments.is_empty(), "## Comments is untouched by a refresh");
    assert_eq!(b.record.human.as_deref(), Some("A clearer retelling of the same bug."));

    let n = f
        .store
        .update_note(
            &note,
            &UpdateNote {
                agent: "second-agent".into(),
                human: Some("A clearer retelling of the same handoff.".into()),
                ..Default::default()
            },
        )
        .expect("--human alone is a refresh");
    assert_eq!(n.event.event_type, "human_updated");
    assert!(n.record.body.contains("Storage and validation are in"), "the body is kept");
    assert_eq!(n.record.human.as_deref(), Some("A clearer retelling of the same handoff."));

    // Exactly one event per refresh, and no second line for the mutation that carried it.
    assert_eq!(f.events("human_updated"), 3);
    assert_eq!(f.store.events(None).unwrap().len(), before + 3);

    // A mutation that changes the human area *and* something else logs its own event only.
    let both = f
        .store
        .update_work(
            &id,
            "second-agent",
            Some("A real progress note."),
            Some("And a fresh retelling with it."),
            None,
        )
        .unwrap();
    assert_eq!(both.event.event_type, "work_updated");
    assert_eq!(f.events("human_updated"), 3, "no double line");
    assert_eq!(both.record.updates.len(), 1);
    assert_eq!(both.record.human.as_deref(), Some("And a fresh retelling with it."));
}

#[test]
fn a_refresh_obeys_the_timestamp_rules() {
    let f = Fixture::new("refresh-time");
    let id = f
        .store
        .start_work(&StartWork {
            agent: "cli-builder".into(),
            title: "Backdated work".into(),
            body: BODY.into(),
            human: HUMAN.into(),
            started_at: Some("2026-08-10T09:00:00Z".into()),
            ..Default::default()
        })
        .unwrap()
        .id;

    let err = f
        .store
        .update_work(
            &id,
            "cli-builder",
            None,
            Some("A retelling stamped before the work began."),
            Some("2026-08-09T09:00:00Z"),
        )
        .unwrap_err();
    assert!(err.to_string().contains("started time"), "{err}");
    assert!(
        f.store.worklog(&id).unwrap().human.as_deref() == Some(HUMAN),
        "the rejected refresh wrote nothing"
    );

    let err = f
        .store
        .update_work(
            &id,
            "cli-builder",
            None,
            Some("A retelling stamped in the future."),
            Some("2099-01-01T00:00:00Z"),
        )
        .unwrap_err();
    assert!(err.to_string().contains("future"), "{err}");

    let ok = f
        .store
        .update_work(
            &id,
            "cli-builder",
            None,
            Some("A retelling stamped when it was really written."),
            Some("2026-08-11T09:00:00Z"),
        )
        .expect("a legal backdate");
    assert_eq!(ok.event.ts, "2026-08-11T09:00:00Z", "the event carries the real time");
}

#[test]
fn nothing_at_all_is_refused_by_name() {
    let f = Fixture::new("nothing");
    let id = f.start();
    let bug = f.file_bug();
    let err = f.store.update_work(&id, "a", None, None, None).unwrap_err();
    assert_eq!(err.kind(), "conflict", "{err}");
    assert!(err.to_string().contains("--human"), "{err}");
    let err = f.store.comment_bug(&bug, "a", None, None, None).unwrap_err();
    assert!(err.to_string().contains("--human"), "{err}");
    let note = f.add_note("handoff-now");
    let err = f
        .store
        .update_note(&note, &UpdateNote { agent: "a".into(), ..Default::default() })
        .unwrap_err();
    assert!(err.to_string().contains("--human"), "{err}");
}

// ---------------------------------------------------------------------------
// closing verbs replace it
// ---------------------------------------------------------------------------

#[test]
fn closing_a_record_replaces_the_human_area_rather_than_appending() {
    let f = Fixture::new("replace");
    let id = f.start();
    let done = f
        .store
        .finish_work(
            &id,
            &FinishWork {
                agent: "cli-builder".into(),
                outcome: "Shipped the storage half; cargo test --workspace is green.".into(),
                human: "It is finished: records now carry a plain-language telling, and the \
                        app refuses to save one without."
                    .into(),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(done.record.human.as_deref().unwrap().starts_with("It is finished"));

    let raw = f.raw(&format!("worklogs/{id}.md"));
    assert_eq!(raw.matches("## For humans").count(), 1, "one section, not two:\n{raw}");
    assert!(!raw.contains("Two agents kept overwriting"), "the old telling is gone:\n{raw}");
    // still last, after the outcome the close just wrote
    assert!(raw.find("## Outcome").unwrap() < raw.find("## For humans").unwrap());

    // The same for a bug's resolution, and for an abandoned record.
    let bug = f.file_bug();
    f.store
        .resolve_bug(
            &bug,
            "cli-builder",
            "Root cause: the filter lived in component state. Fix: it lives in the URL now. \
             Verified by the bug's own repro.",
            "The filter now survives going back, because the page remembers it in the address.",
            None,
        )
        .unwrap();
    let raw = f.raw(&format!("bugs/{bug}.md"));
    assert_eq!(raw.matches("## For humans").count(), 1, "{raw}");
    assert!(raw.find("## Resolution").unwrap() < raw.find("## For humans").unwrap());
    assert!(f
        .store
        .bug(&bug)
        .unwrap()
        .human
        .as_deref()
        .unwrap()
        .starts_with("The filter now survives"));

    let other = f.start();
    f.store
        .abandon_work(
            &other,
            &AbandonWork {
                agent: "cli-builder".into(),
                reason: "Superseded by the first record, which covers the same ground.".into(),
                human: "We stopped this one: another record covers the same work.".into(),
                at: None,
            },
        )
        .unwrap();
    assert!(f
        .store
        .worklog(&other)
        .unwrap()
        .human
        .as_deref()
        .unwrap()
        .starts_with("We stopped this one"));
}

// ---------------------------------------------------------------------------
// the unclosed fence — the one way a body could destroy the area it was given
// ---------------------------------------------------------------------------

/// An agent pastes a stack trace and forgets the closing ```. Every heading after it is
/// code, including the `## For humans` section agentmon appends last — so the record used
/// to save at exit 0 with `human: null`, the retelling leaked into `body`, and each repair
/// appended another swallowed heading. One typo, one unrepairable record, on all four
/// kinds and both transports. Now: refused, by flag, before anything is written.
#[test]
fn a_body_that_ends_inside_a_code_fence_is_refused_on_every_kind() {
    let f = Fixture::new("openfence");
    let open = "## What\n\nPasted a stack trace.\n\n## Why\n\nAgents paste logs, and the \
                closing fence is one character.\n\n## How\n\n```\nthread main panicked\n";

    let refused = |err: agentmon_core::CoreError, flag: &str| {
        assert_eq!(err.kind(), "invalid_argument", "{err}");
        let text = err.to_string();
        assert!(text.contains("code fence"), "says what is wrong: {text}");
        assert!(text.contains(flag), "names the flag {flag}: {text}");
        assert!(text.contains("For humans"), "says what it would cost: {text}");
    };

    // work start
    refused(
        f.store
            .start_work(&StartWork {
                agent: "a".into(),
                title: "Body ends inside a code block".into(),
                body: open.into(),
                human: HUMAN.into(),
                ..Default::default()
            })
            .unwrap_err(),
        "--body",
    );
    assert!(
        f.store.worklogs().unwrap().is_empty(),
        "the refusal did not burn a WORK id"
    );

    // bug create
    refused(
        f.store
            .create_bug(&NewBug {
                agent: "a".into(),
                title: "Report ends inside a code block".into(),
                severity: Severity::Low,
                labels: vec![],
                refs: vec![],
                body: "## Report\n\nIt printed:\n\n```\nError: EBUSY\n".into(),
                human: HUMAN.into(),
                created_at: None,
            })
            .unwrap_err(),
        "--body",
    );
    assert!(f.store.bugs().unwrap().is_empty(), "no BUG id was burned");

    // note add
    refused(
        f.store
            .add_note(&NewNote {
                agent: "a".into(),
                name: Some("half-fenced".into()),
                title: "A note that opens a fence".into(),
                note_type: NoteType::Memory,
                description: "The body opens a fence and never closes it.".into(),
                tags: vec![],
                refs: vec![],
                body: "Run this:\n\n```\nnpm run check:keys\n".into(),
                human: HUMAN.into(),
                at: None,
            })
            .unwrap_err(),
        "--body",
    );
    assert!(f.store.notes().unwrap().is_empty(), "no note was written");

    // the update flags: --message, --outcome, --reason, --resolution
    let id = f.start();
    refused(
        f.store
            .update_work(&id, "a", Some("Log:\n\n```\npanicked\n"), None, None)
            .unwrap_err(),
        "--message",
    );
    refused(
        f.store
            .finish_work(
                &id,
                &FinishWork {
                    agent: "a".into(),
                    outcome: "Shipped it. The run printed:\n\n```\n147 passed\n".into(),
                    human: HUMAN.into(),
                    ..Default::default()
                },
            )
            .unwrap_err(),
        "--outcome",
    );
    refused(
        f.store
            .abandon_work(
                &id,
                &AbandonWork {
                    agent: "a".into(),
                    reason: "Stopped, because of this:\n\n```\nE0063\n".into(),
                    human: HUMAN.into(),
                    at: None,
                },
            )
            .unwrap_err(),
        "--reason",
    );
    let bug = f.file_bug();
    refused(
        f.store
            .comment_bug(&bug, "a", Some("Seen again:\n\n```\nEBUSY\n"), None, None)
            .unwrap_err(),
        "--message",
    );
    refused(
        f.store
            .resolve_bug(
                &bug,
                "a",
                "Fixed by closing the handle. Verified:\n\n```\ncargo test\n",
                HUMAN,
                None,
            )
            .unwrap_err(),
        "--resolution",
    );

    // Nothing above touched the records: the work log still has its own human area, the
    // bug is still open, and neither file grew a second heading.
    let w = f.store.worklog(&id).unwrap();
    assert_eq!(w.human.as_deref(), Some(HUMAN));
    assert_eq!(w.meta.status.as_str(), "in_progress");
    assert_eq!(f.raw(&format!("worklogs/{id}.md")).matches("## For humans").count(), 1);
    assert_eq!(f.raw(&format!("bugs/{bug}.md")).matches("## For humans").count(), 1);

    // …and the human area cannot smuggle one in either.
    let err = f
        .store
        .update_work(&id, "a", None, Some("It broke like this:\n\n```\nlog line\n"), None)
        .unwrap_err();
    assert!(err.to_string().contains("code fence"), "{err}");
}

/// The same defect arriving from disk: a record hand-edited (or written by an older build)
/// whose agent area leaves a fence open cannot be given a human area at all. The write is
/// refused with the file named, instead of reporting success while `human` stays null and
/// the file grows one more `## For humans` per attempt.
#[test]
fn a_record_whose_stored_body_leaves_a_fence_open_refuses_the_repair() {
    let f = Fixture::new("legacyfence");
    let text = "---\nid: WORK-0001\ntitle: A record with an unclosed fence\nagent: old\n\
                status: in_progress\nstarted: 2026-08-01T09:00:00Z\nfinished: null\ntags: []\n\
                refs: []\nfiles: []\n---\n\n## What\n\nSomething real.\n\n## Why\n\nA reason.\n\n\
                ## How\n\n```\nthread main panicked\n";
    let dir = f.location.join(DATA_DIR).join("worklogs");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("WORK-0001.md"), text).unwrap();

    // Reading stays lenient: it is a record, it has no human area, and doctor says so.
    assert!(f.store.worklog("WORK-0001").unwrap().human.is_none());
    let report = agentmon_core::doctor::check(&f.store).unwrap();
    assert!(report.missing_human.contains(&"WORK-0001".to_string()));

    let err = f
        .store
        .update_work("WORK-0001", "a", None, Some(HUMAN), None)
        .unwrap_err();
    let msg = err.to_string();
    assert_eq!(err.kind(), "invalid_argument", "{msg}");
    assert!(msg.contains("WORK-0001"), "names the record: {msg}");
    assert!(msg.contains("code fence"), "{msg}");
    assert!(msg.contains("nothing was written"), "{msg}");
    assert_eq!(
        f.raw("worklogs/WORK-0001.md"),
        text,
        "the file is byte-identical: a refused write changes nothing"
    );
    assert!(f.store.worklog("WORK-0001").unwrap().human.is_none());

    // Closing the fence by hand (the repair doctor asks for) makes the same call work.
    fs::write(dir.join("WORK-0001.md"), format!("{text}```\n")).unwrap();
    f.store
        .update_work("WORK-0001", "a", None, Some(HUMAN), None)
        .expect("a balanced body accepts the human area");
    let w = f.store.worklog("WORK-0001").unwrap();
    assert_eq!(w.human.as_deref(), Some(HUMAN));
    assert!(w.body.contains("thread main panicked"), "the agent area is intact");
    assert_eq!(f.raw("worklogs/WORK-0001.md").matches("## For humans").count(), 1);
}

// ---------------------------------------------------------------------------
// one list of heading spellings, shared with the two other parsers
// ---------------------------------------------------------------------------

/// Every spelling of the reserved heading, driven through the real write path.
///
/// The list lives in reserved-heading-shapes.json because three parsers have to agree
/// about it and a list per parser is how they stopped agreeing: crates/…/body.rs (this
/// guard), scripts/project-fs.mjs (the browser transport) and src/lib/markdown-parse.ts
/// (what the app draws). Round 3's guard accepted a space after the hash run and nothing
/// else, so `##\tFor humans` in a `--body` was written at exit 0 and the Agent view drew a
/// level-2 heading reading "For humans" over prose saying it was not the human area; a
/// leading U+FEFF split the two *transports*, which is worse, because then the record has
/// two truths. scripts/markdown-smoke.mjs reads this same file and holds the other two
/// parsers to it.
/// Would a reader see this section title as the reserved heading? Written out here rather
/// than reached for inside the crate on purpose: the test has to be able to disagree with
/// the implementation it is checking.
fn drawn_as_reserved(title: &str) -> bool {
    // A character that paints nothing is not part of what the reader sees, so it is not
    // part of the title either — the hole this list grew for: `For humans` with a
    // zero-width space after it is eight glyphs and no more.
    let seen: String = title
        .chars()
        .filter(|c| {
            !matches!(*c as u32,
                0xad | 0x200b..=0x200f | 0x2060..=0x2064 | 0xfe00..=0xfe0f | 0xfeff)
        })
        .collect();
    let t = seen.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    let t = t.trim_end_matches(['#', ':', ' ', '\t']);
    t.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase() == "for humans"
}

#[test]
fn every_shape_in_the_shared_list_is_refused_or_allowed_as_the_list_says() {
    let raw = include_str!("reserved-heading-shapes.json");
    let doc: serde_json::Value = serde_json::from_str(raw).expect("the shape list is JSON");
    let shapes = doc["shapes"].as_array().expect("shapes[]");
    assert!(shapes.len() >= 20, "the list lost entries: {}", shapes.len());

    let f = Fixture::new("shapes");
    let mut refused = 0;
    let mut allowed = 0;

    for shape in shapes {
        let line = shape["line"].as_str().expect("line");
        let reserved = shape["reserved"].as_bool().expect("reserved");
        let why = shape["why"].as_str().unwrap_or("");
        let body = format!(
            "## What\n\nAdd the second half of the record write path.\n\n{line}\n\nThis is NOT \
             the record's human area.\n\n## Why\n\nEvery record here was written by hand, \
             which defeats the point.\n\n## How\n\nOne lock file guards id allocation."
        );
        let result = f.store.start_work(&StartWork {
            agent: "shapes".into(),
            title: "One heading spelling".into(),
            body: body.clone(),
            human: HUMAN.into(),
            ..Default::default()
        });

        if reserved {
            refused += 1;
            let err = result.unwrap_err();
            assert_eq!(err.kind(), "invalid_argument", "{line:?} ({why}): {err}");
            assert!(err.to_string().contains("reserved"), "{line:?} ({why}): {err}");
            assert!(err.to_string().contains("--body"), "{line:?}: names the flag");
        } else {
            allowed += 1;
            let written = result
                .unwrap_or_else(|e| panic!("{line:?} ({why}) should be ordinary text: {e}"));
            // …and it stayed ordinary text: the record's own human area is the one the
            // caller passed, and no reserved-titled section reached the agent payload.
            let detail = f.store.worklog(&written.id).unwrap();
            assert_eq!(detail.human.as_deref(), Some(HUMAN), "{line:?} ({why})");
            assert!(
                !detail.extra_sections.iter().any(|s| drawn_as_reserved(&s.title)),
                "{line:?} ({why}): a reserved-titled section reached the agent payload: {:?}",
                detail.extra_sections,
            );
            assert_eq!(
                f.raw(&format!("worklogs/{}.md", written.id))
                    .matches("\n## For humans")
                    .count(),
                1,
                "{line:?} ({why}): exactly one reserved heading on disk",
            );
        }
    }

    assert!(refused >= 15 && allowed >= 5, "{refused} refused, {allowed} allowed");
    // Nothing that was refused burned a WORK number: the ids on disk are the allowed ones.
    assert_eq!(f.store.worklogs().unwrap().len(), allowed);
}

/// A retelling made of characters that draw nothing never reaches the disk, and the mark a
/// text editor puts in front of a file never reaches the record.
///
/// Both halves are one bug: Rust's `trim` and JavaScript's disagree about U+FEFF, so
/// `--human-file` pointed at what Notepad and PowerShell write by default stored a leading
/// byte-order mark that the desktop reported and the browser did not, and a `--human` of
/// nothing but those marks was stored as a human area that the browser read back as
/// `null`. One record, two answers to "does it have one".
#[test]
fn a_human_area_of_invisible_characters_is_refused_and_a_bom_is_furniture() {
    let f = Fixture::new("invisible");

    for blank in ["\u{feff}".repeat(24), "\u{200b}".repeat(24)] {
        let err = f
            .store
            .start_work(&StartWork {
                agent: "cli-builder".into(),
                title: "A retelling with no ink in it".into(),
                body: BODY.into(),
                human: blank.clone(),
                ..Default::default()
            })
            .expect_err("characters that draw nothing are not a retelling");
        assert_eq!(err.kind(), "invalid_argument", "{blank:?}");
        assert!(err.to_string().contains("--human"), "{err}");
    }
    assert!(f.store.worklogs().unwrap().is_empty(), "nothing was written");

    // A UTF-8-with-BOM file: the mark comes off, so what is stored is what was written.
    let id = f
        .store
        .start_work(&StartWork {
            agent: "cli-builder".into(),
            title: "A retelling read out of a file a text editor saved".into(),
            body: BODY.into(),
            human: format!("\u{feff}{HUMAN}"),
            ..Default::default()
        })
        .expect("a byte-order mark is not a reason to refuse the write")
        .id;
    assert_eq!(f.store.worklog(&id).unwrap().human.as_deref(), Some(HUMAN));
    let raw = f.raw(&format!("worklogs/{id}.md"));
    assert!(!raw.contains('\u{feff}'), "no mark survives into the record");
}

#[test]
fn a_rewritten_record_keeps_its_human_area_through_unrelated_mutations() {
    let f = Fixture::new("survives");
    let bug = f.file_bug();
    f.store.claim_bug(&bug, "cli-builder", None, None).unwrap();
    f.store
        .comment_bug(&bug, "cli-builder", Some("Reproduced on a fresh profile."), None, None)
        .unwrap();
    let b = f.store.bug(&bug).unwrap();
    assert!(b.human.as_deref().unwrap().starts_with("If you filter the list"));
    assert_eq!(b.comments.len(), 1);
    let raw = f.raw(&format!("bugs/{bug}.md"));
    assert!(raw.find("## Comments").unwrap() < raw.find("## For humans").unwrap());
}
