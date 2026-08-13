import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/sound/engine', () => ({
  SOUNDSCAPE_NAMES: ['rain', 'storm', 'fireplace', 'crickets', 'night', 'wind', 'stream', 'forest', 'shore', 'cafe', 'none'],
}));
import { mergeSettings } from '../src/data/settings';
import {
  protectedRecoveryPoints,
  PERSIST_CAP,
  type PageSnapshot,
} from '../src/editor/history/pageHistory';
import {
  retainBookRecoveryPoints,
  type BookRecoverySnapshot,
} from '../src/editor/history/bookHistory';

const pageSnapshot = (at: number): PageSnapshot => ({
  at: new Date(at).toISOString(),
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: String(at) }] }] },
});

const bookSnapshot = (at: number): BookRecoverySnapshot => ({
  at: new Date(at).toISOString(),
  pages: [],
});

describe('protected generous history policy', () => {
  it('is on by default and validates a deliberate opt-out', () => {
    expect(mergeSettings({}).protectedHistoryEnabled).toBe(true);
    expect(mergeSettings({ protectedHistoryEnabled: false }).protectedHistoryEnabled).toBe(false);
    expect(mergeSettings({ protectedHistoryEnabled: 'no' }).protectedHistoryEnabled).toBe(true);
  });

  it('keeps every dense recent page version and progressively spaced older points', () => {
    const now = Date.UTC(2026, 7, 13, 12);
    const recent = Array.from({ length: 700 }, (_, index) => pageSnapshot(now - index * 60_000));
    const daily = Array.from({ length: 180 }, (_, index) => pageSnapshot(now - (index + 2) * 86_400_000));
    const weekly = Array.from({ length: 120 }, (_, index) => pageSnapshot(now - (index + 160) * 7 * 86_400_000));
    const items = [...recent, ...daily, ...weekly].reverse();
    const kept = protectedRecoveryPoints(items, PERSIST_CAP, now);

    expect(kept.length).toBeLessThanOrEqual(PERSIST_CAP);
    expect(kept.at(-1)?.at).toBe(new Date(now).toISOString());
    const latest384 = recent.slice(0, 384).map((item) => item.at);
    const times = kept.map((item) => item.at);
    expect(times).toEqual(expect.arrayContaining(latest384));
    expect(kept.some((item) => now - Date.parse(item.at) > 60 * 86_400_000)).toBe(true);
    expect(kept.some((item) => now - Date.parse(item.at) > 4 * 365 * 86_400_000)).toBe(true);
  });

  it('never drops the newest whole-book checkpoint under retention pressure', () => {
    const now = Date.UTC(2026, 7, 13, 12);
    const items = Array.from({ length: 480 }, (_, index) => bookSnapshot(now - index * 3_600_000)).reverse();
    const kept = retainBookRecoveryPoints(items, 180, now);

    expect(kept.length).toBeLessThanOrEqual(180);
    expect(kept.at(-1)?.at).toBe(new Date(now).toISOString());
    expect(kept.slice(-24)).toHaveLength(24);
  });

  it('never prunes a manually protected recovery point', () => {
    const now = Date.UTC(2026, 7, 13, 12);
    const protectedAt = now - 20 * 365 * 86_400_000;
    const protectedPage = { ...pageSnapshot(protectedAt), protected: true };
    const pageItems = [protectedPage, ...Array.from({ length: 80 }, (_, index) => pageSnapshot(now - index * 60_000))];
    expect(protectedRecoveryPoints(pageItems, 10, now)).toContainEqual(protectedPage);

    const protectedBook = { ...bookSnapshot(protectedAt), protected: true };
    const bookItems = [protectedBook, ...Array.from({ length: 80 }, (_, index) => bookSnapshot(now - index * 60_000))];
    expect(retainBookRecoveryPoints(bookItems, 10, now)).toContainEqual(protectedBook);
  });
});
