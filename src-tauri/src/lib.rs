use tauri::{Manager, WindowEvent};
use tauri_plugin_sql::{Migration, MigrationKind};

mod backup;
mod export;
mod import;
mod library;
mod media;
mod transfer;
mod tray;

/// Migrations for the app database.
///
/// The `'case-default'` id spelled inside migration 2 must stay in sync with
/// `DEFAULT_BOOKCASE_ID` in `src/data/books.ts`: the frontend's start-up sweep
/// and this migration have to agree on it, or a library ends up split across
/// two cases with one of them invisible.
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
    },
    // A library is a COLLECTION of bookcases, and every book stands in one of
    // them. This is the migration that must never lose a library, so the
    // assignment is done by SQLite itself rather than by a sweep the frontend
    // has to remember to run: `NOT NULL DEFAULT` back-fills every existing row
    // in the same statement that adds the column, atomically, inside the
    // migrator's transaction. There is no window in which a book has no case.
    //
    // sqlx records applied versions, so this runs exactly once; `ADD COLUMN`
    // has no IF NOT EXISTS, which is fine — a second run would abort the whole
    // transaction and change nothing. The frontend
    // (`src/data/bookcases.ts::ensureBookcases`) re-checks the same invariants
    // on every start anyway, because the browser-dev stub has no DDL at all.
    Migration {
        version: 2,
        description: "bookcases",
        kind: MigrationKind::Up,
        sql: r#"
            CREATE TABLE IF NOT EXISTS bookcases (
                id         TEXT PRIMARY KEY,
                name       TEXT NOT NULL,
                ord        INTEGER NOT NULL DEFAULT 0,
                -- LibraryPrefs JSON (the case's own room), or NULL to follow
                -- the app default. Opaque here; validated on the JS side.
                room       TEXT,
                -- How many floors this case shows. 10 unless the reader grew it.
                floors     INTEGER NOT NULL DEFAULT 10,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            INSERT OR IGNORE INTO bookcases (id, name, ord, room, floors, created_at, updated_at)
            VALUES (
                'case-default',
                'My Library',
                0,
                NULL,
                10,
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            );

            ALTER TABLE books ADD COLUMN bookcase_id TEXT NOT NULL DEFAULT 'case-default';

            CREATE INDEX IF NOT EXISTS idx_books_case_floor_slot
                ON books (bookcase_id, floor, slot);
        "#,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let library_paths = library::LibraryPaths::resolve()
        .expect("could not resolve Alcove's library folder");
    let db_url = library_paths.db_url().to_string();
    let setup_paths = library_paths.clone();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            media::save_image_asset,
            media::fetch_link_preview,
            media::fetch_images,
            backup::run_backup,
            backup::list_backups,
            backup::restore_backup,
            tray::tray_sync,
            export::export_pdf,
            import::read_markdown_file,
            transfer::bundle_write,
            transfer::bundle_read,
            transfer::bundle_probe,
            transfer::bundle_write_asset,
            library::library_info,
            library::library_asset_read,
        ])
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(&db_url, migrations())
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(move |app| {
            // `convertFileSrc` remains narrowly scoped even when the reader
            // chose a library on another drive.
            app.asset_protocol_scope()
                .allow_directory(setup_paths.assets_root(), true)?;
            app.manage(setup_paths.clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                if tray::close_to_tray_enabled() {
                    // The tray always includes "Quit Alcove" while this flag
                    // is on, so hiding here never leaves a trapped process.
                    api.prevent_close();
                    if window.hide().is_ok() {
                        tray::report_hidden(window.app_handle());
                    }
                    let _ = tray::ensure_tray(window.app_handle());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
