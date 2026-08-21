//! Deleting a project: the one call in this crate that takes records away.
//!
//! It exists for the human using the desktop app — a project they stopped using should be
//! removable from the window they read it in — and for nobody else: there is no `agentmon
//! project delete`, and no MCP tool, so an agent scripting against a project cannot reach
//! it. What is tested here is therefore not "does it delete" alone but the refusals
//! around it, because a delete that follows a bad path is not a bug you get to fix twice.
//!
//! The stakes are higher in v2 than they were with a central vault: the AgentMonitoring
//! folder sits *inside the human's own repo*, so the call must only ever be able to take
//! that folder — never the location around it.
//!
//! Real directories, not a mocked filesystem: `remove_dir_all` on a tree of records is the
//! behaviour under test.

use std::fs;
use std::path::PathBuf;

use agentmon_core::{NewProject, StartWork, Store, DATA_DIR};

struct TempLocation {
    dir: PathBuf,
}

impl TempLocation {
    fn new(tag: &str) -> TempLocation {
        let dir = std::env::temp_dir().join(format!(
            "agentmon-delete-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        TempLocation { dir }
    }

    fn project(&self, name: &str) -> Store {
        Store::init(
            &self.dir,
            &NewProject {
                name: name.into(),
                description: "Created by the agentmon-core delete tests.".into(),
                tags: vec![],
                actor: "test-runner".into(),
                at: None,
            },
        )
        .expect("create project")
    }
}

impl Drop for TempLocation {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn work(store: &Store) {
    store
        .start_work(&StartWork {
            agent: "test-runner".into(),
            title: "A record that goes with the project".into(),
            body: "## What\n\nA work log inside a project this test is about to \
                   delete.\n\n## Why\n\nSo the delete has a real record to take with \
                   it, not an empty folder.\n\n## How\n\nWritten by the test harness \
                   through the same core write path the CLI uses.\n"
                .into(),
            ..Default::default()
        })
        .expect("start work");
}

/// The whole point: the AgentMonitoring folder and everything in it stops existing, the
/// location the human picked survives, and the caller is told what went — because after
/// the call there is nothing left to ask.
#[test]
fn deleting_a_project_removes_its_data_folder_and_nothing_else() {
    let loc = TempLocation::new("removes");
    let store = loc.project("Doomed");
    work(&store);
    // The human's own files sit right next to the data folder — the thing that must survive.
    fs::write(loc.dir.join("main.rs"), "fn main() {}\n").unwrap();

    let data = loc.dir.join(DATA_DIR);
    assert!(data.join("worklogs").join("WORK-0001.md").is_file());

    let gone = store.delete_project().expect("delete");
    assert_eq!(gone.name, "Doomed");
    assert_eq!(gone.counts.work_total, 1, "the count is taken before the delete");
    assert!(gone.counts.events >= 2, "created + work_started: {:?}", gone.counts);
    assert!(!data.exists(), "{} is still on disk", data.display());
    assert!(loc.dir.join("main.rs").is_file(), "the human's files are untouched");

    // And it is gone for good: the second attempt is a missing project, not a second delete.
    let again = store.delete_project().unwrap_err();
    assert_eq!(again.kind(), "project_not_found", "{again}");
}

/// Two projects at two locations are two worlds: deleting one leaves the other whole.
#[test]
fn deleting_one_project_leaves_a_neighbour_alone() {
    let doomed = TempLocation::new("doomed");
    let kept = TempLocation::new("kept");
    let doomed_store = doomed.project("Doomed");
    let kept_store = kept.project("Kept");
    work(&doomed_store);
    work(&kept_store);

    doomed_store.delete_project().expect("delete");
    assert!(kept
        .dir
        .join(DATA_DIR)
        .join("worklogs")
        .join("WORK-0001.md")
        .is_file());
    assert_eq!(kept_store.project().unwrap().name, "Kept");
}

/// A folder that is not named `AgentMonitoring` is refused even when it parses as a
/// project — `Store::open` is lenient about renamed folders so a human can still read
/// them, but the destructive verb is not.
#[test]
fn delete_refuses_a_folder_not_named_agentmonitoring() {
    let loc = TempLocation::new("renamed");
    let store = loc.project("Renamed");
    work(&store);
    let renamed = loc.dir.join("SomethingElse");
    fs::rename(loc.dir.join(DATA_DIR), &renamed).unwrap();

    let reopened = Store::open(&renamed).expect("a renamed folder still opens for reading");
    let err = reopened.delete_project().unwrap_err();
    assert_eq!(err.kind(), "conflict", "{err}");
    assert!(
        renamed.join("worklogs").join("WORK-0001.md").is_file(),
        "nothing was removed"
    );
}

/// A data folder that is really a link somewhere else is refused rather than followed —
/// the case a symlink or a Windows junction produces.
///
/// Making one needs Developer Mode or an elevated shell on Windows, so the test *skips*
/// rather than fails when the platform will not create the link.
#[test]
fn a_data_folder_that_points_somewhere_else_is_refused() {
    let loc = TempLocation::new("link");
    let outside = loc.dir.join("elsewhere");
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("keep-me.txt"), "not part of any project\n").unwrap();
    // A project.json inside it, so the only thing standing between this and
    // `remove_dir_all` is the post-canonicalisation name check.
    fs::write(
        outside.join("project.json"),
        "{\"version\":2,\"id\":\"prj-link\",\"name\":\"Linked\"}\n",
    )
    .unwrap();

    let link = loc.dir.join(DATA_DIR);
    if !make_dir_link(&outside, &link) {
        eprintln!("skipping: this machine cannot create a directory symlink");
        return;
    }

    let store = Store::open(&link).expect("the link opens for reading");
    let err = store.delete_project().unwrap_err();
    assert_eq!(err.kind(), "conflict", "{err}");
    assert!(
        outside.join("keep-me.txt").is_file(),
        "the linked-to directory must be untouched"
    );
    let _ = fs::remove_dir(&link);
}

#[cfg(windows)]
fn make_dir_link(target: &std::path::Path, link: &std::path::Path) -> bool {
    std::os::windows::fs::symlink_dir(target, link).is_ok()
}

#[cfg(not(windows))]
fn make_dir_link(target: &std::path::Path, link: &std::path::Path) -> bool {
    std::os::unix::fs::symlink(target, link).is_ok()
}
