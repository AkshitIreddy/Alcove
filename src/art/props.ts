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
