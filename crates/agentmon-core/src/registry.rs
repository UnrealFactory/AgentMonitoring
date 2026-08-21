//! The per-user list of known projects: `~/.AgentMonitoring/registry.json`.
//!
//! The registry stores **paths only** — name, description and counts are always read from
//! the project folder itself, because the folder is the single source of truth and this
//! file is a bookmark list. (One cached field, `name`, exists so a path whose drive is
//! unplugged can still be listed by name as *unavailable* rather than as a bare path.)
//!
//! It is machine-local on purpose: `git` moves the data, not the list — the same way a
//! clone does not appear in an editor's recent-folders list until it is opened once.
//!
//! Every operation is best-effort by design. A missing or corrupt registry loads as
//! empty, and a failure to save must never fail the mutation that triggered it —
//! headless agents and CI write records on machines that have no registry at all.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, Result};
use crate::store::normalize;

pub const REGISTRY_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryEntry {
    /// The `AgentMonitoring` directory of the project.
    pub path: PathBuf,
    #[serde(default)]
    pub added_at: Option<String>,
    /// Last name seen in the folder's project.json — display fallback for a path that is
    /// currently unreachable. Never authoritative while the folder exists.
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    pub version: u32,
    #[serde(default)]
    pub projects: Vec<RegistryEntry>,
}

impl Default for Registry {
    fn default() -> Self {
        Registry {
            version: REGISTRY_VERSION,
            projects: Vec::new(),
        }
    }
}

impl Registry {
    /// `~/.AgentMonitoring` — `USERPROFILE` on Windows, `HOME` elsewhere. `None` on the
    /// kind of stripped environment (some CI) that defines neither; callers treat that
    /// as "no registry", not as an error.
    pub fn dir() -> Option<PathBuf> {
        std::env::var_os("AGENTMON_REGISTRY_DIR")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(".AgentMonitoring")))
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".AgentMonitoring")))
    }

    pub fn file() -> Option<PathBuf> {
        Self::dir().map(|d| d.join("registry.json"))
    }

    /// Missing file, unreadable file, unparseable file: all load as an empty registry.
    /// A bookmark list is never worth refusing to start over.
    pub fn load() -> Registry {
        let Some(path) = Self::file() else {
            return Registry::default();
        };
        let Ok(raw) = fs::read_to_string(&path) else {
            return Registry::default();
        };
        serde_json::from_str(&raw).unwrap_or_default()
    }

    pub fn save(&self) -> Result<()> {
        let Some(path) = Self::file() else {
            return Err(CoreError::conflict(
                "no home directory to keep the project list in",
                "set USERPROFILE (Windows) or HOME, or AGENTMON_REGISTRY_DIR",
            ));
        };
        let json = format!("{}\n", serde_json::to_string_pretty(self).unwrap());
        crate::fsx::write_atomic(&path, &json)
    }

    /// Register a project path (deduplicated on the normalized path). Returns whether the
    /// entry is new. The path stored is the normalized `AgentMonitoring` directory.
    pub fn add(&mut self, path: &Path, name: Option<&str>) -> bool {
        let path = normalize(path);
        if let Some(existing) = self.projects.iter_mut().find(|e| normalize(&e.path) == path) {
            if let Some(n) = name {
                existing.name = Some(n.to_string());
            }
            return false;
        }
        self.projects.push(RegistryEntry {
            path,
            added_at: Some(crate::now_iso8601()),
            name: name.map(str::to_string),
        });
        true
    }

    /// Drop a path from the list. Touches no files on disk. Returns whether it was there.
    pub fn remove(&mut self, path: &Path) -> bool {
        let path = normalize(path);
        let before = self.projects.len();
        self.projects.retain(|e| normalize(&e.path) != path);
        self.projects.len() != before
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_is_idempotent_and_remove_undoes_it() {
        let mut reg = Registry::default();
        let p = std::env::temp_dir().join("agentmon-registry-test").join("AgentMonitoring");
        assert!(reg.add(&p, Some("Demo")));
        assert!(!reg.add(&p, Some("Demo renamed")), "same path registers once");
        assert_eq!(reg.projects.len(), 1);
        assert_eq!(reg.projects[0].name.as_deref(), Some("Demo renamed"));
        assert!(reg.remove(&p));
        assert!(reg.projects.is_empty());
        assert!(!reg.remove(&p), "removing a path that is not there is not an error");
    }

    #[test]
    fn a_corrupt_registry_loads_as_empty_rather_than_failing() {
        let dir = std::env::temp_dir().join(format!(
            "agentmon-registry-corrupt-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("registry.json"), "{ not json").unwrap();
        // Point the registry at the corrupt file via the env override, in-process.
        let prev = std::env::var_os("AGENTMON_REGISTRY_DIR");
        std::env::set_var("AGENTMON_REGISTRY_DIR", &dir);
        let reg = Registry::load();
        assert!(reg.projects.is_empty());
        match prev {
            Some(v) => std::env::set_var("AGENTMON_REGISTRY_DIR", v),
            None => std::env::remove_var("AGENTMON_REGISTRY_DIR"),
        }
        fs::remove_dir_all(&dir).ok();
    }
}
