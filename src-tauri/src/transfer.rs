//! Notebook Bundle (`.nbk`) archive plumbing — the dumb half of the
//! customizable export / additive import feature.
//!
//! This module knows about **files and zip entries only**. It never looks
//! inside a manifest, never touches SQLite, and has no idea what a book is;
//! the data model lives entirely in TypeScript (src/features/transfer/**).
//! That split is deliberate: the JS side owns conflict resolution and restore
//! points, so the Rust surface stays four small, auditable commands.
//!
//! * `bundle_write`       — entries → deflate-compressed archive on disk
//! * `bundle_read`        — archive on disk → decompressed entries
//! * `bundle_probe`       — just `manifest.json`, for a fast preview
//! * `bundle_write_asset` — write one imported media file under app data
//!
//! A pure-TypeScript codec (src/features/transfer/zip.ts) mirrors the first
//! two so the browser dev build and the unit tests work without Rust; these
//! commands are an optimization (real deflate) and the Tauri filesystem path,
//! never a requirement.
//!
//! There was a third mirror here — `fnv1a_hex`, byte-identical to
//! `checksumBytes` in src/features/transfer/format.ts, with a note saying to
//! keep the two in sync. Nothing called it. It could not have been called
//! usefully either: a checksum is over a manifest's inventory, and the first
//! paragraph of this file is the promise that Rust never opens a manifest. So
//! it was a standing obligation to maintain a function for a caller the design
//! forbids, and `cargo check` had been printing the only warning this crate
//! emits about it — which is worse than it sounds, because a build that always
//! has one warning is a build whose warnings stop being read.
//!
//! Registration (orchestrator): add `mod transfer;` in lib.rs and
//! `transfer::bundle_write`, `transfer::bundle_read`, `transfer::bundle_probe`,
//! `transfer::bundle_write_asset` to the `tauri::generate_handler![]` list.
//! No new crates required — `zip` is already a dependency.
//!
//! ALL FOUR. `bundle_write_asset` was left off that list and shipped that way:
//! `importAssets` in features/transfer/library.ts catches a failed invoke and
//! turns it into a per-file "could not save the asset" warning — correct
//! behaviour for a bad file, indistinguishable from a missing command — so a
//! bundle imported with pictures in it silently lost every one of them. The
//! only thing that knew was `cargo check`, because `generate_handler!` is the
//! only caller a command has. `tests/ipc-surface.test.ts` now holds both
//! directions of this so the next one fails a test instead of a reader.

use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

/// Refuse anything larger than this on read — a mispicked ISO must not eat
/// the webview's memory.
const MAX_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;
/// Per-entry cap on the decompressed size (zip-bomb guard).
const MAX_ENTRY_BYTES: u64 = 64 * 1024 * 1024;
const MANIFEST_NAME: &str = "manifest.json";

/// One archive member as it crosses IPC (field names match the JS payload).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleEntry {
    /// Forward-slash archive path, e.g. `pages/my-book/001-intro.nbs`.
    pub path: String,
    /// Raw, uncompressed bytes.
    pub bytes: Vec<u8>,
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

/// True when an archive path is safe to *store* and safe to *extract*:
/// relative, forward-slash, no `..`, no drive letter, no absolute root.
pub fn is_safe_archive_path(path: &str) -> bool {
    if path.is_empty() || path.len() > 400 {
        return false;
    }
    if path.starts_with('/') || path.starts_with('\\') || path.contains('\\') {
        return false;
    }
    if path.contains(':') {
        return false;
    }
    if path.contains('\0') {
        return false;
    }
    !path
        .split('/')
        .any(|part| part == ".." || part == "." || part.is_empty())
}

// ---------------------------------------------------------------------------
// Archive build / parse (pure, in-memory — unit-tested below)
// ---------------------------------------------------------------------------

/// Build a deflate-compressed archive from entries, preserving their order.
/// Unsafe paths are skipped rather than written.
pub fn build_archive(entries: &[BundleEntry]) -> Result<Vec<u8>, String> {
    let mut cursor = Cursor::new(Vec::<u8>::new());
    {
        let mut writer = ZipWriter::new(&mut cursor);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o644);
        for entry in entries {
            if !is_safe_archive_path(&entry.path) {
                continue;
            }
            writer
                .start_file(entry.path.clone(), options)
                .map_err(|e| format!("could not add {}: {e}", entry.path))?;
            writer
                .write_all(&entry.bytes)
                .map_err(|e| format!("could not write {}: {e}", entry.path))?;
        }
        writer
            .finish()
            .map_err(|e| format!("could not finish the archive: {e}"))?;
    }
    Ok(cursor.into_inner())
}

/// Read every safe, non-directory member of an archive held in memory.
pub fn read_archive(bytes: Vec<u8>) -> Result<Vec<BundleEntry>, String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| format!("this file is not a readable archive: {e}"))?;
    let mut out = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|e| format!("entry {index} could not be read: {e}"))?;
        if file.is_dir() {
            continue;
        }
        let name = file.name().to_string();
        if !is_safe_archive_path(&name) {
            continue;
        }
        if file.size() > MAX_ENTRY_BYTES {
            return Err(format!("“{name}” is too large to import"));
        }
        let mut buffer = Vec::with_capacity(file.size() as usize);
        file.read_to_end(&mut buffer)
            .map_err(|e| format!("“{name}” could not be decompressed: {e}"))?;
        out.push(BundleEntry {
            path: name,
            bytes: buffer,
        });
    }
    Ok(out)
}

/// Extract just `manifest.json` from an in-memory archive.
pub fn read_manifest(bytes: Vec<u8>) -> Result<String, String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| format!("this file is not a readable archive: {e}"))?;
    let mut file = archive
        .by_name(MANIFEST_NAME)
        .map_err(|_| "this archive has no manifest.json".to_string())?;
    if file.size() > MAX_ENTRY_BYTES {
        return Err("manifest.json is implausibly large".into());
    }
    let mut text = String::new();
    file.read_to_string(&mut text)
        .map_err(|e| format!("manifest.json could not be read: {e}"))?;
    Ok(text)
}

fn read_file_capped(path: &Path) -> Result<Vec<u8>, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("could not open the file: {e}"))?;
    if meta.len() > MAX_ARCHIVE_BYTES {
        return Err("that file is too large to be a Notebook bundle".into());
    }
    std::fs::read(path).map_err(|e| format!("could not read the file: {e}"))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Write entries to `path` as a `.nbk` archive. Returns the byte size.
#[tauri::command]
pub async fn bundle_write(path: String, entries: Vec<BundleEntry>) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if entries.is_empty() {
            return Err("nothing selected to export".to_string());
        }
        let bytes = build_archive(&entries)?;
        if let Some(parent) = Path::new(&path).parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("could not create the folder: {e}"))?;
            }
        }
        std::fs::write(&path, &bytes).map_err(|e| format!("could not write the bundle: {e}"))?;
        Ok(bytes.len() as u64)
    })
    .await
    .map_err(|e| format!("export task failed: {e}"))?
}

/// Read every member of the archive at `path`.
#[tauri::command]
pub async fn bundle_read(path: String) -> Result<Vec<BundleEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || read_archive(read_file_capped(Path::new(&path))?))
        .await
        .map_err(|e| format!("import task failed: {e}"))?
}

/// Read only `manifest.json` from the archive at `path` (fast preview).
#[tauri::command]
pub async fn bundle_probe(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || read_manifest(read_file_capped(Path::new(&path))?))
        .await
        .map_err(|e| format!("probe task failed: {e}"))?
}

/// Resolve `<app_data>/assets/<rel_path>`, refusing anything that escapes.
fn asset_target(app: &tauri::AppHandle, rel_path: &str) -> Result<PathBuf, String> {
    use tauri::Manager;
    if !is_safe_archive_path(rel_path) {
        return Err("that asset path is not allowed".into());
    }
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    Ok(base.join("assets").join(rel_path))
}

/// Write one imported media file. **Additive**: an existing file is left
/// alone and its path returned, so an import can never clobber media.
#[tauri::command]
pub async fn bundle_write_asset(
    app: tauri::AppHandle,
    rel_path: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let target = asset_target(&app, &rel_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        if target.exists() {
            return Ok(target.to_string_lossy().to_string());
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("could not create the assets folder: {e}"))?;
        }
        std::fs::write(&target, &bytes).map_err(|e| format!("could not save the asset: {e}"))?;
        Ok(target.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("asset write failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str, body: &str) -> BundleEntry {
        BundleEntry {
            path: path.to_string(),
            bytes: body.as_bytes().to_vec(),
        }
    }

    #[test]
    fn round_trips_entries() {
        let entries = vec![
            entry(MANIFEST_NAME, "{\"format\":\"notebook-bundle\"}"),
            entry("pages/my-book/001-intro.nbs", "# Intro\n\nhello\n"),
        ];
        let archive = build_archive(&entries).unwrap();
        let back = read_archive(archive).unwrap();
        assert_eq!(back.len(), 2);
        assert_eq!(back[0].path, MANIFEST_NAME);
        assert_eq!(back[1].bytes, entries[1].bytes);
    }

    #[test]
    fn manifest_probe_reads_only_the_manifest() {
        let entries = vec![
            entry(MANIFEST_NAME, "{\"schemaVersion\":1}"),
            entry("pages/a.nbs", "body"),
        ];
        let archive = build_archive(&entries).unwrap();
        assert_eq!(read_manifest(archive).unwrap(), "{\"schemaVersion\":1}");
    }

    #[test]
    fn deflate_actually_compresses() {
        let body = "the same line over and over\n".repeat(400);
        let archive = build_archive(&[entry("pages/big.nbs", &body)]).unwrap();
        assert!(archive.len() < body.len() / 4);
    }

    #[test]
    fn traversal_paths_are_refused() {
        assert!(!is_safe_archive_path("../secrets.txt"));
        assert!(!is_safe_archive_path("/etc/passwd"));
        assert!(!is_safe_archive_path("C:/Windows/System32"));
        assert!(!is_safe_archive_path("pages\\win.nbs"));
        assert!(!is_safe_archive_path("pages//double.nbs"));
        assert!(is_safe_archive_path("pages/my-book/001-intro.nbs"));
    }

    #[test]
    fn unsafe_entries_are_dropped_when_writing() {
        let entries = vec![entry("../escape.nbs", "no"), entry("ok.nbs", "yes")];
        let back = read_archive(build_archive(&entries).unwrap()).unwrap();
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].path, "ok.nbs");
    }

    #[test]
    fn missing_manifest_is_an_error_not_a_panic() {
        let archive = build_archive(&[entry("pages/a.nbs", "x")]).unwrap();
        assert!(read_manifest(archive).is_err());
    }

    #[test]
    fn garbage_bytes_do_not_panic() {
        assert!(read_archive(vec![0x00, 0x01, 0x02, 0x03]).is_err());
    }
}
