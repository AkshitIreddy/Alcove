/**
 * art/props.ts — hand-drawn shelf-dressing props (L2, baked once).
 *
 * Small warm still-life objects that sit between book clusters on some
 * floors: potted plant, hourglass, candle (with a baked static glow), tiny
 * globe, and a stack of flat-lying books. Pure Canvas2D, seeded, drawn once
 * per (kind, dpr) per session and composited as sprites — never per frame.
 *
 * Every prop is authored in a PROP_W × PROP_H world-px box with the object
 * standing on the bottom edge (the shelf baseline).
 */

import { clamp, mulberry32 } from './noise';
import type { Ctx2D } from './spines';

/** Design-space size of a prop tile in world px (baseline = bottom edge). */
export const PROP_W = 72;
export const PROP_H = 104;

/** Number of distinct prop kinds. */
export const PROP_KINDS = 5;

export type PropKind = 0 | 1 | 2 | 3 | 4;

export const PROP_NAMES = ['plant', 'hourglass', 'candle', 'globe', 'bookstack'] as const;

/* ------------------------------ shared inks ------------------------------- */

const INK = 'rgba(64, 52, 40, 0.8)';
const INK_SOFT = 'rgba(80, 66, 50, 0.5)';
const TERRACOTTA = '#a9603f';
const TERRACOTTA_DARK = '#84492f';
const MOSS = '#5f7442';
const MOSS_DARK = '#47592f';
const BRASS = '#b08d3e';
const BRASS_DARK = '#8a6c2c';
const SAND = '#d9b56a';
const CREAM = '#efe0c0';
const WAX = '#e8dcc0';
const FLAME = '#f5b83d';
const SEA = '#7d97a8';
const LAND = '#a8935f';

interface JitterCtx {
  rnd: () => number;
}

/** Slightly wobbled line — cheap hand feel without the full wobble module. */
function line(ctx: Ctx2D, j: JitterCtx, x0: number, y0: number, x1: number, y1: number): void {
  const mx = (x0 + x1) / 2 + (j.rnd() * 2 - 1) * 1.1;
  const my = (y0 + y1) / 2 + (j.rnd() * 2 - 1) * 1.1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(mx, my, x1, y1);
  ctx.stroke();
}

function contactShadow(ctx: Ctx2D, cx: number, baseY: number, rx: number): void {
  const g = ctx.createRadialGradient(cx, baseY - 1, 0, cx, baseY - 1, rx);
  g.addColorStop(0, 'rgba(40, 30, 20, 0.28)');
  g.addColorStop(1, 'rgba(40, 30, 20, 0)');
  ctx.save();
  ctx.translate(cx, baseY - 1);
  ctx.scale(1, 0.22);
  ctx.translate(-cx, -(baseY - 1));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, baseY - 1, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* -------------------------------- drawing --------------------------------- */

/**
 * Draw prop `kind` into the PROP_W × PROP_H design box at the ctx's current
 * transform origin. `seed` varies the little strokes deterministically.
 */
export function renderProp(ctx: Ctx2D, kind: PropKind, seed: number): void {
  const rnd = mulberry32(seed >>> 0);
  const j: JitterCtx = { rnd };
  const W = PROP_W;
  const H = PROP_H;
  const base = H - 2;
  const cx = W / 2;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = INK;

  switch (kind) {
    case 0: {
      // Potted plant: terracotta pot, arcing leaves with filled blades.
      contactShadow(ctx, cx, base, 24);
      const potW = 30;
      const potH = 24;
      const potTop = base - potH;
      const pot = ctx.createLinearGradient(cx - potW / 2, 0, cx + potW / 2, 0);
      pot.addColorStop(0, TERRACOTTA);
      pot.addColorStop(0.45, '#c07450');
      pot.addColorStop(1, TERRACOTTA_DARK);
      ctx.fillStyle = pot;
      ctx.beginPath();
      ctx.moveTo(cx - potW / 2, potTop);
      ctx.lineTo(cx + potW / 2, potTop);
      ctx.lineTo(cx + potW / 2 - 5, base);
      ctx.lineTo(cx - potW / 2 + 5, base);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Rim.
      ctx.fillStyle = TERRACOTTA;
      ctx.fillRect(cx - potW / 2 - 3, potTop - 6, potW + 6, 6.5);
      ctx.strokeRect(cx - potW / 2 - 3, potTop - 6, potW + 6, 6.5);
      // Leaves: five arcs with leaf-blob tips.
      ctx.strokeStyle = MOSS_DARK;
      ctx.lineWidth = 1.6;
      const tips: Array<[number, number]> = [];
      for (let i = 0; i < 5; i++) {
        const dir = (i - 2) / 2; // -1..1
        const tx = cx + dir * (18 + rnd() * 8);
        const ty = potTop - 26 - rnd() * 22 - Math.abs(dir) * -6;
        ctx.beginPath();
        ctx.moveTo(cx, potTop - 4);
        ctx.quadraticCurveTo(cx + dir * 8, potTop - 22, tx, ty);
        ctx.stroke();
        tips.push([tx, ty]);
      }
      ctx.fillStyle = MOSS;
      for (const [tx, ty] of tips) {
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate((rnd() * 2 - 1) * 0.6);
        ctx.beginPath();
        ctx.ellipse(0, -4, 4.2, 8.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      break;
    }
    case 1: {
      // Hourglass: brass frame, two glass bulbs, sand heaps + falling thread.
      contactShadow(ctx, cx, base, 22);
      const hgW = 34;
      const hgH = 52;
      const top = base - hgH;
      const mid = top + hgH / 2;
      // Frame plates.
      ctx.fillStyle = BRASS;
      ctx.fillRect(cx - hgW / 2, top - 5, hgW, 5);
      ctx.fillRect(cx - hgW / 2, base - 5, hgW, 5);
      ctx.strokeRect(cx - hgW / 2, top - 5, hgW, 5);
      ctx.strokeRect(cx - hgW / 2, base - 5, hgW, 5);
      // Posts.
      ctx.strokeStyle = BRASS_DARK;
      ctx.lineWidth = 2.2;
      line(ctx, j, cx - hgW / 2 + 2, top, cx - hgW / 2 + 2, base - 5);
      line(ctx, j, cx + hgW / 2 - 2, top, cx + hgW / 2 - 2, base - 5);
      // Glass bulbs.
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.3;
      ctx.fillStyle = 'rgba(235, 242, 244, 0.35)';
      ctx.beginPath();
      ctx.moveTo(cx - hgW / 2 + 6, top);
      ctx.quadraticCurveTo(cx - hgW / 2 + 8, mid - 4, cx - 2, mid);
      ctx.lineTo(cx + 2, mid);
      ctx.quadraticCurveTo(cx + hgW / 2 - 8, mid - 4, cx + hgW / 2 - 6, top);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - hgW / 2 + 6, base - 5);
      ctx.quadraticCurveTo(cx - hgW / 2 + 8, mid + 4, cx - 2, mid);
      ctx.lineTo(cx + 2, mid);
      ctx.quadraticCurveTo(cx + hgW / 2 - 8, mid + 4, cx + hgW / 2 - 6, base - 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Sand: a little left up top, a heap below, a falling thread.
      ctx.fillStyle = SAND;
      ctx.beginPath();
      ctx.moveTo(cx - 8, mid - 5);
      ctx.quadraticCurveTo(cx, mid - 11, cx + 8, mid - 5);
      ctx.quadraticCurveTo(cx + 3, mid - 1.5, cx - 3, mid - 1.5);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 11, base - 6);
      ctx.quadraticCurveTo(cx, base - 17, cx + 11, base - 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(cx - 0.7, mid, 1.4, base - mid - 8);
      break;
    }
    case 2: {
      // Candle on a brass dish, static warm glow baked behind the flame.
      const dishW = 34;
      contactShadow(ctx, cx, base, 22);
      // Baked glow FIRST so everything sits inside it.
      const flameY = base - 58;
      const glow = ctx.createRadialGradient(cx, flameY, 2, cx, flameY, 34);
      glow.addColorStop(0, 'rgba(255, 205, 110, 0.5)');
      glow.addColorStop(0.5, 'rgba(255, 190, 90, 0.18)');
      glow.addColorStop(1, 'rgba(255, 180, 80, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, flameY, 34, 0, Math.PI * 2);
      ctx.fill();
      // Dish.
      ctx.fillStyle = BRASS;
      ctx.beginPath();
      ctx.ellipse(cx, base - 3, dishW / 2, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Wax column with drips.
      const candW = 16;
      const candTop = base - 46;
      const wax = ctx.createLinearGradient(cx - candW / 2, 0, cx + candW / 2, 0);
      wax.addColorStop(0, WAX);
      wax.addColorStop(0.5, '#f6ecd4');
      wax.addColorStop(1, '#cdbd9a');
      ctx.fillStyle = wax;
      ctx.beginPath();
      ctx.moveTo(cx - candW / 2, candTop + 2);
      ctx.quadraticCurveTo(cx, candTop - 2, cx + candW / 2, candTop + 2);
      ctx.lineTo(cx + candW / 2, base - 5);
      ctx.lineTo(cx - candW / 2, base - 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // A drip.
      ctx.fillStyle = CREAM;
      ctx.beginPath();
      ctx.ellipse(cx - candW / 2 + 2, candTop + 10, 2.2, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Wick + flame.
      ctx.strokeStyle = INK;
      line(ctx, j, cx, candTop, cx, candTop - 4);
      const fl = ctx.createRadialGradient(cx, flameY + 3, 0.5, cx, flameY + 3, 8);
      fl.addColorStop(0, '#fff3cf');
      fl.addColorStop(0.6, FLAME);
      fl.addColorStop(1, 'rgba(224, 130, 40, 0.9)');
      ctx.fillStyle = fl;
      ctx.beginPath();
      ctx.moveTo(cx, flameY - 7);
      ctx.quadraticCurveTo(cx + 5.5, flameY + 2, cx, flameY + 8);
      ctx.quadraticCurveTo(cx - 5.5, flameY + 2, cx, flameY - 7);
      ctx.fill();
      break;
    }
    case 3: {
      // Tiny globe on a wooden stand with a brass meridian.
      contactShadow(ctx, cx, base, 22);
      const r = 17;
      const gy = base - 34;
      // Stand.
      ctx.fillStyle = TERRACOTTA_DARK;
      ctx.beginPath();
      ctx.ellipse(cx, base - 3, 13, 3.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = BRASS_DARK;
      ctx.lineWidth = 2;
      line(ctx, j, cx, base - 5, cx, gy + r - 2);
      // Sphere.
      const sea = ctx.createRadialGradient(cx - 6, gy - 6, 2, cx, gy, r);
      sea.addColorStop(0, '#a5bcc9');
      sea.addColorStop(0.6, SEA);
      sea.addColorStop(1, '#5d7484');
      ctx.fillStyle = sea;
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(cx, gy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Landmasses: blobby fills.
      ctx.fillStyle = LAND;
      for (const [ox, oy, s0] of [
        [-6, -5, 6],
        [5, 2, 5],
        [-2, 8, 3.6],
      ] as const) {
        ctx.beginPath();
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          const rr = s0 * (0.7 + rnd() * 0.5);
          const px = cx + ox + Math.cos(a) * rr;
          const py = gy + oy + Math.sin(a) * rr * 0.8;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
      }
      // Latitude hint + brass meridian arc.
      ctx.strokeStyle = INK_SOFT;
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.ellipse(cx, gy, r - 1.5, (r - 1.5) * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = BRASS;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, gy, r + 2.5, Math.PI * 0.28, Math.PI * 1.28);
      ctx.stroke();
      break;
    }
    default: {
      // A stack of 3–4 flat-lying books with tail bands and a top ribbon.
      contactShadow(ctx, cx, base, 30);
      const count = 3 + (seed % 2);
      const tones = ['#a8623f', '#5f7442', '#7d97a8', '#8a5b74'];
      let y = base;
      for (let i = 0; i < count; i++) {
        const bw = 52 - i * 6 - rnd() * 4;
        const bh = 9 + rnd() * 2.5;
        const ox = cx + (rnd() * 2 - 1) * 5;
        y -= bh;
        const tone = tones[(seed + i) % tones.length] as string;
        ctx.fillStyle = tone;
        ctx.beginPath();
        ctx.moveTo(ox - bw / 2, y + bh);
        ctx.lineTo(ox + bw / 2, y + bh);
        ctx.lineTo(ox + bw / 2, y + 1.5);
        ctx.quadraticCurveTo(ox, y - 1.5, ox - bw / 2, y + 1.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Pages edge: cream strip along the right.
        ctx.fillStyle = CREAM;
        ctx.fillRect(ox + bw / 2 - 4.5, y + 2.2, 3.2, bh - 3.4);
        // A band rule.
        ctx.strokeStyle = 'rgba(240, 230, 205, 0.6)';
        ctx.lineWidth = 1;
        line(ctx, j, ox - bw / 2 + 6, y + bh / 2, ox - bw / 2 + 13, y + bh / 2);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.4;
      }
      // A little ribbon bookmark trailing from the top book.
      ctx.strokeStyle = '#a33d33';
      ctx.lineWidth = 2;
      const rx = cx + 10;
      ctx.beginPath();
      ctx.moveTo(rx, y + 2);
      ctx.quadraticCurveTo(rx + 6, y + 9, rx + 3, y + 16);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/** Deterministic prop kind for (floor, gap index). */
export function propKindFor(hash: number): PropKind {
  return clamp(hash % PROP_KINDS, 0, PROP_KINDS - 1) as PropKind;
}

/* ========================= themed props (v3 worlds) ======================= */

/**
 * The colourful worlds' own dressing. Same PROP_W × PROP_H design box, same
 * bottom-edge baseline, same seeded jitter — only the vocabulary changes.
 * Anything without its own renderer here falls back to one of the five
 * legacy props, so `renderThemedProp` is total for every PropName.
 */
const THEMED_PROPS: ReadonlySet<string> = new Set([
  'blossom-sprig',
  'birdhouse',
  'robot-arm',
  'gear-stack',
  'oil-can',
  'fossil-skull',
  'amber-specimen',
  'palm-frond',
  'lollipop',
  'candy-jar',
  'cupcake',
  'coral-fan',
  'conch',
  'rocket',
  'planet',
]);

/** Legacy stand-in for prop names that have no bespoke renderer yet. */
const PROP_FALLBACK: Readonly<Record<string, PropKind>> = {
  plant: 0,
  'terracotta-pot': 0,
  'potted-plant': 0,
  'tea-bowl': 0,
  hourglass: 1,
  'glass-cloche': 1,
  'dusty-jar': 1,
  bell: 1,
  thimble: 1,
  'brass-scales': 1,
  candle: 2,
  candlestick: 2,
  'glow-bottle': 2,
  'wax-seal': 2,
  globe: 3,
  orrery: 3,
  telescope: 3,
  'moon-dial': 3,
  'watering-can': 3,
  'yarn-ball': 3,
  'jam-jar': 3,
  bookstack: 4,
  'seed-packet': 4,
  'star-chart': 4,
  bunting: 4,
  quill: 4,
  scroll: 4,
  'ink-stone': 4,
  'paper-crane': 4,
  crate: 4,
  suitcase: 4,
  newspapers: 4,
  'mortar-pestle': 4,
  inkwell: 4,
};

/** Is there a bespoke renderer for this prop name? */
export function hasThemedProp(name: string): boolean {
  return THEMED_PROPS.has(name);
}

/**
 * Draw any themed prop by name into the PROP_W × PROP_H design box.
 * Unknown / not-yet-drawn names fall back to the nearest legacy prop, so a
 * caller can pass a theme's `PropSpec.kind` straight through.
 */
export function renderThemedProp(ctx: Ctx2D, name: string, seed: number): void {
  if (!THEMED_PROPS.has(name)) {
    renderProp(ctx, PROP_FALLBACK[name] ?? 4, seed);
    return;
  }
  const rnd = mulberry32(seed >>> 0);
  const j: JitterCtx = { rnd };
  const W = PROP_W;
  const H = PROP_H;
  const base = H - 2;
  const cx = W / 2;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = INK;

  switch (name) {
    case 'blossom-sprig': {
      // A cut cherry sprig standing in a small glass of water.
      contactShadow(ctx, cx, base, 22);
      const gh = 26;
      const top = base - gh;
      ctx.fillStyle = 'rgba(226, 244, 248, 0.6)';
      ctx.beginPath();
      ctx.moveTo(cx - 10, top);
      ctx.lineTo(cx + 10, top);
      ctx.lineTo(cx + 8, base);
      ctx.lineTo(cx - 8, base);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Water line.
      ctx.fillStyle = 'rgba(150, 208, 226, 0.7)';
      ctx.fillRect(cx - 9, top + 9, 18, gh - 10);
      ctx.strokeStyle = 'rgba(120, 180, 200, 0.9)';
      line(ctx, j, cx - 9, top + 9, cx + 9, top + 9);
      // Two stems arcing out of the glass.
      for (const dir of [-1, 1]) {
        ctx.strokeStyle = '#6b4a2c';
        ctx.lineWidth = 2;
        const tipX = cx + dir * (16 + rnd() * 8);
        const tipY = top - 34 - rnd() * 12;
        ctx.beginPath();
        ctx.moveTo(cx + dir * 2, top + 6);
        ctx.quadraticCurveTo(cx + dir * 4, top - 18, tipX, tipY);
        ctx.stroke();
        // Blossoms and leaves along the stem.
        for (const t of [0.45, 0.75, 1]) {
          const bx = cx + dir * 2 + (tipX - cx - dir * 2) * t;
          const by = top + 6 + (tipY - top - 6) * t;
          ctx.fillStyle = t > 0.6 ? '#ff8fb8' : '#ffb3cf';
          for (let p = 0; p < 5; p++) {
            const a = (p / 5) * Math.PI * 2 + t;
            ctx.beginPath();
            ctx.ellipse(bx + Math.cos(a) * 3.2, by + Math.sin(a) * 3.2, 3.2, 2.3, a, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.fillStyle = '#ffde60';
          ctx.beginPath();
          ctx.arc(bx, by, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#4fb95a';
        ctx.save();
        ctx.translate(cx + dir * 8, top - 16);
        ctx.rotate(dir * 0.7);
        ctx.beginPath();
        ctx.ellipse(0, 0, 7, 3.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      break;
    }
    case 'birdhouse': {
      // A painted birdhouse on a short post, with a perch and a bright roof.
      contactShadow(ctx, cx, base, 20);
      ctx.strokeStyle = INK;
      ctx.fillStyle = '#a9784a';
      ctx.fillRect(cx - 3, base - 30, 6, 30);
      ctx.strokeRect(cx - 3, base - 30, 6, 30);
      const bw = 34;
      const bh = 30;
      const top = base - 30 - bh;
      ctx.fillStyle = '#fff3dc';
      ctx.fillRect(cx - bw / 2, top, bw, bh);
      ctx.strokeRect(cx - bw / 2, top, bw, bh);
      // Roof.
      ctx.fillStyle = '#e8556f';
      ctx.beginPath();
      ctx.moveTo(cx - bw / 2 - 5, top + 2);
      ctx.lineTo(cx, top - 16);
      ctx.lineTo(cx + bw / 2 + 5, top + 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      for (let i = 1; i < 4; i++) {
        line(ctx, j, cx - bw / 2 - 3 + i * 3, top - 1 - i * 3, cx + bw / 2 + 3 - i * 3, top - 1 - i * 3);
      }
      // Entrance hole, perch, and a blue tit peeping out.
      ctx.fillStyle = '#3d2a18';
      ctx.beginPath();
      ctx.arc(cx, top + 12, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4aa3e0';
      ctx.beginPath();
      ctx.arc(cx + 1, top + 13, 4.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffde60';
      ctx.beginPath();
      ctx.moveTo(cx + 5, top + 13);
      ctx.lineTo(cx + 9, top + 14.5);
      ctx.lineTo(cx + 5, top + 16);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.6;
      line(ctx, j, cx, top + 22, cx, top + 27);
      break;
    }
    case 'robot-arm': {
      // A little articulated arm on a base plate, gripper open, LED lit.
      contactShadow(ctx, cx, base, 26);
      const steel = ctx.createLinearGradient(cx - 20, 0, cx + 20, 0);
      steel.addColorStop(0, '#9fb2c4');
      steel.addColorStop(0.4, '#e2ecf6');
      steel.addColorStop(1, '#6c7f92');
      ctx.strokeStyle = 'rgba(28, 40, 54, 0.85)';
      ctx.fillStyle = steel;
      // Base.
      ctx.beginPath();
      ctx.ellipse(cx, base - 5, 20, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillRect(cx - 12, base - 16, 24, 12);
      ctx.strokeRect(cx - 12, base - 16, 24, 12);
      // Lower and upper arm segments.
      const seg = (x0: number, y0: number, x1: number, y1: number, wdt: number): void => {
        const a = Math.atan2(y1 - y0, x1 - x0);
        ctx.save();
        ctx.translate(x0, y0);
        ctx.rotate(a);
        const len = Math.hypot(x1 - x0, y1 - y0);
        ctx.fillStyle = steel;
        ctx.beginPath();
        ctx.roundRect?.(0, -wdt / 2, len, wdt, wdt / 2);
        if (!ctx.roundRect) ctx.rect(0, -wdt / 2, len, wdt);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        // Pivot.
        ctx.fillStyle = '#e03040';
        ctx.beginPath();
        ctx.arc(x0, y0, wdt * 0.32, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      };
      const elbowX = cx - 14;
      const elbowY = base - 44;
      const wristX = cx + 16;
      const wristY = base - 62;
      seg(cx, base - 16, elbowX, elbowY, 11);
      seg(elbowX, elbowY, wristX, wristY, 9);
      // Gripper: two opposed fingers.
      ctx.strokeStyle = 'rgba(28, 40, 54, 0.85)';
      ctx.lineWidth = 3;
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(wristX, wristY);
        ctx.lineTo(wristX + 7, wristY + dir * 5);
        ctx.lineTo(wristX + 13, wristY + dir * 3);
        ctx.stroke();
      }
      // Status LED with a halo.
      const glow = ctx.createRadialGradient(elbowX, elbowY, 0, elbowX, elbowY, 14);
      glow.addColorStop(0, 'rgba(60, 232, 255, 0.6)');
      glow.addColorStop(1, 'rgba(60, 232, 255, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(elbowX, elbowY, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d8feff';
      ctx.beginPath();
      ctx.arc(elbowX, elbowY, 2.2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'gear-stack': {
      // Three cogs leaning together, one enamelled yellow, one cyan.
      contactShadow(ctx, cx, base, 28);
      const cog = (gx: number, gy: number, r: number, teeth: number, fill: string): void => {
        ctx.fillStyle = fill;
        ctx.strokeStyle = 'rgba(28, 40, 54, 0.8)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let i = 0; i < teeth * 2; i++) {
          const a = (i / (teeth * 2)) * Math.PI * 2;
          const rr = i % 2 === 0 ? r : r * 0.76;
          const px = gx + Math.cos(a) * rr;
          const py = gy + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(20, 30, 42, 0.8)';
        ctx.beginPath();
        ctx.arc(gx, gy, r * 0.24, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.beginPath();
        ctx.arc(gx, gy, r * 0.5, 0, Math.PI * 2);
        ctx.stroke();
      };
      cog(cx - 12, base - 16, 15, 9, '#ffc21c');
      cog(cx + 14, base - 20, 12, 8, '#12c8e8');
      cog(cx + 1, base - 40, 13, 9, '#e2ecf6');
      break;
    }
    case 'oil-can': {
      // A tall-spouted oil can with a bright red body and a drip.
      contactShadow(ctx, cx, base, 22);
      const bw = 26;
      const bh = 28;
      const top = base - bh;
      const g = ctx.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
      g.addColorStop(0, '#a01a26');
      g.addColorStop(0.4, '#e03040');
      g.addColorStop(1, '#8c1420');
      ctx.fillStyle = g;
      ctx.strokeStyle = 'rgba(30, 20, 22, 0.8)';
      ctx.beginPath();
      ctx.moveTo(cx - bw / 2, top + 4);
      ctx.quadraticCurveTo(cx, top - 2, cx + bw / 2, top + 4);
      ctx.lineTo(cx + bw / 2 - 2, base);
      ctx.lineTo(cx - bw / 2 + 2, base);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Spout.
      ctx.strokeStyle = '#c8d4e0';
      ctx.lineWidth = 3.4;
      ctx.beginPath();
      ctx.moveTo(cx + 6, top + 4);
      ctx.quadraticCurveTo(cx + 22, top - 6, cx + 26, top - 22);
      ctx.stroke();
      // Handle + thumb press.
      ctx.strokeStyle = '#8c98a6';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx - 4, top + 2, 9, Math.PI * 1.1, Math.PI * 1.95);
      ctx.stroke();
      // Label band and a hanging drip.
      ctx.fillStyle = '#ffc21c';
      ctx.fillRect(cx - bw / 2 + 2, top + 12, bw - 4, 7);
      ctx.fillStyle = 'rgba(60, 44, 12, 0.55)';
      ctx.fillRect(cx - 6, top + 15, 12, 1.6);
      ctx.fillStyle = 'rgba(120, 200, 60, 0.85)';
      ctx.beginPath();
      ctx.ellipse(cx + 26, top - 16, 2, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'fossil-skull': {
      // A small horned skull on a stone block, teeth showing.
      contactShadow(ctx, cx, base, 28);
      ctx.fillStyle = '#8d7a5e';
      ctx.strokeStyle = 'rgba(52, 34, 14, 0.8)';
      ctx.fillRect(cx - 24, base - 12, 48, 12);
      ctx.strokeRect(cx - 24, base - 12, 48, 12);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.fillRect(cx - 24, base - 12, 48, 2);
      const sy = base - 40;
      const bone = ctx.createLinearGradient(cx - 26, sy - 16, cx + 26, sy + 18);
      bone.addColorStop(0, '#fffaea');
      bone.addColorStop(0.6, '#e6d5ac');
      bone.addColorStop(1, '#a8916a');
      ctx.fillStyle = bone;
      ctx.beginPath();
      ctx.moveTo(cx - 26, sy + 6);
      ctx.quadraticCurveTo(cx - 28, sy - 14, cx - 6, sy - 17);
      ctx.quadraticCurveTo(cx + 18, sy - 20, cx + 28, sy - 2);
      ctx.quadraticCurveTo(cx + 22, sy + 10, cx + 2, sy + 11);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Eye socket, nostril, horn.
      ctx.fillStyle = 'rgba(52, 32, 10, 0.85)';
      ctx.beginPath();
      ctx.ellipse(cx - 10, sy - 5, 5, 4, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + 19, sy - 6, 2.4, 1.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#efe0bb';
      ctx.beginPath();
      ctx.moveTo(cx - 6, sy - 16);
      ctx.quadraticCurveTo(cx - 2, sy - 30, cx + 6, sy - 27);
      ctx.quadraticCurveTo(cx + 2, sy - 20, cx + 2, sy - 15);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Jaw with a run of teeth.
      ctx.fillStyle = bone;
      ctx.beginPath();
      ctx.moveTo(cx - 22, sy + 9);
      ctx.quadraticCurveTo(cx + 4, sy + 20, cx + 26, sy + 2);
      ctx.lineTo(cx + 25, sy + 8);
      ctx.quadraticCurveTo(cx + 2, sy + 27, cx - 22, sy + 15);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fffaea';
      for (let i = 0; i < 7; i++) {
        const t = i / 7;
        const tx = cx - 16 + t * 38;
        const ty = sy + 11 + Math.sin(t * 2.6) * 3;
        ctx.beginPath();
        ctx.moveTo(tx - 1.6, ty);
        ctx.lineTo(tx + 1.6, ty);
        ctx.lineTo(tx, ty + 5);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'amber-specimen': {
      // A big amber nugget on a bronze stand, glowing from inside.
      contactShadow(ctx, cx, base, 22);
      ctx.fillStyle = '#a8763a';
      ctx.beginPath();
      ctx.ellipse(cx, base - 4, 16, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const ay = base - 34;
      const glow = ctx.createRadialGradient(cx, ay, 2, cx, ay, 34);
      glow.addColorStop(0, 'rgba(255, 186, 60, 0.5)');
      glow.addColorStop(1, 'rgba(255, 160, 40, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, ay, 34, 0, Math.PI * 2);
      ctx.fill();
      const amber = ctx.createRadialGradient(cx - 6, ay - 8, 2, cx, ay, 22);
      amber.addColorStop(0, '#ffe9a8');
      amber.addColorStop(0.5, '#f0930e');
      amber.addColorStop(1, '#9a4c06');
      ctx.fillStyle = amber;
      ctx.beginPath();
      // Faceted nugget rather than a ball.
      const facets = 9;
      for (let i = 0; i < facets; i++) {
        const a = (i / facets) * Math.PI * 2;
        const rr = 16 + rnd() * 6;
        const px = cx + Math.cos(a) * rr;
        const py = ay + Math.sin(a) * rr * 0.9;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(90, 44, 6, 0.6)';
      ctx.stroke();
      // Trapped fern frond.
      ctx.strokeStyle = 'rgba(56, 34, 8, 0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - 5, ay + 8);
      ctx.quadraticCurveTo(cx, ay - 2, cx + 5, ay - 9);
      ctx.stroke();
      for (let i = 1; i < 6; i++) {
        const t = i / 6;
        const px = cx - 5 + t * 10;
        const py = ay + 8 - t * 17;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + side * 4, py - 2);
          ctx.stroke();
        }
      }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.beginPath();
      ctx.ellipse(cx - 7, ay - 9, 5, 3, -0.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'palm-frond': {
      // A big jungle frond in a heavy stone pot.
      contactShadow(ctx, cx, base, 26);
      const potW = 32;
      const potH = 26;
      const potTop = base - potH;
      const pot = ctx.createLinearGradient(cx - potW / 2, 0, cx + potW / 2, 0);
      pot.addColorStop(0, '#6f5a44');
      pot.addColorStop(0.45, '#93795c');
      pot.addColorStop(1, '#5a4835');
      ctx.fillStyle = pot;
      ctx.beginPath();
      ctx.moveTo(cx - potW / 2, potTop);
      ctx.lineTo(cx + potW / 2, potTop);
      ctx.lineTo(cx + potW / 2 - 4, base);
      ctx.lineTo(cx - potW / 2 + 4, base);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#7d6650';
      ctx.fillRect(cx - potW / 2 - 3, potTop - 6, potW + 6, 6.5);
      ctx.strokeRect(cx - potW / 2 - 3, potTop - 6, potW + 6, 6.5);
      // Three fronds: a spine with pinnae stepping off both sides.
      for (const [dir, tilt] of [
        [-1, 0.5],
        [0, 0.05],
        [1, -0.5],
      ] as const) {
        const len = 48 + rnd() * 12;
        const tipX = cx + dir * 22 - tilt * 6;
        const tipY = potTop - len;
        ctx.strokeStyle = '#2f7d3c';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, potTop - 4);
        ctx.quadraticCurveTo(cx + dir * 6, potTop - len * 0.6, tipX, tipY);
        ctx.stroke();
        ctx.strokeStyle = '#4fbf5c';
        ctx.lineWidth = 2.6;
        const leaves = 8;
        for (let i = 1; i <= leaves; i++) {
          const t = i / (leaves + 1);
          const px = cx + (tipX - cx) * t + dir * 2;
          const py = potTop - 4 + (tipY - potTop + 4) * t;
          const plen = 13 * (1 - t * 0.5);
          for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.quadraticCurveTo(px + side * plen * 0.7, py + 1, px + side * plen, py + plen * 0.55);
            ctx.stroke();
          }
        }
      }
      break;
    }
    case 'lollipop': {
      // Two swirl pops in a striped holder.
      contactShadow(ctx, cx, base, 22);
      ctx.fillStyle = '#68e8c4';
      ctx.beginPath();
      ctx.moveTo(cx - 15, base - 20);
      ctx.lineTo(cx + 15, base - 20);
      ctx.lineTo(cx + 12, base);
      ctx.lineTo(cx - 12, base);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(120, 60, 100, 0.7)';
      ctx.stroke();
      for (const [dir, r, colour] of [
        [-1, 15, '#ff5f9e'],
        [1, 12, '#ffd93d'],
      ] as const) {
        const px = cx + dir * 12;
        const py = base - 48 - (dir < 0 ? 8 : 0);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(px, py + r);
        ctx.lineTo(px + dir * 2, base - 20);
        ctx.stroke();
        ctx.fillStyle = '#fff6fa';
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = colour;
        ctx.lineWidth = r * 0.34;
        ctx.beginPath();
        for (let i = 0; i <= 44; i++) {
          const t = i / 44;
          const a = t * Math.PI * 4;
          const rr = t * (r - 1.5);
          const sx = px + Math.cos(a) * rr;
          const sy = py + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
        ctx.strokeStyle = 'rgba(170, 70, 120, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.beginPath();
        ctx.ellipse(px - r * 0.4, py - r * 0.5, r * 0.24, r * 0.13, -0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'candy-jar': {
      // A big glass jar of gumballs with a lid and a ribbon.
      contactShadow(ctx, cx, base, 26);
      const jw = 40;
      const jh = 52;
      const top = base - jh;
      ctx.fillStyle = 'rgba(230, 248, 250, 0.5)';
      ctx.beginPath();
      ctx.moveTo(cx - jw / 2, top + 8);
      ctx.quadraticCurveTo(cx - jw / 2 - 3, base - 6, cx - jw / 2 + 4, base);
      ctx.lineTo(cx + jw / 2 - 4, base);
      ctx.quadraticCurveTo(cx + jw / 2 + 3, base - 6, cx + jw / 2, top + 8);
      ctx.closePath();
      ctx.fill();
      // Sweets inside: rows of coloured balls.
      const tones = ['#ff5f9e', '#3fd6b0', '#ffd93d', '#b47cf0', '#5ec8ff'];
      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
          const bx = cx - 13 + col * 9 + (row % 2) * 4.5;
          const by = base - 8 - row * 9;
          if (by < top + 12) continue;
          const tone = tones[(row * 4 + col + seed) % tones.length] as string;
          const g = ctx.createRadialGradient(bx - 1.6, by - 1.8, 0.5, bx, by, 5.2);
          g.addColorStop(0, '#ffffff');
          g.addColorStop(0.35, tone);
          g.addColorStop(1, tone);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(bx, by, 4.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Glass edges + highlight.
      ctx.strokeStyle = 'rgba(120, 160, 176, 0.8)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx - jw / 2, top + 8);
      ctx.quadraticCurveTo(cx - jw / 2 - 3, base - 6, cx - jw / 2 + 4, base);
      ctx.moveTo(cx + jw / 2, top + 8);
      ctx.quadraticCurveTo(cx + jw / 2 + 3, base - 6, cx + jw / 2 - 4, base);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - jw / 2 + 7, top + 20);
      ctx.lineTo(cx - jw / 2 + 5, base - 14);
      ctx.stroke();
      // Lid.
      ctx.fillStyle = '#ff74b3';
      ctx.beginPath();
      ctx.ellipse(cx, top + 8, jw / 2 + 2, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(140, 50, 96, 0.8)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = '#ffd93d';
      ctx.beginPath();
      ctx.arc(cx, top + 2, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'cupcake': {
      // A cupcake in a striped case with a swirl of frosting and a cherry.
      contactShadow(ctx, cx, base, 20);
      const cw = 34;
      const ch = 24;
      const top = base - ch;
      ctx.fillStyle = '#ffd93d';
      ctx.beginPath();
      ctx.moveTo(cx - cw / 2, top);
      ctx.lineTo(cx + cw / 2, top);
      ctx.lineTo(cx + cw / 2 - 6, base);
      ctx.lineTo(cx - cw / 2 + 6, base);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(150, 90, 20, 0.7)';
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 2.4;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * 7, top + 1);
        ctx.lineTo(cx + i * 5.6, base - 1);
        ctx.stroke();
      }
      // Frosting: three stacked swirls.
      ctx.strokeStyle = 'rgba(180, 80, 130, 0.5)';
      ctx.lineWidth = 1;
      for (const [i, r] of [
        [0, 17],
        [1, 13],
        [2, 9],
      ] as const) {
        const fy = top - i * 10;
        const g = ctx.createLinearGradient(cx - r, fy - r, cx + r, fy + r);
        g.addColorStop(0, '#fff0f7');
        g.addColorStop(0.5, '#ff9ec9');
        g.addColorStop(1, '#e8558f');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(cx + (i % 2 ? 3 : -3), fy, r, r * 0.62, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      // Cherry.
      ctx.fillStyle = '#e8342f';
      ctx.beginPath();
      ctx.arc(cx + 2, top - 26, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4fb95a';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(cx + 2, top - 31);
      ctx.quadraticCurveTo(cx + 8, top - 40, cx + 13, top - 38);
      ctx.stroke();
      // Sprinkles.
      for (let i = 0; i < 7; i++) {
        ctx.strokeStyle = ['#3fd6b0', '#ffd93d', '#5ec8ff'][i % 3] as string;
        ctx.lineWidth = 2;
        const sx = cx - 12 + rnd() * 24;
        const sy = top - 4 - rnd() * 22;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + 3, sy + 2);
        ctx.stroke();
      }
      break;
    }
    case 'coral-fan': {
      // A sea fan growing out of a sand base, with a couple of polyps lit.
      contactShadow(ctx, cx, base, 24);
      ctx.fillStyle = '#f0dcbe';
      ctx.beginPath();
      ctx.ellipse(cx, base - 3, 20, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      const branch = (x0: number, y0: number, ang: number, len: number, depth: number): void => {
        if (depth === 0 || len < 4) return;
        const x1 = x0 + Math.cos(ang) * len;
        const y1 = y0 + Math.sin(ang) * len;
        ctx.strokeStyle = depth > 2 ? '#e8553f' : depth > 1 ? '#ff7a63' : '#ffab90';
        ctx.lineWidth = depth * 1.5;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo((x0 + x1) / 2 + 2, (y0 + y1) / 2, x1, y1);
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 236, 214, 0.85)';
        ctx.beginPath();
        ctx.arc(x1, y1, depth * 0.8, 0, Math.PI * 2);
        ctx.fill();
        branch(x1, y1, ang - 0.44 - rnd() * 0.16, len * 0.68, depth - 1);
        branch(x1, y1, ang + 0.44 + rnd() * 0.16, len * 0.68, depth - 1);
      };
      branch(cx, base - 6, -Math.PI / 2, 26, 4);
      // A tuft of turquoise kelp beside it.
      ctx.strokeStyle = '#22bfb8';
      ctx.lineWidth = 2.4;
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + dir * 17, base - 5);
        ctx.quadraticCurveTo(cx + dir * 24, base - 26, cx + dir * 15, base - 44);
        ctx.stroke();
      }
      break;
    }
    case 'conch': {
      // A spiral conch lying on its side, pink lip showing.
      contactShadow(ctx, cx, base, 26);
      const g = ctx.createLinearGradient(cx - 24, base - 30, cx + 24, base);
      g.addColorStop(0, '#fff2e4');
      g.addColorStop(0.5, '#ffd8c2');
      g.addColorStop(1, '#d9906f');
      ctx.fillStyle = g;
      ctx.strokeStyle = 'rgba(150, 84, 60, 0.75)';
      // Body whorl.
      ctx.beginPath();
      ctx.moveTo(cx - 24, base - 6);
      ctx.quadraticCurveTo(cx - 20, base - 34, cx + 6, base - 32);
      ctx.quadraticCurveTo(cx + 26, base - 30, cx + 24, base - 8);
      ctx.quadraticCurveTo(cx + 4, base + 1, cx - 24, base - 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Spire: a shrinking spiral of whorls.
      for (let i = 0; i < 4; i++) {
        const t = i / 4;
        const sx = cx - 8 - t * 12;
        const sy = base - 26 - t * 10;
        ctx.beginPath();
        ctx.ellipse(sx, sy, 10 - t * 7, 7 - t * 5, -0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      // Ridged sculpture + the pink aperture lip.
      ctx.strokeStyle = 'rgba(180, 110, 80, 0.5)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const t = i / 5;
        ctx.beginPath();
        ctx.moveTo(cx - 14 + t * 34, base - 30 + t * 6);
        ctx.quadraticCurveTo(cx + t * 20, base - 16, cx - 10 + t * 30, base - 3);
        ctx.stroke();
      }
      ctx.fillStyle = '#ff9ec2';
      ctx.beginPath();
      ctx.ellipse(cx + 19, base - 12, 7, 11, -0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(180, 90, 110, 0.7)';
      ctx.stroke();
      break;
    }
    case 'rocket': {
      // A cartoon rocket on a launch stand, fins out, exhaust glowing.
      contactShadow(ctx, cx, base, 22);
      // Stand legs.
      ctx.strokeStyle = '#8f9ac4';
      ctx.lineWidth = 2.6;
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + dir * 4, base - 22);
        ctx.lineTo(cx + dir * 15, base);
        ctx.stroke();
      }
      const bw = 24;
      const top = base - 76;
      const body = ctx.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
      body.addColorStop(0, '#8ea8d8');
      body.addColorStop(0.4, '#f4f8ff');
      body.addColorStop(1, '#7f8fc4');
      ctx.fillStyle = body;
      ctx.strokeStyle = 'rgba(40, 30, 76, 0.85)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx - bw / 2, base - 24);
      ctx.lineTo(cx - bw / 2, top + 22);
      ctx.quadraticCurveTo(cx, top - 14, cx + bw / 2, top + 22);
      ctx.lineTo(cx + bw / 2, base - 24);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // Nose cone + fins in hot magenta.
      ctx.fillStyle = '#ff45b8';
      ctx.beginPath();
      ctx.moveTo(cx - bw / 2, top + 22);
      ctx.quadraticCurveTo(cx, top - 14, cx + bw / 2, top + 22);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + (dir * bw) / 2, base - 44);
        ctx.quadraticCurveTo(cx + dir * 24, base - 34, cx + dir * 20, base - 22);
        ctx.lineTo(cx + (dir * bw) / 2, base - 26);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      // Porthole.
      ctx.fillStyle = '#12d3e8';
      ctx.beginPath();
      ctx.arc(cx, base - 54, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffcf3f';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.beginPath();
      ctx.ellipse(cx - 2.4, base - 56.5, 2.4, 1.4, -0.6, 0, Math.PI * 2);
      ctx.fill();
      // Exhaust glow under the tail.
      const flame = ctx.createRadialGradient(cx, base - 22, 1, cx, base - 22, 18);
      flame.addColorStop(0, 'rgba(255, 246, 200, 0.9)');
      flame.addColorStop(0.4, 'rgba(255, 160, 60, 0.5)');
      flame.addColorStop(1, 'rgba(255, 120, 40, 0)');
      ctx.fillStyle = flame;
      ctx.beginPath();
      ctx.arc(cx, base - 22, 18, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: {
      // planet — a ringed world on a wire stand.
      contactShadow(ctx, cx, base, 22);
      ctx.strokeStyle = '#8f9ac4';
      ctx.lineWidth = 2.2;
      line(ctx, j, cx, base - 4, cx, base - 30);
      ctx.beginPath();
      ctx.ellipse(cx, base - 3, 13, 4, 0, 0, Math.PI * 2);
      ctx.stroke();
      const py = base - 52;
      const r = 21;
      const halo = ctx.createRadialGradient(cx, py, r * 0.6, cx, py, r * 2.1);
      halo.addColorStop(0, 'rgba(140, 230, 255, 0.34)');
      halo.addColorStop(1, 'rgba(140, 230, 255, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, py, r * 2.1, 0, Math.PI * 2);
      ctx.fill();
      // Ring behind.
      ctx.strokeStyle = 'rgba(120, 244, 255, 0.85)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(cx, py, r * 1.7, r * 0.5, -0.35, Math.PI, Math.PI * 2);
      ctx.stroke();
      const body = ctx.createRadialGradient(cx - 7, py - 8, 2, cx, py, r);
      body.addColorStop(0, '#ffd9a0');
      body.addColorStop(0.45, '#ff8f4a');
      body.addColorStop(1, '#a83f8a');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(cx, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(40, 24, 60, 0.7)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // Cloud bands + a storm spot.
      ctx.strokeStyle = 'rgba(255, 238, 200, 0.45)';
      ctx.lineWidth = 1.6;
      for (const off of [-0.5, -0.15, 0.25, 0.6]) {
        ctx.beginPath();
        ctx.ellipse(cx, py + off * r, r * 0.96, r * 0.16, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(226, 84, 60, 0.75)';
      ctx.beginPath();
      ctx.ellipse(cx + 6, py + 4, 5, 3, 0.2, 0, Math.PI * 2);
      ctx.fill();
      // Ring in front.
      ctx.strokeStyle = 'rgba(255, 120, 214, 0.9)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(cx, py, r * 1.7, r * 0.5, -0.35, 0, Math.PI);
      ctx.stroke();
      // A tiny moon.
      ctx.fillStyle = '#e2f4ff';
      ctx.beginPath();
      ctx.arc(cx + 26, py - 20, 4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}
