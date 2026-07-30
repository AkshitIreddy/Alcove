/**
 * Confetti — a tiny, dependency-free canvas-overlay particle burst fired
 * when a to-do is checked (settings.confettiOnComplete && !minimalistMode).
 *
 * ~40 warm-palette paper scraps: an upward burst with gravity, sideways
 * flutter (sine sway) and a paper-flip scaleY wobble. 900 ms, transform-only
 * canvas draws (setTransform/translate/rotate per particle — no per-pixel
 * work), the canvas removes itself when done.
 *
 * The particle math is pure and exported for tests; only burstConfetti()
 * touches the DOM.
 */

export const CONFETTI_COUNT = 40;
export const CONFETTI_DURATION_MS = 900;
/** Gravity in px/ms² (≈ 970 px/s² — reads as fluttering paper, not hail). */
export const CONFETTI_GRAVITY_PX_MS2 = 0.0012;
/** Peak sideways flutter amplitude in px. */
export const CONFETTI_FLUTTER_PX = 14;
/** Fade-out tail at the end of the burst, in ms. */
export const CONFETTI_FADE_MS = 250;

/** Warm paper-scrap palette: token names with baked fallbacks. */
export const CONFETTI_PALETTE: ReadonlyArray<readonly [string, string]> = [
  ['--wash-amber', '#e9c46a'],
  ['--wash-terracotta', '#d99271'],
  ['--wash-lemon', '#ecdc76'],
  ['--wash-blush', '#e4a89f'],
  ['--wash-amber-light', '#f7e7c2'],
  ['--wash-terracotta-light', '#f5dccb'],
];

export interface ConfettiParticle {
  /** Horizontal velocity, px/ms. */
  vx: number;
  /** Vertical velocity, px/ms (negative = upward burst). */
  vy: number;
  /** Scrap width in px. */
  size: number;
  /** Height/width ratio of the scrap. */
  aspect: number;
  /** Index into CONFETTI_PALETTE. */
  colorIndex: number;
  /** Rotation speed, rad/ms. */
  spin: number;
  /** Per-particle phase offset for flutter/flip. */
  phase: number;
  /** Sideways flutter amplitude, px. */
  flutter: number;
}

export interface ConfettiFrame {
  /** Offset from the burst origin, px. */
  x: number;
  y: number;
  /** Rotation in radians. */
  rotation: number;
  /** 1 → 0 over the fade tail. */
  opacity: number;
  /** Paper-flip squash factor (0.35..1). */
  scaleY: number;
}

/**
 * Build the burst. Pure — `rng` is injectable so tests drive it
 * deterministically. Velocities/sizes are bounded so every particle stays
 * on screen for the whole 900 ms.
 */
export function createConfettiParticles(
  count: number = CONFETTI_COUNT,
  rng: () => number = Math.random,
): ConfettiParticle[] {
  const particles: ConfettiParticle[] = [];
  for (let i = 0; i < count; i += 1) {
    particles.push({
      vx: (rng() * 2 - 1) * 0.3,
      vy: -0.16 - rng() * 0.3,
      size: 5 + rng() * 6,
      aspect: 0.55 + rng() * 0.25,
      colorIndex: Math.floor(rng() * CONFETTI_PALETTE.length),
      spin: (rng() * 2 - 1) * 0.008,
      phase: rng() * Math.PI * 2,
      flutter: 4 + rng() * (CONFETTI_FLUTTER_PX - 4),
    });
  }
  return particles;
}

/** Kinematics at time t (ms since the burst). Pure. */
export function particleAt(p: ConfettiParticle, tMs: number): ConfettiFrame {
  const t = Math.max(0, Math.min(CONFETTI_DURATION_MS, tMs));
  const sway =
    Math.sin(t * 0.011 + p.phase) * p.flutter * (t / CONFETTI_DURATION_MS);
  const fadeStart = CONFETTI_DURATION_MS - CONFETTI_FADE_MS;
  return {
    x: p.vx * t + sway,
    y: p.vy * t + 0.5 * CONFETTI_GRAVITY_PX_MS2 * t * t,
    rotation: p.spin * t + p.phase,
    opacity: t <= fadeStart ? 1 : 1 - (t - fadeStart) / CONFETTI_FADE_MS,
    scaleY: 0.35 + 0.65 * Math.abs(Math.cos(t * 0.009 + p.phase)),
  };
}

// ---------------------------------------------------------------------------
// DOM overlay
// ---------------------------------------------------------------------------

function paletteColors(): string[] {
  const styles = getComputedStyle(document.documentElement);
  return CONFETTI_PALETTE.map(([token, fallback]) => {
    const value = styles.getPropertyValue(token).trim();
    return value !== '' ? value : fallback;
  });
}

function motionScale(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--motion-scale')
    .trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 1;
}

export interface ConfettiOrigin {
  /** Viewport coordinates of the burst center (defaults to mid-screen). */
  x?: number;
  y?: number;
}

/**
 * Fire one burst. Fire-and-forget; respects reduced motion (--motion-scale
 * 0 skips entirely). Safe to call outside a browser (no-ops).
 */
export function burstConfetti(origin: ConfettiOrigin = {}): void {
  if (
    typeof document === 'undefined' ||
    typeof requestAnimationFrame !== 'function' ||
    document.body === null ||
    typeof document.createElement !== 'function'
  ) {
    return;
  }
  if (motionScale() <= 0) return;

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (context === null) return;

  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.className = 'nb-confetti-canvas';
  canvas.setAttribute('aria-hidden', 'true');

  const originX = origin.x ?? width / 2;
  const originY = origin.y ?? height / 2;
  const colors = paletteColors();
  const particles = createConfettiParticles();

  document.body.appendChild(canvas);

  let start: number | null = null;
  const frame = (now: number): void => {
    if (start === null) start = now;
    const t = now - start;
    if (t >= CONFETTI_DURATION_MS) {
      canvas.remove();
      return;
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of particles) {
      const state = particleAt(p, t);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.translate(originX + state.x, originY + state.y);
      context.rotate(state.rotation);
      context.scale(1, state.scaleY);
      context.globalAlpha = Math.max(0, state.opacity);
      context.fillStyle = colors[p.colorIndex % colors.length];
      context.fillRect(
        -p.size / 2,
        (-p.size * p.aspect) / 2,
        p.size,
        p.size * p.aspect,
      );
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
