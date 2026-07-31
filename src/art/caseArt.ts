/**
 * art/caseArt.ts â€” themed bookcase carpentry (docs/design/library-themes.md Â§1).
 *
 * Variant renderers for every visible part of the case, driven entirely by a
 * `LibraryTheme` from art/themes.ts:
 *
 *   crown/cornice  â€” 6 profiles Ã— 6 carving vocabularies + a centrepiece
 *   side rail      â€” 4 edge treatments Ã— 5 inlays
 *   shelf plank    â€” lit lip, front edge, joinery run, optional under-shelf
 *                    detail (apothecary drawers, cottage bunting)
 *   back panel     â€” timber, or the room's own wall (scriptorium plaster,
 *                    attic lath) showing straight through the case
 *   joinery        â€” pegs Â· iron straps + rivets Â· clean mitre Â·
 *                    painted-and-chipped Â· square nails Â· brass brackets
 *   floor plate    â€” brass Â· enamel Â· wood-burnt Â· paper tag Â· slate Â· tin,
 *                    each accepting a label string
 *   light rig      â€” ambient cast, pools with drift, rim light, dust shafts,
 *                    vignette
 *
 * Everything is pure Canvas2D, deterministic per seed, and authored in world
 * px at the current transform so a caller can bake it at any DPR. Nothing
 * here runs per frame: use the `bake*` wrappers, which persist through the
 * bake.ts disk cache keyed by THEME_RECIPE_VERSION.
 *
 * This module renders the case only. Books, flora, props and motes are drawn
 * by their own modules over the top (see "integration points" in the theme
 * system docs).
 */

import * as P from './brush';
import { bakeCached } from './bake';
import { clamp, fnv1a, mulberry32, type RandomFn } from './noise';
import type { Canvas2D, Ctx2D } from './spines';
import {
  getTheme,
  THEME_RECIPE_VERSION,
  type CrownSpec,
  type JoinerySpec,
  type LibraryTheme,
  type LightSpec,
  type PlateSpec,
  type ThemeId,
} from './themes';
import { drawMaterialRect, getMaterialTile, whenMaterialsReady } from './materials';
import { getColourway, renderWallpaper, wallpaperHasPrint, wallpaperRepeat } from './wallpaper';
import { hexAlpha, mixHex, paintWood, parseHex } from './wood';
import { doubleStroke } from './wobble';
import type { BackdropId, WallpaperSpec } from './themes';

/** Local 0..1 clamp for the painted passes. */
function clamp01Case(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/* ============================== primitives =============================== */

function makeCanvas(w: number, h: number): Canvas2D {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function get2d(c: Canvas2D): Ctx2D {
  const ctx = (c as OffscreenCanvas).getContext('2d');
  if (!ctx) throw new Error('caseArt: 2d context unavailable');
  return ctx as Ctx2D;
}

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Doubled wobbled pencil pass â€” the hand-drawn arris line. */
function pencil(ctx: Ctx2D, d: string, seed: number, amplitude = 0.7): void {
  const [a, b] = doubleStroke(d, { seed: seed >>> 0, amplitude, frequency: 0.028 });
  ctx.stroke(new Path2D(a));
  ctx.stroke(new Path2D(b));
}

/** Straight-ish hand line (cheap; for high-count details). */
function handLine(ctx: Ctx2D, x0: number, y0: number, x1: number, y1: number, rnd: RandomFn): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo(
    (x0 + x1) / 2 + (rnd() * 2 - 1) * 1.1,
    (y0 + y1) / 2 + (rnd() * 2 - 1) * 1.1,
    x1,
    y1,
  );
  ctx.stroke();
}

/* =============================== joinery ================================= */

/**
 * Draw the theme's joinery fitting inside the box (x, y, w, h). What that
 * means depends on the vocabulary: a peg pair, a riveted iron strap, a bare
 * mitre line, a chipped painted joint, square nails, or a brass bracket.
 * `orientation` is the axis of the member being joined.
 */
export function renderJoinery(
  ctx: Ctx2D,
  j: JoinerySpec,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  orientation: 'horizontal' | 'vertical' = 'horizontal',
): void {
  const rnd = mulberry32(seed >>> 0);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (j.kind) {
    case 'peg': {
      // Square-shouldered oak pegs through the tenon: two per joint.
      const r = j.size;
      const pts: Array<[number, number]> =
        orientation === 'horizontal'
          ? [
              [x + w * 0.3, y + h / 2],
              [x + w * 0.7, y + h / 2],
            ]
          : [
              [x + w / 2, y + h * 0.32],
              [x + w / 2, y + h * 0.68],
            ];
      for (const [px, py] of pts) drawPegFitting(ctx, j, px, py, r, rnd);
      break;
    }
    case 'iron-strap': {
      // A forged strap plate with a hammered edge and rivet heads.
      const sw = orientation === 'horizontal' ? w : j.size * 1.6;
      const sh = orientation === 'horizontal' ? j.size * 1.6 : h;
      const sx = x + (w - sw) / 2;
      const sy = y + (h - sh) / 2;
      drawStrap(ctx, j, sx, sy, sw, sh, rnd, orientation);
      break;
    }
    case 'mitre': {
      // Invisible joinery. The ornament is the accuracy of the cut: one
      // hairline shadow with a whisper of light on the proud side.
      ctx.strokeStyle = hexAlpha('#2c2418', 0.28);
      ctx.lineWidth = 1;
      const d =
        orientation === 'horizontal'
          ? `M ${x} ${y + h / 2} L ${x + w} ${y + h / 2}`
          : `M ${x + w / 2} ${y} L ${x + w / 2} ${y + h}`;
      ctx.stroke(new Path2D(d));
      ctx.strokeStyle = 'rgba(255, 252, 244, 0.34)';
      ctx.translate(orientation === 'horizontal' ? 0 : 1, orientation === 'horizontal' ? 1 : 0);
      ctx.stroke(new Path2D(d));
      break;
    }
    case 'painted-chip': {
      // The joint itself is invisible under paint; what shows is where the
      // paint has been knocked off the arris and the wood beneath.
      const count = 3 + Math.floor(rnd() * 3);
      for (let i = 0; i < count; i++) {
        const cx = x + rnd() * w;
        const cy = y + h * (0.3 + rnd() * 0.4);
        const r = j.size * (0.5 + rnd());
        ctx.beginPath();
        const pts = 7;
        for (let p = 0; p <= pts; p++) {
          const a = (p / pts) * Math.PI * 2;
          const rr = r * (0.5 + rnd() * 0.8);
          const px = cx + Math.cos(a) * rr;
          const py = cy + Math.sin(a) * rr * 0.75;
          if (p === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = j.metalDark;
        ctx.fill();
        ctx.strokeStyle = j.highlight;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      break;
    }
    case 'nail-head': {
      const count = orientation === 'horizontal' ? 2 : 2;
      for (let i = 0; i < count; i++) {
        const px = orientation === 'horizontal' ? x + w * (0.25 + 0.5 * i) : x + w / 2;
        const py = orientation === 'horizontal' ? y + h / 2 : y + h * (0.25 + 0.5 * i);
        drawNail(ctx, j, px, py, j.size, rnd);
      }
      break;
    }
    case 'brass-bracket': {
      drawBracket(ctx, j, x + w / 2, y + h / 2, j.size, rnd, orientation);
      break;
    }
    case 'hex-bolt':
    case 'bone-pin':
    case 'candy-stud':
    case 'shell-rivet':
    case 'star-rivet':
    case 'vine-tie': {
      // The colourful worlds all fix their carcass with a *pair* of visible
      // fittings, exactly where the pegs would go — the vocabulary changes,
      // the carpentry logic does not.
      const pts: Array<[number, number]> =
        orientation === 'horizontal'
          ? [
              [x + w * 0.3, y + h / 2],
              [x + w * 0.7, y + h / 2],
            ]
          : [
              [x + w / 2, y + h * 0.32],
              [x + w / 2, y + h * 0.68],
            ];
      for (const [px, py] of pts) {
        switch (j.kind) {
          case 'hex-bolt':
            drawHexBolt(ctx, j, px, py, j.size, rnd);
            break;
          case 'bone-pin':
            drawBonePin(ctx, j, px, py, j.size, rnd);
            break;
          case 'candy-stud':
            drawCandyStud(ctx, j, px, py, j.size, rnd);
            break;
          case 'shell-rivet':
            drawShellRivet(ctx, j, px, py, j.size, rnd);
            break;
          case 'star-rivet':
            drawStarRivet(ctx, j, px, py, j.size, rnd);
            break;
          default:
            drawVineTie(ctx, j, px, py, j.size, rnd, orientation);
            break;
        }
      }
      break;
    }
  }
  ctx.restore();
}

/** Machined hex head sitting on a washer, with a lit chamfer. */
function drawHexBolt(ctx: Ctx2D, j: JoinerySpec, x: number, y: number, r: number, rnd: RandomFn): void {
  // Washer + its shadow in the panel.
  ctx.fillStyle = 'rgba(10, 16, 24, 0.42)';
  ctx.beginPath();
  ctx.arc(x + 0.8, y + 1.2, r * 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hexAlpha(parseHexToHex(j.metalDark), 0.9);
  ctx.beginPath();
  ctx.arc(x, y, r * 1.45, 0, Math.PI * 2);
  ctx.fill();
  // Hex head: a lit facet, a mid facet, a shadow facet.
  const hex = (rr: number): void => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.26;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  };
  const g = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  g.addColorStop(0, mixHex(j.metal, '#ffffff', 0.5));
  g.addColorStop(0.45, j.metal);
  g.addColorStop(1, j.metalDark);
  ctx.fillStyle = g;
  hex(r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(14, 22, 32, 0.75)';
  ctx.lineWidth = 0.9;
  ctx.stroke();
  // Turned top face.
  ctx.strokeStyle = j.highlight;
  ctx.lineWidth = 0.8;
  hex(r * 0.55);
  ctx.stroke();
  void rnd;
}

/** A polished bone dowel seated in a bronze collar. */
function drawBonePin(ctx: Ctx2D, j: JoinerySpec, x: number, y: number, r: number, rnd: RandomFn): void {
  ctx.fillStyle = 'rgba(40, 22, 8, 0.42)';
  ctx.beginPath();
  ctx.ellipse(x + 0.8, y + 1.4, r * 1.4, r * 1.2, 0, 0, Math.PI * 2);
  ctx.fill();
  // Bronze collar.
  ctx.fillStyle = 'rgba(168, 106, 40, 0.9)';
  ctx.beginPath();
  ctx.arc(x, y, r * 1.35, 0, Math.PI * 2);
  ctx.fill();
  // Bone: a rounded dowel end with a marrow shadow and two hairline cracks.
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, '#fffaf0');
  g.addColorStop(0.55, j.metal);
  g.addColorStop(1, j.metalDark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(150, 122, 84, 0.5)';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.15, y + r * 0.1, r * 0.35, r * 0.28, 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 96, 60, 0.55)';
  ctx.lineWidth = 0.7;
  for (let i = 0; i < 2; i++) {
    const a = rnd() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(a) * r * 0.8, y - Math.sin(a) * r * 0.8);
    ctx.lineTo(x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.6);
    ctx.stroke();
  }
}

/** A jelly-bean stud: fat gloss highlight, sugar rim. */
function drawCandyStud(ctx: Ctx2D, j: JoinerySpec, x: number, y: number, r: number, rnd: RandomFn): void {
  ctx.fillStyle = 'rgba(140, 50, 96, 0.3)';
  ctx.beginPath();
  ctx.ellipse(x + 0.6, y + 1.6, r * 1.15, r * 1.05, 0, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.1, x, y, r * 1.1);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.3, j.metal);
  g.addColorStop(1, j.metalDark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 1.1, r, 0, 0, Math.PI * 2);
  ctx.fill();
  // The hard little gloss dot that makes a sweet look wet.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.beginPath();
  ctx.ellipse(x - r * 0.34, y - r * 0.4, r * 0.3, r * 0.2, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hexAlpha(parseHexToHex(j.metalDark), 0.7);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 1.1, r, 0, 0, Math.PI * 2);
  ctx.stroke();
  void rnd;
}

/** A little scallop shell capping a pearl. */
function drawShellRivet(ctx: Ctx2D, j: JoinerySpec, x: number, y: number, r: number, rnd: RandomFn): void {
  ctx.fillStyle = 'rgba(8, 50, 62, 0.34)';
  ctx.beginPath();
  ctx.ellipse(x + 0.6, y + 1.4, r * 1.2, r * 1.1, 0, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createLinearGradient(x, y - r, x, y + r);
  g.addColorStop(0, mixHex(j.metal, '#ffffff', 0.6));
  g.addColorStop(1, j.metalDark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.05, Math.PI, Math.PI * 2);
  // Scalloped lower edge.
  const lobes = 5;
  for (let i = 0; i <= lobes; i++) {
    const t = i / lobes;
    const px = x + r * 1.05 - t * r * 2.1;
    ctx.quadraticCurveTo(px + r * 0.2, y + r * 0.5, px - r * 0.21, y);
  }
  ctx.closePath();
  ctx.fill();
  // Radiating ribs.
  ctx.strokeStyle = hexAlpha(parseHexToHex(j.metalDark), 0.6);
  ctx.lineWidth = 0.7;
  for (let i = 0; i <= 4; i++) {
    const a = Math.PI + (i / 4) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    ctx.stroke();
  }
  // Pearl at the hinge.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  ctx.arc(x, y + r * 0.1, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
  void rnd;
}

/** A star washer with a neon core burning through it. */
function drawStarRivet(ctx: Ctx2D, j: JoinerySpec, x: number, y: number, r: number, rnd: RandomFn): void {
  // Halo first, so the fitting sits inside its own glow.
  const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 3.4);
  halo.addColorStop(0, hexAlpha(parseHexToHex(j.metal), 0.4));
  halo.addColorStop(1, hexAlpha(parseHexToHex(j.metal), 0));
  ctx.fillStyle = halo;
  ctx.fillRect(x - r * 3.4, y - r * 3.4, r * 6.8, r * 6.8);
  ctx.fillStyle = hexAlpha(parseHexToHex(j.metalDark), 0.95);
  ctx.beginPath();
  ctx.arc(x, y, r * 1.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = j.metal;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r * 1.15 : r * 0.46;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = j.highlight;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.34, 0, Math.PI * 2);
  ctx.fill();
  void rnd;
}

/** Whipped twine binding the joint, with one tendril escaping it. */
function drawVineTie(
  ctx: Ctx2D,
  j: JoinerySpec,
  x: number,
  y: number,
  r: number,
  rnd: RandomFn,
  orientation: 'horizontal' | 'vertical',
): void {
  const vertical = orientation === 'vertical';
  const len = r * 3.2;
  // Whipping: a stack of twine turns across the member.
  ctx.save();
  ctx.translate(x, y);
  if (vertical) ctx.rotate(Math.PI / 2);
  ctx.fillStyle = 'rgba(60, 42, 24, 0.3)';
  roundRect(ctx, -len / 2 + 0.6, -r * 1.1 + 1.2, len, r * 2.2, r);
  ctx.fill();
  ctx.fillStyle = '#d9c39a';
  roundRect(ctx, -len / 2, -r * 1.1, len, r * 2.2, r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(122, 96, 58, 0.7)';
  ctx.lineWidth = 0.8;
  const turns = 5;
  for (let i = 0; i <= turns; i++) {
    const tx = -len / 2 + (i / turns) * len;
    ctx.beginPath();
    ctx.moveTo(tx, -r * 1.1);
    ctx.lineTo(tx + 1.4, r * 1.1);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(90, 70, 40, 0.55)';
  roundRect(ctx, -len / 2, -r * 1.1, len, r * 2.2, r);
  ctx.stroke();
  ctx.restore();
  // A tendril escaping the binding, with two small leaves.
  ctx.strokeStyle = j.metalDark;
  ctx.lineWidth = 1.3;
  const dir = rnd() < 0.5 ? -1 : 1;
  const tipX = x + dir * r * 3.4;
  const tipY = y - r * 2.6;
  ctx.beginPath();
  ctx.moveTo(x, y - r * 0.6);
  ctx.quadraticCurveTo(x + dir * r * 2.6, y - r * 1.2, tipX, tipY);
  ctx.stroke();
  ctx.fillStyle = j.metal;
  for (const t of [0.55, 1]) {
    const lx = x + (tipX - x) * t;
    const ly = y - r * 0.6 + (tipY - (y - r * 0.6)) * t;
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(dir * 0.8 + t);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.1, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawPegFitting(ctx: Ctx2D, j: JoinerySpec, x: number, y: number, r: number, rnd: RandomFn): void {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.15, x, y, r);
  g.addColorStop(0, mixHex(j.metal, '#ffffff', 0.25));
  g.addColorStop(0.55, j.metal);
  g.addColorStop(1, j.metalDark);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // End grain: two short arcs across the peg face.
  ctx.strokeStyle = hexAlpha(j.metalDark, 0.7);
  ctx.lineWidth = 0.7;
  for (let i = 0; i < 2; i++) {
    ctx.beginPath();
    ctx.arc(x - r * 0.6, y, r * (0.8 + i * 0.5), -0.7, 0.7);
    ctx.stroke();
  }
  ctx.strokeStyle = j.highlight;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.arc(x - r * 0.18, y - r * 0.18, r * 0.55, Math.PI * 0.8, Math.PI * 1.6);
  ctx.stroke();
  // Seated shadow ring.
  ctx.strokeStyle = 'rgba(38, 28, 18, 0.55)';
  ctx.lineWidth = 1;
  handLine(ctx, x - r, y + r * 0.2, x + r, y + r * 0.2, rnd);
  ctx.beginPath();
  ctx.arc(x, y, r + 0.4, 0, Math.PI * 2);
  ctx.stroke();
}

function drawStrap(
  ctx: Ctx2D,
  j: JoinerySpec,
  x: number,
  y: number,
  w: number,
  h: number,
  rnd: RandomFn,
  orientation: 'horizontal' | 'vertical',
): void {
  // Drop shadow under the ironwork.
  ctx.fillStyle = 'rgba(16, 12, 8, 0.4)';
  roundRect(ctx, x + 1.5, y + 2, w, h, Math.min(w, h) / 2);
  ctx.fill();

  const g =
    orientation === 'horizontal'
      ? ctx.createLinearGradient(0, y, 0, y + h)
      : ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, mixHex(j.metal, '#ffffff', 0.35));
  g.addColorStop(0.35, j.metal);
  g.addColorStop(1, j.metalDark);
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, Math.min(w, h) / 2);
  ctx.fill();

  // Hammered facets: short bright/dark dashes across the strap.
  const along = orientation === 'horizontal' ? w : h;
  const facets = Math.max(4, Math.round(along / 7));
  for (let i = 0; i < facets; i++) {
    const t = (i + 0.5) / facets;
    ctx.strokeStyle = rnd() < 0.5 ? j.highlight : 'rgba(18, 15, 12, 0.35)';
    ctx.lineWidth = 0.9 + rnd();
    if (orientation === 'horizontal') {
      const px = x + t * w;
      ctx.beginPath();
      ctx.moveTo(px, y + 1.5);
      ctx.lineTo(px + (rnd() * 2 - 1) * 2, y + h - 1.5);
      ctx.stroke();
    } else {
      const py = y + t * h;
      ctx.beginPath();
      ctx.moveTo(x + 1.5, py);
      ctx.lineTo(x + w - 1.5, py + (rnd() * 2 - 1) * 2);
      ctx.stroke();
    }
  }

  // Rivets along the strap.
  const rivets = Math.max(2, Math.round(along / 26));
  for (let i = 0; i < rivets; i++) {
    const t = (i + 0.5) / rivets;
    const rx = orientation === 'horizontal' ? x + t * w : x + w / 2;
    const ry = orientation === 'horizontal' ? y + h / 2 : y + t * h;
    const r = Math.min(w, h) * 0.26;
    const rg = ctx.createRadialGradient(rx - r * 0.4, ry - r * 0.4, 0, rx, ry, r);
    rg.addColorStop(0, j.highlight);
    rg.addColorStop(0.5, j.metal);
    rg.addColorStop(1, j.metalDark);
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(rx, ry, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(14, 11, 8, 0.55)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }

  // Pencil outline so the ironwork still reads as drawn, not rendered.
  ctx.strokeStyle = 'rgba(20, 16, 12, 0.5)';
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, Math.min(w, h) / 2);
  ctx.stroke();
}

function drawNail(ctx: Ctx2D, j: JoinerySpec, x: number, y: number, r: number, rnd: RandomFn): void {
  // Rust bloom in the timber around the nail.
  const rust = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
  rust.addColorStop(0, 'rgba(128, 74, 38, 0.32)');
  rust.addColorStop(1, 'rgba(128, 74, 38, 0)');
  ctx.fillStyle = rust;
  ctx.beginPath();
  ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
  ctx.fill();
  // Square hand-forged head, slightly askew.
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rnd() * 2 - 1) * 0.5);
  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, j.highlight);
  g.addColorStop(0.4, j.metal);
  g.addColorStop(1, j.metalDark);
  ctx.fillStyle = g;
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.strokeStyle = 'rgba(28, 24, 18, 0.6)';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(-r, -r, r * 2, r * 2);
  // Struck dimple.
  ctx.fillStyle = 'rgba(30, 26, 20, 0.45)';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBracket(
  ctx: Ctx2D,
  j: JoinerySpec,
  x: number,
  y: number,
  s: number,
  rnd: RandomFn,
  orientation: 'horizontal' | 'vertical',
): void {
  const w = s * 3.4;
  const h = s * 2.2;
  ctx.save();
  ctx.translate(x, y);
  if (orientation === 'vertical') ctx.rotate(Math.PI / 2);
  ctx.fillStyle = 'rgba(20, 14, 8, 0.35)';
  roundRect(ctx, -w / 2 + 1, -h / 2 + 1.5, w, h, 2);
  ctx.fill();
  const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  g.addColorStop(0, mixHex(j.metal, '#fff6d8', 0.5));
  g.addColorStop(0.4, j.metal);
  g.addColorStop(1, j.metalDark);
  ctx.fillStyle = g;
  roundRect(ctx, -w / 2, -h / 2, w, h, 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40, 28, 10, 0.5)';
  ctx.lineWidth = 0.9;
  ctx.stroke();
  // Slotted screws at each end.
  for (const sx of [-w / 2 + s * 0.8, w / 2 - s * 0.8]) {
    const r = s * 0.5;
    const sg = ctx.createRadialGradient(sx - r * 0.3, -r * 0.3, 0, sx, 0, r);
    sg.addColorStop(0, j.highlight);
    sg.addColorStop(1, j.metalDark);
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(sx, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 20, 6, 0.7)';
    ctx.lineWidth = 0.9;
    const a = rnd() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(sx - Math.cos(a) * r * 0.8, -Math.sin(a) * r * 0.8);
    ctx.lineTo(sx + Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
    ctx.stroke();
  }
  ctx.restore();
}

/* ================================ carving ================================ */

/**
 * Run the crown's carving vocabulary along a band. Each variant shades its
 * own relief (lit top face, shadowed right face) so it reads as cut timber
 * rather than a printed pattern.
 */
export function renderCarving(
  ctx: Ctx2D,
  carving: CrownSpec['carving'],
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  accent: string,
): void {
  const rnd = mulberry32(seed >>> 0);
  ctx.save();
  switch (carving) {
    case 'dentil': {
      // Tooth blocks standing PROUD of a dark recess. The recess goes down
      // first across the whole band, then each block is modelled on top:
      // lit top arris, lit face, shadowed right cheek, contact shadow.
      const pitch = 17;
      const bw = 10;
      ctx.fillStyle = 'rgba(18, 12, 6, 0.55)';
      ctx.fillRect(x, y, w, h);
      for (let dx = x + 3; dx + bw < x + w - 3; dx += pitch) {
        ctx.fillStyle = 'rgba(255, 238, 206, 0.3)';
        ctx.fillRect(dx, y + 1, bw, h - 2);
        const face = ctx.createLinearGradient(dx, y, dx + bw, y);
        face.addColorStop(0, 'rgba(255, 248, 226, 0.34)');
        face.addColorStop(0.62, 'rgba(255, 240, 210, 0.06)');
        face.addColorStop(1, 'rgba(24, 16, 8, 0.42)');
        ctx.fillStyle = face;
        ctx.fillRect(dx, y + 1, bw, h - 2);
        ctx.fillStyle = 'rgba(255, 250, 232, 0.5)';
        ctx.fillRect(dx, y + 1, bw, 1.6);
        ctx.fillStyle = 'rgba(16, 10, 5, 0.5)';
        ctx.fillRect(dx, y + h - 2.4, bw, 2.4);
        // Cast shadow into the recess to the right of each tooth.
        const g = ctx.createLinearGradient(dx + bw, 0, dx + pitch, 0);
        g.addColorStop(0, 'rgba(10, 6, 2, 0.5)');
        g.addColorStop(1, 'rgba(10, 6, 2, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(dx + bw, y, pitch - bw, h);
      }
      // Fillet above and below the run, so the dentils sit in a moulding.
      ctx.fillStyle = 'rgba(255, 248, 228, 0.26)';
      ctx.fillRect(x, y - 2.4, w, 2.4);
      ctx.fillStyle = 'rgba(20, 13, 6, 0.4)';
      ctx.fillRect(x, y + h, w, 2);
      break;
    }
    case 'star-punch': {
      const pitch = 26;
      for (let dx = x + pitch / 2; dx < x + w - 6; dx += pitch) {
        const cy = y + h / 2;
        const r = Math.min(h * 0.42, 8);
        // Punched star: dark pierced centre with a bright burnished rim.
        ctx.fillStyle = 'rgba(10, 12, 20, 0.6)';
        ctx.beginPath();
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
          const rr = i % 2 === 0 ? r : r * 0.42;
          const px = dx + Math.cos(a) * rr;
          const py = cy + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 0.9;
        ctx.stroke();
        // Tiny drilled hole between stars.
        ctx.fillStyle = 'rgba(8, 10, 18, 0.5)';
        ctx.beginPath();
        ctx.arc(dx + pitch / 2, cy, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'scallop': {
      const pitch = 24;
      const r = pitch / 2;
      for (let dx = x + r; dx < x + w; dx += pitch) {
        const cy = y + h * 0.15;
        ctx.beginPath();
        ctx.arc(dx, cy, r, 0.06 * Math.PI, 0.94 * Math.PI);
        const g = ctx.createLinearGradient(0, cy, 0, cy + r);
        g.addColorStop(0, 'rgba(255, 252, 244, 0.3)');
        g.addColorStop(1, 'rgba(60, 54, 40, 0.3)');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(58, 62, 48, 0.35)';
        ctx.lineWidth = 1.1;
        ctx.stroke();
        // Shell fluting inside the scallop.
        ctx.strokeStyle = 'rgba(58, 62, 48, 0.22)';
        ctx.lineWidth = 0.7;
        for (let i = 1; i < 5; i++) {
          const a = 0.1 * Math.PI + (i / 5) * 0.8 * Math.PI;
          ctx.beginPath();
          ctx.moveTo(dx, cy);
          ctx.lineTo(dx + Math.cos(a) * r * 0.95, cy + Math.sin(a) * r * 0.95);
          ctx.stroke();
        }
      }
      break;
    }
    case 'notch': {
      const pitch = 14;
      for (let dx = x + 4; dx < x + w - 8; dx += pitch) {
        // Chip-carved V: one lit face, one shadowed face.
        ctx.fillStyle = 'rgba(255, 246, 226, 0.28)';
        ctx.beginPath();
        ctx.moveTo(dx, y);
        ctx.lineTo(dx + pitch * 0.4, y + h);
        ctx.lineTo(dx + pitch * 0.4, y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(70, 48, 28, 0.34)';
        ctx.beginPath();
        ctx.moveTo(dx + pitch * 0.4, y + h);
        ctx.lineTo(dx + pitch * 0.8, y);
        ctx.lineTo(dx + pitch * 0.4, y);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'ovolo': {
      // Bead-and-reel: a rounded bead running the length, cut into alternating
      // ovals and discs so the moulding reads as turned, not printed.
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, 'rgba(255, 252, 240, 0.5)');
      g.addColorStop(0.42, 'rgba(255, 244, 218, 0.14)');
      g.addColorStop(1, 'rgba(64, 42, 24, 0.44)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      const cy = y + h / 2;
      const rr = h * 0.4;
      const pitch = 20;
      for (let dx = x + 6; dx < x + w - 6; dx += pitch) {
        // Oval bead.
        ctx.fillStyle = 'rgba(255, 250, 234, 0.34)';
        ctx.beginPath();
        ctx.ellipse(dx, cy, rr * 0.9, rr, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(70, 46, 26, 0.45)';
        ctx.lineWidth = 1;
        ctx.stroke();
        // Reel: two discs seen edge-on between the beads.
        ctx.fillStyle = 'rgba(56, 36, 20, 0.4)';
        ctx.fillRect(dx + rr * 1.3, cy - rr * 0.5, 2, rr);
        ctx.fillStyle = 'rgba(255, 248, 228, 0.3)';
        ctx.fillRect(dx + rr * 1.3 + 2, cy - rr * 0.5, 1.2, rr);
      }
      ctx.strokeStyle = 'rgba(88, 62, 38, 0.4)';
      ctx.lineWidth = 1.2;
      for (const fy of [y + 0.8, y + h - 0.8]) {
        ctx.beginPath();
        ctx.moveTo(x, fy);
        ctx.lineTo(x + w, fy);
        ctx.stroke();
      }
      void rnd;
      break;
    }
    case 'blossom': {
      // A blossom swag CARVED into the frieze, not painted onto it.
      //
      // This used to draw saturated green swags and pink petals straight onto
      // the timber, at a perfectly regular pitch. Two problems: coloured decals
      // on wood read as stickers rather than furniture, and mechanical spacing
      // is the loudest tell of computer-generated art (ART-BIBLE §5).
      //
      // So it is now relief: a shadowed incision with a lit upper arris, in
      // wood tones only, with each rosette jittered per unit.
      const pitch = 46;
      const swag = (dx: number, off: number, colour: string, width: number): void => {
        ctx.strokeStyle = colour;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(dx, y + h * 0.3 + off);
        ctx.quadraticCurveTo(dx + pitch / 2, y + h * 1.02 + off, dx + pitch, y + h * 0.3 + off);
        ctx.stroke();
      };

      for (let dx = x; dx < x + w; dx += pitch) {
        // Cut first (dark groove), then the light that catches its top edge.
        swag(dx, 0.9, 'rgba(28, 16, 8, 0.42)', 3.0);
        swag(dx, -0.5, 'rgba(255, 246, 224, 0.20)', 1.3);
      }

      for (let dx = x; dx < x + w; dx += pitch) {
        // Per-unit jitter: a chisel does not repeat exactly.
        const jx = (rnd() - 0.5) * 3.2;
        const jy = (rnd() - 0.5) * 1.8;
        const scale = 0.86 + rnd() * 0.3;
        const mx = dx + pitch / 2 + jx;
        const my = y + h * 0.78 + jy;
        if (mx + 8 > x + w) continue;

        // Leaves either side — carved lobes, read by shadow under and light on top.
        for (const side of [-1, 1]) {
          ctx.save();
          ctx.translate(mx + side * 11, my - 2);
          ctx.rotate(side * (0.62 + rnd() * 0.18));
          ctx.fillStyle = 'rgba(30, 18, 9, 0.30)';
          ctx.beginPath();
          ctx.ellipse(0, 1.1, 7 * scale, 3.4 * scale, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255, 244, 220, 0.16)';
          ctx.beginPath();
          ctx.ellipse(0, -0.5, 6.2 * scale, 2.8 * scale, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // Rosette: five petals sunk into the wood, with a proud boss.
        const spin = rnd() * Math.PI;
        for (let p = 0; p < 5; p++) {
          const a = spin + (p / 5) * Math.PI * 2;
          const px = mx + Math.cos(a) * 3.4 * scale;
          const py = my + Math.sin(a) * 3.4 * scale;
          ctx.fillStyle = 'rgba(28, 16, 8, 0.34)';
          ctx.beginPath();
          ctx.ellipse(px, py + 0.8, 3.4 * scale, 2.5 * scale, a, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = 'rgba(255, 246, 226, 0.17)';
          ctx.beginPath();
          ctx.ellipse(px, py - 0.5, 3.0 * scale, 2.1 * scale, a, 0, Math.PI * 2);
          ctx.fill();
        }
        // Centre boss catches the key light; `accent` lets a room gild it.
        ctx.fillStyle = 'rgba(28, 16, 8, 0.34)';
        ctx.beginPath();
        ctx.arc(mx, my + 0.7, 2.1 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hexAlpha(accent, 0.5);
        ctx.beginPath();
        ctx.arc(mx, my - 0.3, 1.7 * scale, 0, Math.PI * 2);
        ctx.fill();
      }
      // A pale sap-line above the swag ties it to the crown.
      ctx.strokeStyle = 'rgba(255, 252, 232, 0.4)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y + 1.6);
      ctx.lineTo(x + w, y + 1.6);
      ctx.stroke();
      break;
    }
    case 'circuit': {
      // An etched board: a dark solder-resist band, copper routes, lit pads.
      ctx.fillStyle = 'rgba(8, 22, 32, 0.7)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'square';
      const lanes = 3;
      for (let l = 0; l < lanes; l++) {
        const ly = y + ((l + 0.7) * h) / (lanes + 0.4);
        ctx.beginPath();
        let px = x + 4;
        ctx.moveTo(px, ly);
        while (px < x + w - 8) {
          const run = 14 + rnd() * 22;
          px = Math.min(x + w - 4, px + run);
          ctx.lineTo(px, ly);
          if (px < x + w - 12 && rnd() < 0.5) {
            const jog = (rnd() < 0.5 ? -1 : 1) * h * 0.22;
            ctx.lineTo(px + 5, ly + jog);
            ctx.lineTo(px + 10, ly + jog);
            px += 10;
          }
        }
        ctx.stroke();
      }
      // Pads and vias.
      for (let dx = x + 10; dx < x + w - 6; dx += 22) {
        const cy = y + h * (0.3 + ((dx / 22) % 3) * 0.22);
        ctx.fillStyle = 'rgba(255, 226, 138, 0.85)';
        ctx.beginPath();
        ctx.arc(dx, cy, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(6, 16, 26, 0.9)';
        ctx.beginPath();
        ctx.arc(dx, cy, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
      // Two LEDs actually alight, with a halo on the resist.
      for (const t of [0.22, 0.74]) {
        const lx = x + t * w;
        const ly = y + h * 0.52;
        const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, 12);
        g.addColorStop(0, 'rgba(120, 250, 255, 0.9)');
        g.addColorStop(1, 'rgba(120, 250, 255, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(lx - 12, ly - 12, 24, 24);
        ctx.fillStyle = 'rgba(238, 255, 255, 0.95)';
        ctx.beginPath();
        ctx.arc(lx, ly, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'fossil': {
      // Vertebrae standing in a recessed matrix, with teeth between them.
      ctx.fillStyle = 'rgba(48, 26, 10, 0.5)';
      ctx.fillRect(x, y, w, h);
      const pitch = 30;
      for (let dx = x + 8; dx < x + w - 8; dx += pitch) {
        const cy = y + h * 0.52;
        const r = Math.min(h * 0.32, 7);
        // Centrum: a lit bone disc with a dark neural canal.
        const g = ctx.createRadialGradient(dx - r * 0.4, cy - r * 0.5, 0, dx, cy, r * 1.5);
        g.addColorStop(0, '#fff8e6');
        g.addColorStop(0.6, '#e0cda0');
        g.addColorStop(1, '#a08a5e');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(dx, cy, r * 1.2, r, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(56, 34, 14, 0.6)';
        ctx.beginPath();
        ctx.ellipse(dx, cy, r * 0.32, r * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        // Neural spine standing up out of the vertebra.
        ctx.fillStyle = '#efe0bb';
        ctx.beginPath();
        ctx.moveTo(dx - 2.4, cy - r * 0.7);
        ctx.lineTo(dx + 2.4, cy - r * 0.7);
        ctx.lineTo(dx + 1, y + 1.5);
        ctx.lineTo(dx - 1, y + 1.5);
        ctx.closePath();
        ctx.fill();
        // A tooth lying in the matrix between vertebrae.
        const tx = dx + pitch / 2;
        if (tx < x + w - 6) {
          ctx.fillStyle = '#f4e8c8';
          ctx.beginPath();
          ctx.moveTo(tx - 3, cy + r * 0.9);
          ctx.quadraticCurveTo(tx, cy - r * 0.6, tx + 3, cy + r * 0.9);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = 'rgba(90, 60, 24, 0.5)';
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }
      }
      ctx.fillStyle = 'rgba(255, 186, 74, 0.35)';
      ctx.fillRect(x, y, w, 1.6);
      break;
    }
    case 'candy-stripe': {
      // A barber pole running the frieze, piped along both edges.
      ctx.fillStyle = 'rgba(255, 250, 252, 0.85)';
      ctx.fillRect(x, y, w, h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      const pitch = 18;
      for (let dx = x - h; dx < x + w + h; dx += pitch) {
        ctx.fillStyle = ((dx / pitch) | 0) % 2 === 0 ? 'rgba(255, 95, 158, 0.9)' : 'rgba(104, 232, 196, 0.85)';
        ctx.beginPath();
        ctx.moveTo(dx, y + h);
        ctx.lineTo(dx + h, y);
        ctx.lineTo(dx + h + pitch * 0.46, y);
        ctx.lineTo(dx + pitch * 0.46, y + h);
        ctx.closePath();
        ctx.fill();
      }
      // Gloss band across the top third: sugar shell.
      const gl = ctx.createLinearGradient(0, y, 0, y + h);
      gl.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
      gl.addColorStop(0.4, 'rgba(255, 255, 255, 0)');
      gl.addColorStop(1, 'rgba(180, 60, 120, 0.22)');
      ctx.fillStyle = gl;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
      // Piped icing edges.
      for (const py of [y + 1.6, y + h - 1.6]) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 2.4;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(x, py);
        ctx.lineTo(x + w, py);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      break;
    }
    case 'coral': {
      // Branching coral growing up out of the moulding, polyps along it.
      ctx.fillStyle = 'rgba(10, 70, 96, 0.34)';
      ctx.fillRect(x, y, w, h);
      const pitch = 34;
      for (let dx = x + 10; dx < x + w - 6; dx += pitch) {
        const baseY = y + h - 1;
        const branch = (bx: number, by: number, ang: number, len: number, depth: number): void => {
          if (depth === 0 || len < 3) return;
          const ex = bx + Math.cos(ang) * len;
          const ey = by + Math.sin(ang) * len;
          ctx.strokeStyle = depth > 1 ? 'rgba(255, 138, 118, 0.9)' : 'rgba(255, 190, 170, 0.9)';
          ctx.lineWidth = depth * 1.3;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.quadraticCurveTo((bx + ex) / 2 + 2, (by + ey) / 2, ex, ey);
          ctx.stroke();
          // Polyp dots along the limb.
          ctx.fillStyle = 'rgba(255, 240, 214, 0.7)';
          ctx.beginPath();
          ctx.arc(ex, ey, 1.2, 0, Math.PI * 2);
          ctx.fill();
          branch(ex, ey, ang - 0.5 - rnd() * 0.2, len * 0.62, depth - 1);
          branch(ex, ey, ang + 0.5 + rnd() * 0.2, len * 0.62, depth - 1);
        };
        branch(dx, baseY, -Math.PI / 2, h * 0.44, 3);
      }
      // A pale sand line along the bottom of the band.
      ctx.fillStyle = 'rgba(255, 236, 208, 0.45)';
      ctx.fillRect(x, y + h - 2, w, 2);
      break;
    }
    case 'starfield': {
      // Punched stars joined by a neon rule — a constellation cut into the
      // cornice rather than printed on it.
      ctx.fillStyle = 'rgba(12, 8, 40, 0.75)';
      ctx.fillRect(x, y, w, h);
      const pitch = 24;
      const pts: Array<[number, number]> = [];
      for (let dx = x + 8; dx < x + w - 6; dx += pitch) {
        const cy = y + h * (0.34 + ((dx / pitch) % 3) * 0.18);
        pts.push([dx, cy]);
      }
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.stroke();
      for (const [px, py] of pts) {
        const g = ctx.createRadialGradient(px, py, 0, px, py, 8);
        g.addColorStop(0, 'rgba(150, 240, 255, 0.75)');
        g.addColorStop(1, 'rgba(150, 240, 255, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(px - 8, py - 8, 16, 16);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
          const rr = i % 2 === 0 ? 4.2 : 1.4;
          const sx = px + Math.cos(a) * rr;
          const sy = py + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'plain':
    default: {
      // No carving; a single incised line is the whole ornament.
      ctx.strokeStyle = 'rgba(40, 32, 22, 0.28)';
      ctx.lineWidth = 1;
      pencil(ctx, `M ${x + 2} ${y + h / 2} L ${x + w - 2} ${y + h / 2}`, seed, 0.5);
      break;
    }
  }
  ctx.restore();
}

/** The small carved motif at the centre of the crown face. */
function renderCentrepiece(
  ctx: Ctx2D,
  kind: CrownSpec['centrepiece'],
  cx: number,
  cy: number,
  s: number,
  ink: string,
  accent: string,
  seed: number,
): void {
  if (kind === 'none') return;
  const rnd = mulberry32(seed >>> 0);
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (kind) {
    case 'diamond': {
      // Two swashes flanking a lozenge â€” the athenaeum's quiet flourish.
      for (const dir of [-1, 1]) {
        pencil(
          ctx,
          `M ${cx + dir * s * 0.5} ${cy} C ${cx + dir * s * 1.2} ${cy - s * 0.5}, ${cx + dir * s * 2.0} ${cy + s * 0.5}, ${cx + dir * s * 2.6} ${cy}`,
          seed + (dir > 0 ? 1 : 2),
          0.6,
        );
      }
      ctx.beginPath();
      ctx.moveTo(cx, cy - s * 0.55);
      ctx.lineTo(cx + s * 0.4, cy);
      ctx.lineTo(cx, cy + s * 0.55);
      ctx.lineTo(cx - s * 0.4, cy);
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.fill();
      break;
    }
    case 'star': {
      ctx.strokeStyle = accent;
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 === 0 ? s : s * 0.38;
        const px = cx + Math.cos(a) * rr;
        const py = cy + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = 'rgba(214, 226, 248, 0.2)';
      ctx.fill();
      // Radiating rays.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * s * 1.2, cy + Math.sin(a) * s * 1.2);
        ctx.lineTo(cx + Math.cos(a) * s * 1.7, cy + Math.sin(a) * s * 1.7);
        ctx.stroke();
      }
      break;
    }
    case 'rosette': {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * s * 0.6, cy + Math.sin(a) * s * 0.6, s * 0.42, s * 0.26, a, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.26, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'crane': {
      // A single folded-line crane: the only ornament the pavilion allows.
      ctx.beginPath();
      ctx.moveTo(cx - s * 1.6, cy + s * 0.4);
      ctx.lineTo(cx - s * 0.2, cy - s * 0.7);
      ctx.lineTo(cx + s * 1.0, cy + s * 0.2);
      ctx.lineTo(cx + s * 1.9, cy - s * 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.2, cy - s * 0.7);
      ctx.lineTo(cx + s * 0.1, cy + s * 0.6);
      ctx.lineTo(cx + s * 1.0, cy + s * 0.2);
      ctx.stroke();
      break;
    }
    case 'mortar': {
      // Mortar and pestle, engraved on the pediment keystone.
      ctx.strokeStyle = accent;
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.7, cy - s * 0.3);
      ctx.lineTo(cx - s * 0.45, cy + s * 0.7);
      ctx.lineTo(cx + s * 0.45, cy + s * 0.7);
      ctx.lineTo(cx + s * 0.7, cy - s * 0.3);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - s * 0.9, cy - s * 0.3);
      ctx.lineTo(cx + s * 0.9, cy - s * 0.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + s * 0.2, cy - s * 0.4);
      ctx.lineTo(cx + s * 0.9, cy - s * 1.2);
      ctx.stroke();
      break;
    }
    case 'blossom': {
      // A full cherry blossom with two leaves, carved proud of the arch.
      for (const side of [-1, 1]) {
        ctx.fillStyle = 'rgba(74, 168, 82, 0.95)';
        ctx.save();
        ctx.translate(cx + side * s * 1.5, cy + s * 0.3);
        ctx.rotate(side * 0.8);
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 0.85, s * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2 - Math.PI / 2;
        ctx.fillStyle = p % 2 === 0 ? 'rgba(255, 150, 190, 0.98)' : 'rgba(255, 178, 208, 0.98)';
        ctx.beginPath();
        ctx.ellipse(cx + Math.cos(a) * s * 0.62, cy + Math.sin(a) * s * 0.62, s * 0.55, s * 0.4, a, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(198, 92, 132, 0.55)';
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255, 214, 74, 0.98)';
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.3, 0, Math.PI * 2);
      ctx.fill();
      // Stamens.
      ctx.strokeStyle = 'rgba(214, 132, 60, 0.8)';
      ctx.lineWidth = 0.8;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * s * 0.55, cy + Math.sin(a) * s * 0.55);
        ctx.stroke();
      }
      break;
    }
    case 'gear': {
      // A toothed gear with a lit hub — the workshop's maker's mark.
      const teeth = 10;
      ctx.fillStyle = 'rgba(226, 236, 246, 0.95)';
      ctx.beginPath();
      for (let i = 0; i < teeth * 2; i++) {
        const a = (i / (teeth * 2)) * Math.PI * 2;
        const rr = i % 2 === 0 ? s * 1.15 : s * 0.82;
        const px = cx + Math.cos(a) * rr;
        const py = cy + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(24, 36, 48, 0.8)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = 'rgba(60, 232, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(20, 30, 42, 0.9)';
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.16, 0, Math.PI * 2);
      ctx.fill();
      // Bolt holes in the web.
      ctx.fillStyle = 'rgba(24, 36, 48, 0.55)';
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * s * 0.62, cy + Math.sin(a) * s * 0.62, s * 0.13, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'skull': {
      // A little theropod skull in profile: long jaw, eye socket, teeth.
      ctx.fillStyle = 'rgba(250, 240, 214, 0.97)';
      ctx.beginPath();
      ctx.moveTo(cx - s * 1.7, cy + s * 0.32);
      ctx.quadraticCurveTo(cx - s * 1.9, cy - s * 0.5, cx - s * 0.6, cy - s * 0.72);
      ctx.quadraticCurveTo(cx + s * 0.9, cy - s * 0.85, cx + s * 1.85, cy - s * 0.1);
      ctx.quadraticCurveTo(cx + s * 1.5, cy + s * 0.42, cx + s * 0.2, cy + s * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(120, 88, 40, 0.75)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Eye socket + nostril.
      ctx.fillStyle = 'rgba(60, 36, 12, 0.8)';
      ctx.beginPath();
      ctx.ellipse(cx - s * 0.75, cy - s * 0.22, s * 0.3, s * 0.24, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + s * 1.15, cy - s * 0.28, s * 0.16, s * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      // Jaw with teeth.
      ctx.fillStyle = 'rgba(250, 240, 214, 0.97)';
      ctx.beginPath();
      ctx.moveTo(cx - s * 1.5, cy + s * 0.5);
      ctx.quadraticCurveTo(cx + s * 0.4, cy + s * 0.95, cx + s * 1.7, cy + s * 0.2);
      ctx.lineTo(cx + s * 1.6, cy + s * 0.55);
      ctx.quadraticCurveTo(cx + s * 0.3, cy + s * 1.25, cx - s * 1.5, cy + s * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 250, 236, 0.98)';
      for (let i = 0; i < 6; i++) {
        const t = i / 6;
        const tx = cx - s * 1.1 + t * s * 2.5;
        const ty = cy + s * (0.5 - t * 0.5);
        ctx.beginPath();
        ctx.moveTo(tx - 1.2, ty);
        ctx.lineTo(tx + 1.2, ty);
        ctx.lineTo(tx, ty + s * 0.32);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'lollipop': {
      // A swirl pop crossed with a striped stick.
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = s * 0.34;
      ctx.beginPath();
      ctx.moveTo(cx, cy + s * 0.6);
      ctx.lineTo(cx, cy + s * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 244, 250, 0.98)';
      ctx.beginPath();
      ctx.arc(cx, cy, s * 1.05, 0, Math.PI * 2);
      ctx.fill();
      // The spiral: two colours chasing each other.
      for (const [colour, phase] of [
        ['rgba(255, 95, 158, 0.95)', 0],
        ['rgba(104, 232, 196, 0.95)', Math.PI],
      ] as const) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = s * 0.3;
        ctx.beginPath();
        for (let i = 0; i <= 40; i++) {
          const t = i / 40;
          const a = phase + t * Math.PI * 3.6;
          const rr = t * s * 0.9;
          const px = cx + Math.cos(a) * rr;
          const py = cy + Math.sin(a) * rr;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(190, 80, 130, 0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, s * 1.05, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.beginPath();
      ctx.ellipse(cx - s * 0.4, cy - s * 0.5, s * 0.26, s * 0.14, -0.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'shell': {
      // A fluted scallop with a pearl sitting in the hinge.
      const g = ctx.createLinearGradient(cx, cy - s, cx, cy + s);
      g.addColorStop(0, 'rgba(255, 244, 232, 0.98)');
      g.addColorStop(1, 'rgba(255, 176, 148, 0.95)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx, cy + s * 0.9);
      for (let i = 0; i <= 7; i++) {
        const t = i / 7;
        const a = Math.PI + t * Math.PI;
        ctx.quadraticCurveTo(
          cx + Math.cos(a + 0.1) * s * 1.6,
          cy + Math.sin(a) * s * 1.5,
          cx + Math.cos(a) * s * 1.45,
          cy + Math.sin(a) * s * 1.2,
        );
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(190, 106, 84, 0.7)';
      ctx.lineWidth = 1;
      ctx.stroke();
      for (let i = 0; i <= 6; i++) {
        const a = Math.PI + (i / 6) * Math.PI;
        ctx.beginPath();
        ctx.moveTo(cx, cy + s * 0.85);
        ctx.lineTo(cx + Math.cos(a) * s * 1.3, cy + Math.sin(a) * s * 1.05);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(cx, cy + s * 0.75, s * 0.28, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'planet': {
      // A ringed planet with a small moon, glowing on the crest.
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * 2.6);
      halo.addColorStop(0, 'rgba(140, 230, 255, 0.4)');
      halo.addColorStop(1, 'rgba(140, 230, 255, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(cx - s * 2.6, cy - s * 2.6, s * 5.2, s * 5.2);
      const body = ctx.createRadialGradient(cx - s * 0.35, cy - s * 0.4, s * 0.1, cx, cy, s);
      body.addColorStop(0, '#ffd9a0');
      body.addColorStop(0.5, '#ff8f4a');
      body.addColorStop(1, '#a83f8a');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(cx, cy, s, 0, Math.PI * 2);
      ctx.fill();
      // Cloud bands.
      ctx.strokeStyle = 'rgba(255, 232, 190, 0.5)';
      ctx.lineWidth = 1.2;
      for (const off of [-0.4, 0, 0.42]) {
        ctx.beginPath();
        ctx.ellipse(cx, cy + off * s, s * 0.94, s * 0.2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Ring: behind and in front, so it reads as a ring not a hoop.
      ctx.strokeStyle = 'rgba(160, 244, 255, 0.9)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, s * 1.9, s * 0.6, -0.35, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 120, 214, 0.9)';
      ctx.beginPath();
      ctx.ellipse(cx, cy, s * 1.9, s * 0.6, -0.35, 0, Math.PI);
      ctx.stroke();
      ctx.fillStyle = 'rgba(226, 244, 255, 0.95)';
      ctx.beginPath();
      ctx.arc(cx + s * 2.2, cy - s * 1.2, s * 0.26, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
  void rnd;
  ctx.restore();
}

/* ================================ crown ================================== */

/**
 * Render the crown/cornice into a `w Ã— h` box at the current origin.
 * The profile decides the silhouette and the tonal steps; the carving
 * vocabulary runs along the frieze band; the centrepiece sits on the face.
 */
export function renderCrown(
  ctx: Ctx2D,
  theme: LibraryTheme,
  w: number,
  h: number,
  seed: number,
): void {
  const { crown, wood, joinery } = theme;
  const rnd = mulberry32(seed >>> 0);
  ctx.save();

  // --- silhouette ---------------------------------------------------------
  // Everything is clipped to the profile so the gable/pediment shapes read.
  ctx.save();
  ctx.beginPath();
  if (crown.profile === 'gable') {
    ctx.moveTo(0, h);
    ctx.lineTo(0, h * 0.42);
    ctx.lineTo(w / 2, 2);
    ctx.lineTo(w, h * 0.42);
    ctx.lineTo(w, h);
    ctx.closePath();
  } else if (crown.profile === 'pediment') {
    ctx.moveTo(0, h);
    ctx.lineTo(0, h * 0.46);
    ctx.lineTo(w * 0.24, h * 0.46);
    ctx.lineTo(w * 0.5, h * 0.06);
    ctx.lineTo(w * 0.76, h * 0.46);
    ctx.lineTo(w, h * 0.46);
    ctx.lineTo(w, h);
    ctx.closePath();
  } else if (crown.profile === 'arch') {
    // A soft arbour arch: the board rises to a broad round crown.
    ctx.moveTo(0, h);
    ctx.lineTo(0, h * 0.58);
    ctx.quadraticCurveTo(w * 0.5, -h * 0.28, w, h * 0.58);
    ctx.lineTo(w, h);
    ctx.closePath();
  } else if (crown.profile === 'gantry') {
    // Industrial gantry: a deep beam on two end plates, lamp bar under it.
    ctx.moveTo(0, h);
    ctx.lineTo(0, h * 0.1);
    ctx.lineTo(w, h * 0.1);
    ctx.lineTo(w, h);
    ctx.closePath();
  } else if (crown.profile === 'crest') {
    // A scalloped/finned crest: a run of arcs with a taller centre fin.
    ctx.moveTo(0, h);
    ctx.lineTo(0, h * 0.62);
    const lobes = Math.max(4, Math.round(w / 74));
    const lw = w / lobes;
    for (let i = 0; i < lobes; i++) {
      const x0 = i * lw;
      const mid = Math.abs(i - (lobes - 1) / 2) < 0.6;
      ctx.quadraticCurveTo(x0 + lw * 0.5, mid ? -h * 0.16 : h * 0.1, x0 + lw, h * 0.62);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
  } else {
    ctx.rect(0, 0, w, h);
  }
  ctx.clip();

  // The crown is one short board seen whole — the figure pass cannot repeat
  // across it, and it is the piece the eye lands on first.
  paintWood(ctx, wood, w, h, {
    seed: seed ^ 0xc0a1,
    direction: 'horizontal',
    contrast: 0.95,
    figure: 0.62,
  });

  // --- profile shading ----------------------------------------------------
  const lipH = Math.max(7, h * 0.2);
  switch (crown.profile) {
    case 'stepped': {
      // Three stacked members: oversailing fillet, frieze, bottom lip.
      const fillet = h * 0.22;
      ctx.fillStyle = 'rgba(255, 250, 236, 0.2)';
      ctx.fillRect(0, 0, w, fillet);
      ctx.fillStyle = 'rgba(30, 22, 14, 0.26)';
      ctx.fillRect(0, fillet - 1.5, w, 2.5);
      ctx.fillStyle = 'rgba(46, 34, 22, 0.28)';
      ctx.fillRect(0, h - lipH, w, lipH);
      ctx.fillStyle = 'rgba(255, 246, 224, 0.16)';
      ctx.fillRect(0, h - lipH, w, 1.4);
      break;
    }
    case 'ogee': {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(255, 252, 242, 0.34)');
      g.addColorStop(0.3, 'rgba(60, 66, 52, 0.24)');
      g.addColorStop(0.55, 'rgba(255, 252, 242, 0.28)');
      g.addColorStop(0.85, 'rgba(48, 54, 42, 0.26)');
      g.addColorStop(1, 'rgba(255, 252, 242, 0.14)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case 'flat': {
      ctx.fillStyle = 'rgba(255, 250, 238, 0.2)';
      ctx.fillRect(0, 0, w, h * 0.16);
      const g = ctx.createLinearGradient(0, h - lipH, 0, h);
      g.addColorStop(0, 'rgba(60, 44, 28, 0)');
      g.addColorStop(1, 'rgba(60, 44, 28, 0.3)');
      ctx.fillStyle = g;
      ctx.fillRect(0, h - lipH, w, lipH);
      break;
    }
    case 'beam': {
      // One heavy adzed timber: deep top light, big shadow under, chamfers.
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(255, 244, 216, 0.22)');
      g.addColorStop(0.35, 'rgba(0, 0, 0, 0)');
      g.addColorStop(1, 'rgba(12, 9, 6, 0.5)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // Adze facets across the beam.
      ctx.strokeStyle = 'rgba(20, 15, 10, 0.24)';
      ctx.lineWidth = 1.2;
      for (let x = 8; x < w; x += 34 + rnd() * 18) {
        ctx.beginPath();
        ctx.moveTo(x, 3);
        ctx.quadraticCurveTo(x + 6, h / 2, x - 2, h - 3);
        ctx.stroke();
      }
      break;
    }
    case 'gable': {
      // Mismatched boards climbing the pitch, one proud of the others.
      const boards = 5;
      for (let i = 0; i < boards; i++) {
        const y0 = (i * h) / boards;
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 252, 244, 0.1)' : 'rgba(40, 36, 30, 0.12)';
        ctx.fillRect(0, y0, w, h / boards);
        ctx.strokeStyle = 'rgba(38, 34, 28, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y0);
        ctx.lineTo(w, y0 + (rnd() * 2 - 1));
        ctx.stroke();
      }
      // Ridge line down the pitch.
      ctx.strokeStyle = 'rgba(30, 26, 20, 0.4)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, h * 0.42);
      ctx.lineTo(w / 2, 2);
      ctx.lineTo(w, h * 0.42);
      ctx.stroke();
      break;
    }
    case 'pediment': {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(255, 240, 208, 0.24)');
      g.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
      g.addColorStop(1, 'rgba(30, 14, 6, 0.4)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // Tympanum shadow inside the triangle.
      ctx.fillStyle = 'rgba(40, 18, 8, 0.16)';
      ctx.beginPath();
      ctx.moveTo(w * 0.26, h * 0.44);
      ctx.lineTo(w * 0.5, h * 0.1);
      ctx.lineTo(w * 0.74, h * 0.44);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'arch': {
      // Light pours over the top of the arch and dies in the soffit.
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(255, 252, 236, 0.5)');
      g.addColorStop(0.45, 'rgba(255, 248, 226, 0.12)');
      g.addColorStop(1, 'rgba(60, 44, 24, 0.32)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // Voussoir lines radiating from the arch centre.
      ctx.strokeStyle = 'rgba(90, 70, 44, 0.22)';
      ctx.lineWidth = 1.1;
      for (let i = 1; i < 9; i++) {
        const t = i / 9;
        const a = Math.PI + t * Math.PI;
        ctx.beginPath();
        ctx.moveTo(w / 2 + Math.cos(a) * w * 0.2, h * 0.62 + Math.sin(a) * h * 0.2);
        ctx.lineTo(w / 2 + Math.cos(a) * w * 0.52, h * 0.62 + Math.sin(a) * h * 0.9);
        ctx.stroke();
      }
      // The arch's own soffit shadow along the underside.
      ctx.fillStyle = 'rgba(48, 34, 18, 0.28)';
      ctx.fillRect(0, h - Math.max(6, h * 0.14), w, Math.max(6, h * 0.14));
      break;
    }
    case 'gantry': {
      // A rolled steel beam: bright top flange, dark web, lit bottom flange.
      const flange = Math.max(6, h * 0.16);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.32)';
      ctx.fillRect(0, h * 0.1, w, flange);
      const web = ctx.createLinearGradient(0, h * 0.1 + flange, 0, h - flange);
      web.addColorStop(0, 'rgba(10, 20, 30, 0.4)');
      web.addColorStop(0.5, 'rgba(10, 20, 30, 0.16)');
      web.addColorStop(1, 'rgba(10, 20, 30, 0.44)');
      ctx.fillStyle = web;
      ctx.fillRect(0, h * 0.1 + flange, w, h - flange - h * 0.1);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.fillRect(0, h - flange, w, 2);
      // End plates with a bolt circle.
      for (const px of [10, w - 10]) {
        ctx.fillStyle = 'rgba(226, 236, 246, 0.4)';
        roundRect(ctx, px - 9, h * 0.1 + 2, 18, h - h * 0.1 - 6, 3);
        ctx.fill();
        ctx.strokeStyle = 'rgba(16, 26, 38, 0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + 0.6;
          ctx.fillStyle = 'rgba(20, 32, 44, 0.7)';
          ctx.beginPath();
          ctx.arc(px + Math.cos(a) * 5, h * 0.5 + Math.sin(a) * (h * 0.22), 1.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // The lamp bar slung under the beam.
      const lampY = h - 3;
      const lg = ctx.createLinearGradient(0, lampY - 8, 0, lampY + 4);
      lg.addColorStop(0, 'rgba(60, 232, 255, 0)');
      lg.addColorStop(1, 'rgba(60, 232, 255, 0.34)');
      ctx.fillStyle = lg;
      ctx.fillRect(0, lampY - 8, w, 12);
      for (let lx = 22; lx < w - 12; lx += 46) {
        const glow = ctx.createRadialGradient(lx, lampY, 0, lx, lampY, 15);
        glow.addColorStop(0, 'rgba(180, 250, 255, 0.85)');
        glow.addColorStop(1, 'rgba(120, 240, 255, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(lx - 15, lampY - 15, 30, 30);
        ctx.fillStyle = 'rgba(240, 255, 255, 0.95)';
        ctx.fillRect(lx - 7, lampY - 2.4, 14, 3.2);
      }
      break;
    }
    case 'crest': {
      // Each lobe is a moulded shell: light on the crown, shade in the valley.
      const lobes = Math.max(4, Math.round(w / 74));
      const lw = w / lobes;
      for (let i = 0; i < lobes; i++) {
        const x0 = i * lw;
        const g = ctx.createRadialGradient(x0 + lw * 0.42, h * 0.34, 2, x0 + lw * 0.5, h * 0.5, lw * 0.8);
        g.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
        g.addColorStop(0.6, 'rgba(255, 255, 255, 0.06)');
        g.addColorStop(1, 'rgba(90, 40, 70, 0.26)');
        ctx.fillStyle = g;
        ctx.fillRect(x0, 0, lw, h);
        // Valley shadow between lobes.
        const v = ctx.createLinearGradient(x0 - 6, 0, x0 + 6, 0);
        v.addColorStop(0, 'rgba(70, 30, 55, 0)');
        v.addColorStop(0.5, 'rgba(70, 30, 55, 0.24)');
        v.addColorStop(1, 'rgba(70, 30, 55, 0)');
        ctx.fillStyle = v;
        ctx.fillRect(x0 - 6, 0, 12, h);
      }
      // A bright rim riding the whole scalloped edge.
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, h * 0.62);
      for (let i = 0; i < lobes; i++) {
        const x0 = i * lw;
        const mid = Math.abs(i - (lobes - 1) / 2) < 0.6;
        ctx.quadraticCurveTo(x0 + lw * 0.5, mid ? -h * 0.16 : h * 0.1, x0 + lw, h * 0.62);
      }
      ctx.stroke();
      break;
    }
  }
  ctx.restore(); // end silhouette clip

  // --- carving frieze -----------------------------------------------------
  const friezeH = Math.max(9, Math.min(15, h * 0.3));
  const friezeY =
    crown.profile === 'beam' || crown.profile === 'gable'
      ? h - friezeH - 4
      : crown.profile === 'gantry'
        ? h - friezeH - 13
        : h - lipH - friezeH - 2;
  if (crown.carving !== 'plain' || crown.profile === 'beam') {
    renderCarving(
      ctx,
      crown.carving,
      6,
      Math.max(2, friezeY),
      w - 12,
      friezeH,
      seed ^ 0x5ca1,
      crown.bead?.colour ?? 'rgba(255, 255, 255, 0.3)',
    );
  }

  // --- bead / inlay line --------------------------------------------------
  if (crown.bead) {
    ctx.strokeStyle = crown.bead.colour;
    ctx.lineWidth = crown.bead.width;
    ctx.beginPath();
    ctx.moveTo(8, Math.max(3, friezeY - 4));
    ctx.lineTo(w - 8, Math.max(3, friezeY - 4));
    ctx.stroke();
  }

  // --- centrepiece --------------------------------------------------------
  const cy =
    crown.profile === 'pediment'
      ? h * 0.3
      : crown.profile === 'arch'
        ? h * 0.34
        : crown.profile === 'crest'
          ? h * 0.36
          : Math.max(10, friezeY - 12);
  // Ink the motif from the timber's own dark end rather than the rail's
  // hairline ink — on pale rooms (hinoki, barn wood) the rail ink vanishes
  // and the crown ends up a blank board.
  renderCentrepiece(
    ctx,
    crown.centrepiece,
    w / 2,
    cy,
    10,
    hexAlpha(wood.dark, 0.62),
    crown.bead?.colour ?? theme.rail.inlayColour,
    seed ^ 0x0e11,
  );

  // --- joinery along the crown -------------------------------------------
  if (joinery.kind === 'iron-strap') {
    for (const t of [0.16, 0.5, 0.84]) {
      renderJoinery(ctx, joinery, t * w - 9, 2, 18, h - 4, seed ^ Math.round(t * 1000), 'vertical');
    }
  } else if (joinery.kind === 'nail-head' || joinery.kind === 'peg') {
    const count = Math.max(2, Math.round((w / 150) * joinery.density * 2));
    for (let i = 0; i < count; i++) {
      const x = ((i + 0.5) / count) * w;
      renderJoinery(ctx, joinery, x - 10, h - lipH - 2, 20, lipH, seed ^ (i * 977), 'horizontal');
    }
  } else if (joinery.kind === 'brass-bracket') {
    for (const x of [18, w - 18]) {
      renderJoinery(ctx, joinery, x - 12, h - lipH, 24, lipH, seed ^ Math.round(x), 'horizontal');
    }
  } else if (joinery.kind === 'mitre') {
    // The mitre return at each end: the whole ornament of a well-made cornice.
    // A hairline shadow along the 45 with a whisper of light on the proud side.
    for (const [ex, dir] of [
      [3, 1],
      [w - 3, -1],
    ] as const) {
      ctx.strokeStyle = 'rgba(46, 36, 24, 0.42)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(ex, 1);
      ctx.lineTo(ex + dir * (h - 2), h - 1);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 252, 244, 0.42)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(ex + dir * 1.4, 1);
      ctx.lineTo(ex + dir * (h - 0.6), h - 1);
      ctx.stroke();
    }
    // A wedged through-tenon proud of the face, twice: quiet, deliberate.
    for (const t of [0.3, 0.7]) {
      const tx = t * w;
      const ty = h - lipH * 0.5;
      ctx.fillStyle = 'rgba(28, 20, 12, 0.28)';
      ctx.fillRect(tx - 7, ty - 4.5, 15, 10);
      ctx.fillStyle = mixHex(joinery.metal, '#ffffff', 0.18);
      ctx.fillRect(tx - 8, ty - 5, 15, 10);
      ctx.strokeStyle = 'rgba(56, 44, 28, 0.5)';
      ctx.lineWidth = 0.9;
      ctx.strokeRect(tx - 8, ty - 5, 15, 10);
      // The wedge itself, driven across the tenon.
      ctx.fillStyle = 'rgba(70, 52, 32, 0.55)';
      ctx.beginPath();
      ctx.moveTo(tx - 2, ty - 5);
      ctx.lineTo(tx + 1, ty - 5);
      ctx.lineTo(tx + 2.4, ty + 5);
      ctx.lineTo(tx - 3.4, ty + 5);
      ctx.closePath();
      ctx.fill();
    }
  }

  // --- pencil outline -----------------------------------------------------
  ctx.strokeStyle = theme.rail.ink;
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  if (crown.profile === 'gable') {
    pencil(ctx, `M 1 ${h - 1} L 1 ${h * 0.42} L ${w / 2} 2 L ${w - 1} ${h * 0.42} L ${w - 1} ${h - 1}`, seed);
  } else if (crown.profile === 'arch') {
    pencil(
      ctx,
      `M 1 ${h - 1} L 1 ${h * 0.58} Q ${w / 2} ${-h * 0.28} ${w - 1} ${h * 0.58} L ${w - 1} ${h - 1}`,
      seed,
    );
  } else if (crown.profile === 'crest') {
    const lobes = Math.max(4, Math.round(w / 74));
    const lw = w / lobes;
    let d = `M 1 ${h - 1} L 1 ${h * 0.62}`;
    for (let i = 0; i < lobes; i++) {
      const x0 = i * lw;
      const mid = Math.abs(i - (lobes - 1) / 2) < 0.6;
      d += ` Q ${x0 + lw * 0.5} ${mid ? -h * 0.16 : h * 0.1} ${x0 + lw} ${h * 0.62}`;
    }
    pencil(ctx, `${d} L ${w - 1} ${h - 1}`, seed, 0.5);
  } else if (crown.profile === 'gantry') {
    pencil(ctx, `M 1 ${h * 0.1 + 0.6} L ${w - 1} ${h * 0.1 + 0.6}`, seed, 0.5);
    pencil(ctx, `M 1 ${h - 1.4} L ${w - 1} ${h - 1.4}`, seed + 3, 0.5);
  } else if (crown.profile === 'pediment') {
    pencil(
      ctx,
      `M 1 ${h - 1} L 1 ${h * 0.46} L ${w * 0.24} ${h * 0.46} L ${w * 0.5} ${h * 0.06} L ${w * 0.76} ${h * 0.46} L ${w - 1} ${h * 0.46} L ${w - 1} ${h - 1}`,
      seed,
    );
  } else {
    pencil(ctx, `M 1 1.4 L ${w - 1} 1.4`, seed);
    pencil(ctx, `M 1 ${h - 1.4} L ${w - 1} ${h - 1.4}`, seed + 3);
  }
  ctx.restore();
}

/* ================================= rail ================================== */

/** Render one side-rail segment (one floor tall) into `w Ã— h`. */
export function renderRail(
  ctx: Ctx2D,
  theme: LibraryTheme,
  w: number,
  h: number,
  seed: number,
): void {
  const { rail, wood, joinery } = theme;
  ctx.save();
  // A side rail is ~34 px wide: one repeat is wider than the part, so the
  // figure reads as this stile’s own grain and cannot be counted.
  paintWood(ctx, wood, w, h, {
    seed: seed ^ 0x9a11,
    direction: 'vertical',
    contrast: 0.9,
    figure: 0.78,
  });

  // --- edge treatment: how light wraps the stock --------------------------
  const g = ctx.createLinearGradient(0, 0, w, 0);
  switch (rail.edge) {
    case 'rounded':
      g.addColorStop(0, 'rgba(50, 38, 26, 0.34)');
      g.addColorStop(0.16, 'rgba(255, 250, 236, 0.3)');
      g.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
      g.addColorStop(0.86, 'rgba(46, 34, 22, 0.2)');
      g.addColorStop(1, 'rgba(40, 30, 20, 0.42)');
      break;
    case 'chamfer':
      // Two flat chamfers: crisp tonal steps, no rolloff.
      ctx.fillStyle = 'rgba(255, 252, 244, 0.26)';
      ctx.fillRect(0, 0, w * 0.14, h);
      ctx.fillStyle = 'rgba(50, 42, 30, 0.22)';
      ctx.fillRect(w * 0.86, 0, w * 0.14, h);
      g.addColorStop(0, 'rgba(255, 255, 255, 0)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      break;
    case 'rough':
      g.addColorStop(0, 'rgba(30, 24, 16, 0.42)');
      g.addColorStop(0.35, 'rgba(255, 250, 238, 0.14)');
      g.addColorStop(1, 'rgba(24, 18, 12, 0.44)');
      break;
    default:
      g.addColorStop(0, 'rgba(44, 34, 22, 0.3)');
      g.addColorStop(0.3, 'rgba(255, 250, 238, 0.22)');
      g.addColorStop(0.72, 'rgba(255, 255, 255, 0)');
      g.addColorStop(1, 'rgba(36, 28, 18, 0.36)');
      break;
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // --- inlay --------------------------------------------------------------
  // Dead straight, so the per-floor repeat is seamless.
  if (rail.inlay !== 'none') {
    const drawLine = (x: number, colour: string, width: number): void => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    };
    switch (rail.inlay) {
      case 'gold-pinstripe':
      case 'silver': {
        // A pair of stringing lines sunk into the stock: a dark scratch-stock
        // groove with the metal lying bright in the bottom of it.
        for (const x of [7, w - 7]) {
          drawLine(x - 1, 'rgba(18, 13, 7, 0.5)', 2.6);
          drawLine(x, rail.inlayColour, 1.6);
          drawLine(x, rail.inlay === 'silver' ? 'rgba(246, 250, 255, 0.7)' : 'rgba(255, 238, 176, 0.7)', 0.7);
          drawLine(x + 1.6, 'rgba(20, 16, 10, 0.34)', 1);
        }
        break;
      }
      case 'painted-line':
        drawLine(w / 2 + 1.6, 'rgba(30, 22, 14, 0.3)', 4.6);
        drawLine(w / 2, rail.inlayColour, 4);
        drawLine(w / 2 - 1.6, 'rgba(255, 255, 255, 0.3)', 1.2);
        break;
      case 'brass-bead': {
        // A half-round brass bead: bright core, dark seating lines.
        const bg = ctx.createLinearGradient(w / 2 - 4, 0, w / 2 + 4, 0);
        bg.addColorStop(0, 'rgba(60, 40, 12, 0.7)');
        bg.addColorStop(0.32, rail.inlayColour);
        bg.addColorStop(0.52, 'rgba(255, 242, 194, 0.9)');
        bg.addColorStop(0.72, rail.inlayColour);
        bg.addColorStop(1, 'rgba(52, 34, 8, 0.7)');
        ctx.fillStyle = bg;
        ctx.fillRect(w / 2 - 4, 0, 8, h);
        // Seating grooves either side of the bead.
        drawLine(w / 2 - 5, 'rgba(24, 15, 6, 0.45)', 1.4);
        drawLine(w / 2 + 5, 'rgba(24, 15, 6, 0.45)', 1.4);
        break;
      }
      case 'led-strip': {
        // An aluminium channel with a lit ribbon in the bottom of it: dark
        // extrusion, diffuser glow, hot core, then a spill on the timber.
        const cx = w / 2;
        const spill = ctx.createLinearGradient(cx - 13, 0, cx + 13, 0);
        spill.addColorStop(0, hexAlpha(parseHexToHex(rail.inlayColour), 0));
        spill.addColorStop(0.5, hexAlpha(parseHexToHex(rail.inlayColour), 0.42));
        spill.addColorStop(1, hexAlpha(parseHexToHex(rail.inlayColour), 0));
        ctx.fillStyle = spill;
        ctx.fillRect(cx - 13, 0, 26, h);
        ctx.fillStyle = 'rgba(16, 24, 34, 0.9)';
        ctx.fillRect(cx - 6, 0, 12, h);
        ctx.fillStyle = hexAlpha(parseHexToHex(rail.inlayColour), 0.9);
        ctx.fillRect(cx - 3.6, 0, 7.2, h);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fillRect(cx - 1.2, 0, 2.4, h);
        // Individual emitters visible through the diffuser.
        for (let y = 6; y < h; y += 26) {
          const g = ctx.createRadialGradient(cx, y, 0, cx, y, 9);
          g.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
          g.addColorStop(1, hexAlpha(parseHexToHex(rail.inlayColour), 0));
          ctx.fillStyle = g;
          ctx.fillRect(cx - 9, y - 9, 18, 18);
        }
        // Channel lips.
        drawLine(cx - 6.8, 'rgba(210, 226, 240, 0.55)', 1.4);
        drawLine(cx + 6.8, 'rgba(60, 78, 96, 0.6)', 1.4);
        break;
      }
      case 'vine': {
        // A living vine climbing the rail: a wandering stem with alternating
        // leaves and the odd tendril curl. Periodic in h so floors line up.
        const cx = w / 2;
        const amp = w * 0.2;
        const stem = (dx: number, colour: string, width: number): void => {
          ctx.strokeStyle = colour;
          ctx.lineWidth = width;
          ctx.lineCap = 'round';
          ctx.beginPath();
          for (let s = 0; s <= 40; s++) {
            const t = s / 40;
            const x = cx + dx + Math.sin(t * Math.PI * 4) * amp;
            const y = t * h;
            if (s === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        };
        stem(1.4, 'rgba(28, 62, 30, 0.35)', 3.4);
        stem(0, rail.inlayColour, 2.6);
        const leaves = 12;
        for (let i = 0; i < leaves; i++) {
          const t = (i + 0.5) / leaves;
          const x = cx + Math.sin(t * Math.PI * 4) * amp;
          const y = t * h;
          const side = i % 2 === 0 ? -1 : 1;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(side * 0.9 + Math.sin(t * 9) * 0.2);
          const lg = ctx.createLinearGradient(0, -4, 0, 4);
          lg.addColorStop(0, mixHex(rail.inlayColour, '#eaffd0', 0.5));
          lg.addColorStop(1, mixHex(rail.inlayColour, '#12441c', 0.35));
          ctx.fillStyle = lg;
          ctx.beginPath();
          ctx.ellipse(side * 6, 0, 7.5, 3.6, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(30, 66, 32, 0.5)';
          ctx.lineWidth = 0.7;
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(side * 0.5, 0);
          ctx.lineTo(side * 12, 0);
          ctx.stroke();
          ctx.restore();
          // A blossom every fourth leaf node.
          if (i % 4 === 1) {
            ctx.fillStyle = 'rgba(255, 156, 194, 0.95)';
            for (let p = 0; p < 5; p++) {
              const a = (p / 5) * Math.PI * 2;
              ctx.beginPath();
              ctx.ellipse(x - side * 5 + Math.cos(a) * 2.6, y + Math.sin(a) * 2.6, 2.6, 1.9, a, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.fillStyle = 'rgba(255, 222, 96, 0.95)';
            ctx.beginPath();
            ctx.arc(x - side * 5, y, 1.3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        break;
      }
      case 'candy-stripe': {
        // A candy cane running the rail: diagonal stripes inside a rounded
        // white band, with a gloss down one side.
        const bandW = Math.min(16, w * 0.5);
        const bx = w / 2 - bandW / 2;
        ctx.save();
        ctx.beginPath();
        roundRect(ctx, bx, 0, bandW, h, bandW / 2);
        ctx.clip();
        ctx.fillStyle = 'rgba(255, 250, 252, 0.95)';
        ctx.fillRect(bx, 0, bandW, h);
        const pitch = 16;
        for (let y = -bandW; y < h + bandW; y += pitch) {
          ctx.fillStyle = ((y / pitch) | 0) % 2 === 0 ? rail.inlayColour : 'rgba(104, 232, 196, 0.9)';
          ctx.beginPath();
          ctx.moveTo(bx, y);
          ctx.lineTo(bx + bandW, y - bandW);
          ctx.lineTo(bx + bandW, y - bandW + pitch * 0.5);
          ctx.lineTo(bx, y + pitch * 0.5);
          ctx.closePath();
          ctx.fill();
        }
        const gl = ctx.createLinearGradient(bx, 0, bx + bandW, 0);
        gl.addColorStop(0, 'rgba(255, 255, 255, 0.7)');
        gl.addColorStop(0.35, 'rgba(255, 255, 255, 0)');
        gl.addColorStop(1, 'rgba(150, 50, 100, 0.24)');
        ctx.fillStyle = gl;
        ctx.fillRect(bx, 0, bandW, h);
        ctx.restore();
        ctx.strokeStyle = 'rgba(180, 70, 124, 0.4)';
        ctx.lineWidth = 1;
        roundRect(ctx, bx, 0, bandW, h, bandW / 2);
        ctx.stroke();
        break;
      }
      case 'coral-line': {
        // A coral rib: a knuckled spine with polyp dots down both sides.
        const cx = w / 2;
        drawLine(cx + 1.4, 'rgba(12, 60, 76, 0.4)', 5);
        const g = ctx.createLinearGradient(cx - 3.5, 0, cx + 3.5, 0);
        g.addColorStop(0, mixHex(rail.inlayColour, '#ffffff', 0.55));
        g.addColorStop(0.5, rail.inlayColour);
        g.addColorStop(1, mixHex(rail.inlayColour, '#7a2b28', 0.45));
        ctx.fillStyle = g;
        ctx.fillRect(cx - 3.5, 0, 7, h);
        for (let y = 9; y < h; y += 34) {
          // Knuckle across the rib — widely spaced, so the rail reads as a
          // growing coral branch and never as a candy stripe.
          ctx.fillStyle = 'rgba(255, 236, 220, 0.45)';
          ctx.beginPath();
          ctx.ellipse(cx, y, 4.6, 2.2, 0, 0, Math.PI * 2);
          ctx.fill();
          // A short side branch off the rib, alternating sides, with polyps.
          const side = ((y / 34) | 0) % 2 === 0 ? -1 : 1;
          ctx.strokeStyle = mixHex(rail.inlayColour, '#ffd8c4', 0.35);
          ctx.lineWidth = 2.4;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(cx, y + 4);
          ctx.quadraticCurveTo(cx + side * 6, y + 10, cx + side * 8.5, y + 19);
          ctx.stroke();
          ctx.fillStyle = 'rgba(255, 226, 200, 0.8)';
          ctx.beginPath();
          ctx.arc(cx + side * 8.5, y + 20, 2.1, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'neon': {
        // A bent neon tube: wide saturated halo, glass wall, hot white core.
        const cx = w / 2;
        const halo = ctx.createLinearGradient(cx - 15, 0, cx + 15, 0);
        halo.addColorStop(0, hexAlpha(parseHexToHex(rail.inlayColour), 0));
        halo.addColorStop(0.5, hexAlpha(parseHexToHex(rail.inlayColour), 0.5));
        halo.addColorStop(1, hexAlpha(parseHexToHex(rail.inlayColour), 0));
        ctx.fillStyle = halo;
        ctx.fillRect(cx - 15, 0, 30, h);
        drawLine(cx, hexAlpha(parseHexToHex(rail.inlayColour), 0.95), 6);
        drawLine(cx, 'rgba(255, 235, 252, 0.95)', 2.2);
        // Glass ends: a darker collar every floor so it reads as tube, not paint.
        for (const y of [4, h - 4]) {
          ctx.fillStyle = 'rgba(30, 20, 48, 0.8)';
          ctx.fillRect(cx - 4.5, y - 2, 9, 4);
        }
        break;
      }
    }
  }

  // --- joinery where the shelf tenons into the rail -----------------------
  const jointY = h - 20;
  renderJoinery(ctx, joinery, 2, jointY - 10, w - 4, 20, seed ^ 0x5151, 'vertical');

  // --- pencil arrises -----------------------------------------------------
  ctx.strokeStyle = rail.ink;
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  for (const [ex, s] of [
    [1.4, seed ^ 0x11],
    [w - 1.4, seed ^ 0x22],
  ] as const) {
    // Small amplitude keeps the per-floor repeat from kinking at the seam.
    const [a, b] = doubleStroke(`M ${ex} 0 L ${ex} ${h}`, {
      seed: s >>> 0,
      amplitude: rail.edge === 'rough' ? 0.9 : 0.5,
      frequency: 0.02,
    });
    ctx.stroke(new Path2D(a));
    ctx.stroke(new Path2D(b));
  }
  ctx.restore();
}

/* ================================= plank ================================= */

/** Default shelf plank height in world px (matches wood.ts PLANK_HEIGHT_WORLD). */
export const THEMED_PLANK_HEIGHT = 40;

/**
 * Render one shelf plank front face into `w Ã— h`: lit top lip where books
 * stand, wood field, joinery run, inlay, front arris, and the theme's
 * under-shelf detail (apothecary drawer fronts, cottage bunting).
 */
export function renderPlank(
  ctx: Ctx2D,
  theme: LibraryTheme,
  w: number,
  h: number,
  seed: number,
): void {
  const { wood, joinery, rail } = theme;
  const rnd = mulberry32(seed >>> 0);
  ctx.save();
  // The front edge of a shelf is END-ish grain seen nearly edge-on, in its own
  // shadow for most of its depth. Painting it in the theme's full-brightness
  // face tone made every plank a pale bar across the frame; a real one is a
  // dark board with a lit arris.
  const edgeWood = {
    ...wood,
    light: mixHex(wood.light, wood.dark, 0.42),
    dark: mixHex(wood.dark, '#120c07', 0.34),
    contrast: wood.contrast * 1.15,
  };
  paintWood(ctx, edgeWood, w, h, {
    seed: seed ^ 0x9147,
    direction: 'horizontal',
    // The plank edge is 40 px tall and a whole tile repeat is taller than
    // that, so the figure cannot be caught repeating across the height — and
    // across the run it is stretched nearly twice, which puts the visible
    // period past the length of any shelf. Pale timbers (birch, limed oak)
    // came out as flat cardboard bars without it.
    figure: 0.72,
  });

  // --- the profile, painted ----------------------------------------------
  //
  // The old version laid four `fillRect`s of translucent white and brown down
  // the front face. At any zoom that reads as sticky tape: a hard-edged band
  // of the same value for the plank's whole length. A plank's front edge is
  // the brightest line in a case and it has to behave like one — broken where
  // the arris is dinged, hotter where the key rakes it, gone where a book
  // sits proud of the lip.
  const timber = P.parseColour(mixHex(wood.light, wood.dark, 0.45));
  const arris = P.mixRgb(P.parseColour(wood.light), { r: 1, g: 0.97, b: 0.9 }, 0.55);
  const under = P.mixRgb(P.parseColour(wood.dark), { r: 0.04, g: 0.03, b: 0.025 }, 0.55);
  const psf = P.createSurface(Math.ceil(w), Math.ceil(h));

  /** One long broken line along the plank at `y`, `n` px thick. */
  const runLine = (y: number, thick: number, colour: P.Rgb, alpha: number, sd: number): void => {
    const r2 = mulberry32(sd >>> 0);
    let x = -4;
    while (x < w) {
      const seg = 18 + r2() * 140;
      if (r2() > 0.14) {
        P.stroke(
          psf,
          [
            { x, y: y + (r2() - 0.5) * thick * 0.5 },
            { x: x + seg, y: y + (r2() - 0.5) * thick * 0.5 },
          ],
          P.brush('blade', {
            size: Math.max(0.8, thick),
            colour,
            opacity: alpha,
            spacing: 0.12,
            hardness: 0.82,
            jitter: { lum: 0.1, hue: 5, opacity: 0.45, position: 0.3, size: 0.25 },
          }),
          { passes: 1, pressure: P.PRESSURE.arc, taper: 0.12, wobble: thick * 0.35, seed: (sd + x * 13) >>> 0 },
        );
      }
      x += seg + r2() * 22;
    }
  };

  const lipY = Math.max(0.8, h * 0.05);
  switch (rail.edge) {
    case 'rounded': {
      // Bullnose: the light rolls over the top and dies under the belly.
      P.glaze(psf, null, arris, 0.34, {
        blend: 'screen',
        gradient: (_x, y) => Math.exp(-Math.pow((y / h - 0.1) / 0.16, 2)),
        mottle: 0.4,
        mottleScale: Math.max(24, w * 0.04),
        seed: seed ^ 0x11,
      });
      runLine(lipY, Math.max(0.9, h * 0.06), arris, 0.5, seed ^ 0x21);
      break;
    }
    case 'chamfer': {
      P.glaze(psf, null, arris, 0.3, {
        blend: 'screen',
        gradient: (_x, y) => (y / h < 0.2 ? 1 : 0),
        mottle: 0.35,
        seed: seed ^ 0x12,
      });
      runLine(h * 0.2, Math.max(0.8, h * 0.05), under, 0.4, seed ^ 0x22);
      runLine(lipY * 0.8, Math.max(0.8, h * 0.05), arris, 0.55, seed ^ 0x32);
      break;
    }
    case 'rough': {
      // Sawn and left: a ragged arris with torn fibres along the top.
      const tear = P.brush('chalk', { size: Math.max(1, h * 0.1), colour: under, opacity: 0.28, grain: 1, jitter: { opacity: 0.7, size: 0.7 } });
      for (let sx = 0; sx < w; sx += 4 + rnd() * 9) {
        P.stroke(psf, [{ x: sx, y: 0 }, { x: sx + 1 + rnd() * 3, y: rnd() * h * 0.14 }], tear, {
          passes: 1,
          pressure: P.PRESSURE.flick,
          seed: (seed + sx * 7) >>> 0,
        });
      }
      runLine(lipY * 1.4, Math.max(0.8, h * 0.045), arris, 0.34, seed ^ 0x23);
      break;
    }
    default: {
      // Sharp: a hard bright arris with a fine quirk bead under it.
      runLine(lipY * 0.7, Math.max(0.9, h * 0.07), arris, 0.62, seed ^ 0x24);
      runLine(h * 0.34, Math.max(0.7, h * 0.05), under, 0.45, seed ^ 0x34);
      runLine(h * 0.34 + Math.max(1, h * 0.06), Math.max(0.7, h * 0.04), arris, 0.24, seed ^ 0x44);
      break;
    }
  }

  // The face falls away from the lit lip into a genuinely dark under-edge:
  // the shelf below is a cave and this is its ceiling.
  P.glaze(psf, null, under, 0.72, {
    blend: 'multiply',
    gradient: (_x, y) => clamp01Case((y / h - 0.42) / 0.58) ** 1.5,
    mottle: 0.28,
    mottleScale: Math.max(20, w * 0.03),
    seed: seed ^ 0x55,
  });
  // …and the timber warms toward the middle of the face rather than staying
  // one flat tone the whole length of the run.
  P.glaze(psf, null, P.shiftHsl(timber, 6, 0.1, 0.02), 0.14, {
    blend: 'softlight',
    gradient: (x) => 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(x / Math.max(60, w * 0.09))),
    mottle: 0.3,
    seed: seed ^ 0x66,
  });
  P.drawSurface(ctx as CanvasRenderingContext2D, psf, 0, 0);

  // Plank seams.
  ctx.strokeStyle = rail.ink;
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  const seams: number[] = [];
  for (let sx = 240; sx < w - 20; sx += 240) {
    const jx = sx + (rnd() * 2 - 1) * 12;
    seams.push(jx);
    pencil(ctx, `M ${jx} 1 L ${jx} ${h - 1}`, seed + Math.round(jx), 0.8);
  }
  pencil(ctx, `M 0 1.4 L ${w} 1.4`, seed ^ 0x70e, 0.5);
  pencil(ctx, `M 0 ${h - 1.5} L ${w} ${h - 1.5}`, seed ^ 0xed6e, 0.6);

  // Inlay pinstripe along the lip. Painted, broken, and knocked back into the
  // timber: a full-strength saturated hairline running the entire length of
  // the shelf was the loudest un-painterly mark left in the case — one pink
  // vector line across a metre of oak.
  if (rail.inlay !== 'none') {
    const inlay = P.parseColour(mixHex(rail.inlayColour, wood.dark, 0.42));
    const isf = P.createSurface(Math.ceil(w), Math.ceil(h));
    const r3 = mulberry32((seed ^ 0x1a1a) >>> 0);
    const thick = rail.inlay === 'painted-line' ? 2.2 : 1.1;
    let ix = 12;
    while (ix < w - 12) {
      const seg = 40 + r3() * 220;
      if (r3() > 0.12) {
        P.stroke(
          isf,
          [
            { x: ix, y: h * 0.24 + (r3() - 0.5) },
            { x: Math.min(w - 12, ix + seg), y: h * 0.24 + (r3() - 0.5) },
          ],
          P.brush('blade', {
            size: thick,
            colour: inlay,
            opacity: 0.55,
            spacing: 0.12,
            hardness: 0.8,
            jitter: { lum: 0.09, hue: 6, opacity: 0.5, position: 0.25 },
          }),
          { passes: 1, pressure: P.PRESSURE.arc, taper: 0.1, wobble: 0.4, seed: (seed + ix * 17) >>> 0 },
        );
      }
      ix += seg + r3() * 30;
    }
    P.drawSurface(ctx as CanvasRenderingContext2D, isf, 0, 0);
  }

  // Joinery run along the plank.
  const step = 220 / Math.max(0.25, joinery.density);
  for (let x = 60; x < w - 40; x += step) {
    renderJoinery(ctx, joinery, x - 16, h * 0.25, 32, h * 0.5, seed ^ Math.round(x * 7), 'horizontal');
  }
  for (const sx of seams) {
    renderJoinery(ctx, joinery, sx - 14, h * 0.25, 28, h * 0.5, seed ^ Math.round(sx * 3), 'horizontal');
  }
  ctx.restore();
}

/**
 * The under-shelf detail strip drawn immediately BELOW a plank
 * (apothecary specimen drawers, cottage bunting). Height is `h`.
 * Returns without drawing for themes that have no under-shelf treatment.
 */
export function renderShelfDetail(
  ctx: Ctx2D,
  theme: LibraryTheme,
  w: number,
  h: number,
  seed: number,
): void {
  const detail = theme.shelfDetail ?? 'none';
  if (detail === 'none') return;
  const rnd = mulberry32(seed >>> 0);
  ctx.save();
  if (detail === 'drawers') {
    // A run of tiny specimen drawers with brass cup pulls and label slips.
    const count = Math.max(3, Math.round(w / 92));
    const dw = w / count;
    for (let i = 0; i < count; i++) {
      const x = i * dw + 2;
      const dwi = dw - 4;
      ctx.save();
      ctx.translate(x, 2);
      paintWood(ctx, theme.wood, dwi, h - 4, {
        seed: (seed ^ (i * 131)) >>> 0,
        direction: 'horizontal',
        contrast: 0.8,
      });
      // Drawer face bevel.
      const g = ctx.createLinearGradient(0, 0, 0, h - 4);
      g.addColorStop(0, 'rgba(255, 236, 200, 0.26)');
      g.addColorStop(0.6, 'rgba(0, 0, 0, 0)');
      g.addColorStop(1, 'rgba(30, 14, 6, 0.34)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, dwi, h - 4);
      ctx.strokeStyle = 'rgba(46, 24, 12, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, dwi - 1, h - 5);
      // Brass cup pull.
      const px = dwi / 2;
      const py = (h - 4) / 2 + 1;
      const pg = ctx.createLinearGradient(0, py - 4, 0, py + 4);
      pg.addColorStop(0, '#e8ce86');
      pg.addColorStop(0.5, theme.joinery.metal);
      pg.addColorStop(1, theme.joinery.metalDark);
      ctx.fillStyle = pg;
      roundRect(ctx, px - 9, py - 3.5, 18, 7, 3);
      ctx.fill();
      ctx.strokeStyle = 'rgba(40, 24, 8, 0.6)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      // Tiny label slip with a scratched numeral.
      ctx.fillStyle = 'rgba(244, 234, 210, 0.8)';
      ctx.fillRect(3, 3, 16, 8);
      ctx.strokeStyle = 'rgba(80, 52, 26, 0.6)';
      ctx.lineWidth = 0.7;
      ctx.strokeRect(3, 3, 16, 8);
      ctx.beginPath();
      ctx.moveTo(6, 8);
      ctx.lineTo(6 + 3 + rnd() * 5, 8);
      ctx.stroke();
      ctx.restore();
    }
  } else if (detail === 'bunting') {
    // Knitted bunting strung under the shelf: a catenary with pennants.
    const sag = h * 0.55;
    const pennants = Math.max(4, Math.round(w / 62));
    ctx.strokeStyle = 'rgba(150, 118, 88, 0.8)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(2, 3);
    ctx.quadraticCurveTo(w / 2, 3 + sag * 2, w - 2, 3);
    ctx.stroke();
    const palette = theme.spineDefaults.pigments;
    for (let i = 0; i < pennants; i++) {
      const t = (i + 0.5) / pennants;
      const x = 2 + t * (w - 4);
      // Point on the quadratic string.
      const y = 3 + 2 * (1 - t) * t * (3 + sag * 2 - 3) * 2;
      const c = palette[i % palette.length] ?? '#c9a2b6';
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(x - 7, y);
      ctx.lineTo(x + 7, y);
      ctx.lineTo(x, y + h * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(90, 62, 40, 0.5)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      // Knit texture: two stitch rows.
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      for (let r = 1; r <= 2; r++) {
        const ry = y + (h * 0.55 * r) / 4;
        const rw = 7 * (1 - r / 4);
        ctx.beginPath();
        ctx.moveTo(x - rw, ry);
        ctx.lineTo(x + rw, ry);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/* =============================== backdrop ================================ */

export interface BackdropOptions {
  seed: number;
  /**
   * One floor's height in world px. Every vertical feature (dado rail, shoji
   * lattice, glazing bars) repeats on this pitch, so a caller can bake a
   * single floor-tall strip and tile it up the world.
   */
  floorH?: number;
  /** Studio wallpaper override; defaults to the theme's own pairing. */
  wallpaper?: WallpaperSpec;
}

/**
 * Paint the *room's wall* behind the case, `w × h` at the current origin.
 *
 * Six treatments, orthogonal to both theme and wallpaper (library-themes.md
 * §1 + the studio's "This library" tab): papered · panelled · plastered ·
 * boarded · shoji · glazed. Only papered and panelled show the wallpaper
 * pattern; the rest take just its colourway, so switching a room's wall never
 * clashes with the books.
 */
export function renderBackdrop(
  ctx: Ctx2D,
  theme: LibraryTheme,
  backdrop: BackdropId,
  w: number,
  h: number,
  opts: BackdropOptions,
): void {
  const wp = opts.wallpaper ?? theme.wallpaper;
  const floorH = Math.max(120, opts.floorH ?? h);
  const seed = opts.seed >>> 0;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  switch (backdrop) {
    case 'panelled':
      backdropPanelled(ctx, theme, wp, w, h, floorH, seed);
      break;
    case 'plastered':
      backdropPlastered(ctx, theme, wp, w, h, floorH, seed);
      break;
    case 'boarded':
      backdropBoarded(ctx, theme, wp, w, h, seed);
      break;
    case 'shoji':
      backdropShoji(ctx, theme, wp, w, h, floorH, seed);
      break;
    case 'glazed':
      backdropGlazed(ctx, theme, wp, w, h, floorH, seed);
      break;
    case 'papered':
    default:
      paperWall(ctx, wp, 0, 0, w, h, seed);
      break;
  }
  // Every room is a little darker at the skirting than at the picture rail.
  const room = ctx.createLinearGradient(0, 0, 0, h);
  room.addColorStop(0, 'rgba(255, 255, 255, 0.05)');
  room.addColorStop(0.55, 'rgba(0, 0, 0, 0)');
  room.addColorStop(1, 'rgba(18, 12, 8, 0.16)');
  ctx.fillStyle = room;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Tile the wallpaper across a rect. */
/**
 * Lay the tooth of real paper over a printed surface.
 *
 * Wallpaper is ink on paper, and the paper is what you actually see between
 * the motifs — a hung wall is never the flat printed field the pattern
 * renderer produces. This modulates value only: the tile is tinted to neutral
 * grey and composited in `soft-light`, so it cannot shift the colourway's hue,
 * it can only give the surface a fibre.
 *
 * The multiply pass that follows is a quarter of the strength and exists to
 * return the paper's darks — soft-light on its own lifts a surface and the
 * fibre ends up reading as a sheen rather than as a tooth.
 *
 * A no-op when the library is not resident, which is the pre-existing look.
 */
function paperTooth(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  strength = 1,
  slug = 'paper-laid',
): void {
  if (w < 2 || h < 2 || strength <= 0.01) return;
  if (!getMaterialTile(slug)) return;
  const common = {
    slug,
    tint: '#808080',
    // Wall-sized surface, so the sheet reads at roughly its real fineness
    // rather than as a wall-height crackle.
    tilePx: 190,
    colourMix: 0,
    balance: 1,
    seed,
  } as const;
  drawMaterialRect(ctx as CanvasRenderingContext2D, x, y, w, h, {
    ...common,
    strength: 0.9,
    globalAlpha: 0.4 * strength,
    composite: 'soft-light',
  });
  drawMaterialRect(ctx as CanvasRenderingContext2D, x, y, w, h, {
    ...common,
    strength: 1,
    contrast: 1.1,
    globalAlpha: 0.1 * strength,
    composite: 'multiply',
  });
}

function paperWall(
  ctx: Ctx2D,
  wp: WallpaperSpec,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
): void {
  // A hung printed sheet wants a motif-sized pitch, not the 256 px cell the
  // procedural patterns were authored at; `wallpaperRepeat` returns the
  // requested size unchanged when no sheet is resident.
  const printed = wallpaperHasPrint(wp.pattern);
  const size = wallpaperRepeat(wp.pattern, wp.tile);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  // Snap the tile origin to the pattern grid so the seam never lands mid-rect.
  const x0 = x - (((x % size) + size) % size);
  const y0 = y - (((y % size) + size) % size);
  for (let ty = y0; ty < y + h; ty += size) {
    for (let tx = x0; tx < x + w; tx += size) {
      ctx.save();
      ctx.translate(tx, ty);
      renderWallpaper(ctx, wp.pattern, size, wp.colourway, seed);
      ctx.restore();
    }
  }
  // The sheet the pattern is printed on — one pass over the whole hung area,
  // NOT per tile, so the fibre does not repeat on the pattern's pitch.
  //
  // Held well back over a printed sheet. The tooth exists to stop a flat
  // procedural fill reading as coloured card; a painted damask already has
  // more surface incident than the tooth can add, and at full strength the
  // soft-light pass just greys the print down — which is the exact
  // desaturation this wall was rebuilt to get rid of.
  paperTooth(ctx, x, y, w, h, (seed ^ 0x9e11) >>> 0, printed ? 0.3 : 0.85);
  ctx.restore();
}

/** Wall timber: the case's own wood, one shade quieter and less contrasty. */
function wallTimber(
  ctx: Ctx2D,
  theme: LibraryTheme,
  w: number,
  h: number,
  seed: number,
  direction: 'horizontal' | 'vertical',
): void {
  paintWood(
    ctx,
    {
      ...theme.wood,
      contrast: theme.wood.contrast * 0.72,
      // A wall is further away and less handled than the case: knock the
      // chipping back so the paint film reads as a surface, not as fly specks.
      paint: theme.wood.paint
        ? { ...theme.wood.paint, chipping: theme.wood.paint.chipping * 0.4 }
        : undefined,
    },
    w,
    h,
    { seed: seed >>> 0, direction, contrast: 0.9, noFinish: true },
  );
}

/* --- panelled ------------------------------------------------------------ */

function backdropPanelled(
  ctx: Ctx2D,
  theme: LibraryTheme,
  wp: WallpaperSpec,
  w: number,
  h: number,
  floorH: number,
  seed: number,
): void {
  const rnd = mulberry32(seed ^ 0x9d1);
  const ink = theme.rail.ink;
  for (let by = -floorH; by < h; by += floorH) {
    const dadoY = by + floorH * 0.6;
    const railH = 11;
    const skirtH = 20;
    const base = by + floorH - skirtH;
    // 1. paper above the rail
    paperWall(ctx, wp, 0, Math.max(0, by), w, Math.max(0, dadoY - Math.max(0, by)), seed);
    // 2. dado field
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, dadoY, w, floorH - floorH * 0.6);
    ctx.clip();
    ctx.save();
    ctx.translate(0, dadoY);
    wallTimber(ctx, theme, w, floorH * 0.4 + 2, seed ^ 0x4a1, 'vertical');
    ctx.restore();
    // Fielded panels: a raised centre inside a bevelled frame.
    const stile = 16;
    const pw = 150;
    const count = Math.max(1, Math.round(w / pw));
    const cw2 = w / count;
    for (let i = 0; i < count; i++) {
      const px = i * cw2 + stile / 2;
      const py = dadoY + 14;
      const pwi = cw2 - stile;
      const phi = base - py - 10;
      if (pwi < 20 || phi < 20) continue;
      // Bevel: light on the top/left arris, shadow on the bottom/right.
      ctx.fillStyle = 'rgba(20, 14, 8, 0.3)';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + pwi, py);
      ctx.lineTo(px + pwi - 9, py + 9);
      ctx.lineTo(px + 9, py + 9);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(20, 14, 8, 0.2)';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + 9, py + 9);
      ctx.lineTo(px + 9, py + phi - 9);
      ctx.lineTo(px, py + phi);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 246, 224, 0.22)';
      ctx.beginPath();
      ctx.moveTo(px + pwi, py);
      ctx.lineTo(px + pwi, py + phi);
      ctx.lineTo(px + pwi - 9, py + phi - 9);
      ctx.lineTo(px + pwi - 9, py + 9);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 246, 224, 0.26)';
      ctx.beginPath();
      ctx.moveTo(px, py + phi);
      ctx.lineTo(px + pwi, py + phi);
      ctx.lineTo(px + pwi - 9, py + phi - 9);
      ctx.lineTo(px + 9, py + phi - 9);
      ctx.closePath();
      ctx.fill();
      // Raised centre catches the light: without this the field reads as a
      // dark hole in dark-timbered rooms and the panelling disappears.
      const field = ctx.createLinearGradient(px + 9, py + 9, px + 9, py + phi - 9);
      field.addColorStop(0, 'rgba(255, 246, 220, 0.2)');
      field.addColorStop(0.5, 'rgba(255, 246, 220, 0.08)');
      field.addColorStop(1, 'rgba(40, 28, 16, 0.14)');
      ctx.fillStyle = field;
      ctx.fillRect(px + 9, py + 9, pwi - 18, phi - 18);
      ctx.strokeStyle = hexAlpha('#2a1d12', 0.3);
      ctx.lineWidth = 1;
      pencil(ctx, `M ${px + 9} ${py + 9} L ${px + pwi - 9} ${py + 9} L ${px + pwi - 9} ${py + phi - 9} L ${px + 9} ${py + phi - 9} Z`, (seed + i * 71) >>> 0, 0.5);
    }
    ctx.restore();
    // 3. chair rail: three stacked mouldings, plus its shadow on the paper.
    const shadow = ctx.createLinearGradient(0, dadoY - 16, 0, dadoY);
    shadow.addColorStop(0, 'rgba(24, 16, 8, 0)');
    shadow.addColorStop(1, 'rgba(24, 16, 8, 0.3)');
    ctx.fillStyle = shadow;
    ctx.fillRect(0, dadoY - 16, w, 16);
    ctx.save();
    ctx.translate(0, dadoY - railH);
    wallTimber(ctx, theme, w, railH + 3, seed ^ 0x77c1, 'horizontal');
    ctx.restore();
    ctx.fillStyle = 'rgba(255, 250, 232, 0.34)';
    ctx.fillRect(0, dadoY - railH, w, 2.4);
    ctx.fillStyle = 'rgba(30, 20, 12, 0.34)';
    ctx.fillRect(0, dadoY - railH * 0.42, w, 2);
    ctx.fillStyle = 'rgba(255, 248, 226, 0.18)';
    ctx.fillRect(0, dadoY - railH * 0.42 + 2, w, 1.2);
    ctx.fillStyle = 'rgba(26, 18, 10, 0.3)';
    ctx.fillRect(0, dadoY + 1.5, w, 2.4);
    if (theme.rail.inlay !== 'none') {
      ctx.fillStyle = theme.rail.inlayColour;
      ctx.fillRect(0, dadoY - railH * 0.72, w, 1.1);
    }
    // 4. skirting board
    ctx.save();
    ctx.translate(0, base);
    wallTimber(ctx, theme, w, skirtH, seed ^ 0x1b0, 'horizontal');
    ctx.restore();
    ctx.fillStyle = 'rgba(255, 248, 226, 0.24)';
    ctx.fillRect(0, base, w, 2);
    ctx.fillStyle = 'rgba(20, 14, 8, 0.42)';
    ctx.fillRect(0, base + skirtH - 3, w, 3);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1;
    pencil(ctx, `M 0 ${base + 0.8} L ${w} ${base + 0.8}`, (seed ^ 0x33) >>> 0, 0.6);
    void rnd;
  }
}

/* --- plastered ----------------------------------------------------------- */

function backdropPlastered(
  ctx: Ctx2D,
  theme: LibraryTheme,
  wp: WallpaperSpec,
  w: number,
  h: number,
  floorH: number,
  seed: number,
): void {
  const cw = getColourway(wp.colourway);
  const rnd = mulberry32(seed ^ 0x51a);
  ctx.fillStyle = cw.base;
  ctx.fillRect(0, 0, w, h);
  // Trowel sweeps: a float travels FLAT and far, so these are long shallow
  // arcs, almost horizontal, and barely there. Short fat arcs read as debris.
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < Math.round((w * h) / 2600); i++) {
    const cx = rnd() * w;
    const cy = rnd() * h;
    const r = 180 + rnd() * 340;
    const a0 = -Math.PI / 2 - 0.5 + rnd() * 1;
    const span = 0.06 + rnd() * 0.16;
    ctx.strokeStyle = rnd() < 0.5 ? 'rgba(255, 255, 250, 0.03)' : hexAlpha(parseHexToHex(cw.inkSoft), 0.035);
    ctx.lineWidth = 4 + rnd() * 9;
    ctx.beginPath();
    ctx.arc(cx, cy + r, r, a0 - span, a0 + span);
    ctx.stroke();
  }
  ctx.restore();
  // Ghost of an old fresco: a blind arcade, drawn as one continuous line per
  // bay with a springing course tying the bays together, so it reads as
  // architecture even at a tenth of its original strength.
  for (let by = -floorH; by < h; by += floorH) {
    const bays = Math.max(2, Math.round(w / 200));
    const bw = w / bays;
    const top = by + floorH * 0.14;
    const bot = by + floorH * 0.9;
    const r = bw * 0.42;
    const spring = top + r;
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = cw.accent;
    ctx.lineWidth = 1.8;
    for (let i = 0; i < bays; i++) {
      const cx = i * bw + bw / 2;
      // arc(…, PI, 0) sweeps the BOTTOM half (canvas adds 2PI when end < start)
      // and turns every arch into a ring. PI → 2PI is the springing arch.
      ctx.beginPath();
      ctx.moveTo(cx - r, bot);
      ctx.lineTo(cx - r, spring);
      ctx.arc(cx, spring, r, Math.PI, Math.PI * 2);
      ctx.lineTo(cx + r, bot);
      ctx.stroke();
    }
    // Springing course + impost band across every bay.
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, spring);
    ctx.lineTo(w, spring);
    ctx.moveTo(0, spring + 5);
    ctx.lineTo(w, spring + 5);
    ctx.stroke();
    // A faded figure standing in every other bay: halo, shoulders, robe.
    ctx.globalAlpha = 0.34;
    ctx.lineWidth = 1.8;
    for (let i = 0; i < bays; i += 2) {
      const cx = i * bw + bw / 2;
      const head = spring + r * 0.5;
      const hem = bot - 8;
      ctx.beginPath();
      // Halo only — no facial features; a saint whose paint has gone.
      ctx.arc(cx, head, r * 0.3, 0, Math.PI * 2);
      // Shoulders, then a robe falling in two folds to a soft hem.
      ctx.moveTo(cx - r * 0.34, head + r * 0.46);
      ctx.quadraticCurveTo(cx, head + r * 0.24, cx + r * 0.34, head + r * 0.46);
      ctx.moveTo(cx - r * 0.34, head + r * 0.46);
      ctx.bezierCurveTo(cx - r * 0.52, head + r * 1.4, cx - r * 0.5, hem - 20, cx - r * 0.44, hem);
      ctx.moveTo(cx + r * 0.34, head + r * 0.46);
      ctx.bezierCurveTo(cx + r * 0.52, head + r * 1.4, cx + r * 0.5, hem - 20, cx + r * 0.44, hem);
      ctx.moveTo(cx - r * 0.44, hem);
      ctx.quadraticCurveTo(cx, hem + 7, cx + r * 0.44, hem);
      // One inner fold so the robe has weight.
      ctx.moveTo(cx, head + r * 0.62);
      ctx.quadraticCurveTo(cx - r * 0.12, hem - 30, cx - r * 0.06, hem - 2);
      ctx.stroke();
    }
    ctx.restore();
    // Where the plaster has been reskimmed the fresco simply stops.
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 3; i++) {
      const px = rnd() * w;
      const py = by + rnd() * floorH;
      const pr = 40 + rnd() * 90;
      const pg = ctx.createRadialGradient(px, py, 0, px, py, pr);
      pg.addColorStop(0, cw.base);
      pg.addColorStop(0.7, cw.base);
      // Fade to a TRANSPARENT VERSION OF THIS COLOUR, never to rgba(0,0,0,0):
      // canvas interpolates un-premultiplied, so fading to transparent black
      // paints a dark halo ring at the gradient's edge.
      pg.addColorStop(1, hexAlpha(cw.base, 0));
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = pg;
      ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    }
    ctx.restore();
  }
  // Damp bloom creeping up from the floor.
  const damp = ctx.createLinearGradient(0, h, 0, h - Math.min(h * 0.4, 220));
  damp.addColorStop(0, hexAlpha('#6d6250', 0.34));
  damp.addColorStop(1, 'rgba(109, 98, 80, 0)');
  ctx.fillStyle = damp;
  ctx.fillRect(0, h - Math.min(h * 0.4, 220), w, Math.min(h * 0.4, 220));
  // Hairline settlement cracks + pinholes.
  ctx.strokeStyle = cw.ink;
  ctx.lineWidth = 0.9;
  for (let i = 0; i < Math.round(h / 90); i++) {
    let x = rnd() * w;
    let y = rnd() * h;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 6; s++) {
      x += (rnd() * 2 - 1) * 22;
      y += 10 + rnd() * 26;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < Math.round((w * h) / 900); i++) {
    ctx.fillStyle = rnd() < 0.6 ? cw.inkSoft : 'rgba(255, 255, 255, 0.18)';
    ctx.beginPath();
    ctx.arc(rnd() * w, rnd() * h, 0.4 + rnd() * 1, 0, Math.PI * 2);
    ctx.fill();
  }
  void theme;
}

/* --- boarded ------------------------------------------------------------- */

function backdropBoarded(
  ctx: Ctx2D,
  theme: LibraryTheme,
  wp: WallpaperSpec,
  w: number,
  h: number,
  seed: number,
): void {
  const rnd = mulberry32(seed ^ 0xb0a2);
  const cw = getColourway(wp.colourway);
  // Boards of mildly varying width, each its own piece of timber.
  let x = -20 - rnd() * 20;
  let i = 0;
  while (x < w) {
    const bw = 34 + rnd() * 22;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, 0, bw, h);
    ctx.clip();
    ctx.translate(x, 0);
    wallTimber(ctx, theme, bw, h, (seed ^ (i * 3167)) >>> 0, 'vertical');
    // Per-board tone jitter: no two boards came off the same log.
    ctx.fillStyle = i % 3 === 0
      ? 'rgba(255, 250, 236, 0.09)'
      : i % 3 === 1
        ? 'rgba(24, 18, 12, 0.09)'
        : 'rgba(0, 0, 0, 0)';
    ctx.fillRect(0, 0, bw, h);
    ctx.restore();
    // V-groove between boards: dark core, bright lip on the left of the next.
    ctx.fillStyle = 'rgba(18, 13, 8, 0.42)';
    ctx.fillRect(x + bw - 2.2, 0, 2.2, h);
    ctx.fillStyle = 'rgba(255, 248, 228, 0.2)';
    ctx.fillRect(x + bw, 0, 1.4, h);
    // Bead line a few px in — the tongue-and-groove signature.
    ctx.strokeStyle = 'rgba(28, 20, 12, 0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 6.5, 0);
    ctx.lineTo(x + 6.5, h);
    ctx.stroke();
    x += bw;
    i++;
  }
  // Wash the whole run toward the wall colourway so it belongs to the room.
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = cw.base;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  // A few nail heads and one horizontal batten line high up.
  ctx.fillStyle = 'rgba(52, 44, 34, 0.45)';
  for (let n = 0; n < Math.round(w / 90); n++) {
    ctx.beginPath();
    ctx.arc(rnd() * w, rnd() * h, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* --- shoji --------------------------------------------------------------- */

function backdropShoji(
  ctx: Ctx2D,
  theme: LibraryTheme,
  wp: WallpaperSpec,
  w: number,
  h: number,
  floorH: number,
  seed: number,
): void {
  const rnd = mulberry32(seed ^ 0x5401);
  const cw = getColourway(wp.colourway);
  const paper = mixHex(cw.base, '#fffaf0', 0.5);
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, w, h);
  // Paper glows warm where the light behind it is strongest.
  for (let by = -floorH; by < h; by += floorH) {
    const g = ctx.createRadialGradient(w * 0.5, by + floorH * 0.4, 0, w * 0.5, by + floorH * 0.4, Math.max(w, floorH) * 0.7);
    g.addColorStop(0, 'rgba(255, 246, 224, 0.5)');
    g.addColorStop(1, 'rgba(255, 246, 224, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, by, w, floorH);
  }
  // Kozo fibres suspended in the sheet.
  for (let i = 0; i < Math.round((w * h) / 700); i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const a = rnd() * Math.PI;
    const len = 3 + rnd() * 11;
    ctx.strokeStyle = rnd() < 0.5 ? cw.inkSoft : 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  // The shadow of a branch on the far side of the screen — soft, no detail.
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = cw.inkSoft;
  for (let by = -floorH; by < h; by += floorH) {
    let x = -10;
    let y = by + floorH * (0.2 + rnd() * 0.5);
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    while (x < w + 20) {
      const nx = x + 60 + rnd() * 60;
      const ny = y + (rnd() * 2 - 1) * 34;
      ctx.quadraticCurveTo((x + nx) / 2, y - 18, nx, ny);
      x = nx;
      y = ny;
    }
    ctx.stroke();
  }
  ctx.restore();
  // Kumiko lattice: fine timber grid over the paper, with its own shadow.
  const cols = Math.max(2, Math.round(w / 118));
  const rows = 4;
  const cwid = w / cols;
  const rh = floorH / rows;
  const bar = (x: number, y: number, bw: number, bh: number): void => {
    ctx.fillStyle = 'rgba(60, 46, 30, 0.16)';
    ctx.fillRect(x + 1.5, y + 2, bw, bh);
    ctx.fillStyle = mixHex(theme.wood.light, '#3a2c1c', 0.32);
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = 'rgba(255, 250, 236, 0.3)';
    ctx.fillRect(x, y, bw < bh ? 1 : bw, bw < bh ? bh : 1);
  };
  for (let by = -floorH; by < h; by += floorH) {
    for (let r = 0; r <= rows; r++) bar(0, by + r * rh - 1.6, w, 3.2);
    for (let c = 0; c <= cols; c++) bar(c * cwid - 1.6, by, 3.2, floorH);
    // Heavier stile/rail framing every panel.
    for (let c = 0; c <= cols; c += 2) bar(c * cwid - 4, by, 8, floorH);
    bar(0, by + floorH - 6, w, 12);
  }
}

/* --- glazed -------------------------------------------------------------- */

function backdropGlazed(
  ctx: Ctx2D,
  theme: LibraryTheme,
  wp: WallpaperSpec,
  w: number,
  h: number,
  floorH: number,
  seed: number,
): void {
  const rnd = mulberry32(seed ^ 0x91a5);
  const cw = getColourway(wp.colourway);
  const night = theme.id === 'observatory';
  const skyTop = night ? '#1a2340' : mixHex(cw.base, '#cfe4ea', 0.62);
  const skyBot = night ? '#2b3557' : mixHex(cw.base, '#eef3e6', 0.55);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, skyTop);
  g.addColorStop(1, skyBot);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // What is beyond the glass: soft foliage masses, or a star field at night.
  if (night) {
    for (let i = 0; i < Math.round((w * h) / 1400); i++) {
      ctx.fillStyle = rnd() < 0.12 ? cw.accent : 'rgba(222, 232, 255, 0.5)';
      ctx.beginPath();
      ctx.arc(rnd() * w, rnd() * h, 0.4 + rnd() * 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    for (let i = 0; i < Math.round((w * h) / 4200); i++) {
      const cx = rnd() * w;
      const cy = rnd() * h;
      const r = 22 + rnd() * 54;
      const fg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      fg.addColorStop(0, `rgba(96, 124, 82, ${0.16 + rnd() * 0.14})`);
      fg.addColorStop(1, 'rgba(96, 124, 82, 0)');
      ctx.fillStyle = fg;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  }
  // Condensation: runs down the pane with a bright leading bead.
  for (let i = 0; i < Math.round(w / 26); i++) {
    const x = rnd() * w;
    const y0 = rnd() * h;
    const len = 14 + rnd() * 90;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 0.8 + rnd();
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.quadraticCurveTo(x + (rnd() * 2 - 1) * 3, y0 + len * 0.6, x + (rnd() * 2 - 1) * 4, y0 + len);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.beginPath();
    ctx.arc(x, y0 + len, 1.2 + rnd(), 0, Math.PI * 2);
    ctx.fill();
  }
  // Glazing bars: painted timber grid with putty lines and a cast shadow.
  const cols = Math.max(2, Math.round(w / 130));
  const rows = 3;
  const cwid = w / cols;
  const rh = floorH / rows;
  // Glazing bars are the room's own joinery: painted where the room paints,
  // otherwise its timber lightened only a little (a night observatory must
  // not sprout cream-white window frames).
  const barColour = theme.wood.paint?.colour ?? mixHex(theme.wood.light, '#f4efe2', 0.3);
  const barDark = theme.wood.paint?.shade ?? theme.wood.dark;
  const bar = (x: number, y: number, bw: number, bh: number): void => {
    ctx.fillStyle = 'rgba(30, 34, 26, 0.24)';
    ctx.fillRect(x + 2, y + 2.5, bw, bh);
    ctx.fillStyle = barColour;
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = hexAlpha(parseHexToHex(barDark), 0.5);
    if (bw < bh) ctx.fillRect(x + bw - 1.6, y, 1.6, bh);
    else ctx.fillRect(x, y + bh - 1.6, bw, 1.6);
    ctx.fillStyle = 'rgba(255, 255, 250, 0.42)';
    if (bw < bh) ctx.fillRect(x, y, 1.3, bh);
    else ctx.fillRect(x, y, bw, 1.3);
  };
  for (let by = -floorH; by < h; by += floorH) {
    for (let r = 0; r <= rows; r++) bar(0, by + r * rh - 3, w, 6);
    for (let c = 0; c <= cols; c++) bar(c * cwid - 3.5, by, 7, floorH);
    // A heavier transom + mullion every other bay.
    bar(0, by + floorH * 0.5 - 6, w, 12);
    for (let c = 0; c <= cols; c += 2) bar(c * cwid - 6, by, 12, floorH);
  }
  // Green haze pressed against the inside of the glass, bottom corners.
  const haze = ctx.createLinearGradient(0, h, 0, h * 0.6);
  haze.addColorStop(0, night ? 'rgba(40, 52, 92, 0.34)' : 'rgba(112, 134, 92, 0.3)');
  haze.addColorStop(1, night ? 'rgba(40, 52, 92, 0)' : 'rgba(112, 134, 92, 0)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, h * 0.6, w, h * 0.4);
  void rnd;
}

/** mixHex returns `rgb(...)`; hexAlpha needs hex — normalise between them. */
function parseHexToHex(colour: string): string {
  if (colour.startsWith('#')) return colour;
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(colour);
  if (!m) return '#6b6152';
  const hex = (n: string): string => Number(n).toString(16).padStart(2, '0');
  return `#${hex(m[1]!)}${hex(m[2]!)}${hex(m[3]!)}`;
}

/* ============================== back panel =============================== */

/**
 * Render the case back panel for one book zone. Most rooms back the case in
 * timber; the scriptorium and the attic show the room's own wall straight
 * through (limewashed plaster, lath), which is `backing: 'wallpaper'`.
 */
export function renderBackPanel(
  ctx: Ctx2D,
  theme: LibraryTheme,
  w: number,
  h: number,
  seed: number,
  wallpaper?: WallpaperSpec,
): void {
  const wp = wallpaper ?? theme.wallpaper;
  ctx.save();
  if ((theme.backing ?? 'wood') === 'wallpaper') {
    // The room's own wall, seen straight through the carcass — at a tighter
    // pitch than the wall outside it.
    //
    // Not a stylistic choice: the back of a carcass is ~30 cm further from the
    // eye than the face of the case, and a print at the same on-screen repeat
    // in both places flattens that distance to nothing. Shrinking the motif
    // behind the books is the cheapest perspective cue there is, and it also
    // stops a full-size bloom sitting directly behind a spine and fighting it.
    paperWall(ctx, { ...wp, tile: Math.max(48, Math.round(wp.tile * 0.66)) }, 0, 0, w, h, seed);
  } else {
    // Boarded backing: distinct vertical boards, each its own piece of timber,
    // darker and quieter than the front members. Drawing real boards (rather
    // than one big noise field) is what stops the backdrop reading as mud.
    const rnd = mulberry32(seed >>> 0);
    const backWood = {
      ...theme.wood,
      light: mixHex(theme.wood.light, theme.wood.dark, 0.5),
      dark: mixHex(theme.wood.dark, '#0b0805', 0.28),
      contrast: theme.wood.contrast * 0.7,
      knots: theme.wood.knots * 0.4,
    };
    let x = -8 - rnd() * 30;
    let i = 0;
    while (x < w) {
      const bw = 74 + rnd() * 54;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, 0, bw, h);
      ctx.clip();
      ctx.translate(x, 0);
      paintWood(ctx, backWood, bw, h, {
        seed: (seed ^ (i * 7919)) >>> 0,
        direction: 'vertical',
        noFinish: true,
        // Painted rooms leave the carcass backs bare: this is the pale wood
        // the chipped sage paint is chipping back TO, and it stops the room
        // going flat and monochrome.
        bare: theme.wood.paint !== undefined,
      });
      // Tone jitter so the boards read as separate pieces, not one field.
      ctx.fillStyle =
        i % 3 === 0
          ? 'rgba(255, 244, 220, 0.055)'
          : i % 3 === 1
            ? 'rgba(12, 8, 5, 0.075)'
            : 'rgba(0, 0, 0, 0)';
      ctx.fillRect(0, 0, bw, h);
      ctx.restore();
      // Shadowed rebate between boards with a thin lit lip on the next one.
      ctx.fillStyle = 'rgba(12, 8, 5, 0.5)';
      ctx.fillRect(x + bw - 1.8, 0, 1.8, h);
      ctx.fillStyle = 'rgba(255, 246, 224, 0.1)';
      ctx.fillRect(x + bw, 0, 1, h);
      x += bw;
      i++;
    }
  }

  /* ----------------- the recess light (painterly rebuild §5) --------------
   * The reference's case interior is a light trap: the back panel falls to
   * near-black at the sides and behind the book tails, and a warm key rakes
   * in from the upper right — the same sun the spines' baked `rowPhase`
   * follows (left end of a row shaded, right end lit). This agreement is
   * what makes books read as standing IN the case rather than pasted on it.
   *
   * Four gradient passes, no per-pixel work. A room whose wall shows
   * straight through the carcass (a grove open to the sky, a reef, a nebula)
   * takes the same idea at reduced strength — the wall must not go to mud.
   */
  const wallBacked = (theme.backing ?? 'wood') === 'wallpaper';
  // 0.42 was set when the wall behind the carcass was a pale, near-flat
  // procedural field that any real shading turned to mud. It now shows a
  // printed sheet with three times the luminance spread, and at 0.42 the
  // interior came out exactly as bright as the room outside it — so the case
  // read as a frame painted onto the wall rather than as a box with a depth.
  //
  // The recess is what makes a bookshelf a bookshelf. Multiply is also the
  // right operator for this on a coloured print: it takes value away and
  // leaves hue alone, so the interior goes deep without going grey.
  const k = wallBacked ? 0.8 : 1;
  const shade = (hex: string): string => mixHex(hex, '#ffffff', 1 - k);

  ctx.globalCompositeOperation = 'multiply';

  // 1. The horizontal rake: the key enters from the right, so the left of
  //    the case sits in thrown shadow (spines take keyTake 0.45 → 1.15 the
  //    same way). The far left is the reference's near-black recess.
  const rake = ctx.createLinearGradient(0, 0, w, 0);
  rake.addColorStop(0, shade('#160f08'));
  rake.addColorStop(0.38, shade('#382c20'));
  rake.addColorStop(0.72, shade('#6b5f4e'));
  rake.addColorStop(1, shade('#b8a992'));
  ctx.fillStyle = rake;
  ctx.fillRect(0, 0, w, h);

  // 2. Vertical falloff: the plank above throws the top into shadow, the
  //    middle catches what light gets in, and the bottom quarter sinks into
  //    the contact band behind the book tails — the near-black line the
  //    reference has at every shelf joint.
  const fall = ctx.createLinearGradient(0, 0, 0, h);
  fall.addColorStop(0, shade('#241a10'));
  fall.addColorStop(0.16, shade('#6b5f4c'));
  fall.addColorStop(0.42, shade('#d6cbb8'));
  fall.addColorStop(0.72, shade('#cfc3af'));
  fall.addColorStop(0.9, shade('#4c3f30'));
  fall.addColorStop(1, shade('#120c07'));
  ctx.fillStyle = fall;
  ctx.fillRect(0, 0, w, h);

  // 3. Side occlusion at the rails — asymmetric: the right rail catches the
  //    key, the left rail swallows it.
  const aoW = 64;
  const sides: ReadonlyArray<readonly [number, number, string]> = [
    [0, aoW, shade('#1f150c')],
    [w, w - aoW, shade('#4e4132')],
  ];
  for (const [x0, x1, c] of sides) {
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, c);
    g.addColorStop(1, '#ffffff');
    ctx.fillStyle = g;
    ctx.fillRect(Math.min(x0, x1), 0, aoW, h);
  }

  // 4. The warm key itself, washing in from the upper right. Screen lifts
  //    the lit corner toward the golden hour without crushing the boards.
  ctx.globalCompositeOperation = 'screen';
  const wash = ctx.createLinearGradient(w, 0, w * 0.22, h * 0.62);
  const washA = wallBacked ? 0.34 : 0.42;
  wash.addColorStop(0, `rgba(255, 215, 154, ${washA})`);
  wash.addColorStop(0.45, `rgba(255, 208, 150, ${washA * 0.4})`);
  wash.addColorStop(1, 'rgba(255, 208, 150, 0)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);

  ctx.restore();
}

/* ================================= plate ================================= */

/**
 * Render a floor label plate at the current origin, `spec.w Ã— spec.h`.
 * All six materials accept the same `label` string; the plate decides how
 * that label is written (engraved, fired, burnt, inked, chalked, stencilled).
 */
export function renderPlate(
  ctx: Ctx2D,
  spec: PlateSpec,
  label: string,
  seed: number,
  theme?: LibraryTheme,
): void {
  const rnd = mulberry32(seed >>> 0);
  const { w, h, radius } = spec;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Contact shadow â€” plates sit proud of the timber.
  ctx.fillStyle = 'rgba(20, 14, 8, 0.34)';
  roundRect(ctx, 1.5, 2.5, w, h, radius);
  ctx.fill();

  switch (spec.kind) {
    case 'brass': {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, mixHex(spec.body, '#fff3c8', 0.55));
      g.addColorStop(0.28, spec.body);
      g.addColorStop(0.52, mixHex(spec.body, '#ffffff', 0.35));
      g.addColorStop(1, spec.bodyDark);
      ctx.fillStyle = g;
      roundRect(ctx, 0, 0, w, h, radius);
      ctx.fill();
      // Engine-turned lustre: fine horizontal polish lines.
      ctx.strokeStyle = 'rgba(255, 250, 214, 0.16)';
      ctx.lineWidth = 0.6;
      for (let y = 2; y < h; y += 2.4) {
        ctx.beginPath();
        ctx.moveTo(2, y);
        ctx.lineTo(w - 2, y + (rnd() * 2 - 1) * 0.6);
        ctx.stroke();
      }
      // Patina in the corners.
      for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]] as const) {
        const pg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 14);
        pg.addColorStop(0, 'rgba(72, 62, 22, 0.32)');
        pg.addColorStop(1, 'rgba(72, 62, 22, 0)');
        ctx.fillStyle = pg;
        roundRect(ctx, 0, 0, w, h, radius);
        ctx.fill();
      }
      // Engraved double rule.
      ctx.strokeStyle = 'rgba(70, 52, 12, 0.5)';
      ctx.lineWidth = 0.9;
      roundRect(ctx, 3, 3, w - 6, h - 6, Math.max(1, radius - 1));
      ctx.stroke();
      break;
    }
    case 'enamel': {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.5, spec.body);
      g.addColorStop(1, spec.bodyDark);
      ctx.fillStyle = g;
      roundRect(ctx, 0, 0, w, h, radius);
      ctx.fill();
      // Fired border stripe.
      ctx.strokeStyle = spec.ink;
      ctx.lineWidth = 2;
      roundRect(ctx, 3.5, 3.5, w - 7, h - 7, Math.max(1, radius - 2));
      ctx.stroke();
      // Glossy sweep.
      const gl = ctx.createLinearGradient(0, 0, w * 0.7, h);
      gl.addColorStop(0, 'rgba(255, 255, 255, 0.5)');
      gl.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = gl;
      roundRect(ctx, 0, 0, w, h, radius);
      ctx.fill();
      // Enamel chips: dark specks where the glaze has flaked to the iron.
      for (let i = 0; i < 5; i++) {
        const cx = rnd() * w;
        const cy = rnd() < 0.5 ? 1.5 + rnd() * 2 : h - 1.5 - rnd() * 2;
        ctx.fillStyle = 'rgba(56, 52, 46, 0.6)';
        ctx.beginPath();
        ctx.ellipse(cx, cy, 1 + rnd() * 2, 0.8 + rnd(), rnd(), 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'wood-burnt': {
      // A slice of timber; `burn` decides scorched pyrography vs a clean
      // pale plaque (the pavilion's little wooden name tags).
      ctx.save();
      roundRect(ctx, 0, 0, w, h, radius);
      ctx.clip();
      paintWood(
        ctx,
        theme
          ? { ...theme.wood, light: spec.body, dark: spec.bodyDark, paint: undefined }
          : {
              light: spec.body,
              dark: spec.bodyDark,
              grain: 'straight',
              ringFreq: 3,
              ringGamma: 1.4,
              along: 0.01,
              across: 0.06,
              knots: 0,
              streaks: 6,
              contrast: 0.8,
              finish: 'raw',
              sheen: 0.2,
            },
        w,
        h,
        { seed: seed ^ 0x71a7, direction: 'horizontal', knots: 0, bare: true },
      );
      if (spec.burn > 0.05) {
        // Scorched rim from the pyrography iron.
        const g = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, w * 0.62);
        g.addColorStop(0, 'rgba(60, 34, 14, 0)');
        g.addColorStop(1, `rgba(42, 24, 10, ${0.5 * spec.burn})`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.restore();
      ctx.strokeStyle = spec.burn > 0.05 ? 'rgba(38, 22, 8, 0.7)' : 'rgba(120, 100, 74, 0.6)';
      ctx.lineWidth = 1.2;
      roundRect(ctx, 1, 1, w - 2, h - 2, radius);
      ctx.stroke();
      if (spec.burn <= 0.05) {
        // A clean nafuda plaque: an incised keyline, a chamfered arris and a
        // pierced hole at each end for the cord. Without these it is a label,
        // not a piece of joinery.
        ctx.strokeStyle = 'rgba(120, 100, 74, 0.42)';
        ctx.lineWidth = 0.9;
        roundRect(ctx, 4.5, 4.5, w - 9, h - 9, Math.max(0.5, radius - 1));
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255, 250, 238, 0.5)';
        ctx.beginPath();
        ctx.moveTo(2, 2.4);
        ctx.lineTo(w - 2, 2.4);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(96, 80, 58, 0.35)';
        ctx.beginPath();
        ctx.moveTo(2, h - 2.4);
        ctx.lineTo(w - 2, h - 2.4);
        ctx.stroke();
        for (const hx of [5.5, w - 5.5]) {
          ctx.fillStyle = 'rgba(88, 72, 52, 0.5)';
          ctx.beginPath();
          ctx.ellipse(hx, h / 2, 1.5, 2.1, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 250, 238, 0.4)';
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }
      break;
    }
    case 'paper-tag': {
      // Torn manila tag with a punched eyelet and a loop of string.
      ctx.fillStyle = spec.body;
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(w, 0.6);
      ctx.lineTo(w - 0.8, h);
      ctx.lineTo(2, h - 1);
      ctx.closePath();
      ctx.fill();
      // Fibre edge.
      ctx.strokeStyle = spec.bodyDark;
      ctx.lineWidth = 1;
      for (let i = 0; i < 26; i++) {
        const t = i / 26;
        ctx.beginPath();
        ctx.moveTo(2 + t * (w - 3), h - 1 - t);
        ctx.lineTo(2 + t * (w - 3) + (rnd() * 2 - 1), h + 0.6);
        ctx.stroke();
      }
      // Soft foxing stains.
      for (let i = 0; i < 4; i++) {
        const g = ctx.createRadialGradient(rnd() * w, rnd() * h, 0, rnd() * w, rnd() * h, 12);
        g.addColorStop(0, 'rgba(176, 138, 90, 0.16)');
        g.addColorStop(1, 'rgba(176, 138, 90, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      // Eyelet + string.
      ctx.fillStyle = 'rgba(196, 176, 140, 1)';
      ctx.beginPath();
      ctx.arc(9, h / 2, 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(90, 70, 46, 0.85)';
      ctx.beginPath();
      ctx.arc(9, h / 2, 2.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(150, 122, 86, 0.9)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(9, h / 2 - 2);
      ctx.quadraticCurveTo(-4, h / 2 - 12, -12, h / 2 - 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(120, 96, 64, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(10, 0.6);
      ctx.lineTo(w - 0.5, 1.2);
      ctx.stroke();
      break;
    }
    case 'slate': {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, mixHex(spec.body, '#ffffff', 0.16));
      g.addColorStop(0.5, spec.body);
      g.addColorStop(1, spec.bodyDark);
      ctx.fillStyle = g;
      // Riven edge: an irregular polygon, not a rectangle.
      ctx.beginPath();
      const pts = 16;
      for (let i = 0; i <= pts; i++) {
        const t = i / pts;
        const a = t * Math.PI * 2;
        const rx = w / 2 + Math.cos(a) * (w / 2 - 1) * (0.96 + rnd() * 0.06);
        const ry = h / 2 + Math.sin(a) * (h / 2 - 1) * (0.9 + rnd() * 0.16);
        if (i === 0) ctx.moveTo(rx, ry);
        else ctx.lineTo(rx, ry);
      }
      ctx.closePath();
      ctx.fill();
      // Cleavage planes: pale flecks along the split.
      ctx.strokeStyle = 'rgba(220, 228, 240, 0.14)';
      ctx.lineWidth = 0.7;
      for (let i = 0; i < 8; i++) {
        const y = rnd() * h;
        ctx.beginPath();
        ctx.moveTo(2, y);
        ctx.lineTo(w - 2, y + (rnd() * 2 - 1) * 2);
        ctx.stroke();
      }
      break;
    }
    case 'tin': {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, mixHex(spec.body, '#ffffff', 0.4));
      g.addColorStop(0.35, spec.body);
      g.addColorStop(0.62, mixHex(spec.body, '#ffffff', 0.2));
      g.addColorStop(1, spec.bodyDark);
      ctx.fillStyle = g;
      roundRect(ctx, 0, 0, w, h, radius);
      ctx.fill();
      // Dents: soft dark/light lens pairs.
      for (let i = 0; i < 6; i++) {
        const cx = 4 + rnd() * (w - 8);
        const cy = 3 + rnd() * (h - 6);
        const r = 3 + rnd() * 6;
        const dg = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
        dg.addColorStop(0, 'rgba(255, 255, 255, 0.24)');
        dg.addColorStop(0.6, 'rgba(0, 0, 0, 0.12)');
        dg.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = dg;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      // Rust creeping in from the edges.
      for (let i = 0; i < 5; i++) {
        const cx = rnd() * w;
        const cy = rnd() < 0.5 ? 0 : h;
        const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 8 + rnd() * 8);
        rg.addColorStop(0, 'rgba(150, 84, 40, 0.42)');
        rg.addColorStop(1, 'rgba(150, 84, 40, 0)');
        ctx.fillStyle = rg;
        roundRect(ctx, 0, 0, w, h, radius);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(52, 46, 38, 0.6)';
      ctx.lineWidth = 1;
      roundRect(ctx, 0.5, 0.5, w - 1, h - 1, radius);
      ctx.stroke();
      break;
    }
    case 'painted-sign': {
      // A little painted garden sign: bright board, chamfered edge, a hand-
      // painted keyline and two screws.
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, mixHex(spec.body, '#ffffff', 0.32));
      g.addColorStop(0.55, spec.body);
      g.addColorStop(1, spec.bodyDark);
      ctx.fillStyle = g;
      roundRect(ctx, 0, 0, w, h, radius);
      ctx.fill();
      // Brush drag across the paint film.
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 1.4;
      for (let y = 3; y < h - 2; y += 3.4) {
        ctx.beginPath();
        ctx.moveTo(2, y);
        ctx.lineTo(w - 2, y + (rnd() * 2 - 1) * 0.8);
        ctx.stroke();
      }
      // Hand-painted cream keyline, deliberately not quite parallel.
      ctx.strokeStyle = 'rgba(255, 252, 232, 0.85)';
      ctx.lineWidth = 1.6;
      pencil(
        ctx,
        `M 5 4.5 L ${w - 5} 4 L ${w - 4.5} ${h - 4.5} L 5 ${h - 4} Z`,
        (seed ^ 0x5a17) >>> 0,
        0.6,
      );
      // A leaf sprig in each corner of the sign.
      ctx.fillStyle = 'rgba(255, 252, 232, 0.6)';
      for (const [lx, ly, dir] of [
        [9, h / 2, -1],
        [w - 9, h / 2, 1],
      ] as const) {
        for (const off of [-4, 4]) {
          ctx.save();
          ctx.translate(lx, ly + off);
          ctx.rotate(dir * 0.5 + off * 0.06);
          ctx.beginPath();
          ctx.ellipse(0, 0, 3.6, 1.6, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
      // Chamfer shadow along the bottom arris.
      ctx.fillStyle = 'rgba(20, 50, 24, 0.28)';
      ctx.fillRect(2, h - 2.4, w - 4, 2.4);
      break;
    }
    case 'led-panel': {
      // A machined bezel around a dark glass read-out, backlit from within.
      ctx.fillStyle = mixHex('#8fa2b4', '#2b3644', 0.4);
      roundRect(ctx, 0, 0, w, h, radius);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fillRect(2, 1.2, w - 4, 1.2);
      ctx.fillStyle = spec.body;
      roundRect(ctx, 3, 3, w - 6, h - 6, Math.max(1, radius - 1));
      ctx.fill();
      // Glass: a dark field with a scanline texture and a cyan bloom.
      const glow = ctx.createLinearGradient(0, 3, 0, h - 3);
      glow.addColorStop(0, hexAlpha(parseHexToHex(spec.ink), 0.3));
      glow.addColorStop(0.5, hexAlpha(parseHexToHex(spec.ink), 0.1));
      glow.addColorStop(1, hexAlpha(parseHexToHex(spec.ink), 0.26));
      ctx.fillStyle = glow;
      ctx.fillRect(3, 3, w - 6, h - 6);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      for (let y = 4; y < h - 3; y += 3) ctx.fillRect(3, y, w - 6, 1);
      // Status pip.
      ctx.fillStyle = 'rgba(120, 255, 170, 0.95)';
      ctx.beginPath();
      ctx.arc(w - 8, h - 7, 1.8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'amber-stone': {
      // A polished amber cabochon in a bronze bezel, with an inclusion.
      ctx.fillStyle = '#9a6a22';
      roundRect(ctx, 0, 0, w, h, radius);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 224, 150, 0.5)';
      ctx.fillRect(3, 1.4, w - 6, 1.2);
      const g = ctx.createRadialGradient(w * 0.36, h * 0.3, 2, w * 0.5, h * 0.55, w * 0.62);
      g.addColorStop(0, mixHex(spec.body, '#fff0c0', 0.65));
      g.addColorStop(0.55, spec.body);
      g.addColorStop(1, spec.bodyDark);
      ctx.fillStyle = g;
      roundRect(ctx, 3, 3, w - 6, h - 6, Math.max(2, radius - 2));
      ctx.fill();
      // Flow lines and bubbles inside the resin.
      ctx.strokeStyle = 'rgba(255, 236, 176, 0.4)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const y = 6 + rnd() * (h - 12);
        ctx.beginPath();
        ctx.moveTo(5, y);
        ctx.quadraticCurveTo(w / 2, y + (rnd() * 2 - 1) * 5, w - 5, y + (rnd() * 2 - 1) * 3);
        ctx.stroke();
      }
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = 'rgba(90, 44, 8, 0.35)';
        ctx.beginPath();
        ctx.arc(6 + rnd() * (w - 12), 6 + rnd() * (h - 12), 0.7 + rnd() * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      // The inclusion: a tiny trapped insect, all legs and no detail.
      ctx.strokeStyle = 'rgba(58, 28, 4, 0.6)';
      ctx.lineWidth = 0.8;
      const ix = w - 16;
      const iy = h * 0.62;
      ctx.beginPath();
      ctx.ellipse(ix, iy, 2.4, 1.4, 0.4, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const a = -0.6 + i * 0.6;
        ctx.beginPath();
        ctx.moveTo(ix, iy);
        ctx.lineTo(ix + Math.cos(a) * 4.5, iy + Math.sin(a) * 4.5);
        ctx.moveTo(ix, iy);
        ctx.lineTo(ix - Math.cos(a) * 4.5, iy - Math.sin(a) * 3.5);
        ctx.stroke();
      }
      // Specular kiss.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.beginPath();
      ctx.ellipse(w * 0.3, h * 0.28, w * 0.12, h * 0.1, -0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'candy-wrapper': {
      // A boiled sweet in a twisted foil wrapper.
      for (const dir of [-1, 1]) {
        const ex = dir < 0 ? 0 : w;
        ctx.fillStyle = mixHex(spec.body, '#ffffff', 0.4);
        ctx.beginPath();
        ctx.moveTo(ex, h / 2);
        ctx.lineTo(ex + dir * 11, h / 2 - 8);
        ctx.lineTo(ex + dir * 9, h / 2);
        ctx.lineTo(ex + dir * 11, h / 2 + 8);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = hexAlpha(parseHexToHex(spec.bodyDark), 0.7);
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, mixHex(spec.body, '#ffffff', 0.5));
      g.addColorStop(0.45, spec.body);
      g.addColorStop(1, spec.bodyDark);
      ctx.fillStyle = g;
      roundRect(ctx, 0, 0, w, h, radius);
      ctx.fill();
      // Foil crinkle: vertical bright/dark creases.
      for (let x = 4; x < w - 3; x += 5 + rnd() * 4) {
        ctx.strokeStyle = rnd() < 0.5 ? 'rgba(255, 255, 255, 0.5)' : 'rgba(190, 120, 20, 0.3)';
        ctx.lineWidth = 0.8 + rnd();
        ctx.beginPath();
        ctx.moveTo(x, 2);
        ctx.lineTo(x + (rnd() * 2 - 1) * 2, h - 2);
        ctx.stroke();
      }
      // A pink stripe band across the wrapper, the way sweets are printed.
      ctx.fillStyle = 'rgba(255, 120, 176, 0.55)';
      ctx.fillRect(0, h * 0.16, w, 2.4);
      ctx.fillRect(0, h * 0.78, w, 2.4);
      ctx.strokeStyle = hexAlpha(parseHexToHex(spec.bodyDark), 0.55);
      ctx.lineWidth = 1;
      roundRect(ctx, 0.5, 0.5, w - 1, h - 1, radius);
      ctx.stroke();
      break;
    }
    case 'shell': {
      // A fluted scallop with a pearl lustre, ribs radiating from the hinge.
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, mixHex(spec.body, '#ffffff', 0.6));
      g.addColorStop(0.6, spec.body);
      g.addColorStop(1, spec.bodyDark);
      ctx.fillStyle = g;
      ctx.beginPath();
      const lobes = 7;
      ctx.moveTo(0, h * 0.72);
      for (let i = 0; i < lobes; i++) {
        const x0 = (i * w) / lobes;
        ctx.quadraticCurveTo(x0 + w / lobes / 2, -h * 0.16, x0 + w / lobes, h * 0.72);
      }
      ctx.quadraticCurveTo(w * 0.5, h * 1.2, 0, h * 0.72);
      ctx.closePath();
      ctx.fill();
      // Ribs.
      ctx.strokeStyle = hexAlpha(parseHexToHex(spec.bodyDark), 0.55);
      ctx.lineWidth = 1;
      for (let i = 0; i <= lobes; i++) {
        const x0 = (i * w) / lobes;
        ctx.beginPath();
        ctx.moveTo(w / 2, h * 0.98);
        ctx.quadraticCurveTo((w / 2 + x0) / 2, h * 0.4, x0, h * 0.18);
        ctx.stroke();
      }
      // Nacre: a cool sheen across the top third.
      const n = ctx.createLinearGradient(0, 0, w, h * 0.5);
      n.addColorStop(0, 'rgba(214, 250, 255, 0.5)');
      n.addColorStop(0.5, 'rgba(255, 226, 244, 0.24)');
      n.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = n;
      ctx.fillRect(0, 0, w, h);
      break;
    }
    case 'neon': {
      // A dark plate with the label written in neon tube; the glow spills onto
      // the timber, so the plate is drawn a little larger than its body.
      const bloom = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w * 0.6);
      bloom.addColorStop(0, hexAlpha(parseHexToHex(spec.ink), 0.34));
      bloom.addColorStop(1, hexAlpha(parseHexToHex(spec.ink), 0));
      ctx.fillStyle = bloom;
      ctx.fillRect(-w * 0.1, -h * 0.4, w * 1.2, h * 1.8);
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, mixHex(spec.body, '#5a4fb0', 0.4));
      g.addColorStop(1, spec.bodyDark);
      ctx.fillStyle = g;
      roundRect(ctx, 0, 0, w, h, radius);
      ctx.fill();
      // Star specks inside the plate.
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = rnd() < 0.3 ? 'rgba(255, 140, 220, 0.7)' : 'rgba(220, 240, 255, 0.6)';
        ctx.beginPath();
        ctx.arc(2 + rnd() * (w - 4), 2 + rnd() * (h - 4), 0.4 + rnd() * 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = hexAlpha(parseHexToHex(spec.ink), 0.7);
      ctx.lineWidth = 1.4;
      roundRect(ctx, 2, 2, w - 4, h - 4, Math.max(1, radius - 1));
      ctx.stroke();
      break;
    }
  }

  // --- the label ----------------------------------------------------------
  // … by escape, not by literal: this file has been through a CP1252
  // round-trip once already and a mangled ellipsis is visible on every plate.
  const text = label.length > 20 ? `${label.slice(0, 19)}…` : label;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${spec.fontSize}px ${spec.font}`;
  const tx = spec.kind === 'paper-tag' ? w / 2 + 5 : w / 2;
  const ty = h / 2 + 1;
  if (spec.kind === 'brass') {
    // Engraved: a dark cut with a bright burr on the lower edge.
    ctx.fillStyle = spec.ink;
    ctx.fillText(text, tx, ty);
    ctx.fillStyle = 'rgba(255, 246, 206, 0.5)';
    ctx.fillText(text, tx, ty + 1);
  } else if (spec.kind === 'slate') {
    // Chalked: soft, slightly scratchy.
    ctx.fillStyle = 'rgba(10, 12, 18, 0.5)';
    ctx.fillText(text, tx, ty + 1);
    ctx.fillStyle = spec.ink;
    ctx.fillText(text, tx, ty);
  } else if (spec.kind === 'wood-burnt' && spec.burn > 0.05) {
    // Burnt: dark core with a scorch halo.
    ctx.save();
    ctx.fillStyle = 'rgba(90, 52, 20, 0.4)';
    ctx.fillText(text, tx + 0.8, ty + 0.8);
    ctx.fillStyle = spec.ink;
    ctx.fillText(text, tx, ty);
    ctx.restore();
  } else if (spec.kind === 'led-panel' || spec.kind === 'neon') {
    // Emissive type: a wide soft bloom, a saturated body, a hot white core.
    const { r: lr, g: lg, b: lb } = parseHex(spec.ink);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = `rgba(${lr}, ${lg}, ${lb}, 1)`;
    for (const spread of [3, 1.8]) {
      ctx.save();
      ctx.translate(tx, ty);
      ctx.scale(1 + spread / 60, 1 + spread / 22);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
    ctx.fillStyle = spec.ink;
    ctx.fillText(text, tx, ty);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillText(text, tx, ty - 0.4);
  } else if (spec.kind === 'painted-sign') {
    // Hand-painted: a soft drop under the letter and a slightly wet edge.
    ctx.fillStyle = 'rgba(18, 60, 26, 0.4)';
    ctx.fillText(text, tx + 0.9, ty + 1.2);
    ctx.fillStyle = spec.ink;
    ctx.fillText(text, tx, ty);
  } else if (spec.kind === 'tin') {
    // Stencilled: hard-edged with a slight ink starve.
    ctx.fillStyle = spec.ink;
    ctx.fillText(text, tx, ty);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 5, 0.8);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  } else {
    ctx.fillStyle = spec.ink;
    ctx.fillText(text, tx, ty);
  }

  // --- fixings ------------------------------------------------------------
  const fix = (x: number, y: number): void => {
    switch (spec.fixing) {
      case 'screws': {
        const g = ctx.createRadialGradient(x - 1, y - 1, 0, x, y, 3);
        g.addColorStop(0, 'rgba(255, 246, 206, 0.9)');
        g.addColorStop(1, 'rgba(90, 68, 20, 0.9)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(40, 28, 8, 0.8)';
        ctx.lineWidth = 0.9;
        const a = rnd() * Math.PI;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(a) * 2, y - Math.sin(a) * 2);
        ctx.lineTo(x + Math.cos(a) * 2, y + Math.sin(a) * 2);
        ctx.stroke();
        break;
      }
      case 'rivets': {
        const g = ctx.createRadialGradient(x - 1, y - 1, 0, x, y, 3);
        g.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
        g.addColorStop(1, 'rgba(90, 96, 90, 0.9)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'nails': {
        ctx.fillStyle = 'rgba(60, 54, 46, 0.9)';
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rnd());
        ctx.fillRect(-1.8, -1.8, 3.6, 3.6);
        ctx.restore();
        break;
      }
      default:
        break;
    }
  };
  if (spec.fixing !== 'none' && spec.fixing !== 'string') {
    fix(6, 5.5);
    fix(w - 6, 5.5);
    fix(6, h - 5.5);
    fix(w - 6, h - 5.5);
  }
  ctx.restore();
}

/* ================================ lighting =============================== */

/**
 * Composite the room's light rig over a rendered case: ambient cast, pools,
 * dust shafts, rim light and vignette. `phase` (0â€“1) walks the very slow
 * drift/flicker cycle â€” bake a single phase for the shelf, or a handful of
 * phases if a caller wants to cross-fade.
 */
export function applyLighting(
  ctx: Ctx2D,
  light: LightSpec,
  w: number,
  h: number,
  seed: number,
  phase = 0,
): void {
  const rnd = mulberry32(seed >>> 0);
  const long = Math.max(w, h);
  ctx.save();

  // 1. Ambient colour cast â€” the single biggest "this is a different room"
  //    lever, so it goes down first and everything else lights on top of it.
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = light.ambient.amount;
  ctx.fillStyle = light.ambient.colour;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;

  // 2. Pools.
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < light.pools.length; i++) {
    const p = light.pools[i]!;
    const drift = Math.sin(phase * Math.PI * 2 + i) * p.drift;
    const flick = light.flicker
      ? 1 - light.flicker * 0.35 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2 * 7 + i * 2.3))
      : 1;
    const cx = p.x * w + drift;
    const cy = p.y * h;
    const r = p.radius * long;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    const { r: pr, g: pg, b: pb } = parseHex(p.colour);
    g.addColorStop(0, `rgba(${pr}, ${pg}, ${pb}, ${clamp(p.intensity * flick, 0, 1)})`);
    g.addColorStop(0.45, `rgba(${pr}, ${pg}, ${pb}, ${clamp(p.intensity * flick * 0.35, 0, 1)})`);
    g.addColorStop(1, `rgba(${pr}, ${pg}, ${pb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }

  // 3. Dust shafts: soft cones falling from each pool (attic).
  if (light.shafts) {
    for (let i = 0; i < light.pools.length; i++) {
      const p = light.pools[i]!;
      const cx = p.x * w;
      const cy = p.y * h;
      const spread = p.radius * long * 0.8;
      const g = ctx.createLinearGradient(cx, cy, cx + spread * 0.35, h);
      const { r: pr, g: pg, b: pb } = parseHex(p.colour);
      g.addColorStop(0, `rgba(${pr}, ${pg}, ${pb}, ${p.intensity * 0.28})`);
      g.addColorStop(1, `rgba(${pr}, ${pg}, ${pb}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx - spread * 0.16, cy);
      ctx.lineTo(cx + spread * 0.16, cy);
      ctx.lineTo(cx + spread * 0.9, h);
      ctx.lineTo(cx - spread * 0.3, h);
      ctx.closePath();
      ctx.fill();
    }
  }

  // 4. Rim light along the top and left arrises.
  if (light.rim) {
    const { colour, width, intensity } = light.rim;
    const { r: rr, g: rg, b: rb } = parseHex(colour);
    const topG = ctx.createLinearGradient(0, 0, 0, width * 4);
    topG.addColorStop(0, `rgba(${rr}, ${rg}, ${rb}, ${intensity})`);
    topG.addColorStop(1, `rgba(${rr}, ${rg}, ${rb}, 0)`);
    ctx.fillStyle = topG;
    ctx.fillRect(0, 0, w, width * 4);
    const leftG = ctx.createLinearGradient(0, 0, width * 4, 0);
    leftG.addColorStop(0, `rgba(${rr}, ${rg}, ${rb}, ${intensity * 0.8})`);
    leftG.addColorStop(1, `rgba(${rr}, ${rg}, ${rb}, 0)`);
    ctx.fillStyle = leftG;
    ctx.fillRect(0, 0, width * 4, h);
  }

  // 5. Vignette.
  ctx.globalCompositeOperation = 'multiply';
  const { r: vr, g: vg, b: vb } = parseHex(light.vignette.colour);
  const v = ctx.createRadialGradient(w * 0.45, h * 0.4, Math.min(w, h) * 0.2, w * 0.5, h * 0.5, long * 0.78);
  v.addColorStop(0, 'rgba(255, 255, 255, 1)');
  v.addColorStop(0.55, `rgba(${Math.round(255 - (255 - vr) * light.vignette.amount * 0.35)}, ${Math.round(255 - (255 - vg) * light.vignette.amount * 0.35)}, ${Math.round(255 - (255 - vb) * light.vignette.amount * 0.35)}, 1)`);
  v.addColorStop(1, `rgba(${Math.round(255 - (255 - vr) * light.vignette.amount)}, ${Math.round(255 - (255 - vg) * light.vignette.amount)}, ${Math.round(255 - (255 - vb) * light.vignette.amount)}, 1)`);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  void rnd;
}

/* ============================ composite section ========================== */

export interface CaseSectionOptions {
  /** Text for the floor plate. */
  label?: string;
  /** Draw stand-in book blocks in the theme's pigment ramp. Default true. */
  books?: boolean;
  /** Apply the light rig. Default true. */
  light?: boolean;
  /** Wall treatment; defaults to the room's own (`theme.backdrops[0]`). */
  backdrop?: BackdropId;
  /** Studio wallpaper override (pattern x colourway). */
  wallpaper?: WallpaperSpec;
  /** Drift/flicker phase, 0â€“1. */
  phase?: number;
}

/**
 * One complete case section â€” wall behind, crown, both side rails, back
 * panel, a shelf with its plate and under-shelf detail, all lit by the room's
 * rig. This is the specimen-board renderer AND the studio's theme-picker
 * thumbnail renderer, so what a user previews is literally the room's art.
 */
export function renderCaseSection(
  ctx: Ctx2D,
  theme: LibraryTheme,
  w: number,
  h: number,
  seed: number,
  opts: CaseSectionOptions = {},
): void {
  const label = opts.label ?? theme.name;
  const showBooks = opts.books ?? true;
  const wp = opts.wallpaper ?? theme.wallpaper;
  const railW = theme.rail.width;
  const crownH = theme.crown.height;
  const plankH = THEMED_PLANK_HEIGHT;
  const shelfY = Math.round(h * 0.68);

  ctx.save();

  // --- 1. the wall behind the case ---------------------------------------
  renderBackdrop(ctx, theme, opts.backdrop ?? theme.backdrops[0], w, h, {
    seed: seed ^ 0x77,
    floorH: h,
    wallpaper: wp,
  });

  // Case drop shadow onto the wall.
  const caseX = 14;
  const caseW = w - 28;
  const shadow = ctx.createLinearGradient(caseX - 16, 0, caseX + 6, 0);
  shadow.addColorStop(0, 'rgba(20, 14, 8, 0)');
  shadow.addColorStop(1, 'rgba(20, 14, 8, 0.34)');
  ctx.fillStyle = shadow;
  ctx.fillRect(caseX - 16, 6, 22, h);
  ctx.fillStyle = 'rgba(20, 14, 8, 0.28)';
  ctx.fillRect(caseX + caseW, 8, 14, h);

  // --- 2. back panel ------------------------------------------------------
  ctx.save();
  ctx.translate(caseX + railW, crownH);
  renderBackPanel(ctx, theme, caseW - railW * 2, h - crownH, seed ^ 0xbeef, wp);
  ctx.restore();

  // --- 3. books (stand-ins in the theme's pigment ramp) -------------------
  if (showBooks) {
    drawBookHints(ctx, theme, caseX + railW + 6, shelfY, caseW - railW * 2 - 12, shelfY - crownH - 14, seed);
  }

  // --- 4. under-plank shadow ---------------------------------------------
  const sg = ctx.createLinearGradient(0, crownH, 0, crownH + 26);
  sg.addColorStop(0, 'rgba(30, 22, 14, 0.44)');
  sg.addColorStop(1, 'rgba(30, 22, 14, 0)');
  ctx.fillStyle = sg;
  ctx.fillRect(caseX + railW, crownH, caseW - railW * 2, 26);

  // --- 5. the shelf plank -------------------------------------------------
  ctx.save();
  ctx.translate(caseX + railW, shelfY);
  renderPlank(ctx, theme, caseW - railW * 2, plankH, seed ^ 0x9147);
  ctx.restore();
  // Under-shelf detail sits below the plank.
  ctx.save();
  ctx.translate(caseX + railW, shelfY + plankH);
  renderShelfDetail(ctx, theme, caseW - railW * 2, 34, seed ^ 0xd7a);
  ctx.restore();

  // --- 6. side rails ------------------------------------------------------
  for (const [rx, mirror] of [
    [caseX, false],
    [caseX + caseW - railW, true],
  ] as const) {
    ctx.save();
    ctx.translate(rx, crownH);
    if (mirror) {
      ctx.translate(railW, 0);
      ctx.scale(-1, 1);
    }
    renderRail(ctx, theme, railW, h - crownH, seed ^ (mirror ? 0x2222 : 0x1111));
    ctx.restore();
  }

  // --- 7. crown -----------------------------------------------------------
  ctx.save();
  ctx.translate(caseX - theme.crown.overhang, 0);
  renderCrown(ctx, theme, caseW + theme.crown.overhang * 2, crownH, seed ^ 0xc0a1);
  ctx.restore();

  // --- 8. the floor plate -------------------------------------------------
  ctx.save();
  ctx.translate(
    caseX + caseW / 2 - theme.plate.w / 2,
    shelfY + plankH / 2 - theme.plate.h / 2 + (theme.shelfDetail === 'drawers' ? -1 : 0),
  );
  renderPlate(ctx, theme.plate, label, seed ^ 0x91a7, theme);
  ctx.restore();

  // --- 9. light rig -------------------------------------------------------
  if (opts.light ?? true) applyLighting(ctx, theme.light, w, h, seed, opts.phase ?? 0);

  ctx.restore();
}

/**
 * Stand-in book blocks in the theme's pigment ramp â€” enough to show how the
 * room's spine bias reads against its own wood and wall. The real shelf draws
 * spines.ts sprites here; this is only for specimen boards and picker cards.
 */
function drawBookHints(
  ctx: Ctx2D,
  theme: LibraryTheme,
  x: number,
  baseY: number,
  w: number,
  maxH: number,
  seed: number,
): void {
  const rnd = mulberry32((seed ^ 0xb00c) >>> 0);
  const pigments = theme.spineDefaults.pigments;
  ctx.save();
  let cx = x + 6;
  let i = 0;
  while (cx < x + w - 20) {
    const bw = 16 + rnd() * 16;
    const bh = maxH * (0.62 + rnd() * 0.32);
    const lean = (rnd() * 2 - 1) * 0.03;
    const colour = pigments[i % pigments.length] ?? '#7a5c3a';
    ctx.save();
    ctx.translate(cx, baseY);
    ctx.rotate(lean);
    const g = ctx.createLinearGradient(0, 0, bw, 0);
    g.addColorStop(0, mixHex(colour, '#000000', 0.35));
    g.addColorStop(0.3, colour);
    g.addColorStop(0.75, mixHex(colour, '#ffffff', 0.14));
    g.addColorStop(1, mixHex(colour, '#000000', 0.42));
    ctx.fillStyle = g;
    ctx.fillRect(0, -bh, bw, bh);
    // Head/tail bands + a gilt rule for rooms that gild.
    ctx.fillStyle = 'rgba(20, 14, 8, 0.4)';
    ctx.fillRect(0, -bh, bw, 1.5);
    if (rnd() < theme.spineDefaults.gilt) {
      ctx.fillStyle = 'rgba(216, 178, 88, 0.7)';
      ctx.fillRect(2, -bh * 0.78, bw - 4, 1.4);
      ctx.fillRect(2, -bh * 0.28, bw - 4, 1.4);
    }
    if (rnd() < theme.spineDefaults.bands) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(0, -bh * 0.6, bw, 3);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
      ctx.fillRect(0, -bh * 0.6 + 3, bw, 1.5);
    }
    ctx.strokeStyle = 'rgba(28, 20, 12, 0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, -bh + 0.5, bw - 1, bh - 1);
    ctx.restore();
    cx += bw + 1 + rnd() * 3;
    i++;
  }
  ctx.restore();
}

/* ============================== baked wrappers =========================== */

function bakePart(
  key: string,
  w: number,
  h: number,
  dpr: number,
  draw: (ctx: Ctx2D) => void,
): Promise<ImageBitmap> {
  // `mat1`: the generated material library changed how every timber and every
  // papered wall is painted, so bakes persisted by the previous recipe are no
  // longer valid. Bumping the key here rather than THEME_RECIPE_VERSION keeps
  // the invalidation local to the parts this module owns.
  return bakeCached(`theme${THEME_RECIPE_VERSION}|mat2|${key}`, dpr, async () => {
    // Case parts are big, few, and cached to disk — a part baked before the
    // WebPs land would keep its material-less look forever. They are also
    // baked off a promise already, so waiting costs nothing but the first
    // frame of the very first run.
    await whenMaterialsReady();
    const canvas = makeCanvas(Math.ceil(w * dpr), Math.ceil(h * dpr)) as OffscreenCanvas;
    const ctx = get2d(canvas);
    ctx.scale(dpr, dpr);
    draw(ctx);
    return canvas;
  });
}

/** Bake the themed crown board. */
export function bakeThemedCrown(id: ThemeId, w: number, dpr: number): Promise<ImageBitmap> {
  const theme = getTheme(id);
  const h = theme.crown.height;
  return bakePart(`crown|${id}|${w}x${h}`, w, h, dpr, (ctx) =>
    renderCrown(ctx, theme, w, h, fnv1a(`${id}|crown|${w}`)),
  );
}

/** Bake one floor's themed side rail (draw mirrored on the right). */
export function bakeThemedRail(id: ThemeId, h: number, dpr: number): Promise<ImageBitmap> {
  const theme = getTheme(id);
  const w = theme.rail.width;
  return bakePart(`rail|${id}|${w}x${h}`, w, h, dpr, (ctx) =>
    renderRail(ctx, theme, w, h, fnv1a(`${id}|rail|${h}`)),
  );
}

/** Bake a themed shelf plank strip. */
export function bakeThemedPlank(id: ThemeId, w: number, dpr: number): Promise<ImageBitmap> {
  const theme = getTheme(id);
  const h = THEMED_PLANK_HEIGHT;
  return bakePart(`plank|${id}|${w}x${h}`, w, h, dpr, (ctx) =>
    renderPlank(ctx, theme, w, h, fnv1a(`${id}|plank|${w}`)),
  );
}

/** Bake a themed case back panel for one book zone. */
export function bakeThemedBackPanel(
  id: ThemeId,
  w: number,
  h: number,
  dpr: number,
): Promise<ImageBitmap> {
  const theme = getTheme(id);
  // `back-v2`: the painterly rebuild's recess light supersedes the old flat
  // AO — bump the part key so persisted v1 bakes are not reused (kept local
  // so the shared THEME_RECIPE_VERSION is untouched).
  return bakePart(`back-v2|${id}|${w}x${h}`, w, h, dpr, (ctx) =>
    renderBackPanel(ctx, theme, w, h, fnv1a(`${id}|back|${w}x${h}`)),
  );
}

/** Bake a themed floor label plate for a given label string. */
export function bakeThemedPlate(id: ThemeId, label: string, dpr: number): Promise<ImageBitmap> {
  const theme = getTheme(id);
  const { w, h } = theme.plate;
  // Paper tags overhang their box (string + torn edge) â€” pad the raster.
  const padX = theme.plate.kind === 'paper-tag' ? 16 : 4;
  return bakePart(`plate|${id}|${label}|${w}x${h}`, w + padX * 2, h + 8, dpr, (ctx) => {
    ctx.translate(padX, 4);
    renderPlate(ctx, theme.plate, label, fnv1a(`${id}|plate|${label}`), theme);
  });
}

/**
 * Bake one floor-tall strip of the room's wall. Vertical features repeat on
 * `floorH`, so the caller tiles this strip up and across the world (a Pixi
 * TilingSprite over the whole wall is exactly right).
 */
export function bakeThemedBackdrop(
  id: ThemeId,
  backdrop: BackdropId,
  w: number,
  floorH: number,
  dpr: number,
  wallpaper?: WallpaperSpec,
): Promise<ImageBitmap> {
  const theme = getTheme(id);
  const wp = wallpaper ?? theme.wallpaper;
  return bakePart(
    `backdrop|${id}|${backdrop}|${wp.pattern}|${wp.colourway}|${w}x${floorH}`,
    w,
    floorH,
    dpr,
    (ctx) =>
      renderBackdrop(ctx, theme, backdrop, w, floorH, {
        seed: fnv1a(`${id}|${backdrop}|${w}`),
        floorH,
        wallpaper: wp,
      }),
  );
}

/** Bake the theme-picker thumbnail / specimen card. */
export function bakeThemeThumbnail(
  id: ThemeId,
  w: number,
  h: number,
  dpr: number,
  opts: { backdrop?: BackdropId; wallpaper?: WallpaperSpec } = {},
): Promise<ImageBitmap> {
  const theme = getTheme(id);
  const backdrop = opts.backdrop ?? theme.backdrops[0];
  const wp = opts.wallpaper ?? theme.wallpaper;
  return bakePart(
    `thumb|${id}|${backdrop}|${wp.pattern}|${wp.colourway}|${w}x${h}`,
    w,
    h,
    dpr,
    (ctx) =>
      renderCaseSection(ctx, theme, w, h, fnv1a(`${id}|thumb`), {
        label: theme.name,
        backdrop,
        wallpaper: wp,
      }),
  );
}
