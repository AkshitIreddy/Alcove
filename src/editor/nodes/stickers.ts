/**
 * Procedural hand-drawn stickers — a 50-strong sheet of little SVG friends,
 * rendered inline.
 *
 * Pure string generation, deterministic per sticker id (seeded wobble), no
 * runtime SVG filters (CLAUDE.md: filters are bake-only). The wobble comes
 * from jittered control points + round strokes, which reads as pencil-drawn
 * without any feTurbulence. Colors are CSS custom properties so stickers
 * follow the token palette (inline SVG inherits page CSS variables).
 *
 * The sheet is ordered the way a sticker sheet is printed — by drawer, not
 * alphabetically — because that is the order a reader browses it in. Every
 * entry earns its place by SILHOUETTE: two stickers that read the same at
 * 20px are one sticker, however different their insides are. That is the rule
 * that kept `mountain` (a pine tree with the branches rubbed off) and `shell`
 * (a snail with no snail) off the sheet.
 *
 * `STICKER_TAGS` is the mood row — the same idea as `BUILD_TAGS` in
 * art/shelfDesign.ts. It feeds the slash menu's and the catalogue's keyword
 * search, so "study" finds the microscope and "well done" finds the tick.
 */

export const STICKER_IDS = [
  /* --- the original eight, still the first row of the sheet -------------- */
  'star',
  'bee',
  'leaf',
  'heart',
  'sparkle',
  'cat',
  'sun',
  'flower',
  /* --- garden & ground --------------------------------------------------- */
  'clover',
  'mushroom',
  'acorn',
  'pine',
  'cactus',
  'feather',
  'wave',
  'rainbow',
  /* --- sky & weather ----------------------------------------------------- */
  'moon',
  'cloud',
  'raindrop',
  'snowflake',
  'bolt',
  /* --- small creatures --------------------------------------------------- */
  'bird',
  'fish',
  'butterfly',
  'snail',
  'whale',
  'fox',
  /* --- the desk ---------------------------------------------------------- */
  'book',
  'pencil',
  'microscope',
  'bulb',
  'clip',
  'pin',
  'ruler',
  'flask',
  'atom',
  /* --- the kitchen ------------------------------------------------------- */
  'coffee',
  'teapot',
  'cake',
  'apple',
  'cherry',
  /* --- marks & keepsakes ------------------------------------------------- */
  'music',
  'arrow',
  'check',
  'key',
  'crown',
  'gift',
  'ticket',
  'compass',
  'globe',
] as const;

export type BuiltinStickerId = (typeof STICKER_IDS)[number];

/**
 * The drawers, in sheet order. A picker that shows fifty stickers in one
 * undifferentiated grid is a worse picker than one that shows six drawers.
 */
export interface StickerFamily {
  readonly id: string;
  /** Shown as the drawer heading. Lowercase, a stationer's words. */
  readonly label: string;
  readonly ids: readonly BuiltinStickerId[];
}

export const STICKER_FAMILIES: readonly StickerFamily[] = [
  {
    id: 'favourites',
    label: 'the usual eight',
    ids: ['star', 'bee', 'leaf', 'heart', 'sparkle', 'cat', 'sun', 'flower'],
  },
  {
    id: 'garden',
    label: 'garden & ground',
    ids: ['clover', 'mushroom', 'acorn', 'pine', 'cactus', 'feather', 'wave', 'rainbow'],
  },
  {
    id: 'weather',
    label: 'sky & weather',
    ids: ['moon', 'cloud', 'raindrop', 'snowflake', 'bolt'],
  },
  {
    id: 'creatures',
    label: 'small creatures',
    ids: ['bird', 'fish', 'butterfly', 'snail', 'whale', 'fox'],
  },
  {
    id: 'desk',
    label: 'the desk',
    ids: ['book', 'pencil', 'microscope', 'bulb', 'clip', 'pin', 'ruler', 'flask', 'atom'],
  },
  { id: 'kitchen', label: 'the kitchen', ids: ['coffee', 'teapot', 'cake', 'apple', 'cherry'] },
  {
    id: 'marks',
    label: 'marks & keepsakes',
    ids: ['music', 'arrow', 'check', 'key', 'crown', 'gift', 'ticket', 'compass', 'globe'],
  },
];

/**
 * What each sticker is FOR, in the words someone would search with. Three to
 * five per sticker: the thing itself is already the label, so these are the
 * *occasions* — "revision" on the flask, "well done" on the tick.
 */
export const STICKER_TAGS: Record<BuiltinStickerId, readonly string[]> = {
  star: ['favourite', 'gold star', 'top marks', 'pick'],
  bee: ['busy', 'nature', 'pollination', 'spring'],
  leaf: ['biology', 'autumn', 'growth', 'plant'],
  heart: ['loved', 'care', 'kind', 'valentine'],
  sparkle: ['idea', 'magic', 'nice result', 'shiny'],
  cat: ['pet', 'comfort', 'a break', 'nap'],
  sun: ['morning', 'energy', 'weather', 'summer'],
  flower: ['bloom', 'botany', 'cheerful', 'spring'],
  clover: ['luck', 'wish', 'irish', 'fortune'],
  mushroom: ['fungi', 'forest', 'foraging', 'damp'],
  acorn: ['autumn', 'small beginnings', 'oak', 'saving'],
  pine: ['forest', 'winter', 'christmas', 'camping'],
  cactus: ['desert', 'hardy', 'prickly', 'houseplant'],
  feather: ['light', 'writing', 'bird', 'quill'],
  wave: ['sea', 'swim', 'holiday', 'tide'],
  rainbow: ['after the rain', 'hope', 'colour', 'pride'],
  moon: ['night', 'sleep', 'phases', 'ending'],
  cloud: ['weather', 'daydream', 'vague', 'overcast'],
  raindrop: ['rain', 'water', 'wet', 'tear'],
  snowflake: ['winter', 'cold', 'unique', 'snow'],
  bolt: ['fast', 'energy', 'urgent', 'power'],
  bird: ['song', 'spring', 'migration', 'flight'],
  fish: ['sea', 'aquarium', 'friday', 'swim'],
  butterfly: ['change', 'metamorphosis', 'summer', 'delicate'],
  snail: ['slow', 'patience', 'no rush', 'garden'],
  whale: ['big', 'ocean', 'deep', 'gentle'],
  fox: ['clever', 'woodland', 'sly', 'autumn'],
  book: ['reading list', 'reference', 'homework', 'library'],
  pencil: ['draft', 'note to self', 'edit', 'sketch'],
  microscope: ['lab', 'close reading', 'science', 'detail'],
  bulb: ['idea', 'insight', 'invention', 'aha'],
  clip: ['attached', 'see also', 'together', 'paperclip'],
  pin: ['pinned', 'do not lose', 'reminder', 'important'],
  ruler: ['measure', 'exact', 'geometry', 'plan'],
  flask: ['experiment', 'chemistry', 'revision', 'test'],
  atom: ['physics', 'science', 'element', 'tiny'],
  coffee: ['study break', 'morning', 'long session', 'caffeine'],
  teapot: ['tea', 'calm', 'afternoon', 'brew'],
  cake: ['birthday', 'celebrate', 'treat', 'party'],
  apple: ['school', 'healthy', 'teacher', 'autumn'],
  cherry: ['sweet', 'summer', 'pair', 'fruit'],
  music: ['song', 'practice', 'rhythm', 'playlist'],
  arrow: ['see this', 'next', 'pointer', 'follow'],
  check: ['done', 'well done', 'correct', 'tick'],
  key: ['the key point', 'unlock', 'password', 'access'],
  crown: ['best', 'winner', 'royal', 'first'],
  gift: ['present', 'birthday', 'surprise', 'thanks'],
  ticket: ['event', 'admit one', 'booking', 'travel'],
  compass: ['direction', 'plan', 'north', 'find your way'],
  globe: ['world', 'geography', 'travel', 'everywhere'],
};

/**
 * Wave 2 (custom stickers): user-imported stickers live in the `user:`
 * namespace. A StickerId is either one of the 50 built-ins or `user:<name>`;
 * everything downstream (sticker node, palette, script vocab) accepts both.
 */
export type UserStickerId = `user:${string}`;

export type StickerId = BuiltinStickerId | UserStickerId;

/** True for ids in the user namespace (`user:<name>`, name non-empty). */
export function isUserStickerId(value: unknown): value is UserStickerId {
  return (
    typeof value === 'string' &&
    value.startsWith('user:') &&
    value.length > 'user:'.length
  );
}

export function isStickerId(value: unknown): value is StickerId {
  return (
    (typeof value === 'string' &&
      (STICKER_IDS as readonly string[]).includes(value)) ||
    isUserStickerId(value)
  );
}

// ---------------------------------------------------------------------------
// User sticker registry (wave 2, item 27)
//
// Imported PNG/SVG stickers are persisted as image assets (assets table +
// app-data files); this in-memory registry maps `user:<name>` → displayable
// src for the current session. Hydrated at startup from the assets table by
// src/features/templates/userStickers.ts.
// ---------------------------------------------------------------------------

export interface UserStickerRecord {
  /** Full sticker id, e.g. `user:bunny`. */
  id: UserStickerId;
  /** Bare name (lowercase, [a-z0-9-]), e.g. `bunny`. */
  name: string;
  /** Displayable image src (asset protocol URL / object URL / data URI). */
  src: string;
}

const userStickerRegistry = new Map<string, UserStickerRecord>();
const userStickerListeners = new Set<() => void>();

/** Normalize a raw name into the sticker-name alphabet (may return ''). */
export function sanitizeStickerName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

/**
 * Register (or refresh) a user sticker for this session. Returns its full
 * id. Notifies palette listeners.
 */
export function registerUserSticker(name: string, src: string): UserStickerId {
  const clean = sanitizeStickerName(name) || 'sticker';
  const id: UserStickerId = `user:${clean}`;
  userStickerRegistry.set(id, { id, name: clean, src });
  for (const listener of userStickerListeners) listener();
  return id;
}

/** All registered user stickers, insertion-ordered. */
export function listUserStickers(): UserStickerRecord[] {
  return [...userStickerRegistry.values()];
}

/** Displayable src for a user sticker id, or null when unregistered. */
export function userStickerSrc(id: string): string | null {
  return userStickerRegistry.get(id)?.src ?? null;
}

/** Subscribe to registry changes (palette refresh). Returns unsubscribe. */
export function onUserStickersChange(listener: () => void): () => void {
  userStickerListeners.add(listener);
  return () => userStickerListeners.delete(listener);
}

// ---------------------------------------------------------------------------
// Seeded wobble helpers (self-contained on purpose — the editor must not
// depend on src/art internals)
// ---------------------------------------------------------------------------

type Rng = () => number;

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Pt {
  x: number;
  y: number;
}

function n2(v: number): string {
  return (Math.round(v * 100) / 100).toString();
}

function jitterPoints(points: readonly Pt[], rng: Rng, amp: number): Pt[] {
  return points.map((p) => ({
    x: p.x + (rng() - 0.5) * 2 * amp,
    y: p.y + (rng() - 0.5) * 2 * amp,
  }));
}

/**
 * Closed wobbly outline: jittered vertices joined with quadratic curves
 * through midpoints — the classic "confident but human" pencil line.
 */
function wobblyLoop(points: readonly Pt[], rng: Rng, amp = 0.7): string {
  const pts = jitterPoints(points, rng, amp);
  const count = pts.length;
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const start = mid(pts[count - 1], pts[0]);
  let d = `M ${n2(start.x)} ${n2(start.y)}`;
  for (let i = 0; i < count; i += 1) {
    const control = pts[i];
    const end = mid(control, pts[(i + 1) % count]);
    d += ` Q ${n2(control.x)} ${n2(control.y)} ${n2(end.x)} ${n2(end.y)}`;
  }
  return `${d} Z`;
}

/** Open wobbly stroke through the given points. */
function wobblyStroke(points: readonly Pt[], rng: Rng, amp = 0.6): string {
  const pts = jitterPoints(points, rng, amp);
  let d = `M ${n2(pts[0].x)} ${n2(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const control = pts[i];
    const end = {
      x: (pts[i].x + pts[i + 1].x) / 2,
      y: (pts[i].y + pts[i + 1].y) / 2,
    };
    d += ` Q ${n2(control.x)} ${n2(control.y)} ${n2(end.x)} ${n2(end.y)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${n2(last.x)} ${n2(last.y)}`;
  return d;
}

function ring(cx: number, cy: number, r: number, segments: number, rotate = 0): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a = rotate + (i / segments) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

function starPoints(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  spikes: number,
  rotate = -Math.PI / 2,
): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < spikes * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rotate + (i / (spikes * 2)) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

/** `pts([16,3, 24,9])` → `[{x:16,y:3},{x:24,y:9}]`. Keeps outlines readable. */
function pts(flat: readonly number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
}

/** An ellipse as a point ring, optionally rotated about its own centre. */
function ell(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  segments = 10,
  rotate = 0,
): Pt[] {
  const cos = Math.cos(rotate);
  const sin = Math.sin(rotate);
  const out: Pt[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    out.push({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos });
  }
  return out;
}

/** A rectangle as an 8-point ring, so `wobblyLoop` rounds its corners. */
function boxPts(x: number, y: number, w: number, h: number): Pt[] {
  return pts([
    x, y,
    x + w / 2, y,
    x + w, y,
    x + w, y + h / 2,
    x + w, y + h,
    x + w / 2, y + h,
    x, y + h,
    x, y + h / 2,
  ]);
}

/** An open arc as a stroke path (angles in radians, clockwise). */
function arcPts(
  cx: number,
  cy: number,
  r: number,
  from: number,
  to: number,
  segments = 8,
): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const a = from + ((to - from) * i) / segments;
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return out;
}

const STROKE = 'stroke-linecap="round" stroke-linejoin="round"';

function path(
  d: string,
  fill: string,
  stroke: string,
  width = 1.6,
): string {
  return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" ${STROKE}/>`;
}

function svg(body: string, label: string): string {
  return (
    `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" ` +
    `role="img" aria-label="${label}" class="nb-sticker-art">${body}</svg>`
  );
}

// ---------------------------------------------------------------------------
// The eight stickers
// ---------------------------------------------------------------------------

function drawStar(rng: Rng): string {
  const body = path(
    wobblyLoop(starPoints(16, 16.5, 13, 5.6, 5), rng, 0.8),
    'var(--wash-amber)',
    'var(--wash-amber-deep)',
  );
  return svg(body, 'star sticker');
}

function drawBee(rng: Rng): string {
  const wingL = path(
    wobblyLoop(ring(10.5, 8, 4.6, 8), rng, 0.5),
    'var(--wash-sky-light)',
    'var(--ink-graphite-soft)',
    1.2,
  );
  const wingR = path(
    wobblyLoop(ring(21.5, 8, 4.6, 8), rng, 0.5),
    'var(--wash-sky-light)',
    'var(--ink-graphite-soft)',
    1.2,
  );
  // Plump oval body.
  const bodyPts: Pt[] = [];
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    bodyPts.push({ x: 16 + Math.cos(a) * 9.5, y: 19 + Math.sin(a) * 7 });
  }
  const body = path(
    wobblyLoop(bodyPts, rng, 0.55),
    'var(--wash-amber)',
    'var(--ink-graphite)',
  );
  const stripe1 = path(
    wobblyStroke([{ x: 12, y: 12.6 }, { x: 11.4, y: 19 }, { x: 12.2, y: 25.2 }], rng, 0.4),
    'none',
    'var(--ink-graphite)',
    1.8,
  );
  const stripe2 = path(
    wobblyStroke([{ x: 17.6, y: 12.2 }, { x: 17.2, y: 19 }, { x: 17.8, y: 25.6 }], rng, 0.4),
    'none',
    'var(--ink-graphite)',
    1.8,
  );
  const smile = path(
    wobblyStroke([{ x: 22.4, y: 19.6 }, { x: 23.6, y: 20.6 }, { x: 24.8, y: 19.8 }], rng, 0.25),
    'none',
    'var(--ink-graphite)',
    1.2,
  );
  return svg(wingL + wingR + body + stripe1 + stripe2 + smile, 'bee sticker');
}

function drawLeaf(rng: Rng): string {
  const outline: Pt[] = [
    { x: 16, y: 3.5 },
    { x: 23.5, y: 8.5 },
    { x: 26, y: 17 },
    { x: 21.5, y: 24.5 },
    { x: 16, y: 28.5 },
    { x: 10.5, y: 24.5 },
    { x: 6, y: 17 },
    { x: 8.5, y: 8.5 },
  ];
  const blade = path(
    wobblyLoop(outline, rng, 0.9),
    'var(--wash-moss-light)',
    'var(--wash-moss-deep)',
  );
  const vein = path(
    wobblyStroke(
      [
        { x: 16, y: 5.5 },
        { x: 15.6, y: 12 },
        { x: 16.3, y: 20 },
        { x: 16, y: 27 },
      ],
      rng,
      0.45,
    ),
    'none',
    'var(--wash-moss-deep)',
    1.3,
  );
  const rib1 = path(
    wobblyStroke([{ x: 15.8, y: 12.5 }, { x: 12, y: 15 }, { x: 9.6, y: 17.5 }], rng, 0.4),
    'none',
    'var(--wash-moss-deep)',
    1.1,
  );
  const rib2 = path(
    wobblyStroke([{ x: 16.1, y: 16.5 }, { x: 19.8, y: 18.6 }, { x: 22.3, y: 20.4 }], rng, 0.4),
    'none',
    'var(--wash-moss-deep)',
    1.1,
  );
  return svg(blade + vein + rib1 + rib2, 'leaf sticker');
}

function drawHeart(rng: Rng): string {
  const outline: Pt[] = [
    { x: 16, y: 10 },
    { x: 12.5, y: 5.5 },
    { x: 7.5, y: 5.5 },
    { x: 4.5, y: 10.5 },
    { x: 6, y: 16.5 },
    { x: 11, y: 22 },
    { x: 16, y: 27.5 },
    { x: 21, y: 22 },
    { x: 26, y: 16.5 },
    { x: 27.5, y: 10.5 },
    { x: 24.5, y: 5.5 },
    { x: 19.5, y: 5.5 },
  ];
  const body = path(
    wobblyLoop(outline, rng, 0.8),
    'var(--wash-blush)',
    'var(--wash-blush-deep)',
  );
  const shine = path(
    wobblyStroke([{ x: 8.6, y: 9.4 }, { x: 8, y: 11.2 }, { x: 8.7, y: 13.2 }], rng, 0.3),
    'none',
    'var(--wash-blush-light)',
    1.6,
  );
  return svg(body + shine, 'heart sticker');
}

function drawSparkle(rng: Rng): string {
  // Four-point twinkle: long vertical, shorter horizontal, concave sides.
  const big = path(
    wobblyLoop(starPoints(15, 17, 12, 3.4, 4, 0), rng, 0.6),
    'var(--wash-lemon)',
    'var(--wash-amber-deep)',
    1.4,
  );
  const small = path(
    wobblyLoop(starPoints(25, 7, 4.4, 1.5, 4, 0), rng, 0.4),
    'var(--wash-lemon-light)',
    'var(--wash-amber-deep)',
    1.1,
  );
  return svg(big + small, 'sparkle sticker');
}

function drawCat(rng: Rng): string {
  const head: Pt[] = [
    { x: 6.5, y: 6 }, // left ear tip
    { x: 11, y: 9.5 },
    { x: 16, y: 8.6 },
    { x: 21, y: 9.5 },
    { x: 25.5, y: 6 }, // right ear tip
    { x: 26.5, y: 13.5 },
    { x: 27, y: 19 },
    { x: 22.5, y: 25 },
    { x: 16, y: 27 },
    { x: 9.5, y: 25 },
    { x: 5, y: 19 },
    { x: 5.5, y: 13.5 },
  ];
  const face = path(
    wobblyLoop(head, rng, 0.7),
    'var(--paper-cream)',
    'var(--ink-graphite)',
  );
  const eyeL = `<circle cx="12" cy="17" r="1.15" fill="var(--ink-graphite)"/>`;
  const eyeR = `<circle cx="20" cy="17" r="1.15" fill="var(--ink-graphite)"/>`;
  const nose = path(
    wobblyLoop(
      [
        { x: 16, y: 19.4 },
        { x: 17.2, y: 20.2 },
        { x: 16, y: 21.2 },
        { x: 14.8, y: 20.2 },
      ],
      rng,
      0.2,
    ),
    'var(--wash-blush)',
    'var(--wash-blush-deep)',
    0.9,
  );
  const whiskers =
    path(
      wobblyStroke([{ x: 9.4, y: 20 }, { x: 6.4, y: 19.4 }, { x: 3.8, y: 18.6 }], rng, 0.3),
      'none',
      'var(--ink-graphite-soft)',
      1,
    ) +
    path(
      wobblyStroke([{ x: 9.4, y: 21.8 }, { x: 6.6, y: 22 }, { x: 4, y: 22.4 }], rng, 0.3),
      'none',
      'var(--ink-graphite-soft)',
      1,
    ) +
    path(
      wobblyStroke([{ x: 22.6, y: 20 }, { x: 25.6, y: 19.4 }, { x: 28.2, y: 18.6 }], rng, 0.3),
      'none',
      'var(--ink-graphite-soft)',
      1,
    ) +
    path(
      wobblyStroke([{ x: 22.6, y: 21.8 }, { x: 25.4, y: 22 }, { x: 28, y: 22.4 }], rng, 0.3),
      'none',
      'var(--ink-graphite-soft)',
      1,
    );
  return svg(face + eyeL + eyeR + nose + whiskers, 'cat sticker');
}

function drawSun(rng: Rng): string {
  let rays = '';
  const rayCount = 9;
  for (let i = 0; i < rayCount; i += 1) {
    const a = (i / rayCount) * Math.PI * 2 + 0.3;
    const from = {
      x: 16 + Math.cos(a) * 9.6,
      y: 16 + Math.sin(a) * 9.6,
    };
    const to = {
      x: 16 + Math.cos(a) * 14.2,
      y: 16 + Math.sin(a) * 14.2,
    };
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    rays += path(
      wobblyStroke([from, mid, to], rng, 0.4),
      'none',
      'var(--wash-amber-deep)',
      1.5,
    );
  }
  const disc = path(
    wobblyLoop(ring(16, 16, 7.6, 10), rng, 0.5),
    'var(--wash-lemon)',
    'var(--wash-amber-deep)',
  );
  const smile = path(
    wobblyStroke([{ x: 13, y: 17.8 }, { x: 16, y: 19.6 }, { x: 19, y: 17.8 }], rng, 0.25),
    'none',
    'var(--wash-amber-deep)',
    1.2,
  );
  return svg(rays + disc + smile, 'sun sticker');
}

function drawFlower(rng: Rng): string {
  let petals = '';
  const petalCount = 6;
  for (let i = 0; i < petalCount; i += 1) {
    const a = (i / petalCount) * Math.PI * 2 - Math.PI / 2;
    const cx = 16 + Math.cos(a) * 7.8;
    const cy = 15.4 + Math.sin(a) * 7.8;
    // Petal: oval pointing outward.
    const pts = ring(0, 0, 1, 8).map((_, j) => {
      const t = (j / 8) * Math.PI * 2;
      const rx = 5.2;
      const ry = 3.6;
      const x = Math.cos(t) * rx;
      const y = Math.sin(t) * ry;
      return {
        x: cx + x * Math.cos(a) - y * Math.sin(a),
        y: cy + x * Math.sin(a) + y * Math.cos(a),
      };
    });
    petals += path(
      wobblyLoop(pts, rng, 0.5),
      'var(--wash-blush-light)',
      'var(--wash-blush-deep)',
      1.2,
    );
  }
  const center = path(
    wobblyLoop(ring(16, 15.4, 4, 9), rng, 0.4),
    'var(--wash-amber)',
    'var(--wash-amber-deep)',
    1.3,
  );
  const stemDot = path(
    wobblyStroke([{ x: 16, y: 24.4 }, { x: 15.7, y: 27 }, { x: 16.2, y: 29 }], rng, 0.3),
    'none',
    'var(--wash-moss-deep)',
    1.5,
  );
  return svg(petals + center + stemDot, 'flower sticker');
}

// ---------------------------------------------------------------------------
// The other forty-two
//
// Same three moves as the eight above — a wobbly filled loop for the mass, a
// wobbly stroke for the lines, a plain circle for anything smaller than the
// wobble amplitude (jitter on a 1px dot is just a misplaced dot). Colours are
// tokens only, one darker outline per shape, and nothing here implies a light
// source: the "shine" on the old heart is a drawn pencil mark, not a specular,
// and none of these add a second one.
// ---------------------------------------------------------------------------

/** Token shorthands. Keeps a drawing to its shape rather than its strings. */
const T = {
  cream: 'var(--paper-cream)',
  aged: 'var(--paper-aged)',
  edge: 'var(--paper-edge)',
  ink: 'var(--ink-line)',
  inkSoft: 'var(--ink-line-soft)',
  graphite: 'var(--ink-graphite)',
  graphiteSoft: 'var(--ink-graphite-soft)',
  sepia: 'var(--ink-sepia)',
  amberL: 'var(--wash-amber-light)',
  amber: 'var(--wash-amber)',
  amberD: 'var(--wash-amber-deep)',
  terraL: 'var(--wash-terracotta-light)',
  terra: 'var(--wash-terracotta)',
  terraD: 'var(--wash-terracotta-deep)',
  mossL: 'var(--wash-moss-light)',
  moss: 'var(--wash-moss)',
  mossD: 'var(--wash-moss-deep)',
  lemonL: 'var(--wash-lemon-light)',
  lemon: 'var(--wash-lemon)',
  lemonD: 'var(--wash-lemon-deep)',
  skyL: 'var(--wash-sky-light)',
  sky: 'var(--wash-sky)',
  skyD: 'var(--wash-sky-deep)',
  blushL: 'var(--wash-blush-light)',
  blush: 'var(--wash-blush)',
  blushD: 'var(--wash-blush-deep)',
  plumL: 'var(--wash-plum-light)',
  plum: 'var(--wash-plum)',
  plumD: 'var(--wash-plum-deep)',
  coralL: 'var(--wash-coral-light)',
  coral: 'var(--wash-coral)',
  coralD: 'var(--wash-coral-deep)',
  turqL: 'var(--wash-turquoise-light)',
  turq: 'var(--wash-turquoise)',
  turqD: 'var(--wash-turquoise-deep)',
  violetL: 'var(--wash-violet-light)',
  violet: 'var(--wash-violet)',
  violetD: 'var(--wash-violet-deep)',
  limeL: 'var(--wash-lime-light)',
  lime: 'var(--wash-lime)',
  limeD: 'var(--wash-lime-deep)',
} as const;

/** Filled wobbly outline. */
function shape(
  points: readonly Pt[],
  rng: Rng,
  fill: string,
  stroke: string,
  width = 1.6,
  amp = 0.6,
): string {
  return path(wobblyLoop(points, rng, amp), fill, stroke, width);
}

/** Wobbly open stroke. */
function mark(
  points: readonly Pt[],
  rng: Rng,
  stroke: string,
  width = 1.4,
  amp = 0.35,
): string {
  return path(wobblyStroke(points, rng, amp), 'none', stroke, width);
}

/** A true circle — below ~3px the wobble reads as a mistake, not a hand. */
function dot(cx: number, cy: number, r: number, fill: string, stroke?: string): string {
  const edge =
    stroke === undefined ? '' : ` stroke="${stroke}" stroke-width="1.2"`;
  return `<circle cx="${n2(cx)}" cy="${n2(cy)}" r="${n2(r)}" fill="${fill}"${edge}/>`;
}

/** An ellipse offset `dist` from a centre along `angle`, and turned to face it. */
function petalPts(
  cx: number,
  cy: number,
  angle: number,
  dist: number,
  rx: number,
  ry: number,
  segments = 8,
): Pt[] {
  return ell(
    cx + Math.cos(angle) * dist,
    cy + Math.sin(angle) * dist,
    rx,
    ry,
    segments,
    angle,
  );
}

/* --- garden & ground ------------------------------------------------------ */

function drawClover(rng: Rng): string {
  let leaves = '';
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
    leaves += shape(petalPts(16, 14, a, 6, 5.4, 4.6), rng, T.mossL, T.mossD, 1.3);
  }
  const stem = mark(pts([16, 19, 17.4, 24, 16.2, 29]), rng, T.mossD, 1.7);
  return svg(leaves + dot(16, 14, 2, T.moss) + stem, 'clover sticker');
}

function drawMushroom(rng: Rng): string {
  const stem = shape(
    pts([12.6, 18, 19.4, 18, 19, 25, 17.6, 29, 14.4, 29, 13, 25]),
    rng,
    T.cream,
    T.inkSoft,
    1.4,
  );
  const cap = shape(
    pts([3.5, 18.5, 5, 12.5, 9, 7.6, 16, 5.5, 23, 7.6, 27, 12.5, 28.5, 18.5, 22, 20, 16, 20.6, 10, 20]),
    rng,
    T.coral,
    T.coralD,
    1.6,
    0.7,
  );
  const spots =
    dot(10, 13, 2.4, T.cream) + dot(17.5, 10.5, 2.9, T.cream) + dot(23, 15, 2, T.cream);
  return svg(stem + cap + spots, 'mushroom sticker');
}

function drawAcorn(rng: Rng): string {
  const nut = shape(
    pts([9.5, 13.5, 22.5, 13.5, 23.5, 19, 21, 25.5, 16, 29, 11, 25.5, 8.5, 19]),
    rng,
    T.terra,
    T.terraD,
  );
  const cap = shape(
    pts([7.5, 13.8, 7.6, 10, 10.5, 7, 16, 5.8, 21.5, 7, 24.4, 10, 24.5, 13.8]),
    rng,
    T.amber,
    T.amberD,
  );
  const hatch =
    mark(pts([10, 12.6, 22, 12.6]), rng, T.amberD, 1) +
    mark(pts([9.4, 9.6, 22.6, 9.6]), rng, T.amberD, 1);
  const stalk = mark(pts([16, 6, 16.4, 3]), rng, T.terraD, 1.8);
  return svg(nut + cap + hatch + stalk, 'acorn sticker');
}

function drawPine(rng: Rng): string {
  const trunk = shape(boxPts(14, 24, 4, 6), rng, T.terraD, T.inkSoft, 1.2);
  const tiers =
    shape(pts([16, 15, 28, 26, 4, 26]), rng, T.mossD, T.mossD, 1.4) +
    shape(pts([16, 9, 25, 19.5, 7, 19.5]), rng, T.moss, T.mossD, 1.4) +
    shape(pts([16, 3, 22, 12.5, 10, 12.5]), rng, T.mossL, T.mossD, 1.4);
  return svg(trunk + tiers, 'pine tree sticker');
}

function drawCactus(rng: Rng): string {
  // The arms carry a stub back into the trunk, or they float beside it.
  const arms =
    shape(pts([8.6, 15.5, 14, 15.5, 14, 19, 8.6, 19]), rng, T.moss, T.moss, 0.8) +
    shape(pts([18, 17.5, 23.4, 17.5, 23.4, 21, 18, 21]), rng, T.moss, T.moss, 0.8) +
    shape(ell(8.6, 15.5, 2.8, 6, 8, -0.2), rng, T.moss, T.mossD, 1.3) +
    shape(ell(23.4, 17.5, 2.8, 5.4, 8, 0.2), rng, T.moss, T.mossD, 1.3);
  const body = shape(ell(16, 16, 4.6, 11, 12), rng, T.mossL, T.mossD, 1.5);
  const ribs =
    mark(pts([16, 8, 15.6, 14, 16.2, 21]), rng, T.moss, 1) +
    mark(pts([13.6, 10, 13.3, 20]), rng, T.moss, 0.9);
  const pot = shape(
    pts([8.5, 24.5, 23.5, 24.5, 22, 30, 10, 30]),
    rng,
    T.terra,
    T.terraD,
    1.5,
  );
  const bloom = dot(16, 5.4, 2.6, T.blush, T.blushD);
  return svg(arms + body + ribs + pot + bloom, 'cactus sticker');
}

function drawFeather(rng: Rng): string {
  // The vane's outer edge is SERRATED, and the quill runs on below it bare.
  // Both are the whole difference between a feather and a leaf, and the first
  // draft — a smooth almond with two hairlines — was a leaf.
  const vane = shape(
    pts([16.8, 3.4, 14, 6.6, 12.2, 8.6, 10, 10.2, 11.4, 11.8, 9, 13.4, 10.6, 14.8,
      8.4, 16.4, 10.2, 17.8, 8.6, 19.4, 11, 20.4, 13.4, 21.6, 15.6, 22.6,
      18, 21.8, 20.6, 20.8, 23, 19.8, 21.4, 18.2, 23.8, 16.6, 22.2, 15,
      24.4, 13.4, 22.6, 11.8, 24, 10.2, 21.8, 8.6, 19.6, 6.6]),
    rng,
    T.skyL,
    T.skyD,
    1.4,
    0.45,
  );
  const shaft = mark(pts([16.6, 4.4, 16.2, 14, 16, 22, 15.6, 30]), rng, T.skyD, 1.7);
  const barbs =
    mark(pts([16.3, 10, 12.8, 12]), rng, T.sky, 0.9) +
    mark(pts([16.3, 14.6, 12.4, 16.6]), rng, T.sky, 0.9) +
    mark(pts([16.2, 10, 19.8, 12]), rng, T.sky, 0.9) +
    mark(pts([16.2, 14.6, 20.2, 16.6]), rng, T.sky, 0.9);
  return svg(vane + barbs + shaft, 'feather sticker');
}

function drawWave(rng: Rng): string {
  const row = (y: number, colour: string): string =>
    mark(pts([3, y, 8, y - 3.4, 13, y, 18, y - 3.4, 23, y, 28, y - 3.4]), rng, colour, 2.4, 0.3);
  const crest = shape(
    pts([21, 8, 26, 5.5, 29, 8.5, 26.5, 11, 23.5, 10.5]),
    rng,
    T.turqL,
    T.turqD,
    1.3,
  );
  return svg(
    crest + row(14, T.turqD) + row(20, T.turq) + row(26, T.turqL),
    'wave sticker',
  );
}

function drawRainbow(rng: Rng): string {
  const band = (r: number, colour: string): string =>
    mark(arcPts(16, 25, r, Math.PI, Math.PI * 2, 8), rng, colour, 3.2, 0.25);
  const clouds =
    shape(ell(5.5, 25.5, 5, 3.4, 9), rng, T.cream, T.edge, 1.3) +
    shape(ell(26.5, 25.5, 5, 3.4, 9), rng, T.cream, T.edge, 1.3);
  return svg(
    band(13, T.coral) + band(10, T.amber) + band(7, T.moss) + band(4, T.sky) + clouds,
    'rainbow sticker',
  );
}

/* --- sky & weather -------------------------------------------------------- */

function drawMoon(rng: Rng): string {
  const crescent = shape(
    pts([16, 3.2, 11, 4.8, 7, 8.4, 5, 13.4, 5.2, 18.6, 7.6, 23, 11.6, 26.6, 16.6, 28.6,
      13, 24, 11, 19, 10.8, 14, 12.6, 8.8]),
    rng,
    T.lemonL,
    T.amberD,
    1.6,
    0.7,
  );
  const stars =
    path(wobblyLoop(starPoints(24, 8, 3.4, 1.2, 4, 0), rng, 0.3), T.lemon, T.amberD, 1) +
    path(wobblyLoop(starPoints(26.5, 17, 2.4, 0.9, 4, 0), rng, 0.25), T.lemon, T.amberD, 0.9);
  return svg(crescent + stars, 'moon sticker');
}

function drawCloud(rng: Rng): string {
  const puff = shape(
    pts([5.5, 22.5, 4.6, 18.5, 7, 14.6, 11, 12.6, 15, 9.6, 20.5, 10.4, 23.5, 13.6,
      27, 15.4, 27.6, 20, 25, 23]),
    rng,
    T.skyL,
    T.skyD,
    1.6,
    0.7,
  );
  const inner = mark(pts([9, 19.5, 13.5, 17.6, 18, 18.4]), rng, T.sky, 1.1);
  return svg(puff + inner, 'cloud sticker');
}

function drawRaindrop(rng: Rng): string {
  const body = shape(
    pts([16, 2.5, 19.5, 8, 22.6, 13.5, 23.6, 18.6, 21.6, 24, 16, 28.5, 10.4, 24,
      8.4, 18.6, 9.4, 13.5, 12.5, 8]),
    rng,
    T.skyL,
    T.skyD,
    1.6,
    0.6,
  );
  const inner = mark(pts([12.4, 16, 11.6, 20, 13.4, 23.6]), rng, T.sky, 1.4);
  return svg(body + inner, 'raindrop sticker');
}

function drawSnowflake(rng: Rng): string {
  let arms = '';
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    const tip = { x: 16 + Math.cos(a) * 13, y: 16 + Math.sin(a) * 13 };
    const mid = { x: 16 + Math.cos(a) * 7, y: 16 + Math.sin(a) * 7 };
    arms += mark([{ x: 16, y: 16 }, mid, tip], rng, T.skyD, 1.7, 0.3);
    // Two barbs off the midpoint of each arm — the six-fold branching that is
    // the whole reason a snowflake is not a star.
    for (const fork of [-0.7, 0.7]) {
      arms += mark(
        [mid, { x: mid.x + Math.cos(a + fork) * 4.4, y: mid.y + Math.sin(a + fork) * 4.4 }],
        rng,
        T.sky,
        1.3,
        0.25,
      );
    }
  }
  return svg(arms + dot(16, 16, 2.4, T.skyL, T.skyD), 'snowflake sticker');
}

function drawBolt(rng: Rng): string {
  const flash = shape(
    pts([13, 2.5, 21, 2.5, 16, 14, 21.5, 14, 10.5, 29.5, 14, 18, 8.6, 18]),
    rng,
    T.lemon,
    T.amberD,
    1.6,
    0.45,
  );
  return svg(flash, 'lightning bolt sticker');
}

/* --- small creatures ------------------------------------------------------ */

function drawBird(rng: Rng): string {
  const tail = shape(pts([9, 15, 2, 11.5, 3.5, 20.5]), rng, T.skyD, T.skyD, 1.2);
  const body = shape(ell(15, 17.5, 8.4, 7, 11, -0.18), rng, T.skyL, T.skyD, 1.6);
  const wing = shape(ell(14.5, 17, 5.4, 3.2, 9, -0.5), rng, T.sky, T.skyD, 1.2);
  const head = shape(ell(22.6, 11.4, 5, 4.6, 10), rng, T.skyL, T.skyD, 1.5);
  const beak = shape(pts([26.5, 10.6, 31, 12.4, 26.5, 14.2]), rng, T.amber, T.amberD, 1.1);
  const legs =
    mark(pts([14, 24, 13.4, 28]), rng, T.amberD, 1.4) +
    mark(pts([18, 24, 18.6, 28]), rng, T.amberD, 1.4);
  return svg(tail + legs + body + wing + head + beak + dot(23.4, 10.6, 1.1, T.ink), 'bird sticker');
}

function drawFish(rng: Rng): string {
  const tail = shape(pts([22, 16, 30.5, 9.5, 29, 16, 30.5, 23]), rng, T.turq, T.turqD, 1.3);
  const body = shape(ell(14.5, 16, 9.4, 6.8, 12), rng, T.turqL, T.turqD, 1.6);
  const fin = shape(ell(15, 21.6, 4, 2.2, 8, 0.25), rng, T.turq, T.turqD, 1.1);
  const dorsal = shape(pts([11, 10.4, 17, 6.4, 18.5, 10.6]), rng, T.turq, T.turqD, 1.1);
  const gill = mark(pts([10.4, 11.6, 9.2, 16, 10.4, 20.4]), rng, T.turqD, 1.2);
  const bubbles = dot(4.4, 10, 1.6, T.turqL, T.turqD) + dot(2.6, 6, 1, T.turqL, T.turqD);
  return svg(
    tail + dorsal + body + fin + gill + dot(7.6, 14, 1.3, T.ink) + bubbles,
    'fish sticker',
  );
}

function drawButterfly(rng: Rng): string {
  const upper =
    shape(petalPts(16, 15, Math.PI * 1.18, 7.6, 6.4, 5, 9), rng, T.violetL, T.violetD, 1.3) +
    shape(petalPts(16, 15, -Math.PI * 0.18, 7.6, 6.4, 5, 9), rng, T.violetL, T.violetD, 1.3);
  const lower =
    shape(petalPts(16, 21, Math.PI * 0.78, 6.2, 4.8, 3.8, 9), rng, T.blushL, T.blushD, 1.2) +
    shape(petalPts(16, 21, Math.PI * 0.22, 6.2, 4.8, 3.8, 9), rng, T.blushL, T.blushD, 1.2);
  const body = shape(ell(16, 18, 1.7, 8.4, 10), rng, T.graphite, T.graphite, 1);
  const antennae =
    mark(pts([15.6, 10.4, 12.6, 5.6, 11, 4]), rng, T.graphite, 1.1) +
    mark(pts([16.4, 10.4, 19.4, 5.6, 21, 4]), rng, T.graphite, 1.1);
  const spots = dot(10.6, 12.6, 1.6, T.plum) + dot(21.4, 12.6, 1.6, T.plum);
  return svg(upper + lower + body + antennae + spots, 'butterfly sticker');
}

function drawSnail(rng: Rng): string {
  const body = shape(
    pts([3, 26.5, 4, 21.5, 8, 19.2, 13, 19.6, 17.5, 22, 19.6, 26.5, 12, 28.4, 5.5, 28]),
    rng,
    T.mossL,
    T.mossD,
    1.5,
  );
  const eyes =
    mark(pts([5.6, 20.6, 3.6, 15.6, 3, 12.6]), rng, T.mossD, 1.2) +
    mark(pts([8.6, 20, 8.4, 14.6, 8.6, 11.6]), rng, T.mossD, 1.2) +
    dot(2.8, 11.4, 1.5, T.mossD) +
    dot(8.7, 10.4, 1.5, T.mossD);
  const shell = shape(ell(19.5, 14.5, 8.4, 8.4, 12), rng, T.amberL, T.amberD, 1.6);
  const spiralPts: Pt[] = [];
  for (let i = 0; i <= 22; i += 1) {
    const a = i * 0.56;
    const r = 7.2 - i * 0.3;
    spiralPts.push({ x: 19.5 + Math.cos(a) * r, y: 14.5 + Math.sin(a) * r });
  }
  return svg(
    eyes + body + shell + mark(spiralPts, rng, T.amberD, 1.3, 0.2),
    'snail sticker',
  );
}

function drawWhale(rng: Rng): string {
  // Round to the point of comedy, and the flukes lie FLAT — a whale read at
  // 22px is a fat blue barrel with a fountain on top. The first draft was an
  // oval with a vertical tail, which is a fish, and the sheet already has one.
  const spray =
    mark(pts([12.6, 9.4, 10.6, 5.6, 8.4, 3]), rng, T.sky, 1.6) +
    mark(pts([13.6, 9, 13.2, 4.8, 13, 2.2]), rng, T.sky, 1.6) +
    mark(pts([14.6, 9.4, 17, 5.8, 18.8, 3.4]), rng, T.sky, 1.6) +
    dot(8, 2.4, 1.5, T.skyL, T.sky) +
    dot(12.9, 1.6, 1.5, T.skyL, T.sky) +
    dot(19.4, 2.8, 1.5, T.skyL, T.sky);
  const flukes = shape(
    pts([23, 21, 30.5, 16.6, 27.6, 21, 30.8, 25.4, 24.6, 25]),
    rng,
    T.skyD,
    T.skyD,
    1.2,
  );
  const body = shape(
    pts([2.6, 20, 3.4, 14.6, 7, 11.2, 12.6, 9.6, 18.6, 10.2, 23, 13.4, 25, 18,
      24.4, 23.2, 20.4, 26.6, 13.6, 27.8, 7, 26.2, 3.4, 23.4]),
    rng,
    T.sky,
    T.skyD,
    1.7,
    0.7,
  );
  const belly = shape(
    pts([4.4, 23.2, 10, 26, 17.6, 26.4, 22.6, 24, 20.6, 27, 13.6, 28, 6.6, 26.4]),
    rng,
    T.skyL,
    T.skyD,
    1.1,
  );
  const fin = shape(ell(13, 22.6, 4.6, 2.4, 9, 0.25), rng, T.skyD, T.skyD, 1);
  const smile = mark(pts([3.6, 19.6, 5.6, 21.4, 8.4, 20.4]), rng, T.skyD, 1.2);
  return svg(
    spray + flukes + body + belly + fin + smile + dot(7.6, 16.4, 1.5, T.ink),
    'whale sticker',
  );
}

function drawFox(rng: Rng): string {
  const tail = shape(ell(4.6, 22, 4.4, 6, 9, -0.5), rng, T.terraL, T.terraD, 1.3);
  const head = shape(
    pts([16, 29, 6.4, 17, 7.6, 6, 13, 11, 19, 11, 24.4, 6, 25.6, 17]),
    rng,
    T.terra,
    T.terraD,
    1.6,
    0.65,
  );
  const ears =
    shape(pts([9.4, 8.6, 12.6, 12.4, 8.8, 13]), rng, T.blushL, T.terraD, 1.1) +
    shape(pts([22.6, 8.6, 23.2, 13, 19.4, 12.4]), rng, T.blushL, T.terraD, 1.1);
  const snout = shape(
    pts([11.6, 19.6, 20.4, 19.6, 18.4, 25.6, 16, 28.4, 13.6, 25.6]),
    rng,
    T.cream,
    T.terraD,
    1.2,
  );
  return svg(
    tail + head + ears + snout + dot(12.4, 16.6, 1.4, T.ink) + dot(19.6, 16.6, 1.4, T.ink) +
      dot(16, 22.4, 1.7, T.ink),
    'fox sticker',
  );
}

/* --- the desk ------------------------------------------------------------- */

function drawBook(rng: Rng): string {
  const pages = shape(boxPts(9, 5.5, 19, 21), rng, T.cream, T.edge, 1.3);
  const cover = shape(boxPts(4.5, 4.5, 21, 22), rng, T.terra, T.terraD, 1.6);
  const spine = shape(boxPts(4.5, 4.5, 4.6, 22), rng, T.terraD, T.terraD, 1.2);
  const rules =
    mark(pts([12.5, 11, 22, 11]), rng, T.amber, 1.5) +
    mark(pts([12.5, 15, 20, 15]), rng, T.amberL, 1.3);
  const ribbon = shape(pts([19, 26, 22, 26, 22, 30.5, 20.5, 28.6, 19, 30.5]), rng, T.amber, T.amberD, 1);
  return svg(pages + cover + spine + rules + ribbon, 'book sticker');
}

function drawPencil(rng: Rng): string {
  const shaft = shape(pts([7, 24, 20.5, 9, 24.5, 12.5, 11, 27.5]), rng, T.amber, T.amberD, 1.5);
  const ferrule = shape(pts([7, 24, 11, 27.5, 8.6, 30, 4.6, 26.5]), rng, T.skyL, T.skyD, 1.3);
  const wood = shape(pts([20.5, 9, 24.5, 12.5, 27.4, 4.6]), rng, T.cream, T.inkSoft, 1.3);
  const lead = shape(pts([24.6, 7.4, 27.4, 4.6, 26.2, 8.6]), rng, T.graphite, T.graphite, 1);
  const grain = mark(pts([9.6, 21.4, 22.6, 7]), rng, T.amberD, 1);
  return svg(ferrule + shaft + grain + wood + lead, 'pencil sticker');
}

function drawMicroscope(rng: Rng): string {
  const base = shape(pts([5.4, 29.5, 26.6, 29.5, 24, 25.4, 8, 25.4]), rng, T.skyD, T.skyD, 1.3);
  const arm = mark(pts([10.4, 25.4, 8.6, 20, 10, 14, 14, 10]), rng, T.sky, 3);
  const stage = shape(boxPts(6.5, 21.4, 17.5, 3), rng, T.aged, T.ink, 1.3);
  const slide = mark(pts([11, 21.4, 18, 21.4]), rng, T.amber, 1.6);
  const tube = shape(boxPts(12.8, 5, 7, 13), rng, T.cream, T.ink, 1.4);
  const eyepiece = shape(boxPts(13.6, 2.2, 5.4, 3.4), rng, T.skyD, T.skyD, 1.2);
  const objective = shape(pts([13.4, 18, 19.4, 18, 17.4, 22]), rng, T.sky, T.skyD, 1.2);
  return svg(base + arm + stage + slide + tube + eyepiece + objective, 'microscope sticker');
}

function drawBulb(rng: Rng): string {
  let rays = '';
  for (const a of [-2.5, -1.9, -1.25, -0.65]) {
    rays += mark(
      [
        { x: 16 + Math.cos(a) * 11, y: 14 + Math.sin(a) * 11 },
        { x: 16 + Math.cos(a) * 14.8, y: 14 + Math.sin(a) * 14.8 },
      ],
      rng,
      T.amberD,
      1.4,
    );
  }
  const glass = shape(ell(16, 14, 8.4, 9, 12), rng, T.lemonL, T.amberD, 1.6);
  const filament = mark(pts([13, 16, 14.6, 12.4, 16, 15.6, 17.4, 12.4, 19, 16]), rng, T.amberD, 1.4);
  const neck = shape(boxPts(12.4, 21.4, 7.2, 2.8), rng, T.aged, T.inkSoft, 1.2);
  const screw = shape(boxPts(12.8, 24, 6.4, 5), rng, T.edge, T.inkSoft, 1.2);
  const thread = mark(pts([13, 26.4, 19, 26.4]), rng, T.inkSoft, 1);
  return svg(rays + glass + filament + neck + screw + thread, 'lightbulb sticker');
}

function drawClip(rng: Rng): string {
  // Tilted, and wide enough that the three nested passes read as three. Drawn
  // upright at 8px of width it was a lowercase "o".
  const wire = mark(
    pts([9.4, 28.4, 6.2, 12.6, 6.4, 8.2, 9.4, 5, 14, 4.2, 18.2, 6, 19.8, 9.8,
      22.4, 22.6, 22, 26, 19.4, 28.2, 16.2, 27.6, 14.8, 24.6, 12, 11.4,
      11.8, 8.8, 14, 7.6, 16.6, 8.2, 17.8, 11]),
    rng,
    T.graphite,
    2.4,
    0.3,
  );
  return svg(wire, 'paperclip sticker');
}

function drawPin(rng: Rng): string {
  const needle = shape(pts([14.4, 15.6, 17.6, 15.6, 16, 29.6]), rng, T.graphite, T.graphite, 1);
  const collar = shape(boxPts(12.6, 12.4, 6.8, 3.4), rng, T.coralD, T.coralD, 1.2);
  const head = shape(ell(16, 8.4, 7.4, 5.6, 10), rng, T.coral, T.coralD, 1.6);
  const facet = mark(pts([11.6, 8.6, 14.6, 5.6]), rng, T.coralD, 1.2);
  return svg(needle + collar + head + facet, 'push-pin sticker');
}

function drawRuler(rng: Rng): string {
  const body = shape(boxPts(2.5, 11.5, 27, 9), rng, T.amberL, T.amberD, 1.6);
  let ticks = '';
  for (let i = 0; i < 8; i += 1) {
    const x = 5 + i * 3.2;
    const long = i % 2 === 0;
    ticks += mark(pts([x, 11.5, x, long ? 17 : 14.8]), rng, T.amberD, 1.1, 0.2);
  }
  const edge = mark(pts([3, 20.4, 29, 20.4]), rng, T.amber, 1.2);
  return svg(body + ticks + edge, 'ruler sticker');
}

function drawFlask(rng: Rng): string {
  const glass = shape(
    pts([12.4, 3, 19.6, 3, 19.6, 12, 27, 25.6, 25, 29.4, 7, 29.4, 5, 25.6, 12.4, 12]),
    rng,
    T.cream,
    T.ink,
    1.6,
    0.5,
  );
  const liquid = shape(
    pts([9.6, 21, 22.4, 21, 25.4, 26, 23.4, 29, 8.6, 29, 6.6, 26]),
    rng,
    T.turq,
    T.turqD,
    1.2,
  );
  const collar = mark(pts([11.6, 6, 20.4, 6]), rng, T.ink, 1.6);
  const bubbles = dot(13, 25, 1.6, T.turqL) + dot(18.4, 26.4, 1.2, T.turqL) + dot(16, 23, 1, T.turqL);
  return svg(glass + liquid + collar + bubbles, 'flask sticker');
}

function drawAtom(rng: Rng): string {
  let rings = '';
  for (let i = 0; i < 3; i += 1) {
    rings += path(
      wobblyLoop(ell(16, 16, 13, 5, 14, (i / 3) * Math.PI), rng, 0.35),
      'none',
      i === 0 ? T.violetD : T.violet,
      1.4,
    );
  }
  const electrons =
    dot(28.4, 18.4, 1.8, T.plum, T.plumD) +
    dot(9.4, 5.6, 1.8, T.plum, T.plumD) +
    dot(7.4, 22.6, 1.8, T.plum, T.plumD);
  return svg(rings + dot(16, 16, 3.6, T.violetL, T.violetD) + electrons, 'atom sticker');
}

/* --- the kitchen ---------------------------------------------------------- */

function drawCoffee(rng: Rng): string {
  const handle = path(
    wobblyStroke(arcPts(21.5, 17.5, 5.6, -Math.PI * 0.45, Math.PI * 0.45, 6), rng, 0.3),
    'none',
    T.ink,
    2.4,
  );
  const mug = shape(
    pts([7, 10.5, 22, 10.5, 21.2, 23.5, 18.4, 27.6, 10.6, 27.6, 7.8, 23.5]),
    rng,
    T.cream,
    T.ink,
    1.6,
  );
  const band = shape(boxPts(7.4, 15, 14.2, 4), rng, T.terra, T.terraD, 1.1);
  const steam =
    mark(pts([11.6, 8.4, 10.4, 5.4, 12, 2.6]), rng, T.graphiteSoft, 1.5) +
    mark(pts([17.4, 8.4, 16.2, 5.4, 17.8, 2.6]), rng, T.graphiteSoft, 1.5);
  return svg(steam + handle + mug + band, 'coffee sticker');
}

function drawTeapot(rng: Rng): string {
  const spout = shape(pts([23, 15.4, 30.4, 10.6, 31.4, 13.6, 25.6, 19.4]), rng, T.blushL, T.blushD, 1.3);
  const handle = path(
    wobblyStroke(arcPts(6.6, 18.5, 4.6, -Math.PI * 0.55, Math.PI * 0.55, 6), rng, 0.3),
    'none',
    T.blushD,
    2.4,
  );
  const body = shape(ell(15.5, 19.5, 10, 8, 12), rng, T.blushL, T.blushD, 1.6);
  const belt = mark(pts([7.4, 19.4, 15.5, 21, 23.4, 19.4]), rng, T.blush, 1.5);
  const lid = shape(pts([9, 12, 22, 12, 20, 8.4, 11, 8.4]), rng, T.blush, T.blushD, 1.4);
  const knob = dot(15.5, 6.4, 2.4, T.blushL, T.blushD);
  return svg(spout + handle + body + belt + lid + knob, 'teapot sticker');
}

function drawCake(rng: Rng): string {
  const plate = shape(pts([2.5, 27.4, 29.5, 27.4, 27.4, 30.4, 4.6, 30.4]), rng, T.aged, T.edge, 1.2);
  const sponge = shape(boxPts(5.5, 15.5, 21, 11.5), rng, T.blushL, T.blushD, 1.5);
  const filling = shape(boxPts(5.5, 19.5, 21, 3), rng, T.coral, T.coralD, 1);
  const icing = shape(
    pts([5.5, 15.5, 5.5, 10, 26.5, 10, 26.5, 15.8, 23, 13.6, 19.6, 16, 16, 13.4,
      12.4, 16, 9, 13.4]),
    rng,
    T.cream,
    T.blushD,
    1.4,
    0.5,
  );
  const candle = shape(boxPts(14.6, 3.4, 2.8, 7), rng, T.lemon, T.amberD, 1.1);
  const flame = shape(ell(16, 2.4, 1.8, 2.8, 8), rng, T.amber, T.amberD, 1);
  return svg(plate + sponge + filling + icing + candle + flame, 'cake sticker');
}

function drawApple(rng: Rng): string {
  const body = shape(
    pts([16, 11, 19, 7.4, 23, 6.6, 26, 9.6, 27, 15.4, 25, 22, 20.6, 27.4, 16, 28.4,
      11.4, 27.4, 7, 22, 5, 15.4, 6, 9.6, 9, 6.6, 13, 7.4]),
    rng,
    T.coral,
    T.coralD,
    1.6,
    0.7,
  );
  const stem = mark(pts([16, 10, 16.6, 6, 17.4, 3.4]), rng, T.terraD, 1.8);
  const leaf = shape(petalPts(18.4, 5, -0.35, 4.6, 4.4, 2.2), rng, T.mossL, T.mossD, 1.2);
  const shine = mark(pts([10.6, 13.4, 9.6, 17, 10.6, 20.4]), rng, T.coralL, 1.8);
  return svg(body + shine + stem + leaf, 'apple sticker');
}

function drawCherry(rng: Rng): string {
  const stems =
    mark(pts([10, 21, 12.4, 12.6, 16.4, 6.4]), rng, T.mossD, 1.6) +
    mark(pts([22, 22.6, 21.4, 13.6, 16.4, 6.4]), rng, T.mossD, 1.6);
  const leaf = shape(petalPts(19.4, 5.6, 0.15, 5, 5, 2.4), rng, T.mossL, T.mossD, 1.2);
  const berries =
    shape(ell(9.6, 24.4, 5.8, 5.6, 10), rng, T.coral, T.coralD, 1.5) +
    shape(ell(22.4, 25.6, 5.2, 5, 10), rng, T.coral, T.coralD, 1.5);
  const glints = mark(pts([6.6, 22.6, 6, 25.4]), rng, T.coralL, 1.6);
  return svg(stems + leaf + berries + glints, 'cherry sticker');
}

/* --- marks & keepsakes ---------------------------------------------------- */

function drawMusic(rng: Rng): string {
  const head = shape(ell(11, 24, 5.8, 4.4, 10, -0.35), rng, T.sepia, T.sepia, 1.2);
  const stem = mark(pts([16.2, 23, 16.6, 14, 16.4, 5.6]), rng, T.sepia, 2.2);
  const flag = shape(
    pts([16.4, 5, 21.6, 8, 23.4, 13, 21, 17.4, 21.4, 12, 18.6, 9, 16.4, 9]),
    rng,
    T.sepia,
    T.sepia,
    1.2,
    0.4,
  );
  return svg(head + stem + flag, 'music note sticker');
}

function drawArrow(rng: Rng): string {
  const shaft = mark(pts([4.6, 26.4, 6.4, 17, 12, 10.4, 20, 7.4]), rng, T.sepia, 2.6, 0.3);
  const head = shape(pts([27.4, 5.6, 18.6, 3.4, 20.4, 12.4]), rng, T.sepia, T.sepia, 1.2, 0.4);
  return svg(shaft + head, 'arrow sticker');
}

function drawCheck(rng: Rng): string {
  const tick = mark(pts([5, 17.4, 9.4, 22, 12.6, 25.4, 19, 14, 27, 5.4]), rng, T.mossD, 4, 0.4);
  return svg(tick, 'tick sticker');
}

function drawKey(rng: Rng): string {
  const shaft = shape(pts([12, 14.4, 15.4, 11.4, 28, 24.4, 25, 27.4]), rng, T.amber, T.amberD, 1.4);
  const teeth =
    shape(pts([20.4, 20.6, 23.4, 17.6, 25.4, 19.6, 22.4, 22.6]), rng, T.amber, T.amberD, 1.2) +
    shape(pts([17, 17.2, 19.6, 14.6, 21.4, 16.4, 18.6, 19]), rng, T.amber, T.amberD, 1.2);
  const bow = shape(ell(9.4, 11.4, 7, 7, 11), rng, T.amber, T.amberD, 1.6);
  return svg(shaft + teeth + bow + dot(9.4, 11.4, 2.8, T.cream, T.amberD), 'key sticker');
}

function drawCrown(rng: Rng): string {
  const band = shape(
    pts([3.6, 25.6, 5.6, 9, 11, 17, 16, 5.6, 21, 17, 26.4, 9, 28.4, 25.6]),
    rng,
    T.amber,
    T.amberD,
    1.6,
    0.55,
  );
  const rim = mark(pts([4.6, 22.4, 16, 23.6, 27.4, 22.4]), rng, T.amberD, 1.4);
  const gems =
    dot(5.8, 8, 2, T.blush, T.blushD) +
    dot(16, 5, 2.3, T.coral, T.coralD) +
    dot(26.2, 8, 2, T.blush, T.blushD);
  return svg(band + rim + gems, 'crown sticker');
}

function drawGift(rng: Rng): string {
  const box = shape(boxPts(4.5, 13, 23, 15), rng, T.terra, T.terraD, 1.6);
  const ribbonV = shape(boxPts(13.6, 13, 4.8, 15), rng, T.lemon, T.amberD, 1.1);
  const ribbonH = shape(boxPts(4.5, 17.4, 23, 3.6), rng, T.lemon, T.amberD, 1.1);
  const bow =
    shape(ell(11.4, 9.6, 4.6, 3.4, 9, -0.42), rng, T.lemon, T.amberD, 1.2) +
    shape(ell(20.6, 9.6, 4.6, 3.4, 9, 0.42), rng, T.lemon, T.amberD, 1.2);
  return svg(box + ribbonH + ribbonV + bow + dot(16, 11.4, 2.2, T.amber, T.amberD), 'gift sticker');
}

function drawTicket(rng: Rng): string {
  // A stub, a perforation and a bite out of the top and bottom edges — a
  // torn-off admission ticket. The bites belong on the perforation line, not
  // on the left and right ends, which is what made the first draft a capsule
  // with two eyes.
  const card = shape(boxPts(2.5, 6.5, 27, 19), rng, T.amberL, T.amberD, 1.7);
  const perforation =
    `<path d="M 20.5 8 L 20.5 24" fill="none" stroke="${T.amberD}" ` +
    `stroke-width="1.3" stroke-dasharray="2.4 2.6" stroke-linecap="round"/>`;
  const bites = dot(20.5, 6.5, 2.6, T.cream, T.amberD) + dot(20.5, 25.5, 2.6, T.cream, T.amberD);
  const star = path(
    wobblyLoop(starPoints(25.4, 15.8, 3.4, 1.4, 5), rng, 0.3),
    T.amber,
    T.amberD,
    1.1,
  );
  const lines =
    mark(pts([6, 12, 17, 12]), rng, T.amberD, 1.6) +
    mark(pts([6, 16.4, 17, 16.4]), rng, T.amber, 1.3) +
    mark(pts([6, 20.4, 13.4, 20.4]), rng, T.amber, 1.3);
  return svg(card + lines + perforation + star + bites, 'ticket sticker');
}

function drawCompass(rng: Rng): string {
  const face = shape(ell(16, 16, 12.6, 12.6, 14), rng, T.skyL, T.skyD, 1.7);
  const ticks =
    mark(pts([16, 3.4, 16, 6]), rng, T.skyD, 1.3) +
    mark(pts([16, 26, 16, 28.6]), rng, T.skyD, 1.3) +
    mark(pts([3.4, 16, 6, 16]), rng, T.skyD, 1.3) +
    mark(pts([26, 16, 28.6, 16]), rng, T.skyD, 1.3);
  const north = shape(pts([16, 6.4, 19.6, 16, 12.4, 16]), rng, T.coral, T.coralD, 1.2);
  const south = shape(pts([16, 25.6, 19.6, 16, 12.4, 16]), rng, T.cream, T.skyD, 1.2);
  return svg(face + ticks + north + south + dot(16, 16, 1.8, T.skyD), 'compass sticker');
}

function drawGlobe(rng: Rng): string {
  const sphere = shape(ell(16, 16, 12.6, 12.6, 14), rng, T.turqL, T.turqD, 1.7);
  const land =
    shape(pts([8, 12, 13.6, 9.6, 17, 12.6, 13.4, 16.4, 8.6, 15.6]), rng, T.moss, T.mossD, 1.1) +
    shape(pts([17.4, 18.4, 23.4, 17.6, 24.4, 22, 19.4, 24.4]), rng, T.moss, T.mossD, 1.1);
  const grid =
    path(wobblyLoop(ell(16, 16, 12.6, 4.6, 12), rng, 0.3), 'none', T.turqD, 1.2) +
    path(wobblyLoop(ell(16, 16, 4.6, 12.6, 12), rng, 0.3), 'none', T.turqD, 1.2) +
    mark(pts([3.6, 16, 28.4, 16]), rng, T.turqD, 1.2);
  return svg(sphere + land + grid, 'globe sticker');
}

const DRAWERS: Record<BuiltinStickerId, (rng: Rng) => string> = {
  star: drawStar,
  bee: drawBee,
  leaf: drawLeaf,
  heart: drawHeart,
  sparkle: drawSparkle,
  cat: drawCat,
  sun: drawSun,
  flower: drawFlower,
  clover: drawClover,
  mushroom: drawMushroom,
  acorn: drawAcorn,
  pine: drawPine,
  cactus: drawCactus,
  feather: drawFeather,
  wave: drawWave,
  rainbow: drawRainbow,
  moon: drawMoon,
  cloud: drawCloud,
  raindrop: drawRaindrop,
  snowflake: drawSnowflake,
  bolt: drawBolt,
  bird: drawBird,
  fish: drawFish,
  butterfly: drawButterfly,
  snail: drawSnail,
  whale: drawWhale,
  fox: drawFox,
  book: drawBook,
  pencil: drawPencil,
  microscope: drawMicroscope,
  bulb: drawBulb,
  clip: drawClip,
  pin: drawPin,
  ruler: drawRuler,
  flask: drawFlask,
  atom: drawAtom,
  coffee: drawCoffee,
  teapot: drawTeapot,
  cake: drawCake,
  apple: drawApple,
  cherry: drawCherry,
  music: drawMusic,
  arrow: drawArrow,
  check: drawCheck,
  key: drawKey,
  crown: drawCrown,
  gift: drawGift,
  ticket: drawTicket,
  compass: drawCompass,
  globe: drawGlobe,
};

const cache = new Map<string, string>();

/** Minimal HTML attribute escaping for src/alt injection into markup. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Dashed "missing sticker" placeholder (unregistered user id). */
function missingUserStickerSvg(name: string): string {
  return (
    `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" role="img" ` +
    `aria-label="${escapeAttr(name)} sticker (missing)" class="nb-sticker-art">` +
    `<rect x="4" y="4" width="24" height="24" rx="7" fill="none" ` +
    `stroke="var(--ink-graphite-soft)" stroke-width="1.6" stroke-dasharray="4 3"/>` +
    `<path d="M 12 16.2 C 14.6 15.8 17.3 15.9 20 16.1" fill="none" ` +
    `stroke="var(--ink-graphite-soft)" stroke-width="1.6" stroke-linecap="round"/></svg>`
  );
}

/**
 * Full inline markup for a sticker. Built-ins are deterministic wobbly SVG
 * (seeded by id, memoized — every star wobbles identically, like a rubber
 * stamp). `user:` ids render the imported image via the session registry,
 * degrading to a dashed placeholder while unregistered (never cached, so a
 * late registration shows up on the next render).
 */
export function stickerSvg(id: StickerId): string {
  if (isUserStickerId(id)) {
    const src = userStickerSrc(id);
    const name = id.slice('user:'.length);
    if (src === null) return missingUserStickerSvg(name);
    return (
      `<img class="nb-sticker-art nb-sticker-art-user" src="${escapeAttr(src)}" ` +
      `alt="${escapeAttr(name)} sticker" draggable="false"/>`
    );
  }
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  const markup = DRAWERS[id](mulberry32(fnv1a(`sticker:${id}`)));
  cache.set(id, markup);
  return markup;
}
