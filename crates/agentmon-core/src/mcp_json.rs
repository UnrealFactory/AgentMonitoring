//! The optional `.mcp.json` a new project can start with.
//!
//! The counterpart of [`claude_md`](crate::claude_md), one step further: instead of a
//! CLAUDE.md that *teaches an agent* how to register the agentmon MCP server, the app
//! (or `agentmon init --mcp-json`) registers it — it is the one party that actually
//! knows where `mcp/server.mjs` is on this machine, so making the agent go find it was
//! always the wrong direction. Claude Code (and every client that honours project-scope
//! MCP config) reads `<repo>/.mcp.json` on its own; the tools are just *there* from the
//! agent's first session.
//!
//! The write is conservative about a file it does not own, the way `write_claude_md` is
//! about CLAUDE.md: other servers in an existing `.mcp.json` are preserved untouched,
//! only the `agentmon` entry is added or replaced, an identical entry changes nothing,
//! and a file that is not valid JSON is refused rather than clobbered.
//!
//! The paths inside the entry are absolute and machine-specific — unavoidable, since the
//! server's own location is. On another machine, creating or re-opening the project
//! through the app there rewrites the entry for that machine.

use std::path::{Path, PathBuf};

use crate::error::{CoreError, Result};
use crate::fsx;

/// What [`write_mcp_json`] did to the file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpJsonOutcome {
    /// No `.mcp.json` existed; one was written.
    Created,
    /// The file existed; the `agentmon` entry was added or replaced, everything else kept.
    Updated,
    /// The file already carries exactly this entry.
    AlreadyPresent,
}

/// The `mcp/server.mjs` this machine has, found from the running executable.
///
/// Two layouts, one probe: the installed app keeps the server *beside* the binaries
/// (`<install>/mcp/server.mjs`, per src-tauri/tauri.release.conf.json), and a source
/// checkout keeps it at `<repo>/mcp/server.mjs` — a few levels above
/// `target/{debug,release}/agentmon.exe`. `None` means this build has no server to
/// point at, and the caller should say so rather than write a dead path.
pub fn find_mcp_server() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let mut dir: Option<&Path> = exe.parent();
    for _ in 0..6 {
        let d = dir?;
        let candidate = d.join("mcp").join("server.mjs");
        if candidate.is_file() {
            return Some(candidate);
        }
        dir = d.parent();
    }
    None
}

/// JSON paths read best (and diff best) with forward slashes, which Node accepts on
/// every platform — the docs' own examples are written `C:/...`.
fn json_path(p: &Path) -> String {
    p.display().to_string().replace('\\', "/")
}

/// The `mcpServers.agentmon` value: `node <server> --dir <location> [--agent <handle>]`.
fn agentmon_entry(server: &Path, location: &Path, agent: Option<&str>) -> serde_json::Value {
    let mut args = vec![json_path(server), "--dir".to_string(), json_path(location)];
    if let Some(handle) = agent.map(str::trim).filter(|h| !h.is_empty()) {
        args.push("--agent".to_string());
        args.push(handle.to_string());
    }
    serde_json::json!({ "command": "node", "args": args })
}

/// Write (or update) `<location>/.mcp.json` so the agentmon MCP server is registered for
/// every agent that opens this repo. `location` is the folder that holds the
/// `AgentMonitoring` folder — the repo root, where clients look for the file — and
/// `server` is the `mcp/server.mjs` to point at ([`find_mcp_server`]). `agent` is the
/// default handle written onto records; `None` leaves it to each call.
pub fn write_mcp_json(
    location: &Path,
    server: &Path,
    agent: Option<&str>,
) -> Result<(PathBuf, McpJsonOutcome)> {
    let path = location.join(".mcp.json");
    let existing = match std::fs::read_to_string(&path) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(CoreError::io(&path, e)),
    };

    let mut root = match &existing {
        None => serde_json::json!({}),
        Some(text) => serde_json::from_str::<serde_json::Value>(text).map_err(|e| {
            CoreError::Malformed {
                path: path.clone(),
                message: format!(
                    "not valid JSON ({e}); fix or remove the file, then create the \
                     registration again"
                ),
            }
        })?,
    };
    if !root.is_object() {
        return Err(CoreError::Malformed {
            path,
            message: "the top level is not a JSON object; fix or remove the file, then \
                      create the registration again"
                .to_string(),
        });
    }

    let entry = agentmon_entry(server, location, agent);
    let servers = root
        .as_object_mut()
        .expect("checked above")
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}));
    let Some(servers) = servers.as_object_mut() else {
        return Err(CoreError::Malformed {
            path,
            message: "\"mcpServers\" is not a JSON object; fix or remove the file, then \
                      create the registration again"
                .to_string(),
        });
    };

    let outcome = match servers.get("agentmon") {
        Some(current) if *current == entry => McpJsonOutcome::AlreadyPresent,
        Some(_) => {
            servers.insert("agentmon".to_string(), entry);
            McpJsonOutcome::Updated
        }
        None if existing.is_none() => {
            servers.insert("agentmon".to_string(), entry);
            McpJsonOutcome::Created
        }
        None => {
            servers.insert("agentmon".to_string(), entry);
            McpJsonOutcome::Updated
        }
    };

    if outcome != McpJsonOutcome::AlreadyPresent {
        let text = format!(
            "{}\n",
            serde_json::to_string_pretty(&root).expect("a Value serializes")
        );
        fsx::write_atomic(&path, &text)?;
    }
    Ok((path, outcome))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "agentmon-mcp-json-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn read(path: &Path) -> serde_json::Value {
        serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn creates_then_holds_then_updates() {
        let dir = tmp("lifecycle");
        let server = Path::new(r"C:\Apps\AgentMonitoring\mcp\server.mjs");

        let (path, outcome) = write_mcp_json(&dir, server, Some("claude")).unwrap();
        assert_eq!(outcome, McpJsonOutcome::Created);
        let json = read(&path);
        let entry = &json["mcpServers"]["agentmon"];
        assert_eq!(entry["command"], "node");
        let args: Vec<&str> = entry["args"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert_eq!(args[0], "C:/Apps/AgentMonitoring/mcp/server.mjs", "forward slashes");
        assert_eq!(args[1], "--dir");
        assert_eq!(args[3], "--agent");
        assert_eq!(args[4], "claude");
        assert!(fs::read_to_string(&path).unwrap().ends_with('\n'));

        // The same registration again: untouched.
        let before = fs::read_to_string(&path).unwrap();
        assert_eq!(
            write_mcp_json(&dir, server, Some("claude")).unwrap().1,
            McpJsonOutcome::AlreadyPresent
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), before);

        // A different handle: the entry is replaced, and says so.
        assert_eq!(
            write_mcp_json(&dir, server, Some("codex")).unwrap().1,
            McpJsonOutcome::Updated
        );
        assert_eq!(read(&path)["mcpServers"]["agentmon"]["args"][4], "codex");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn other_servers_in_an_existing_file_are_preserved() {
        let dir = tmp("merge");
        fs::write(
            dir.join(".mcp.json"),
            r#"{ "mcpServers": { "other": { "command": "python", "args": ["x.py"] } }, "note": 1 }"#,
        )
        .unwrap();

        let (path, outcome) =
            write_mcp_json(&dir, Path::new("/opt/agentmon/mcp/server.mjs"), None).unwrap();
        assert_eq!(outcome, McpJsonOutcome::Updated, "added beside, not created over");
        let json = read(&path);
        assert_eq!(json["mcpServers"]["other"]["command"], "python", "the neighbour survives");
        assert_eq!(json["note"], 1, "unknown top-level keys survive");
        let args = json["mcpServers"]["agentmon"]["args"].as_array().unwrap();
        assert_eq!(args.len(), 3, "no --agent when none was given: {args:?}");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_file_that_is_not_json_is_refused_not_clobbered() {
        let dir = tmp("broken");
        let path = dir.join(".mcp.json");
        fs::write(&path, "{ not json").unwrap();

        let err = write_mcp_json(&dir, Path::new("s.mjs"), None).unwrap_err();
        assert!(err.to_string().contains(".mcp.json"), "{err}");
        assert!(err.to_string().contains("not valid JSON"), "{err}");
        assert_eq!(fs::read_to_string(&path).unwrap(), "{ not json", "untouched");

        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_blank_agent_is_the_same_as_none() {
        let dir = tmp("blank-agent");
        write_mcp_json(&dir, Path::new("s.mjs"), Some("  ")).unwrap();
        let args = read(&dir.join(".mcp.json"))["mcpServers"]["agentmon"]["args"]
            .as_array()
            .unwrap()
            .len();
        assert_eq!(args, 3);
        fs::remove_dir_all(&dir).unwrap();
    }
}
