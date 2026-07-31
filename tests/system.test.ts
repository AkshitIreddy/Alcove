// @vitest-environment node
/**
 * tests/system.test.ts — wave-2 group F system polish logic:
 *
 *  - backup cadence math (isBackupDue), relative-time display, last-run
 *    stamp persistence, and the scheduler's decision loop (injected deps)
 *  - launch-into-last-book: pure decision, open-book persistence into the
 *    settings table, and the startup jump
 *  - tray quick capture: slot picking + on-demand Inbox book creation
 *  - perf HUD: texture byte estimation + renderer discovery from globals
 *
 * Runs against the in-memory db stub (node has no window -> MemoryDb), so
 * everything here exercises the same SQL surface the app uses.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { save, load as loadSettings } from '../src/data/settings';
import { createBook, trashBook } from '../src/data/books';
import { createPage, listPages } from '../src/data/pages';
import { appState } from '../src/state/app';
import {
  BOOT_DELAY_MS,
  formatRelativeTime,
  getLastBackupRun,
  isBackupDue,
  setLastBackupRun,
  startBackupScheduler,
} from '../src/features/system/backup';
import {
  OPEN_BOOK_KEY,
  launchIntoLastBook,
  readStoredOpenBookId,
  shouldLaunchIntoLastBook,
  startOpenBookPersistence,
} from '../src/features/system/launch';
import {
  INBOX_TITLE,
  ensureInboxBook,
  nextFreeSlot,
} from '../src/features/system/tray';
import {
  collectPixiStats,
  estimateTextureBytes,
  findPixiRenderer,
  formatBytes,
} from '../src/features/system/PerfHud';
import {
  ERROR_LOG_CAPACITY,
  MESSAGE_MAX,
  clearErrorLog,
  describeErrorArgs,
  recentErrors,
  recordError,
} from '../src/features/system/errorLog';
import {
  collectDiagnostics,
  collectLibraryCounts,
  diagnosticsFileName,
  formatDiagnostics,
  redactPaths,
} from '../src/features/system/diagnostics';

const NOW = new Date('2026-07-30T12:00:00.000Z');

/** Let queued microtasks/promises settle. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.useRealTimers();
});

/* ------------------------------ backup cadence ----------------------------- */

describe('isBackupDue', () => {
  it('is due when there is no stamp or the stamp is unreadable', () => {
    expect(isBackupDue(null, 7, NOW)).toBe(true);
    expect(isBackupDue('not-a-date', 7, NOW)).toBe(true);
  });

  it('respects the interval in days', () => {
    const sixDaysAgo = new Date(NOW.getTime() - 6 * 86_400_000).toISOString();
    const eightDaysAgo = new Date(NOW.getTime() - 8 * 86_400_000).toISOString();
    expect(isBackupDue(sixDaysAgo, 7, NOW)).toBe(false);
    expect(isBackupDue(eightDaysAgo, 7, NOW)).toBe(true);
  });

  it('clamps a broken interval to at least one day', () => {
    const twoHoursAgo = new Date(NOW.getTime() - 2 * 3_600_000).toISOString();
    expect(isBackupDue(twoHoursAgo, 0, NOW)).toBe(false);
    expect(isBackupDue(twoHoursAgo, -5, NOW)).toBe(false);
    const twoDaysAgo = new Date(NOW.getTime() - 2 * 86_400_000).toISOString();
    expect(isBackupDue(twoDaysAgo, 0, NOW)).toBe(true);
  });
});

describe('formatRelativeTime', () => {
  it('covers never / just now / minutes / hours / days', () => {
    expect(formatRelativeTime(null, NOW)).toBe('never');
    expect(formatRelativeTime('garbage', NOW)).toBe('never');
    expect(formatRelativeTime(NOW.toISOString(), NOW)).toBe('just now');
    const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
    expect(formatRelativeTime(ago(5 * 60_000), NOW)).toBe('5 min ago');
    expect(formatRelativeTime(ago(3_600_000), NOW)).toBe('1 hour ago');
    expect(formatRelativeTime(ago(5 * 3_600_000), NOW)).toBe('5 hours ago');
    expect(formatRelativeTime(ago(86_400_000), NOW)).toBe('1 day ago');
    expect(formatRelativeTime(ago(3 * 86_400_000), NOW)).toBe('3 days ago');
  });
});

describe('backup last-run stamp', () => {
  it('round-trips through the settings table', async () => {
    expect(await getLastBackupRun()).toBeNull();
    await setLastBackupRun('2026-07-29T08:00:00.000Z');
    expect(await getLastBackupRun()).toBe('2026-07-29T08:00:00.000Z');
    await setLastBackupRun('2026-07-30T08:00:00.000Z'); // upsert, not insert
    expect(await getLastBackupRun()).toBe('2026-07-30T08:00:00.000Z');
  });
});

describe('startBackupScheduler', () => {
  it('runs a due backup at the boot check and never when disabled', async () => {
    vi.useFakeTimers();
    await loadSettings();
    await save({ backupEnabled: true, backupIntervalDays: 7 });
    await setLastBackupRun('2020-01-01T00:00:00.000Z'); // long overdue

    const run = vi.fn(async () => {
      await setLastBackupRun(new Date().toISOString());
    });
    const stop = startBackupScheduler({ runBackup: run, inTauri: true });
    await vi.advanceTimersByTimeAsync(BOOT_DELAY_MS + 10);
    expect(run).toHaveBeenCalledTimes(1);
    stop();

    // Disabled: the boot check must not fire the backup.
    await save({ backupEnabled: false });
    await setLastBackupRun('2020-01-01T00:00:00.000Z');
    const run2 = vi.fn(async () => {});
    const stop2 = startBackupScheduler({ runBackup: run2, inTauri: true });
    await vi.advanceTimersByTimeAsync(BOOT_DELAY_MS + 10);
    expect(run2).not.toHaveBeenCalled();
    stop2();
    await save({ backupEnabled: true });
  });

  it('is a no-op outside Tauri', () => {
    const stop = startBackupScheduler({ inTauri: false });
    expect(typeof stop).toBe('function');
    stop();
  });
});

/* --------------------------- launch into last book ------------------------- */

describe('launch into last book', () => {
  it('pure decision needs both the setting and a stored id', () => {
    expect(shouldLaunchIntoLastBook(true, 'abc')).toBe(true);
    expect(shouldLaunchIntoLastBook(true, null)).toBe(false);
    expect(shouldLaunchIntoLastBook(true, '')).toBe(false);
    expect(shouldLaunchIntoLastBook(false, 'abc')).toBe(false);
  });

  it('persists opened book ids and keeps them after close', async () => {
    const stop = startOpenBookPersistence();
    const book = await createBook({ title: 'Persisted', floor: 3, slot: 0 });
    appState.openBook(book.id);
    await tick();
    expect(await readStoredOpenBookId()).toBe(book.id);

    // Closing (and clearing) does not erase the "last book" memory.
    appState.closeBook();
    appState.clearOpenBook();
    await tick();
    expect(await readStoredOpenBookId()).toBe(book.id);
    stop();
  });

  it('jumps into the stored book only when the setting is on', async () => {
    const book = await createBook({ title: 'Launch me', floor: 4, slot: 0 });
    const stop = startOpenBookPersistence();
    appState.openBook(book.id);
    await tick();
    appState.closeBook();
    appState.clearOpenBook();
    stop();

    await save({ launchIntoLastBook: false });
    expect(await launchIntoLastBook()).toBe(false);

    await save({ launchIntoLastBook: true });
    expect(await launchIntoLastBook()).toBe(true);
    expect(appState.openBookId()).toBe(book.id);
    expect(appState.viewState()).toBe('book');

    // A stored id whose book was deleted must not open anything.
    const db = await (await import('../src/data/db')).getDb();
    await db.execute(
      'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
      [OPEN_BOOK_KEY, 'gone-book-id'],
    );
    appState.closeBook();
    expect(await launchIntoLastBook()).toBe(false);
    await save({ launchIntoLastBook: false });
  });
});

/* ------------------------------ tray quick note ---------------------------- */

describe('tray quick capture', () => {
  it('nextFreeSlot appends after the floor’s occupied slots', () => {
    expect(nextFreeSlot([], 0)).toBe(0);
    expect(
      nextFreeSlot(
        [
          { floor: 0, slot: 0 },
          { floor: 0, slot: 2 },
          { floor: 1, slot: 9 },
        ],
        0,
      ),
    ).toBe(3);
    expect(nextFreeSlot([{ floor: 1, slot: 9 }], 0)).toBe(0);
  });

  it('creates the Inbox book (with one page) once, then reuses it', async () => {
    const first = await ensureInboxBook();
    expect(first.title).toBe(INBOX_TITLE);
    const pages = await listPages(first.id);
    expect(pages.length).toBe(1);

    const second = await ensureInboxBook();
    expect(second.id).toBe(first.id);
    expect((await listPages(first.id)).length).toBe(1); // no duplicate page
  });
});

/* --------------------------------- perf HUD -------------------------------- */

describe('perf HUD stats', () => {
  it('estimates RGBA8 texture bytes and formats them', () => {
    expect(estimateTextureBytes([])).toBe(0);
    expect(
      estimateTextureBytes([
        { pixelWidth: 256, pixelHeight: 128 },
        { pixelWidth: 2, pixelHeight: 2 },
        {}, // malformed source counts as zero
      ]),
    ).toBe(256 * 128 * 4 + 16);
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('discovers a renderer from the known global hooks', () => {
    const renderer = {
      name: 'webgl',
      texture: { managedTextures: [{ pixelWidth: 4, pixelHeight: 4 }] },
    };
    expect(findPixiRenderer({})).toBeNull();
    expect(collectPixiStats({})).toBeNull();

    // PIXI devtools convention: an Application exposing `.renderer`.
    const viaDevtools = collectPixiStats({ __PIXI_APP__: { renderer } });
    expect(viaDevtools).toEqual({
      textures: 1,
      textureBytes: 64,
      rendererName: 'webgl',
    });

    // The shelf QA hook: a world object with a private `app`.
    const viaWorld = collectPixiStats({ __shelfWorld: { app: { renderer } } });
    expect(viaWorld?.textures).toBe(1);

    // Registry wins when present.
    const viaRegistry = collectPixiStats({
      __NB_PIXI_APPS: [{ renderer }],
      __PIXI_APP__: { renderer: { name: 'other' } },
    });
    expect(viaRegistry?.rendererName).toBe('webgl');
  });
});

/* -------------------------------- error log -------------------------------- */

describe('error log', () => {
  afterEach(() => clearErrorLog());

  it('folds console arguments into one clamped line', () => {
    expect(describeErrorArgs(['boom', new Error('nope')])).toBe('boom Error: nope');
    expect(describeErrorArgs([{ a: 1 }, null, undefined, 3])).toBe(
      '{"a":1} null undefined 3',
    );

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(describeErrorArgs([cyclic])).toBe('[unserializable object]');

    const long = describeErrorArgs(['x'.repeat(1000)]);
    expect(long.length).toBe(MESSAGE_MAX);
    expect(long.endsWith('…')).toBe(true);
  });

  it('folds consecutive repeats and caps the buffer', () => {
    recordError('console', '   ');
    expect(recentErrors()).toHaveLength(0);

    recordError('console', 'same');
    recordError('console', 'same');
    recordError('window', 'same'); // different source -> its own entry
    const folded = recentErrors();
    expect(folded).toHaveLength(2);
    expect(folded[0].count).toBe(2);

    clearErrorLog();
    for (let i = 0; i < ERROR_LOG_CAPACITY + 10; i += 1) recordError('console', `e${i}`);
    const capped = recentErrors();
    expect(capped).toHaveLength(ERROR_LOG_CAPACITY);
    expect(capped[capped.length - 1].message).toBe(`e${ERROR_LOG_CAPACITY + 9}`);
  });

  it('hands out copies, so a reader cannot corrupt the log', () => {
    recordError('promise', 'original');
    const snapshot = recentErrors();
    snapshot[0].message = 'tampered';
    expect(recentErrors()[0].message).toBe('original');
  });
});

/* ------------------------------- diagnostics ------------------------------- */

describe('diagnostics redaction', () => {
  it('keeps the filename and drops every path above it', () => {
    expect(redactPaths(String.raw`failed to open C:\Users\ada\Documents\secret.db`)).toBe(
      String.raw`failed to open …\secret.db`,
    );
    expect(redactPaths('at file:///C:/Users/ada/app/main.js')).toBe('at …/main.js');
    expect(redactPaths('ENOENT /Users/ada/notes/private.md')).toBe(
      'ENOENT …/private.md',
    );
    expect(redactPaths('nothing path-shaped here')).toBe('nothing path-shaped here');
  });
});

describe('diagnostics report', () => {
  // The stub db is shared across this file, so counts are asserted as deltas
  // on floors no other test in here touches.
  it('counts shelved books, trashed books, pages and floors', async () => {
    await loadSettings();
    const before = await collectLibraryCounts();
    expect(before).not.toBeNull();

    const one = await createBook({ title: 'One', floor: 40, slot: 0 });
    await createBook({ title: 'Two', floor: 41, slot: 1 });
    const gone = await createBook({ title: 'Gone', floor: 40, slot: 5 });
    await trashBook(gone.id);
    await createPage({ bookId: one.id, ord: 0 });

    const after = await collectLibraryCounts();
    expect(after!.books - before!.books).toBe(2);
    expect(after!.trashedBooks - before!.trashedBooks).toBe(1);
    expect(after!.pages - before!.pages).toBe(1);
    expect(after!.occupiedFloors - before!.occupiedFloors).toBe(2);
    expect(after!.deepestFloor).toBe(41);
  });

  it('never writes a backup path, page content or a raw error path', async () => {
    await loadSettings();
    await save({ backupFolder: String.raw`C:\Users\ada\Backups\notebook` });
    clearErrorLog();
    recordError('window', String.raw`could not read C:\Users\ada\Documents\diary.md`);

    const report = await collectDiagnostics();
    const text = formatDiagnostics(report);

    expect(text).not.toContain(String.raw`C:\Users\ada`);
    expect(text).not.toContain('Backups');
    expect(text).toContain('custom folder (path withheld)');
    expect(text).toContain(String.raw`…\diary.md`);
    expect(text).toContain('NOTEBOOK — DIAGNOSTICS REPORT');
    expect(text).toContain('RECENT ERRORS');
    // Booleans and volumes are resolved, not dumped as raw JSON.
    expect(text).toMatch(/^spellcheck\s+(on|off)$/m);

    await save({ backupFolder: null });
    clearErrorLog();
  });

  it('names the file by date', () => {
    expect(diagnosticsFileName(new Date(2026, 6, 5))).toBe(
      'notebook-diagnostics-2026-07-05.txt',
    );
  });
});
