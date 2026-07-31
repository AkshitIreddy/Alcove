// @vitest-environment node
/**
 * tests/motion.test.ts — the shared motion scale (src/styles/motion.ts):
 *   1. the scale stays small and monotonic (a fifth step is how the app's
 *      timings drifted apart in the first place),
 *   2. tween() scales durations and never leaks an unnamed easing,
 *   3. the OS reduced-motion query beats the --motion-scale variable, because
 *      settings writes that variable as an inline style and would otherwise
 *      silently override the system preference,
 *   4. LINGER_MS holds are reading time and are NOT scaled by motion.
 *
 * Runs in node, so `window`/`document` are faked per-case and torn down.
 */
import { afterEach, describe, expect, it } from 'vitest';

import {
  DUR,
  EASE,
  LINGER_MS,
  dur,
  durMs,
  isMotionOff,
  motionScale,
  tween,
} from '../src/styles/motion';

type Globals = typeof globalThis & {
  window?: unknown;
  document?: unknown;
  getComputedStyle?: unknown;
};

const g = globalThis as Globals;

/** Fake just enough DOM for motionScale(): a media query and one CSS var. */
function stubEnvironment(options: {
  reduced: boolean;
  scale: string;
}): void {
  g.window = {
    matchMedia: (query: string) => ({
      matches: options.reduced && query.includes('reduce'),
    }),
  };
  g.document = { documentElement: {} };
  g.getComputedStyle = () => ({
    getPropertyValue: (name: string) =>
      name === '--motion-scale' ? options.scale : '',
  });
}

afterEach(() => {
  delete g.window;
  delete g.document;
  delete g.getComputedStyle;
});

describe('motion scale', () => {
  it('is four strictly increasing steps', () => {
    const steps = [DUR.instant, DUR.quick, DUR.normal, DUR.slow];
    expect(Object.keys(DUR)).toHaveLength(4);
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]).toBeGreaterThan(steps[i - 1]);
    }
    // Everything stays inside the range the app already animates in.
    expect(DUR.instant).toBeGreaterThan(0.05);
    expect(DUR.slow).toBeLessThanOrEqual(0.5);
  });

  it('names four easing roles and every one is a real GSAP ease string', () => {
    expect(Object.keys(EASE).sort()).toEqual([
      'enter',
      'exit',
      'spring',
      'standard',
    ]);
    for (const ease of Object.values(EASE)) {
      expect(ease).toMatch(/^(power[1-4]|back|elastic|none)/);
    }
  });
});

describe('tween()', () => {
  it('scales the duration and defaults to the enter ease', () => {
    stubEnvironment({ reduced: false, scale: '0.5' });
    expect(tween('normal')).toEqual({
      duration: DUR.normal * 0.5,
      ease: EASE.enter,
    });
    expect(tween('quick', 'exit').ease).toBe(EASE.exit);
  });

  it('collapses to a zero duration when motion is off', () => {
    stubEnvironment({ reduced: false, scale: '0' });
    expect(tween('slow').duration).toBe(0);
    expect(isMotionOff()).toBe(true);
  });

  it('falls back to full motion when no variable is set', () => {
    // No DOM at all (SSR, tests, early boot) must not throw or zero out.
    expect(motionScale()).toBe(1);
    expect(dur('normal')).toBe(DUR.normal);
    expect(durMs('normal')).toBeCloseTo(DUR.normal * 1000);
  });
});

describe('reduced motion', () => {
  it('lets the OS preference beat an inline --motion-scale of 1', () => {
    stubEnvironment({ reduced: true, scale: '1' });
    expect(motionScale()).toBe(0);
    expect(isMotionOff()).toBe(true);
  });

  it('never returns a negative scale from a malformed variable', () => {
    stubEnvironment({ reduced: false, scale: '-3' });
    expect(motionScale()).toBe(0);
    stubEnvironment({ reduced: false, scale: 'nonsense' });
    expect(motionScale()).toBe(1);
  });

  it('leaves linger holds alone — reading time is not movement', () => {
    stubEnvironment({ reduced: true, scale: '0' });
    expect(LINGER_MS.toast).toBe(2600);
    expect(LINGER_MS.hint).toBeLessThan(LINGER_MS.toast);
    for (const ms of Object.values(LINGER_MS)) {
      expect(ms).toBeGreaterThan(1000);
    }
  });
});
