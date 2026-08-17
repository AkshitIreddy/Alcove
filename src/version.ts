/**
 * src/version.ts — the app's version number, typed once.
 *
 * Three modules used to carry their own copy of it: `features/system/
 * diagnostics.ts` as `FALLBACK_APP_VERSION`, `features/transfer/
 * TransferPanel.tsx` as `APP_VERSION`, and `features/transfer/index.ts` as a
 * bare literal inside `exportEntireLibrary`. All three still said `0.1.0`
 * after the 0.2 bump, which is the whole failure mode: a version that is
 * written down in four places is a version that is wrong in three of them, and
 * every one of those three is stamped into a file a reader keeps — a bug
 * report, an exported `.alcove` bundle, the manifest an import reads back.
 *
 * `tests/version.test.ts` pins this against `package.json`,
 * `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, so a bump that
 * misses one of the four is a red test rather than a wrong number in
 * somebody's bundle.
 *
 * At runtime under Tauri the authority is `@tauri-apps/api/app`'s
 * `getVersion()`, which reads the number the bundler actually stamped into the
 * executable — this constant is what answers when that is unavailable (the
 * browser dev server, a test, or a capability set without `app:default`).
 */
export const APP_VERSION = '0.7.1';
