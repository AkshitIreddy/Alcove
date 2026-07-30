// @vitest-environment node
/**
 * tests/settings.test.ts — the settings feature's pure surfaces:
 *
 *  - mergeSettings(): validated merge of an unknown stored blob over defaults
 *  - applySettingsTo(): pushing settings into an injected DOM root + sound
 *    adapter (theme/ink attrs, motion scale, font vars, classes, volumes,
 *    mute/reduced, ambient loop) and its idempotence.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_KEYBINDINGS, DEFAULT_SETTINGS } from '../src/data/defaults';
import { mergeSettings } from '../src/data/settings';
import type { Settings } from '../src/data/types';
import {
  BODY_FONT_MAX,
  BODY_FONT_MIN,
  HANDWRITING_FONT_STACKS,
  MINIMALIST_CLASS,
  MOTION_SCALES,
  NO_DOODLES_CLASS,
  applySettingsTo,
  type SettingsRoot,
  type SettingsSoundAdapter,
} from '../src/features/settings/apply';

/* ------------------------------- fakes ------------------------------------ */

class FakeRoot implements SettingsRoot {
  attrs = new Map<string, string>();
  vars = new Map<string, string>();
  classes = new Set<string>();

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  style = {
    setProperty: (name: string, value: string): void => {
      this.vars.set(name, value);
    },
  };

  classList = {
    toggle: (name: string, force?: boolean): boolean => {
      const on = force ?? !this.classes.has(name);
      if (on) this.classes.add(name);
      else this.classes.delete(name);
      return on;
    },
  };

  snapshot(): unknown {
    return {
      attrs: [...this.attrs.entries()].sort(),
      vars: [...this.vars.entries()].sort(),
      classes: [...this.classes].sort(),
    };
  }
}

class FakeSound implements SettingsSoundAdapter {
  volumes: Record<string, number> = {};
  muted = false;
  reduced = false;
  ambientRunning = false;
  startCalls = 0;
  stopCalls = 0;
  soundscape: Settings['soundscape'] = 'library';
  typingSounds = false;
  hourlyChime = false;

  setVolumes(partial: Partial<Record<string, number>>): void {
    for (const [key, value] of Object.entries(partial)) {
      if (value !== undefined) this.volumes[key] = value;
    }
  }

  muteAll(mute: boolean): void {
    this.muted = mute;
  }

  setReducedSound(reduced: boolean): void {
    this.reduced = reduced;
  }

  startAmbient(): void {
    this.startCalls += 1;
    this.ambientRunning = true;
  }

  stopAmbient(): void {
    this.stopCalls += 1;
    this.ambientRunning = false;
  }

  setSoundscape(name: Settings['soundscape']): void {
    this.soundscape = name;
  }

  setTypingSounds(enabled: boolean): void {
    this.typingSounds = enabled;
  }

  setHourlyChime(enabled: boolean): void {
    this.hourlyChime = enabled;
  }

  snapshot(): unknown {
    return {
      volumes: { ...this.volumes },
      muted: this.muted,
      reduced: this.reduced,
      ambientRunning: this.ambientRunning,
      soundscape: this.soundscape,
      typingSounds: this.typingSounds,
      hourlyChime: this.hourlyChime,
    };
  }
}

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    keybindings: { ...DEFAULT_SETTINGS.keybindings },
    ...overrides,
  } as Settings;
}

function apply(s: Settings): { root: FakeRoot; sound: FakeSound } {
  const root = new FakeRoot();
  const sound = new FakeSound();
  applySettingsTo(s, root, sound);
  return { root, sound };
}

/* -------------------------- merge over defaults ---------------------------- */

describe('mergeSettings (stored blob over defaults)', () => {
  it('returns defaults for null / non-object / array blobs', () => {
    for (const raw of [null, undefined, 42, 'hello', [1, 2, 3]]) {
      const merged = mergeSettings(raw);
      expect(merged).toEqual(DEFAULT_SETTINGS);
      // Detached copy, not the defaults object itself.
      expect(merged).not.toBe(DEFAULT_SETTINGS);
      expect(merged.keybindings).not.toBe(DEFAULT_SETTINGS.keybindings);
    }
  });

  it('keeps valid stored values, including the new sound fields', () => {
    const merged = mergeSettings({
      theme: 'night',
      bodyFontSize: 19,
      inkColor: 'graphite',
      animationLevel: 'reduced',
      soundShelf: 0.25,
      ambientLoop: true,
      reducedSound: true,
      defaultBookPalette: 'lavender',
      dragMomentum: 0,
    });
    expect(merged.theme).toBe('night');
    expect(merged.bodyFontSize).toBe(19);
    expect(merged.inkColor).toBe('graphite');
    expect(merged.animationLevel).toBe('reduced');
    expect(merged.soundShelf).toBe(0.25);
    expect(merged.ambientLoop).toBe(true);
    expect(merged.reducedSound).toBe(true);
    expect(merged.defaultBookPalette).toBe('lavender');
    expect(merged.dragMomentum).toBe(0);
  });

  it('falls back per-field on wrong types and unknown enum values', () => {
    const merged = mergeSettings({
      theme: 'neon', // not a ThemeName
      animationLevel: 'hyper', // not a level
      defaultBookPalette: 'chartreuse', // not a palette
      bodyFontSize: '19', // string, not number
      soundMaster: Number.NaN, // non-finite
      muteAll: 'yes', // string, not boolean
      ambientLoop: 1, // number, not boolean
      handwritingFont: 42, // number, not string
    });
    expect(merged.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(merged.animationLevel).toBe(DEFAULT_SETTINGS.animationLevel);
    expect(merged.defaultBookPalette).toBe(DEFAULT_SETTINGS.defaultBookPalette);
    expect(merged.bodyFontSize).toBe(DEFAULT_SETTINGS.bodyFontSize);
    expect(merged.soundMaster).toBe(DEFAULT_SETTINGS.soundMaster);
    expect(merged.muteAll).toBe(DEFAULT_SETTINGS.muteAll);
    expect(merged.ambientLoop).toBe(DEFAULT_SETTINGS.ambientLoop);
    expect(merged.handwritingFont).toBe(DEFAULT_SETTINGS.handwritingFont);
  });

  it('drops unknown keys from removed/newer app versions', () => {
    const merged = mergeSettings({ zebraStripes: true, theme: 'pastel' });
    expect(merged.theme).toBe('pastel');
    expect('zebraStripes' in merged).toBe(false);
    expect(Object.keys(merged).sort()).toEqual(
      Object.keys(DEFAULT_SETTINGS).sort(),
    );
  });

  it('merges keybindings per-action over the defaults', () => {
    const merged = mergeSettings({
      keybindings: {
        'command-palette': 'mod+p',
        'my-custom-action': 'mod+9',
        broken: 123, // non-string binding ignored
      },
    });
    expect(merged.keybindings['command-palette']).toBe('mod+p');
    expect(merged.keybindings['my-custom-action']).toBe('mod+9');
    expect(merged.keybindings['new-page']).toBe(DEFAULT_KEYBINDINGS['new-page']);
    expect('broken' in merged.keybindings).toBe(false);
  });

  it('telemetry can never be turned on by a stored blob', () => {
    expect(mergeSettings({ telemetry: true }).telemetry).toBe(false);
  });
});

/* ------------------------------ applySettings ------------------------------ */

describe('applySettingsTo', () => {
  it('maps every theme onto the data-theme attribute', () => {
    for (const theme of ['parchment', 'pastel', 'botanical', 'night'] as const) {
      const { root } = apply(makeSettings({ theme }));
      expect(root.attrs.get('data-theme')).toBe(theme);
    }
  });

  it('maps the ink color onto the data-ink attribute', () => {
    for (const inkColor of ['sepia', 'graphite', 'ink-blue']) {
      const { root } = apply(makeSettings({ inkColor }));
      expect(root.attrs.get('data-ink')).toBe(inkColor);
    }
  });

  it('maps animation level onto --motion-scale (1 / 0.5 / 0)', () => {
    expect(MOTION_SCALES).toEqual({ full: '1', reduced: '0.5', off: '0' });
    for (const level of ['full', 'reduced', 'off'] as const) {
      const { root } = apply(makeSettings({ animationLevel: level }));
      expect(root.vars.get('--motion-scale')).toBe(MOTION_SCALES[level]);
    }
  });

  it('writes the body font stack and clamped size vars', () => {
    for (const font of Object.keys(HANDWRITING_FONT_STACKS)) {
      const { root } = apply(
        makeSettings({ handwritingFont: font, bodyFontSize: 17 }),
      );
      expect(root.vars.get('--font-body')).toBe(HANDWRITING_FONT_STACKS[font]);
      expect(root.vars.get('--text-body')).toBe('17px');
    }
    // Unknown font falls back to the Patrick Hand stack.
    const unknown = apply(makeSettings({ handwritingFont: 'Comic Sans' }));
    expect(unknown.root.vars.get('--font-body')).toBe(
      HANDWRITING_FONT_STACKS['Patrick Hand'],
    );
    // Out-of-range sizes clamp to the slider bounds.
    expect(
      apply(makeSettings({ bodyFontSize: 99 })).root.vars.get('--text-body'),
    ).toBe(`${BODY_FONT_MAX}px`);
    expect(
      apply(makeSettings({ bodyFontSize: 3 })).root.vars.get('--text-body'),
    ).toBe(`${BODY_FONT_MIN}px`);
  });

  it('toggles the minimalist and doodle root classes', () => {
    const plain = apply(
      makeSettings({ minimalistMode: false, showMarginDoodles: true }),
    );
    expect(plain.root.classes.has(MINIMALIST_CLASS)).toBe(false);
    expect(plain.root.classes.has(NO_DOODLES_CLASS)).toBe(false);

    const bare = apply(
      makeSettings({ minimalistMode: true, showMarginDoodles: false }),
    );
    expect(bare.root.classes.has(MINIMALIST_CLASS)).toBe(true);
    expect(bare.root.classes.has(NO_DOODLES_CLASS)).toBe(true);
  });

  it('pushes all five volumes, mute, reduced-sound, and ambient state', () => {
    const { sound } = apply(
      makeSettings({
        soundMaster: 0.9,
        soundUi: 0.1,
        soundPages: 0.2,
        soundShelf: 0.3,
        soundAmbient: 0.4,
        muteAll: true,
        reducedSound: true,
        ambientLoop: true,
      }),
    );
    expect(sound.volumes).toEqual({
      master: 0.9,
      ui: 0.1,
      pages: 0.2,
      shelf: 0.3,
      ambient: 0.4,
    });
    expect(sound.muted).toBe(true);
    expect(sound.reduced).toBe(true);
    expect(sound.ambientRunning).toBe(true);

    const off = apply(makeSettings({ ambientLoop: false }));
    expect(off.sound.ambientRunning).toBe(false);
    expect(off.sound.stopCalls).toBe(1);
  });

  it('is idempotent: re-applying the same settings changes nothing', () => {
    const s = makeSettings({
      theme: 'botanical',
      inkColor: 'ink-blue',
      animationLevel: 'off',
      handwritingFont: 'Kalam',
      bodyFontSize: 21,
      minimalistMode: true,
      showMarginDoodles: false,
      ambientLoop: true,
      muteAll: false,
      reducedSound: true,
    });
    const root = new FakeRoot();
    const sound = new FakeSound();

    applySettingsTo(s, root, sound);
    const rootAfterFirst = root.snapshot();
    const soundAfterFirst = sound.snapshot();

    applySettingsTo(s, root, sound);
    applySettingsTo(s, root, sound);

    expect(root.snapshot()).toEqual(rootAfterFirst);
    expect(sound.snapshot()).toEqual(soundAfterFirst);
  });

  it('leaves no residue when settings flip back and forth', () => {
    const a = makeSettings({
      theme: 'night',
      minimalistMode: true,
      showMarginDoodles: false,
      ambientLoop: true,
    });
    const b = makeSettings(); // defaults

    const root = new FakeRoot();
    const sound = new FakeSound();
    applySettingsTo(a, root, sound);
    const afterA = { root: root.snapshot(), sound: sound.snapshot() };

    applySettingsTo(b, root, sound);
    applySettingsTo(a, root, sound);

    expect(root.snapshot()).toEqual(afterA.root);
    expect(sound.snapshot()).toEqual(afterA.sound);
  });
});
