//! Round-trip tests: everything the CLI writes must come back out of the reader the app
//! uses, unchanged. These run against a real temp directory — no in-memory filesystem —
//! because half the invariants here are about `rename`, `create_new` and lock files.

use std::fs;
use std::path::{Path, PathBuf};

use agentmon_core::doctor::{self, Level};
use agentmon_core::{
    BugStatus, FinishWork, NewBug, NewProject, Severity, StartWork, Store, WorkStatus, DATA_DIR,
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
        .update_work(
            &id,
            "cli-builder",
            "Watcher is running; a single save produced four raw notify events, so the debounce \
             is not optional.",
            None,
        )
        .unwrap();
    tp.store
        .update_work(&id, "cli-builder", "Debounce set to 250ms; one reload per save.", None)
        .unwrap();
    tp.store
        .finish_work(
            &id,
            &FinishWork {
                agent: "cli-builder".into(),
                outcome: OUTCOME.into(),
                files: vec!["src-tauri/src/lib.rs".into(), "src-tauri/Cargo.toml".into()],
                refs: vec!["BUG-0002".into()],
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
        .update_work(&id, "reviewer", "Backdated afterthought.", Some("2026-01-05T10:00:00Z"))
        .unwrap_err();
    assert_eq!(err.kind(), "invalid_argument");
    assert!(err.to_string().contains("closed"), "says what it is behind: {err}");

    let w = tp
        .store
        .update_work(
            &id,
            "reviewer",
            "Correction: the note above says four workers; the config says two.",
            None,
        )
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

    tp.store.claim_bug(&id, "cli-builder", None).unwrap();
    let b = tp.store.bug(&id).unwrap();
    assert_eq!(b.meta.status, BugStatus::InProgress);
    assert_eq!(b.meta.assignee.as_deref(), Some("cli-builder"));
    assert!(b.meta.claimed.is_some());

    tp.store
        .comment_bug(
            &id,
            "cli-builder",
            "Root cause: the Tauri shell never started a watcher, so `project-changed` was never \
             emitted.",
            None,
        )
        .unwrap();
    let b = tp.store.bug(&id).unwrap();
    assert_eq!(b.comments.len(), 1);
    assert_eq!(b.comments[0].agent, "cli-builder");
    assert_eq!(b.comments[0].ts.len(), 20);
    assert!(b.comments[0].body.contains("never started a watcher"));

    tp.store
        .resolve_bug(
            &id,
            "cli-builder",
            "Started a debounced notify watcher in setup() and re-armed it on registry change. \
             Verified with cargo check and by watching the dashboard refresh.",
            None,
        )
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
    tp.store.claim_bug(&id, "cli-builder", None).unwrap();

    let err = tp.store.claim_bug(&id, "other-agent", None).unwrap_err();
    assert_eq!(err.kind(), "conflict");
    assert!(err.to_string().contains("already claimed by cli-builder"), "{err}");
    assert!(err.to_string().contains("agentmon bug comment"), "suggests the fix: {err}");

    // the original claim is intact
    assert_eq!(tp.store.bug(&id).unwrap().meta.assignee.as_deref(), Some("cli-builder"));
    // and re-claiming by the same agent is a no-op, not an error (scripts get re-run)
    tp.store.claim_bug(&id, "cli-builder", None).unwrap();
}

#[test]
fn resolving_twice_is_refused_and_resolving_unclaimed_assigns_the_fixer() {
    let tp = TempProject::new("resolve");
    let id = file_bug(&tp);
    let res = "Fixed by starting the watcher in setup(); verified with cargo check and a live \
               dashboard refresh.";
    tp.store.resolve_bug(&id, "cli-builder", res, None).unwrap();

    let b = tp.store.bug(&id).unwrap();
    assert_eq!(b.meta.assignee.as_deref(), Some("cli-builder"));
    assert!(b.meta.claimed.is_some(), "resolving unclaimed records the claim too");

    let err = tp.store.resolve_bug(&id, "other", res, None).unwrap_err();
    assert_eq!(err.kind(), "conflict");
    assert!(err.to_string().contains("already resolved by cli-builder"), "{err}");
    // a comment on a resolved bug is still allowed — threads outlive the fix
    tp.store
        .comment_bug(&id, "reviewer", "Confirmed on my machine after a rebuild.", None)
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
        .update_work(&id, "cli-builder", "Rewrote the record through the CLI.", None)
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
        .update_work(&id, "reviewer", "Picked this up while the author was offline.", None)
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
        .update_work(&id, "cli-builder", "Halfway: the watcher fires.", None)
        .unwrap();
    tp.store
        .finish_work(
            &id,
            &FinishWork {
                agent: "cli-builder".into(),
                outcome: OUTCOME.into(),
                files: vec!["src-tauri/src/lib.rs".into()],
                refs: vec![],
                finished_at: None,
                started_at: None,
            },
        )
        .unwrap();
    let bug = file_bug(&tp);
    tp.store.claim_bug(&bug, "cli-builder", None).unwrap();
    tp.store.resolve_bug(&bug, "cli-builder", OUTCOME, None).unwrap();

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
