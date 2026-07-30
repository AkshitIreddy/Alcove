use tauri_plugin_sql::{Migration, MigrationKind};

mod backup;
mod export;
mod import;
mod media;
mod transfer;
mod tray;

/// Connection string for the app database. Must stay in sync with
/// `DB_PATH` in `src/data/db.ts` on the frontend.
const DB_URL: &str = "sqlite:notebook.db";

fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "initial_schema",
        kind: MigrationKind::Up,
        sql: r#"
            CREATE TABLE IF NOT EXISTS books (
                id         TEXT PRIMARY KEY,
                title      TEXT NOT NULL,
                floor      INTEGER NOT NULL,
                slot       INTEGER NOT NULL,
                spine_seed INTEGER NOT NULL,
                cover_meta TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS pages (
                id            TEXT PRIMARY KEY,
                book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                ord           INTEGER NOT NULL,
                doc_json      TEXT NOT NULL,
                script_source TEXT,
                source_dirty  INTEGER NOT NULL DEFAULT 0,
                updated_at    TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS assets (
                id         TEXT PRIMARY KEY,
                rel_path   TEXT NOT NULL,
                kind       TEXT NOT NULL,
                meta       TEXT,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_pages_book_ord ON pages (book_id, ord);
            CREATE INDEX IF NOT EXISTS idx_books_floor_slot ON books (floor, slot);
        "#,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            media::save_image_asset,
            media::fetch_link_preview,
            media::fetch_images,
            backup::run_backup,
            backup::list_backups,
            backup::restore_backup,
            tray::tray_enable,
            tray::tray_disable,
            export::export_pdf,
            import::read_markdown_file,
            transfer::bundle_write,
            transfer::bundle_read,
            transfer::bundle_probe,
        ])
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(DB_URL, migrations())
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
