// @vitest-environment node
/**
 * tests/version.test.ts — one version number, stated in four files that cannot
 * be merged into one.
 *
 * `package.json` names the npm package, `src-tauri/Cargo.toml` names the Rust
 * crate, `src-tauri/tauri.conf.json` names the bundle (and is what the
 * installer's filename and the Windows "Programs and Features" entry are built
 * from), and `src/version.ts` is what the app stamps into an exported bundle
 * and a diagnostics report when the Tauri API cannot be reached. None of the
 * four can read another at build time, so the only thing that keeps them equal
 * is this file.
 *
 * `scripts/gen-readme.mjs` already cross-checks the first two and refuses to
 * compose the front page when they disagree — this widens that to all four and
 * makes it a test, so the check runs on `npx vitest run` rather than only when
 * somebody rebuilds the README.
 *
 * Written for the 0.2.0 bump, where three copies of `0.1.0` in `src/` were
 * found sitting in shipped bundle manifests.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { APP_VERSION } from '../src/version';

const ROOT = resolve(__dirname, '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

/** semver, the subset a Tauri bundle accepts: three numeric parts. */
const SEMVER = /^\d+\.\d+\.\d+$/;

describe('the app version', () => {
  it('is a plain three-part version', () => {
    expect(APP_VERSION).toMatch(SEMVER);
  });

  it('matches package.json', () => {
    expect(JSON.parse(read('package.json')).version).toBe(APP_VERSION);
  });

  it('matches src-tauri/tauri.conf.json — the installer is named from this one', () => {
    expect(JSON.parse(read('src-tauri', 'tauri.conf.json')).version).toBe(APP_VERSION);
  });

  it('matches src-tauri/Cargo.toml', () => {
    // The first `version = "…"` after `[package]`, so a dependency's pin
    // cannot be mistaken for the crate's own.
    const toml = read('src-tauri', 'Cargo.toml');
    const pkg = toml.slice(toml.indexOf('[package]'));
    const m = /^version\s*=\s*"([^"]+)"/m.exec(pkg);
    expect(m?.[1]).toBe(APP_VERSION);
  });

  it('matches the Cargo.lock entry for the crate, so a build does not re-resolve', () => {
    const lock = read('src-tauri', 'Cargo.lock');
    const m = /name = "alcove"\nversion = "([^"]+)"/.exec(lock);
    expect(m?.[1]).toBe(APP_VERSION);
  });

  it('is the only version literal left in src/', async () => {
    // The failure this whole file exists for: a bump that moves the manifests
    // and leaves a hand-typed copy behind in a module that stamps it into a
    // file the reader keeps.
    const { readdirSync, statSync } = await import('node:fs');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        if (full.endsWith(join('src', 'version.ts'))) continue;
        const text = readFileSync(full, 'utf8');
        for (const [i, line] of text.split('\n').entries()) {
          // A version-shaped string literal assigned to something that reads
          // like the app's version. Narrow on purpose: `'2.4.0'` inside a
          // schema comment is not this bug, and a check that shouts about
          // those gets switched off.
          if (/(appVersion|APP_VERSION|app_version)\s*[:=]\s*['"]\d+\.\d+\.\d+['"]/.test(line)) {
            offenders.push(`${full.slice(ROOT.length + 1)}:${i + 1} — ${line.trim()}`);
          }
        }
      }
    };
    walk(join(ROOT, 'src'));
    expect(offenders, 'import APP_VERSION from src/version.ts instead').toEqual([]);
  });
});
