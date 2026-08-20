//! Deleting a project: the one call in this crate that takes records away.
//!
//! It exists for the human using the desktop app — a project they stopped using should be
//! removable from the window they read it in — and for nobody else: there is no `agentmon
//! project delete`, and no MCP tool, so an agent scripting against this vault cannot reach
//! it. What is tested here is therefore not "does it delete" alone but the three refusals
//! around it, because a delete that follows a bad path is not a bug you get to fix twice.
//!
//! Real directories, not a mocked filesystem: `remove_dir_all` on a tree of records is the
//! behaviour under test.

use std::fs;
use std::path::PathBuf;

use agentmon_core::{NewProject, StartWork, Vault};

struct TempVault {
    dir: PathBuf,
    vault: Vault,
}

impl TempVault {
    fn new(tag: &str) -> TempVault {
        let dir = std::env::temp_dir().join(format!(
            "agentmon-delete-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let vault = Vault::init(&dir, "Delete test vault").expect("init");
        TempVault { dir, vault }
    }

    fn project(&self, slug: &str) {
        self.vault
            .create_project(&NewProject {
                slug: slug.into(),
                name: format!("Project {slug}"),
                description: "Created by the agentmon-core delete tests.".into(),
                tags: vec![],
                actor: "test-runner".into(),
                at: None,
            })
            .expect("create project");
    }

    fn work(&self, slug: &str) {
        self.vault
            .start_work(
                slug,
                &StartWork {
                    agent: "test-runner".into(),
                    title: "A record that goes with the project".into(),
                    body: "## What\n\nA work log inside a project this test is about to \
                           delete.\n\n## Why\n\nSo the delete has a real record to take with \
                           it, not an empty folder.\n\n## How\n\nWritten by the test harness \
                           through the same core write path the CLI uses.\n"
                        .into(),
                    ..Default::default()
                },
            )
            .expect("start work");
    }
}

impl Drop for TempVault {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

/// The whole point: the directory and everything in it stops existing, and the caller is
/// told what went — because after the call there is nothing left to ask.
#[test]
fn deleting_a_project_removes_its_directory_and_reports_what_was_in_it() {
    let tv = TempVault::new("removes");
    tv.project("doomed");
    tv.work("doomed");
    tv.project("kept");
    tv.work("kept");

    let dir = tv.dir.join("projects").join("doomed");
    assert!(dir.join("worklogs").join("WORK-0001.md").is_file());

    let gone = tv.vault.delete_project("doomed").expect("delete");
    assert_eq!(gone.slug, "doomed");
    assert_eq!(gone.name, "Project doomed");
    assert_eq!(gone.counts.work_total, 1, "the count is taken before the delete");
    assert!(gone.counts.events >= 2, "created + work_started: {:?}", gone.counts);
    assert!(!dir.exists(), "{} is still on disk", dir.display());

    // The vault is otherwise untouched: the neighbouring project keeps every file it had.
    assert!(tv
        .dir
        .join("projects")
        .join("kept")
        .join("worklogs")
        .join("WORK-0001.md")
        .is_file());
    let left = tv.vault.projects().expect("projects still list");
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].slug, "kept");

    // And it is gone for good: the second attempt is a missing project, not a second delete.
    let again = tv.vault.delete_project("doomed").unwrap_err();
    assert_eq!(again.kind(), "project_not_found", "{again}");
}

/// A slug is a path component, and this is the call where that matters most.
#[test]
fn a_slug_that_is_not_a_slug_never_reaches_the_filesystem() {
    let tv = TempVault::new("slug");
    tv.project("demo");
    let outside = tv.dir.join("projects").join("..").join("vault.json");
    assert!(outside.exists());

    for bad in ["../../etc", "..", "demo/worklogs", "C:\\Windows", "DEMO", ""] {
        let err = tv
            .vault
            .delete_project(bad)
            .expect_err("a slug that is not a slug must be refused");
        assert_eq!(err.kind(), "invalid_argument", "{bad:?}: {err}");
    }

    // Nothing was touched by any of them.
    assert!(tv.dir.join("vault.json").is_file());
    assert!(tv.dir.join("projects").join("demo").join("project.json").is_file());
}

/// A well-formed slug that names nothing is a missing project, not an empty delete.
#[test]
fn deleting_a_project_that_is_not_there_says_so() {
    let tv = TempVault::new("absent");
    tv.project("demo");
    let err = tv.vault.delete_project("no-such-project").unwrap_err();
    assert_eq!(err.kind(), "project_not_found", "{err}");
    assert!(tv.dir.join("projects").join("demo").is_dir());
}

/// A directory inside `projects/` that resolves somewhere else is refused rather than
/// followed — the case a symlink or a Windows junction produces.
///
/// Making one needs Developer Mode or an elevated shell on Windows, so the test *skips*
/// rather than fails when the platform will not create the link: the rule itself is proved
/// unconditionally by the unit test on `inside_projects` in src/write.rs, and this is the
/// end-to-end confirmation for the machines that can run it.
#[test]
fn a_project_directory_that_points_out_of_the_vault_is_refused() {
    let tv = TempVault::new("link");
    tv.project("real");
    let outside = tv.dir.join("elsewhere");
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("keep-me.txt"), "not part of any vault\n").unwrap();
    // A project.json inside it, so the only thing standing between this and `remove_dir_all`
    // is the containment check.
    fs::write(
        outside.join("project.json"),
        "{\"id\":\"prj-link\",\"slug\":\"link\",\"name\":\"Linked\"}\n",
    )
    .unwrap();

    let link = tv.dir.join("projects").join("link");
    if !make_dir_link(&outside, &link) {
        eprintln!("skipping: this machine cannot create a directory symlink");
        return;
    }

    let err = tv.vault.delete_project("link").unwrap_err();
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
