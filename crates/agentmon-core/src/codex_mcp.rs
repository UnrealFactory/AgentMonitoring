//! Project-scoped Codex MCP registration, preserving unrelated TOML and comments.

use std::path::{Path, PathBuf};
use toml_edit::{value, Array, Document, Item, Table};

use crate::error::{CoreError, Result};
use crate::fsx;
use crate::mcp_json::{agentmon_args, McpJsonOutcome};

/// Create or replace only `[mcp_servers.agentmon]` in `.codex/config.toml`.
/// Codex loads this configuration only after the user trusts the project; this writer
/// does not modify trust or global settings. Invalid TOML is left untouched.
pub fn write_codex_mcp(
    location: &Path,
    server: &Path,
    agent: Option<&str>,
) -> Result<(PathBuf, McpJsonOutcome)> {
    let path = location.join(".codex").join("config.toml");
    let existing = match std::fs::read_to_string(&path) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(CoreError::io(&path, e)),
    };
    let mut doc = existing
        .as_deref()
        .unwrap_or("")
        .parse::<Document>()
        .map_err(|e| CoreError::Malformed {
            path: path.clone(),
            message: format!("not valid TOML ({e}); fix the file, then add Codex MCP again"),
        })?;
    if !doc.contains_key("mcp_servers") {
        let mut table = Table::new();
        table.set_implicit(true);
        doc.insert("mcp_servers", Item::Table(table));
    }
    let servers = doc["mcp_servers"]
        .as_table_like_mut()
        .ok_or_else(|| CoreError::Malformed {
            path: path.clone(),
            message: "\"mcp_servers\" is not a TOML table; fix the file, then add Codex MCP again"
                .into(),
        })?;
    let args = agentmon_args(server, location, agent);
    if let Some(entry) = servers.get("agentmon").and_then(Item::as_table_like) {
        let same_args = entry.get("args").and_then(Item::as_array).is_some_and(|a| {
            a.len() == args.len()
                && a.iter()
                    .zip(&args)
                    .all(|(a, b)| a.as_str() == Some(b.as_str()))
        });
        if entry.len() == 2
            && entry.get("command").and_then(Item::as_str) == Some("node")
            && same_args
        {
            return Ok((path, McpJsonOutcome::AlreadyPresent));
        }
    }
    let mut entry = Table::new();
    entry.insert("command", value("node"));
    entry.insert("args", value(args.iter().collect::<Array>()));
    servers.insert("agentmon", Item::Table(entry));
    fsx::write_atomic(&path, &doc.to_string())?;
    Ok((
        path,
        if existing.is_some() {
            McpJsonOutcome::Updated
        } else {
            McpJsonOutcome::Created
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "agentmon-codex-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(dir.join(".codex")).unwrap();
        dir
    }

    #[test]
    fn creates_valid_toml_with_escaped_paths_then_skips_and_updates() {
        let dir = tmp();
        let server = Path::new("C:/Apps/한글 \"quoted\"/mcp/server.mjs");
        let (path, outcome) = write_codex_mcp(&dir, server, Some(" codex ")).unwrap();
        assert_eq!(outcome, McpJsonOutcome::Created);
        let before = fs::read_to_string(&path).unwrap();
        let doc = before.parse::<Document>().unwrap();
        assert_eq!(
            doc["mcp_servers"]["agentmon"]["args"][0].as_str(),
            server.to_str()
        );
        assert_eq!(
            doc["mcp_servers"]["agentmon"]["args"][4].as_str(),
            Some("codex")
        );
        assert_eq!(
            write_codex_mcp(&dir, server, Some("codex")).unwrap().1,
            McpJsonOutcome::AlreadyPresent
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), before);
        assert_eq!(
            write_codex_mcp(&dir, Path::new(r"C:\New App\server.mjs"), None)
                .unwrap()
                .1,
            McpJsonOutcome::Updated
        );
        let updated = fs::read_to_string(path)
            .unwrap()
            .parse::<Document>()
            .unwrap();
        assert_eq!(
            updated["mcp_servers"]["agentmon"]["args"][0].as_str(),
            Some("C:/New App/server.mjs")
        );
        assert_eq!(
            updated["mcp_servers"]["agentmon"]["args"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
        assert!(!dir.join(".mcp.json").exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn preserves_settings_comments_and_other_servers() {
        let dir = tmp();
        let path = dir.join(".codex/config.toml");
        let original = "# My settings\nmodel = 'example-model' # keep this\n\n[mcp_servers.other]\ncommand = 'python'\nargs = ['other.py'] # keep that\n";
        fs::write(&path, original).unwrap();
        write_codex_mcp(&dir, Path::new("server.mjs"), Some("codex")).unwrap();
        assert!(fs::read_to_string(&path).unwrap().starts_with(original));
        // Updating a stale registration preserves the same unrelated text.
        write_codex_mcp(&dir, Path::new("moved.mjs"), Some("codex")).unwrap();
        assert!(fs::read_to_string(path).unwrap().starts_with(original));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn supports_inline_tables_and_replaces_old_transport() {
        for original in [
            "mcp_servers = { other = { command = 'keep' }, agentmon = { url = 'https://old.invalid' } }\n",
            "[mcp_servers]\nother = { command = 'keep' }\nagentmon = { url = 'https://old.invalid' }\n",
        ] {
            let dir = tmp();
            let path = dir.join(".codex/config.toml");
            fs::write(&path, original).unwrap();
            write_codex_mcp(&dir, Path::new("server.mjs"), Some("codex")).unwrap();
            let doc = fs::read_to_string(&path).unwrap().parse::<Document>().unwrap();
            assert_eq!(doc["mcp_servers"]["other"]["command"].as_str(), Some("keep"));
            assert_eq!(doc["mcp_servers"]["agentmon"]["command"].as_str(), Some("node"));
            assert!(doc["mcp_servers"]["agentmon"].get("url").is_none());
            assert_eq!(write_codex_mcp(&dir, Path::new("server.mjs"), Some("codex")).unwrap().1, McpJsonOutcome::AlreadyPresent);
            fs::remove_dir_all(dir).unwrap();
        }
    }

    #[test]
    fn rejects_malformed_toml_and_invalid_server_containers_without_writing() {
        for original in [
            "[broken",
            "mcp_servers = 3\n",
            "[[mcp_servers]]\nx = 1\n",
            "a = 1\na = 2\n",
        ] {
            let dir = tmp();
            let path = dir.join(".codex/config.toml");
            fs::write(&path, original).unwrap();
            let err = write_codex_mcp(&dir, Path::new("server.mjs"), None).unwrap_err();
            assert!(err.to_string().contains("config.toml"));
            assert_eq!(fs::read_to_string(path).unwrap(), original);
            fs::remove_dir_all(dir).unwrap();
        }
    }
}
