import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { trailingOverflowCount } from '../src/editor/pagination';
import { DEFAULT_SETTINGS } from '../src/data/defaults';
import { parse } from '../src/script';
import { canFlipSpread, pagesToCreateOnFlip } from '../src/views/spread';
import { APP_VERSION } from '../src/version';

const ROOT = resolve(__dirname, '..');

describe('Alcove smoke gate', () => {
  it('keeps the tolerant Notebook Script parser total', () => {
    const malformed = '::: callout {broken=\n```tree\nroot\n  child\n';
    expect(() => parse(malformed)).not.toThrow();
    expect(parse(malformed).diagnostics.length).toBeGreaterThan(0);
  });

  it('keeps fixed-height pagination from removing the final block', () => {
    expect(trailingOverflowCount([300, 600, 900], 200, 0)).toBe(2);
    expect(trailingOverflowCount([900], 200, 0)).toBe(0);
  });

  it('keeps focus muting opt-in for a new profile', () => {
    expect(DEFAULT_SETTINGS.muteSoundsWhenUnfocused).toBe(false);
  });

  it('lets end turns grow arbitrarily many blank spreads', () => {
    expect(canFlipSpread(4, 1, 'next', false, 10_000)).toBe(true);
    expect(pagesToCreateOnFlip(4, 1, 'next', false, 10_000)).toBe(1);
    expect(pagesToCreateOnFlip(5, 2, 'next', false, 10_000)).toBe(2);
  });

  it('keeps the package and desktop bundle on one version', () => {
    const packageVersion = JSON.parse(
      readFileSync(resolve(ROOT, 'package.json'), 'utf8'),
    ).version;
    const tauriVersion = JSON.parse(
      readFileSync(resolve(ROOT, 'src-tauri/tauri.conf.json'), 'utf8'),
    ).version;

    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageVersion).toBe(APP_VERSION);
    expect(tauriVersion).toBe(APP_VERSION);
  });
});
