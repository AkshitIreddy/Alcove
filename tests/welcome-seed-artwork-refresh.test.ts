import { describe, expect, it } from 'vitest';

import {
  LEGACY_WELCOME_PAGE_SOURCES,
  SEED_VERSION,
  WELCOME_PAGE_SOURCES,
  docFromSeededSource,
  isUnchangedSeededPage,
} from '../src/data/seed';

const V17_NUMERIC_COVER_COPY =
  'Set the complete title in one of ten lettering hands, choose among twelve continuous frames and sixteen matched emblems, then finish the paper block with one of six real edge treatments and three sewn endbands.';

describe('v18 Welcome Book Studio artwork refresh', () => {
  it('keeps the exact v17 source recognisable for a pristine-guide migration', () => {
    const v17Page = LEGACY_WELCOME_PAGE_SOURCES.find((source) =>
      source.includes(V17_NUMERIC_COVER_COPY),
    );

    expect(v17Page).toBeDefined();
    expect(
      isUnchangedSeededPage({
        scriptSource: v17Page!,
        doc: docFromSeededSource(v17Page!),
      }),
    ).toBe(true);
  });

  it('describes the live expanded catalogue without fragile totals', () => {
    expect(SEED_VERSION).toBe(18);

    const dressPage = WELCOME_PAGE_SOURCES.find((source) =>
      source.includes('# Dress this book {'),
    );
    expect(dressPage).toContain('authored title field and lettering hand');
    expect(dressPage).toContain('continuous frame and matching emblem');
    expect(dressPage).toContain('one open diamond between cover and spine');

    expect(dressPage).not.toMatch(/\b(?:ten|twelve|sixteen|eighteen)\b/i);
    expect(WELCOME_PAGE_SOURCES).not.toContain(
      expect.stringContaining(V17_NUMERIC_COVER_COPY),
    );
  });
});
