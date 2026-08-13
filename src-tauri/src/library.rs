//! One authoritative filesystem root for the whole Alcove library.
//!
//! The NSIS installer writes `library-location.txt` into Tauri's normal app
//! config directory.  We read that pointer before the SQL plugin is built so
//! its migration URL, the media store, backups and imports all follow the same
//! folder.  The pointer deliberately stays in the normal config directory:
//! it remains discoverable even when the library itself lives on another
//! drive.

use serde::Serialize;
use std::path::{Component, Path, PathBuf};

pub const APP_IDENTIFIER: &str = "com.alcove.app";
pub const LOCATION_FILE: &str = "library-location.txt";
pub const DB_FILE: &str = "notebook.db";

#[derive(Debug, Clone)]
pub struct LibraryPaths {
    root: PathBuf,
    db_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    pub root: String,
    pub assets_root: String,
    pub db_url: String,
}

impl LibraryPaths {
    /// Resolve the installer choice before Tauri plugins are constructed.
    pub fn resolve() -> Result<Self, String> {
        let default = default_library_root()?;
        let pointer = default.join(LOCATION_FILE);
        let selected = match std::fs::read_to_string(&pointer) {
            Ok(raw) => {
                let candidate = PathBuf::from(raw.trim().trim_matches('"'));
                if candidate.as_os_str().is_empty() {
                    default.clone()
                } else if !candidate.is_absolute() {
                    return Err(format!(
                        "library location in {} is not absolute",
                        pointer.display()
                    ));
                } else {
                    candidate
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => default.clone(),
            Err(error) => return Err(format!("cannot read {}: {error}", pointer.display())),
        };

        std::fs::create_dir_all(&selected)
            .map_err(|e| format!("cannot create library folder {}: {e}", selected.display()))?;

        // Choosing a location during an upgrade must never make an existing
        // library appear empty.  Copy, do not move: the old copy is a recovery
        // path until the reader has opened the new one successfully.
        if selected != default && !selected.join(DB_FILE).exists() && default.join(DB_FILE).exists()
        {
            copy_existing_library(&default, &selected)?;
        }

        let db_path = selected.join(DB_FILE);
        let db_url = format!("sqlite:{}", db_path.to_string_lossy());
        Ok(Self {
            root: selected,
            db_url,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn assets_root(&self) -> PathBuf {
        self.root.join("assets")
    }

    pub fn backups_root(&self) -> PathBuf {
        self.root.join("backups")
    }

    pub fn db_url(&self) -> &str {
        &self.db_url
    }

    fn info(&self) -> LibraryInfo {
        LibraryInfo {
            root: self.root.to_string_lossy().into_owned(),
            assets_root: self.assets_root().to_string_lossy().into_owned(),
            db_url: self.db_url.clone(),
        }
    }
}

/// The same directory Tauri's `app_config_dir()` uses for this identifier.
fn default_library_root() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        return std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .map(|root| root.join(APP_IDENTIFIER))
            .ok_or_else(|| "APPDATA is not available".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        return std::env::var_os("HOME")
            .map(PathBuf::from)
            .map(|root| {
                root.join("Library/Application Support")
                    .join(APP_IDENTIFIER)
            })
            .ok_or_else(|| "HOME is not available".to_string());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if let Some(root) = std::env::var_os("XDG_CONFIG_HOME") {
            return Ok(PathBuf::from(root).join(APP_IDENTIFIER));
        }
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .map(|root| root.join(".config").join(APP_IDENTIFIER))
            .ok_or_else(|| "neither XDG_CONFIG_HOME nor HOME is available".to_string())
    }
}

fn copy_existing_library(source: &Path, target: &Path) -> Result<(), String> {
    for name in [DB_FILE, "notebook.db-wal", "notebook.db-shm"] {
        let from = source.join(name);
        let to = target.join(name);
        if from.is_file() && !to.exists() {
            std::fs::copy(&from, &to)
                .map_err(|e| format!("cannot copy {} to {}: {e}", from.display(), to.display()))?;
        }
    }
    for name in ["assets", "backups"] {
        copy_directory_additive(&source.join(name), &target.join(name))?;
    }
    Ok(())
}

fn copy_directory_additive(source: &Path, target: &Path) -> Result<(), String> {
    if !source.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(target)
        .map_err(|e| format!("cannot create {}: {e}", target.display()))?;
    for entry in
        std::fs::read_dir(source).map_err(|e| format!("cannot read {}: {e}", source.display()))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = target.join(entry.file_name());
        if from.is_dir() {
            copy_directory_additive(&from, &to)?;
        } else if !to.exists() {
            std::fs::copy(&from, &to)
                .map_err(|e| format!("cannot copy {} to {}: {e}", from.display(), to.display()))?;
        }
    }
    Ok(())
}

fn safe_relative_path(raw: &str) -> Option<PathBuf> {
    let path = Path::new(raw);
    if path.is_absolute() || raw.contains(':') || raw.contains('\\') {
        return None;
    }
    let mut clean = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => clean.push(part),
            _ => return None,
        }
    }
    (!clean.as_os_str().is_empty()).then_some(clean)
}

#[tauri::command]
pub fn library_info(paths: tauri::State<'_, LibraryPaths>) -> LibraryInfo {
    paths.info()
}

/// Read an asset for bundle export without granting the webview a broad disk
/// permission when the selected library is outside `%APPDATA%`.
#[tauri::command]
pub async fn library_asset_read(
    paths: tauri::State<'_, LibraryPaths>,
    rel_path: String,
) -> Result<Vec<u8>, String> {
    const MAX_ASSET_BYTES: u64 = 64 * 1024 * 1024;
    let rel = safe_relative_path(&rel_path)
        .ok_or_else(|| "that asset path is not allowed".to_string())?;
    let target = paths.assets_root().join(rel);
    tauri::async_runtime::spawn_blocking(move || {
        let metadata = std::fs::metadata(&target)
            .map_err(|e| format!("cannot read {}: {e}", target.display()))?;
        if !metadata.is_file() || metadata.len() > MAX_ASSET_BYTES {
            return Err("asset is not a regular file or is too large".to_string());
        }
        std::fs::read(&target).map_err(|e| format!("cannot read {}: {e}", target.display()))
    })
    .await
    .map_err(|e| format!("asset read failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asset_paths_are_strictly_relative() {
        assert_eq!(
            safe_relative_path("images/cat.png"),
            Some(PathBuf::from("images/cat.png"))
        );
        assert_eq!(safe_relative_path("../secret"), None);
        assert_eq!(safe_relative_path("C:/secret"), None);
        assert_eq!(safe_relative_path("images\\cat.png"), None);
        assert_eq!(safe_relative_path(""), None);
    }
}
