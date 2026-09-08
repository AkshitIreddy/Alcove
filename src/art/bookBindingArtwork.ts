/**
 * bookBindingArtwork.ts — authored flat artwork for the live book vocabulary.
 *
 * This is deliberately a drawing asset library rather than another catalogue.
 * `bookDesign.ts` remains the authority for ids, names and composition.  The
 * functions here replace the generic material/tooling marks with full-sized,
 * hand-authored binding construction which survives a 20–45px shelf spine.
 *
 * The visual grammar is the one used by the Alcove mark: flat faces, one dark
 * ink, gently bowed rules and a small palette.  There are no gradients, blur,
 * lighting, photographic grain or repeating wallpaper fields.
 */

import { FLAT, type FlatCtx } from './flat';
import { paintRemasteredEmblem } from './bookEmblemArtwork';
import { bindingEmblemIndexForAuthoredFocal } from './bookBindingIdentity';

export interface BindingArtworkBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ACTIVE_BINDING_SHAPE_ARTWORK_IDS = [
  'square',
  'tight-back',
  'double-hinge',
] as const;

export interface BindingShapeArtworkParams {
  shape: string;
  seed: number;
  board: string;
}

/**
 * The active silhouettes are all sober square-ended books; their distinction
 * is the way the back meets the boards.  This pass makes those joints physical
 * and legible without changing the footprint or resurrecting novelty outlines.
 */
export function drawActiveBindingShapeArtwork(
  _ctx: FlatCtx,
  _b: BindingArtworkBox,
  p: BindingShapeArtworkParams,
): boolean {
  if (!(ACTIVE_BINDING_SHAPE_ARTWORK_IDS as readonly string[]).includes(p.shape)) return false;
  // The outer spine path already carries each active shape's gently bowed
  // silhouette. Extra shoulder hooks read as damage at 24–40px, so the shape
  // layer stays structural and lets material and tooling own the interior.
  return true;
}

export interface BindingMaterialArtworkColours {
  face: string;
  board: string;
  accentFace: string;
  accentBoard: string;
}

export interface BindingMaterialArtworkParams extends BindingMaterialArtworkColours {
  material: string;
  seed: number;
}

const ACTIVE_MATERIAL_ART_IDS = [
  'smooth-cloth',
  'buckram',
  'linen',
  'felt',
  'velvet',
  'polished-calf',
  'morocco-grain',
  'russia-calf',
  'roan',
  'oilcloth',
  'vellum',
  'parchment',
  'alum-tawed',
  'paper-wrapper',
  'half-bound',
  'quarter-bound',
  'three-quarter',
  'half-cloth-paper',
] as const;

export type ActiveMaterialArtworkId = (typeof ACTIVE_MATERIAL_ART_IDS)[number];
export const ACTIVE_BINDING_MATERIAL_ARTWORK_IDS: readonly ActiveMaterialArtworkId[] =
  ACTIVE_MATERIAL_ART_IDS;

const ACTIVE_MATERIAL_SET: ReadonlySet<string> = new Set(ACTIVE_MATERIAL_ART_IDS);

function fillRect(ctx: FlatCtx, x: number, y: number, w: number, h: number, colour: string): void {
  ctx.fillStyle = colour;
  ctx.fillRect(x, y, w, h);
}

function materialRule(
  ctx: FlatCtx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  seed: number,
): void {
  cleanRule(ctx, x0, y0, x1, y1, FLAT.ink, Math.max(0.82, width), seed);
}

/** One crisp, very gently bowed binder's rule. */
function cleanRule(
  ctx: FlatCtx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  colour: string,
  width: number,
  seed: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.max(1, Math.hypot(dx, dy));
  const bow = (((seed >>> 0) % 5) - 2) * 0.055;
  const nx = (-dy / length) * bow;
  const ny = (dx / length) * bow;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo((x0 + x1) / 2 + nx, (y0 + y1) / 2 + ny, x1, y1);
  ctx.strokeStyle = colour;
  ctx.lineWidth = Math.max(0.7, width);
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
}

function faceRail(
  ctx: FlatCtx,
  b: BindingArtworkBox,
  at: number,
  width: number,
  colour: string,
  seed: number,
  _ruleSide: 'left' | 'right' | 'both' = 'right',
): void {
  const rx = b.x + b.w * at;
  const rw = b.w * width;
  fillRect(ctx, rx, b.y - b.h * 0.02, rw, b.h * 1.04, colour);
  // One inner seam is enough to explain a turned covering. Outlining both
  // edges of every colour strip produced the ladder of parallel uprights seen
  // in the rejected specimen.
  const seam = at >= 0.5 ? rx : rx + rw;
  materialRule(ctx, seam, b.y + b.h * 0.035, seam, b.y + b.h * 0.965,
    Math.max(0.75, b.w * 0.027), seed);
}

function terminalTurn(
  ctx: FlatCtx,
  b: BindingArtworkBox,
  at: 'head' | 'tail',
  depth: number,
  inset: number,
  colour: string,
  seed: number,
): void {
  const top = at === 'head' ? b.y + b.h * 0.015 : b.y + b.h * (1 - 0.015 - depth);
  fillRect(ctx, b.x + b.w * inset, top, b.w * (1 - inset * 2), b.h * depth, colour);
  const sy = at === 'head' ? top + b.h * depth : top;
  materialRule(
    ctx,
    b.x + b.w * (inset + 0.035),
    sy,
    b.x + b.w * (0.965 - inset),
    sy,
    Math.max(0.82, b.w * 0.03),
    seed,
  );
}

function foldedCorner(
  ctx: FlatCtx,
  b: BindingArtworkBox,
  corner: 'tl' | 'tr' | 'bl' | 'br',
  colour: string,
  seed: number,
): void {
  const left = corner.endsWith('l');
  const top = corner.startsWith('t');
  const x0 = left ? b.x : b.x + b.w;
  const y0 = top ? b.y : b.y + b.h;
  const dx = (left ? 1 : -1) * b.w * 0.25;
  const dy = (top ? 1 : -1) * Math.min(b.h * 0.055, b.w * 0.5);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + dx, y0);
  ctx.quadraticCurveTo(
    x0 + dx * 0.42,
    y0 + dy * 0.58,
    x0,
    y0 + dy,
  );
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  materialRule(ctx, x0 + dx, y0, x0, y0 + dy, Math.max(0.78, b.w * 0.028), seed);
}

/**
 * Paint one complete active spine material.  Returns false for archival ids so
 * `bookDesign.ts` can keep its compatibility painter for already-saved books.
 */
export function drawActiveBindingMaterialArtwork(
  ctx: FlatCtx,
  b: BindingArtworkBox,
  p: BindingMaterialArtworkParams,
): boolean {
  if (!ACTIVE_MATERIAL_SET.has(p.material)) return false;
  const { face, board, accentFace, accentBoard, seed } = p;
  const head = (depth: number, inset: number, colour: string, n: number): void =>
    terminalTurn(ctx, b, 'head', depth, inset, colour, seed + n);
  const tail = (depth: number, inset: number, colour: string, n: number): void =>
    terminalTurn(ctx, b, 'tail', depth, inset, colour, seed + n);
  const turnPair = (depth: number, inset: number, colour: string, n: number): void => {
    head(depth, inset, colour, n);
    tail(depth, inset, colour, n + 2);
  };

  // The split families wear their second covering continuously over the back.
  const split = p.material === 'half-bound' || p.material === 'quarter-bound' ||
    p.material === 'three-quarter' || p.material === 'half-cloth-paper';
  fillRect(ctx, b.x - b.w, b.y - b.h * 0.03, b.w * 3, b.h * 1.06, split ? accentFace : face);

  switch (p.material as ActiveMaterialArtworkId) {
    case 'smooth-cloth':
      // The house cloth is deliberately plain. Its weave belongs to the
      // colour, not a stack of marks that competes with the tooling.
      break;

    case 'buckram':
      turnPair(0.04, 0.08, accentBoard, 24);
      break;

    case 'linen':
      turnPair(0.02, 0.2, accentFace, 34);
      break;

    case 'felt':
      faceRail(ctx, b, 0.84, 0.13, board, seed + 43, 'left');
      turnPair(0.03, 0.16, board, 44);
      break;

    case 'velvet':
      faceRail(ctx, b, 0.86, 0.11, board, seed + 52, 'left');
      turnPair(0.028, 0.18, board, 54);
      break;

    case 'polished-calf':
      // A polished calf back is the calmest leather ground.
      break;

    case 'morocco-grain':
      faceRail(ctx, b, 0.86, 0.11, board, seed + 72, 'left');
      turnPair(0.024, 0.2, accentBoard, 74);
      break;

    case 'russia-calf':
      faceRail(ctx, b, 0.78, 0.19, board, seed + 82, 'left');
      turnPair(0.03, 0.12, accentBoard, 84);
      break;

    case 'roan':
      faceRail(ctx, b, 0.91, 0.06, board, seed + 92, 'left');
      break;

    case 'oilcloth':
      turnPair(0.048, 0.08, accentBoard, 104);
      break;

    case 'vellum':
      faceRail(ctx, b, 0.88, 0.085, board, seed + 112, 'left');
      turnPair(0.042, 0.14, accentFace, 114);
      break;

    case 'parchment':
      faceRail(ctx, b, 0.88, 0.085, board, seed + 132, 'left');
      turnPair(0.018, 0.22, accentFace, 134);
      break;

    case 'alum-tawed':
      faceRail(ctx, b, 0.86, 0.105, board, seed + 142, 'left');
      turnPair(0.034, 0.16, accentBoard, 144);
      break;

    case 'paper-wrapper':
      faceRail(ctx, b, 0.91, 0.06, board, seed + 152, 'left');
      turnPair(0.022, 0.22, accentFace, 154);
      break;

    case 'half-bound':
      faceRail(ctx, b, 0.78, 0.19, accentBoard, seed + 172, 'left');
      turnPair(0.03, 0.1, board, 178);
      break;

    case 'quarter-bound':
      faceRail(ctx, b, 0.88, 0.1, accentBoard, seed + 192, 'left');
      turnPair(0.02, 0.2, face, 194);
      break;

    case 'three-quarter':
      faceRail(ctx, b, 0.72, 0.26, accentBoard, seed + 202, 'left');
      turnPair(0.034, 0.07, board, 206);
      break;

    case 'half-cloth-paper':
      faceRail(ctx, b, 0.78, 0.2, accentBoard, seed + 222, 'left');
      turnPair(0.027, 0.14, board, 226);
      break;
  }
  return true;
}

export interface BindingCoverMaterialArtworkParams extends BindingMaterialArtworkParams {
  /** Board edge on which the spine sits. */
  spineSide?: 'left' | 'right';
}

/**
 * Matching board-face construction for `covers.ts`.  It is synchronous canvas
 * artwork so the cover renderer can call it inside its existing clip without
 * loading an image or adding another cache axis.
 */
export function drawBindingCoverMaterialArtwork(
  ctx: FlatCtx,
  b: BindingArtworkBox,
  p: BindingCoverMaterialArtworkParams,
): boolean {
  if (!ACTIVE_MATERIAL_SET.has(p.material)) return false;
  const side = p.spineSide ?? 'left';
  const flip = side === 'left' ? 1 : -1;
  const edge = side === 'left' ? b.x : b.x + b.w;
  const split = p.material === 'half-bound' || p.material === 'quarter-bound' ||
    p.material === 'three-quarter' || p.material === 'half-cloth-paper';
  fillRect(ctx, b.x, b.y, b.w, b.h, split ? p.face : p.face);

  const spineFraction: Record<string, number> = {
    'half-bound': 0.24,
    'quarter-bound': 0.16,
    'three-quarter': 0.34,
    'half-cloth-paper': 0.22,
  };
  const railFraction = spineFraction[p.material];
  if (railFraction !== undefined) {
    const rw = b.w * railFraction;
    fillRect(ctx, side === 'left' ? edge : edge - rw, b.y, rw, b.h, p.accentFace);
    materialRule(ctx, edge + flip * rw, b.y + b.h * 0.025, edge + flip * rw,
      b.y + b.h * 0.975, Math.max(0.9, Math.min(b.w, b.h) * 0.012), p.seed + 310);
    const corner = p.material === 'quarter-bound' ? 0 :
      p.material === 'three-quarter' ? 0.25 : 0.17;
    if (corner > 0) {
      const cw = b.w * corner;
      const ch = b.h * corner;
      for (const top of [true, false]) {
        const y0 = top ? b.y : b.y + b.h;
        ctx.beginPath();
        ctx.moveTo(side === 'left' ? b.x + b.w : b.x, y0);
        const topEndX = side === 'left' ? b.x + b.w - cw : b.x + cw;
        const edgeEndX = side === 'left' ? b.x + b.w : b.x;
        const edgeEndY = top ? y0 + ch : y0 - ch;
        ctx.lineTo(topEndX, y0);
        ctx.quadraticCurveTo(
          (topEndX + edgeEndX) / 2 + flip * b.w * 0.012,
          (y0 + edgeEndY) / 2,
          edgeEndX,
          edgeEndY,
        );
        ctx.closePath();
        ctx.fillStyle = p.accentFace;
        ctx.fill();
        ctx.strokeStyle = FLAT.ink;
        ctx.lineWidth = Math.max(0.9, Math.min(b.w, b.h) * 0.01);
        ctx.stroke();
      }
    }
    return true;
  }

  const turnScale: Readonly<Record<string, number>> = {
    'smooth-cloth': 0.042,
    buckram: 0.072,
    linen: 0.032,
    felt: 0.085,
    velvet: 0.058,
    'polished-calf': 0.05,
    'morocco-grain': 0.078,
    'russia-calf': 0.09,
    roan: 0.038,
    oilcloth: 0.068,
    vellum: 0.062,
    parchment: 0.047,
    'alum-tawed': 0.07,
    'paper-wrapper': 0.026,
  };
  const turn = Math.max(2.5, Math.min(b.w, b.h) * (turnScale[p.material] ?? 0.045));
  fillRect(ctx, side === 'left' ? b.x : b.x + b.w - turn, b.y, turn, b.h, p.board);
  const sx = side === 'left' ? b.x + turn : b.x + b.w - turn;
  materialRule(ctx, sx, b.y + b.h * 0.025, sx, b.y + b.h * 0.975,
    Math.max(0.85, Math.min(b.w, b.h) * 0.009), p.seed + 320);

  if (p.material === 'smooth-cloth') {
    const cap = Math.max(2.5, b.h * 0.018);
    fillRect(ctx, b.x + b.w * 0.06, b.y, b.w * 0.88, cap, p.board);
    fillRect(ctx, b.x + b.w * 0.06, b.y + b.h - cap, b.w * 0.88, cap, p.board);
  } else if (p.material === 'linen') {
    // The selvedge stays beside the hinge, where it cannot cut through a cover
    // title. Two nearby vertical yarns distinguish linen from smooth cloth.
    for (const mul of [1.55, 2.05]) {
      const lx = edge + flip * turn * mul;
      materialRule(ctx, lx, b.y + b.h * 0.055, lx, b.y + b.h * 0.945,
        Math.max(0.72, Math.min(b.w, b.h) * 0.006), p.seed + 324 + Math.round(mul * 10));
    }
  } else if (p.material === 'felt') {
    const fore = side === 'left' ? b.x + b.w * 0.9 : b.x + b.w * 0.1;
    ctx.beginPath();
    ctx.moveTo(fore, b.y + b.h * 0.06);
    for (let i = 1; i <= 5; i++) {
      const yy = b.y + b.h * (0.06 + i * 0.176);
      ctx.quadraticCurveTo(fore + flip * b.w * (i % 2 ? 0.02 : -0.02), yy - b.h * 0.088, fore, yy);
    }
    ctx.strokeStyle = FLAT.ink;
    ctx.lineWidth = Math.max(1, Math.min(b.w, b.h) * 0.012);
    ctx.stroke();
  } else if (p.material === 'polished-calf') {
    for (const mul of [1.85, 2.8]) {
      const jx = edge + flip * turn * mul;
      materialRule(ctx, jx, b.y + b.h * 0.035, jx, b.y + b.h * 0.965,
        Math.max(0.82, Math.min(b.w, b.h) * 0.008), p.seed + 326 + Math.round(mul * 10));
    }
  } else if (p.material === 'morocco-grain') {
    const sw = Math.max(turn * 1.4, b.w * 0.095);
    const sx = side === 'left' ? b.x + turn : b.x + b.w - turn - sw;
    fillRect(ctx, sx, b.y + b.h * 0.035, sw, b.h * 0.93, p.board);
    materialRule(ctx, side === 'left' ? sx + sw : sx, b.y + b.h * 0.04,
      side === 'left' ? sx + sw : sx, b.y + b.h * 0.96,
      Math.max(0.9, Math.min(b.w, b.h) * 0.01), p.seed + 328);
  } else if (p.material === 'russia-calf') {
    const rw = Math.max(turn * 1.9, b.w * 0.14);
    fillRect(ctx, side === 'left' ? edge : edge - rw, b.y, rw, b.h, p.accentBoard);
    const rx = edge + flip * rw;
    materialRule(ctx, rx, b.y + b.h * 0.03, rx, b.y + b.h * 0.97,
      Math.max(1, Math.min(b.w, b.h) * 0.012), p.seed + 329);
  } else if (p.material === 'roan') {
    const jx = edge + flip * turn * 1.75;
    materialRule(ctx, jx, b.y + b.h * 0.05, jx, b.y + b.h * 0.95,
      Math.max(0.82, Math.min(b.w, b.h) * 0.008), p.seed + 331);
  } else if (p.material === 'vellum' || p.material === 'alum-tawed') {
    for (const t of [0.22, 0.76]) {
      const length = b.w * 0.2 * flip;
      materialRule(ctx, edge, b.y + b.h * t, edge + length, b.y + b.h * (t + 0.012),
        Math.max(1, Math.min(b.w, b.h) * 0.014), p.seed + 330 + Math.round(t * 10));
    }
  } else if (p.material === 'paper-wrapper' || p.material === 'parchment') {
    foldedCorner(ctx, b, side === 'left' ? 'tr' : 'tl', p.board, p.seed + 340);
    foldedCorner(ctx, b, side === 'left' ? 'bl' : 'br', p.board, p.seed + 342);
  } else if (p.material === 'buckram') {
    const cap = Math.max(3, b.h * 0.025);
    fillRect(ctx, b.x, b.y, b.w, cap, p.board);
    fillRect(ctx, b.x, b.y + b.h - cap, b.w, cap, p.board);
    const jx = edge + flip * turn * 1.55;
    materialRule(ctx, jx, b.y + b.h * 0.035, jx, b.y + b.h * 0.965,
      Math.max(1.05, Math.min(b.w, b.h) * 0.013), p.seed + 346);
  } else if (p.material === 'oilcloth') {
    const cap = Math.max(3, b.h * 0.03);
    fillRect(ctx, b.x, b.y, b.w, cap, p.board);
    fillRect(ctx, b.x, b.y + b.h - cap, b.w, cap, p.board);
    const x0 = edge + flip * turn * 1.2;
    const x1 = edge + flip * turn * 2.35;
    materialRule(ctx, x0, b.y + b.h * 0.08, x1, b.y + b.h * 0.92,
      Math.max(1, Math.min(b.w, b.h) * 0.012), p.seed + 348);
  } else if (p.material === 'velvet') {
    // Reversed pile is a physical strip near the fore edge, leaving cover
    // frames entirely to the decoration layer.
    const vx = side === 'left' ? b.x + b.w * 0.78 : b.x + b.w * 0.12;
    fillRect(ctx, vx, b.y + b.h * 0.07, b.w * 0.1, b.h * 0.86, p.board);
    materialRule(ctx, side === 'left' ? vx : vx + b.w * 0.1, b.y + b.h * 0.075,
      side === 'left' ? vx : vx + b.w * 0.1, b.y + b.h * 0.925,
      Math.max(0.9, Math.min(b.w, b.h) * 0.009), p.seed + 350);
  }
  return true;
}

type FocalGlyph = 'none' | 'crown' | 'sprig' | 'laurel' | 'palmette' | 'fleuron';
type FrameKind = 'none' | 'single' | 'double' | 'open' | 'bays';

interface BindingProgramArtwork {
  frame: FrameKind;
  rules: readonly number[];
  cords: readonly number[];
  glyph: FocalGlyph;
  glyphAt: number;
  jointFillets: 0 | 1 | 2;
  blind: boolean;
  weight: 'quiet' | 'bookish' | 'grand';
}

const bp = (
  frame: FrameKind,
  rules: readonly number[],
  cords: readonly number[],
  glyph: FocalGlyph,
  glyphAt: number,
  jointFillets: 0 | 1 | 2,
  blind: boolean,
  weight: BindingProgramArtwork['weight'] = 'bookish',
): BindingProgramArtwork => ({ frame, rules, cords, glyph, glyphAt, jointFillets, blind, weight });

/** One remastered drawing recipe for every active non-plain programme. */
export const ACTIVE_BINDING_ART_PROGRAMS: Readonly<Record<string, BindingProgramArtwork>> = {
  'quarto-grand-fillet': bp('double', [0.16, 0.76], [], 'none', 0.44, 1, false, 'grand'),
  'oxford-double-compartment': bp('double', [0.18, 0.48, 0.8], [], 'none', 0.34, 2, false),
  'cambridge-blind-bays': bp('bays', [0.2, 0.51, 0.79], [], 'none', 0.35, 1, true),
  'printers-terminal-blocks': bp('open', [0.14, 0.19, 0.79, 0.84], [], 'fleuron', 0.5, 1, false),
  'library-closed-fillet': bp('single', [0.17, 0.82], [], 'none', 0.5, 2, true),
  'folio-five-compartment': bp('bays', [0.14, 0.29, 0.51, 0.7, 0.85], [], 'none', 0.42, 1, false),
  'botanical-centre-panel': bp('open', [0.25, 0.7], [], 'sprig', 0.46, 1, true),
  'prize-laurel-panel': bp('single', [0.18, 0.78], [], 'laurel', 0.48, 1, false),
  'buckram-library-bays': bp('bays', [0.18, 0.42, 0.72, 0.84], [], 'none', 0.54, 2, true, 'quiet'),
  'buckram-oxford-fillets': bp('double', [0.16, 0.44, 0.77], [], 'none', 0.55, 1, false),
  'buckram-cambridge-bands': bp('open', [0.15, 0.22, 0.68, 0.82], [], 'none', 0.45, 2, true),
  'buckram-archive-folio': bp('single', [0.12, 0.28, 0.72, 0.88], [], 'none', 0.5, 1, true, 'quiet'),
  'linen-herbarium-sprig': bp('open', [0.18, 0.76], [], 'sprig', 0.46, 1, true),
  'linen-printers-bands': bp('none', [0.13, 0.19, 0.74, 0.82], [], 'fleuron', 0.46, 1, false),
  'linen-scholar-bays': bp('bays', [0.2, 0.48, 0.77], [], 'none', 0.36, 1, true, 'quiet'),
  'velvet-crown-frame': bp('double', [0.17, 0.78], [], 'crown', 0.34, 1, false, 'grand'),
  'velvet-palmette-panel': bp('single', [0.2, 0.76], [], 'palmette', 0.45, 2, false, 'grand'),
  'grand-crown-compartments': bp('bays', [0.14, 0.31, 0.61, 0.82], [], 'crown', 0.43, 2, false, 'grand'),
  'calf-blind-double-fillet': bp('double', [0.16, 0.8], [], 'none', 0.5, 1, true),
  'calf-oxford-bands': bp('none', [0.14, 0.22, 0.47, 0.76, 0.84], [0.22, 0.76], 'none', 0.5, 1, false),
  'calf-cambridge-bays': bp('bays', [0.17, 0.43, 0.7, 0.84], [], 'none', 0.55, 2, true),
  'calf-gilt-compartments': bp('double', [0.15, 0.33, 0.58, 0.82], [], 'fleuron', 0.45, 1, false),
  'calf-royal-crown': bp('single', [0.17, 0.76], [0.3, 0.69], 'crown', 0.48, 2, false, 'grand'),
  'calf-laurel-wreath': bp('open', [0.19, 0.79], [0.3, 0.72], 'laurel', 0.49, 1, false, 'grand'),
  'russia-folio-panels': bp('bays', [0.13, 0.3, 0.53, 0.72, 0.86], [], 'none', 0.41, 2, true),
  'russia-blind-fillet': bp('double', [0.15, 0.81], [], 'none', 0.5, 2, true, 'quiet'),
  'russia-crown-bay': bp('single', [0.18, 0.42, 0.78], [], 'crown', 0.3, 1, false),
  'russia-scholar-bands': bp('none', [0.13, 0.21, 0.46, 0.71, 0.84], [0.21, 0.71], 'none', 0.5, 2, true),
  'roan-school-fillet': bp('single', [0.16, 0.82], [], 'none', 0.5, 1, true, 'quiet'),
  'roan-botanical-sprig': bp('open', [0.24, 0.73], [], 'sprig', 0.47, 1, true),
  'roan-terminal-bays': bp('bays', [0.15, 0.27, 0.73, 0.86], [], 'none', 0.5, 1, true),
  'oilcloth-ledger-fillet': bp('single', [0.13, 0.28, 0.83], [], 'none', 0.57, 2, true, 'quiet'),
  'oilcloth-terminal-bands': bp('none', [0.12, 0.18, 0.78, 0.86], [], 'none', 0.5, 1, false, 'quiet'),
  'vellum-folio-bays': bp('bays', [0.14, 0.31, 0.55, 0.79], [], 'none', 0.43, 1, true),
  'vellum-terminal-fleuron': bp('open', [0.13, 0.2, 0.78, 0.86], [], 'fleuron', 0.5, 1, false),
  'vellum-laurel-panel': bp('single', [0.18, 0.78], [], 'laurel', 0.47, 1, false),
  'vellum-abbey-fillet': bp('double', [0.16, 0.8], [], 'none', 0.5, 2, true, 'grand'),
  'parchment-quarto-bands': bp('none', [0.15, 0.24, 0.48, 0.77, 0.85], [0.24, 0.77], 'none', 0.5, 1, true),
  'parchment-blind-bays': bp('bays', [0.18, 0.43, 0.72, 0.84], [], 'none', 0.55, 2, true, 'quiet'),
  'parchment-herbarium-sprig': bp('open', [0.2, 0.75], [], 'sprig', 0.46, 1, true),
  'parchment-fleuron-panel': bp('single', [0.19, 0.78], [], 'fleuron', 0.46, 1, true),
  'parchment-scholar-fillet': bp('double', [0.17, 0.81], [], 'none', 0.5, 1, true, 'quiet'),
  'wrapper-ruled-fold': bp('none', [0.16, 0.82], [], 'none', 0.5, 1, true, 'quiet'),
  'wrapper-printers-imprint': bp('open', [0.18, 0.76], [], 'fleuron', 0.47, 1, true, 'quiet'),
  'wrapper-botanical-sprig': bp('none', [0.24, 0.73], [], 'sprig', 0.48, 0, true, 'quiet'),
  'wrapper-archive-sewn': bp('none', [0.12, 0.2, 0.8, 0.88], [0.2, 0.8], 'none', 0.5, 0, true, 'quiet'),
  'half-calf-material-bands': bp('none', [0.14, 0.22, 0.5, 0.77, 0.85], [0.22, 0.77], 'none', 0.5, 2, false),
  'half-oxford-compartments': bp('double', [0.15, 0.32, 0.58, 0.82], [], 'none', 0.46, 2, false),
  'half-laurel-panel': bp('single', [0.18, 0.78], [], 'laurel', 0.46, 2, false, 'grand'),
  'quarter-calf-bands': bp('none', [0.14, 0.24, 0.49, 0.77, 0.86], [0.24, 0.77], 'none', 0.5, 1, false),
  'quarter-scholar-bays': bp('bays', [0.18, 0.44, 0.72, 0.84], [], 'none', 0.54, 1, true),
  'quarter-botanical-sprig': bp('open', [0.22, 0.74], [], 'sprig', 0.47, 1, true),
  'three-quarter-corded': bp('none', [0.13, 0.27, 0.53, 0.78, 0.87], [0.27, 0.78], 'none', 0.5, 2, false, 'grand'),
  'three-quarter-folio-bays': bp('bays', [0.13, 0.3, 0.53, 0.72, 0.86], [], 'none', 0.42, 2, false),
  'three-quarter-crown': bp('double', [0.17, 0.78], [0.31, 0.7], 'crown', 0.47, 2, false, 'grand'),
  'half-cloth-herbarium': bp('open', [0.2, 0.75], [], 'sprig', 0.46, 1, true),
  'half-cloth-prize-laurel': bp('single', [0.18, 0.79], [], 'laurel', 0.47, 1, false),
  'half-cloth-printers': bp('none', [0.14, 0.2, 0.78, 0.85], [], 'fleuron', 0.49, 1, false),
};

export const ACTIVE_BINDING_ART_PROGRAM_IDS: readonly string[] = Object.freeze(
  Object.keys(ACTIVE_BINDING_ART_PROGRAMS),
);

function drawFrame(
  ctx: FlatCtx,
  b: BindingArtworkBox,
  kind: FrameKind,
  colour: string,
  width: number,
  seed: number,
): void {
  if (kind === 'none') return;
  const inset = kind === 'open' ? 0.2 : kind === 'bays' ? 0.16 : 0.13;
  const x = b.x + b.w * inset;
  const w = b.w * (1 - inset * 2);
  const top = b.y + b.h * (kind === 'open' ? 0.12 : 0.095);
  const bottom = b.y + b.h * (kind === 'open' ? 0.88 : 0.905);
  const fine = Math.max(0.7, width * 0.82);
  // Spine tooling is struck across the back. A frame is therefore a calm
  // pair of head and tail fillets; little vertical hooks read as torn corners
  // at shelf scale and are intentionally omitted.
  for (const [y, n] of [[top, 0], [bottom, 4]] as const) {
    cleanRule(ctx, x, y, x + w, y, colour, fine, seed + n);
  }
  if (kind === 'double') {
    const gap = Math.max(1.35, Math.min(2.4, b.w * 0.075));
    cleanRule(ctx, x + b.w * 0.035, top + gap, x + w - b.w * 0.035, top + gap,
      colour, Math.max(0.68, fine * 0.78), seed + 9);
    cleanRule(ctx, x + b.w * 0.035, bottom - gap, x + w - b.w * 0.035, bottom - gap,
      colour, Math.max(0.68, fine * 0.78), seed + 10);
  }
}

function drawBoundCord(
  ctx: FlatCtx,
  b: BindingArtworkBox,
  cy: number,
  face: string,
  seed: number,
): number {
  const swell = Math.max(1.05, Math.min(b.h * 0.011, b.w * 0.17));
  const x0 = b.x + b.w * 0.055;
  const x1 = b.x + b.w * 0.945;
  cleanRule(ctx, x0, cy, x1, cy, FLAT.ink, swell + Math.max(0.48, b.w * 0.016), seed);
  cleanRule(ctx, x0 + b.w * 0.025, cy, x1 - b.w * 0.025, cy, face, swell, seed + 1);
  return swell;
}

export interface BindingDecorationArtworkParams {
  programme: string;
  /** Semantic focal from bookDesign's authoritative programme table. */
  glyph?: string | null;
  /** Independent raised cords already own the horizontal divisions. */
  suppressHorizontalRules?: boolean;
  seed: number;
  tooling: string;
  blindTooling: string;
  bandFace: string;
  bandBoard: string;
}

/** Draw one remastered active tooling programme. */
export function bindingArtworkEmblemIndexForGlyph(
  glyph: string | null | undefined,
): number | undefined {
  return bindingEmblemIndexForAuthoredFocal(glyph);
}

export function drawActiveBindingDecorationArtwork(
  ctx: FlatCtx,
  b: BindingArtworkBox,
  p: BindingDecorationArtworkParams,
): boolean {
  const spec = ACTIVE_BINDING_ART_PROGRAMS[p.programme];
  if (spec === undefined) return false;
  const colour = spec.blind ? p.blindTooling : p.tooling;
  const scale = spec.weight === 'grand' ? 1.18 : spec.weight === 'quiet' ? 0.88 : 1;
  const rule = Math.max(0.82, b.w * 0.034 * scale);

  drawFrame(ctx, b, spec.frame, colour, rule, p.seed + 10);

  if (!p.suppressHorizontalRules) {
    let selected: number[] = [];
    if (spec.frame === 'bays') {
      // Two divisions produce three generous compartments. Five or six rules
      // collapsed into a barcode on a 24px spine.
      const interior = spec.rules.filter((t) => t > 0.24 && t < 0.76);
      const nearest = (target: number): number | undefined => interior.length === 0
        ? undefined
        : interior.reduce((best, t) => Math.abs(t - target) < Math.abs(best - target) ? t : best);
      selected = [nearest(0.35), nearest(0.68)]
        .filter((t): t is number => t !== undefined)
        .filter((t, i, all) => i === 0 || Math.abs(t - (all[0] as number)) > 0.12);
    } else if (spec.frame === 'none' && spec.cords.length === 0) {
      // Unframed programmes keep a single deliberate head/tail rhythm.
      const head = spec.rules.find((t) => t <= 0.3);
      const tail = [...spec.rules].reverse().find((t) => t >= 0.7);
      selected = [head, tail].filter((t): t is number => t !== undefined);
    }
    for (let i = 0; i < selected.length; i++) {
      const t = selected[i] as number;
      const terminal = t < 0.3 || t > 0.7;
      const inset = terminal ? 0.11 : 0.17;
      cleanRule(ctx, b.x + b.w * inset, b.y + b.h * t, b.x + b.w * (1 - inset),
        b.y + b.h * t, colour, rule * (terminal ? 1.03 : 0.9), p.seed + 30 + i);
    }
  }

  for (let i = 0; i < spec.cords.length; i++) {
    const t = spec.cords[i] as number;
    const cy = b.y + b.h * t;
    drawBoundCord(ctx, b, cy, p.bandBoard, p.seed + 100 + i * 7);
  }

  const glyphIndex = bindingArtworkEmblemIndexForGlyph(p.glyph);
  if (glyphIndex !== undefined) {
    // Ceremonial tools need almost the full narrow back to keep their identity
    // at shelf scale. The same crown master at the former 0.82 width collapsed
    // into a fleuron-like knot even though its atlas index matched the cover.
    const widthShare = spec.weight === 'grand' ? 1.08 : 0.9;
    const semanticNudge = p.glyph === 'crown' ? 1.04 : 1;
    const size = Math.min(b.w * widthShare * semanticNudge, b.h * 0.11);
    paintRemasteredEmblem(ctx, glyphIndex, b.x + b.w * 0.5,
      b.y + b.h * spec.glyphAt, size * 0.5, colour);
  }
  return true;
}

export interface BindingRaisedCordsArtworkParams {
  stations: readonly number[];
  seed: number;
  face: string;
  board: string;
  foil: string;
  gilt: boolean;
}

/** Physical raised supports for the independent Studio cord control. */
export function drawBindingRaisedCordsArtwork(
  ctx: FlatCtx,
  b: BindingArtworkBox,
  p: BindingRaisedCordsArtworkParams,
): void {
  if (b.w < 7) return;
  for (let i = 0; i < p.stations.length; i++) {
    const cy = b.y + b.h * (p.stations[i] as number);
    drawBoundCord(ctx, b, cy, p.gilt ? p.foil : p.board, p.seed + i * 9);
  }
}
