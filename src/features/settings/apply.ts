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
 *  - `data-cursor-set` plus the fourteen `--nb-cur-*` vars (styles/cursors.css
 *    reads them; see ./cursorSkin.ts for the half that cannot be a pure write)
 *  - sound engine volumes, mute, reduced-sound, and the ambient loop state
 *
 * For node tests the DOM and the engine are injectable via `applySettingsTo`.
 */

import { cursorVars } from '../../art/cursors';
import {
  CURSOR_SET_ATTR,
  effectiveCursorSet,
  osForcedColours,
  refreshCursorOverrides,
  watchStyleSheets,
} from './cursorSkin';
import type { AnimationLevel, Settings } from '../../data/types';
import { HANDS, appearanceTokens, themeBase } from './appearance';
import { loadPaperStock, paperStock, subscribePaperStock } from './appearancePrefs';
import {
  CODE_SIZE_MAX,
  CODE_SIZE_MIN,
  codeTokens,
  resolveCodeFace,
} from './codeAppearance';
import {
  codeLook,
  loadCodeLook,
  subscribeCodeLook,
  type CodeLook,
} from './codeAppearancePrefs';
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
 * Handwriting body-font choices -> full CSS stacks.
 *
 * DERIVED from the hand vocabulary rather than typed out. It used to be three
 * literal entries — Caveat, Patrick Hand, Kalam — while `src/index.tsx` loaded
 * nine faces and Windows supplies a dozen more, so two thirds of the type in
 * the app was unreachable from the one control that exists to choose it. The
 * ids are still family names, so every stored value keeps meaning what it
 * meant; the map simply stopped being the shorter of the two lists.
 */
export const HANDWRITING_FONT_STACKS: Record<string, string> = Object.fromEntries(
  HANDS.map((hand) => [hand.id, hand.stack]),
);

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
  paper: string | null = null,
  osForced = osForcedColours(),
  code: CodeLook | null = null,
): void {
  // Theme + ink: attributes on <html>; settings.css remaps the tokens.
  //
  // `data-theme` gets the theme's BASE, not its id. There are ~30 themes and
  // four stylesheet rooms; a theme is one of those rooms plus a paper and an
  // accent, so the attribute keeps naming the room. That is what lets a new
  // theme inherit sixty hand-tuned, contrast-gated tokens instead of restating
  // them, and it is why every `:root[data-theme='night']` rule in the
  // stylesheets still fires for Midnight, Cellar, Velvet and Foxfire.
  root.setAttribute('data-theme', themeBase(s.theme));
  root.setAttribute('data-ink', s.inkColor);
  root.setAttribute('data-appearance', s.theme);

  // The appearance vocabulary's own tokens, on top of the room. Written for
  // EVERY key on every apply, including the empty ones: setting a custom
  // property to '' removes the inline declaration, so going back to a shipped
  // room actually gets the stylesheet's values back rather than keeping the
  // last theme's overrides forever.
  for (const [name, value] of Object.entries(
    appearanceTokens(s.theme, s.inkColor, paper),
  )) {
    root.style.setProperty(name, value);
  }

  /*
   * The code look: fourteen `--code-*` colours plus the three that are not
   * colours at all.
   *
   * It is written HERE rather than by the editor because a code block is not
   * the only thing that draws code — the insert dialog's preview, an exported
   * page and the diff a pack shows all do — and a token on <html> is the one
   * place all of them can read the same answer from. `data-code-frame` is an
   * attribute rather than a variable because it selects a whole set of rules
   * in editor.css (a tab is not a rule is not a pinned card), which is the
   * same split `data-theme` and the appearance tokens already keep.
   */
  const look = code ?? codeLook();
  root.setAttribute('data-code-frame', look.frame);
  root.setAttribute('data-code-numbers', look.numbers ? 'on' : 'off');
  for (const [name, value] of Object.entries(
    codeTokens(look.theme, s.theme, s.inkColor, paper),
  )) {
    root.style.setProperty(name, value);
  }
  root.style.setProperty('--font-code', resolveCodeFace(look.face).stack);
  root.style.setProperty(
    '--text-code',
    `${clamp(Math.round(look.size), CODE_SIZE_MIN, CODE_SIZE_MAX)}px`,
  );

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

  // The pointer. The attribute is the on switch (styles/cursors.css gates
  // every rule on it) and the fourteen vars are the states.
  //
  // The COMPLETE map is written every time, including for `system`, where the
  // values are the plain CSS keywords. A partial write is how one state of the
  // previous set survives into the next one: a set that happened not to define
  // `--nb-cur-progress` would leave the old url in place on <html>, and it
  // would stay there until the app was reloaded.
  const cursorSet = effectiveCursorSet(s.cursorSet, osForced);
  root.setAttribute(CURSOR_SET_ATTR, cursorSet);
  for (const [name, value] of Object.entries(cursorVars(cursorSet))) {
    root.style.setProperty(name, value);
  }

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
 * The last settings this module was handed.
 *
 * The paper stock lives in its own row (see `appearancePrefs.ts`, and
 * `data/designPrefs.ts` for why), so it changes without a settings write. When
 * it does, the page has to be repainted from the SAME settings that are
 * already applied — holding them here is how, and it keeps the arrow pointing
 * one way: the store notifies the applier, never the other way round.
 */
let lastApplied: Settings | null = null;
let watchingPaper = false;
let watchingCode = false;
let watchingSheets = false;

/**
 * Apply `settings` to the real document and sound engine. Idempotent —
 * call freely on load and on every settings change.
 */
export function applySettings(s: Settings): void {
  lastApplied = s;
  if (!watchingPaper) {
    watchingPaper = true;
    subscribePaperStock(() => {
      if (lastApplied !== null) applySettings(lastApplied);
    });
    // The row is read once, on the first apply — which App.tsx makes on boot,
    // right after `load()`. Until it lands the page is on the room's own
    // paper, which is exactly what a reader who has never chosen a stock has.
    void loadPaperStock();
  }
  if (!watchingCode) {
    watchingCode = true;
    // Same shape as the paper stock, and for the same reason: the code look
    // lives in its own row, so it changes without a settings write and the
    // page has to be repainted from the settings that are already applied.
    subscribeCodeLook(() => {
      if (lastApplied !== null) applySettings(lastApplied);
    });
    void loadCodeLook();
  }
  if (!watchingSheets) {
    watchingSheets = true;
    // The half of the cursor feature that cannot be a property write: the
    // app's own 117 `cursor:` declarations, rewritten to read the vars above.
    // See ./cursorSkin.ts. The observer is what keeps it true for stylesheets
    // that arrive later — half of them are imported by the feature that needs
    // them, so the boot sweep sees roughly half of what will eventually exist.
    watchStyleSheets();
  }
  refreshCursorOverrides();
  applySettingsTo(
    s,
    document.documentElement as unknown as SettingsRoot,
    engineAdapter,
    osPrefersReducedMotion(),
    paperStock(),
    osForcedColours(),
    codeLook(),
  );
}
