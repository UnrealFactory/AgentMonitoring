//! `agentmon reconcile` — the full two-machine story (BUG-0027).
//!
//! Two clones of one repo allocate the same WORK-/BUG- numbers for different work while
//! offline; the first pull collides. The repair under test: the local, unpushed side
//! re-keys to ids free on both sides, everything pointing at it is rewritten in the same
//! move, and after the (union) merge the combined project is doctor-clean.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use agentmon_core::doctor;
use agentmon_core::{
    reconcile, NewBug, NewNote, NewProject, NoteType, ReconcileRequest, Severity, StartWork,
    Store,
};

// ---------------------------------------------------------------------------
// harness: one origin project, cloned to two "machines"
// ---------------------------------------------------------------------------

struct TwoClones {
    base: PathBuf,
    /// The side that pushed first — reconcile reads it and never writes it.
    incoming: Store,
    incoming_dir: PathBuf,
    /// The side that has to move — reconcile re-keys here.
    local: Store,
    local_dir: PathBuf,
}

impl Drop for TwoClones {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

fn copy_dir(src: &Path, dst: &Path) {
    fs::create_dir_all(dst).unwrap();
    for entry in fs::read_dir(src).unwrap() {
        let entry = entry.unwrap();
        let to = dst.join(entry.file_name());
        if entry.path().is_dir() {
            copy_dir(&entry.path(), &to);
        } else {
            fs::copy(entry.path(), &to).unwrap();
        }
    }
}

const HUMAN: &str = "A plain-words retelling of this record, long enough to be a real one.";

fn body(tag: &str) -> String {
    format!(
        "## What\n\nThe {tag} side of the two-machine fixture.\n\n## Why\n\nTwo clones \
         allocating ids offline must collide, and this record is one half of that.\n\n\
         ## How\n\nWritten through the normal CLI path, so the fixture is a legal record.\n"
    )
}

fn start(store: &Store, agent: &str, title: &str, tag: &str, refs: &[&str]) -> String {
    store
        .start_work(&StartWork {
            agent: agent.into(),
            title: title.into(),
            refs: refs.iter().map(|r| r.to_string()).collect(),
            body: body(tag),
            human: HUMAN.into(),
            ..Default::default()
        })
        .expect("work start")
        .id
}

fn file_bug(store: &Store, agent: &str, title: &str, refs: &[&str]) -> String {
    store
        .create_bug(&NewBug {
            agent: agent.into(),
            title: title.into(),
            severity: Severity::Medium,
            labels: vec![],
            refs: refs.iter().map(|r| r.to_string()).collect(),
            body: "## Report\n\nRepro: run both machines offline. Expected: distinct ids. \
                   Actual: the same number twice."
                .into(),
            human: HUMAN.into(),
            created_at: None,
        })
        .expect("bug create")
        .id
}

/// Origin: one shared work log and one shared bug, then two clones.
fn two_clones(tag: &str) -> TwoClones {
    let base = std::env::temp_dir().join(format!(
        "agentmon-reconcile-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let origin = base.join("origin");
    fs::create_dir_all(&origin).unwrap();
    let store = Store::init(
        &origin,
        &NewProject {
            name: "Two machines".into(),
            description: "The BUG-0027 repro, in miniature.".into(),
            actor: "origin".into(),
            ..Default::default()
        },
    )
    .expect("init");
    start(&store, "origin", "Shared work from before the fork", "shared", &[]);
    file_bug(&store, "origin", "Shared bug from before the fork", &[]);

    let a = base.join("machine-a");
    let b = base.join("machine-b");
    copy_dir(&origin, &a);
    copy_dir(&origin, &b);
    let incoming = Store::open(&a).unwrap();
    let local = Store::open(&b).unwrap();
    let incoming_dir = incoming.root().to_path_buf();
    let local_dir = local.root().to_path_buf();
    TwoClones {
        base,
        incoming,
        incoming_dir,
        local,
        local_dir,
    }
}

/// The divergence from BUG-0027, in miniature: both machines allocate WORK-0002 and
/// BUG-0002 for different work; the local machine also writes records that point at its
/// own WORK-0002 by refs, by bare prose mention, and from a note.
fn diverge(tc: &TwoClones) {
    // Machine A (already pushed): its own WORK-0002 and BUG-0002.
    start(&tc.incoming, "agent-a", "A's take on the watcher", "incoming", &[]);
    file_bug(&tc.incoming, "agent-a", "A's bug about the watcher", &[]);

    // Machine B (unpushed): the same numbers, different work — plus the web of local
    // references that has to move with them.
    let w = start(&tc.local, "agent-b", "B's cache rewrite", "local", &[]);
    assert_eq!(w, "WORK-0002", "the collision the fixture is about");
    tc.local
        .update_work(
            &w,
            "agent-b",
            Some("Halfway: the cache holds; invalidation on WORK-0002 still missing."),
            None,
            None,
        )
        .expect("a progress note, so the event pairing survives the re-key");
    let follow = tc
        .local
        .start_work(&StartWork {
            agent: "agent-b".into(),
            title: "Follow-up that leans on WORK-0002".into(),
            refs: vec![w.clone()],
            body: "## What\n\nBuilds on WORK-0002 directly.\n\n## Why\n\nWORK-0002 left \
                   invalidation open; not WORK-00020, not xWORK-0002.\n\n## How\n\nSee \
                   WORK-0002's outcome.\n"
                .into(),
            human: HUMAN.into(),
            ..Default::default()
        })
        .expect("follow-up work")
        .id;
    assert_eq!(follow, "WORK-0003");
    let bug = file_bug(&tc.local, "agent-b", "B's bug: cache misses on rename", &[&w]);
    assert_eq!(bug, "BUG-0002");
    tc.local
        .add_note(&NewNote {
            agent: "agent-b".into(),
            name: Some("cache-gotcha".into()),
            title: "The cache gotcha".into(),
            note_type: NoteType::Memory,
            description: "Where the cache work stands.".into(),
            tags: vec![],
            refs: vec![w.clone()],
            body: "WORK-0002 caches per screen; the [[cache-gotcha]] shape stays a note \
                   link and never re-keys."
                .into(),
            human: HUMAN.into(),
            at: None,
        })
        .expect("note referencing the colliding id");
}

fn read(p: &Path) -> String {
    fs::read_to_string(p).unwrap()
}

// ---------------------------------------------------------------------------
// the flow
// ---------------------------------------------------------------------------

#[test]
fn dry_run_plans_everything_and_writes_nothing() {
    let tc = two_clones("dry");
    diverge(&tc);

    let plan = reconcile(
        &tc.local,
        &ReconcileRequest {
            theirs: tc.incoming_dir.clone(),
            ..Default::default()
        },
    )
    .expect("dry run");

    assert!(!plan.applied);
    let moves: Vec<(String, String)> = plan
        .mappings
        .iter()
        .map(|m| (m.from.clone(), m.to.clone()))
        .collect();
    // Next free on BOTH sides: local holds WORK-0001..3, incoming WORK-0001..2 → 0004.
    assert_eq!(
        moves,
        [
            ("WORK-0002".to_string(), "WORK-0004".to_string()),
            ("BUG-0002".to_string(), "BUG-0003".to_string()),
        ],
        "{moves:?}"
    );
    let m = plan.mappings.iter().find(|m| m.from == "WORK-0002").unwrap();
    assert_eq!(m.local_title, "B's cache rewrite");
    assert_eq!(m.incoming_title, "A's take on the watcher");

    // The shared pre-fork records are recognized as already synced, not moved.
    assert!(
        plan.skipped
            .iter()
            .any(|s| s.id == "WORK-0001" && s.reason == "identical"),
        "{:?}",
        plan.skipped
    );

    // The plan names the follow-up record and the note as rewrites, not renames.
    let rewritten: Vec<&str> = plan
        .files
        .iter()
        .filter(|f| f.renamed_to.is_none())
        .map(|f| f.path.as_str())
        .collect();
    assert!(rewritten.contains(&"worklogs/WORK-0003.md"), "{rewritten:?}");
    assert!(rewritten.contains(&"notes/cache-gotcha.md"), "{rewritten:?}");
    assert!(plan.events.refs > 0, "events.jsonl ref fields counted: {:?}", plan.events);

    // Nothing on disk moved: a dry run is a promise.
    assert!(tc.local_dir.join("worklogs/WORK-0002.md").is_file());
    assert!(!tc.local_dir.join("worklogs/WORK-0004.md").exists());
    assert!(!tc.local_dir.join(".gitattributes").exists());
    assert!(
        read(&tc.local_dir.join("worklogs/WORK-0003.md")).contains("WORK-0002"),
        "references untouched on a dry run"
    );
}

#[test]
fn apply_re_keys_rewrites_and_the_merged_result_is_doctor_clean() {
    let tc = two_clones("apply");
    diverge(&tc);

    let plan = reconcile(
        &tc.local,
        &ReconcileRequest {
            theirs: tc.incoming_dir.clone(),
            apply: true,
            actor: "recovery-agent".into(),
            ..Default::default()
        },
    )
    .expect("apply");
    assert!(plan.applied);

    // The local records moved; the incoming side was never written.
    assert!(!tc.local_dir.join("worklogs/WORK-0002.md").exists());
    let moved = read(&tc.local_dir.join("worklogs/WORK-0004.md"));
    assert!(moved.contains("id: WORK-0004"), "{moved}");
    assert!(moved.contains("B's cache rewrite"), "{moved}");
    assert!(
        moved.contains("invalidation on WORK-0004 still missing"),
        "its own prose mention moved with it: {moved}"
    );
    let incoming_untouched = read(&tc.incoming_dir.join("worklogs/WORK-0002.md"));
    assert!(incoming_untouched.contains("A's take on the watcher"));

    // Every local pointer moved in the same breath: refs, prose (word-bounded), the note.
    let follow = read(&tc.local_dir.join("worklogs/WORK-0003.md"));
    assert!(follow.contains("refs: [WORK-0004]") || follow.contains("- WORK-0004"), "{follow}");
    assert!(!follow.contains("WORK-0002'"), "{follow}");
    assert!(follow.contains("Builds on WORK-0004 directly"), "{follow}");
    assert!(follow.contains("not WORK-00020, not xWORK-0002"), "longer/welded tokens stay: {follow}");
    let note = read(&tc.local_dir.join("notes/cache-gotcha.md"));
    assert!(note.contains("WORK-0004 caches per screen"), "{note}");
    assert!(note.contains("[[cache-gotcha]]"), "note links stay note links: {note}");

    // events.jsonl: the moved ids' events follow, and the re-key logged its own line.
    let events = read(&tc.local_dir.join("events.jsonl"));
    assert!(!events.contains("\"ref\":\"WORK-0002\""), "{events}");
    assert!(events.contains("\"ref\":\"WORK-0004\""), "{events}");
    assert!(events.contains("\"ref\":\"BUG-0003\""), "{events}");
    assert!(
        events.contains("Reconciled 2 colliding record ids"),
        "the feed says what happened: {events}"
    );

    // The merge rule travels with the folder.
    let attrs = read(&tc.local_dir.join(".gitattributes"));
    assert!(attrs.contains("events.jsonl merge=union"), "{attrs}");

    // -- simulate the git pull that now succeeds ------------------------------
    // Records: no path collides any more, so the incoming files simply arrive.
    for sub in ["worklogs", "bugs", "notes"] {
        let dir = tc.incoming_dir.join(sub);
        if !dir.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&dir).unwrap() {
            let entry = entry.unwrap();
            let dest = tc.local_dir.join(sub).join(entry.file_name());
            if !dest.exists() {
                fs::copy(entry.path(), &dest).unwrap();
            }
        }
    }
    // events.jsonl: merge=union keeps both sides' lines (shared prefix once).
    let local_lines = read(&tc.local_dir.join("events.jsonl"));
    let seen: HashSet<&str> = local_lines.lines().collect();
    let mut merged: Vec<String> = local_lines.lines().map(str::to_string).collect();
    for line in read(&tc.incoming_dir.join("events.jsonl")).lines() {
        if !seen.contains(line) {
            merged.push(line.to_string());
        }
    }
    fs::write(
        tc.local_dir.join("events.jsonl"),
        format!("{}\n", merged.join("\n")),
    )
    .unwrap();

    // The merged project holds both machines' work under distinct ids, and doctor
    // (strict: warnings fail too) finds nothing wrong with any of it.
    let store = Store::open(&tc.local_dir).unwrap();
    assert_eq!(store.worklogs().unwrap().len(), 4, "0001, 0002(A), 0003(B), 0004(B)");
    assert_eq!(store.bugs().unwrap().len(), 3, "0001, 0002(A), 0003(B)");
    let report = doctor::check(&store).expect("doctor runs");
    assert_eq!(report.errors(), 0, "{:#?}", report.problems);
    assert_eq!(report.warnings(), 0, "{:#?}", report.problems);
}

#[test]
fn already_synced_clones_have_nothing_to_do_and_only_refuses_an_identical_id() {
    let tc = two_clones("synced");
    // No divergence at all: the clones are byte-identical.
    let plan = reconcile(
        &tc.local,
        &ReconcileRequest {
            theirs: tc.incoming_dir.clone(),
            ..Default::default()
        },
    )
    .expect("dry run");
    assert!(plan.is_empty(), "{:?}", plan.mappings);
    assert!(
        plan.skipped.iter().all(|s| s.reason == "identical"),
        "{:?}",
        plan.skipped
    );

    // Asking to re-key an already-synced id by name is refused, not silently obeyed:
    // re-keying it would split one record into two copies of itself.
    let err = reconcile(
        &tc.local,
        &ReconcileRequest {
            theirs: tc.incoming_dir.clone(),
            only: vec!["WORK-0001".into()],
            ..Default::default()
        },
    )
    .expect_err("identical + --only refuses");
    assert_eq!(err.kind(), "conflict", "{err}");
    assert!(err.to_string().contains("already synced"), "{err}");

    // …and so is an --only that names an id which does not collide at all.
    let err = reconcile(
        &tc.local,
        &ReconcileRequest {
            theirs: tc.incoming_dir.clone(),
            only: vec!["WORK-0099".into()],
            ..Default::default()
        },
    )
    .expect_err("a typo on a history-rewriting command must not no-op");
    assert!(err.to_string().contains("WORK-0099"), "{err}");
}

#[test]
fn the_same_record_edited_on_both_sides_is_a_content_merge_not_a_re_key() {
    let tc = two_clones("diverged");
    // Both machines annotate the SAME pre-fork record with different notes: one identity,
    // two texts. Re-keying would fork the record's history — reconcile leaves it to git.
    tc.incoming
        .update_work("WORK-0001", "agent-a", Some("A's later annotation on the shared record."), None, None)
        .unwrap();
    tc.local
        .update_work("WORK-0001", "agent-b", Some("B's different annotation on the same record."), None, None)
        .unwrap();

    let plan = reconcile(
        &tc.local,
        &ReconcileRequest {
            theirs: tc.incoming_dir.clone(),
            ..Default::default()
        },
    )
    .expect("dry run");
    assert!(plan.is_empty(), "{:?}", plan.mappings);
    assert!(
        plan.skipped
            .iter()
            .any(|s| s.id == "WORK-0001" && s.reason == "diverged"),
        "{:?}",
        plan.skipped
    );
}

#[test]
fn chained_collisions_re_key_past_every_number_either_side_holds() {
    let tc = two_clones("chain");
    // Both sides allocate WORK-0002 AND WORK-0003, all four different records: the first
    // re-key target may not land on 0003 (taken twice over), and the second not on 0004.
    start(&tc.incoming, "agent-a", "A's second", "incoming", &[]);
    start(&tc.incoming, "agent-a", "A's third", "incoming", &[]);
    let b2 = start(&tc.local, "agent-b", "B's second, citing nobody", "local", &[]);
    let b3 = start(&tc.local, "agent-b", "B's third, citing WORK-0002", "local", &[&b2]);
    assert_eq!((b2.as_str(), b3.as_str()), ("WORK-0002", "WORK-0003"));

    let plan = reconcile(
        &tc.local,
        &ReconcileRequest {
            theirs: tc.incoming_dir.clone(),
            apply: true,
            actor: "recovery-agent".into(),
            ..Default::default()
        },
    )
    .expect("apply");
    let moves: Vec<(String, String)> = plan
        .mappings
        .iter()
        .map(|m| (m.from.clone(), m.to.clone()))
        .collect();
    assert_eq!(
        moves,
        [
            ("WORK-0002".to_string(), "WORK-0004".to_string()),
            ("WORK-0003".to_string(), "WORK-0005".to_string()),
        ],
        "{moves:?}"
    );
    // The cross-reference between the two moved records followed exactly one hop:
    // 0003's mention of 0002 now reads 0004 inside the file that is now 0005.
    let moved = read(&tc.local_dir.join("worklogs/WORK-0005.md"));
    assert!(moved.contains("citing WORK-0004"), "{moved}");
    assert!(!tc.local_dir.join("worklogs/WORK-0003.md").exists());

    // --only selects: with only WORK-0002 named, WORK-0003 stays put.
    let tc2 = two_clones("only");
    start(&tc2.incoming, "agent-a", "A's second", "incoming", &[]);
    start(&tc2.incoming, "agent-a", "A's third", "incoming", &[]);
    start(&tc2.local, "agent-b", "B's second", "local", &[]);
    start(&tc2.local, "agent-b", "B's third", "local", &[]);
    let plan = reconcile(
        &tc2.local,
        &ReconcileRequest {
            theirs: tc2.incoming_dir.clone(),
            only: vec!["work-0002".into()], // case-insensitive in, canonical out
            ..Default::default()
        },
    )
    .expect("dry run");
    assert_eq!(plan.mappings.len(), 1);
    assert_eq!(plan.mappings[0].from, "WORK-0002");
    assert!(
        plan.skipped
            .iter()
            .any(|s| s.id == "WORK-0003" && s.reason == "not-selected"),
        "{:?}",
        plan.skipped
    );
}

#[test]
fn reconcile_refuses_itself_and_a_different_project() {
    let tc = two_clones("refuse");
    // Pointing --theirs at the local project itself is a usage mistake, said plainly.
    let err = reconcile(
        &tc.local,
        &ReconcileRequest {
            theirs: tc.local_dir.clone(),
            ..Default::default()
        },
    )
    .expect_err("self-reconcile refuses");
    assert!(err.to_string().contains("itself"), "{err}");

    // Two folders that were never one project have two numbering schemes, not collisions.
    let other_loc = tc.base.join("other");
    fs::create_dir_all(&other_loc).unwrap();
    let other = Store::init(
        &other_loc,
        &NewProject {
            name: "Unrelated".into(),
            actor: "t".into(),
            ..Default::default()
        },
    )
    .unwrap();
    let err = reconcile(
        &tc.local,
        &ReconcileRequest {
            theirs: other.root().to_path_buf(),
            ..Default::default()
        },
    )
    .expect_err("different project ids refuse");
    assert!(err.to_string().contains("different projects"), "{err}");
}
