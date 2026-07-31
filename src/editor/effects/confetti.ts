/**
 * Confetti — the burst fired when a to-do is checked
 * (settings.confettiOnComplete && !minimalistMode).
 *
 * PERFORMANCE CONTRACT (this used to be a full-viewport canvas per burst,
 * cleared edge to edge every frame, each one a fresh compositing layer over
 * the WebGL shelf):
 *   - ONE canvas for the whole app, reused across bursts and retired when the
 *     last burst ends;
 *   - the canvas is sized to the bursts' own footprint (BURST_REACH), not the
 *     viewport, so a clear costs a few hundred thousand pixels, not millions;
 *   - ONE rAF loop for every live burst;
 *   - no layout or style reads inside the loop — the palette is resolved once
 *     per theme and the geometry once per burst;
 *   - hard caps on both live bursts and live particles.
 *
 * WHAT IT LOOKS LIKE: paper confetti out of the app's own paint box. Four
 * shapes (scrap, ribbon, dot, shard) over the full wash palette plus ink and
 * gilt, each scrap with its own size, spin direction and speed, sway amplitude
 * and frequency, paper-flip rate and fade-out moment — so the burst reads as a
 * handful of torn paper rather than forty copies of one rectangle.
 *
 * The particle math is pure and exported for tests; only burstConfetti()
 * touches the DOM.
 *
 * The 900 ms burst is its own arc, not a step on the motion scale — the scale
 * covers UI travel, and a shortened confetti burst would just look broken.
 * What it does take from the scale is the on/off decision (isMotionOff).
 */
import { isMotionOff } from '../../styles/motion';

export const CONFETTI_COUNT = 40;
export const CONFETTI_DURATION_MS = 900;
/** Gravity in px/ms² (≈ 970 px/s² — reads as fluttering paper, not hail). */
export const CONFETTI_GRAVITY_PX_MS2 = 0.0012;
/** Peak sideways flutter amplitude in px. */
export const CONFETTI_FLUTTER_PX = 14;
/** Shortest fade-out tail, in ms; particles stagger their own start. */
export const CONFETTI_FADE_MS = 250;

/**
 * The app's paint box, not a pastel subset of it: gilt, terracotta, moss,
 * lemon, sky, blush, plum, coral and turquoise, each with a light rung, plus
 * sepia ink so a few scraps read as pencil shavings against the paper. Token
 * names with baked fallbacks (tokens.css is the source of truth; the
 * fallbacks keep the burst honest in a test DOM).
 */
export const CONFETTI_PALETTE: ReadonlyArray<readonly [string, string]> = [
  ['--wash-amber', '#e8b64c'],
  ['--wash-terracotta', '#c96f4a'],
  ['--wash-moss', '#7d915c'],
  ['--wash-lemon', '#dfc451'],
  ['--wash-sky', '#5f7d8c'],
  ['--wash-blush', '#bd7791'],
  ['--wash-plum', '#8a5a72'],
  ['--wash-coral', '#d4674c'],
  ['--wash-turquoise', '#5ea597'],
  ['--wash-violet', '#7c749f'],
  ['--wash-lime', '#a9b45e'],
  // Two pale rungs and one dark one: the burst needs a value range, not just
  // a hue range. Nothing paler than these — on cream paper a *-light wash
  // simply is not there, which is how the old palette earned "bland".
  ['--wash-amber-light', '#f7e6bb'],
  ['--wash-terracotta-light', '#f4d9c8'],
  ['--ink-sepia-soft', '#6b4a32'],
];

/** Scrap silhouettes. Index into this from `ConfettiParticle.shape`. */
export const CONFETTI_SHAPES = ['scrap', 'ribbon', 'dot', 'shard'] as const;
export type ConfettiShape = (typeof CONFETTI_SHAPES)[number];

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
  /** Which silhouette to draw (index into CONFETTI_SHAPES). */
  shape: number;
  /** Extra length along the scrap's long axis — ribbons stretch, dots don't. */
  stretch: number;
  /** Sway rate, rad/ms. Slow scraps drift; fast ones shiver. */
  swayRate: number;
  /** Paper-flip rate, rad/ms — how fast the scrap turns edge-on and back. */
  flipRate: number;
  /** Fraction of the burst that passes before this scrap starts fading. */
  fadeAt: number;
}

export interface ConfettiFrame {
  /** Offset from the burst origin, px. */
  x: number;
  y: number;
  /** Rotation in radians. */
  rotation: number;
  /** 1 → 0 over this particle's own fade tail. */
  opacity: number;
  /** Paper-flip squash factor (0.35..1). */
  scaleY: number;
}

/**
 * Build the burst. Pure — `rng` is injectable so tests drive it
 * deterministically. Velocities/sizes are bounded so every particle stays
 * within BURST_REACH of the origin for the whole 900 ms.
 */
export function createConfettiParticles(
  count: number = CONFETTI_COUNT,
  rng: () => number = Math.random,
): ConfettiParticle[] {
  const particles: ConfettiParticle[] = [];
  for (let i = 0; i < count; i += 1) {
    const shape = Math.floor(rng() * CONFETTI_SHAPES.length);
    // Spin is signed and its MAGNITUDE is drawn separately, so the burst has
    // lazy tumblers next to scraps whipping round — a uniform ±range gives
    // every particle roughly the same visible speed.
    const spinSign = rng() < 0.5 ? -1 : 1;
    const spinMagnitude = 0.0012 + rng() * rng() * 0.0068;
    particles.push({
      vx: (rng() * 2 - 1) * 0.3,
      vy: -0.16 - rng() * 0.3,
      size: 5 + rng() * 6,
      aspect: 0.55 + rng() * 0.25,
      colorIndex: Math.floor(rng() * CONFETTI_PALETTE.length),
      spin: spinSign * spinMagnitude,
      phase: rng() * Math.PI * 2,
      flutter: 4 + rng() * (CONFETTI_FLUTTER_PX - 4),
      shape,
      // Ribbons are the long ones; everything else stays roughly as wide as
      // it is tall, so a scrap reads as a torn square rather than a dash.
      stretch: shape === 1 ? 2.1 + rng() * 1.5 : 0.62 + rng() * 0.34,
      swayRate: 0.006 + rng() * 0.012,
      flipRate: 0.004 + rng() * 0.011,
      // Staggered so the burst thins out instead of switching off at once.
      // CONFETTI_FADE_MS is the SHORTEST tail; the longest is roughly double.
      fadeAt: 1 - (CONFETTI_FADE_MS + rng() * 240) / CONFETTI_DURATION_MS,
    });
  }
  return particles;
}

/** Kinematics at time t (ms since the burst). Pure. */
export function particleAt(p: ConfettiParticle, tMs: number): ConfettiFrame {
  const t = Math.max(0, Math.min(CONFETTI_DURATION_MS, tMs));
  const progress = t / CONFETTI_DURATION_MS;
  // Amplitude ramps with progress so every scrap leaves the origin exactly at
  // the origin, and the sway never exceeds `flutter` off the ballistic path.
  const sway = Math.sin(t * p.swayRate + p.phase) * p.flutter * progress;
  const fadeStart = p.fadeAt * CONFETTI_DURATION_MS;
  const fadeSpan = CONFETTI_DURATION_MS - fadeStart;
  return {
    x: p.vx * t + sway,
    y: p.vy * t + 0.5 * CONFETTI_GRAVITY_PX_MS2 * t * t,
    rotation: p.spin * t + p.phase,
    opacity: t <= fadeStart ? 1 : Math.max(0, 1 - (t - fadeStart) / fadeSpan),
    scaleY: 0.35 + 0.65 * Math.abs(Math.cos(t * p.flipRate + p.phase)),
  };
}

// ---------------------------------------------------------------------------
// DOM overlay — one canvas, one loop, bounded footprint
// ---------------------------------------------------------------------------

/**
 * Half-width / half-height of a burst's footprint in CSS px, derived from the
 * bounds `createConfettiParticles` guarantees:
 *   x: |vx|·T + flutter          = 0.3·900 + 14   ≈ 284
 *   y: gravity·T²/2 − |vy|min·T  = 486 − 144      ≈ 342 down, ~90 up
 * Rounded up with room for the biggest scrap (a 3.6× ribbon at DRAW_SCALE is
 * ~40 px on its long axis, so ~20 px of slack each way). Anything outside is
 * off-canvas and invisible anyway, which is the point — this is what keeps
 * the clear cheap: ~28% of the viewport instead of all of it.
 */
const BURST_REACH = { left: 330, right: 330, up: 150, down: 400 } as const;

/** Never composite more than this, however fast the user ticks boxes. */
const MAX_LIVE_BURSTS = 4;
const MAX_LIVE_PARTICLES = 160;
/** Retina is worth it; 3× on a decorative burst is not. */
const MAX_DPR = 2;

interface Burst {
  readonly particles: ConfettiParticle[];
  /** Burst origin in CSS px, viewport coordinates. */
  readonly x: number;
  readonly y: number;
  start: number;
}

let canvas: HTMLCanvasElement | null = null;
let context: CanvasRenderingContext2D | null = null;
let frameId: number | null = null;
let bursts: Burst[] = [];
/** Canvas box in viewport CSS px — particles draw relative to this. */
let boxLeft = 0;
let boxTop = 0;
let boxWidth = 0;
let boxHeight = 0;
let boxDpr = 1;

let paletteCache: string[] | null = null;
let paletteKey = '';

/**
 * Resolve the palette against the live theme ONCE, keyed on the root's class
 * list and theme attribute (both of which is how a theme swap announces
 * itself). getComputedStyle is a style-recalc trigger and has no business
 * running per burst, let alone per particle.
 */
function paletteColors(): string[] {
  const root = document.documentElement;
  const key = `${root.className}|${root.getAttribute('data-theme') ?? ''}`;
  if (paletteCache !== null && key === paletteKey) return paletteCache;
  const styles = getComputedStyle(root);
  paletteCache = CONFETTI_PALETTE.map(([token, fallback]) => {
    const value = styles.getPropertyValue(token).trim();
    return value !== '' ? value : fallback;
  });
  paletteKey = key;
  return paletteCache;
}

export interface ConfettiOrigin {
  /** Viewport coordinates of the burst center (defaults to mid-screen). */
  x?: number;
  y?: number;
}

/** Union footprint of every live burst, clamped to the viewport. */
function measureBox(): void {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const burst of bursts) {
    if (burst.x - BURST_REACH.left < left) left = burst.x - BURST_REACH.left;
    if (burst.y - BURST_REACH.up < top) top = burst.y - BURST_REACH.up;
    if (burst.x + BURST_REACH.right > right) right = burst.x + BURST_REACH.right;
    if (burst.y + BURST_REACH.down > bottom) bottom = burst.y + BURST_REACH.down;
  }
  boxLeft = Math.max(0, Math.floor(left));
  boxTop = Math.max(0, Math.floor(top));
  boxWidth = Math.max(1, Math.ceil(Math.min(window.innerWidth, right)) - boxLeft);
  boxHeight = Math.max(1, Math.ceil(Math.min(window.innerHeight, bottom)) - boxTop);
}

function ensureCanvas(): boolean {
  if (canvas === null) {
    canvas = document.createElement('canvas');
    canvas.className = 'nb-confetti-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    context = canvas.getContext('2d');
    if (context === null) {
      canvas = null;
      return false;
    }
    document.body.appendChild(canvas);
  }
  boxDpr = Math.min(MAX_DPR, Math.max(1, window.devicePixelRatio || 1));
  const pixelWidth = Math.round(boxWidth * boxDpr);
  const pixelHeight = Math.round(boxHeight * boxDpr);
  // Assigning width/height also clears the canvas, so only do it on a change.
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  canvas.style.left = `${boxLeft}px`;
  canvas.style.top = `${boxTop}px`;
  canvas.style.width = `${boxWidth}px`;
  canvas.style.height = `${boxHeight}px`;
  return true;
}

/** Tear the overlay down completely — no idle canvas left composited. */
function teardown(): void {
  if (frameId !== null) {
    cancelAnimationFrame(frameId);
    frameId = null;
  }
  bursts = [];
  canvas?.remove();
  canvas = null;
  context = null;
}

/**
 * `size`/`aspect` are physics bounds (5..11 px, 0.55..0.8) and stay that way;
 * this is the ink scale that turns them into scraps you can see across a room
 * at 20px body text. Drawing them at their raw numbers is what made the old
 * burst read as dust.
 */
const DRAW_SCALE = 2.1;

function drawShape(ctx: CanvasRenderingContext2D, p: ConfettiParticle): void {
  const long = p.size * p.stretch * DRAW_SCALE;
  const short = p.size * p.aspect * DRAW_SCALE;
  switch (CONFETTI_SHAPES[p.shape] ?? 'scrap') {
    case 'ribbon':
      ctx.fillRect(-long / 2, -short * 0.32, long, short * 0.64);
      break;
    case 'dot':
      ctx.beginPath();
      ctx.arc(0, 0, short * 0.54, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'shard':
      // A torn triangle — the one silhouette with a point on it.
      ctx.beginPath();
      ctx.moveTo(-long / 2, short * 0.6);
      ctx.lineTo(0, -short * 0.85);
      ctx.lineTo(long / 2, short * 0.3);
      ctx.closePath();
      ctx.fill();
      break;
    default:
      ctx.fillRect(-long / 2, -short / 2, long, short);
  }
}

function frame(now: number): void {
  if (context === null || canvas === null) {
    teardown();
    return;
  }
  // Retire finished bursts BEFORE drawing: shrinking the box resizes (and so
  // clears) the canvas, and doing that after a draw would blank one frame.
  const wasLive = bursts.length;
  bursts = bursts.filter(
    (burst) => burst.start === 0 || now - burst.start < CONFETTI_DURATION_MS,
  );
  if (bursts.length === 0) {
    teardown();
    return;
  }
  if (bursts.length !== wasLive) {
    measureBox();
    // A failure here can only mean the context is gone; teardown, never a
    // bare return — that would leave frameId set and the loop unrestartable.
    if (!ensureCanvas()) {
      teardown();
      return;
    }
  }

  const ctx = context;
  const colors = paletteColors();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const burst of bursts) {
    if (burst.start === 0) burst.start = now;
    const t = now - burst.start;
    const originX = burst.x - boxLeft;
    const originY = burst.y - boxTop;
    for (const p of burst.particles) {
      const state = particleAt(p, t);
      if (state.opacity <= 0) continue;
      ctx.setTransform(boxDpr, 0, 0, boxDpr, 0, 0);
      ctx.translate(originX + state.x, originY + state.y);
      ctx.rotate(state.rotation);
      ctx.scale(1, state.scaleY);
      ctx.globalAlpha = state.opacity;
      ctx.fillStyle = colors[p.colorIndex % colors.length];
      drawShape(ctx, p);
    }
  }

  frameId = requestAnimationFrame(frame);
}

/**
 * Fire one burst. Fire-and-forget; decorative, so reduced motion skips it
 * entirely rather than playing it fast. Safe to call outside a browser.
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
  if (isMotionOff()) return;

  // Budget: never let a run of ticked checkboxes stack overlays.
  if (bursts.length >= MAX_LIVE_BURSTS) bursts.shift();
  const spent = bursts.reduce((sum, burst) => sum + burst.particles.length, 0);
  const count = Math.max(
    8,
    Math.min(CONFETTI_COUNT, MAX_LIVE_PARTICLES - spent),
  );

  bursts.push({
    particles: createConfettiParticles(count),
    x: origin.x ?? window.innerWidth / 2,
    y: origin.y ?? window.innerHeight / 2,
    // Stamped on the first frame: `now` there is the same clock the loop uses,
    // and performance.now() here would already be a frame stale.
    start: 0,
  });

  measureBox();
  if (!ensureCanvas()) {
    teardown();
    return;
  }
  if (frameId === null) frameId = requestAnimationFrame(frame);
}
