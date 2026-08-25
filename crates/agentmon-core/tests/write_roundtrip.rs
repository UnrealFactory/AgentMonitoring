//! Round-trip tests: everything the CLI writes must come back out of the reader the app
//! uses, unchanged. These run against a real temp directory — no in-memory filesystem —
//! because half the invariants here are about `rename`, `create_new` and lock files.

use std::fs;
use std::path::{Path, PathBuf};

use agentmon_core::doctor::{self, Level};
use agentmon_core::{
    BugStatus, FinishWork, NewBug, NewNote, NewProject, Severity, StartWork, Store, UpdateNote,
    WorkStatus, DATA_DIR,
};

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

struct TempProject {
    /// The location the human picked; the store's data folder is `location/AgentMonitoring`.
    location: PathBuf,
    store: Store,
}

impl TempProject {
    fn new(tag: &str) -> TempProject {
        let location = std::env::temp_dir().join(format!(
            "agentmon-test-{tag}-{}-{}",
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
                name: "Demo".into(),
                description: "A project used by the agentmon-core tests.".into(),
                tags: vec!["test".into()],
                actor: "test-runner".into(),
                at: None,
            },
        )
        .expect("init");
        TempProject { location, store }
    }

    fn path(&self, rel: &str) -> PathBuf {
        self.location.join(DATA_DIR).join(rel)
    }
}

impl Drop for TempProject {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.location);
    }
}

const BODY: &str = "## What\n\nWire the notify watcher into the Tauri shell so the desktop \
app live-refreshes.\n\n## Why\n\nThe desktop app currently shows whatever the project held when a \
screen was opened; browser mode already reloads, which makes the product look less live than its \
own dev harness.\n\n## How\n\nA recommended_watcher on each registered AgentMonitoring folder, \
debounced 250ms, emitting `project-changed` with the project id.\n";

/// The retelling every `--message` re-passes: a note travels with its human area now
/// (SPEC.md, "The human area" — owner directive, 2026-08-24).
const HUMAN: &str = "A plain-words retelling of this record, long enough to be a real one.";

const OUTCOME: &str = "Shipped the watcher: src-tauri/src/lib.rs starts one per registered \
project in setup() and re-arms them when the registry changes. Verified with cargo check -p \
agentmonitoring and by editing a record with the app open.";

fn start(tp: &TempProject, title: &str) -> String {
    tp.store
        .start_work(&StartWork {
            agent: "cli-builder".into(),
            title: title.into(),
            tags: vec!["tauri".into(), "rust".into()],
            refs: vec![],
            body: BODY.into(),
            human: "We are starting a piece of work; this line says in plain words what it is for.".into(),
            started_at: None,
        })
        .expect("work start")
        .id
}

// ---------------------------------------------------------------------------
// work: write -> parse -> matches
// ---------------------------------------------------------------------------

#[test]
fn work_start_writes_a_record_the_reader_understands() {
    let tp = TempProject::new("work-start");
    let w = tp
        .store
        .start_work(&StartWork {
            agent: "cli-builder".into(),
            title: "Wire the change watcher into the desktop app".into(),
            tags: vec!["tauri".into(), "live-updates".into()],
            refs: vec!["bug-0002".into()], // lowercase in, canonical out
            body: BODY.into(),
            human: "We are starting a piece of work; this line says in plain words what it is for.".into(),
            started_at: None,
        })
        .unwrap();

    assert_eq!(w.id, "WORK-0001");
    assert!(Path::new(&w.path).is_file(), "record file exists: {}", w.path);

    let d = tp.store.worklog("WORK-0001").unwrap();
    assert_eq!(d.meta.title, "Wire the change watcher into the desktop app");
    assert_eq!(d.meta.agent, "cli-builder");
    assert_eq!(d.meta.status, WorkStatus::InProgress);
    assert!(d.meta.finished.is_none());
    assert_eq!(d.meta.tags, vec!["tauri", "live-updates"]);
    assert_eq!(d.meta.refs, vec!["BUG-0002"]);
    assert!(d.what.contains("notify watcher"));
    assert!(d.why.contains("browser mode already reloads"));
    assert!(d.how.contains("debounced 250ms"));
    assert!(d.outcome.is_none());
    assert!(d.updates.is_empty());
    assert_eq!(d.meta.started.len(), 20, "{}", d.meta.started);

    // the event is on disk, with the right type and ref
    let events = tp.store.events(None).unwrap();
    let started = events.iter().find(|e| e.event_type == "work_started").unwrap();
    assert_eq!(started.r#ref.as_deref(), Some("WORK-0001"));
    assert_eq!(started.actor, "cli-builder");
    assert_eq!(w.event.ts, started.ts);
}

#[test]
fn update_then_done_round_trips_through_the_reader() {
    let tp = TempProject::new("work-done");
    let id = start(&tp, "Wire the change watcher into the desktop app");

    tp.store
        .update_work(&id, "cli-builder", Some("Watcher is running; a single save produced four raw notify events, so the debounce is not optional."), Some(HUMAN), None)
        .unwrap();
    tp.store
        .update_work(&id, "cli-builder", Some("Debounce set to 250ms; one reload per save."), Some(HUMAN), None)
        .unwrap();
    tp.store
        .finish_work(
            &id,
            &FinishWork {
                agent: "cli-builder".into(),
                outcome: OUTCOME.into(),
                files: vec!["src-tauri/src/lib.rs".into(), "src-tauri/Cargo.toml".into()],
                refs: vec!["BUG-0002".into()],
                human: "The work is finished. In plain words: it does what it set out to do, and the tests say so.".into(),
                finished_at: None,
                started_at: None,
            },
        )
        .unwrap();

    let d = tp.store.worklog(&id).unwrap();
    assert_eq!(d.meta.status, WorkStatus::Done);
    assert!(d.meta.finished.is_some());
    assert_eq!(d.updates.len(), 2);
    assert!(d.updates[0].body.contains("four raw notify events"));
    assert!(d.updates[1].body.contains("250ms"));
    assert_eq!(d.updates[0].ts.len(), 20);
    assert!(d.updates[0].ts <= d.updates[1].ts, "updates stay in order");
    assert_eq!(d.outcome.as_deref().unwrap(), OUTCOME);
    assert_eq!(d.meta.files, vec!["src-tauri/src/lib.rs", "src-tauri/Cargo.toml"]);
    assert_eq!(d.meta.refs, vec!["BUG-0002"]);
    // What/Why/How survived two rewrites untouched
    assert!(d.what.contains("notify watcher"));
    assert!(d.how.contains("debounced 250ms"));

    // section order on disk is the canonical one
    let raw = fs::read_to_string(tp.path(&format!("worklogs/{}.md", d.meta.id))).unwrap();
    let order: Vec<usize> = ["## What", "## Why", "## How", "## Updates", "## Outcome"]
        .iter()
        .map(|h| raw.find(h).unwrap_or_else(|| panic!("{h} present in:\n{raw}")))
        .collect();
    assert!(order.windows(2).all(|w| w[0] < w[1]), "sections in order: {order:?}");

    let types: Vec<String> = tp
        .store
        .events(None)
        .unwrap()
        .iter()
        .map(|e| e.event_type.clone())
        .collect();
    assert_eq!(types.iter().filter(|t| *t == "work_updated").count(), 2);
    assert_eq!(types.iter().filter(|t| *t == "work_done").count(), 1);
}

/// A finished record cannot be re-finished, re-started or rewritten — but it can still be
/// corrected, because that is the only honest repair an append-only record house has.
#[test]
fn a_finished_work_log_takes_corrections_but_never_changes_state() {
    let tp = TempProject::new("immutable");
    let id = start(&tp, "Wire the change watcher into the desktop app");
    tp.store
        .finish_work(
            &id,
            &FinishWork {
                agent: "cli-builder".into(),
                outcome: OUTCOME.into(),
                files: vec![],
                refs: vec![],
                human: "The work is finished. In plain words: it does what it set out to do, and the tests say so.".into(),
                finished_at: Some("2026-01-05T12:00:00Z".into()),
                started_at: Some("2026-01-05T09:00:00Z".into()),
            },
        )
        .unwrap();
    let done = tp.store.worklog(&id).unwrap();

    // A correction cannot be backdated into the run it corrects: 10:00 is after the start
    // (09:00) and after every note already there, and still refused, because the record
    // closed at 12:00 and a note before that would draw itself inside a finished run.
    let err = tp
        .store
        .update_work(&id, "reviewer", Some("Backdated afterthought."), Some(HUMAN), Some("2026-01-05T10:00:00Z"))
        .unwrap_err();
    assert_eq!(err.kind(), "invalid_argument");
    assert!(err.to_string().contains("closed"), "says what it is behind: {err}");

    let w = tp
        .store
        .update_work(&id, "reviewer", Some("Correction: the note above says four workers; the config says two."), Some(HUMAN), None)
        .expect("a correction may be appended to a finished record");
    assert_eq!(w.event.event_type, "work_updated", "still a work_updated event");
    let after = tp.store.worklog(&id).unwrap();
    assert_eq!(after.meta.status, WorkStatus::Done, "the status does not move");
    assert_eq!(after.meta.finished, done.meta.finished, "nor does the finish time");
    assert_eq!(after.outcome, done.outcome, "nor the outcome");
    assert_eq!(after.what, done.what, "and nothing above Updates is rewritten");
    assert_eq!(after.updates.len(), done.updates.len() + 1, "the note is appended");
    let last = after.updates.last().unwrap();
    assert!(last.body.contains("Correction: the note above"), "{last:?}");
    assert!(last.body.contains("_Update by reviewer._"), "who wrote it survives: {last:?}");
    assert!(last.ts >= *done.meta.finished.as_ref().unwrap(), "dated at or after the close");
    assert_eq!(
        after.last_activity, last.ts,
        "the record's last activity is the correction, not the close"
    );

    let err = tp
        .store
        .finish_work(
            &id,
            &FinishWork {
                agent: "cli-builder".into(),
                outcome: OUTCOME.into(),
                files: vec![],
                refs: vec![],
                human: "The work is finished. In plain words: it does what it set out to do, and the tests say so.".into(),
                finished_at: None,
                started_at: None,
            },
        )
        .unwrap_err();
    assert_eq!(err.kind(), "conflict");
}

#[test]
fn done_requires_a_real_outcome_and_prints_the_template() {
    let tp = TempProject::new("outcome");
    let id = start(&tp, "Wire the change watcher into the desktop app");
    for bad in ["", "done", "fixed", "ok"] {
        let err = tp
            .store
            .finish_work(
                &id,
                &FinishWork {
                    agent: "cli-builder".into(),
                    outcome: bad.into(),
                    files: vec![],
                    refs: vec![],
                    human: "The work is finished. In plain words: it does what it set out to do, and the tests say so.".into(),
                    finished_at: None,
                    started_at: None,
                },
            )
            .unwrap_err();
        assert_eq!(err.kind(), "invalid_body", "{bad:?} should be rejected");
        let text = err.to_string();
        assert!(text.contains("agentmon work done"), "example printed: {text}");
    }
    // and the record was not touched
    assert_eq!(tp.store.worklog(&id).unwrap().meta.status, WorkStatus::InProgress);
}

#[test]
fn start_rejects_a_body_without_what_why_how() {
    let tp = TempProject::new("body");
    let err = tp
        .store
        .start_work(&StartWork {
            agent: "cli-builder".into(),
            title: "Something".into(),
            tags: vec![],
            refs: vec![],
            body: "## What\n\nI did the thing and it works now.\n".into(),
            human: "We are starting a piece of work; this line says in plain words what it is for.".into(),
            started_at: None,
        })
        .unwrap_err();
    assert_eq!(err.kind(), "invalid_body");
    let text = err.to_string();
    assert!(text.contains("missing the `## Why` section"), "{text}");
    assert!(text.contains("missing the `## How` section"), "{text}");
    // nothing was written
    assert!(tp.store.worklogs().unwrap().is_empty());
    assert!(tp
        .store
        .events(None)
        .unwrap()
        .iter()
        .all(|e| e.event_type != "work_started"));
}

// ---------------------------------------------------------------------------
// bugs
// ---------------------------------------------------------------------------

const REPORT: &str = "## Report\n\nRepro:\n\n1. `npm run tauri:dev`, open the dashboard.\n2. \
Append a record with `agentmon work start`.\n\nExpected: the feed picks it up within a second. \
Actual: nothing changes until the route is re-entered.\n";

fn file_bug(tp: &TempProject) -> String {
    tp.store
        .create_bug(&NewBug {
            agent: "ui-builder".into(),
            title: "Desktop app shows stale records".into(),
            severity: Severity::High,
            labels: vec!["tauri".into(), "live-updates".into()],
            refs: vec![],
            body: REPORT.into(),
            human: "Something is wrong with the app, written out for someone who does not read code.".into(),
            created_at: None,
        })
        .expect("bug create")
        .id
}

#[test]
fn bug_lifecycle_round_trips() {
    let tp = TempProject::new("bug-life");
    let id = file_bug(&tp);
    assert_eq!(id, "BUG-0001");

    let b = tp.store.bug(&id).unwrap();
    assert_eq!(b.meta.status, BugStatus::Open);
    assert_eq!(b.meta.severity, Severity::High);
    assert_eq!(b.meta.reporter, "ui-builder");
    assert!(b.meta.assignee.is_none());
    assert!(b.report.contains("npm run tauri:dev"));
    assert!(b.resolution.is_none());

    tp.store.claim_bug(&id, "cli-builder", None, None).unwrap();
    let b = tp.store.bug(&id).unwrap();
    assert_eq!(b.meta.status, BugStatus::InProgress);
    assert_eq!(b.meta.assignee.as_deref(), Some("cli-builder"));
    assert!(b.meta.claimed.is_some());

    tp.store
        .comment_bug(&id, "cli-builder", Some("Root cause: the Tauri shell never started a watcher, so `project-changed` was never emitted."), Some(HUMAN), None)
        .unwrap();
    let b = tp.store.bug(&id).unwrap();
    assert_eq!(b.comments.len(), 1);
    assert_eq!(b.comments[0].agent, "cli-builder");
    assert_eq!(b.comments[0].ts.len(), 20);
    assert!(b.comments[0].body.contains("never started a watcher"));

    tp.store
        .resolve_bug(&id, "cli-builder", "Started a debounced notify watcher in setup() and re-armed it on registry change. Verified with cargo check and by watching the dashboard refresh.", "A plain-words retelling for whoever reads this later.", None)
        .unwrap();
    let b = tp.store.bug(&id).unwrap();
    assert_eq!(b.meta.status, BugStatus::Resolved);
    assert_eq!(b.meta.resolved_by.as_deref(), Some("cli-builder"));
    assert!(b.meta.resolved.is_some());
    assert!(b.resolution.as_deref().unwrap().contains("debounced notify watcher"));
    assert_eq!(b.comments.len(), 1, "resolving keeps the comment thread");
    assert!(b.report.contains("Expected"), "the report survives every rewrite");

    let types: Vec<String> = tp
        .store
        .events(None)
        .unwrap()
        .iter()
        .map(|e| e.event_type.clone())
        .collect();
    for want in ["bug_created", "bug_claimed", "bug_commented", "bug_resolved"] {
        assert!(types.contains(&want.to_string()), "{want} logged: {types:?}");
    }
}

#[test]
fn a_bug_claimed_by_someone_else_cannot_be_stolen() {
    let tp = TempProject::new("claim");
    let id = file_bug(&tp);
    tp.store.claim_bug(&id, "cli-builder", None, None).unwrap();

    let err = tp.store.claim_bug(&id, "other-agent", None, None).unwrap_err();
    assert_eq!(err.kind(), "conflict");
    assert!(err.to_string().contains("already claimed by cli-builder"), "{err}");
    assert!(err.to_string().contains("agentmon bug comment"), "suggests the fix: {err}");

    // Suggesting it is not enough — the line has to run, on this record. `--human` is
    // always on it now: a `--message` never travels without the retelling (owner
    // directive, 2026-08-24), so a bare line would send the reader from a refusal
    // straight into another.
    let hinted = backticked(&err.to_string(), "agentmon bug ");
    assert!(
        hinted.contains("--human "),
        "a hint without --human exits 2 on the very record it names: {hinted}"
    );
    run_bug_comment(&tp, &hinted)
        .unwrap_or_else(|e| panic!("the refusal printed a line that does not run:\n  {hinted}\n{e}"));
    // The comment's telling is appended after the stored page (owner decision, 2026-08-25).
    let human = tp.store.bug(&id).unwrap().human.unwrap();
    assert!(human.ends_with(COORDINATE_HUMAN), "{human}");

    // The same line survives the state `agentmon migrate` hands over: a claimed record
    // with no `## For humans` at all gains one from the same hint.
    strip_human(&tp.path(&format!("bugs/{id}.md")));
    let err = tp.store.claim_bug(&id, "other-agent", None, None).unwrap_err();
    let legacy = backticked(&err.to_string(), "agentmon bug ");
    assert!(legacy.contains("--human "), "{legacy}");
    run_bug_comment(&tp, &legacy).unwrap_or_else(|e| {
        panic!("the refusal printed a line that does not run:\n  {legacy}\n{e}")
    });
    assert_eq!(tp.store.bug(&id).unwrap().human.as_deref(), Some(COORDINATE_HUMAN));

    // the original claim is intact
    assert_eq!(tp.store.bug(&id).unwrap().meta.assignee.as_deref(), Some("cli-builder"));
    // and re-claiming by the same agent is a no-op, not an error (scripts get re-run)
    tp.store.claim_bug(&id, "cli-builder", None, None).unwrap();
}

#[test]
fn resolving_twice_is_refused_and_resolving_unclaimed_assigns_the_fixer() {
    let tp = TempProject::new("resolve");
    let id = file_bug(&tp);
    let res = "Fixed by starting the watcher in setup(); verified with cargo check and a live \
               dashboard refresh.";
    tp.store.resolve_bug(&id, "cli-builder", res, "A plain-words retelling for whoever reads this later.", None).unwrap();

    let b = tp.store.bug(&id).unwrap();
    assert_eq!(b.meta.assignee.as_deref(), Some("cli-builder"));
    assert!(b.meta.claimed.is_some(), "resolving unclaimed records the claim too");

    let err = tp.store.resolve_bug(&id, "other", res, "A plain-words retelling for whoever reads this later.", None).unwrap_err();
    assert_eq!(err.kind(), "conflict");
    assert!(err.to_string().contains("already resolved by cli-builder"), "{err}");
    // a comment on a resolved bug is still allowed — threads outlive the fix
    tp.store
        .comment_bug(&id, "reviewer", Some("Confirmed on my machine after a rebuild."), Some(HUMAN), None)
        .unwrap();
    assert_eq!(tp.store.bug(&id).unwrap().comments.len(), 1);
}

// ---------------------------------------------------------------------------
// ids, projects, concurrency
// ---------------------------------------------------------------------------

#[test]
fn ids_are_zero_padded_and_scoped_per_project() {
    // Two projects at two locations: the whole point of v2 is that each folder is its own
    // world, so the sequences must restart per folder.
    let alpha = TempProject::new("ids-alpha");
    let beta = TempProject::new("ids-beta");
    for tp in [&alpha, &beta] {
        for expected in ["WORK-0001", "WORK-0002", "WORK-0003"] {
            let w = tp
                .store
                .start_work(&StartWork {
                    agent: "a".into(),
                    title: format!("work {expected}"),
                    tags: vec![],
                    refs: vec![],
                    body: BODY.into(),
                    human: "We are starting a piece of work; this line says in plain words what it is for.".into(),
                    started_at: None,
                })
                .unwrap();
            assert_eq!(w.id, expected, "ids restart per project");
        }
        let b = tp
            .store
            .create_bug(&NewBug {
                agent: "a".into(),
                title: "first bug".into(),
                severity: Severity::Low,
                labels: vec![],
                refs: vec![],
                body: REPORT.into(),
                human: "Something is wrong with the app, written out for someone who does not read code.".into(),
                created_at: None,
            })
            .unwrap();
        assert_eq!(b.id, "BUG-0001", "bug ids are their own sequence");
    }
}

#[test]
fn init_twice_is_a_conflict_not_a_reset() {
    let tp = TempProject::new("dup-project");
    start(&tp, "Wire the change watcher into the desktop app");
    let err = Store::init(
        &tp.location,
        &NewProject {
            name: "Demo again".into(),
            description: String::new(),
            tags: vec![],
            actor: "test-runner".into(),
            at: None,
        },
    )
    .unwrap_err();
    assert_eq!(err.kind(), "conflict");
    assert_eq!(tp.store.worklogs().unwrap().len(), 1, "nothing was wiped");
    assert_eq!(tp.store.project().unwrap().name, "Demo");
}

#[test]
fn concurrent_writers_never_share_an_id_or_lose_an_event() {
    let tp = TempProject::new("concurrent");
    let threads = 6;
    let per_thread = 4;
    std::thread::scope(|s| {
        for t in 0..threads {
            let store = tp.store.clone();
            s.spawn(move || {
                for i in 0..per_thread {
                    store
                        .start_work(&StartWork {
                            agent: format!("agent-{t}"),
                            title: format!("concurrent work {t}/{i}"),
                            tags: vec![],
                            refs: vec![],
                            body: BODY.into(),
                            human: "We are starting a piece of work; this line says in plain words what it is for.".into(),
                            started_at: None,
                        })
                        .expect("concurrent start");
                }
            });
        }
    });

    let works = tp.store.worklogs().unwrap();
    assert_eq!(works.len(), threads * per_thread);
    let mut ids: Vec<String> = works.iter().map(|w| w.meta.id.clone()).collect();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), threads * per_thread, "every id is unique");
    assert_eq!(ids[0], "WORK-0001");
    assert_eq!(ids[ids.len() - 1], format!("WORK-{:04}", threads * per_thread));

    let started = tp
        .store
        .events(None)
        .unwrap()
        .into_iter()
        .filter(|e| e.event_type == "work_started")
        .count();
    assert_eq!(started, threads * per_thread, "no event was lost or torn");

    // and the project is still clean afterwards
    let report = doctor::check(&tp.store).unwrap();
    assert_eq!(report.errors(), 0, "{:#?}", report.problems);
}

#[test]
fn unknown_frontmatter_keys_survive_a_rewrite() {
    let tp = TempProject::new("forward-compat");
    let id = start(&tp, "Wire the change watcher into the desktop app");
    let path = tp.path(&format!("worklogs/{id}.md"));

    // A newer build wrote a key this build has never heard of.
    let raw = fs::read_to_string(&path).unwrap();
    let patched = raw.replacen("files: []", "files: []\nreviewers: [human-1]\npriority: 2", 1);
    fs::write(&path, patched).unwrap();

    tp.store
        .update_work(&id, "cli-builder", Some("Rewrote the record through the CLI."), Some(HUMAN), None)
        .unwrap();
    let after = fs::read_to_string(&path).unwrap();
    assert!(after.contains("reviewers: [human-1]"), "unknown key kept:\n{after}");
    assert!(after.contains("priority: 2"), "unknown key kept:\n{after}");
    assert_eq!(tp.store.worklog(&id).unwrap().updates.len(), 1);
}

#[test]
fn an_update_from_another_agent_is_attributed_in_the_body() {
    let tp = TempProject::new("attribution");
    let id = start(&tp, "Wire the change watcher into the desktop app");
    tp.store
        .update_work(&id, "reviewer", Some("Picked this up while the author was offline."), Some(HUMAN), None)
        .unwrap();
    let d = tp.store.worklog(&id).unwrap();
    assert_eq!(d.updates[0].ts.len(), 20, "the heading stays a bare timestamp");
    assert!(d.updates[0].body.contains("Update by reviewer"), "{:?}", d.updates[0]);
}

// ---------------------------------------------------------------------------
// doctor
// ---------------------------------------------------------------------------

fn problems_matching(tp: &TempProject, needle: &str) -> Vec<String> {
    doctor::check(&tp.store)
        .unwrap()
        .problems
        .into_iter()
        .filter(|p| p.message.contains(needle) || p.scope.contains(needle))
        .map(|p| format!("[{:?}] {} — {} (fix: {})", p.level, p.scope, p.message, p.fix))
        .collect()
}

#[test]
fn doctor_is_clean_on_a_project_the_cli_wrote() {
    let tp = TempProject::new("doctor-clean");
    let id = start(&tp, "Wire the change watcher into the desktop app");
    tp.store
        .update_work(&id, "cli-builder", Some("Halfway: the watcher fires."), Some(HUMAN), None)
        .unwrap();
    tp.store
        .finish_work(
            &id,
            &FinishWork {
                agent: "cli-builder".into(),
                outcome: OUTCOME.into(),
                files: vec!["src-tauri/src/lib.rs".into()],
                refs: vec![],
                human: "The work is finished. In plain words: it does what it set out to do, and the tests say so.".into(),
                finished_at: None,
                started_at: None,
            },
        )
        .unwrap();
    let bug = file_bug(&tp);
    tp.store.claim_bug(&bug, "cli-builder", None, None).unwrap();
    tp.store.resolve_bug(&bug, "cli-builder", OUTCOME, "A plain-words retelling for whoever reads this later.", None).unwrap();

    let report = doctor::check(&tp.store).unwrap();
    assert_eq!(report.errors(), 0, "{:#?}", report.problems);
    assert_eq!(report.warnings(), 0, "{:#?}", report.problems);
    assert_eq!(report.worklogs, 1);
    assert_eq!(report.bugs, 1);
    assert!(report.events >= 6, "events counted: {}", report.events);
}

#[test]
fn doctor_catches_corrupt_frontmatter() {
    let tp = TempProject::new("doctor-corrupt");
    let id = start(&tp, "Wire the change watcher into the desktop app");
    let path = tp.path(&format!("worklogs/{id}.md"));

    // an unquoted title containing a colon: the classic hand-edit that breaks YAML
    fs::write(
        &path,
        "---\nid: WORK-0001\ntitle: broken: yes: really\nagent: a\nstatus: in_progress\n\
         started: 2026-08-18T09:00:00Z\n---\n\n## What\n\nx\n",
    )
    .unwrap();
    let found = problems_matching(&tp, "frontmatter does not parse");
    assert_eq!(found.len(), 1, "{found:#?}");
    assert!(found[0].contains("Quote any title"), "{found:#?}");
    assert!(doctor::check(&tp.store).unwrap().errors() > 0);

    // a file with no frontmatter at all
    fs::write(&path, "just some markdown\n").unwrap();
    let found = problems_matching(&tp, "no YAML frontmatter");
    assert_eq!(found.len(), 1, "{found:#?}");
}

#[test]
fn doctor_catches_bad_status_transitions() {
    let tp = TempProject::new("doctor-status");
    let id = start(&tp, "Wire the change watcher into the desktop app");
    let path = tp.path(&format!("worklogs/{id}.md"));
    let raw = fs::read_to_string(&path).unwrap();

    // done, but no outcome and no finished timestamp
    fs::write(&path, raw.replace("status: in_progress", "status: done")).unwrap();
    let report = doctor::check(&tp.store).unwrap();
    let msgs: Vec<&str> = report.problems.iter().map(|p| p.message.as_str()).collect();
    assert!(
        msgs.iter().any(|m| m.contains("no `## Outcome` section")),
        "{msgs:#?}"
    );
    assert!(msgs.iter().any(|m| m.contains("`finished` is null")), "{msgs:#?}");

    // in_progress, but finished is set
    let raw = fs::read_to_string(&path).unwrap();
    fs::write(
        &path,
        raw.replace("status: done", "status: in_progress")
            .replace("finished: null", "finished: 2026-08-18T10:00:00Z"),
    )
    .unwrap();
    assert!(
        !problems_matching(&tp, "status is in_progress but `finished` is set").is_empty(),
        "{:#?}",
        doctor::check(&tp.store).unwrap().problems
    );

    // finished before started
    let raw = fs::read_to_string(&path).unwrap();
    fs::write(
        &path,
        raw.replace("status: in_progress", "status: done")
            .replace("finished: 2026-08-18T10:00:00Z", "finished: 2001-01-01T00:00:00Z"),
    )
    .unwrap();
    assert!(
        !problems_matching(&tp, "is before `started`").is_empty(),
        "{:#?}",
        doctor::check(&tp.store).unwrap().problems
    );
}

#[test]
fn doctor_catches_bug_state_that_contradicts_itself() {
    let tp = TempProject::new("doctor-bug");
    let id = file_bug(&tp);
    let path = tp.path(&format!("bugs/{id}.md"));
    let raw = fs::read_to_string(&path).unwrap();

    // resolved with nothing to show for it
    fs::write(&path, raw.replace("status: open", "status: resolved")).unwrap();
    let msgs: Vec<String> = doctor::check(&tp.store)
        .unwrap()
        .problems
        .iter()
        .map(|p| p.message.clone())
        .collect();
    assert!(msgs.iter().any(|m| m.contains("no `## Resolution` section")), "{msgs:#?}");
    assert!(msgs.iter().any(|m| m.contains("`resolved` is null")), "{msgs:#?}");
    assert!(msgs.iter().any(|m| m.contains("`resolved_by` is null")), "{msgs:#?}");

    // open, but somebody is assigned
    fs::write(&path, raw.replace("assignee: null", "assignee: cli-builder")).unwrap();
    assert!(
        !problems_matching(&tp, "status is open but `assignee`").is_empty(),
        "{:#?}",
        doctor::check(&tp.store).unwrap().problems
    );
}

#[test]
fn doctor_catches_id_filename_mismatch_and_duplicates() {
    let tp = TempProject::new("doctor-ids");
    let id = start(&tp, "Wire the change watcher into the desktop app");
    let path = tp.path(&format!("worklogs/{id}.md"));
    let raw = fs::read_to_string(&path).unwrap();
    fs::write(tp.path("worklogs/WORK-0009.md"), &raw).unwrap();

    let msgs: Vec<String> = doctor::check(&tp.store)
        .unwrap()
        .problems
        .iter()
        .map(|p| format!("{}: {}", p.scope, p.message))
        .collect();
    assert!(
        msgs.iter().any(|m| m.contains("but the file is WORK-0009.md")),
        "{msgs:#?}"
    );
    assert!(msgs.iter().any(|m| m.contains("duplicate id")), "{msgs:#?}");
}

#[test]
fn doctor_catches_a_broken_events_log() {
    let tp = TempProject::new("doctor-events");
    start(&tp, "Wire the change watcher into the desktop app");
    let path = tp.path("events.jsonl");
    let mut raw = fs::read_to_string(&path).unwrap();
    raw.push_str("{\"ts\":\"2026-08-18T10:00:00Z\",\"actor\":\"x\"\n");
    raw.push_str(
        "{\"ts\":\"18/08/2026\",\"actor\":\"x\",\"type\":\"work_updated\",\"ref\":\"WORK-0404\",\
         \"summary\":\"s\"}\n",
    );
    fs::write(&path, raw).unwrap();

    let report = doctor::check(&tp.store).unwrap();
    let msgs: Vec<String> = report
        .problems
        .iter()
        .map(|p| format!("[{:?}] {}: {}", p.level, p.scope, p.message))
        .collect();
    assert!(msgs.iter().any(|m| m.contains("not a valid event")), "{msgs:#?}");
    assert!(msgs.iter().any(|m| m.contains("is not ISO8601")), "{msgs:#?}");
    assert!(
        msgs.iter()
            .any(|m| m.contains("references WORK-0404") && m.contains("Warning")),
        "{msgs:#?}"
    );
    assert!(report.errors() >= 2);
}

#[test]
fn doctor_reports_levels_separately() {
    let tp = TempProject::new("doctor-levels");
    start(&tp, "Wire the change watcher into the desktop app");
    // An event type this build has never heard of is a warning: a newer writer is allowed
    // to invent one, and the feed still renders the line.
    tp.store
        .append_event("future-agent", "work_paused", None, "An event type from the future")
        .unwrap();
    let report = doctor::check(&tp.store).unwrap();
    assert_eq!(report.errors(), 0, "{:#?}", report.problems);
    assert_eq!(report.warnings(), 1, "{:#?}", report.problems);
    assert_eq!(report.problems[0].level, Level::Warning);
}

/// A retelling of exactly `n` words, and long enough at any `n` to pass the write path.
fn human_of(n: usize) -> String {
    let mut out = String::from("A retelling long enough to count");
    for _ in 6..n {
        out.push_str(" word");
    }
    assert_eq!(agentmon_core::human::words(&out), n, "harness built the wrong length");
    out
}

/// A compound retelling: a shared opening, then `things` beat-blocks of `each` words, every
/// one opened by a bold lead-in — the shape a record that shipped several things owes.
fn compound_human(things: usize, each: usize) -> String {
    let mut out = String::from("The shared opening, in words a reader could have witnessed.");
    for n in 1..=things {
        // The first beat carries its scene, the way the contract's default asks — so this
        // fixture is a conforming page and the word-ceiling test below measures only the
        // thing it is about.
        let scene = if n == 1 { "![the cast](assets/work-0000-1-cast.svg)\n\n" } else { "" };
        out.push_str(&format!("\n\n**The {n} thing shipped, stated.**\n\n{scene}{}", human_of(each)));
    }
    out
}

/// The picture default (a scene per beat, owner decision 2026-08-25) is swept the same
/// way the word ceiling is: a warning, never a refusal, and only on the shape that cannot
/// be the contract's own valve — a page of beats with not one scene. One figure anywhere
/// silences it (the valve is per beat, and doctor cannot judge which beat's facts draw
/// nothing), a beat-less thin retelling owes none, and a note never warns.
#[test]
fn doctor_warns_on_a_page_of_beats_with_no_scene_and_only_on_records() {
    let tp = TempProject::new("doctor-scenes");
    let id = start(&tp, "Wire the change watcher into the desktop app");

    // Beats, no picture anywhere: the warning, naming the record and the beat count.
    let bare = "The opening.\n\n**One thing shipped.** Its words.\n\n**Another thing.** More words.";
    tp.store.update_work(&id, "cli-builder", None, Some(bare), None).unwrap();
    let report = doctor::check(&tp.store).unwrap();
    let scene_warns: Vec<String> = report
        .problems
        .iter()
        .filter(|p| p.message.contains("no scene"))
        .map(|p| format!("{}: {}", p.message, p.fix))
        .collect();
    assert_eq!(scene_warns.len(), 1, "{:#?}", report.problems);
    assert!(scene_warns[0].contains(&format!("{id} (2 beat(s)")), "{}", scene_warns[0]);
    assert!(scene_warns[0].contains("check:scenes"), "{}", scene_warns[0]);
    assert_eq!(report.errors(), 0, "a missing picture is untidy, not broken");

    // One scene on the page and the sweep is silent — the per-beat valve is the
    // contract's to judge, not doctor's.
    let pictured = "The opening.\n\n**One thing shipped.**\n\n\
                    ![the cast](assets/work-0000-1-cast.svg)\n\nIts words.\n\n\
                    **Another thing.** More words.";
    tp.store.update_work(&id, "cli-builder", None, Some(pictured), None).unwrap();
    let report = doctor::check(&tp.store).unwrap();
    assert!(!report.problems.iter().any(|p| p.message.contains("no scene")), "{:#?}", report.problems);

    // A thin, beat-less retelling owes no picture.
    tp.store
        .update_work(&id, "cli-builder", None, Some("One honest paragraph, no beats at all."), None)
        .unwrap();
    let report = doctor::check(&tp.store).unwrap();
    assert!(!report.problems.iter().any(|p| p.message.contains("no scene")), "{:#?}", report.problems);
}

/// The two shapes that shipped a bean-sized scene past every check (owner feedback,
/// 2026-08-25): a citation with no blank line around it, which markdown folds into the
/// paragraph and draws inline, and a cited SVG whose root has a `viewBox` but no
/// width/height, which leaves an `<img>` no intrinsic size. Both rendered, so the save,
/// the figure count and the geometry gate all stayed green — doctor now names each.
#[test]
fn doctor_warns_on_a_welded_scene_citation_and_on_a_sizeless_scene_root() {
    let tp = TempProject::new("doctor-scene-shapes");
    let id = start(&tp, "Wire the change watcher into the desktop app");

    // The exact failing shape: the citation on the line right after the bold lead-in.
    let welded = "The opening.\n\n**One thing shipped.**\n\
                  ![the cast](assets/work-0000-1-cast.svg)\n\nIts words.";
    tp.store.update_work(&id, "cli-builder", None, Some(welded), None).unwrap();
    fs::create_dir_all(tp.path("assets")).unwrap();
    // A root with viewBox only — and `stroke-width` must not pass for `width`.
    fs::write(
        tp.path("assets/work-0000-1-cast.svg"),
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 700 430\" stroke-width=\"2\">\
         <text>cast</text></svg>",
    )
    .unwrap();

    let report = doctor::check(&tp.store).unwrap();
    let welded_warns: Vec<&doctor::Problem> =
        report.problems.iter().filter(|p| p.message.contains("inside a paragraph")).collect();
    assert_eq!(welded_warns.len(), 1, "{:#?}", report.problems);
    assert!(welded_warns[0].message.contains(&format!("{id} (1 welded citation(s))")), "{}", welded_warns[0].message);
    assert!(welded_warns[0].fix.contains("blank line"), "{}", welded_warns[0].fix);
    let size_warns: Vec<&doctor::Problem> =
        report.problems.iter().filter(|p| p.message.contains("no width/height")).collect();
    assert_eq!(size_warns.len(), 1, "{:#?}", report.problems);
    assert!(
        size_warns[0].message.contains(&format!("assets/work-0000-1-cast.svg (cited by {id})")),
        "{}",
        size_warns[0].message
    );
    assert_eq!(report.errors(), 0, "both are untidy, not broken");
    // The page still counts as having a scene: the welded warning is the signal, not a
    // second "no scene" one.
    assert!(!report.problems.iter().any(|p| p.message.contains("no scene")), "{:#?}", report.problems);

    // Blank lines around the citation and a sized root: both sweeps go silent.
    let clean = "The opening.\n\n**One thing shipped.**\n\n\
                 ![the cast](assets/work-0000-1-cast.svg)\n\nIts words.";
    tp.store.update_work(&id, "cli-builder", None, Some(clean), None).unwrap();
    fs::write(
        tp.path("assets/work-0000-1-cast.svg"),
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"700\" height=\"430\" \
         viewBox=\"0 0 700 430\"><text>cast</text></svg>",
    )
    .unwrap();
    let report = doctor::check(&tp.store).unwrap();
    assert!(
        !report.problems.iter().any(|p| p.message.contains("inside a paragraph") || p.message.contains("no width/height")),
        "{:#?}",
        report.problems
    );

    // A record that *documents* the citation syntax in backticks cites nothing, so a
    // sizeless file it names in code never reaches the sweep.
    let documented = "The opening.\n\n**The manual shows the syntax.** \
                      Write `![alt](assets/sizeless.svg)` on its own line.";
    tp.store.update_work(&id, "cli-builder", None, Some(documented), None).unwrap();
    fs::write(tp.path("assets/sizeless.svg"), "<svg viewBox=\"0 0 10 10\"/>").unwrap();
    let report = doctor::check(&tp.store).unwrap();
    assert!(
        !report.problems.iter().any(|p| p.message.contains("no width/height")),
        "{:#?}",
        report.problems
    );
}

/// The style contract's word ceiling is checked — on **one telling**, which is what it
/// bounds — and it is a warning rather than a refusal.
///
/// Two failures, one test. Until this check existed the 450 was a rule in
/// docs/HUMAN_STYLE.md that no code read: a 703-word human area shipped, and the only thing
/// that caught it was a person counting words by hand. Then the check itself became the
/// failure: it counted whole records, so a work log that shipped five things and retold all
/// five was reported as 374 words over, and the agent sent to fix it deleted two of the
/// five. A ceiling bounds one telling, never a record's total — a record that covers
/// everything it shipped is silent here however long it runs, and the fix hint never asks
/// for a cut before a split.
///
/// It stays a warning because a long retelling is readable and true — the repair is a
/// rewrite by the agent that wrote it, not a write that never happens.
#[test]
fn doctor_warns_on_a_telling_past_the_ceiling_and_never_on_covering_everything() {
    let tp = TempProject::new("doctor-words");
    let id = start(&tp, "Wire the change watcher into the desktop app");
    let ceiling = agentmon_core::human::WORDS_MAX;

    // Exactly the ceiling is silent: the contract allows 450 words "where the mechanism is
    // genuinely hard", so the warning starts one word past it.
    tp.store
        .update_work(&id, "cli-builder", None, Some(&human_of(ceiling)), None)
        .unwrap();
    let report = doctor::check(&tp.store).unwrap();
    assert_eq!(report.warnings(), 0, "{:#?}", report.problems);

    // Four things, four tellings, none of them near the ceiling — three times the ceiling
    // on the page and nothing to report. This is the record the per-record count called a
    // fault, and calling it one is what cost two deliverables.
    let compound = compound_human(4, ceiling - 100);
    assert!(agentmon_core::human::words(&compound) > 3 * ceiling);
    tp.store
        .update_work(&id, "cli-builder", None, Some(&compound), None)
        .unwrap();
    let report = doctor::check(&tp.store).unwrap();
    assert_eq!(report.warnings(), 0, "{:#?}", report.problems);

    // One telling past the ceiling — a wall, or one thing told at twice its weight — is
    // the warning, and it names that telling's own count.
    tp.store
        .update_work(&id, "cli-builder", None, Some(&human_of(ceiling + 53)), None)
        .unwrap();
    let report = doctor::check(&tp.store).unwrap();
    assert_eq!(report.errors(), 0, "{:#?}", report.problems);
    let msgs: Vec<String> = report
        .problems
        .iter()
        .map(|p| format!("[{:?}] {}: {}", p.level, p.scope, p.message))
        .collect();
    assert!(
        msgs.iter().any(|m| m.contains("Warning")
            && m.contains(&id)
            && m.contains(&format!("{} words in one telling", ceiling + 53))),
        "{msgs:#?}"
    );
    // …and the hint hands back the contract's own order. An agent reads this line and does
    // what it says, so it says split first, and says what may never be traded for a number.
    let fix = report
        .problems
        .iter()
        .find(|p| p.message.contains("telling"))
        .map(|p| p.fix.clone())
        .unwrap_or_default();
    assert!(fix.contains("never a record's total"), "{fix}");
    assert!(fix.contains("beat-block"), "{fix}");
    assert!(fix.contains("Never cut a fact to reach a number"), "{fix}");
}

/// A title is one line, and a title that is not one is refused before anything is written.
///
/// The title lands as a YAML scalar on one frontmatter line, so a `\n` in it opened a
/// second line and the file it wrote had no parser. The order made it worse than a bad
/// error: the record was written, its event appended, and only the read-back failed —
/// exit 6 over a file on disk, an event pointing at it, and `work list` failing for the
/// whole project from then on. With the newline placed just so, the record's first body
/// section came out as `## For humans` carrying agent prose, which is exactly what the
/// reserved heading exists to prevent.
#[test]
fn a_title_with_a_line_break_is_refused_and_leaves_nothing_behind() {
    let tp = TempProject::new("title-newline");
    let events_before = tp.store.events(None).unwrap().len();

    for title in [
        "Line one\n## For humans\nsmuggled",
        "Line one\r\nLine two",
        "Trailing\n",
    ] {
        let err = tp
            .store
            .start_work(&StartWork {
                agent: "cli-builder".into(),
                title: title.into(),
                tags: vec![],
                refs: vec![],
                body: BODY.into(),
                human: "We are starting a piece of work; this line says in plain words what it \
                        is for."
                    .into(),
                started_at: None,
            })
            .err();
        match title {
            // A trailing newline is trimmed, not a second line: that one is legal.
            "Trailing\n" => assert!(err.is_none(), "{err:?}"),
            _ => {
                let err = err.expect("a line break in a title is refused");
                // The same kind (and exit code) as every other `--title` rule here.
                assert_eq!(err.kind(), "conflict", "{err}");
                assert!(err.to_string().contains("line break"), "{err}");
                assert!(err.to_string().contains("--title"), "{err}");
            }
        }
    }

    // Exactly one record and one event were created — by the legal title.
    let logs = tp.store.worklogs().unwrap();
    assert_eq!(logs.len(), 1, "{logs:#?}");
    assert_eq!(logs[0].meta.title, "Trailing");
    assert_eq!(tp.store.events(None).unwrap().len(), events_before + 1);
    assert_eq!(doctor::check(&tp.store).unwrap().errors(), 0);

    // The same rule on the other kinds' titles, and on an agent handle.
    assert!(tp
        .store
        .create_bug(&NewBug {
            agent: "cli-builder".into(),
            title: "One\ntwo".into(),
            severity: Severity::Low,
            labels: vec![],
            refs: vec![],
            body: "## Report\n\nA real report sentence that says what happened.".into(),
            human: "A real retelling of the problem, in words a reader can follow.".into(),
            created_at: None,
        })
        .is_err());
    assert!(tp
        .store
        .start_work(&StartWork {
            agent: "cli\nbuilder".into(),
            title: "A perfectly good title".into(),
            tags: vec![],
            refs: vec![],
            body: BODY.into(),
            human: "We are starting a piece of work; this line says in plain words what it is \
                    for."
                .into(),
            started_at: None,
        })
        .is_err());
    assert_eq!(tp.store.worklogs().unwrap().len(), 1);
    assert!(tp.store.bugs().unwrap().is_empty());
}

// ---------------------------------------------------------------------------
// events must match the records they describe, not merely be well-formed
// ---------------------------------------------------------------------------

/// Append a raw line to events.jsonl — what a hand or a batch script does, and the only
/// way to produce the shape this check exists for. `update_work` cannot: it writes the
/// `### <ts>` entry and the event in one call, so through the CLI the pair is never split.
fn append_raw_event(tp: &TempProject, line: &str) {
    let path = tp.path("events.jsonl");
    let mut raw = fs::read_to_string(&path).unwrap();
    raw.push_str(line);
    raw.push('\n');
    fs::write(&path, raw).unwrap();
}

/// One `work_updated` announcement with no `### <ts>` entry behind it.
fn orphan_event(id: &str, ts: &str) -> String {
    format!(
        "{{\"ts\":\"{ts}\",\"actor\":\"backfill\",\"type\":\"work_updated\",\"ref\":\"{id}\",\
         \"summary\":\"Human area: swept this record…\"}}"
    )
}

/// The command between a hint's backticks — the exact bytes a reader is told to run, lifted
/// rather than reconstructed here. Reconstructing it would test this test.
fn backticked(text: &str, prefix: &str) -> String {
    text.split('`')
        .find(|s| s.starts_with(prefix))
        .unwrap_or_else(|| panic!("no `{prefix}…` command in: {text}"))
        .to_string()
}

/// A command out of the orphan problem's fix line.
fn fix_command(tp: &TempProject, prefix: &str) -> String {
    let report = doctor::check(&tp.store).unwrap();
    let problem = report
        .problems
        .iter()
        .find(|p| p.fix.contains(doctor::RECONCILE_NOTE))
        .unwrap_or_else(|| panic!("no orphan problem to read a fix off: {:#?}", report.problems));
    backticked(&problem.fix, prefix)
}

/// The half that accounts for an orphan nobody can recover.
fn reconcile_fix(tp: &TempProject) -> String {
    fix_command(tp, "agentmon note ")
}

/// The half that repairs one that is recoverable — posting the note the feed announced.
fn repair_fix(tp: &TempProject) -> String {
    fix_command(tp, "agentmon work ")
}

/// Split a printed command the way a shell does for the shapes doctor prints: spaces
/// separate, double quotes group. A hint needing more quoting than this is a hint nobody
/// can copy.
fn shell_words(command: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let (mut word, mut quoted, mut started) = (String::new(), false, false);
    for c in command.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                started = true;
            }
            c if c.is_whitespace() && !quoted => {
                if started {
                    out.push(std::mem::take(&mut word));
                    started = false;
                }
            }
            c => {
                word.push(c);
                started = true;
            }
        }
    }
    if started {
        out.push(word);
    }
    out
}

/// What a reader puts where a hint left a blank. Only the blanks: anything doctor spelled
/// out — the verb, the flags, the note's name, the record's id — is passed through
/// untouched, because those are the parts under test.
///
/// Keyed by the flag as well as the blank, because the two halves of the fix line leave the
/// same `…` and the same `<retelling>` meaning different things: a note's one-line
/// description on one and a progress note on the other, an explanation of the corpus on one
/// and a retelling of the work on the other. A blank this does not recognise falls through
/// as itself and is refused as the placeholder it is, which is the failure we want.
fn fill(kind: &str, flag: &str, value: &str) -> String {
    match (kind, flag, value) {
        (_, "agent", "<you>") => "cli-builder".to_string(),
        ("note", "description", "…") => {
            "Accounts for feed lines whose record holds no such note.".to_string()
        }
        ("note", "human", "<retelling>") => RECONCILE_HUMAN.to_string(),
        ("work", "message", "…") => REPAIR_MESSAGE.to_string(),
        ("work", "human", "<retelling>") => REPAIR_HUMAN.to_string(),
        ("bug", "message", "...") => COORDINATE_MESSAGE.to_string(),
        ("bug", "human", "<retelling>") => COORDINATE_HUMAN.to_string(),
        (_, _, other) => other.to_string(),
    }
}

const RECONCILE_HUMAN: &str = "Some lines in the activity list point at notes that were never \
written down. This says which ones, and why nobody made up the missing text.";

const REPAIR_MESSAGE: &str = "Posting the note this event announced: the watcher was restarted \
by hand, and the reload it should have logged fired once.";

const REPAIR_HUMAN: &str = "This piece of work now has its story written down, including the \
progress note that the activity list had been pointing at with nothing behind it.";

const COORDINATE_MESSAGE: &str = "I was about to take this one, but cli-builder already has it. \
Leaving it with them, and here is what I found before I stopped.";

const COORDINATE_HUMAN: &str = "Two people nearly worked on this same fault at once. The second \
one stopped and wrote down what they had found instead.";

/// Run an `agentmon note add|update` line through the calls the CLI makes for it, with the
/// blanks filled in the way a reader fills them.
///
/// The core API rather than a spawned binary, because that is what this file tests — but
/// every flag below is the one `crates/agentmon-cli/src/main.rs` reads for that verb, and
/// nothing here supplies a value the printed line did not: a hint that drops `--human`
/// arrives at `add_note`/`update_note` without one and is refused exactly as a terminal
/// would refuse it (exit 2), and a hint naming a verb that cannot do the job fails on the
/// same missing file the CLI would fail on (exit 3).
fn run_note_command(tp: &TempProject, command: &str, body: &str) -> Result<(), String> {
    let words = shell_words(command);
    assert_eq!(words.first().map(String::as_str), Some("agentmon"), "{command}");
    assert_eq!(words.get(1).map(String::as_str), Some("note"), "{command}");
    let verb = words.get(2).cloned().unwrap_or_default();

    let mut flags: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut positional: Vec<String> = Vec::new();
    let mut i = 3;
    while i < words.len() {
        match words[i].strip_prefix("--") {
            // Every flag these two verbs take carries a value, `--body-file -` included.
            Some(flag) => {
                let value = words
                    .get(i + 1)
                    .unwrap_or_else(|| panic!("--{flag} has no value in: {command}"));
                flags.insert(flag.to_string(), fill("note", flag, value));
                i += 2;
            }
            None => {
                positional.push(words[i].clone());
                i += 1;
            }
        }
    }
    // `-` is stdin, which for a test is the body it was handed.
    let piped = match flags.get("body-file").map(String::as_str) {
        Some("-") => Some(body.to_string()),
        Some(path) => panic!("the printed line reads a body from {path}, which no reader has"),
        None => flags.get("body").cloned(),
    };
    let agent = flags.get("agent").cloned().unwrap_or_default();

    match verb.as_str() {
        "add" => {
            let note_type = agentmon_core::parse_note_type(
                flags.get("type").map(String::as_str).unwrap_or_default(),
            )
            .map_err(|e| e.to_string())?;
            tp.store
                .add_note(&NewNote {
                    agent,
                    name: flags.get("name").cloned(),
                    title: flags.get("title").cloned().unwrap_or_default(),
                    note_type,
                    description: flags.get("description").cloned().unwrap_or_default(),
                    tags: vec![],
                    refs: vec![],
                    body: piped.unwrap_or_default(),
                    human: flags.get("human").cloned().unwrap_or_default(),
                    at: None,
                })
                .map(|_| ())
                .map_err(|e| e.to_string())
        }
        "update" => {
            let name = positional
                .first()
                .cloned()
                .unwrap_or_else(|| panic!("`note update` names no note: {command}"));
            tp.store
                .update_note(
                    &name,
                    &UpdateNote {
                        agent,
                        body: piped,
                        human: flags.get("human").cloned(),
                        ..Default::default()
                    },
                )
                .map(|_| ())
                .map_err(|e| e.to_string())
        }
        other => Err(format!("`agentmon note {other}` is not a verb the CLI has")),
    }
}

/// Run an `agentmon work update` line through the calls the CLI makes for it, with the
/// blanks filled in the way a reader fills them. Same reasoning as [`run_note_command`]:
/// every flag below is the one `crates/agentmon-cli/src/main.rs` reads for this verb and
/// hands to `update_work`, so a printed line with no `--human` arrives with `None` and is
/// refused exactly as a terminal refuses it (exit 2) on a record that has no human area yet.
fn run_work_command(tp: &TempProject, command: &str) -> Result<(), String> {
    let words = shell_words(command);
    assert_eq!(words.first().map(String::as_str), Some("agentmon"), "{command}");
    assert_eq!(words.get(1).map(String::as_str), Some("work"), "{command}");
    assert_eq!(words.get(2).map(String::as_str), Some("update"), "{command}");
    let id = words
        .get(3)
        .cloned()
        .unwrap_or_else(|| panic!("`work update` names no record: {command}"));
    assert!(!id.starts_with("--"), "the id has to come before the flags: {command}");

    let mut flags: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut i = 4;
    while i < words.len() {
        // Every flag this verb takes carries a value.
        let flag = words[i]
            .strip_prefix("--")
            .unwrap_or_else(|| panic!("`{}` is not a flag, in: {command}", words[i]));
        let value = words
            .get(i + 1)
            .unwrap_or_else(|| panic!("--{flag} has no value in: {command}"));
        flags.insert(flag.to_string(), fill("work", flag, value));
        i += 2;
    }
    tp.store
        .update_work(
            &id,
            flags.get("agent").map(String::as_str).unwrap_or_default(),
            flags.get("message").map(String::as_str),
            flags.get("human").map(String::as_str),
            flags.get("at").map(String::as_str),
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Run an `agentmon bug comment` line the way the CLI runs it. Same reasoning as
/// [`run_work_command`], on the other verb a refused `bug claim` sends its reader to.
fn run_bug_comment(tp: &TempProject, command: &str) -> Result<(), String> {
    let words = shell_words(command);
    assert_eq!(words.first().map(String::as_str), Some("agentmon"), "{command}");
    assert_eq!(words.get(1).map(String::as_str), Some("bug"), "{command}");
    assert_eq!(words.get(2).map(String::as_str), Some("comment"), "{command}");
    let id = words
        .get(3)
        .cloned()
        .unwrap_or_else(|| panic!("`bug comment` names no record: {command}"));

    let mut flags: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut i = 4;
    while i < words.len() {
        let flag = words[i]
            .strip_prefix("--")
            .unwrap_or_else(|| panic!("`{}` is not a flag, in: {command}", words[i]));
        let value = words
            .get(i + 1)
            .unwrap_or_else(|| panic!("--{flag} has no value in: {command}"));
        flags.insert(flag.to_string(), fill("bug", flag, value));
        i += 2;
    }
    tp.store
        .comment_bug(
            &id,
            flags.get("agent").map(String::as_str).unwrap_or_default(),
            flags.get("message").map(String::as_str),
            flags.get("human").map(String::as_str),
            flags.get("at").map(String::as_str),
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// A work log that began before the orphan it is about to be handed, so `--at <the event's
/// ts>` lands inside the window the write path allows (at or after `started`, at or before
/// now). The first two attempts at this fixture failed on that bound rather than on the
/// flag under test.
fn start_dated(tp: &TempProject, title: &str, started_at: &str) -> String {
    tp.store
        .start_work(&StartWork {
            agent: "cli-builder".into(),
            title: title.into(),
            tags: vec!["tauri".into(), "rust".into()],
            refs: vec![],
            body: BODY.into(),
            human: "We are starting a piece of work; this line says in plain words what it is \
                    for."
                .into(),
            started_at: Some(started_at.into()),
        })
        .expect("work start")
        .id
}

/// Turn a record into a legacy one: everything the CLI wrote, minus the `## For humans`
/// section. Exactly what `agentmon migrate` leaves behind (SPEC.md, "Migration"), and the
/// state doctor's own human-area warning is about.
fn strip_human(path: &Path) {
    let raw = fs::read_to_string(path).unwrap();
    let (agent_area, human) = raw
        .split_once("\n## For humans")
        .unwrap_or_else(|| panic!("nothing to strip — this record has no human area:\n{raw}"));
    assert!(!human.is_empty());
    fs::write(path, format!("{}\n", agent_area.trim_end())).unwrap();
}

/// The body the fix line asks for: one line per orphan, each holding the exact token and a
/// sentence on what happened. `--body-file` replaces the body, so every token the note is
/// already accounting for has to be in it — which is what the second write below proves.
fn accounting_body(tokens: &[String]) -> String {
    let mut body =
        String::from("Accounted for — feed lines no record backs, and why each one stays:\n");
    for t in tokens {
        body.push_str(&format!(
            "\n- `{t}` — a batch run wrote the announcement without the note it announces. \
             The text is gone, and inventing one would put history in a live record that \
             never happened.\n"
        ));
    }
    body
}

#[test]
fn doctor_catches_an_update_event_whose_record_holds_no_such_note() {
    let tp = TempProject::new("doctor-pairing");
    let id = start(&tp, "Wire the change watcher into the desktop app");

    // A real note first: the event and the entry go in together, and doctor is happy.
    tp.store
        .update_work(&id, "cli-builder", Some("Halfway: the watcher fires."), Some(HUMAN), None)
        .unwrap();
    let note_ts = tp.store.worklog(&id).unwrap().updates[0].ts.clone();
    let report = doctor::check(&tp.store).unwrap();
    assert_eq!(report.errors(), 0, "{:#?}", report.problems);
    assert!(report.reconciled_events.is_empty());

    // Now the shape the CLI cannot write: the announcement without the note.
    append_raw_event(
        &tp,
        &format!(
            "{{\"ts\":\"2026-08-19T09:00:00Z\",\"actor\":\"backfill\",\"type\":\"work_updated\",\
             \"ref\":\"{id}\",\"summary\":\"Human area: swept this record…\"}}"
        ),
    );
    let found = problems_matching(&tp, "has no `### 2026-08-19T09:00:00Z` under `## Updates`");
    assert_eq!(found.len(), 1, "{found:#?}");
    assert!(found[0].starts_with("[Error]"), "a human reads something untrue: {found:#?}");
    // The message says which record and which real notes it does hold, so the reader can
    // tell "never written" from "written at a different time".
    assert!(found[0].contains(&id), "{found:#?}");
    assert!(found[0].contains(&note_ts), "names the notes it does hold: {found:#?}");
    // The fix names both routes and the note that accounts for the unrecoverable ones.
    assert!(found[0].contains("--at 2026-08-19T09:00:00Z"), "{found:#?}");
    assert!(found[0].contains(doctor::RECONCILE_NOTE), "{found:#?}");
    assert_eq!(doctor::check(&tp.store).unwrap().errors(), 1);

    // Only `work_updated` claims an entry. The other types say nothing about `## Updates`,
    // so pairing must not touch them.
    append_raw_event(
        &tp,
        &format!(
            "{{\"ts\":\"2026-08-19T09:30:00Z\",\"actor\":\"backfill\",\"type\":\"human_updated\",\
             \"ref\":\"{id}\",\"summary\":\"A retelling for a reader who does not program.\"}}"
        ),
    );
    assert_eq!(doctor::check(&tp.store).unwrap().errors(), 1, "human_updated is not paired");
}

#[test]
fn an_orphan_event_is_accounted_for_by_the_reconciliation_note_and_never_goes_quiet() {
    let tp = TempProject::new("doctor-reconcile");
    let id = start(&tp, "Wire the change watcher into the desktop app");
    append_raw_event(
        &tp,
        &format!(
            "{{\"ts\":\"2026-08-19T09:00:00Z\",\"actor\":\"backfill\",\"type\":\"work_updated\",\
             \"ref\":\"{id}\",\"summary\":\"Human area: swept this record…\"}}"
        ),
    );
    assert_eq!(doctor::check(&tp.store).unwrap().errors(), 1);

    let note = tp.path(&format!("notes/{}.md", doctor::RECONCILE_NOTE));
    let head = "---\nname: event-reconciliation\ntitle: Orphaned events\ntype: decision\n\
                description: Accounts for events with no matching note.\nagent: tester\n\
                created: 2026-08-19T10:00:00Z\nupdated: 2026-08-19T10:00:00Z\n---\n\n";
    // Every record owes a human area, this one included, or doctor warns about it and the
    // test would be measuring the wrong warning.
    let tail = "\n## For humans\n\nSome lines in the activity list point at notes that were \
                never written down. This note says which ones, and why nobody made up the \
                missing text.\n";

    // A near miss must not account for anything: same record, one second out.
    fs::write(
        &note,
        format!("{head}Accounted for:\n\n- {id}@2026-08-19T09:00:01Z — a different second.\n{tail}"),
    )
    .unwrap();
    assert_eq!(
        doctor::check(&tp.store).unwrap().errors(),
        1,
        "the token has to be the event's own timestamp, not near it"
    );

    // Naming the record alone must not account for it either — that would waive every
    // orphan on the record, present and future, which is the wildcard this refuses.
    fs::write(&note, format!("{head}Accounted for:\n\n- {id} — all of them.\n{tail}")).unwrap();
    assert_eq!(doctor::check(&tp.store).unwrap().errors(), 1, "no bare-ref wildcard");

    // The exact `ref@ts`, in prose, where a person reading the note sees it too.
    fs::write(
        &note,
        format!(
            "{head}Accounted for:\n\n- `{id}@2026-08-19T09:00:00Z` — a batch run logged the \
             wrong event type; the note text is gone and inventing one would be worse.\n{tail}"
        ),
    )
    .unwrap();
    let report = doctor::check(&tp.store).unwrap();
    assert_eq!(report.errors(), 0, "{:#?}", report.problems);
    assert_eq!(report.warnings(), 0, "accounted for is not a warning either");
    // Accounted for, but never silent: it is still reported, just not as a problem.
    assert_eq!(
        report.reconciled_events,
        vec![format!("{id}@2026-08-19T09:00:00Z")],
        "doctor still says which events the files do not back"
    );

    // -- and the line doctor printed to get here has to be one that runs ---------------
    //
    // The note above was written by this test. The one below is written by **doctor's own
    // fix line**, executed as printed — the only way to know the line works, and it
    // shipped not working. The fix named `agentmon note update event-reconciliation` in
    // both of the states a project can be in, and neither one ran: with no such note —
    // every project meeting its first orphan — `update` has no file to read and exits 3,
    // and once the note is there the same line still exits 2, because a `--body-file` that
    // replaces what a note knows must carry the retelling of the new knowledge with it. A
    // fix line is doctor's promise that the reader has somewhere to go, so the promise is
    // checked here rather than read.
    //
    // A second project, because the state that broke is the one this test has already left.
    let fresh = TempProject::new("doctor-reconcile-fix");
    let fid = start(&fresh, "Wire the change watcher into the desktop app");
    let first = format!("{fid}@2026-08-19T09:00:00Z");
    append_raw_event(&fresh, &orphan_event(&fid, "2026-08-19T09:00:00Z"));

    // State one: no reconciliation note. The overwhelmingly common one — a project meets
    // its first orphan exactly once — and the one the old hint could not survive.
    let fresh_note = fresh.path(&format!("notes/{}.md", doctor::RECONCILE_NOTE));
    assert!(!fresh_note.is_file(), "the state under test is the note not existing");
    let create = reconcile_fix(&fresh);
    assert!(
        create.starts_with("agentmon note add "),
        "nothing to update yet, so the line has to create the note: {create}"
    );
    run_note_command(&fresh, &create, &accounting_body(&[first.clone()]))
        .unwrap_or_else(|e| panic!("doctor printed a line that does not run:\n  {create}\n{e}"));

    assert!(fresh_note.is_file(), "the printed line left no note behind: {create}");
    let report = doctor::check(&fresh.store).unwrap();
    assert_eq!(report.errors(), 0, "running the fix did not fix it: {:#?}", report.problems);
    assert_eq!(report.warnings(), 0, "{:#?}", report.problems);
    assert_eq!(report.reconciled_events, vec![first.clone()]);

    // State two: the note exists, and a second orphan turns up. Now `add` would be refused
    // (one fact, one file), so the printed verb has to change — and the body it asks for
    // replaces the old one, which is why the retelling has to be rewritten with it.
    let second = format!("{fid}@2026-08-20T14:05:00Z");
    append_raw_event(&fresh, &orphan_event(&fid, "2026-08-20T14:05:00Z"));
    let update = reconcile_fix(&fresh);
    assert!(
        update.starts_with("agentmon note update "),
        "the note is there now; adding it again is refused: {update}"
    );
    run_note_command(&fresh, &update, &accounting_body(&[first.clone(), second.clone()]))
        .unwrap_or_else(|e| panic!("doctor printed a line that does not run:\n  {update}\n{e}"));

    let report = doctor::check(&fresh.store).unwrap();
    assert_eq!(report.errors(), 0, "{:#?}", report.problems);
    assert_eq!(report.warnings(), 0, "{:#?}", report.problems);
    assert_eq!(report.reconciled_events, vec![first, second]);
    // Written by the fix line, so the retelling it demanded is the one on disk — the human
    // area is not a formality a hint can name and the write path skip.
    let raw = fs::read_to_string(&fresh_note).unwrap();
    assert!(raw.contains("## For humans"), "{raw}");
    assert!(raw.contains(RECONCILE_HUMAN), "{raw}");

    // -- and so does the other half of that same line: the repair ----------------------
    //
    // `agentmon work update` lands on the **record**, and a record with no `## For humans`
    // refuses every write that would leave it without one. That is not a corner: `agentmon
    // migrate` hands over a project of records in exactly that state, and doctor prints its
    // own human-area warning naming the same id a few lines above this error — so the run
    // that offers the repair is usually the run that says the record cannot take it. Both
    // states below, because the repair line has to be right in both and each can only be
    // proved by running it.
    let started = "2026-08-19T08:00:00Z";
    let orphan_ts = "2026-08-19T09:00:00Z";

    // State one: a legacy record, no human area. The line has to ask for one.
    let legacy = TempProject::new("doctor-repair-legacy");
    let lid = start_dated(&legacy, "Wire the change watcher into the desktop app", started);
    strip_human(&legacy.path(&format!("worklogs/{lid}.md")));
    append_raw_event(&legacy, &orphan_event(&lid, orphan_ts));
    let report = doctor::check(&legacy.store).unwrap();
    assert_eq!(report.errors(), 1, "{:#?}", report.problems);
    assert_eq!(report.missing_human, vec![lid.clone()], "the state under test");

    let repair = repair_fix(&legacy);
    assert!(
        repair.contains("--human "),
        "the record this line names cannot take a write that leaves it without a human \
         area: {repair}"
    );
    run_work_command(&legacy, &repair)
        .unwrap_or_else(|e| panic!("doctor printed a line that does not run:\n  {repair}\n{e}"));

    // One line, both findings: the entry the feed announced exists now, and the record it
    // was announced on has the human area the same run was warning about.
    let report = doctor::check(&legacy.store).unwrap();
    assert_eq!(report.errors(), 0, "running the fix did not fix it: {:#?}", report.problems);
    assert_eq!(report.warnings(), 0, "{:#?}", report.problems);
    assert!(report.reconciled_events.is_empty(), "recovered, not accounted for");
    assert_eq!(
        legacy.store.worklog(&lid).unwrap().updates[0].ts,
        orphan_ts,
        "the note landed at the timestamp the feed had been announcing"
    );

    // State two: a record that already has a retelling. The flag stays on the line —
    // `--message` never travels without `--human` (owner directive, 2026-08-24), so a
    // hint without it would exit 2 on the record it names — and the text the reader
    // fills in is appended to the stored page, exactly as on any other note.
    let told = TempProject::new("doctor-repair-told");
    let tid = start_dated(&told, "Wire the change watcher into the desktop app", started);
    assert!(
        told.store.worklog(&tid).unwrap().human.is_some(),
        "the state under test is the record having one"
    );
    append_raw_event(&told, &orphan_event(&tid, orphan_ts));

    let repair = repair_fix(&told);
    assert!(
        repair.contains("--human "),
        "a repair line without --human exits 2 on the very record it names: {repair}"
    );
    run_work_command(&told, &repair)
        .unwrap_or_else(|e| panic!("doctor printed a line that does not run:\n  {repair}\n{e}"));

    let report = doctor::check(&told.store).unwrap();
    assert_eq!(report.errors(), 0, "{:#?}", report.problems);
    assert_eq!(report.warnings(), 0, "{:#?}", report.problems);
    // The telling the reader wrote into the line lands on the record — appended after
    // the page it already had (owner decision, 2026-08-25).
    let human = told.store.worklog(&tid).unwrap().human.unwrap();
    assert!(human.ends_with(REPAIR_HUMAN), "{human}");
}
