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
 *   - a single live burst: completing several tasks quickly replaces the old
 *     handful instead of building a full-screen particle storm;
 *   - a modest backing-store scale. These are torn-paper shapes, not text, so
 *     four physical pixels per CSS pixel bought cost without useful detail.
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
 * The brief burst is its own arc, not a step on the motion scale. What it does
 * take from the scale is the on/off decision (isMotionOff).
 */
import { isMotionOff } from '../../styles/motion';

/**
 * The optional cue beside a completed task. The visual confetti is deliberately
 * silent: the owner found even the sourced celebration pop cheap, and replacing
 * it with another object would only rename the same problem. A task completed
 * without the burst keeps the quiet ordinary checkbox cue.
 *
 * Kept pure so the silence contract is testable without mounting TipTap, a
 * canvas, or the audio engine.
 */
export function taskCompletionCue(
  visualConfettiWillRun: boolean,
): 'check-done' | null {
  return visualConfettiWillRun ? null : 'check-done';
}

export const CONFETTI_COUNT = 28;
export const CONFETTI_DURATION_MS = 760;
/** Gravity in px/ms² (≈ 1200 px/s² — reads as fluttering paper, not hail). */
export const CONFETTI_GRAVITY_PX_MS2 = 0.0012;
/** Peak sideways flutter amplitude in px. */
export const CONFETTI_FLUTTER_PX = 14;
/** Shortest fade-out tail, in ms; particles stagger their own start. */
export const CONFETTI_FADE_MS = 210;

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

/** Fill a caller-owned frame object so the hot canvas loop allocates nothing. */
function writeParticleFrame(
  p: ConfettiParticle,
  tMs: number,
  out: ConfettiFrame,
): void {
  const t = Math.max(0, Math.min(CONFETTI_DURATION_MS, tMs));
  const progress = t / CONFETTI_DURATION_MS;
  const sway = Math.sin(t * p.swayRate + p.phase) * p.flutter * progress;
  const fadeStart = p.fadeAt * CONFETTI_DURATION_MS;
  const fadeSpan = CONFETTI_DURATION_MS - fadeStart;
  out.x = p.vx * t + sway;
  out.y = p.vy * t + 0.5 * CONFETTI_GRAVITY_PX_MS2 * t * t;
  out.rotation = p.spin * t + p.phase;
  out.opacity = t <= fadeStart ? 1 : Math.max(0, 1 - (t - fadeStart) / fadeSpan);
  out.scaleY = 0.35 + 0.65 * Math.abs(Math.cos(t * p.flipRate + p.phase));
}

/**
 * Build the burst. Pure — `rng` is injectable so tests drive it
 * deterministically. Velocities/sizes are bounded so every particle stays
 * within BURST_REACH of the origin for the whole 760 ms.
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
      fadeAt: 1 - (CONFETTI_FADE_MS + rng() * 190) / CONFETTI_DURATION_MS,
    });
  }
  return particles;
}

/** Kinematics at time t (ms since the burst). Pure. */
export function particleAt(p: ConfettiParticle, tMs: number): ConfettiFrame {
  const out: ConfettiFrame = { x: 0, y: 0, rotation: 0, opacity: 1, scaleY: 1 };
  writeParticleFrame(p, tMs, out);
  return out;
}

// ---------------------------------------------------------------------------
// DOM overlay — one canvas, one loop, bounded footprint
// ---------------------------------------------------------------------------

/**
 * Half-width / half-height of a burst's footprint in CSS px, derived from the
 * bounds `createConfettiParticles` guarantees:
 *   x: |vx|·T + flutter          = 0.3·760 + 14   ≈ 242
 *   y: gravity·T²/2 − |vy|min·T  = 347 − 122      ≈ 225 down, ~90 up
 * Rounded up with room for the biggest rotating ribbon. Anything outside is
 * off-canvas and invisible anyway, which is the point: one normal burst now
 * clears at most ~390k backing pixels instead of ~1.45m on a 2× display.
 */
const BURST_REACH = { left: 305, right: 305, up: 135, down: 275 } as const;

/** One celebration at a time; a rapid completion replaces the previous one. */
const MAX_LIVE_BURSTS = 1;
const MAX_LIVE_PARTICLES = CONFETTI_COUNT;
/** Simple paper scraps stay crisp without a four-pixel-per-CSS-pixel clear. */
const MAX_DPR = 1.25;

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
    context = canvas.getContext('2d', {
      alpha: true,
      // The overlay is transient and never read back. Where supported this
      // lets the browser favour input-to-pixel latency over canvas buffering.
      desynchronized: true,
    });
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
/** Reused by the synchronous frame loop; avoids one short-lived object/scrap/frame. */
const HOT_FRAME: ConfettiFrame = { x: 0, y: 0, rotation: 0, opacity: 1, scaleY: 1 };

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
      writeParticleFrame(p, t, HOT_FRAME);
      const state = HOT_FRAME;
      if (state.opacity <= 0) continue;
      // The old sequence crossed the JS/native canvas boundary four times per
      // scrap (`setTransform`, `translate`, `rotate`, `scale`). This is the
      // exact combined matrix: same pixels and draw order, one call. At the
      // normal 40 scraps it removes 7,200 canvas calls per second at 60 fps.
      const cos = Math.cos(state.rotation);
      const sin = Math.sin(state.rotation);
      ctx.setTransform(
        boxDpr * cos,
        boxDpr * sin,
        -boxDpr * sin * state.scaleY,
        boxDpr * cos * state.scaleY,
        boxDpr * (originX + state.x),
        boxDpr * (originY + state.y),
      );
      ctx.globalAlpha = state.opacity;
      ctx.fillStyle = colors[p.colorIndex % colors.length];
      drawShape(ctx, p);
    }
  }

  ctx.globalAlpha = 1;
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
