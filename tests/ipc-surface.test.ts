// @vitest-environment node
/**
 * tests/ipc-surface.test.ts — the two halves of the Rust↔TypeScript boundary
 * have to name the same commands.
 *
 * This is `plugged-in.test.ts`'s question asked at the one seam that file
 * cannot see. Everything it watches is TypeScript reading TypeScript; a Tauri
 * command is reached from the other side of an IPC bridge, by a STRING, and
 * neither `tsc` nor `cargo` nor any test in this suite had an opinion about
 * whether the two strings matched.
 *
 * ## The scar
 *
 * `transfer.rs` documents four commands in its own header and tells the
 * orchestrator to register all four. Three of them made it into
 * `generate_handler![]` in `lib.rs`; `bundle_write_asset` did not. Nothing
 * anywhere said so:
 *
 *   - `cargo check` DID know — `generate_handler!` is the only caller a command
 *     has, so it reported `bundle_write_asset` (and `asset_target` under it) as
 *     never used. That is a warning in a build nobody reads line by line.
 *   - the TypeScript side could not know: `importAssets` in
 *     `features/transfer/library.ts` wraps the invoke in a try/catch that
 *     pushes "could not save the asset “…”" into the import warnings and
 *     carries on, because a media write failing genuinely must not abort an
 *     import. So the app SHIPPED with every picture in an imported bundle
 *     dropped, reported as a per-file warning that reads like a corrupt file.
 *
 * A dropped command and a dropped picture look identical from the reader's
 * chair. This file makes them look different from ours.
 *
 * ## What it checks, and which way each one fails
 *
 *   1. every `#[tauri::command]` in `src-tauri/src/` is in the handler list —
 *      the failure above, caught at its source;
 *   2. every command name a module in `src/` invokes is a real registered
 *      command — the mirror, where a rename or a typo leaves the call site
 *      talking to nothing;
 *   3. commands that are registered and invoked by nobody are LISTED, not
 *      failed, the way `plugged-in.test.ts` lists its backlog. The list may
 *      shrink and may not grow.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const RUST = join(ROOT, 'src-tauri', 'src');
const SRC = join(ROOT, 'src');

const read = (path: string): string => readFileSync(path, 'utf8');

function walk(dir: string, match: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) walk(full, match, out);
    else if (match.test(name.name)) out.push(full);
  }
  return out;
}

/* --------------------------------------------------------------------------
   The Rust half
   -------------------------------------------------------------------------- */

const RUST_FILES = walk(RUST, /\.rs$/);

/**
 * Every `#[tauri::command]` in the crate, by function name.
 *
 * The attribute and the `fn` are not on the same line — a command usually has
 * a doc comment and an `async` in between — so this looks ahead from the
 * attribute to the first `fn` after it rather than matching one line.
 */
function declaredCommands(): Array<{ name: string; file: string }> {
  const out: Array<{ name: string; file: string }> = [];
  for (const file of RUST_FILES) {
    const text = read(file);
    for (const m of text.matchAll(/#\[tauri::command\]/g)) {
      const after = text.slice(m.index, m.index + 400);
      const fn = /\bfn\s+([a-z_][a-z0-9_]*)/.exec(after);
      if (fn) out.push({ name: fn[1]!, file });
    }
  }
  return out;
}

/** The names inside `tauri::generate_handler![ … ]`, module prefixes dropped. */
function registeredCommands(): string[] {
  const lib = read(join(RUST, 'lib.rs'));
  const at = lib.indexOf('generate_handler![');
  expect(at, 'lib.rs no longer calls generate_handler!').toBeGreaterThan(-1);
  const end = lib.indexOf(']', at);
  const list = lib
    .slice(at + 'generate_handler!['.length, end)
    // A comment inside the list must not contribute names — the registration
    // of bundle_write_asset carries a paragraph explaining itself.
    .replace(/\/\/[^\n]*/g, ' ');
  return [...list.matchAll(/(?:[a-z_][a-z0-9_]*::)*([a-z_][a-z0-9_]*)\s*,/g)].map((m) => m[1]!);
}

const DECLARED = declaredCommands();
const REGISTERED = new Set(registeredCommands());

/* --------------------------------------------------------------------------
   The TypeScript half
   -------------------------------------------------------------------------- */

/**
 * Command names invoked by string literal from `src/`.
 *
 * Deliberately matches any identifier ENDING in `invoke` as well as `invoke`
 * itself — three modules wrap it (`invokeTauri`, `tauriInvoke`) so that the
 * dynamic `import('@tauri-apps/api/core')` happens in one place, and a pattern
 * anchored on the bare word would have seen two of the twelve call sites.
 *
 * Only the FIRST argument is read, up to the first comma or close paren, which
 * is also what makes `invokeTauri(enabled ? 'tray_enable' : 'tray_disable')`
 * yield both of its names instead of neither.
 */
function invokedCommands(): Array<{ name: string; file: string; line: number }> {
  const out: Array<{ name: string; file: string; line: number }> = [];
  for (const file of walk(SRC, /\.tsx?$/)) {
    // Comments go, but their NEWLINES stay: the failure message quotes a
    // file:line, and a block comment collapsed to one space moves every call
    // site below it up the file — the first draft of this pointed at line 564
    // for a call on line 648, which is worse than pointing nowhere.
    //
    // The line-comment pattern is `[^\S\n]*`, not `\s*`, for the same reason.
    // Under /m, `\s` still matches a newline, so `^\s*//` walks BACKWARDS over
    // every blank line above the comment and swallows those too — which is
    // where the last ten lines of the drift were hiding.
    const text = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/^[^\S\n]*\/\/[^\n]*$/gm, ' ');
    for (const m of text.matchAll(
      /\b[A-Za-z_$]*[Ii]nvoke[A-Za-z_$]*\s*(?:<[^>()]*>)?\s*\(\s*([^,)]*)/g,
    )) {
      for (const lit of m[1]!.matchAll(/['"]([a-z_][a-z0-9_]*)['"]/g)) {
        out.push({
          name: lit[1]!,
          file,
          line: text.slice(0, m.index).split('\n').length,
        });
      }
    }
  }
  return out;
}

const INVOKED = invokedCommands();

/* --------------------------------------------------------------------------
   The backlog: registered, and called by nothing
   -------------------------------------------------------------------------- */

/**
 * Commands that exist and are wired but that no module in `src/` reaches.
 * Same contract as `KNOWN_UNPLUGGED` in plugged-in.test.ts: each line says
 * what plugging it means, a name here that is no longer unreached fails the
 * suite, and the count can only go down.
 */
const KNOWN_UNCALLED: Readonly<Record<string, string>> = {
  bundle_probe:
    'reads only manifest.json out of an archive, for a fast preview. features/transfer/io.ts calls bundle_read and re-zips every entry instead, so picking a 200 MB bundle decompresses all of it to show a summary. Plugging it means pickTauriBundle probing first and reading in full only once the reader has said yes.',
};

const UNCALLED_CEILING = Object.keys(KNOWN_UNCALLED).length;

/* ========================================================================== */

describe('the alarm itself works', () => {
  it('found both halves of the bridge', () => {
    // The vacuous-pass guard. If either parse silently stops finding anything,
    // every assertion below passes while measuring nothing.
    expect(DECLARED.length).toBeGreaterThanOrEqual(10);
    expect(REGISTERED.size).toBeGreaterThanOrEqual(10);
    expect(INVOKED.length).toBeGreaterThanOrEqual(10);
  });

  it('reads the wrapped call sites, not just the bare ones', () => {
    // The two spellings that a pattern anchored on `\binvoke` would miss.
    const names = new Set(INVOKED.map((i) => i.name));
    expect(names, 'tauriInvoke(…) in features/transfer/io.ts').toContain('bundle_read');
    expect(names, 'invokeTauri(…) in features/system/backup.ts').toContain('run_backup');
    // …and both arms of the one ternary.
    expect(names).toContain('tray_enable');
    expect(names).toContain('tray_disable');
  });
});

describe('every Rust command is reachable from the app', () => {
  it('is registered in generate_handler!', () => {
    const orphans = DECLARED.filter((c) => !REGISTERED.has(c.name)).map(
      (c) =>
        `${c.name} (${c.file.slice(ROOT.length + 1).replace(/\\/g, '/')}) is a ` +
        '#[tauri::command] that lib.rs never registers — every invoke of it ' +
        'rejects at runtime, and the only thing that notices is a cargo ' +
        '"never used" warning.',
    );
    expect(orphans.sort()).toEqual([]);
  });

  it('is called by something in src/, or is on the backlog', () => {
    const called = new Set(INVOKED.map((i) => i.name));
    const idle = [...REGISTERED].filter((name) => !called.has(name)).sort();
    const unlisted = idle.filter((name) => KNOWN_UNCALLED[name] === undefined);
    expect(
      unlisted,
      'these commands are registered and invoked by nobody — give them a ' +
        'caller, or list them in KNOWN_UNCALLED with what plugging them means',
    ).toEqual([]);
    console.log(
      `\n  registered but uncalled (${idle.length} of ${UNCALLED_CEILING}):\n` +
        idle.map((name) => `    ${name} — ${KNOWN_UNCALLED[name]}`).join('\n'),
    );
    expect(idle.length).toBeLessThanOrEqual(UNCALLED_CEILING);
  });

  it('the backlog cannot rot', () => {
    const called = new Set(INVOKED.map((i) => i.name));
    const stale = Object.keys(KNOWN_UNCALLED).filter(
      (name) => !REGISTERED.has(name) || called.has(name),
    );
    expect(
      stale,
      'these are either gone or now have a caller — delete the lines',
    ).toEqual([]);
  });
});

describe('every invoke names a command that exists', () => {
  it('has no call site talking to nothing', () => {
    const declared = new Set(DECLARED.map((c) => c.name));
    const missing = INVOKED.filter((i) => !declared.has(i.name)).map(
      (i) =>
        `${i.file.slice(ROOT.length + 1).replace(/\\/g, '/')}:${i.line} invokes ` +
        `'${i.name}', which is not a #[tauri::command] anywhere in src-tauri/src.`,
    );
    expect([...new Set(missing)].sort()).toEqual([]);
  });

  it('and none of them is merely declared', () => {
    // Declared-but-unregistered is caught above; this is the same fact from the
    // caller's side, so a failure here names the file the reader would blame.
    const unreached = INVOKED.filter((i) => !REGISTERED.has(i.name)).map(
      (i) =>
        `${i.file.slice(ROOT.length + 1).replace(/\\/g, '/')}:${i.line} invokes ` +
        `'${i.name}', which lib.rs does not register.`,
    );
    expect([...new Set(unreached)].sort()).toEqual([]);
  });
});
