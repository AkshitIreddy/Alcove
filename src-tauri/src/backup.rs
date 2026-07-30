//! Backup commands: zip the SQLite database + assets directory into a
//! timestamped archive, list existing archives, and restore from one.
//!
//! Design contract (wave-2 group F):
//! - `run_backup(target)` zips `notebook.db` (+ WAL/SHM sidecars when
//!   present) and the whole `assets/` tree into
//!   `<target or app-data>/backups/notebook-backup-YYYYMMDD-HHMMSS.zip`.
//! - `list_backups(target)` returns the archives in that folder, newest
//!   first (both regular and pre-restore safety copies).
//! - `restore_backup(path)` first writes a `notebook-prerestore-*.zip`
//!   safety copy of the CURRENT state into the default backups folder, then
//!   extracts the archive over the live files. Entry names are strictly
//!   validated (zip-slip safe): only `notebook.db(-wal|-shm)` and paths
//!   under `assets/` are ever written. The frontend closes the sql-plugin
//!   connection before invoking this and prompts for a restart afterwards.
//!
//! The sql plugin resolves `sqlite:notebook.db` against `app_config_dir`;
//! assets live under `app_data_dir/assets`. On Windows both roots are the
//! same Roaming folder, but the code keeps them distinct to stay correct on
//! every platform.

use serde::Serialize;
use std::fs::File;
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

/// File-name prefix for scheduled/manual backups.
const BACKUP_PREFIX: &str = "notebook-backup-";
/// File-name prefix for the automatic safety copy taken before a restore.
const PRERESTORE_PREFIX: &str = "notebook-prerestore-";
/// Database file name — must stay in sync with `DB_URL` in lib.rs.
const DB_FILE: &str = "notebook.db";
/// SQLite sidecars included when present so a WAL-mode db restores intact.
const DB_SIDECARS: [&str; 2] = ["notebook.db-wal", "notebook.db-shm"];

// ---------------------------------------------------------------------------
// Result types (camelCase over IPC)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    /// Absolute path of the archive that was written.
    pub path: String,
    /// Archive size in bytes.
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub path: String,
    pub file_name: String,
    pub bytes: u64,
    /// Last-modified time in ms since the Unix epoch, when readable.
    pub modified_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    /// Absolute path of the pre-restore safety copy.
    pub safety_copy: String,
    /// Number of files extracted from the archive.
    pub restored_files: u32,
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested below)
// ---------------------------------------------------------------------------

/// Days-since-epoch -> (year, month, day). Howard Hinnant's civil algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// UTC `YYYYMMDD-HHMMSS` slug for archive names.
fn timestamp_slug(secs_since_epoch: u64) -> String {
    let days = (secs_since_epoch / 86_400) as i64;
    let rem = secs_since_epoch % 86_400;
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}{m:02}{d:02}-{:02}{:02}{:02}",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

fn archive_name(prefix: &str, secs_since_epoch: u64) -> String {
    format!("{prefix}{}.zip", timestamp_slug(secs_since_epoch))
}

/// Is this file name one of our backup archives?
fn is_backup_archive(name: &str) -> bool {
    (name.starts_with(BACKUP_PREFIX) || name.starts_with(PRERESTORE_PREFIX))
        && name.ends_with(".zip")
}

/// Where a validated archive entry may be written on restore.
#[derive(Debug, PartialEq, Eq)]
enum RestoreTarget {
    /// One of the database files, written into the db root.
    Db(&'static str),
    /// A path relative to the assets root (already validated).
    Asset(PathBuf),
}

/// Classify an archive entry name; `None` means "never write this".
/// Zip-slip safe, validated at the string level (Path::components would
/// silently normalize `.` segments away): rejects backslashes, empty/`.`
/// /`..` segments, and `:` (drive letters, NTFS streams); only whitelisted
/// destinations pass.
fn classify_entry(name: &str) -> Option<RestoreTarget> {
    if name.is_empty() || name.contains('\\') || name.ends_with('/') {
        return None;
    }
    let bad_segment = name
        .split('/')
        .any(|seg| seg.is_empty() || seg == "." || seg == ".." || seg.contains(':'));
    if bad_segment {
        return None;
    }
    if name == DB_FILE {
        return Some(RestoreTarget::Db(DB_FILE));
    }
    for sidecar in DB_SIDECARS {
        if name == sidecar {
            return Some(RestoreTarget::Db(sidecar));
        }
    }
    let rel = name.strip_prefix("assets/")?;
    if rel.is_empty() {
        return None;
    }
    Some(RestoreTarget::Asset(PathBuf::from(rel)))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/// Directory holding `notebook.db` (sql plugin resolves against config dir).
fn db_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("no app config dir: {e}"))
}

/// Directory holding `assets/`.
fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))
}

/// Default backups folder: `<app-data>/backups` (created on demand).
fn default_backup_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("backups"))
}

/// The folder backups go to / are listed from.
fn resolve_target_dir(
    app: &tauri::AppHandle,
    target: Option<String>,
) -> Result<PathBuf, String> {
    match target {
        Some(t) if !t.trim().is_empty() => Ok(PathBuf::from(t.trim())),
        _ => default_backup_dir(app),
    }
}

// ---------------------------------------------------------------------------
// Zip writing
// ---------------------------------------------------------------------------

fn zip_options() -> SimpleFileOptions {
    SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .large_file(true)
}

fn add_file<W: Write + Seek>(
    zip: &mut ZipWriter<W>,
    disk_path: &Path,
    entry_name: &str,
) -> Result<(), String> {
    zip.start_file(entry_name, zip_options())
        .map_err(|e| format!("zip entry '{entry_name}': {e}"))?;
    let mut file =
        File::open(disk_path).map_err(|e| format!("open {}: {e}", disk_path.display()))?;
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file
            .read(&mut buf)
            .map_err(|e| format!("read {}: {e}", disk_path.display()))?;
        if n == 0 {
            break;
        }
        zip.write_all(&buf[..n])
            .map_err(|e| format!("write '{entry_name}': {e}"))?;
    }
    Ok(())
}

fn add_dir_recursive<W: Write + Seek>(
    zip: &mut ZipWriter<W>,
    dir: &Path,
    entry_prefix: &str,
) -> Result<u32, String> {
    let mut added = 0u32;
    let entries =
        std::fs::read_dir(dir).map_err(|e| format!("read dir {}: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let entry_name = format!("{entry_prefix}{name}");
        if path.is_dir() {
            added += add_dir_recursive(zip, &path, &format!("{entry_name}/"))?;
        } else {
            add_file(zip, &path, &entry_name)?;
            added += 1;
        }
    }
    Ok(added)
}

/// Zip the current db + assets into `dest`. Returns the archive size.
fn write_backup_archive(
    db_root: &Path,
    assets_root: &Path,
    dest: &Path,
) -> Result<u64, String> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create backup folder: {e}"))?;
    }
    let file =
        File::create(dest).map_err(|e| format!("cannot create {}: {e}", dest.display()))?;
    let mut zip = ZipWriter::new(file);

    let db_path = db_root.join(DB_FILE);
    if !db_path.exists() {
        return Err(format!("database not found at {}", db_path.display()));
    }
    add_file(&mut zip, &db_path, DB_FILE)?;
    for sidecar in DB_SIDECARS {
        let p = db_root.join(sidecar);
        if p.exists() {
            add_file(&mut zip, &p, sidecar)?;
        }
    }
    let assets = assets_root.join("assets");
    if assets.is_dir() {
        add_dir_recursive(&mut zip, &assets, "assets/")?;
    }
    zip.finish().map_err(|e| format!("finalize zip: {e}"))?;
    let bytes = std::fs::metadata(dest).map(|m| m.len()).unwrap_or(0);
    Ok(bytes)
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/// Extract a backup archive over the live files (entries pre-validated).
fn extract_archive(
    archive_path: &Path,
    db_root: &Path,
    assets_root: &Path,
) -> Result<u32, String> {
    let file = File::open(archive_path)
        .map_err(|e| format!("open {}: {e}", archive_path.display()))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("not a zip archive: {e}"))?;

    // A restore should not leave a stale WAL pairing a replaced db: remove
    // sidecars first; the archive re-adds them when it carries them.
    for sidecar in DB_SIDECARS {
        let _ = std::fs::remove_file(db_root.join(sidecar));
    }

    let mut restored = 0u32;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("read entry {i}: {e}"))?;
        let Some(target) = classify_entry(entry.name()) else {
            continue; // unknown/unsafe entries are silently skipped
        };
        let dest = match target {
            RestoreTarget::Db(name) => db_root.join(name),
            RestoreTarget::Asset(rel) => assets_root.join("assets").join(rel),
        };
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
        }
        let mut out =
            File::create(&dest).map_err(|e| format!("create {}: {e}", dest.display()))?;
        std::io::copy(&mut entry, &mut out)
            .map_err(|e| format!("extract {}: {e}", dest.display()))?;
        restored += 1;
    }
    if restored == 0 {
        return Err("archive contains no Notebook backup entries".to_string());
    }
    Ok(restored)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Zip the database + assets into `target` (or the default backups folder).
#[tauri::command]
pub async fn run_backup(
    app: tauri::AppHandle,
    target: Option<String>,
) -> Result<BackupResult, String> {
    let db_root = db_dir(&app)?;
    let assets_root = data_dir(&app)?;
    let dir = resolve_target_dir(&app, target)?;
    let dest = dir.join(archive_name(BACKUP_PREFIX, now_secs()));
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = write_backup_archive(&db_root, &assets_root, &dest)?;
        Ok(BackupResult {
            path: dest.to_string_lossy().into_owned(),
            bytes,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// List backup archives in `target` (or the default folder), newest first.
#[tauri::command]
pub async fn list_backups(
    app: tauri::AppHandle,
    target: Option<String>,
) -> Result<Vec<BackupEntry>, String> {
    let dir = resolve_target_dir(&app, target)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut out: Vec<BackupEntry> = Vec::new();
        let Ok(entries) = std::fs::read_dir(&dir) else {
            return Ok(out); // missing folder -> no backups, not an error
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !is_backup_archive(&name) {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            if !meta.is_file() {
                continue;
            }
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64);
            out.push(BackupEntry {
                path: entry.path().to_string_lossy().into_owned(),
                file_name: name,
                bytes: meta.len(),
                modified_ms,
            });
        }
        out.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Restore db + assets from a backup archive, after writing a safety copy
/// of the current state. The caller must close the sql-plugin connection
/// first and restart the app afterwards.
#[tauri::command]
pub async fn restore_backup(
    app: tauri::AppHandle,
    path: String,
) -> Result<RestoreResult, String> {
    let db_root = db_dir(&app)?;
    let assets_root = data_dir(&app)?;
    let safety_dir = default_backup_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let archive = PathBuf::from(path.trim());
        if !archive.is_file() {
            return Err(format!("backup not found: {}", archive.display()));
        }
        let safety = safety_dir.join(archive_name(PRERESTORE_PREFIX, now_secs()));
        write_backup_archive(&db_root, &assets_root, &safety)?;
        let restored_files = extract_archive(&archive, &db_root, &assets_root)?;
        Ok(RestoreResult {
            safety_copy: safety.to_string_lossy().into_owned(),
            restored_files,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamp_slug_formats_utc_dates() {
        assert_eq!(timestamp_slug(0), "19700101-000000");
        // 2024-02-29 12:34:56 UTC (leap day) = 1709210096
        assert_eq!(timestamp_slug(1_709_210_096), "20240229-123456");
        // 2026-07-30 00:00:00 UTC = 1785369600
        assert_eq!(timestamp_slug(1_785_369_600), "20260730-000000");
        assert_eq!(
            archive_name(BACKUP_PREFIX, 0),
            "notebook-backup-19700101-000000.zip"
        );
    }

    #[test]
    fn archive_name_detection() {
        assert!(is_backup_archive("notebook-backup-20260730-101500.zip"));
        assert!(is_backup_archive("notebook-prerestore-20260730-101500.zip"));
        assert!(!is_backup_archive("notebook-backup-20260730.txt"));
        assert!(!is_backup_archive("holiday-photos.zip"));
        assert!(!is_backup_archive(""));
    }

    #[test]
    fn classify_entry_is_zip_slip_safe() {
        assert_eq!(classify_entry("notebook.db"), Some(RestoreTarget::Db("notebook.db")));
        assert_eq!(
            classify_entry("notebook.db-wal"),
            Some(RestoreTarget::Db("notebook.db-wal"))
        );
        assert_eq!(
            classify_entry("assets/images/a.png"),
            Some(RestoreTarget::Asset(PathBuf::from("images/a.png")))
        );
        // Directory markers, unknown files, and escapes are all rejected.
        assert_eq!(classify_entry("assets/"), None);
        assert_eq!(classify_entry("assets"), None);
        assert_eq!(classify_entry("readme.txt"), None);
        assert_eq!(classify_entry("../evil.db"), None);
        assert_eq!(classify_entry("assets/../../evil.png"), None);
        assert_eq!(classify_entry("assets/./x.png"), None);
        assert_eq!(classify_entry("/etc/passwd"), None);
        assert_eq!(classify_entry("assets\\images\\a.png"), None);
        assert_eq!(classify_entry("C:/Windows/evil.dll"), None);
        assert_eq!(classify_entry(""), None);
    }

    #[test]
    fn backup_roundtrip_in_tempdir() {
        // Build a fake app-data layout, back it up, wipe it, restore it.
        let root = std::env::temp_dir().join(format!("nb-backup-test-{}", now_secs()));
        let db_root = root.join("config");
        let data_root = root.join("data");
        std::fs::create_dir_all(db_root.as_path()).unwrap();
        std::fs::create_dir_all(data_root.join("assets").join("images")).unwrap();
        std::fs::write(db_root.join(DB_FILE), b"sqlite-bytes").unwrap();
        std::fs::write(
            data_root.join("assets").join("images").join("pic.png"),
            b"png-bytes",
        )
        .unwrap();

        let dest = root.join("backups").join("notebook-backup-test.zip");
        let bytes = write_backup_archive(&db_root, &data_root, &dest).unwrap();
        assert!(bytes > 0);
        assert!(dest.is_file());

        // Wipe the originals, then restore from the archive.
        std::fs::remove_file(db_root.join(DB_FILE)).unwrap();
        std::fs::remove_dir_all(data_root.join("assets")).unwrap();
        let restored = extract_archive(&dest, &db_root, &data_root).unwrap();
        assert_eq!(restored, 2);
        assert_eq!(std::fs::read(db_root.join(DB_FILE)).unwrap(), b"sqlite-bytes");
        assert_eq!(
            std::fs::read(data_root.join("assets/images/pic.png")).unwrap(),
            b"png-bytes"
        );

        std::fs::remove_dir_all(&root).ok();
    }
}
