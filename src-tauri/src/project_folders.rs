//! Personal project organization; never moves or writes a project's records.
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::Path};
use tauri::{AppHandle, Manager};

#[derive(Debug, Default, Serialize, Deserialize, PartialEq)]
pub(crate) struct ProjectFolders {
    folders: Vec<Folder>,
    assignments: HashMap<String, String>,
    #[serde(default, rename = "projectOrder")]
    project_order: HashMap<String, Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct Folder {
    id: String,
    name: String,
}

fn read(path: &Path) -> Result<ProjectFolders, String> {
    match std::fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|err| err.to_string()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(ProjectFolders::default()),
        Err(err) => Err(err.to_string()),
    }
}

fn write(path: &Path, data: &ProjectFolders) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(data).map_err(|err| err.to_string())?;
    agentmon_core::fsx::write_atomic(path, &raw).map_err(|err| err.to_string())
}

#[tauri::command]
pub(crate) fn get_project_folders(app: AppHandle) -> Result<ProjectFolders, String> {
    let dir = app.path().app_config_dir().map_err(|err| err.to_string())?;
    read(&dir.join("project-folders.json"))
}

#[tauri::command]
pub(crate) fn set_project_folders(app: AppHandle, data: ProjectFolders) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|err| err.to_string())?;
    write(&dir.join("project-folders.json"), &data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn organization_survives_reopen_and_replacement_without_touching_projects() {
        let dir = std::env::temp_dir().join(format!("agentmon-folders-{}", std::process::id()));
        let file = dir.join("project-folders.json");
        std::fs::create_dir_all(&dir).unwrap();
        let project = dir.join("project-record.md");
        std::fs::write(&project, "keep this record").unwrap();
        assert_eq!(
            read(&dir.join("missing.json")).unwrap(),
            ProjectFolders::default()
        );
        let mut data = ProjectFolders {
            folders: vec![Folder {
                id: "folder-1".into(),
                name: "개인 프로젝트".into(),
            }],
            assignments: HashMap::from([(project.display().to_string(), "folder-1".into())]),
            project_order: HashMap::from([(
                "folder-1".into(),
                vec![project.display().to_string(), "another-project".into()],
            )]),
        };
        write(&file, &data).unwrap();
        assert_eq!(read(&file).unwrap(), data);
        let mut legacy = serde_json::to_value(&data).unwrap();
        legacy.as_object_mut().unwrap().remove("projectOrder");
        let legacy: ProjectFolders = serde_json::from_value(legacy).unwrap();
        assert_eq!(legacy.folders, data.folders);
        assert_eq!(legacy.assignments, data.assignments);
        assert!(legacy.project_order.is_empty());
        data.folders[0].name = "업무".into();
        write(&file, &data).unwrap();
        assert_eq!(read(&file).unwrap(), data);
        write(&file, &ProjectFolders::default()).unwrap();
        assert_eq!(read(&file).unwrap(), ProjectFolders::default());
        assert_eq!(
            std::fs::read_to_string(&project).unwrap(),
            "keep this record"
        );
        std::fs::write(&file, "broken json").unwrap();
        assert!(read(&file).is_err());
        let target = dir.canonicalize().unwrap();
        let temp = std::env::temp_dir().canonicalize().unwrap();
        assert!(target.starts_with(&temp) && target != temp);
        std::fs::remove_dir_all(target).unwrap();
    }
}
