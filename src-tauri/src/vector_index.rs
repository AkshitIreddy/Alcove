//! Process-wide registration for Alcove's optional, derived vector index.
//!
//! `tauri-plugin-sql` owns the SQLx connections, so there is no connection
//! hook where we can call `sqlite3_vec_init` directly. SQLite's documented
//! auto-extension registry is a better fit: register once before the plugin
//! opens its first pool and every later SQLite connection receives vec0.
//!
//! The canonical source ledger remains ordinary SQLite tables. If this
//! registration ever fails, the TypeScript retrieval layer keeps using its
//! existing finite-checked cosine path; notebook data never depends on vec0.

use std::sync::OnceLock;

static REGISTRATION: OnceLock<Result<(), String>> = OnceLock::new();

/// Register sqlite-vec for every SQLite connection opened in this process.
///
/// This must run before `tauri_plugin_sql::Builder` creates a pool. Repeated
/// calls are harmless and return the first registration result.
pub fn register() -> Result<(), String> {
    REGISTRATION
        .get_or_init(|| {
            // sqlite-vec exports the standard SQLite extension entry point,
            // while libsqlite3-sys exposes SQLite's correctly typed callback.
            // SQLite stores the function pointer for the process lifetime and
            // sqlite-vec is statically linked into that same lifetime.
            let entry = unsafe { std::mem::transmute(sqlite_vec::sqlite3_vec_init as *const ()) };
            let code = unsafe { libsqlite3_sys::sqlite3_auto_extension(Some(entry)) };
            if code == libsqlite3_sys::SQLITE_OK {
                Ok(())
            } else {
                Err(format!(
                    "sqlite-vec auto-extension registration failed with SQLite code {code}"
                ))
            }
        })
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::{CStr, CString};
    use std::ptr;

    struct Connection(*mut libsqlite3_sys::sqlite3);

    impl Connection {
        fn memory() -> Self {
            register().expect("sqlite-vec should register");
            let name = CString::new(":memory:").unwrap();
            let mut db = ptr::null_mut();
            let code = unsafe { libsqlite3_sys::sqlite3_open(name.as_ptr(), &mut db) };
            assert_eq!(code, libsqlite3_sys::SQLITE_OK);
            Self(db)
        }

        fn exec(&self, sql: &str) -> Result<(), String> {
            let sql = CString::new(sql).unwrap();
            let mut error = ptr::null_mut();
            let code = unsafe {
                libsqlite3_sys::sqlite3_exec(
                    self.0,
                    sql.as_ptr(),
                    None,
                    ptr::null_mut(),
                    &mut error,
                )
            };
            if code == libsqlite3_sys::SQLITE_OK {
                return Ok(());
            }
            let message = if error.is_null() {
                format!("SQLite code {code}")
            } else {
                let message = unsafe { CStr::from_ptr(error) }
                    .to_string_lossy()
                    .into_owned();
                unsafe { libsqlite3_sys::sqlite3_free(error.cast()) };
                message
            };
            Err(message)
        }

        fn scalar_text(&self, sql: &str) -> String {
            unsafe extern "C" fn capture(
                output: *mut std::ffi::c_void,
                columns: std::ffi::c_int,
                values: *mut *mut std::ffi::c_char,
                _names: *mut *mut std::ffi::c_char,
            ) -> std::ffi::c_int {
                if columns > 0 && !values.is_null() {
                    let value = unsafe { *values };
                    if !value.is_null() {
                        let text = unsafe { CStr::from_ptr(value) }
                            .to_string_lossy()
                            .into_owned();
                        unsafe { *(output as *mut String) = text };
                    }
                }
                0
            }
            let sql = CString::new(sql).unwrap();
            let mut output = String::new();
            let code = unsafe {
                libsqlite3_sys::sqlite3_exec(
                    self.0,
                    sql.as_ptr(),
                    Some(capture),
                    (&mut output as *mut String).cast(),
                    ptr::null_mut(),
                )
            };
            if code != libsqlite3_sys::SQLITE_OK {
                let message = unsafe { CStr::from_ptr(libsqlite3_sys::sqlite3_errmsg(self.0)) }
                    .to_string_lossy();
                panic!("query failed with SQLite code {code}: {message}");
            }
            output
        }
    }

    impl Drop for Connection {
        fn drop(&mut self) {
            unsafe { libsqlite3_sys::sqlite3_close(self.0) };
        }
    }

    #[test]
    fn every_new_connection_has_vec0() {
        let first = Connection::memory();
        let second = Connection::memory();
        assert!(first.scalar_text("SELECT vec_version()").starts_with('v'));
        assert!(second.scalar_text("SELECT vec_version()").starts_with('v'));
    }

    #[test]
    fn vec0_rejects_wrong_dimensions_and_nonfinite_json() {
        let db = Connection::memory();
        db.exec("CREATE VIRTUAL TABLE vectors USING vec0(id TEXT PRIMARY KEY, embedding float[3])")
            .unwrap();
        assert!(db
            .exec("INSERT INTO vectors VALUES ('short', vec_f32('[1,2]'))")
            .is_err());
        assert!(db
            .exec("INSERT INTO vectors VALUES ('nan', vec_f32('[1,9e999,3]'))")
            .is_err());
        db.exec("INSERT INTO vectors VALUES ('ok', vec_f32('[1,2,3]'))")
            .unwrap();
        assert_eq!(db.scalar_text("SELECT count(*) FROM vectors"), "1");
    }

    #[test]
    fn deleting_canonical_rows_makes_stale_vectors_non_authoritative() {
        let db = Connection::memory();
        db.exec(
            "CREATE TABLE chunks(id TEXT PRIMARY KEY, digest TEXT NOT NULL);\
             CREATE VIRTUAL TABLE vectors USING vec0(\
               chunk_id TEXT PRIMARY KEY, embedding float[3], digest TEXT\
             );\
             INSERT INTO chunks VALUES ('alive', 'current');\
             INSERT INTO vectors VALUES ('alive', vec_f32('[1,0,0]'), 'current');\
             INSERT INTO vectors VALUES ('stale', vec_f32('[1,0,0]'), 'old');\
             DELETE FROM chunks WHERE id = 'alive';",
        )
        .unwrap();
        assert_eq!(
            db.scalar_text(
                "SELECT count(*) FROM vectors v JOIN chunks c \
                 ON c.id = v.chunk_id AND c.digest = v.digest"
            ),
            "0"
        );
    }

    #[test]
    fn production_schema_backfill_is_idempotent_and_scoped() {
        let db = Connection::memory();
        db.exec(
            "CREATE TABLE ai_agent_sources(\
               id TEXT PRIMARY KEY, thread_id TEXT NOT NULL\
             );\
             CREATE TABLE ai_agent_chunks(\
               id TEXT PRIMARY KEY, source_id TEXT NOT NULL, ordinal INTEGER NOT NULL,\
               locator TEXT NOT NULL, text TEXT NOT NULL, digest TEXT NOT NULL,\
               embedding_json TEXT\
             );\
             CREATE VIRTUAL TABLE ai_agent_chunk_vec_v1 USING vec0(\
               chunk_id TEXT PRIMARY KEY,\
               embedding float[512] distance_metric=cosine,\
               thread_id TEXT partition key, source_id TEXT, digest TEXT\
             );\
             CREATE VIRTUAL TABLE ai_agent_chunk_fts_v1 USING fts5(\
               chunk_id UNINDEXED, thread_id UNINDEXED, source_id UNINDEXED,\
               digest UNINDEXED, text, tokenize='unicode61 remove_diacritics 2'\
             );\
             INSERT INTO ai_agent_sources VALUES ('pdf-source', 'task-a');\
             INSERT INTO ai_agent_sources VALUES ('other-source', 'task-b');\
             INSERT INTO ai_agent_chunks VALUES (\
               'pdf-page-1', 'pdf-source', 0, 'page 1',\
               'A kitten explains Huffman coding.', 'digest-current', NULL\
             );",
        )
        .unwrap();
        let vector = format!(
            "[{}]",
            std::iter::once("1")
                .chain(std::iter::repeat("0").take(511))
                .collect::<Vec<_>>()
                .join(",")
        );
        let refresh = format!(
            "DELETE FROM ai_agent_chunk_vec_v1 WHERE source_id = 'pdf-source';\
             DELETE FROM ai_agent_chunk_fts_v1 WHERE source_id = 'pdf-source';\
             INSERT INTO ai_agent_chunk_fts_v1 VALUES (\
               'pdf-page-1', 'task-a', 'pdf-source', 'digest-current',\
               'A kitten explains Huffman coding.'\
             );\
             INSERT INTO ai_agent_chunk_vec_v1 VALUES (\
               'pdf-page-1', vec_f32('{vector}'), 'task-a', 'pdf-source', 'digest-current'\
             );"
        );
        db.exec(&refresh).unwrap();
        db.exec(&refresh).unwrap(); // same PDF/source reuse is a replace, not a duplicate
        assert_eq!(
            db.scalar_text("SELECT count(*) FROM ai_agent_chunk_vec_v1"),
            "1"
        );
        assert_eq!(
            db.scalar_text("SELECT count(*) FROM ai_agent_chunk_fts_v1"),
            "1"
        );

        let vector_query = format!(
            "SELECT c.id FROM ( \
               SELECT chunk_id, thread_id, source_id, digest, distance \
               FROM ai_agent_chunk_vec_v1 \
               WHERE embedding MATCH vec_f32('{vector}') AND k = 8 \
                 AND thread_id = 'task-a' AND source_id = 'pdf-source' \
             ) i \
             JOIN ai_agent_chunks c ON c.id = i.chunk_id AND c.digest = i.digest \
             JOIN ai_agent_sources s ON s.id = c.source_id \
               AND s.id = i.source_id AND s.thread_id = i.thread_id \
             WHERE s.thread_id = 'task-a' AND s.id = 'pdf-source'"
        );
        assert_eq!(db.scalar_text(&vector_query), "pdf-page-1");
        assert_eq!(
            db.scalar_text(
                "SELECT c.id, bm25(ai_agent_chunk_fts_v1) \
                 FROM ai_agent_chunk_fts_v1 i \
                 JOIN ai_agent_chunks c ON c.id = i.chunk_id AND c.digest = i.digest \
                 JOIN ai_agent_sources s ON s.id = c.source_id \
                   AND s.id = i.source_id AND s.thread_id = i.thread_id \
                 WHERE i.text MATCH 'kitten' \
                   AND i.thread_id = 'task-a' AND i.source_id = 'pdf-source' \
                   AND s.thread_id = 'task-a' AND s.id = 'pdf-source'"
            ),
            "pdf-page-1"
        );

        // Deletion from the canonical ledger immediately removes authority,
        // even before best-effort derived cleanup gets a chance to run.
        db.exec("DELETE FROM ai_agent_chunks WHERE id = 'pdf-page-1'")
            .unwrap();
        assert_eq!(db.scalar_text(&vector_query), "");
    }
}
