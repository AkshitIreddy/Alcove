/**
 * art/cursors.ts — the pointer, drawn by the same hand as everything else.
 *
 * The app draws its own bookcase, its own wall, its own bindings, its own
 * icons — and then borrowed the operating system's arrow to point at all of
 * it. This module closes that gap: fourteen cursor STATES, each drawn in the
 * flat language of `art/flat.ts`, offered in six characterful SETS plus the
 * system's own.
 *
 * ## Two rules that are not negotiable here
 *
 * 1. **The body is always cream.** Elsewhere in the app a shape may be any
 *    cloth in the palette, because the ground it sits on is known. A cursor's
 *    ground is not: the same arrow crosses dark timber (`FLAT.recess`,
 *    #7d5638), mid timber (#c08a52) and cream paper (#f7f1e3) within one
 *    gesture. Only a light body with the one dark ink outline reads on all
 *    three — the cream mass separates it from the timber, the ink outline
 *    separates it from the paper. So a set's character comes from its SHAPE
 *    and from accent marks *inside* the outline, never from tinting the body.
 *    (Measured, not assumed: gilt #e8b64c on timber #c08a52 is a 1.3:1
 *    luminance ratio — invisible. Cream on the same timber is 1.9:1, and the
 *    ink outline carries the rest.)
 *
 * 2. **A cursor is judged at 32px.** Every glyph here is drawn in a 32-unit
 *    box and shipped at 32 CSS px (40 for the Bold set). Detail that survives
 *    on a specimen board at 200px is mush at 32, so the vocabulary is
 *    deliberately coarse: one silhouette, one or two accent marks, nothing
 *    smaller than ~2 units.
 *
 * ## Why SVG rather than a baked canvas
 *
 * `art/bake.ts` exists because the shelf redraws its parts constantly. A
 * cursor is emitted once per set and lives in a CSS custom property for the
 * rest of the session, so there is nothing to memoize across; and an SVG
 * data-URI is resolution-independent, which a 32×32 PNG is not — on a HiDPI
 * screen the PNG would be the one blurry thing in a vector app. This also
 * keeps the whole module PURE: no canvas, no DOM, so `tests/cursors.test.ts`
 * can read every path back in a node environment.
 *
 * The editor already shipped two SVG data-URI cursors this way (the pencil and
 * quill writing nibs in `styles/editor.css`, driven by `settings.cursorStyle`).
 * Those stay: `cursorStyle` is the WRITING cursor inside a page and is more
 * specific than anything here, so picking "Drafting" for the app and a quill
 * for the page is a legal, sensible combination.
 *
 * ## What this module does NOT read
 *
 * `flatScheme()`. Same reasoning as `art/bookDesign.ts`: a room repaint must
 * not repaint the pointer. The cursor is chrome — it belongs to the app, not
 * to the bookcase you happen to have open — and a pointer that changed colour
 * when you switched rooms would be the one moving thing you cannot look away
 * from. The house palette (`FLAT`) is pinned here on purpose.
 */

import { FLAT } from './flat';

/* ----------------------------------------------------------------------------
   The states
   -------------------------------------------------------------------------- */

/**
 * A cursor state the app can be in.
 *
 * These are the CSS keywords the app's own stylesheets actually use (a sweep
 * of `src/styles/*.css` found pointer ×48, default ×7, grabbing ×5, grab ×4,
 * not-allowed ×3, col-resize ×3, text ×2, progress ×2, and one each of the two
 * diagonal resizes) plus the two zoom states, which the shelf's wheel-zoom
 * deserves and which `CURSOR_CLASSES` below hands out.
 */
export type CursorRole =
  | 'default'
  | 'pointer'
  | 'text'
  | 'grab'
  | 'grabbing'
  | 'not-allowed'
  | 'ew-resize'
  | 'ns-resize'
  | 'nwse-resize'
  | 'nesw-resize'
  | 'move'
  | 'zoom-in'
  | 'zoom-out'
  | 'progress'
  | 'crosshair'
  | 'help';

/** Every state, in the order a specimen board should show them. */
export const CURSOR_ROLES: readonly CursorRole[] = [
  'default',
  'pointer',
  'text',
  'grab',
  'grabbing',
  'not-allowed',
  'ew-resize',
  'ns-resize',
  'nwse-resize',
  'nesw-resize',
  'move',
  'zoom-in',
  'zoom-out',
  'progress',
  'crosshair',
  'help',
];

/**
 * The keyword each state falls back to.
 *
 * Every emitted value ends in one of these, so a browser that refuses the
 * image (or a set of `system`) still gets the RIGHT cursor rather than an
 * arrow everywhere. It is also what makes the "system" set free: it is this
 * table and nothing else.
 */
export const CURSOR_FALLBACK: Readonly<Record<CursorRole, string>> = {
  default: 'default',
  pointer: 'pointer',
  text: 'text',
  grab: 'grab',
  grabbing: 'grabbing',
  'not-allowed': 'not-allowed',
  'ew-resize': 'ew-resize',
  'ns-resize': 'ns-resize',
  'nwse-resize': 'nwse-resize',
  'nesw-resize': 'nesw-resize',
  move: 'move',
  'zoom-in': 'zoom-in',
  'zoom-out': 'zoom-out',
  progress: 'progress',
  crosshair: 'crosshair',
  help: 'help',
};

/**
 * Keywords that are a different NAME for a state we draw.
 *
 * The override sweep in `features/settings/cursorSkin.ts` reads the app's own
 * stylesheets and rewrites whatever keyword it finds, so this has to cover the
 * spellings the app actually uses — `col-resize` on the table column handles,
 * `wait` where a `progress` was meant — as well as the eight compass resizes a
 * future handle might reach for. Anything not in this table or in
 * `CURSOR_FALLBACK` is left exactly as the app wrote it.
 */
export const CURSOR_ALIASES: Readonly<Record<string, CursorRole>> = {
  'col-resize': 'ew-resize',
  'row-resize': 'ns-resize',
  'e-resize': 'ew-resize',
  'w-resize': 'ew-resize',
  'n-resize': 'ns-resize',
  's-resize': 'ns-resize',
  'se-resize': 'nwse-resize',
  'nw-resize': 'nwse-resize',
  'ne-resize': 'nesw-resize',
  'sw-resize': 'nesw-resize',
  'all-scroll': 'move',
  wait: 'progress',
  'vertical-text': 'text',
  cell: 'crosshair',
  'context-menu': 'help',
};

/** The role a CSS cursor keyword maps onto, or `null` to leave it alone. */
export function roleForKeyword(keyword: string): CursorRole | null {
  const key = keyword.trim().toLowerCase();
  if (key in CURSOR_FALLBACK) return key as CursorRole;
  return CURSOR_ALIASES[key] ?? null;
}

/** The custom property a role's value is published under. */
export function cursorVarName(role: CursorRole): string {
  return `--nb-cur-${role}`;
}

/* ----------------------------------------------------------------------------
   The sets
   -------------------------------------------------------------------------- */

export type CursorSetId =
  | 'system'
  | 'paper'
  | 'gilt'
  | 'quill'
  | 'pencil'
  | 'botanical'
  | 'bold';

/**
 * The arrow idiom a set points with.
 *
 * This is the axis that actually reads at 32px. The other thirteen states are
 * drawn once and tinted by the set's accent, because a magnifier is a
 * magnifier — inventing six of those would cost six times the drawing for a
 * shape nobody looks at long enough to recognise.
 */
type ArrowKind = 'arrow' | 'pointer-rod' | 'nib' | 'pencil' | 'leaf';

export interface CursorSetSpec {
  id: CursorSetId;
  /** What the settings sheet calls it. */
  name: string;
  /** One line of character, shown as the chip's tooltip. */
  blurb: string;
  arrow: ArrowKind;
  /** Interior detail colour. Never the body — see the header. */
  accent: string;
  /** The darker half of the accent, for a second face beside the first. */
  accentDeep: string;
  /** Ink weight in design units (the box is 32 across). */
  weight: number;
  /** Emitted size multiplier. 1 → a 32px cursor. */
  scale: number;
}

/**
 * Seven choices, and `system` is one of them on purpose.
 *
 * Someone running a HiDPI display, an enlarged pointer, or a Windows
 * accessibility cursor scheme has already chosen their cursor, and this app
 * has no business overriding it — so "the system's own" is not a disabled
 * state or a reset button, it is a first-class entry in the same row as the
 * rest. `features/settings/cursorSkin.ts` also forces it under
 * `forced-colors: active`, for the same reason `apply.ts` lets the OS win on
 * reduced motion.
 */
export const CURSOR_SETS: Readonly<Record<CursorSetId, CursorSetSpec>> = {
  system: {
    id: 'system',
    name: 'system',
    blurb: 'Windows draws the pointer, exactly as you have it set up.',
    arrow: 'arrow',
    accent: FLAT.gilt,
    accentDeep: FLAT.ochreDark,
    weight: 2.1,
    scale: 1,
  },
  paper: {
    id: 'paper',
    name: 'paper',
    blurb: 'The house arrow — cut from the same cream as the pages.',
    arrow: 'arrow',
    accent: FLAT.gilt,
    accentDeep: FLAT.ochreDark,
    weight: 2.1,
    scale: 1,
  },
  gilt: {
    id: 'gilt',
    name: 'reading room',
    blurb: 'A brass pointer with a bead on it, the kind kept beside an atlas.',
    arrow: 'pointer-rod',
    accent: FLAT.gilt,
    accentDeep: FLAT.ochreDark,
    weight: 2.1,
    scale: 1,
  },
  quill: {
    id: 'quill',
    name: 'scriptorium',
    blurb: 'A dip nib, slit and vent and collar, pointing where you point.',
    arrow: 'nib',
    accent: FLAT.slate,
    accentDeep: FLAT.slateDark,
    weight: 2.1,
    scale: 1,
  },
  pencil: {
    id: 'pencil',
    name: 'drafting',
    blurb: 'A sharpened pencil, banded, with the eraser still on it.',
    arrow: 'pencil',
    accent: FLAT.ochre,
    accentDeep: FLAT.ochreDark,
    weight: 2.1,
    scale: 1,
  },
  botanical: {
    id: 'botanical',
    name: 'herbarium',
    blurb: 'A pressed leaf, veined in moss, pointing by its own tip.',
    arrow: 'leaf',
    accent: FLAT.moss,
    accentDeep: FLAT.mossDark,
    weight: 2.1,
    scale: 1,
  },
  bold: {
    id: 'bold',
    name: 'plain & bold',
    blurb: 'The house arrow at 40px with a heavier line — for finding it fast.',
    arrow: 'arrow',
    accent: FLAT.terracotta,
    accentDeep: FLAT.terracottaDark,
    weight: 2.8,
    scale: 1.25,
  },
};

/**
 * The order the settings sheet offers them in: the system's own first (it is
 * the one choice that is about the reader's machine rather than about taste),
 * then the house arrow, then the five with a character.
 */
export const CURSOR_SET_IDS: readonly CursorSetId[] = [
  'system',
  'paper',
  'gilt',
  'quill',
  'pencil',
  'botanical',
  'bold',
];

export function isCursorSetId(value: unknown): value is CursorSetId {
  return (
    typeof value === 'string' &&
    (CURSOR_SET_IDS as readonly string[]).includes(value)
  );
}

/* ----------------------------------------------------------------------------
   Geometry — the flat vocabulary, in SVG path syntax

   `art/flat.ts` traces the same shapes into a canvas context. A cursor is a
   string, so these are the path-data twins of `wobbleRect` and friends: same
   deterministic jitter, same "nothing is axis-true" rule, no second idea of
   what a bowed edge is.
   -------------------------------------------------------------------------- */

/** The design box. Every glyph is drawn in 0..32 and scaled on the way out. */
const BOX = 32;

/** `flat.ts`'s jitter, verbatim: bowed, and the same every time. */
function jitter(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** Two decimals is a tenth of a device pixel at 32px, and halves the URI. */
function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

interface Pt {
  x: number;
  y: number;
}

const pt = (x: number, y: number): Pt => ({ x, y });

/**
 * A closed polygon whose every edge bows a little.
 *
 * The deflection is scaled by edge length so a 3-unit finger stub does not bow
 * as hard as a 22-unit arrow flank — at this size an unscaled bow turns a
 * short edge into a visible bulge.
 */
function bowPoly(points: readonly Pt[], seed: number, bow = 0.5): string {
  const first = points[0];
  if (first === undefined) return '';
  let d = `M ${num(first.x)} ${num(first.y)}`;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const k = jitter(seed + i) * bow * Math.min(1, len / 10);
    const cx = (a.x + b.x) / 2 - ((b.y - a.y) / len) * k;
    const cy = (a.y + b.y) / 2 + ((b.x - a.x) / len) * k;
    d += ` Q ${num(cx)} ${num(cy)} ${num(b.x)} ${num(b.y)}`;
  }
  return `${d} Z`;
}

/** `flat.wobbleRect`, as path data. */
function bowRect(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  seed: number,
  bow = Math.min(w, h) * 0.05,
): string {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  const b = (k: number): number => jitter(seed + k) * bow;
  return [
    `M ${num(x + r)} ${num(y)}`,
    `Q ${num(x + w / 2)} ${num(y + b(1))} ${num(x + w - r)} ${num(y)}`,
    `Q ${num(x + w)} ${num(y)} ${num(x + w)} ${num(y + r)}`,
    `Q ${num(x + w + b(2))} ${num(y + h / 2)} ${num(x + w)} ${num(y + h - r)}`,
    `Q ${num(x + w)} ${num(y + h)} ${num(x + w - r)} ${num(y + h)}`,
    `Q ${num(x + w / 2)} ${num(y + h + b(3))} ${num(x + r)} ${num(y + h)}`,
    `Q ${num(x)} ${num(y + h)} ${num(x)} ${num(y + h - r)}`,
    `Q ${num(x + b(4))} ${num(y + h / 2)} ${num(x)} ${num(y + r)}`,
    `Q ${num(x)} ${num(y)} ${num(x + r)} ${num(y)}`,
    'Z',
  ].join(' ');
}

/** A circle drawn by hand: four cubics, each quadrant a hair off the radius. */
function bowCircle(
  cx: number,
  cy: number,
  r: number,
  seed: number,
  bow = r * 0.06,
): string {
  const k = 0.5523;
  const rad = (i: number): number => r + jitter(seed + i) * bow;
  const [r0, r1, r2, r3] = [rad(0), rad(1), rad(2), rad(3)];
  return [
    `M ${num(cx + r0)} ${num(cy)}`,
    `C ${num(cx + r0)} ${num(cy + r0 * k)} ${num(cx + r1 * k)} ${num(cy + r1)} ${num(cx)} ${num(cy + r1)}`,
    `C ${num(cx - r1 * k)} ${num(cy + r1)} ${num(cx - r2)} ${num(cy + r2 * k)} ${num(cx - r2)} ${num(cy)}`,
    `C ${num(cx - r2)} ${num(cy - r2 * k)} ${num(cx - r3 * k)} ${num(cy - r3)} ${num(cx)} ${num(cy - r3)}`,
    `C ${num(cx + r3 * k)} ${num(cy - r3)} ${num(cx + r0)} ${num(cy - r0 * k)} ${num(cx + r0)} ${num(cy)}`,
    'Z',
  ].join(' ');
}

/** A single bowed line, for a slit or a vein. */
function bowLine(a: Pt, b: Pt, seed: number, bow = 0.6): string {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const k = jitter(seed) * bow;
  const cx = (a.x + b.x) / 2 - ((b.y - a.y) / len) * k;
  const cy = (a.y + b.y) / 2 + ((b.x - a.x) / len) * k;
  return `M ${num(a.x)} ${num(a.y)} Q ${num(cx)} ${num(cy)} ${num(b.x)} ${num(b.y)}`;
}

/* ---------------------------------- marks ---------------------------------- */

/** Flat fill, one ink outline, rounded joins. The workhorse. */
function shape(d: string, fill: string, weight: number): string {
  return (
    `<path d='${d}' fill='${fill}' stroke='${FLAT.ink}' ` +
    `stroke-width='${num(weight)}' stroke-linejoin='round' stroke-linecap='round'/>`
  );
}

/** An unfilled mark — a slit, a vein, a knuckle line. */
function mark(d: string, colour: string, width: number): string {
  return (
    `<path d='${d}' fill='none' stroke='${colour}' stroke-width='${num(width)}' ` +
    `stroke-linecap='round' stroke-linejoin='round'/>`
  );
}

/**
 * A rod: a coloured core laid over a fatter ink line.
 *
 * This is how a stroked (rather than filled) shape still obeys the one-outline
 * rule — the ink underneath shows as an even border on both sides, exactly as
 * if the core had been outlined. Used for the brass pointer's shaft, the
 * magnifier's handle and the nib's collar, all of which are lines rather than
 * areas and would need silly four-point polygons otherwise.
 */
function rod(d: string, core: string, coreWidth: number, weight: number): string {
  return mark(d, FLAT.ink, coreWidth + weight * 2) + mark(d, core, coreWidth);
}

/* ----------------------------------------------------------------------------
   The glyphs
   -------------------------------------------------------------------------- */

interface Glyph {
  /** Inner SVG markup, drawn in the 32-unit box. */
  body: string;
  /** Where the click lands, in the same 32-unit box. */
  hotspot: readonly [number, number];
}

/**
 * The classic arrow.
 *
 * The tip vertex sits at (3.4, 3.4) rather than at (2, 2), which looks wrong
 * written down and is right on screen: `stroke-linejoin='round'` pushes the
 * apex of a 49° corner out along its bisector by (weight / 2) / sin(24.5°) —
 * about 2.5 units at the house weight — so a vertex any closer to the corner
 * puts the INK outside the image and the browser clips the point off the
 * pointer. The hotspot is where that rounded ink apex actually lands.
 */
function arrowClassic(spec: CursorSetSpec): Glyph {
  const w = spec.weight;
  const tail = [pt(9.2, 19.3), pt(12.9, 28.3), pt(16.8, 26.6), pt(13.4, 18.1)];
  const body = shape(
    bowPoly(
      [
        pt(3.4, 3.4),
        pt(3.4, 24.2),
        tail[0]!,
        tail[1]!,
        tail[2]!,
        tail[3]!,
        pt(20.6, 17.9),
      ],
      11,
      0.45,
    ),
    FLAT.cream,
    w,
  );
  // The tail is a second FACE, not a stripe.
  //
  // It was a stripe, drawn across the tail as a rod, and it read as a scrap of
  // paper caught on the arrow — because the tail is only ~4.4 units wide and a
  // 2-unit ink outline leaves barely two units of interior for a band to cross.
  // A whole face in the accent is the same idea the icon uses for a book's
  // spine beside its cover: a darker flat plane next to a lighter one, ink on
  // the seam, no shading anywhere.
  const face = shape(bowPoly(tail, 13, 0.4), spec.accent, w * 0.9);
  return { body: body + face, hotspot: [2, 2] };
}

/**
 * The brass pointer: a dart head on a slim rod, with a bead at the tail.
 *
 * The head was a stroked chevron — two lines meeting at a right angle — and at
 * a 7-unit ink width `stroke-linejoin: round` turned that corner into a
 * quarter-circle, so the whole thing read as a rounded bracket rather than as
 * an arrow. A FILLED dart has a corner because its outline has one, and the
 * concave waist is what stops it reading as a plain triangle.
 */
function arrowRod(spec: CursorSetSpec): Glyph {
  const w = spec.weight;
  const shaft = rod(
    bowLine(pt(9.4, 9.4), pt(24.4, 24.4), 7, 0.4),
    FLAT.cream,
    3.4,
    w,
  );
  const head = shape(
    bowPoly([pt(3.2, 3.2), pt(14.4, 4.6), pt(10.4, 10.4), pt(4.6, 14.4)], 9, 0.35),
    FLAT.cream,
    w,
  );
  const stud = shape(bowCircle(17, 17, 2.6, 5), spec.accentDeep, w * 0.8);
  const bead = shape(bowCircle(24.6, 24.6, 3.9, 3), spec.accent, w);
  return { body: shaft + head + stud + bead, hotspot: [2, 2] };
}

/** The dip nib: a lozenge on the diagonal, with a slit, a vent and a collar. */
function arrowNib(spec: CursorSetSpec): Glyph {
  const w = spec.weight;
  const body = shape(
    bowPoly(
      [pt(3.6, 3.6), pt(18.4, 9.9), pt(24.4, 18.4), pt(18.4, 24.4), pt(9.9, 18.4)],
      17,
      0.5,
    ),
    FLAT.cream,
    w,
  );
  const collar = rod(
    bowLine(pt(17.4, 24.2), pt(24.2, 17.4), 6, 0.3),
    spec.accent,
    2.6,
    w * 0.8,
  );
  const slit = mark(bowLine(pt(5.4, 5.4), pt(12.2, 12.2), 8, 0.35), FLAT.ink, 1.5);
  const vent = shape(bowCircle(14.6, 14.6, 2.3, 4), spec.accentDeep, w * 0.75);
  return { body: body + slit + vent + collar, hotspot: [2, 2] };
}

/**
 * The pencil, drawn upright and turned onto the diagonal.
 *
 * Drawing it upright and rotating is not laziness — a pencil is a stack of
 * bands across one axis, and describing that stack at 45° by hand would mean
 * eight rotated rectangles whose corners have to agree. The rotation is a
 * single SVG transform and the geometry stays readable.
 *
 * What the rotation DOES cost is a length budget, and getting it wrong is
 * invisible in the source. A point at (x, y) lands at 16 + 0.7071·((x−16) +
 * (y−16)) horizontally, so a pencil drawn 39 units long with a 7.8-unit barrel
 * put its eraser's outer corner at x ≈ 34 — four units past the edge of the
 * image, where the browser simply cuts the cursor off. The stack below ends at
 * y = 31.6, which is the most a 7.8-wide barrel can carry: 0.7071·(15.6 + 3.9)
 * = 13.8, plus the ink, inside 16.
 */
function arrowPencil(spec: CursorSetSpec): Glyph {
  const w = spec.weight;
  const parts = [
    // graphite point
    shape(bowPoly([pt(16, -2), pt(13.3, 3.8), pt(18.7, 3.8)], 21, 0.3), FLAT.ink, w * 0.7),
    // bared wood
    shape(
      bowPoly([pt(13.3, 3.6), pt(18.7, 3.6), pt(19.9, 7.8), pt(12.1, 7.8)], 23, 0.35),
      FLAT.creamDeep,
      w * 0.85,
    ),
    // barrel
    shape(bowRect(12.1, 7.4, 7.8, 17.4, 1.4, 25), FLAT.cream, w),
    // two painted bands, the set's accent
    rod(bowLine(pt(12.6, 12.4), pt(19.4, 12.4), 27, 0.2), spec.accent, 2.2, 0.5),
    rod(bowLine(pt(12.6, 16), pt(19.4, 16), 29, 0.2), spec.accentDeep, 1.6, 0.5),
    // ferrule + eraser
    shape(bowRect(12.1, 24.4, 7.8, 3.6, 1, 31), FLAT.creamDeep, w * 0.85),
    shape(bowRect(12.5, 27.8, 7, 3.8, 1.8, 33), FLAT.terracotta, w * 0.85),
  ].join('');
  return {
    body: `<g transform='rotate(-45 16 16)'>${parts}</g>`,
    hotspot: [2, 2],
  };
}

/** The pressed leaf: two arcs meeting at a point, veined in the set's accent. */
function arrowLeaf(spec: CursorSetSpec): Glyph {
  const w = spec.weight;
  const outline =
    `M 3.6 3.6 Q 22.4 6.6 25.8 25.8 Q 6.6 22.4 3.6 3.6 Z`;
  const body = shape(outline, FLAT.cream, w);
  const midrib = mark(bowLine(pt(5.4, 5.4), pt(23.6, 23.6), 12, 0.5), spec.accentDeep, 1.7);
  const veins = [
    mark(bowLine(pt(9.4, 9.4), pt(16.4, 11.2), 13, 0.5), spec.accent, 1.2),
    mark(bowLine(pt(13.2, 13.2), pt(20.2, 15.4), 14, 0.5), spec.accent, 1.2),
    mark(bowLine(pt(9.4, 9.4), pt(11.2, 16.4), 15, 0.5), spec.accent, 1.2),
    mark(bowLine(pt(13.2, 13.2), pt(15.4, 20.2), 16, 0.5), spec.accent, 1.2),
  ].join('');
  return { body: body + midrib + veins, hotspot: [2, 2] };
}

const ARROWS: Record<ArrowKind, (spec: CursorSetSpec) => Glyph> = {
  arrow: arrowClassic,
  'pointer-rod': arrowRod,
  nib: arrowNib,
  pencil: arrowPencil,
  leaf: arrowLeaf,
};

/* ------------------------------- the hands --------------------------------- */

/**
 * The pointing hand.
 *
 * A five-fingered hand is unreadable at 32px, so this is a mitt: one raised
 * finger, one thumb, one palm, one cuff. The finger is drawn first and the
 * palm laid over it, which is how `flat.ts` gets a joint — a darker face
 * meeting a lighter one — without a shading pass.
 */
function handPointing(spec: CursorSetSpec): Glyph {
  const w = spec.weight;
  const parts = [
    // the raised finger, off-centre to the left the way a real one is
    shape(bowRect(9.8, 2.6, 5, 13.8, 2.5, 41), FLAT.cream, w),
    // the other three, curled: one block with two creases rather than three
    // shapes, because three 3-unit shapes at 32px is a smudge
    shape(bowRect(15, 10.6, 9.8, 6.6, 2.8, 43), FLAT.cream, w),
    shape(bowRect(4.6, 15.2, 5, 7.2, 2.4, 45), FLAT.creamDeep, w),
    shape(bowRect(7.4, 14.4, 17.2, 12.8, 4.4, 47), FLAT.cream, w),
    rod(bowLine(pt(8.4, 24.6), pt(23.6, 24.6), 49, 0.3), spec.accent, 2.4, 0.6),
    mark(bowLine(pt(18.4, 11.6), pt(18.4, 14.6), 51, 0.25), FLAT.inkSoft, 1.1),
    mark(bowLine(pt(21.6, 11.9), pt(21.6, 14.8), 53, 0.25), FLAT.inkSoft, 1.1),
  ].join('');
  return { body: parts, hotspot: [12, 2] };
}

/** The open hand: four stubs and a thumb, then the palm laid over them. */
function handOpen(spec: CursorSetSpec): Glyph {
  const w = spec.weight;
  const parts = [
    shape(bowRect(9.2, 6.2, 3.9, 9, 1.9, 53), FLAT.cream, w * 0.9),
    shape(bowRect(13.4, 4.6, 3.9, 10.6, 1.9, 55), FLAT.cream, w * 0.9),
    shape(bowRect(17.6, 5.4, 3.9, 9.8, 1.9, 57), FLAT.cream, w * 0.9),
    shape(bowRect(21.6, 7.6, 3.7, 8, 1.8, 59), FLAT.cream, w * 0.9),
    shape(bowRect(4.4, 15.2, 5, 7.6, 2.4, 61), FLAT.creamDeep, w * 0.9),
    shape(bowRect(8.2, 12.8, 16.6, 14.4, 4.6, 63), FLAT.cream, w),
    rod(bowLine(pt(9, 24.6), pt(24, 24.6), 65, 0.3), spec.accent, 2.4, 0.6),
  ].join('');
  return { body: parts, hotspot: [16, 14] };
}

/** The fist: the same hand with the stubs pulled down into knuckles. */
function handClosed(spec: CursorSetSpec): Glyph {
  const w = spec.weight;
  const parts = [
    shape(bowRect(9.6, 9.4, 4.2, 5.2, 2.1, 67), FLAT.cream, w * 0.9),
    shape(bowRect(14.2, 8.8, 4.2, 5.6, 2.1, 69), FLAT.cream, w * 0.9),
    shape(bowRect(18.8, 9.6, 4.2, 5, 2.1, 71), FLAT.cream, w * 0.9),
    shape(bowRect(5.4, 15.8, 5.2, 6.4, 2.5, 73), FLAT.creamDeep, w * 0.9),
    shape(bowRect(8.4, 13.2, 16.2, 14, 4.8, 75), FLAT.cream, w),
    // Two short creases between the knuckles. One long one ran the width of
    // the palm and read as a slot in a money box.
    mark(bowLine(pt(13.9, 14.8), pt(13.9, 17.6), 77, 0.25), FLAT.inkSoft, 1.15),
    mark(bowLine(pt(18.6, 14.8), pt(18.6, 17.6), 79, 0.25), FLAT.inkSoft, 1.15),
    rod(bowLine(pt(9.2, 24.4), pt(23.8, 24.4), 81, 0.3), spec.accent, 2.4, 0.6),
  ].join('');
  return { body: parts, hotspot: [16, 15] };
}

/* ------------------------------ the mechanics ------------------------------ */

/** The I-beam, cut as one shape so it carries a single unbroken outline. */
function beam(spec: CursorSetSpec): Glyph {
  const w = spec.weight;
  const body = shape(
    bowPoly(
      [
        pt(9.6, 3.8),
        pt(22.4, 3.8),
        pt(22.4, 7.4),
        pt(18.4, 7.4),
        pt(18.4, 24.6),
        pt(22.4, 24.6),
        pt(22.4, 28.2),
        pt(9.6, 28.2),
        pt(9.6, 24.6),
        pt(13.6, 24.6),
        pt(13.6, 7.4),
        pt(9.6, 7.4),
      ],
      81,
      0.3,
    ),
    FLAT.cream,
    w,
  );
  const rule = mark(bowLine(pt(16, 9.4), pt(16, 22.6), 83, 0.35), spec.accent, 1.6);
  return { body: body + rule, hotspot: [16, 16] };
}

/**
 * The refusal.
 *
 * Terracotta whatever the set, because this one is not decoration: it is the
 * cursor the reader sees when a drag is about to be thrown away, and the
 * onboarding report ("it shows stop sign on his cursor") is about someone
 * reading it correctly and being frightened by it. A warning that changes
 * colour with the theme is a warning you have to learn twice.
 */
function noEntry(spec: CursorSetSpec): Glyph {
  const w = spec.weight;
  const disc = shape(bowCircle(16, 16, 11.4, 87), FLAT.terracotta, w);
  const bar = shape(
    bowRect(6.6, 13.6, 18.8, 4.8, 1.8, 89),
    FLAT.cream,
    w * 0.85,
  );
  return {
    body: disc + `<g transform='rotate(-45 16 16)'>${bar}</g>`,
    hotspot: [16, 16],
  };
}

/** A double-headed arrow lying along the x axis, `reach` long each way. */
function doubleArrow(spec: CursorSetSpec, reach: number): string {
  const w = spec.weight;
  const head = 6.4;
  const barb = 5.6;
  const shaft = 2.5;
  const shaftEnd = reach - head;
  const outline = bowPoly(
    [
      pt(16 - reach, 16),
      pt(16 - shaftEnd, 16 - barb),
      pt(16 - shaftEnd, 16 - shaft),
      pt(16 + shaftEnd, 16 - shaft),
      pt(16 + shaftEnd, 16 - barb),
      pt(16 + reach, 16),
      pt(16 + shaftEnd, 16 + barb),
      pt(16 + shaftEnd, 16 + shaft),
      pt(16 - shaftEnd, 16 + shaft),
      pt(16 - shaftEnd, 16 + barb),
    ],
    91,
    0.35,
  );
  const collar = rod(
    bowLine(pt(16, 16 - shaft + 0.6), pt(16, 16 + shaft - 0.6), 93, 0.2),
    spec.accent,
    1.8,
    0.5,
  );
  return shape(outline, FLAT.cream, w) + collar;
}

/** The four-way, cut as one 24-point star so the outline never crosses itself. */
function fourWay(spec: CursorSetSpec): Glyph {
  const w = spec.weight;
  const a = 2.5;
  const b = 5.6;
  const c = 8.8;
  const d = 13.2;
  const at = (dx: number, dy: number): Pt => pt(16 + dx, 16 + dy);
  const outline = bowPoly(
    [
      at(-a, -a),
      at(-a, -c),
      at(-b, -c),
      at(0, -d),
      at(b, -c),
      at(a, -c),
      at(a, -a),
      at(c, -a),
      at(c, -b),
      at(d, 0),
      at(c, b),
      at(c, a),
      at(a, a),
      at(a, c),
      at(b, c),
      at(0, d),
      at(-b, c),
      at(-a, c),
      at(-a, a),
      at(-c, a),
      at(-c, b),
      at(-d, 0),
      at(-c, -b),
      at(-c, -a),
    ],
    95,
    0.25,
  );
  const hub = shape(bowCircle(16, 16, 2.4, 97), spec.accent, w * 0.75);
  return { body: shape(outline, FLAT.cream, w) + hub, hotspot: [16, 16] };
}

/** The magnifier. `sign` draws the plus, the minus, or nothing. */
function loupe(spec: CursorSetSpec, sign: 1 | -1): Glyph {
  const w = spec.weight;
  const handle = rod(
    bowLine(pt(19.4, 19.4), pt(27, 27), 99, 0.4),
    spec.accent,
    3.6,
    w,
  );
  const lens = shape(bowCircle(13.4, 13.4, 8.8, 101), FLAT.cream, w);
  const bars =
    mark(bowLine(pt(9.2, 13.4), pt(17.6, 13.4), 103, 0.3), FLAT.ink, 2.4) +
    (sign === 1
      ? mark(bowLine(pt(13.4, 9.2), pt(13.4, 17.6), 105, 0.3), FLAT.ink, 2.4)
      : '');
  return { body: handle + lens + bars, hotspot: [13, 13] };
}

/**
 * Working.
 *
 * A cursor cannot animate, so "busy" has to be a STATE rather than a spinner:
 * the set's own arrow with a paper token clipped to it, three dots on the
 * token. Drawn last so it sits over the arrow's tail rather than under it.
 */
function busy(spec: CursorSetSpec): Glyph {
  const w = spec.weight;
  const arrow = ARROWS[spec.arrow](spec);
  const token = shape(bowCircle(24.2, 24.2, 6.6, 107), FLAT.creamDeep, w);
  const dots = [pt(21.2, 24.2), pt(24.2, 24.2), pt(27.2, 24.2)]
    .map((d, i) => shape(bowCircle(d.x, d.y, 1.15, 109 + i, 0.08), FLAT.ink, 0))
    .join('');
  return { body: arrow.body + token + dots, hotspot: arrow.hotspot };
}

/**
 * The crosshair: four bars around a gap, not a drawn X.
 *
 * The gap is the whole point of this cursor — it exists so you can see the
 * pixel you are aiming at — so the accent dot at the middle is deliberately
 * small and the bars stop well short of it.
 */
function crosshair(spec: CursorSetSpec): Glyph {
  const w = spec.weight;
  const arm = 9.6;
  const thick = 3.6;
  const gap = 4.4;
  const bars = [
    bowRect(16 - thick / 2, 16 - gap - arm, thick, arm, 1.5, 111),
    bowRect(16 - thick / 2, 16 + gap, thick, arm, 1.5, 113),
    bowRect(16 - gap - arm, 16 - thick / 2, arm, thick, 1.5, 115),
    bowRect(16 + gap, 16 - thick / 2, arm, thick, 1.5, 117),
  ]
    .map((d) => shape(d, FLAT.cream, w * 0.85))
    .join('');
  const pip = shape(bowCircle(16, 16, 1.9, 119), spec.accent, w * 0.7);
  return { body: bars + pip, hotspot: [16, 16] };
}

/** Asking: the set's arrow with a question stamped on a paper token. */
function query(spec: CursorSetSpec): Glyph {
  const w = spec.weight;
  const arrow = ARROWS[spec.arrow](spec);
  // The token is paper, not the set's accent. It was the accent, and the ink
  // question mark on Scriptorium's slate was two mid-tones on top of each
  // other — legible on a board at 200px, a smudge at 32. The badge has to be
  // the lightest thing in the glyph for the mark on it to read at all.
  const token = shape(bowCircle(24.2, 24.2, 6.8, 121), FLAT.creamDeep, w);
  const hook = mark(
    'M 21.7 21.6 Q 21.9 19.2 24.2 19.2 Q 26.7 19.2 26.7 21.5 Q 26.7 23.2 24.3 24 L 24.3 25.6',
    FLAT.ink,
    1.9,
  );
  const dot = shape(bowCircle(24.3, 27.9, 1.1, 123, 0.08), FLAT.ink, 0);
  return { body: arrow.body + token + hook + dot, hotspot: arrow.hotspot };
}

/* ----------------------------------------------------------------------------
   Assembly
   -------------------------------------------------------------------------- */

function glyph(spec: CursorSetSpec, role: CursorRole): Glyph {
  switch (role) {
    case 'default':
      return ARROWS[spec.arrow](spec);
    case 'pointer':
      return handPointing(spec);
    case 'text':
      return beam(spec);
    case 'grab':
      return handOpen(spec);
    case 'grabbing':
      return handClosed(spec);
    case 'not-allowed':
      return noEntry(spec);
    case 'ew-resize':
      return { body: doubleArrow(spec, 13.6), hotspot: [16, 16] };
    case 'ns-resize':
      return {
        body: `<g transform='rotate(90 16 16)'>${doubleArrow(spec, 13.6)}</g>`,
        hotspot: [16, 16],
      };
    case 'nwse-resize':
      return {
        body: `<g transform='rotate(45 16 16)'>${doubleArrow(spec, 11.4)}</g>`,
        hotspot: [16, 16],
      };
    case 'nesw-resize':
      return {
        body: `<g transform='rotate(-45 16 16)'>${doubleArrow(spec, 11.4)}</g>`,
        hotspot: [16, 16],
      };
    case 'move':
      return fourWay(spec);
    case 'zoom-in':
      return loupe(spec, 1);
    case 'zoom-out':
      return loupe(spec, -1);
    case 'progress':
      return busy(spec);
    case 'crosshair':
      return crosshair(spec);
    case 'help':
      return query(spec);
  }
}

/** One drawn cursor: the markup, the data URI, the hotspot and the size. */
export interface CursorImage {
  /** The complete `<svg>` document, for a specimen board or a test. */
  svg: string;
  /** The same document as a `data:` URI, ready for `url()`. */
  url: string;
  /** Hotspot in emitted pixels — what goes after `url()` in the CSS value. */
  hotspot: readonly [number, number];
  /** Emitted width and height, in CSS pixels. */
  size: number;
}

const IMAGE_CACHE = new Map<string, CursorImage>();

/**
 * The drawn cursor for a set and a state, or `null` for the system set.
 *
 * Memoized because the settings sheet renders all fourteen states for the
 * selected set and the installer re-reads the same fourteen on every settings
 * write — and a data URI is a few hundred bytes of string building that has no
 * reason to happen twice.
 */
export function cursorImage(
  set: CursorSetId,
  role: CursorRole,
): CursorImage | null {
  if (set === 'system') return null;
  const key = `${set}|${role}`;
  const hit = IMAGE_CACHE.get(key);
  if (hit !== undefined) return hit;

  const spec = CURSOR_SETS[set];
  const drawn = glyph(spec, role);
  const size = Math.round(BOX * spec.scale);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' ` +
    `viewBox='0 0 ${BOX} ${BOX}'>${drawn.body}</svg>`;
  const image: CursorImage = {
    svg,
    url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    hotspot: [
      Math.round(drawn.hotspot[0] * spec.scale),
      Math.round(drawn.hotspot[1] * spec.scale),
    ],
    size,
  };
  IMAGE_CACHE.set(key, image);
  return image;
}

/**
 * The complete CSS `cursor` value for a set and a state.
 *
 * Always ends in the keyword: a `cursor: url(...)` with no fallback is a
 * cursor that vanishes if the image is ever refused, and the app would have no
 * way to know. For `system` the value IS the keyword and nothing else.
 */
export function cursorValue(set: CursorSetId, role: CursorRole): string {
  const image = cursorImage(set, role);
  const fallback = CURSOR_FALLBACK[role];
  if (image === null) return fallback;
  return `url("${image.url}") ${image.hotspot[0]} ${image.hotspot[1]}, ${fallback}`;
}

/**
 * Every state of a set, as the custom properties `styles/cursors.css` reads.
 *
 * The `system` set returns the plain keywords rather than an empty object, so
 * a caller that writes these onto the document always writes a COMPLETE map —
 * a half-written map is how a stale url from the previous set survives on one
 * state that the new set happened not to define.
 */
export function cursorVars(set: CursorSetId): Record<string, string> {
  const out: Record<string, string> = {};
  for (const role of CURSOR_ROLES) out[cursorVarName(role)] = cursorValue(set, role);
  return out;
}

/**
 * Utility classes `styles/cursors.css` publishes, so a feature can ask for a
 * state the app's own stylesheets do not already name — the two zoom cursors
 * have no home in the tree yet, and a drawn cursor nothing can reach is a
 * drawing, not a feature.
 */
export const CURSOR_CLASSES: Readonly<Record<CursorRole, string>> =
  Object.fromEntries(
    CURSOR_ROLES.map((role) => [role, `nb-cur-${role}`]),
  ) as Record<CursorRole, string>;
