/**
 * tests/seed-encoding.test.ts — the seeded text must survive a text editor.
 *
 * `LEGACY_WELCOME_PAGE_SOURCES` shipped double-UTF-8 encoded: the v4 pages were
 * pasted back in with the pencil as three Latin-1 characters instead of one
 * glyph, and every em dash and ellipsis the same way.
 *
 * That block has exactly one job. It tells a welcome book nobody has touched
 * from a welcome book somebody has been writing in, so the v4 -> v5 refresh can
 * replace the first and never go near the second — and it does that by
 * comparing the stored text against what v4 seeded. One wrong character makes
 * an untouched book look written-in, so the refresh declines it. New installs
 * got the rewritten sixteen-page book; EVERY EXISTING READER silently kept the
 * old five-page tour, which is the opposite of what the rewrite was for.
 *
 * `src/data/seed.ts` predicted this in its own docblock — *"A character out of
 * place makes an untouched book look written-in, which is the safe direction to
 * be wrong in (the reader keeps the old tour) but it is still wrong"* — and
 * nothing enforced it. The comment knew; the suite did not.
 *
 * Mojibake is mechanically recognisable, which is what makes this checkable:
 * UTF-8 bytes reinterpreted as Latin-1 always surface as the same handful of
 * lead bytes, in places English prose never puts them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/**
 * The lead bytes of UTF-8 sequences misread as Latin-1.
 *
 * `â€` is any punctuation in the General Punctuation block (em dash,
 * ellipsis, curly quotes); `âœ` is the dingbat block the pencil lives
 * in; `Ã` and `Â` cover accented Latin and non-breaking space. Written
 * as escapes rather than literal characters so this file cannot itself become
 * the thing it is testing for.
 */
const MOJIBAKE = /â€|âœ|Ã[ -¿]|Â[ -¿]/;

describe('the seeded pages are not double-encoded', () => {
  it('no seeded source carries UTF-8 that was read as Latin-1', async () => {
    const seed = await import('../src/data/seed');
    const groups: readonly (readonly [string, readonly string[]])[] = [
      ['WELCOME_PAGE_SOURCES', seed.WELCOME_PAGE_SOURCES],
      ['LEGACY_WELCOME_PAGE_SOURCES', seed.LEGACY_WELCOME_PAGE_SOURCES],
    ];

    const bad: string[] = [];
    for (const [name, sources] of groups) {
      sources.forEach((source, i) => {
        const hit = MOJIBAKE.exec(source);
        if (hit !== null) {
          const from = Math.max(0, hit.index - 30);
          bad.push(`${name}[${i}] near: ${source.slice(from, hit.index + 30)}`);
        }
      });
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('the legacy pages still carry the glyphs the v4 seed actually wrote', () => {
    // Not a style preference: these characters ARE the comparison. If the
    // pencil is not on page one, no book seeded by v4 can fingerprint equal to
    // it, and the refresh declines every library it was written to upgrade.
    const source = read('src/data/seed.ts');
    const at = source.indexOf('export const LEGACY_WELCOME_PAGE_SOURCES');
    expect(at, 'LEGACY_WELCOME_PAGE_SOURCES is gone').toBeGreaterThan(-1);
    expect(source.slice(at)).toContain('# Welcome to Alcove ✎');
  });

  it('holds every retired generation, and only retired ones', async () => {
    // Five from v4, sixteen from v5 and thirty-two from v6. The count is
    // pinned because BOTH ways of getting it wrong are silent: a missing
    // generation means a library on that version is not recognised and keeps
    // its old tour forever, and the LIVE pages appearing here would make the
    // current book look like the outgoing one and stop the next refresh dead.
    const seed = await import('../src/data/seed');
    expect(seed.LEGACY_WELCOME_PAGE_SOURCES).toHaveLength(5 + 16 + 32);
    for (const source of seed.LEGACY_WELCOME_PAGE_SOURCES) {
      expect(source.length).toBeGreaterThan(80);
    }
    for (const live of seed.WELCOME_PAGE_SOURCES) {
      expect(
        seed.LEGACY_WELCOME_PAGE_SOURCES,
        'a page that is still being seeded is listed as retired',
      ).not.toContain(live);
    }
  });
});
