/**
 * src/features/settings/apply.ts — push persisted Settings into the world.
 *
 * `applySettings(settings)` is idempotent: the resulting document/engine state
 * is a pure function of the settings object, so it is safe to call on app
 * start (after `load()`) and again on every change (via `subscribe()`).
 *
 * What it touches:
 *  - `data-theme` / `data-ink` attributes on <html> (settings.css maps them)
 *  - `--motion-scale` (folded with the OS reduced-motion preference — see
 *    `effectiveMotionScale`), `--font-body`, `--text-body` inline vars on <html>
 *  - `nb-minimalist` / `nb-no-doodles` root classes (decoration hooks)
 *  - sound engine volumes, mute, reduced-sound, and the ambient loop state
 *
 * For node tests the DOM and the engine are injectable via `applySettingsTo`.
 */

import type { AnimationLevel, Settings } from '../../data/types';
import {
  muteAll as engineMuteAll,
  setHourlyChime as engineSetHourlyChime,
  setReducedSound as engineSetReducedSound,
  setSoundscape as engineSetSoundscape,
  setTypingSounds as engineSetTypingSounds,
  setVolumes as engineSetVolumes,
  startAmbient as engineStartAmbient,
  stopAmbient as engineStopAmbient,
  type Volumes,
} from '../../sound/engine';

/* ------------------------------ pure mappings ------------------------------ */

/** animationLevel -> value written to the `--motion-scale` root var. */
export const MOTION_SCALES: Record<AnimationLevel, string> = {
  full: '1',
  reduced: '0.5',
  off: '0',
};

/**
 * The scale to actually write, given the app setting and the OS preference.
 *
 * This has to fold the OS preference in itself: we write `--motion-scale` as
 * an INLINE style on <html>, and an inline declaration outranks the
 * `@media (prefers-reduced-motion: reduce)` block in global.css that also sets
 * it. So a user who had turned reduced motion on at the OS level got their
 * preference silently overwritten by settings the moment settings applied —
 * which is always. Someone who asked the OS for no motion means it, and the
 * app cannot offer *more* motion than that: the OS wins, whatever the setting.
 */
export function effectiveMotionScale(
  level: AnimationLevel,
  osPrefersReduced: boolean,
): string {
  return osPrefersReduced ? MOTION_SCALES.off : MOTION_SCALES[level];
}

/** True when the OS asks for reduced motion (false where matchMedia is absent). */
export function osPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Handwriting body-font choices -> full CSS stacks (all three families are
 * bundled via @fontsource and loaded in src/index.tsx).
 */
export const HANDWRITING_FONT_STACKS: Record<string, string> = {
  Caveat: '"Caveat Variable", "Segoe Script", cursive',
  'Patrick Hand': '"Patrick Hand", "Segoe Print", cursive',
  Kalam: '"Kalam", "Segoe Print", cursive',
};

/** Slider bounds for the body font size (px). Applied values are clamped. */
export const BODY_FONT_MIN = 15;
export const BODY_FONT_MAX = 21;

/** Root class that hides decorations app-wide (features opt in via CSS). */
export const MINIMALIST_CLASS = 'nb-minimalist';

/** Root class present when margin doodles are turned off. */
export const NO_DOODLES_CLASS = 'nb-no-doodles';

const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

/* ---------------------------- injectable targets --------------------------- */

/** Structural slice of `document.documentElement` the apply step needs. */
export interface SettingsRoot {
  setAttribute(name: string, value: string): void;
  style: { setProperty(name: string, value: string): void };
  classList: { toggle(name: string, force?: boolean): boolean };
}

/** Structural slice of the sound engine the apply step needs. */
export interface SettingsSoundAdapter {
  setVolumes(partial: Partial<Volumes>): void;
  muteAll(mute: boolean): void;
  setReducedSound(reduced: boolean): void;
  startAmbient(): void;
  stopAmbient(): void;
  setSoundscape(name: Settings['soundscape']): void;
  setTypingSounds(enabled: boolean): void;
  setHourlyChime(enabled: boolean): void;
}

const engineAdapter: SettingsSoundAdapter = {
  setVolumes: engineSetVolumes,
  muteAll: engineMuteAll,
  setReducedSound: engineSetReducedSound,
  startAmbient: () => {
    void engineStartAmbient();
  },
  stopAmbient: engineStopAmbient,
  setSoundscape: engineSetSoundscape,
  setTypingSounds: engineSetTypingSounds,
  setHourlyChime: engineSetHourlyChime,
};

/* --------------------------------- apply ----------------------------------- */

/**
 * Core apply step against injected targets (node tests use fakes).
 *
 * `osPrefersReduced` is a parameter rather than a read so the node tests can
 * exercise both branches without a matchMedia stub.
 */
export function applySettingsTo(
  s: Settings,
  root: SettingsRoot,
  sound: SettingsSoundAdapter,
  osPrefersReduced = osPrefersReducedMotion(),
): void {
  // Theme + ink: attributes on <html>; settings.css remaps the tokens.
  root.setAttribute('data-theme', s.theme);
  root.setAttribute('data-ink', s.inkColor);

  // Motion: GSAP code multiplies durations by this; CSS uses calc() with it.
  root.style.setProperty(
    '--motion-scale',
    effectiveMotionScale(s.animationLevel, osPrefersReduced),
  );

  // Body font override vars (fall back to the Patrick Hand stack).
  const stack =
    HANDWRITING_FONT_STACKS[s.handwritingFont] ??
    HANDWRITING_FONT_STACKS['Patrick Hand'];
  root.style.setProperty('--font-body', stack);
  root.style.setProperty(
    '--text-body',
    `${clamp(Math.round(s.bodyFontSize), BODY_FONT_MIN, BODY_FONT_MAX)}px`,
  );

  // Decoration hooks.
  root.classList.toggle(MINIMALIST_CLASS, s.minimalistMode);
  root.classList.toggle(NO_DOODLES_CLASS, !s.showMarginDoodles);

  // Sound engine.
  sound.setVolumes({
    master: s.soundMaster,
    ui: s.soundUi,
    pages: s.soundPages,
    shelf: s.soundShelf,
    ambient: s.soundAmbient,
  });
  sound.muteAll(s.muteAll);
  sound.setReducedSound(s.reducedSound);
  sound.setSoundscape(s.soundscape);
  sound.setTypingSounds(s.typingSounds);
  sound.setHourlyChime(s.hourlyChime);
  if (s.ambientLoop) sound.startAmbient();
  else sound.stopAmbient();
}

/**
 * Apply `settings` to the real document and sound engine. Idempotent —
 * call freely on load and on every settings change.
 */
export function applySettings(s: Settings): void {
  applySettingsTo(
    s,
    document.documentElement as unknown as SettingsRoot,
    engineAdapter,
  );
}
