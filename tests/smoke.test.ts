import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { trailingOverflowCount } from '../src/editor/pagination';
import { DEFAULT_SETTINGS } from '../src/data/defaults';
import { parse } from '../src/script';
import { canFlipSpread, pagesToCreateOnFlip } from '../src/views/spread';
import { APP_VERSION } from '../src/version';
import {
  CONFETTI_COUNT,
  CONFETTI_DURATION_MS,
  taskCompletionCue,
} from '../src/editor/effects/confetti';
import {
  FLIP_CORNER_OVERSCAN_HEIGHT_FRAC,
  FLIP_SCENE_OVERSCAN_PX,
} from '../src/flip/scene';
import { CURL_VERT_SRC } from '../src/flip/curl';

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

  it('puts default ambience away with the app in the tray', () => {
    expect(DEFAULT_SETTINGS.playAmbienceInTray).toBe(false);
  });

  it('keeps visual confetti deliberately silent', () => {
    expect(taskCompletionCue(true)).toBeNull();
    expect(taskCompletionCue(false)).toBe('check-done');
  });

  it('keeps the decorative burst inside its lightweight interaction budget', () => {
    expect(CONFETTI_COUNT).toBeLessThanOrEqual(28);
    expect(CONFETTI_DURATION_MS).toBeLessThanOrEqual(760);
  });

  it('lets end turns grow arbitrarily many blank spreads', () => {
    expect(canFlipSpread(4, 1, 'next', false, 10_000)).toBe(true);
    expect(pagesToCreateOnFlip(4, 1, 'next', false, 10_000)).toBe(1);
    expect(pagesToCreateOnFlip(5, 2, 'next', false, 10_000)).toBe(2);
  });

  it('gives a turning page room beyond the settled cover', () => {
    // The title gap is about 24px at the shipped reader size. Keep enough
    // gesture-only framebuffer beyond it for the curl silhouette/contact edge.
    expect(FLIP_SCENE_OVERSCAN_PX).toBeGreaterThanOrEqual(48);
    expect(FLIP_CORNER_OVERSCAN_HEIGHT_FRAC).toBeGreaterThanOrEqual(0.2);
  });

  it('projects the real corner silhouette without depth-tearing baselines', () => {
    // A larger canvas alone is empty room. The vertex shader must retain the
    // cylinder's pos.y while the project() helper still compensates only the
    // independent perspective divide caused by z depth.
    expect(CURL_VERT_SRC).toContain('float stableY =');
    expect(CURL_VERT_SRC).toContain('gl_Position = project(pos, z);');
    expect(CURL_VERT_SRC).not.toContain('project(vec2(pos.x, local.y), z)');
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
