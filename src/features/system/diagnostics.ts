/**
 * src/features/system/diagnostics.ts — "Export diagnostics…".
 *
 * Produces one plain-text file a user can paste into a chat with an AI (or
 * attach to a bug report) when something breaks: what build they run, what
 * machine and GPU it runs on, how big the library is, every resolved setting,
 * and the last handful of errors the app saw.
 *
 * PRIVACY — this is the whole contract of the file, so it is stated here and
 * enforced by `collectDiagnostics`:
 *
 *   - NO page content. Not a block, not a title, not a snippet. Only counts.
 *   - NO book or floor titles — a book called "divorce notes" is private.
 *   - NO file paths from outside the app. The backup folder the user picked
 *     is reported as "custom" / "default", never as a path, and error
 *     messages run through `redactPaths` before they are written out.
 *   - NO stacks (see ./errorLog.ts — stack frames carry disk paths).
 *   - Nothing leaves the machine: the report is handed to the OS save dialog
 *     and that is the end of it. Telemetry stays never.
 *
 * Everything is failure-tolerant. A diagnostics report that throws while the
 * app is already broken would be the worst possible joke.
 */

import { getDb, isTauri } from '../../data/db';
import { TRASH_FLOOR } from '../../data/books';
import { settings } from '../../data/settings';
import { osPrefersReducedMotion } from '../settings/apply';
import { snapshotLibraryPrefs } from '../bookshelf/libraryPrefs';
import { saveBytes, type SaveOutcome } from '../../editor/script/exporters/saveFile';
import { collectPixiStats } from './PerfHud';
import { recentErrors, type LoggedError } from './errorLog';

/** Mirrors package.json / tauri.conf.json; used when the Tauri API is absent. */
const FALLBACK_APP_VERSION = '0.1.0';

/* ------------------------------- redaction --------------------------------- */

/**
 * Strip anything path-shaped out of free text. Errors from the filesystem,
 * SQL and the webview all like to quote absolute paths, and an absolute path
 * on Windows starts `C:\Users\<the user's real name>`. We keep the last
 * segment (the filename is the useful half) and drop the rest.
 */
export function redactPaths(text: string): string {
  return text
    .replace(/[A-Za-z]:\\[^\s"'<>|]*/g, (m) => `…\\${lastSegment(m, '\\')}`)
    .replace(/\b(?:file|asset|https?):\/\/[^\s"'<>|]*/g, (m) => `…/${lastSegment(m, '/')}`)
    .replace(/(?<![\w.])\/(?:Users|home)\/[^\s"'<>|]*/g, (m) => `…/${lastSegment(m, '/')}`);
}

function lastSegment(path: string, sep: string): string {
  const parts = path.split(sep).filter((p) => p !== '');
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

/* --------------------------------- shapes ---------------------------------- */

export interface WebglInfo {
  api: string;
  vendor: string;
  renderer: string;
  version: string;
  maxTextureSize: number;
}

export interface LibraryCounts {
  books: number;
  trashedBooks: number;
  pages: number;
  /** Distinct shelf floors that hold at least one book. */
  occupiedFloors: number;
  /** Highest floor index in use — the shelf's depth, gaps included. */
  deepestFloor: number;
  assets: number;
  /** Rows in the settings key/value table (app state + prefs blobs). */
  settingsRows: number;
}

export interface DiagnosticsReport {
  generatedAt: Date;
  appVersion: string;
  tauriVersion: string | null;
  runtime: 'desktop' | 'browser';
  userAgent: string;
  language: string;
  screen: string;
  devicePixelRatio: number;
  hardwareConcurrency: number | null;
  /**
   * The OS reduced-motion switch. Worth a line of its own because it OVERRIDES
   * `animationLevel` (settings/apply.ts) — without it, a report showing
   * "animationLevel full" next to a user saying "nothing animates" is a puzzle.
   */
  prefersReducedMotion: boolean;
  webgl: WebglInfo | null;
  /** PIXI's own renderer label ("webgl" / "webgpu"), when a world is up. */
  pixiRenderer: string | null;
  library: LibraryCounts | null;
  settings: ReadonlyArray<readonly [string, string]>;
  libraryPrefs: ReadonlyArray<readonly [string, string]>;
  errors: readonly LoggedError[];
}

/* ------------------------------- collection -------------------------------- */

/**
 * Probe the GPU through a throwaway context. `WEBGL_debug_renderer_info` is
 * the only way to learn the actual adapter ("NVIDIA GeForce RTX 4080"), which
 * is the single most useful line in the whole report when the shelf renders
 * wrong — so it is worth the extra context. We drop it immediately after.
 */
export function probeWebgl(): WebglInfo | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    const gl2 = canvas.getContext('webgl2');
    const gl = gl2 ?? canvas.getContext('webgl');
    if (gl === null) return null;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const read = (param: number): string => {
      const value: unknown = gl.getParameter(param);
      return typeof value === 'string' && value !== '' ? value : 'unknown';
    };
    const info: WebglInfo = {
      api: gl2 !== null ? 'WebGL 2' : 'WebGL 1',
      vendor: debug !== null ? read(debug.UNMASKED_VENDOR_WEBGL) : read(gl.VENDOR),
      renderer: debug !== null ? read(debug.UNMASKED_RENDERER_WEBGL) : read(gl.RENDERER),
      version: read(gl.VERSION),
      maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0,
    };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return info;
  } catch {
    return null;
  }
}

/**
 * Count what is on the shelves.
 *
 * Deliberately `SELECT id, floor` rather than `COUNT(*)`: the browser dev
 * stub in data/db.ts implements a column-list dialect and would silently
 * return nothing for an aggregate, so the report would lie in dev.
 */
export async function collectLibraryCounts(): Promise<LibraryCounts | null> {
  try {
    const db = await getDb();
    const books = await db.select<Array<{ id: string; floor: number }>>(
      'SELECT id, floor FROM books',
    );
    const pages = await db.select<Array<{ id: string }>>('SELECT id FROM pages');
    const assets = await db.select<Array<{ id: string }>>('SELECT id FROM assets');
    const rows = await db.select<Array<{ key: string }>>('SELECT key FROM settings');

    const shelved = books.filter((b) => b.floor !== TRASH_FLOOR);
    const floors = new Set(shelved.map((b) => b.floor));
    return {
      books: shelved.length,
      trashedBooks: books.length - shelved.length,
      pages: pages.length,
      occupiedFloors: floors.size,
      deepestFloor: floors.size === 0 ? -1 : Math.max(...floors),
      assets: assets.length,
      settingsRows: rows.length,
    };
  } catch {
    // An unreadable database is itself worth reporting — as a null section,
    // not as a thrown export.
    return null;
  }
}

/** Human-readable value for one setting. Paths never survive this. */
function describeSetting(key: string, value: unknown): string {
  if (key === 'backupFolder') {
    // The chosen folder is outside the app — presence only, never the path.
    return value === null ? 'default (app data)' : 'custom folder (path withheld)';
  }
  if (key === 'keybindings' && value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, string>);
    return entries.length === 0
      ? 'none'
      : entries
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([action, combo]) => `${action}=${combo}`)
          .join(', ');
  }
  if (value === null) return 'none';
  if (typeof value === 'number') return String(Math.round(value * 1000) / 1000);
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  return String(value);
}

function pairsFrom(source: Record<string, unknown>): Array<readonly [string, string]> {
  return Object.keys(source)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => [key, describeSetting(key, source[key])] as const);
}

async function tauriVersion(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { getTauriVersion } = await import('@tauri-apps/api/app');
    return await getTauriVersion();
  } catch {
    return null;
  }
}

async function appVersion(): Promise<string> {
  if (!isTauri()) return FALLBACK_APP_VERSION;
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    // `app:default` is not in the capability set, so this can legitimately be
    // denied; the compiled-in constant is still correct.
    return FALLBACK_APP_VERSION;
  }
}

/** Gather everything. Never throws. */
export async function collectDiagnostics(): Promise<DiagnosticsReport> {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  const win = typeof window === 'undefined' ? null : window;
  const pixi = collectPixiStats(globalThis as Record<string, unknown>);

  return {
    generatedAt: new Date(),
    appVersion: await appVersion(),
    tauriVersion: await tauriVersion(),
    runtime: isTauri() ? 'desktop' : 'browser',
    userAgent: nav?.userAgent ?? 'unknown',
    language: nav?.language ?? 'unknown',
    screen:
      win !== null && typeof win.screen !== 'undefined'
        ? `${win.screen.width}×${win.screen.height} · window ${win.innerWidth}×${win.innerHeight}`
        : 'unknown',
    devicePixelRatio: win?.devicePixelRatio ?? 1,
    hardwareConcurrency:
      typeof nav?.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
    prefersReducedMotion: osPrefersReducedMotion(),
    webgl: probeWebgl(),
    pixiRenderer: pixi?.rendererName ?? null,
    library: await collectLibraryCounts(),
    settings: pairsFrom({ ...settings } as Record<string, unknown>),
    libraryPrefs: pairsFrom(snapshotLibraryPrefs() as unknown as Record<string, unknown>),
    errors: recentErrors(),
  };
}

/* -------------------------------- formatting ------------------------------- */

const RULE_WIDTH = 64;

function heading(title: string): string {
  const label = ` ${title.toUpperCase()} `;
  const dashes = Math.max(3, RULE_WIDTH - label.length - 2);
  return `\n──${label}${'─'.repeat(dashes)}\n`;
}

/**
 * Two aligned columns. Written by hand rather than `padEnd` because the
 * longest setting keys (`autosaveIntervalMs`, `launchIntoLastBook`) are
 * exactly the column width, and `padEnd` would butt the value straight
 * against the key — "autosaveIntervalMs400".
 */
const LABEL_WIDTH = 20;

function field(label: string, value: string): string {
  const gap = Math.max(1, LABEL_WIDTH - label.length);
  return `${label}${' '.repeat(gap)}${value}`;
}

/** Local wall-clock stamp — the user's "when did this happen" reference. */
function stamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * Render the report as plain text. Pure — the unit tests build a report
 * literal and assert on the string, including that no path survives.
 */
export function formatDiagnostics(report: DiagnosticsReport): string {
  const out: string[] = [];

  out.push('NOTEBOOK — DIAGNOSTICS REPORT');
  out.push(`generated ${stamp(report.generatedAt)} (local time)`);
  out.push('');
  out.push('This file describes the app, not what is in it: no page text, no book');
  out.push('or floor names, no folder paths, nothing sent anywhere. Safe to share.');

  out.push(heading('app'));
  out.push(field('version', report.appVersion));
  out.push(field('runtime', report.runtime === 'desktop' ? 'desktop (Tauri)' : 'browser (dev)'));
  if (report.tauriVersion !== null) out.push(field('tauri', report.tauriVersion));

  out.push(heading('machine'));
  out.push(field('user agent', redactPaths(report.userAgent)));
  out.push(field('language', report.language));
  out.push(field('display', `${report.screen} @ ${report.devicePixelRatio}×`));
  out.push(
    field('reduced motion', report.prefersReducedMotion ? 'on (OS) — overrides animationLevel' : 'off (OS)'),
  );
  if (report.hardwareConcurrency !== null) {
    out.push(field('cpu threads', String(report.hardwareConcurrency)));
  }

  out.push(heading('renderer'));
  if (report.webgl === null) {
    out.push('no WebGL context could be created — the shelf cannot draw here.');
  } else {
    out.push(field('api', report.webgl.api));
    out.push(field('gpu', report.webgl.renderer));
    out.push(field('vendor', report.webgl.vendor));
    out.push(field('driver', report.webgl.version));
    out.push(field('max texture', `${report.webgl.maxTextureSize}px`));
  }
  out.push(field('pixi renderer', report.pixiRenderer ?? 'not started'));

  out.push(heading('library'));
  if (report.library === null) {
    out.push('the database could not be read.');
  } else {
    const lib = report.library;
    out.push(field('books', String(lib.books)));
    out.push(field('in the trash', String(lib.trashedBooks)));
    out.push(field('pages', String(lib.pages)));
    out.push(field('floors in use', String(lib.occupiedFloors)));
    out.push(field('deepest floor', lib.deepestFloor < 0 ? 'none' : String(lib.deepestFloor)));
    out.push(field('assets', String(lib.assets)));
    out.push(field('settings rows', String(lib.settingsRows)));
  }

  out.push(heading('settings'));
  for (const [key, value] of report.settings) out.push(field(key, value));

  out.push(heading('this library'));
  for (const [key, value] of report.libraryPrefs) out.push(field(key, value));

  out.push(heading(`recent errors (${report.errors.length})`));
  if (report.errors.length === 0) {
    out.push('none since the app started.');
  } else {
    for (const entry of report.errors) {
      const repeat = entry.count > 1 ? ` ×${entry.count}` : '';
      out.push(`[${entry.at}] ${entry.source}${repeat}`);
      out.push(`  ${redactPaths(entry.message)}`);
    }
  }

  out.push('');
  out.push('— end of report —');
  return `${out.join('\n')}\n`;
}

/** `notebook-diagnostics-2026-07-31.txt` */
export function diagnosticsFileName(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `notebook-diagnostics-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}.txt`;
}

/** Collect, format, and hand the text to the OS save dialog. */
export async function exportDiagnostics(): Promise<SaveOutcome> {
  try {
    const report = await collectDiagnostics();
    const bytes = new TextEncoder().encode(formatDiagnostics(report));
    return await saveBytes(bytes, diagnosticsFileName(report.generatedAt), 'text/plain', [
      { name: 'Text', extensions: ['txt'] },
    ]);
  } catch {
    return 'failed';
  }
}
