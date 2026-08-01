/**
 * tests/support/flatRaster.ts — a tiny software canvas, so the art can be gated.
 *
 * The suite runs in plain Node with no canvas package and none may be added, but
 * the questions worth asking about `art/bookDesign.ts` are all questions about
 * PIXELS: does a silhouette actually close, does a mark land inside the shape it
 * was tooled onto, is the band reserved for the title still bare after fifty
 * ornaments have been struck around it. None of those can be answered from the
 * call sequence — a recording context (the trick `art-themes.test.ts` uses to
 * prove a room repaints) says which colours were assigned, never where.
 *
 * So this is the smallest honest rasterizer that can run `drawBookSpine`:
 *
 *  - paths flattened to polygons (quadratics subdivided, ellipses polygonised),
 *  - filled by scanline with the nonzero rule, exactly as canvas does,
 *  - stroked by expanding every segment to a quad with a round join at each
 *    vertex — our vocabulary sets `lineJoin`/`lineCap` to `round` everywhere,
 *  - `clip()` kept as a per-pixel mask, saved and restored with the state,
 *  - `globalAlpha` composited source-over.
 *
 * It is NOT a canvas implementation. There is no antialiasing (a gate wants a
 * pixel to be one thing or the other), no transforms beyond translate/scale, no
 * text — `fillText` is a no-op, because every glyph in the app is drawn by
 * `spines.ts`, which is not what this file exists to gate.
 *
 * `encodePng` is here for the same reason: a specimen board written to disk and
 * LOOKED AT is how the fifty shapes were judged; the assertions only catch the
 * ones that are broken, never the ones that are ugly.
 */

import { deflateSync } from 'node:zlib';

/* -------------------------------------------------------------------------- *
 *                                  colours                                    *
 * -------------------------------------------------------------------------- */

export type RGB = readonly [number, number, number];

/** `#rrggbb` → channels. Anything else comes back mid-grey rather than throwing. */
export function parseColour(value: unknown): RGB {
  if (typeof value === 'string' && value.length === 7 && value[0] === '#') {
    const n = Number.parseInt(value.slice(1), 16);
    if (Number.isFinite(n)) return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return [128, 128, 128];
}

/* -------------------------------------------------------------------------- *
 *                                  geometry                                   *
 * -------------------------------------------------------------------------- */

interface Pt {
  x: number;
  y: number;
}

/** How finely a quadratic is chopped. Twenty-four is invisible at spine scale. */
const CURVE_STEPS = 16;

interface State {
  alpha: number;
  clip: Uint8Array | null;
  tx: number;
  ty: number;
  sx: number;
  sy: number;
}

export interface Raster {
  /** Duck-typed to the subset of CanvasRenderingContext2D the art uses. */
  ctx: unknown;
  width: number;
  height: number;
  /** RGB triples, row-major. */
  data: Uint8Array;
  /** The colour at a pixel; out of bounds reads as the background. */
  at(x: number, y: number): RGB;
  /** True when the pixel still shows the ground it was cleared to. */
  isGround(x: number, y: number): boolean;
}

/**
 * A canvas of `w × h`, cleared to `ground`.
 *
 * The ground is deliberately a colour the palette cannot produce (the gate
 * clears to magenta): "still showing the ground" is then exactly "nothing was
 * drawn here", with no chance of a legitimately drawn cream being mistaken for
 * a hole.
 */
export function createRaster(w: number, h: number, ground: string): Raster {
  const width = Math.max(1, Math.round(w));
  const height = Math.max(1, Math.round(h));
  const data = new Uint8Array(width * height * 3);
  const bg = parseColour(ground);
  for (let i = 0; i < width * height; i++) {
    data[i * 3] = bg[0];
    data[i * 3 + 1] = bg[1];
    data[i * 3 + 2] = bg[2];
  }

  let state: State = { alpha: 1, clip: null, tx: 0, ty: 0, sx: 1, sy: 1 };
  const stack: State[] = [];

  /** Subpaths of the path under construction, already flattened and mapped. */
  let subpaths: Pt[][] = [];
  let current: Pt[] | null = null;

  const map = (x: number, y: number): Pt => ({
    x: x * state.sx + state.tx,
    y: y * state.sy + state.ty,
  });

  /* ------------------------------ compositing ----------------------------- */

  const blend = (x: number, y: number, c: RGB, a: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (state.clip !== null && state.clip[i] === 0) return;
    const o = i * 3;
    if (a >= 1) {
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      return;
    }
    data[o] = Math.round(c[0] * a + (data[o] as number) * (1 - a));
    data[o + 1] = Math.round(c[1] * a + (data[o + 1] as number) * (1 - a));
    data[o + 2] = Math.round(c[2] * a + (data[o + 2] as number) * (1 - a));
  };

  /* -------------------------------- filling ------------------------------- */

  /**
   * Scanline fill with the nonzero winding rule.
   *
   * `paint` is called once per covered pixel rather than blending inline so the
   * same walk can build a clip mask.
   */
  const scan = (polys: readonly Pt[][], paint: (x: number, y: number) => void): void => {
    let top = Infinity;
    let bottom = -Infinity;
    for (const poly of polys) {
      for (const p of poly) {
        if (p.y < top) top = p.y;
        if (p.y > bottom) bottom = p.y;
      }
    }
    if (!Number.isFinite(top)) return;
    const y0 = Math.max(0, Math.floor(top));
    const y1 = Math.min(height - 1, Math.ceil(bottom));
    const xs: number[] = [];
    const dirs: number[] = [];

    for (let y = y0; y <= y1; y++) {
      const sy = y + 0.5;
      xs.length = 0;
      dirs.length = 0;
      for (const poly of polys) {
        const n = poly.length;
        if (n < 2) continue;
        for (let i = 0; i < n; i++) {
          const a = poly[i] as Pt;
          const b = poly[(i + 1) % n] as Pt;
          if (a.y === b.y) continue;
          if (sy < Math.min(a.y, b.y) || sy >= Math.max(a.y, b.y)) continue;
          xs.push(a.x + ((sy - a.y) / (b.y - a.y)) * (b.x - a.x));
          dirs.push(b.y > a.y ? 1 : -1);
        }
      }
      if (xs.length === 0) continue;
      const order = xs.map((_, i) => i).sort((i, j) => (xs[i] as number) - (xs[j] as number));
      let winding = 0;
      for (let k = 0; k < order.length - 1; k++) {
        winding += dirs[order[k] as number] as number;
        if (winding === 0) continue;
        const from = Math.max(0, Math.ceil((xs[order[k] as number] as number) - 0.5));
        const to = Math.min(width - 1, Math.floor((xs[order[k + 1] as number] as number) - 0.5));
        for (let x = from; x <= to; x++) paint(x, y);
      }
    }
  };

  const fillPolys = (polys: readonly Pt[][], colour: RGB, alpha: number): void => {
    if (alpha <= 0) return;
    scan(polys, (x, y) => blend(x, y, colour, alpha));
  };

  /* -------------------------------- stroking ------------------------------ */

  /** A round join/cap, as a dodecagon — indistinguishable from a disc here. */
  const disc = (c: Pt, r: number): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      out.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
    }
    return out;
  };

  const strokePolys = (colour: RGB, widthPx: number, alpha: number): void => {
    const r = Math.max(0.5, (widthPx * (Math.abs(state.sx) + Math.abs(state.sy))) / 2 / 2);
    for (const poly of subpaths) {
      if (poly.length === 1) {
        fillPolys([disc(poly[0] as Pt, r)], colour, alpha);
        continue;
      }
      for (let i = 0; i < poly.length - 1; i++) {
        const a = poly[i] as Pt;
        const b = poly[i + 1] as Pt;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len > 1e-6) {
          const nx = (-dy / len) * r;
          const ny = (dx / len) * r;
          fillPolys(
            [
              [
                { x: a.x + nx, y: a.y + ny },
                { x: b.x + nx, y: b.y + ny },
                { x: b.x - nx, y: b.y - ny },
                { x: a.x - nx, y: a.y - ny },
              ],
            ],
            colour,
            alpha,
          );
        }
        fillPolys([disc(a, r)], colour, alpha);
      }
      fillPolys([disc(poly[poly.length - 1] as Pt, r)], colour, alpha);
    }
  };

  /* ------------------------------- the context ---------------------------- */

  const ctx = {
    fillStyle: '#000000' as string,
    strokeStyle: '#000000' as string,
    lineWidth: 1,
    lineJoin: 'round',
    lineCap: 'round',
    font: '',
    textAlign: 'center',
    textBaseline: 'middle',

    get globalAlpha(): number {
      return state.alpha;
    },
    set globalAlpha(v: number) {
      state.alpha = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
    },

    save(): void {
      stack.push({ ...state });
    },
    restore(): void {
      const prev = stack.pop();
      if (prev !== undefined) state = prev;
    },
    translate(x: number, y: number): void {
      state.tx += x * state.sx;
      state.ty += y * state.sy;
    },
    scale(x: number, y: number): void {
      state.sx *= x;
      state.sy *= y;
    },

    beginPath(): void {
      subpaths = [];
      current = null;
    },
    closePath(): void {
      if (current !== null && current.length > 1) current.push({ ...(current[0] as Pt) });
    },
    moveTo(x: number, y: number): void {
      current = [map(x, y)];
      subpaths.push(current);
    },
    lineTo(x: number, y: number): void {
      if (current === null) {
        ctx.moveTo(x, y);
        return;
      }
      current.push(map(x, y));
    },
    quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
      if (current === null) {
        ctx.moveTo(x, y);
        return;
      }
      const p0 = current[current.length - 1] as Pt;
      const c = map(cx, cy);
      const p1 = map(x, y);
      for (let i = 1; i <= CURVE_STEPS; i++) {
        const t = i / CURVE_STEPS;
        const u = 1 - t;
        current.push({
          x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
          y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
        });
      }
    },
    bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
      if (current === null) {
        ctx.moveTo(x, y);
        return;
      }
      const p0 = current[current.length - 1] as Pt;
      const a = map(c1x, c1y);
      const b = map(c2x, c2y);
      const p1 = map(x, y);
      for (let i = 1; i <= CURVE_STEPS; i++) {
        const t = i / CURVE_STEPS;
        const u = 1 - t;
        current.push({
          x: u * u * u * p0.x + 3 * u * u * t * a.x + 3 * u * t * t * b.x + t * t * t * p1.x,
          y: u * u * u * p0.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y + t * t * t * p1.y,
        });
      }
    },
    rect(x: number, y: number, w2: number, h2: number): void {
      ctx.moveTo(x, y);
      ctx.lineTo(x + w2, y);
      ctx.lineTo(x + w2, y + h2);
      ctx.lineTo(x, y + h2);
      ctx.closePath();
    },
    arc(cx: number, cy: number, r: number, a0: number, a1: number): void {
      ctx.ellipse(cx, cy, r, r, 0, a0, a1);
    },
    ellipse(
      cx: number,
      cy: number,
      rx: number,
      ry: number,
      rot: number,
      a0: number,
      a1: number,
    ): void {
      const steps = 48;
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      for (let i = 0; i <= steps; i++) {
        const a = a0 + ((a1 - a0) * i) / steps;
        const px = Math.cos(a) * rx;
        const py = Math.sin(a) * ry;
        const x = cx + px * cos - py * sin;
        const y = cy + px * sin + py * cos;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    },

    fill(): void {
      fillPolys(subpaths, parseColour(ctx.fillStyle), state.alpha);
    },
    stroke(): void {
      strokePolys(parseColour(ctx.strokeStyle), ctx.lineWidth, state.alpha);
    },
    fillRect(x: number, y: number, w2: number, h2: number): void {
      ctx.beginPath();
      ctx.rect(x, y, w2, h2);
      ctx.fill();
    },
    clearRect(): void {
      /* nothing here clears */
    },
    clip(): void {
      const mask = new Uint8Array(width * height);
      scan(subpaths, (x, y) => {
        mask[y * width + x] = 1;
      });
      const prev = state.clip;
      if (prev !== null) for (let i = 0; i < mask.length; i++) if (prev[i] === 0) mask[i] = 0;
      state.clip = mask;
    },
    fillText(): void {
      /* no glyphs: `spines.ts` owns lettering and is not what this gates */
    },
    strokeText(): void {
      /* as above */
    },
    measureText(text: string): { width: number } {
      return { width: text.length * 6 };
    },
    createLinearGradient(): { addColorStop: () => void } {
      return { addColorStop: (): void => undefined };
    },
    drawImage(): void {
      /* no images in this vocabulary */
    },
    setLineDash(): void {
      /* unused */
    },
  };

  const at = (x: number, y: number): RGB => {
    if (x < 0 || y < 0 || x >= width || y >= height) return bg;
    const o = (y * width + x) * 3;
    return [data[o] as number, data[o + 1] as number, data[o + 2] as number];
  };

  return {
    ctx,
    width,
    height,
    data,
    at,
    isGround(x: number, y: number): boolean {
      const c = at(x, y);
      return c[0] === bg[0] && c[1] === bg[1] && c[2] === bg[2];
    },
  };
}

/* -------------------------------------------------------------------------- *
 *                                     PNG                                     *
 * -------------------------------------------------------------------------- */

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = ((CRC_TABLE[(c ^ (buf[i] as number)) & 0xff] as number) ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  const crcSpan = out.subarray(4, 8 + body.length);
  view.setUint32(8 + body.length, crc32(crcSpan));
  return out;
}

/** An 8-bit RGB PNG of a raster, so a specimen board can be looked at. */
export function encodePng(raster: Raster): Uint8Array {
  const { width, height, data } = raster;
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    raw.set(data.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    png.set(p, off);
    off += p.length;
  }
  return png;
}
