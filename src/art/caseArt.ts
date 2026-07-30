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
import { getColourway, renderWallpaper } from './wallpaper';
import { hexAlpha, mixHex, paintWood, parseHex } from './wood';
import { doubleStroke } from './wobble';
import type { BackdropId, WallpaperSpec } from './themes';

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
  }
  ctx.restore();
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
  } else {
    ctx.rect(0, 0, w, h);
  }
  ctx.clip();

  paintWood(ctx, wood, w, h, { seed: seed ^ 0xc0a1, direction: 'horizontal', contrast: 0.95 });

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
  }
  ctx.restore(); // end silhouette clip

  // --- carving frieze -----------------------------------------------------
  const friezeH = Math.max(9, Math.min(15, h * 0.3));
  const friezeY =
    crown.profile === 'beam' || crown.profile === 'gable'
      ? h - friezeH - 4
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
  const cy = crown.profile === 'pediment' ? h * 0.3 : Math.max(10, friezeY - 12);
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
  paintWood(ctx, wood, w, h, { seed: seed ^ 0x9a11, direction: 'vertical', contrast: 0.9 });

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
  paintWood(ctx, wood, w, h, { seed: seed ^ 0x9147, direction: 'horizontal' });

  // Lit face: bright top lip fading to a dark under-edge.
  const face = ctx.createLinearGradient(0, 0, 0, h);
  face.addColorStop(0, 'rgba(255, 248, 232, 0.4)');
  face.addColorStop(0.22, 'rgba(255, 246, 228, 0.14)');
  face.addColorStop(0.75, 'rgba(255, 255, 255, 0)');
  face.addColorStop(1, 'rgba(50, 38, 26, 0.24)');
  ctx.fillStyle = face;
  ctx.fillRect(0, 0, w, h);

  // Front-edge profile — the same stock worked four different ways, which is
  // most of what tells one carpenter's shelf from another's at a glance.
  switch (rail.edge) {
    case 'rounded': {
      // Bullnose: light rolls over the top and dies under the belly.
      const g = ctx.createLinearGradient(0, 0, 0, h * 0.5);
      g.addColorStop(0, 'rgba(255, 252, 240, 0.42)');
      g.addColorStop(1, 'rgba(255, 252, 240, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h * 0.5);
      const u = ctx.createLinearGradient(0, h * 0.6, 0, h);
      u.addColorStop(0, 'rgba(46, 32, 18, 0)');
      u.addColorStop(1, 'rgba(46, 32, 18, 0.34)');
      ctx.fillStyle = u;
      ctx.fillRect(0, h * 0.6, w, h * 0.4);
      break;
    }
    case 'chamfer': {
      // A crisp 45 taken off the top arris: two flat tonal steps, no rolloff.
      ctx.fillStyle = 'rgba(255, 252, 244, 0.34)';
      ctx.fillRect(0, 0, w, h * 0.2);
      ctx.fillStyle = 'rgba(60, 46, 28, 0.16)';
      ctx.fillRect(0, h * 0.2, w, 1.6);
      ctx.fillStyle = 'rgba(48, 34, 20, 0.26)';
      ctx.fillRect(0, h - h * 0.16, w, h * 0.16);
      break;
    }
    case 'rough': {
      // Sawn and left: a ragged arris with torn fibres along the top edge.
      ctx.strokeStyle = 'rgba(28, 20, 12, 0.34)';
      ctx.lineWidth = 1;
      for (let sx = 0; sx < w; sx += 5 + rnd() * 9) {
        const d = rnd() * 2.6;
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx + 1 + rnd() * 3, d);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(24, 17, 10, 0.2)';
      ctx.fillRect(0, h - 5, w, 5);
      break;
    }
    default: {
      // Sharp: a hard bright arris with a fine quirk bead under it.
      ctx.fillStyle = 'rgba(255, 250, 236, 0.5)';
      ctx.fillRect(0, 0, w, 2);
      ctx.fillStyle = 'rgba(38, 26, 14, 0.3)';
      ctx.fillRect(0, h * 0.34, w, 1.6);
      ctx.fillStyle = 'rgba(255, 246, 222, 0.18)';
      ctx.fillRect(0, h * 0.34 + 1.6, w, 1);
      break;
    }
  }

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

  // Inlay pinstripe along the lip.
  if (rail.inlay !== 'none') {
    ctx.strokeStyle = rail.inlayColour;
    ctx.lineWidth = rail.inlay === 'painted-line' ? 2.4 : 1;
    ctx.beginPath();
    ctx.moveTo(12, 6.5);
    ctx.lineTo(w - 12, 6.5);
    ctx.stroke();
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
function paperWall(
  ctx: Ctx2D,
  wp: WallpaperSpec,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
): void {
  const size = wp.tile;
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
    // The room's own wall, seen straight through the carcass.
    paperWall(ctx, wp, 0, 0, w, h, seed);
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

  // Ambient occlusion where the panel meets the rails and the plank above.
  ctx.globalCompositeOperation = 'multiply';
  const aoW = 56;
  for (const [x0, x1] of [
    [0, aoW],
    [w, w - aoW],
  ] as const) {
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, '#8b8172');
    g.addColorStop(1, '#ffffff');
    ctx.fillStyle = g;
    ctx.fillRect(Math.min(x0, x1), 0, aoW, h);
  }
  const top = ctx.createLinearGradient(0, 0, 0, h);
  top.addColorStop(0, '#9d9384');
  top.addColorStop(0.35, '#ffffff');
  top.addColorStop(0.9, '#efe6d8');
  top.addColorStop(1, '#c0b3a0');
  ctx.fillStyle = top;
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
  }

  // --- the label ----------------------------------------------------------
  const text = label.length > 18 ? `${label.slice(0, 17)}â€¦` : label;
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
  return bakeCached(`theme${THEME_RECIPE_VERSION}|${key}`, dpr, async () => {
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
  return bakePart(`back|${id}|${w}x${h}`, w, h, dpr, (ctx) =>
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
