/**
 * src/styles/motion.ts — the JS half of the app's motion vocabulary.
 *
 * TypeScript rather than CSS on purpose: the CSS half already exists
 * (`--dur-*` / `--ease-*` in tokens.css, the reduced-motion block in
 * global.css) and GSAP cannot consume a custom property as a tween duration.
 * Call sites were each inventing their own seconds and easing strings, so the
 * rail slid at one tempo and the editor settled at another. This module is the
 * single place those numbers live for anything animated from script.
 *
 * The numbers are not new: they are the modes of what the app already does
 * well. Tallying every gsap call in the tree gives four clusters —
 * ~0.09 / ~0.20 / ~0.30 / ~0.44 seconds — and four easing roles. Those are the
 * scale below. The shelf and the page-flip engine were hand-tuned against real
 * spring physics and are deliberately NOT migrated; they are the reference the
 * scale was measured from, not consumers of it.
 *
 * Rules that come with using this module:
 *   - Animate transform and opacity only. Nothing here should ever be handed
 *     to a layout property (width/height/top/left/margin) — those re-layout
 *     the page every frame and the pagination pass runs on the same frames.
 *   - Never scale a *reading* duration by motion scale. How long a toast stays
 *     up is reading time, not movement; see LINGER_MS.
 */

/* ---------------------------------------------------------------------------
   The scale
   ------------------------------------------------------------------------- */

/**
 * Durations in SECONDS (GSAP's native unit). Four steps, deliberately few —
 * if a value feels between two steps, pick one; a fifth step is how the app
 * drifted apart in the first place.
 *
 *   instant — a surface acknowledging a press: squash, tint, opacity pop.
 *             Below ~0.1s motion reads as feedback rather than as travel.
 *   quick   — something small appearing or leaving in place: a menu, a chip,
 *             a badge, a settle after a drop.
 *   normal  — the default. Anything that crosses a meaningful distance but
 *             stays inside one region of the screen.
 *   slow    — a whole panel or sheet entering/leaving the screen. Reserved
 *             for full surfaces; a button at this tempo feels broken.
 */
export const DUR = {
  instant: 0.09,
  quick: 0.2,
  normal: 0.3,
  slow: 0.44,
} as const;

export type DurationName = keyof typeof DUR;

/**
 * Easings, as GSAP ease strings. Each mirrors a `--ease-*` token so a CSS
 * transition and a GSAP tween on the same element cannot disagree.
 *
 *   standard — moving something already on screen from A to B. Eases both
 *              ends, so nothing lurches. Mirrors --ease-in-out.
 *   enter    — something arriving: fast off the mark, long soft landing.
 *              The most-used ease in the app. Mirrors --ease-out.
 *   exit     — something leaving: slow to commit, then gone. Deliberately the
 *              mirror of `enter` so a close never looks like a stalled open.
 *   spring   — a landing with weight, for objects the user physically moved
 *              (a dropped block, a pulled book). Overshoots — never use it on
 *              text or on anything that must not wobble. Mirrors --ease-spring.
 */
export const EASE = {
  standard: 'power2.inOut',
  enter: 'power3.out',
  exit: 'power2.in',
  spring: 'back.out(1.5)',
} as const;

export type EaseName = keyof typeof EASE;

/**
 * Holds measured in MILLISECONDS: how long a transient stays put before it
 * dismisses itself. These are reading/attention times, NOT movement, so they
 * are never multiplied by the motion scale — someone who turned animation off
 * still needs the same beat to read a toast.
 */
export const LINGER_MS = {
  /** Transient status chip (export finished, clipboard failed). */
  toast: 2600,
  /** Inline nudge anchored to the thing it is about ("page is full"). */
  hint: 1600,
  /** Ambient "something happened" tell, e.g. the autosave pencil. */
  pulse: 1400,
} as const;

/* ---------------------------------------------------------------------------
   Reduced motion — the one place that decides
   ------------------------------------------------------------------------- */

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * How much of the designed motion to actually play: 0 = none, 1 = full.
 * Settings' "animation level" writes `--motion-scale` (1 / 0.5 / 0) onto
 * <html>.
 *
 * The OS preference is checked FIRST and wins outright, because settings
 * writes that variable as an inline style — which outranks the
 * `@media (prefers-reduced-motion: reduce)` rule in global.css, so reading the
 * variable alone would quietly ignore the system setting for every JS tween.
 */
export function motionScale(): number {
  if (prefersReducedMotion()) return 0;
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
    return 1;
  }
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--motion-scale')
    .trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 1;
}

/**
 * True when motion is switched off entirely. Only for effects that have no
 * meaningful zero-duration form and should simply not happen — confetti, idle
 * ambience. Anything that moves a thing from A to B should NOT branch on this:
 * pass a scaled duration instead and let it land instantly.
 */
export function isMotionOff(): boolean {
  return motionScale() <= 0;
}

/* ---------------------------------------------------------------------------
   Call-site helpers
   ------------------------------------------------------------------------- */

/** A named duration in seconds, scaled for the current motion preference. */
export function dur(name: DurationName): number {
  return DUR[name] * motionScale();
}

/** Same, in milliseconds — for setTimeout-driven state, not for GSAP. */
export function durMs(name: DurationName): number {
  return dur(name) * 1000;
}

/** What gsap.to/from vars need. Spread it; never hand-write these two keys. */
export interface TweenTiming {
  duration: number;
  ease: string;
}

/**
 * The whole point of the module: `gsap.to(el, { x: 0, ...tween('slow') })`.
 * Reduced motion collapses `duration` to 0, and GSAP still applies the end
 * state and fires onComplete — so no call site has to remember the preference.
 */
export function tween(
  duration: DurationName,
  ease: EaseName = 'enter',
): TweenTiming {
  return { duration: dur(duration), ease: EASE[ease] };
}
