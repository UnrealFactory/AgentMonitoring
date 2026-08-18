//! Filesystem primitives every write path goes through.
//!
//! Two agents writing to one vault at the same time is the normal case, not the edge
//! case, so the rules here are deliberately boring:
//!
//!   * **Never write a record in place.** Content goes to a temp file in the same
//!     directory and is then renamed over the target. A reader either sees the old file
//!     or the new one, never a half-written one. (`fs::rename` replaces an existing file
//!     on both Windows — `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING` — and Unix.)
//!   * **One writer per project.** [`ProjectLock`] is a `create_new` lock file, taken for
//!     the whole read-modify-write of a record so id allocation cannot race.
//!   * **Appends are one `write` call.** `events.jsonl` lines are appended with a single
//!     write of a single line, so even a reader without the lock never sees a torn line.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::error::{CoreError, Result};

/// How long to wait for another agent's lock before giving up.
const LOCK_TIMEOUT: Duration = Duration::from_secs(10);
/// A lock older than this belonged to a process that died; it is stolen rather than
/// blocking the vault forever.
const LOCK_STALE_AFTER: Duration = Duration::from_secs(120);

pub const LOCK_FILE: &str = ".agentmon.lock";

/// Exclusive write lock over one project directory, released on drop.
#[derive(Debug)]
pub struct ProjectLock {
    path: PathBuf,
}

impl ProjectLock {
    pub fn acquire(dir: &Path) -> Result<ProjectLock> {
        let path = dir.join(LOCK_FILE);
        let deadline = Instant::now() + LOCK_TIMEOUT;
        let mut spins = 0u32;
        loop {
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(mut f) => {
                    let _ = writeln!(
                        f,
                        "pid={} since={}",
                        std::process::id(),
                        crate::now_iso8601()
                    );
                    return Ok(ProjectLock { path });
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    let held = lock_age(&path);
                    if held >= LOCK_STALE_AFTER {
                        // The holder is gone (crash, kill). Reclaim it; worst case the
                        // other process is merely very slow and its own rename still
                        // lands atomically.
                        let _ = fs::remove_file(&path);
                        continue;
                    }
                    if Instant::now() >= deadline {
                        return Err(CoreError::Locked {
                            path,
                            held_secs: held.as_secs(),
                        });
                    }
                    spins += 1;
                    std::thread::sleep(backoff(spins));
                }
                Err(e) => return Err(CoreError::io(&path, e)),
            }
        }
    }
}

impl Drop for ProjectLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn lock_age(path: &Path) -> Duration {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .unwrap_or_default()
}

/// Exponential-ish backoff with jitter, so two waiters do not retry in lockstep.
fn backoff(spins: u32) -> Duration {
    let base = 5u64.saturating_mul(1 << spins.min(5)); // 10..160ms
    Duration::from_millis(base.min(160) + jitter_ms())
}

fn jitter_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| (d.subsec_nanos() % 11) as u64)
        .unwrap_or(3)
}

/// Write `contents` to `path` atomically (temp file in the same directory + rename).
pub fn write_atomic(path: &Path, contents: &str) -> Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(dir).map_err(|e| CoreError::io(dir, e))?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "record".into());
    let tmp = dir.join(format!(
        ".{name}.{}.{}.tmp",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    fs::write(&tmp, contents).map_err(|e| CoreError::io(&tmp, e))?;

    // Windows can fail a rename transiently while an indexer or virus scanner holds the
    // destination open; a few short retries turn that into a non-event.
    let mut last = None;
    for attempt in 0..5 {
        match fs::rename(&tmp, path) {
            Ok(()) => return Ok(()),
            Err(e) => {
                last = Some(e);
                std::thread::sleep(Duration::from_millis(10 * (attempt + 1)));
            }
        }
    }
    let _ = fs::remove_file(&tmp);
    Err(CoreError::io(
        path,
        last.unwrap_or_else(|| std::io::Error::other("rename failed")),
    ))
}

/// Create a file only if it does not exist yet. `Ok(false)` means someone won the race.
pub fn write_new(path: &Path, contents: &str) -> Result<bool> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| CoreError::io(dir, e))?;
    }
    match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(mut f) => {
            f.write_all(contents.as_bytes())
                .map_err(|e| CoreError::io(path, e))?;
            f.flush().map_err(|e| CoreError::io(path, e))?;
            Ok(true)
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Ok(false),
        Err(e) => Err(CoreError::io(path, e)),
    }
}

/// Append one already-newline-terminated line in a single write call.
pub fn append_line(path: &Path, line: &str) -> Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| CoreError::io(dir, e))?;
    }
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| CoreError::io(path, e))?;
    let mut buf = line.trim_end_matches(['\r', '\n']).to_string();
    buf.push('\n');
    f.write_all(buf.as_bytes())
        .map_err(|e| CoreError::io(path, e))?;
    f.flush().map_err(|e| CoreError::io(path, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "agentmon-fsx-{tag}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn write_atomic_replaces_existing_content() {
        let dir = tmpdir("atomic");
        let f = dir.join("WORK-0001.md");
        write_atomic(&f, "first").unwrap();
        write_atomic(&f, "second").unwrap();
        assert_eq!(fs::read_to_string(&f).unwrap(), "second");
        // no temp files left behind
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files left: {leftovers:?}");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn write_new_refuses_to_clobber() {
        let dir = tmpdir("new");
        let f = dir.join("BUG-0001.md");
        assert!(write_new(&f, "mine").unwrap());
        assert!(!write_new(&f, "yours").unwrap());
        assert_eq!(fs::read_to_string(&f).unwrap(), "mine");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn lock_is_exclusive_and_released_on_drop() {
        let dir = tmpdir("lock");
        let held = ProjectLock::acquire(&dir).unwrap();
        assert!(dir.join(LOCK_FILE).exists());
        drop(held);
        assert!(!dir.join(LOCK_FILE).exists());
        // re-acquirable afterwards
        let _again = ProjectLock::acquire(&dir).unwrap();
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn append_line_never_interleaves_partial_lines() {
        let dir = tmpdir("append");
        let f = dir.join("events.jsonl");
        std::thread::scope(|s| {
            for t in 0..8 {
                let f = f.clone();
                s.spawn(move || {
                    for i in 0..25 {
                        append_line(&f, &format!("{{\"t\":{t},\"i\":{i}}}")).unwrap();
                    }
                });
            }
        });
        let text = fs::read_to_string(&f).unwrap();
        let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
        assert_eq!(lines.len(), 200);
        for l in lines {
            serde_json::from_str::<serde_json::Value>(l).expect("every line is whole JSON");
        }
        fs::remove_dir_all(&dir).ok();
    }
}
