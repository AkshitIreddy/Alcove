/**
 * tests/contrast.test.ts — the token palette is loud AND measured.
 *
 * Gates every WCAG-ish token pair from scripts/check-contrast.mjs (the
 * zero-dependency checker; `node scripts/check-contrast.mjs` prints the
 * human table) in each of the four UI themes, without needing a browser.
 * The e2e visual-audit spec covers a few COMPUTED pairs in-page; this suite
 * owns the source-of-truth token matrix so a palette edit fails fast here.
 */
import { describe, expect, it } from 'vitest';
import { buildPairs, checkAll, loadThemes } from '../scripts/check-contrast.mjs';

describe('token contrast across the four UI themes', () => {
  const themes = loadThemes();
  const { perTheme, violations } = checkAll(themes);

  it('loads exactly the four UI themes (parchment, pastel, botanical, night)', () => {
    expect(Object.keys(themes).sort()).toEqual([
      'botanical',
      'night',
      'parchment',
      'pastel',
    ]);
  });

  it('checks a real matrix (body, chrome, rims, all sixteen washes)', () => {
    // 20 fixed body/chrome/rim pairs + 3 info + 16 wash + 16 wash-rim + 6 type.
    expect(buildPairs().length).toBe(20 + 3 + 16 + 16 + 6);
  });

  it('resolves every gated token (a renamed-away token must fail loudly)', () => {
    const unresolved = violations.filter((v) => v.why !== undefined);
    expect(unresolved.map((v) => `${v.theme}: ${v.why}`)).toEqual([]);
  });

  it.each([...perTheme.keys()].sort())(
    'theme %s clears every gated pair (text 4.5:1, rims/icons 3:1)',
    (theme) => {
      const rows = perTheme.get(theme) ?? [];
      const fails = rows.filter((r) => r.status === 'FAIL');
      expect(
        fails.map((f) => `${f.label}: ${f.ratio?.toFixed(2)}:1 under ${f.gate}:1`),
      ).toEqual([]);
    },
  );

  it('has zero violations overall', () => {
    expect(
      violations.map(
        (v) =>
          `${v.theme}: ${v.label}` +
          (v.why ? ` — ${v.why}` : ` — ${v.ratio?.toFixed(2)}:1 under ${v.gate}:1`),
      ),
    ).toEqual([]);
  });
});
