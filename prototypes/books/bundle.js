"use strict";
(() => {
  // node_modules/simplex-noise/dist/esm/simplex-noise.js
  var SQRT3 = /* @__PURE__ */ Math.sqrt(3);
  var SQRT5 = /* @__PURE__ */ Math.sqrt(5);
  var F2 = 0.5 * (SQRT3 - 1);
  var G2 = (3 - SQRT3) / 6;
  var F3 = 1 / 3;
  var G3 = 1 / 6;
  var F4 = (SQRT5 - 1) / 4;
  var G4 = (5 - SQRT5) / 20;

  // src/art/noise.ts
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = a + 1831565813 >>> 0;
      let t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  // src/art/brush.ts
  var clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
  function parseColour(input) {
    if (typeof input !== "string") {
      if ("r" in input) return { r: clamp01(input.r), g: clamp01(input.g), b: clamp01(input.b) };
      return hslToRgb(input);
    }
    const s = input.trim().toLowerCase();
    if (s.startsWith("#")) {
      const hex = s.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        return {
          r: parseInt(hex[0] + hex[0], 16) / 255,
          g: parseInt(hex[1] + hex[1], 16) / 255,
          b: parseInt(hex[2] + hex[2], 16) / 255
        };
      }
      if (hex.length >= 6) {
        return {
          r: parseInt(hex.slice(0, 2), 16) / 255,
          g: parseInt(hex.slice(2, 4), 16) / 255,
          b: parseInt(hex.slice(4, 6), 16) / 255
        };
      }
      return { r: 0, g: 0, b: 0 };
    }
    const nums = s.match(/-?[\d.]+/g)?.map(Number) ?? [];
    if (s.startsWith("hsl")) {
      return hslToRgb({ h: nums[0] ?? 0, s: (nums[1] ?? 0) / 100, l: (nums[2] ?? 0) / 100 });
    }
    return { r: (nums[0] ?? 0) / 255, g: (nums[1] ?? 0) / 255, b: (nums[2] ?? 0) / 255 };
  }
  function hslToRgb({ h, s, l }) {
    const hh = (h % 360 + 360) % 360;
    const ss = clamp01(s);
    const ll = clamp01(l);
    if (ss === 0) return { r: ll, g: ll, b: ll };
    const c = (1 - Math.abs(2 * ll - 1)) * ss;
    const x = c * (1 - Math.abs(hh / 60 % 2 - 1));
    const m = ll - c / 2;
    let r = 0;
    let g = 0;
    let b = 0;
    if (hh < 60) [r, g, b] = [c, x, 0];
    else if (hh < 120) [r, g, b] = [x, c, 0];
    else if (hh < 180) [r, g, b] = [0, c, x];
    else if (hh < 240) [r, g, b] = [0, x, c];
    else if (hh < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return { r: r + m, g: g + m, b: b + m };
  }
  function rgbToHsl({ r, g, b }) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h;
    if (max === r) h = 60 * ((g - b) / d % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    return { h: (h + 360) % 360, s: clamp01(s), l };
  }
  function mixRgb(a, b, t) {
    return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
  }
  function shiftHsl(colour, dh, ds, dl) {
    const hsl = rgbToHsl(parseColour(colour));
    return hslToRgb({ h: hsl.h + dh, s: clamp01(hsl.s + ds), l: clamp01(hsl.l + dl) });
  }
  function luminance({ r, g, b }) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function createSurface(width, height, ground) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const surface = { width: w, height: h, data: new Float32Array(w * h * 4) };
    if (ground !== void 0) fillSurface(surface, ground);
    return surface;
  }
  function fillSurface(surface, colour, alpha = 1) {
    const c = parseColour(colour);
    const a = clamp01(alpha);
    const d = surface.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = c.r * a;
      d[i + 1] = c.g * a;
      d[i + 2] = c.b * a;
      d[i + 3] = a;
    }
  }
  function getPixel(surface, x, y) {
    const xi = Math.max(0, Math.min(surface.width - 1, Math.round(x)));
    const yi = Math.max(0, Math.min(surface.height - 1, Math.round(y)));
    const i = (yi * surface.width + xi) * 4;
    const a = surface.data[i + 3];
    if (a <= 1e-6) return { r: 0, g: 0, b: 0, a: 0 };
    return { r: surface.data[i] / a, g: surface.data[i + 1] / a, b: surface.data[i + 2] / a, a };
  }
  function surfaceToRGBA8(surface, background) {
    const out = new Uint8ClampedArray(surface.width * surface.height * 4);
    const d = surface.data;
    const bg = background === void 0 ? null : parseColour(background);
    for (let i = 0, o = 0; i < d.length; i += 4, o += 4) {
      let a = d[i + 3];
      let r = d[i];
      let g = d[i + 1];
      let b = d[i + 2];
      if (bg) {
        r += bg.r * (1 - a);
        g += bg.g * (1 - a);
        b += bg.b * (1 - a);
        a = 1;
      }
      if (a <= 1e-6) {
        out[o] = 0;
        out[o + 1] = 0;
        out[o + 2] = 0;
        out[o + 3] = 0;
        continue;
      }
      out[o] = clamp01(r / a) * 255;
      out[o + 1] = clamp01(g / a) * 255;
      out[o + 2] = clamp01(b / a) * 255;
      out[o + 3] = clamp01(a) * 255;
    }
    return out;
  }
  function surfaceToImageData(surface, background) {
    return new ImageData(surfaceToRGBA8(surface, background), surface.width, surface.height);
  }
  function drawSurface(ctx, surface, x = 0, y = 0) {
    const tmp = document.createElement("canvas");
    tmp.width = surface.width;
    tmp.height = surface.height;
    const tctx = tmp.getContext("2d");
    tctx.putImageData(surfaceToImageData(surface), 0, 0);
    ctx.drawImage(tmp, x, y);
  }
  function compositeSurface(dst, src, x = 0, y = 0, alpha = 1, blend = "normal") {
    const ox = Math.round(x);
    const oy = Math.round(y);
    const x0 = Math.max(0, ox);
    const y0 = Math.max(0, oy);
    const x1 = Math.min(dst.width, ox + src.width);
    const y1 = Math.min(dst.height, oy + src.height);
    const a = clamp01(alpha);
    if (a <= 0) return;
    for (let dy = y0; dy < y1; dy++) {
      for (let dx = x0; dx < x1; dx++) {
        const si = ((dy - oy) * src.width + (dx - ox)) * 4;
        const sa = src.data[si + 3];
        if (sa <= 2e-3) continue;
        compositePixel(dst.data, (dy * dst.width + dx) * 4, src.data[si] / sa, src.data[si + 1] / sa, src.data[si + 2] / sa, sa * a, blend);
      }
    }
  }
  function clipToMask(surface, mask, opts = {}) {
    const ox = opts.offsetX ?? 0;
    const oy = opts.offsetY ?? 0;
    const feather = Math.max(0.25, opts.feather ?? 1.2);
    const noise = opts.noise ?? 0;
    const noiseScale = opts.noiseScale ?? 9;
    const seed = (opts.seed ?? 3089) >>> 0;
    const d = surface.data;
    for (let y = 0; y < surface.height; y++) {
      for (let x = 0; x < surface.width; x++) {
        const i = (y * surface.width + x) * 4;
        if (d[i + 3] <= 2e-3) continue;
        const sx = x + ox;
        const sy = y + oy;
        let dist = maskDistanceAt(mask, sx, sy);
        if (noise > 0) dist -= (clamp01((fbm(sx / noiseScale, sy / noiseScale, seed, 3) - 0.26) / 0.48) - 0.5) * 2 * noise;
        const k = clamp01(0.5 - dist / (feather * 2));
        if (k >= 0.999) continue;
        d[i] *= k;
        d[i + 1] *= k;
        d[i + 2] *= k;
        d[i + 3] *= k;
      }
    }
  }
  function blendChannel(mode, cd, cs) {
    switch (mode) {
      case "multiply":
        return cd * cs;
      case "screen":
        return cd + cs - cd * cs;
      case "overlay":
        return cd <= 0.5 ? 2 * cd * cs : 1 - 2 * (1 - cd) * (1 - cs);
      case "softlight": {
        const dd = cd <= 0.25 ? ((16 * cd - 12) * cd + 4) * cd : Math.sqrt(cd);
        return cs <= 0.5 ? cd - (1 - 2 * cs) * cd * (1 - cd) : cd + (2 * cs - 1) * (dd - cd);
      }
      case "lighten":
        return Math.max(cd, cs);
      case "darken":
        return Math.min(cd, cs);
      case "add":
        return cd + cs;
      default:
        return cs;
    }
  }
  function compositePixel(d, i, r, g, b, aS, mode) {
    if (aS <= 0) return;
    const aD = d[i + 3];
    if (mode === "erase") {
      const keep = 1 - aS;
      d[i] *= keep;
      d[i + 1] *= keep;
      d[i + 2] *= keep;
      d[i + 3] = aD * keep;
      return;
    }
    if (mode === "normal" || aD <= 1e-6) {
      const inv2 = 1 - aS;
      d[i] = r * aS + d[i] * inv2;
      d[i + 1] = g * aS + d[i + 1] * inv2;
      d[i + 2] = b * aS + d[i + 2] * inv2;
      d[i + 3] = aS + aD * inv2;
      return;
    }
    const cdR = d[i] / aD;
    const cdG = d[i + 1] / aD;
    const cdB = d[i + 2] / aD;
    const bR = blendChannel(mode, cdR, r);
    const bG = blendChannel(mode, cdG, g);
    const bB = blendChannel(mode, cdB, b);
    const mR = (1 - aD) * r + aD * bR;
    const mG = (1 - aD) * g + aD * bG;
    const mB = (1 - aD) * b + aD * bB;
    const inv = 1 - aS;
    d[i] = mR * aS + d[i] * inv;
    d[i + 1] = mG * aS + d[i + 1] * inv;
    d[i + 2] = mB * aS + d[i + 2] * inv;
    d[i + 3] = aS + aD * inv;
  }
  var KERNEL_CACHE = /* @__PURE__ */ new Map();
  var KIND_INDEX = {
    soft: 0,
    bristle: 1,
    chalk: 2,
    flat: 3,
    blade: 4,
    sponge: 5,
    ink: 6
  };
  function hash2(x, y, seed) {
    let h = x * 374761393 + y * 668265263 + seed * 1274126177 | 0;
    h = h ^ h >>> 13 | 0;
    h = Math.imul(h, 1274126177);
    return ((h ^ h >>> 16) >>> 0) / 4294967296;
  }
  function valueNoise(x, y, seed) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi, seed);
    const b = hash2(xi + 1, yi, seed);
    const c = hash2(xi, yi + 1, seed);
    const e = hash2(xi + 1, yi + 1, seed);
    return (a + (b - a) * u) * (1 - v) + (c + (e - c) * u) * v;
  }
  function fbm(x, y, seed, octaves = 3) {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let fx = x;
    let fy = y;
    for (let o = 0; o < octaves; o++) {
      sum += valueNoise(fx, fy, seed + o * 1013) * amp;
      norm += amp;
      amp *= 0.5;
      fx *= 2.03;
      fy *= 2.01;
    }
    return sum / norm;
  }
  function makeKernel(kind, size, hardness = 0.5, grain = 0.5, variant = 0) {
    const px = Math.max(3, Math.ceil(size) | 1);
    const hB = Math.round(clamp01(hardness) * 20);
    const gB = Math.round(clamp01(grain) * 20);
    const key = (((KIND_INDEX[kind] * 258 + px) * 21 + hB) * 21 + gB) * 8 + (variant & 7);
    const hit = KERNEL_CACHE.get(key);
    if (hit) return hit;
    const alpha = new Float32Array(px * px);
    const c = (px - 1) / 2;
    const seed = (variant & 7) * 7919 + px * 31 + hB * 101;
    const rand = mulberry32(seed);
    const squash = 1 + (rand() - 0.5) * 0.28;
    const tilt = (rand() - 0.5) * 0.5;
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);
    const bristleCount = 5 + Math.floor(rand() * 7);
    const bristleY = [];
    const bristleW = [];
    for (let i = 0; i < bristleCount; i++) {
      bristleY.push((i / (bristleCount - 1) - 0.5) * 2 + (rand() - 0.5) * 0.18);
      bristleW.push(0.35 + rand() * 0.65);
    }
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const dx0 = (x - c) / c;
        const dy0 = (y - c) / c;
        const lx = (dx0 * cosT + dy0 * sinT) * squash;
        const ly = (-dx0 * sinT + dy0 * cosT) / squash;
        let a = 0;
        switch (kind) {
          case "soft": {
            const r = Math.hypot(lx, ly);
            if (r >= 1) break;
            const exp = 1.05 + hardness * 5.5;
            a = Math.pow(1 - r, exp);
            break;
          }
          case "ink": {
            const r = Math.hypot(lx, ly);
            const edge = 1 - Math.max(0, Math.min(1, (r - (0.82 - hardness * 0.12)) / 0.2));
            a = edge;
            break;
          }
          case "bristle": {
            const r = Math.hypot(lx, ly);
            if (r >= 1) break;
            const body = Math.pow(1 - r, 0.8 + hardness * 2.4);
            let streak = 0;
            for (let i = 0; i < bristleCount; i++) {
              const d = Math.abs(ly - bristleY[i]);
              const w = 0.06 + 0.09 * bristleW[i];
              if (d < w * 2.6) streak = Math.max(streak, bristleW[i] * Math.exp(-(d * d) / (2 * w * w)));
            }
            const along = 0.55 + 0.45 * (1 - Math.abs(lx));
            a = body * (0.18 + 0.95 * streak) * along;
            break;
          }
          case "chalk": {
            const r = Math.hypot(lx, ly);
            if (r >= 1) break;
            const body = Math.pow(1 - r, 0.55 + hardness * 1.9);
            const n = fbm((x + seed) * 0.85, (y - seed) * 0.85, seed, 3);
            const bite = 1 - grain;
            const tooth = Math.max(0, (n - 0.34 * grain) / (1 - 0.34 * grain));
            a = body * (bite + (1 - bite) * tooth * 1.35);
            break;
          }
          case "flat": {
            const ax = Math.abs(lx);
            const ay = Math.abs(ly) / 0.42;
            if (ax >= 1 || ay >= 1) break;
            const endFall = Math.pow(1 - ax, 0.35 + (1 - hardness) * 1.4);
            const sideFall = Math.pow(1 - ay, 0.3 + (1 - hardness) * 1.6);
            let streak = 1;
            for (let i = 0; i < bristleCount; i++) {
              const d = Math.abs(ly / 0.42 - bristleY[i]);
              if (d < 0.1) streak = Math.min(streak, 0.55 + bristleW[i] * 0.45);
            }
            a = endFall * sideFall * streak;
            break;
          }
          case "blade": {
            const ax = Math.abs(lx);
            const ay = Math.abs(ly) / 0.34;
            if (ax >= 1 || ay >= 1) break;
            const crisp = ly < 0 ? 1 : Math.pow(1 - ay, 1.6);
            a = Math.pow(1 - ax, 0.3) * crisp * (1 - ay * 0.35);
            break;
          }
          case "sponge": {
            const r = Math.hypot(lx, ly);
            if (r >= 1) break;
            const body = Math.pow(1 - r, 0.7);
            const n = fbm((x + seed * 0.5) * 0.5, (y + seed * 0.7) * 0.5, seed + 5, 3);
            const clump = Math.max(0, (n - 0.42) / 0.58);
            a = body * clump * 1.8;
            break;
          }
        }
        if (a > 0) {
          const jn = hash2(x * 7 + variant, y * 13 - variant, seed + 991);
          a *= 1 - grain * 0.22 * jn;
        }
        alpha[y * px + x] = a > 1 ? 1 : a < 0 ? 0 : a;
      }
    }
    const kernel = { size: px, alpha };
    if (KERNEL_CACHE.size > 512) KERNEL_CACHE.clear();
    KERNEL_CACHE.set(key, kernel);
    return kernel;
  }
  var PAINT_QUALITY = 1;
  var KIND_DEFAULTS = {
    soft: { hardness: 0.35, opacity: 0.1, spacing: 0.16, grain: 0.25, scatter: 0.05 },
    bristle: { hardness: 0.55, opacity: 0.16, spacing: 0.2, grain: 0.55, scatter: 0.09 },
    chalk: { hardness: 0.5, opacity: 0.14, spacing: 0.26, grain: 0.85, scatter: 0.14 },
    flat: { hardness: 0.6, opacity: 0.18, spacing: 0.14, grain: 0.45, scatter: 0.04, followPath: true },
    blade: { hardness: 0.85, opacity: 0.3, spacing: 0.1, grain: 0.25, scatter: 0.02, followPath: true },
    sponge: { hardness: 0.4, opacity: 0.12, spacing: 0.42, grain: 0.9, scatter: 0.35 },
    ink: { hardness: 0.95, opacity: 0.55, spacing: 0.08, grain: 0.1, scatter: 0.01 }
  };
  var DEFAULT_JITTER = {
    size: 0.3,
    opacity: 0.4,
    angle: 0.35,
    hue: 7,
    sat: 0.07,
    lum: 0.07,
    position: 0.6
  };
  function brush(kind, overrides = {}) {
    const kd = KIND_DEFAULTS[kind];
    const { colour, jitter, ...rest } = overrides;
    return {
      kind,
      size: 18,
      hardness: 0.5,
      opacity: 0.14,
      spacing: 0.2,
      scatter: 0.08,
      angle: 0,
      followPath: false,
      flow: 1,
      grain: 0.5,
      blend: "normal",
      variants: 6,
      ...kd,
      ...rest,
      colour: parseColour(colour ?? "#6b5a44"),
      jitter: { ...DEFAULT_JITTER, ...jitter ?? {} }
    };
  }
  function withBrush(base, overrides) {
    const { colour, jitter, ...rest } = overrides;
    return {
      ...base,
      ...rest,
      colour: colour === void 0 ? base.colour : parseColour(colour),
      jitter: { ...base.jitter, ...jitter ?? {} }
    };
  }
  function dab(surface, x, y, b, opts = {}) {
    const size = Math.max(1.2, opts.size ?? b.size);
    const alphaMul = clamp01((opts.opacity ?? b.opacity) * b.flow);
    if (alphaMul <= 6e-4) return;
    const angle = opts.angle ?? b.angle;
    const colour = opts.colour === void 0 ? b.colour : parseColour(opts.colour);
    const blend = opts.blend ?? b.blend;
    const variant = opts.variant ?? Math.floor(hash2(Math.round(x * 3.1), Math.round(y * 3.7), 4919) * b.variants);
    const kernel = makeKernel(b.kind, Math.min(256, Math.max(3, Math.round(size))), b.hardness, b.grain, variant);
    const k = kernel.size;
    const kc = (k - 1) / 2;
    const scale = k / size;
    const half = size * 0.5 * Math.SQRT2 + 1;
    const x0 = Math.max(0, Math.floor(x - half));
    const x1 = Math.min(surface.width - 1, Math.ceil(x + half));
    const y0 = Math.max(0, Math.floor(y - half));
    const y1 = Math.min(surface.height - 1, Math.ceil(y + half));
    if (x1 < x0 || y1 < y0) return;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const stepX = cos * scale;
    const stepY = sin * scale;
    const d = surface.data;
    const ka = kernel.alpha;
    const { r, g, b: bl } = colour;
    const kMax = k - 1;
    const w = surface.width;
    const bilinear = size >= 14;
    const normal = blend === "normal";
    for (let py = y0; py <= y1; py++) {
      const dy = py + 0.5 - y;
      const dx0 = x0 + 0.5 - x;
      let kx = (dx0 * cos - dy * sin) * scale + kc;
      let ky = (dx0 * sin + dy * cos) * scale + kc;
      let idx = (py * w + x0) * 4;
      for (let px = x0; px <= x1; px++, kx += stepX, ky += stepY, idx += 4) {
        if (kx < 0 || ky < 0 || kx > kMax || ky > kMax) continue;
        const ix = kx | 0;
        const iy = ky | 0;
        let a;
        if (bilinear) {
          const fx = kx - ix;
          const fy = ky - iy;
          const ix1 = ix + 1 < k ? ix + 1 : ix;
          const iy1 = iy + 1 < k ? iy + 1 : iy;
          const row0 = iy * k;
          const row1 = iy1 * k;
          a = (ka[row0 + ix] * (1 - fx) + ka[row0 + ix1] * fx) * (1 - fy) + (ka[row1 + ix] * (1 - fx) + ka[row1 + ix1] * fx) * fy;
        } else {
          a = ka[iy * k + ix];
        }
        if (a <= 8e-4) continue;
        const aS = a * alphaMul;
        if (normal) {
          const inv = 1 - aS;
          d[idx] = r * aS + d[idx] * inv;
          d[idx + 1] = g * aS + d[idx + 1] * inv;
          d[idx + 2] = bl * aS + d[idx + 2] * inv;
          d[idx + 3] = aS + d[idx + 3] * inv;
        } else {
          compositePixel(d, idx, r, g, bl, aS, blend);
        }
      }
    }
  }
  function pathLength(pts) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return len;
  }
  function smoothPath(pts, subdivisions = 8) {
    if (pts.length < 3) return pts.map((p) => ({ ...p }));
    const out = [];
    const at = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = at(i - 1);
      const p1 = at(i);
      const p2 = at(i + 1);
      const p3 = at(i + 2);
      for (let s = 0; s < subdivisions; s++) {
        const t = s / subdivisions;
        const t2 = t * t;
        const t3 = t2 * t;
        out.push({
          x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
        });
      }
    }
    out.push({ ...pts[pts.length - 1] });
    return out;
  }
  function resamplePath(pts, step) {
    const out = [];
    if (pts.length === 0) return out;
    const total = pathLength(pts);
    if (pts.length === 1 || total < 1e-6) {
      out.push({ x: pts[0].x, y: pts[0].y, angle: 0, t: 0 });
      return out;
    }
    const s = Math.max(0.15, step);
    let travelled = 0;
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const segLen = Math.hypot(dx, dy);
      if (segLen < 1e-9) continue;
      const angle = Math.atan2(dy, dx);
      let d = carry;
      while (d <= segLen) {
        const u = d / segLen;
        out.push({ x: a.x + dx * u, y: a.y + dy * u, angle, t: (travelled + d) / total });
        d += s;
      }
      carry = d - segLen;
      travelled += segLen;
    }
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    out.push({ x: last.x, y: last.y, angle: Math.atan2(last.y - prev.y, last.x - prev.x), t: 1 });
    return out;
  }
  var PRESSURE = {
    /** Constant. */
    flat: () => 1,
    /** Heavy in the middle, tapered at both ends — a natural single stroke. */
    arc: (t) => Math.sin(Math.PI * clamp01(t)) ** 0.55,
    /** Lands hard, lifts off — a flick. */
    flick: (t) => Math.pow(1 - clamp01(t), 0.7),
    /** Lifts on, presses down — for stems thickening into a trunk. */
    swell: (t) => Math.pow(clamp01(t), 0.7),
    /** Two accents with a thin waist — a leaf ridge or a decorative rule. */
    double: (t) => 0.45 + 0.55 * Math.abs(Math.cos(Math.PI * clamp01(t)))
  };
  function stroke(surface, path, b, opts = {}) {
    if (path.length === 0) return;
    const rng = opts.rng ?? mulberry32((opts.seed ?? 20973) >>> 0);
    const passes = Math.max(1, Math.round(opts.passes ?? 2));
    const taper = typeof opts.taper === "number" ? [opts.taper, opts.taper] : opts.taper ?? [0.12, 0.12];
    const pressure = opts.pressure ?? PRESSURE.arc;
    const wobbleAmp = opts.wobble ?? b.size * 0.06;
    const alphaMul = opts.alpha ?? 1;
    let pts = path.map((p) => ({ ...p }));
    if (opts.closed && pts.length > 2) pts.push({ ...pts[0] });
    if ((opts.smooth ?? true) && pts.length >= 3) pts = smoothPath(pts, 6);
    const step = Math.max(0.4, b.size * b.spacing);
    const samples = resamplePath(pts, step);
    if (samples.length === 0) return;
    const hsl = rgbToHsl(b.colour);
    for (let pass = 0; pass < passes; pass++) {
      const passSeedX = rng() * 1e3;
      const passSeedY = rng() * 1e3;
      const lateral = pass === 0 ? 0 : (rng() * 2 - 1) * (opts.passOffset ?? b.size * 0.16);
      const passAlpha = pass === 0 ? 1 : 0.62 + rng() * 0.3;
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        const j = b.jitter;
        let profile = pressure(s.t);
        const [tIn, tOut] = taper;
        if (tIn > 0 && s.t < tIn) profile *= Math.pow(s.t / tIn, 0.6);
        if (tOut > 0 && s.t > 1 - tOut) profile *= Math.pow((1 - s.t) / tOut, 0.6);
        if (profile <= 8e-3) continue;
        const nx = -Math.sin(s.angle);
        const ny = Math.cos(s.angle);
        const wob = wobbleAmp === 0 ? 0 : (fbm(s.t * 7 + passSeedX, passSeedY, 17, 2) - 0.5) * 2 * wobbleAmp;
        const scat = (rng() * 2 - 1) * b.scatter * b.size;
        const off = lateral + wob + scat;
        const jx = (rng() * 2 - 1) * j.position;
        const jy = (rng() * 2 - 1) * j.position;
        const x = s.x + nx * off + jx;
        const y = s.y + ny * off + jy;
        const size = b.size * profile * (1 + (rng() * 2 - 1) * j.size);
        const opacity = b.opacity * passAlpha * alphaMul * (0.55 + 0.45 * profile) * (1 + (rng() * 2 - 1) * j.opacity);
        const angle = (b.followPath ? s.angle + b.angle : b.angle) + (rng() * 2 - 1) * j.angle;
        const grad = opts.gradient?.(s.t);
        const colour = hslToRgb({
          h: hsl.h + (rng() * 2 - 1) * j.hue + (grad?.dh ?? 0),
          s: clamp01(hsl.s + (rng() * 2 - 1) * j.sat + (grad?.ds ?? 0)),
          l: clamp01(hsl.l + (rng() * 2 - 1) * j.lum + (grad?.dl ?? 0))
        });
        dab(surface, x, y, b, { size, opacity, angle, colour, variant: Math.floor(rng() * b.variants) });
      }
    }
  }
  function rectShape(x, y, w, h) {
    return [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h }
    ];
  }
  function densifyShape(shape, maxSegment) {
    const out = [];
    const n = shape.length;
    const step = Math.max(0.5, maxSegment);
    for (let i = 0; i < n; i++) {
      const a = shape[i];
      const b = shape[(i + 1) % n];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const parts = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k < parts; k++) {
        out.push({ x: a.x + (b.x - a.x) * k / parts, y: a.y + (b.y - a.y) * k / parts });
      }
    }
    return out;
  }
  function roughenShape(shape, amount, seed = 1, frequency = 2.2) {
    let perimeter = 0;
    for (let i = 0; i < shape.length; i++) {
      const a = shape[i];
      const b = shape[(i + 1) % shape.length];
      perimeter += Math.hypot(b.x - a.x, b.y - a.y);
    }
    if (shape.length < perimeter / Math.max(2, amount * 2.5)) {
      shape = densifyShape(shape, Math.max(2, amount * 2.5));
    }
    const n = shape.length;
    let cx = 0;
    let cy = 0;
    for (const p of shape) {
      cx += p.x;
      cy += p.y;
    }
    cx /= n;
    cy /= n;
    return shape.map((p, i) => {
      const t = i / n * frequency * Math.PI * 2;
      const d = (fbm(Math.cos(t) * 2 + 4, Math.sin(t) * 2 + 4, seed, 2) - 0.5) * 2 * amount;
      const dx = p.x - cx;
      const dy = p.y - cy;
      const len = Math.hypot(dx, dy) || 1;
      return { x: p.x + dx / len * d, y: p.y + dy / len * d };
    });
  }
  function rasterizeShape(shape, pad = 8) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of shape) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const x0 = Math.floor(minX - pad);
    const y0 = Math.floor(minY - pad);
    const w = Math.max(1, Math.ceil(maxX + pad) - x0);
    const h = Math.max(1, Math.ceil(maxY + pad) - y0);
    const coverage = new Float32Array(w * h);
    const SUB = 4;
    const subWeight = 1 / SUB;
    const xs = [];
    const n = shape.length;
    for (let sy = 0; sy < h * SUB; sy++) {
      const py = y0 + (sy + 0.5) / SUB;
      xs.length = 0;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = shape[i].y;
        const yj = shape[j].y;
        if (yi > py === yj > py) continue;
        xs.push(shape[i].x + (py - yi) / (yj - yi) * (shape[j].x - shape[i].x));
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      const row = sy / SUB | 0;
      const rowBase = row * w;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        let xa = xs[k] - x0;
        let xb = xs[k + 1] - x0;
        if (xb <= 0 || xa >= w) continue;
        if (xa < 0) xa = 0;
        if (xb > w) xb = w;
        const ia = Math.floor(xa);
        const ib = Math.floor(xb - 1e-9);
        if (ia === ib) {
          coverage[rowBase + ia] += (xb - xa) * subWeight;
          continue;
        }
        coverage[rowBase + ia] += (ia + 1 - xa) * subWeight;
        for (let px = ia + 1; px < ib; px++) coverage[rowBase + px] += subWeight;
        coverage[rowBase + ib] += (xb - ib) * subWeight;
      }
    }
    for (let i = 0; i < coverage.length; i++) if (coverage[i] > 1) coverage[i] = 1;
    return { x: x0, y: y0, width: w, height: h, coverage, distance: chamferSDF(coverage, w, h) };
  }
  function chamferSDF(coverage, w, h) {
    const BIG = 1e9;
    const inner = new Float32Array(w * h);
    const outer = new Float32Array(w * h);
    for (let i = 0; i < coverage.length; i++) {
      const solid = coverage[i] >= 0.5;
      inner[i] = solid ? BIG : 0;
      outer[i] = solid ? 0 : BIG;
    }
    const sweep = (f) => {
      const D1 = 1;
      const D2 = 1.41421356;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          let v = f[i];
          if (x > 0) v = Math.min(v, f[i - 1] + D1);
          if (y > 0) v = Math.min(v, f[i - w] + D1);
          if (x > 0 && y > 0) v = Math.min(v, f[i - w - 1] + D2);
          if (x < w - 1 && y > 0) v = Math.min(v, f[i - w + 1] + D2);
          f[i] = v;
        }
      }
      for (let y = h - 1; y >= 0; y--) {
        for (let x = w - 1; x >= 0; x--) {
          const i = y * w + x;
          let v = f[i];
          if (x < w - 1) v = Math.min(v, f[i + 1] + D1);
          if (y < h - 1) v = Math.min(v, f[i + w] + D1);
          if (x < w - 1 && y < h - 1) v = Math.min(v, f[i + w + 1] + D2);
          if (x > 0 && y < h - 1) v = Math.min(v, f[i + w - 1] + D2);
          f[i] = v;
        }
      }
    };
    sweep(inner);
    sweep(outer);
    const sdf = new Float32Array(w * h);
    for (let i = 0; i < sdf.length; i++) sdf[i] = outer[i] > 0 ? outer[i] : -inner[i];
    return sdf;
  }
  function maskCoverageAt(mask, x, y) {
    const mx = Math.round(x) - mask.x;
    const my = Math.round(y) - mask.y;
    if (mx < 0 || my < 0 || mx >= mask.width || my >= mask.height) return 0;
    return mask.coverage[my * mask.width + mx];
  }
  function maskDistanceAt(mask, x, y) {
    const mx = Math.round(x) - mask.x;
    const my = Math.round(y) - mask.y;
    if (mx < 0 || my < 0 || mx >= mask.width || my >= mask.height) return 1e9;
    return mask.distance[my * mask.width + mx];
  }
  function blockIn(surface, shape, colour, opts = {}) {
    const seed = (opts.seed ?? 33196) >>> 0;
    const rng = mulberry32(seed);
    const base = parseColour(colour);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of shape) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const short = Math.min(bw, bh);
    const rough = opts.roughness ?? Math.max(0.6, short * 0.04);
    const silhouette = rough > 0 ? roughenShape(shape, rough, seed, 2.6) : shape.map((p) => ({ ...p }));
    const mask = rasterizeShape(silhouette, Math.max(6, short * 0.25));
    const overshoot = opts.overshoot ?? Math.max(1.2, short * 0.05);
    const passes = Math.max(1, Math.round(opts.passes ?? 2));
    const valueSpread = opts.valueSpread ?? 0.11;
    const hueSpread = opts.hueSpread ?? 12;
    const openness = clamp01(opts.openness ?? 0.08);
    const b = opts.brush ?? brush("chalk", {
      size: Math.max(4, short * 0.5),
      // Sparse and opaque, not dense and faint. Dense/faint is what turned the
      // mass into a gradient in the first zoom test.
      opacity: 0.5,
      spacing: 0.2,
      grain: 0.62,
      hardness: 0.42,
      jitter: { size: 0.3, opacity: 0.4, angle: 0.4, hue: 6, sat: 0.06, lum: 0.08, position: short * 0.02 }
    });
    const dir = opts.direction ?? (bw >= bh ? 0 : Math.PI / 2);
    const hsl = rgbToHsl(base);
    const layer = createSurface(mask.width, mask.height);
    const lox = mask.x;
    const loy = mask.y;
    if ((opts.openness ?? 0.08) < 0.5) {
      const under = withBrush(b, {
        kind: "soft",
        hardness: 0.3,
        grain: 0.15,
        opacity: 0.62,
        spacing: 0.12,
        scatter: 0.04,
        colour: hslToRgb({ h: hsl.h, s: clamp01(hsl.s * 0.95), l: clamp01(hsl.l - valueSpread * 0.55) }),
        blend: "normal",
        jitter: { size: 0.16, opacity: 0.2, angle: 0.3, hue: 3, sat: 0.03, lum: 0.03, position: 0.6 }
      });
      const uStep = Math.max(1.2, under.size * 0.26 / Math.min(1, PAINT_QUALITY));
      const uHsl = rgbToHsl(under.colour);
      const margin = under.size * 0.6;
      const uy0 = Math.max(0, Math.floor(minY - loy - margin));
      const uy1 = Math.min(mask.height - 1, Math.ceil(maxY - loy + margin));
      for (let ly = uy0; ly <= uy1; ly += uStep) {
        const row = Math.max(0, Math.min(mask.height - 1, Math.round(ly)));
        let rx0 = -1;
        let rx1 = -1;
        for (let mx = 0; mx < mask.width; mx++) {
          if (mask.coverage[row * mask.width + mx] > 0.02) {
            if (rx0 < 0) rx0 = mx;
            rx1 = mx;
          }
        }
        if (rx0 < 0) continue;
        const drift = fbm((ly + loy) * 0.02, ly * 0.013, seed + 61, 3) - 0.5;
        stroke(layer, [
          { x: rx0 - margin, y: ly },
          { x: rx1 + margin, y: ly }
        ], withBrush(under, {
          colour: hslToRgb({
            h: uHsl.h + drift * hueSpread * 1.6,
            s: clamp01(uHsl.s + drift * 0.07),
            l: clamp01(uHsl.l + drift * valueSpread * 1.5)
          })
        }), {
          pressure: PRESSURE.flat,
          taper: 0,
          passes: 1,
          smooth: false,
          wobble: 0,
          rng,
          gradient: (t) => ({ dl: (t - 0.5) * valueSpread * 0.9, dh: (t - 0.5) * hueSpread * 0.8 })
        });
      }
    }
    for (let pass = 0; pass < passes; pass++) {
      const angle = dir + (pass - (passes - 1) / 2) * 0.18 + (rng() * 2 - 1) * 0.08;
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const span = Math.hypot(bw, bh) / 2 + overshoot + b.size;
      const rowStep = Math.max(1.2, b.size * (opts.rowFactor ?? 0.55));
      for (let vRow = -span; vRow <= span; vRow += rowStep) {
        const lineSeed = rng();
        const v = vRow + (rng() * 2 - 1) * rowStep * 0.4;
        const rowAngle = angle + (rng() * 2 - 1) * 0.09;
        const rcos = Math.cos(rowAngle);
        const rsin = Math.sin(rowAngle);
        const path = [];
        for (let u = -span; u <= span; u += Math.max(2, b.size * 0.5)) {
          path.push({ x: cx + u * rcos - v * rsin, y: cy + u * rsin + v * rcos });
        }
        const kept = [];
        let run = [];
        for (const p of path) {
          const d = maskDistanceAt(mask, p.x, p.y);
          const slop = overshoot * (0.35 + 0.65 * fbm(p.x * 0.05, p.y * 0.05, seed + 3, 2));
          if (d < slop) run.push(p);
          else if (run.length) {
            kept.push(run);
            run = [];
          }
        }
        if (run.length) kept.push(run);
        for (const seg of kept) {
          if (seg.length < 2) continue;
          const mid = seg[Math.floor(seg.length / 2)];
          const gx = (mid.x - minX) / bw - 0.5;
          const gy = (mid.y - minY) / bh - 0.5;
          const drift = fbm(mid.x * 0.02 + lineSeed * 10, mid.y * 0.02, seed + 11, 3) - 0.5;
          const passBias = (pass / Math.max(1, passes - 1) - 0.5) * 0.4;
          const colourHere = hslToRgb({
            h: hsl.h + (drift + gx * 0.5) * hueSpread * 2,
            s: clamp01(hsl.s + drift * 0.06),
            l: clamp01(hsl.l + (drift * 1.4 + gy * 0.5 + passBias) * valueSpread)
          });
          const local = seg.map((p) => ({ x: p.x - lox, y: p.y - loy }));
          stroke(layer, local, withBrush(b, { colour: colourHere, blend: "normal" }), {
            pressure: PRESSURE.flat,
            taper: 0.03,
            passes: 1,
            smooth: false,
            alpha: 1 - openness * fbm(mid.x * 0.03, mid.y * 0.03, seed + 21, 2),
            rng,
            wobble: b.size * 0.1
          });
        }
      }
    }
    clipToMask(layer, mask, {
      offsetX: lox,
      offsetY: loy,
      feather: opts.feather ?? 1.4,
      noise: opts.edgeNoise ?? rough * 0.6,
      noiseScale: Math.max(4, short * 0.16),
      seed: seed + 41
    });
    compositeSurface(surface, layer, lox, loy, 1, opts.blend ?? "normal");
    return mask;
  }
  function scumble(surface, mask, b, opts = {}) {
    const seed = (opts.seed ?? 23579) >>> 0;
    const rng = mulberry32(seed);
    const coverage = clamp01(opts.coverage ?? 0.55);
    const passes = Math.max(1, Math.round(opts.passes ?? 2));
    const density = opts.density ?? 1;
    const edgeBias = opts.edgeBias ?? 0;
    const patchScale = opts.patchScale ?? 26;
    const sizeSpread = opts.sizeSpread ?? 0.5;
    const threshold = opts.threshold ?? 0.35;
    const alphaMul = opts.alpha ?? 1;
    const hsl = rgbToHsl(b.colour);
    const area = mask.width * mask.height;
    const budgetKernel = makeKernel(
      b.kind,
      Math.min(256, Math.max(3, Math.round(b.size))),
      b.hardness,
      b.grain,
      0
    );
    let kSum = 0;
    for (const a of budgetKernel.alpha) kSum += a;
    const kMean = Math.max(0.02, kSum / budgetKernel.alpha.length);
    const perStamp = Math.max(1, b.size * b.size * kMean);
    const need = -Math.log(1 - Math.min(0.985, clamp01(opts.targetBuildup ?? 0.5)));
    const q = PAINT_QUALITY;
    const flow = Math.max(0.06, Math.min(1, b.opacity * b.flow / q));
    const opacityScale = flow / Math.max(1e-6, b.opacity * b.flow);
    const total = Math.min(4e4, Math.round(area * need / (perStamp * flow) * density / passes));
    if (total <= 0) return;
    let deepest = 1;
    for (let i = 0; i < mask.distance.length; i += 7) deepest = Math.min(deepest, mask.distance[i]);
    const depth = Math.max(2, -deepest);
    for (let pass = 0; pass < passes; pass++) {
      const px = rng() * 500;
      const py = rng() * 500;
      const passAlpha = 1 - pass * 0.12;
      for (let n = 0; n < total; n++) {
        const x = mask.x + rng() * mask.width;
        const y = mask.y + rng() * mask.height;
        const cov = maskCoverageAt(mask, x, y);
        if (cov < threshold) continue;
        const wgt = opts.weight ? clamp01(opts.weight(x, y)) : 1;
        if (wgt <= 0.01 || rng() > wgt) continue;
        const patch = clamp01((fbm((x + px) / patchScale, (y + py) / patchScale, seed + pass * 37, 3) - 0.26) / 0.48);
        let keep = patch;
        if (edgeBias !== 0) {
          const d = -maskDistanceAt(mask, x, y) / depth;
          keep *= edgeBias > 0 ? 1 - d * edgeBias : 1 + d * edgeBias;
        }
        if (keep < 1 - coverage) continue;
        const size = b.size * (1 + (rng() * 2 - 1) * sizeSpread);
        const angle = (opts.direction ?? rng() * Math.PI * 2) + (rng() * 2 - 1) * (opts.direction === void 0 ? 0 : b.jitter.angle);
        const opacity = b.opacity * opacityScale * passAlpha * alphaMul * cov * (0.5 + 0.5 * wgt) * (0.35 + 0.9 * keep) * (1 + (rng() * 2 - 1) * b.jitter.opacity);
        const colour = hslToRgb({
          h: hsl.h + (rng() * 2 - 1) * b.jitter.hue + (patch - 0.5) * b.jitter.hue * 1.6,
          s: clamp01(hsl.s + (rng() * 2 - 1) * b.jitter.sat),
          l: clamp01(hsl.l + (rng() * 2 - 1) * b.jitter.lum + (patch - 0.5) * b.jitter.lum * 1.8)
        });
        dab(surface, x, y, b, { size, opacity, angle, colour, variant: Math.floor(rng() * b.variants) });
      }
    }
  }
  function glaze(surface, mask, colour, alpha, opts = {}) {
    const c = parseColour(colour);
    const blend = opts.blend ?? "normal";
    const mottle = opts.mottle ?? 0.18;
    const mottleScale = opts.mottleScale ?? 90;
    const seed = (opts.seed ?? 24994) >>> 0;
    const clip = opts.clip ?? mask !== null;
    const x0 = mask && clip ? Math.max(0, mask.x) : 0;
    const y0 = mask && clip ? Math.max(0, mask.y) : 0;
    const x1 = mask && clip ? Math.min(surface.width, mask.x + mask.width) : surface.width;
    const y1 = mask && clip ? Math.min(surface.height, mask.y + mask.height) : surface.height;
    const d = surface.data;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        let a = alpha;
        if (mask && clip) {
          const cov = mask.coverage[(y - mask.y) * mask.width + (x - mask.x)];
          if (cov <= 2e-3) continue;
          a *= cov;
        }
        if (opts.gradient) {
          a *= opts.gradient(x, y);
          if (a <= 8e-4) continue;
        }
        if (mottle > 0) {
          a *= 1 - mottle + mottle * 2 * fbm(x / mottleScale, y / mottleScale, seed, 3);
        }
        if (a <= 8e-4) continue;
        compositePixel(d, (y * surface.width + x) * 4, c.r, c.g, c.b, a > 1 ? 1 : a, blend);
      }
    }
  }
  function edgeVary(surface, shape, opts = {}) {
    const seed = (opts.seed ?? 15726) >>> 0;
    const rng = mulberry32(seed);
    const crispFrac = clamp01(opts.crisp ?? 0.3);
    const lostFrac = clamp01(opts.lost ?? 0.25);
    const band = Math.max(1, opts.band ?? 3);
    const frequency = opts.frequency ?? 0.55;
    const accentStrength = opts.accentStrength ?? 0.45;
    const softness = Math.max(1, opts.softness ?? band);
    const outline = smoothPath([...shape, shape[0], shape[1]], 4);
    const samples = resamplePath(outline, Math.max(1.2, band * 0.6));
    if (samples.length < 3) return;
    const accentBrush = brush("ink", {
      size: Math.max(1.8, band * 1.25),
      opacity: accentStrength,
      spacing: 0.35,
      scatter: 0.05,
      hardness: 0.95,
      followPath: true,
      jitter: { size: 0.35, opacity: 0.5, angle: 0.2, hue: 6, sat: 0.05, lum: 0.06, position: band * 0.25 }
    });
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const f = clamp01((fbm(s.x * frequency * 0.06, s.y * frequency * 0.06, seed, 2) - 0.24) / 0.52);
      if (f > 1 - crispFrac) {
        let colour;
        if (opts.accent !== void 0) {
          colour = parseColour(opts.accent);
        } else {
          const px = getPixel(surface, s.x, s.y);
          const hsl = rgbToHsl({ r: px.r, g: px.g, b: px.b });
          let lift = -0.16;
          if (opts.lightAngle !== void 0) {
            const nrm = s.angle - Math.PI / 2;
            const facing = Math.cos(nrm - (opts.lightAngle + Math.PI));
            lift = facing > 0.2 ? 0.14 * facing : -0.18;
          }
          colour = hslToRgb({ h: hsl.h + (lift > 0 ? -6 : 8), s: clamp01(hsl.s + 0.05), l: clamp01(hsl.l + lift) });
        }
        const nx = -Math.sin(s.angle);
        const ny = Math.cos(s.angle);
        for (const side of [-0.35, 0.3]) {
          dab(surface, s.x + nx * band * side, s.y + ny * band * side, accentBrush, {
            colour,
            angle: s.angle,
            size: accentBrush.size * (0.7 + rng() * 0.7),
            opacity: accentStrength * (0.55 + rng() * 0.6)
          });
        }
      } else if (f < lostFrac) {
        blurDisc(surface, s.x, s.y, softness * (1.1 + rng() * 0.9), 0.9);
      }
    }
  }
  function blurDisc(surface, cx, cy, radius, amount = 1) {
    const r = Math.max(1, Math.round(radius));
    const x0 = Math.max(1, Math.floor(cx - r));
    const x1 = Math.min(surface.width - 2, Math.ceil(cx + r));
    const y0 = Math.max(1, Math.floor(cy - r));
    const y1 = Math.min(surface.height - 2, Math.ceil(cy + r));
    if (x1 <= x0 || y1 <= y0) return;
    const w = surface.width;
    const d = surface.data;
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const src = new Float32Array(bw * bh * 4);
    for (let y = 0; y < bh; y++) {
      const from = ((y0 + y) * w + x0) * 4;
      src.set(d.subarray(from, from + bw * 4), y * bw * 4);
    }
    const kr = Math.max(1, Math.round(r * 0.4));
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const sx = x0 + x;
        const sy = y0 + y;
        const dist = Math.hypot(sx + 0.5 - cx, sy + 0.5 - cy);
        if (dist > r) continue;
        const wgt = amount * (1 - dist / r);
        if (wgt <= 4e-3) continue;
        let ar = 0;
        let ag = 0;
        let ab = 0;
        let aa = 0;
        let n = 0;
        for (let ky = -kr; ky <= kr; ky++) {
          const yy = y + ky;
          if (yy < 0 || yy >= bh) continue;
          for (let kx = -kr; kx <= kr; kx++) {
            const xx = x + kx;
            if (xx < 0 || xx >= bw) continue;
            const i = (yy * bw + xx) * 4;
            ar += src[i];
            ag += src[i + 1];
            ab += src[i + 2];
            aa += src[i + 3];
            n++;
          }
        }
        if (n === 0) continue;
        const o = (sy * w + sx) * 4;
        const inv = 1 - wgt;
        d[o] = d[o] * inv + ar / n * wgt;
        d[o + 1] = d[o + 1] * inv + ag / n * wgt;
        d[o + 2] = d[o + 2] * inv + ab / n * wgt;
        d[o + 3] = d[o + 3] * inv + aa / n * wgt;
      }
    }
  }
  function addGrain(surface, amount = 0.05, scale = 1.6, seed = 7, mask = null) {
    const d = surface.data;
    for (let y = 0; y < surface.height; y++) {
      for (let x = 0; x < surface.width; x++) {
        const i = (y * surface.width + x) * 4;
        if (d[i + 3] <= 2e-3) continue;
        let k = amount;
        if (mask) {
          const cov = maskCoverageAt(mask, x, y);
          if (cov <= 2e-3) continue;
          k *= cov;
        }
        const n = (fbm(x / scale, y / scale, seed, 2) - 0.5) * 2 * k;
        const m = 1 + n;
        d[i] = clamp01(d[i] * m);
        d[i + 1] = clamp01(d[i + 1] * m);
        d[i + 2] = clamp01(d[i + 2] * m);
      }
    }
  }

  // src/art/charms.ts
  var CHARMS = [
    "none",
    "ribbon",
    "tassel",
    "pressed-flower",
    "clasp",
    "wax-seal",
    "tag"
  ];
  var CHARM_KINDS_WITH_ART = CHARMS.filter(
    (c) => c !== "none"
  );
  var CHARM_COLORS = [
    "#9c2b2b",
    // crimson
    "#2f5d4a",
    // forest
    "#2b4260",
    // navy
    "#e2d4b2",
    // cream
    "#c9a227",
    // gold
    "#6b3f63",
    // plum
    "#a5552b",
    // rust
    "#2e6b73"
    // teal
  ];
  function charmColorCss(index) {
    const n = CHARM_COLORS.length;
    const i = (Math.trunc(index) % n + n) % n;
    return CHARM_COLORS[i];
  }
  var BRASS_HI = "#f0d68d";
  var BRASS = "#b8912f";
  var BRASS_LO = "#6f5312";
  var GOLD_HI = "#ffe9a8";
  var GOLD = "#c9a227";
  var GOLD_LO = "#8f6f14";
  var KRAFT = "#d6bd91";
  var KRAFT_LO = "#a8895c";
  var INK = "rgba(52, 44, 36, 0.75)";
  function hexToRgb(hex) {
    const raw = hex.trim();
    if (raw.startsWith("rgb")) {
      const nums = raw.match(/-?\d*\.?\d+/g);
      if (nums && nums.length >= 3) {
        return [Number(nums[0]), Number(nums[1]), Number(nums[2])];
      }
      return [128, 128, 128];
    }
    const h = raw.replace("#", "");
    const full = h.length === 3 ? `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}` : h;
    const n = Number.parseInt(full.slice(0, 6), 16);
    if (!Number.isFinite(n)) return [128, 128, 128];
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function rgbCss(r, g, b, a = 1) {
    const cl = (v) => Math.round(clamp(v, 0, 255));
    return a >= 1 ? `rgb(${cl(r)} ${cl(g)} ${cl(b)})` : `rgb(${cl(r)} ${cl(g)} ${cl(b)} / ${a})`;
  }
  function mixHex(a, b, t, alpha = 1) {
    const [r1, g1, b1] = hexToRgb(a);
    const [r2, g2, b2] = hexToRgb(b);
    return rgbCss(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t, alpha);
  }
  function shadeHex(hex, amt, alpha = 1) {
    return amt >= 0 ? mixHex(hex, "#ffffff", amt, alpha) : mixHex(hex, "#000000", -amt, alpha);
  }
  function metal(gilt) {
    return gilt ? { hi: GOLD_HI, mid: GOLD, lo: GOLD_LO } : { hi: BRASS_HI, mid: BRASS, lo: BRASS_LO };
  }
  function fillPath(ctx, pts, style) {
    const first = pts[0];
    if (!first) return;
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
  }
  function strokePath(ctx, pts, style, width) {
    const first = pts[0];
    if (!first) return;
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }
  function blobPath(cx, cy, r, n, wobble, rnd) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      const rr = r * (1 + (rnd() * 2 - 1) * wobble);
      pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
    }
    return pts;
  }
  function softShadow(ctx, x, y, w, h, alpha) {
    const g = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, `rgba(30, 22, 14, ${alpha})`);
    g.addColorStop(1, "rgba(30, 22, 14, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - w * 0.4, y - h * 0.4, w * 1.8, h * 1.8);
  }
  function ribbonStrip(ctx, x0, y0, x1, y1, wTop, wBot, color, s, notch = true, sway = 0.22) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.max(1e-3, Math.hypot(dx, dy));
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const bow = sway * len * 0.32;
    const STEPS = 14;
    const centre = (t) => {
      const b = 4 * t * (1 - t);
      return {
        x: x0 + dx * t + nx * bow * b,
        y: y0 + dy * t + ny * bow * b
      };
    };
    const halfAt = (t) => (wTop + (wBot - wTop) * t) * 0.5;
    const left = [];
    const right = [];
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const c = centre(t);
      const hw = halfAt(t);
      left.push({ x: c.x - nx * hw, y: c.y - ny * hw });
      right.push({ x: c.x + nx * hw, y: c.y + ny * hw });
    }
    const tail = centre(1);
    const notchDepth = notch ? Math.min(wBot * 0.8, len * 0.2) : 0;
    const body = [
      ...left,
      { x: tail.x - ux * notchDepth, y: tail.y - uy * notchDepth },
      ...right.reverse()
    ];
    const g = ctx.createLinearGradient(
      x0 - nx * wTop * 0.5,
      y0 - ny * wTop * 0.5,
      x0 + nx * wTop * 0.5,
      y0 + ny * wTop * 0.5
    );
    g.addColorStop(0, shadeHex(color, -0.38));
    g.addColorStop(0.3, shadeHex(color, 0.26));
    g.addColorStop(0.58, color);
    g.addColorStop(1, shadeHex(color, -0.46));
    const first = body[0];
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < body.length; i++) ctx.lineTo(body[i].x, body[i].y);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    const rail = (off, style, width) => {
      const pts = [];
      for (let i = 0; i <= STEPS; i++) {
        const t = i / STEPS;
        const c = centre(t);
        const hw = halfAt(t) * off;
        pts.push({ x: c.x + nx * hw, y: c.y + ny * hw });
      }
      strokePath(ctx, pts, style, width);
    };
    rail(0.24, shadeHex(color, 0.55, 0.5), Math.max(0.7, wTop * 0.16));
    rail(-0.96, shadeHex(color, -0.58, 0.55), Math.max(0.5, 0.7 * s));
    rail(0.96, shadeHex(color, -0.4, 0.4), Math.max(0.4, 0.5 * s));
  }
  function tasselBody(ctx, cx, cy, size, color, rnd) {
    const knotR = size * 0.26;
    const g = ctx.createRadialGradient(cx - knotR * 0.35, cy - knotR * 0.4, knotR * 0.1, cx, cy, knotR);
    g.addColorStop(0, shadeHex(color, 0.4));
    g.addColorStop(1, shadeHex(color, -0.3));
    ctx.beginPath();
    ctx.ellipse(cx, cy, knotR, knotR * 1.15, 0, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    for (const dy of [-knotR * 0.25, knotR * 0.3]) {
      strokePath(
        ctx,
        [
          { x: cx - knotR * 0.92, y: cy + dy },
          { x: cx + knotR * 0.92, y: cy + dy }
        ],
        shadeHex(color, -0.5, 0.55),
        Math.max(0.5, knotR * 0.14)
      );
    }
    const skirtTop = cy + knotR * 0.9;
    const skirtLen = size * 0.95;
    const threads = 9;
    for (let i = 0; i < threads; i++) {
      const t = i / (threads - 1);
      const spread = (t - 0.5) * size * 0.92;
      const len = skirtLen * (0.72 + rnd() * 0.34);
      strokePath(
        ctx,
        [
          { x: cx + spread * 0.28, y: skirtTop },
          { x: cx + spread * 0.8, y: skirtTop + len * 0.55 },
          { x: cx + spread, y: skirtTop + len }
        ],
        i % 3 === 0 ? shadeHex(color, -0.34) : i % 3 === 1 ? color : shadeHex(color, 0.24),
        Math.max(0.55, size * 0.075)
      );
    }
  }
  function pressedFlower(ctx, cx, cy, r, stemTo, color, rnd) {
    const petal = mixHex(color, "#f6ecd8", 0.62);
    const petalDeep = mixHex(color, "#f6ecd8", 0.34);
    strokePath(
      ctx,
      [
        { x: cx, y: cy },
        { x: (cx + stemTo.x) / 2 + r * 0.25, y: (cy + stemTo.y) / 2 },
        stemTo
      ],
      "rgba(105, 118, 70, 0.85)",
      Math.max(0.6, r * 0.14)
    );
    for (const [t, side] of [
      [0.34, 1],
      [0.62, -1]
    ]) {
      const lx = cx + (stemTo.x - cx) * t + r * 0.16;
      const ly = cy + (stemTo.y - cy) * t;
      ctx.beginPath();
      ctx.ellipse(lx + side * r * 0.42, ly + r * 0.1, r * 0.44, r * 0.17, side * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(122, 138, 82, 0.72)";
      ctx.fill();
      ctx.strokeStyle = "rgba(80, 92, 50, 0.55)";
      ctx.lineWidth = Math.max(0.4, r * 0.05);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.9;
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2 + rnd() * 0.22;
      const px = cx + Math.cos(a) * r * 0.52;
      const py = cy + Math.sin(a) * r * 0.52;
      ctx.beginPath();
      ctx.ellipse(px, py, r * 0.56, r * 0.32, a, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 === 0 ? petal : petalDeep;
      ctx.fill();
      ctx.strokeStyle = mixHex(color, "#4a3a2a", 0.4, 0.45);
      ctx.lineWidth = Math.max(0.35, r * 0.045);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.24, 0, Math.PI * 2);
    ctx.fillStyle = "#a8863c";
    ctx.fill();
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      strokePath(
        ctx,
        [
          { x: cx, y: cy },
          { x: cx + Math.cos(a) * r * 0.3, y: cy + Math.sin(a) * r * 0.3 }
        ],
        "rgba(120, 92, 40, 0.6)",
        Math.max(0.3, r * 0.05)
      );
    }
  }
  function claspBand(ctx, x, y, w, h, m, s, plate) {
    softShadow(ctx, x, y + h * 0.5, w, h, 0.16);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, m.lo);
    g.addColorStop(0.22, m.hi);
    g.addColorStop(0.5, m.mid);
    g.addColorStop(0.82, shadeHex(m.mid, -0.28));
    g.addColorStop(1, m.lo);
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    strokePath(
      ctx,
      [
        { x, y: y + h * 0.5 },
        { x: x + w, y: y + h * 0.5 }
      ],
      shadeHex(m.lo, -0.2, 0.5),
      Math.max(0.5, 0.6 * s)
    );
    const rr = Math.min(h * 0.24, w * 0.06);
    for (const rx of [x + w * 0.14, x + w * 0.86]) {
      ctx.beginPath();
      ctx.arc(rx, y + h * 0.5, rr, 0, Math.PI * 2);
      ctx.fillStyle = m.hi;
      ctx.fill();
      ctx.strokeStyle = shadeHex(m.lo, -0.1, 0.7);
      ctx.lineWidth = Math.max(0.4, 0.5 * s);
      ctx.stroke();
    }
    ctx.strokeStyle = shadeHex(m.lo, -0.3, 0.75);
    ctx.lineWidth = Math.max(0.5, 0.7 * s);
    ctx.strokeRect(x, y, w, h);
    if (plate) {
      const pw = w * 0.3;
      const ph = h * 1.75;
      const px = x + w * 0.5 - pw * 0.5;
      const py = y + h * 0.5 - ph * 0.5;
      const pg = ctx.createLinearGradient(px, py, px, py + ph);
      pg.addColorStop(0, m.hi);
      pg.addColorStop(0.45, m.mid);
      pg.addColorStop(1, m.lo);
      ctx.beginPath();
      const r = Math.min(pw, ph) * 0.28;
      ctx.moveTo(px + r, py);
      ctx.arcTo(px + pw, py, px + pw, py + ph, r);
      ctx.arcTo(px + pw, py + ph, px, py + ph, r);
      ctx.arcTo(px, py + ph, px, py, r);
      ctx.arcTo(px, py, px + pw, py, r);
      ctx.closePath();
      ctx.fillStyle = pg;
      ctx.fill();
      ctx.strokeStyle = shadeHex(m.lo, -0.25, 0.8);
      ctx.lineWidth = Math.max(0.5, 0.7 * s);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(px + pw * 0.5, py + ph * 0.5, pw * 0.16, ph * 0.14, 0, 0, Math.PI * 2);
      ctx.fillStyle = shadeHex(m.lo, -0.5, 0.85);
      ctx.fill();
    }
  }
  function waxSeal(ctx, cx, cy, r, color, s, rnd) {
    softShadow(ctx, cx - r, cy - r * 0.6, r * 2, r * 1.6, 0.22);
    const wax = mixHex(color, "#8a1c18", 0.42);
    const outer = blobPath(cx, cy, r, 16, 0.13, rnd);
    fillPath(ctx, outer, shadeHex(wax, -0.18));
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.36, r * 0.06, cx, cy, r * 1.02);
    g.addColorStop(0, shadeHex(wax, 0.42));
    g.addColorStop(0.55, wax);
    g.addColorStop(1, shadeHex(wax, -0.42));
    const inner = blobPath(cx, cy, r * 0.9, 14, 0.09, rnd);
    fillPath(ctx, inner, "rgba(0,0,0,0)");
    ctx.beginPath();
    const f = inner[0];
    ctx.moveTo(f.x, f.y);
    for (let i = 1; i < inner.length; i++) ctx.lineTo(inner[i].x, inner[i].y);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    const sig = r * 0.56;
    for (const [dx, dy, col, wdt] of [
      [0.7 * s, 0.7 * s, shadeHex(wax, 0.45, 0.7), 1],
      [0, 0, shadeHex(wax, -0.62, 0.9), 1.25]
    ]) {
      ctx.save();
      ctx.translate(dx, dy);
      ctx.beginPath();
      ctx.arc(cx, cy, sig * 0.94, 0, Math.PI * 2);
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(0.9, r * 0.11 * wdt);
      ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI + 0.2;
        strokePath(
          ctx,
          [
            { x: cx - Math.cos(a) * sig * 0.6, y: cy - Math.sin(a) * sig * 0.6 },
            { x: cx + Math.cos(a) * sig * 0.6, y: cy + Math.sin(a) * sig * 0.6 }
          ],
          col,
          Math.max(0.8, r * 0.09 * wdt)
        );
      }
      ctx.restore();
    }
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.36, cy - r * 0.46, r * 0.28, r * 0.14, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 240, 230, 0.26)";
    ctx.fill();
  }
  function kraftTag(ctx, x, y, w, h, color, s, rnd) {
    softShadow(ctx, x, y + h * 0.15, w, h, 0.18);
    const chamfer = Math.min(w * 0.34, h * 0.22);
    const body = [
      { x: x + w * 0.5, y },
      { x: x + w, y: y + chamfer },
      { x: x + w, y: y + h },
      { x, y: y + h },
      { x, y: y + chamfer }
    ];
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, shadeHex(KRAFT, 0.14));
    g.addColorStop(1, shadeHex(KRAFT, -0.12));
    fillPath(ctx, body, "rgba(0,0,0,0)");
    ctx.beginPath();
    const f = body[0];
    ctx.moveTo(f.x, f.y);
    for (let i = 1; i < body.length; i++) ctx.lineTo(body[i].x, body[i].y);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = shadeHex(KRAFT_LO, -0.2, 0.7);
    ctx.lineWidth = Math.max(0.5, 0.7 * s);
    ctx.stroke();
    const holeR = Math.min(w * 0.11, h * 0.09);
    ctx.beginPath();
    ctx.arc(x + w * 0.5, y + chamfer * 0.85, holeR, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(46, 38, 30, 0.72)";
    ctx.fill();
    strokePath(
      ctx,
      [
        { x: x + w * 0.5, y: y + chamfer * 0.85 },
        { x: x + w * 0.5 + (rnd() * 2 - 1) * w * 0.1, y: y - h * 0.42 },
        { x: x + w * 0.34, y: y - h * 0.86 }
      ],
      mixHex(color, "#d9c9a4", 0.35),
      Math.max(0.6, 0.9 * s)
    );
    for (let i = 0; i < 2; i++) {
      const ly = y + h * (0.55 + i * 0.22);
      strokePath(
        ctx,
        [
          { x: x + w * 0.18, y: ly },
          { x: x + w * (0.5 + rnd() * 0.12), y: ly - h * 0.03 },
          { x: x + w * (0.72 + rnd() * 0.1), y: ly }
        ],
        INK,
        Math.max(0.5, 0.7 * s)
      );
    }
  }
  function charmSpineReserve(kind) {
    switch (kind) {
      case "ribbon":
        return { y0: 0.79, y1: 1 };
      case "tassel":
        return { y0: 0, y1: 0.32 };
      case "pressed-flower":
        return { y0: 0, y1: 0.23 };
      case "clasp":
        return { y0: 0.46, y1: 0.59 };
      case "tag":
        return { y0: 0, y1: 0.31 };
      default:
        return null;
    }
  }
  function charmTakesOrnamentSlot(kind) {
    return kind === "wax-seal";
  }
  function drawSpineCharm(ctx, kind, w, h, opts) {
    if (kind === "none") return;
    const { color, rnd } = opts;
    const s = Math.max(0.4, opts.scale);
    const m = metal(opts.gilt);
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    switch (kind) {
      case "ribbon": {
        const rw = clamp(w * 0.34, 4.2 * s, 10 * s);
        const cx = w * 0.6;
        ribbonStrip(ctx, cx, h * 0.79, cx + rw * 0.42, h * 0.995, rw * 0.9, rw * 1.05, color, s, true, 0.34);
        strokePath(
          ctx,
          [
            { x: cx - rw * 0.62, y: h * 0.793 },
            { x: cx + rw * 0.62, y: h * 0.793 }
          ],
          "rgba(30, 24, 18, 0.4)",
          Math.max(0.5, 0.7 * s)
        );
        break;
      }
      case "tassel": {
        const cx = w * 0.64;
        strokePath(
          ctx,
          [
            { x: cx - w * 0.3, y: h * 0.01 },
            { x: cx - w * 0.06, y: h * 0.05 },
            { x: cx, y: h * 0.1 }
          ],
          shadeHex(color, -0.15),
          Math.max(0.9, 1.4 * s)
        );
        tasselBody(ctx, cx, h * 0.145, Math.min(w * 0.62, 17 * s), color, rnd);
        break;
      }
      case "pressed-flower": {
        const cx = w * 0.42;
        pressedFlower(
          ctx,
          cx,
          h * 0.082,
          Math.min(w * 0.42, 12 * s),
          { x: cx + w * 0.26, y: h * 0.2 },
          color,
          rnd
        );
        break;
      }
      case "clasp": {
        const bandH = clamp(h * 0.062, 6 * s, 13 * s);
        claspBand(ctx, -w * 0.02, h * 0.525 - bandH / 2, w * 1.04, bandH, m, s, true);
        break;
      }
      case "wax-seal": {
        waxSeal(ctx, w * 0.5, h * 0.775, Math.min(w * 0.44, 16 * s), color, s, rnd);
        break;
      }
      default: {
        const tw = clamp(w * 0.62, 12 * s, 22 * s);
        const th = tw * 1.35;
        kraftTag(ctx, w * 0.5 - tw / 2, h * 0.115, tw, th, color, s, rnd);
        strokePath(
          ctx,
          [
            { x: 0, y: h * 0.038 },
            { x: w * 0.5, y: h * 0.052 },
            { x: w, y: h * 0.034 }
          ],
          mixHex(color, "#d9c9a4", 0.35),
          Math.max(0.6, 0.9 * s)
        );
        break;
      }
    }
    ctx.restore();
  }

  // src/art/lighting.ts
  var KEY_ANGLE = {
    /** Source upper-left; light travels down-right. */
    upperLeft: Math.PI * 0.25,
    /** Source directly above; light travels straight down. */
    above: Math.PI * 0.5,
    /** Source upper-right; light travels down-left. The house default. */
    upperRight: Math.PI * 0.75,
    /** Source to the right; light travels left. */
    right: Math.PI,
    /** Source to the left; light travels right. */
    left: 0,
    /** Source lower-right; light travels up-left (footlights, hearth). */
    lowerRight: Math.PI * 1.25,
    /** Source below; light travels up. */
    below: Math.PI * 1.5,
    /** Source lower-left; light travels up-right. */
    lowerLeft: Math.PI * 1.75
  };
  function keyToSource(rig) {
    return { x: -Math.cos(rig.keyAngle), y: -Math.sin(rig.keyAngle) };
  }
  var DEFAULT_LIGHT_RIG = {
    id: "golden-hour",
    label: "Golden hour",
    keyAngle: KEY_ANGLE.upperRight,
    keyColour: "#ffd79a",
    keyIntensity: 1,
    hotSpot: 0.5,
    fillColour: "#7f93b8",
    fillIntensity: 0.4,
    ambientColour: "#4a3f33",
    ambientLevel: 0.46,
    ambientOcclusion: 0.55,
    shadowColour: "#2a1e14",
    contactStrength: 0.95,
    groundFlatten: 0.36,
    rimStrength: 0.8,
    rimColour: "#fff0c8",
    rimSharpness: 2.4,
    shafts: [
      {
        origin: { x: 0.88, y: -0.04 },
        angle: Math.PI * 0.72,
        width: 0.16,
        length: 1.5,
        softness: 0.72,
        opacity: 0.18,
        spread: 1.7,
        dust: 0.55
      },
      {
        origin: { x: 1.02, y: 0.1 },
        angle: Math.PI * 0.78,
        width: 0.08,
        length: 1.35,
        softness: 0.85,
        opacity: 0.12,
        spread: 2.1,
        dust: 0.3
      }
    ],
    temperatureShift: 0.55,
    vignette: 0.42,
    vignetteColour: "#231a11",
    vignetteRoundness: 0.35,
    bloom: 0.4,
    bloomThreshold: 0.72,
    exposure: 1.15,
    contrast: 0.18,
    saturation: 1.08,
    hazeColour: "#6d5b46",
    hazeStrength: 0.45,
    // --- deferred: a low, raking sun. Long shadows, every form turning. ---
    keyElevation: 0.32,
    keyWrap: 0.38,
    specular: 0.34,
    keyOrigin: "auto",
    keyFalloff: 0.35,
    keyRadius: 1.15,
    aoRadius: 16,
    aoPower: 1.15,
    aoBias: 0.012,
    bounce: 0.16,
    skyFill: 0.35,
    shadowReach: 100,
    shadowSoftness: 0.4,
    heightScale: 190,
    rimWrap: 0.25,
    temperaturePivot: 0.46,
    shadowTint: 0.2,
    highlightTint: 0.16,
    lift: [-0.06, -0.05, -0.02],
    gamma: [1, 0.99, 0.96],
    gain: [1.05, 1, 0.94],
    tonemap: 0.75,
    bloomRadius: 12,
    bloomKnee: 0.22,
    vignetteFeather: 0.62,
    vignetteExposure: 0.08,
    hazeDepthBias: 0.12,
    localColour: 0.3,
    grain: 9e-3
  };
  var LIGHT_RIGS = {
    /** The default: warm afternoon sun, upper right, deep cool shadows. */
    "golden-hour": DEFAULT_LIGHT_RIG,
    /** Cool white morning through a tall window; crisp, high-key, low haze. */
    "morning-window": {
      ...DEFAULT_LIGHT_RIG,
      id: "morning-window",
      label: "Morning window",
      keyAngle: Math.PI * 0.7,
      keyColour: "#fff4e2",
      keyIntensity: 1.1,
      hotSpot: 0.72,
      fillColour: "#9fb4d6",
      fillIntensity: 0.38,
      ambientColour: "#5a5b60",
      ambientLevel: 0.44,
      ambientOcclusion: 0.6,
      shadowColour: "#2c2a2e",
      rimColour: "#ffffff",
      rimStrength: 0.72,
      temperatureShift: 0.28,
      vignette: 0.3,
      bloom: 0.5,
      bloomThreshold: 0.68,
      saturation: 1.02,
      hazeStrength: 0.3,
      shafts: [
        {
          origin: { x: 0.82, y: -0.05 },
          angle: Math.PI * 0.66,
          width: 0.22,
          length: 1.6,
          softness: 0.8,
          opacity: 0.16,
          spread: 1.5,
          dust: 0.7
        }
      ],
      // --- deferred: higher sun, crisper edges, cooler grade. ---
      keyOrigin: { x: 0.92, y: -0.08 },
      keyFalloff: 0.55,
      keyRadius: 1.1,
      keyElevation: 0.42,
      keyWrap: 0.26,
      specular: 0.4,
      aoRadius: 18,
      aoPower: 1,
      bounce: 0.2,
      skyFill: 0.5,
      shadowReach: 105,
      shadowSoftness: 0.3,
      heightScale: 175,
      temperaturePivot: 0.5,
      shadowTint: 0.24,
      highlightTint: 0.1,
      lift: [-0.03, -0.02, 0.02],
      gamma: [1, 1, 1.02],
      gain: [1.02, 1.02, 1.05],
      tonemap: 0.6,
      bloomRadius: 14,
      vignetteFeather: 0.72,
      grain: 0.011
    },
    /** Flat north-light studio: gentle, almost shadowless, for legibility. */
    "overcast-studio": {
      ...DEFAULT_LIGHT_RIG,
      id: "overcast-studio",
      label: "Overcast studio",
      keyAngle: Math.PI * 0.55,
      keyColour: "#eef1f4",
      keyIntensity: 0.6,
      hotSpot: 0.16,
      fillColour: "#b9c3ce",
      fillIntensity: 0.55,
      ambientColour: "#6d6a66",
      ambientLevel: 0.6,
      ambientOcclusion: 0.42,
      shadowColour: "#3a3833",
      contactStrength: 0.6,
      rimStrength: 0.24,
      rimColour: "#f2f5f8",
      shafts: [],
      temperatureShift: 0.06,
      vignette: 0.18,
      bloom: 0.1,
      bloomThreshold: 0.86,
      exposure: 1.04,
      contrast: 0.12,
      saturation: 0.96,
      hazeStrength: 0.2,
      // --- deferred: no rake at all. Soft dome light, gentle AO, no shafts. ---
      keyOrigin: { x: 0.5, y: -0.3 },
      keyFalloff: 0.12,
      keyRadius: 2,
      keyElevation: 0.86,
      keyWrap: 0.6,
      specular: 0.1,
      aoRadius: 26,
      aoPower: 0.85,
      bounce: 0.28,
      skyFill: 0.7,
      shadowReach: 44,
      shadowSoftness: 0.9,
      heightScale: 150,
      rimWrap: 0.5,
      temperaturePivot: 0.5,
      shadowTint: 0.08,
      highlightTint: 0.04,
      lift: [0.03, 0.03, 0.04],
      gamma: [1.02, 1.02, 1.03],
      gain: [0.99, 0.99, 1],
      tonemap: 0.35,
      bloomRadius: 9,
      vignetteFeather: 0.9,
      grain: 9e-3
    },
    /** A single candle low and close: hot orange core, near-black beyond. */
    candlelit: {
      ...DEFAULT_LIGHT_RIG,
      id: "candlelit",
      label: "Candlelit",
      keyAngle: Math.PI * 1.18,
      keyColour: "#ffb154",
      keyIntensity: 1.15,
      hotSpot: 0.8,
      fillColour: "#4a3a63",
      fillIntensity: 0.16,
      ambientColour: "#2a1d15",
      ambientLevel: 0.14,
      ambientOcclusion: 0.9,
      shadowColour: "#160d08",
      contactStrength: 1.15,
      rimStrength: 1.05,
      rimColour: "#ffd08a",
      rimSharpness: 3.2,
      shafts: [],
      temperatureShift: 0.85,
      vignette: 0.68,
      vignetteColour: "#120a06",
      bloom: 0.62,
      bloomThreshold: 0.6,
      exposure: 0.94,
      contrast: 0.42,
      saturation: 1.16,
      hazeColour: "#4a3220",
      hazeStrength: 0.62,
      // --- deferred: a low close flame. Enormous shadows, near-black beyond. ---
      keyOrigin: { x: 0.32, y: 1.08 },
      keyFalloff: 0.82,
      keyRadius: 0.8,
      localColour: 0.42,
      keyElevation: 0.14,
      keyWrap: 0.42,
      specular: 0.55,
      aoRadius: 30,
      aoPower: 1.5,
      aoBias: 8e-3,
      bounce: 0.1,
      skyFill: 0.12,
      shadowReach: 240,
      shadowSoftness: 0.55,
      heightScale: 230,
      rimWrap: 0.15,
      temperaturePivot: 0.4,
      shadowTint: 0.34,
      highlightTint: 0.3,
      lift: [-0.1, -0.11, -0.09],
      gamma: [0.96, 1, 1.06],
      gain: [1.1, 0.98, 0.84],
      tonemap: 0.9,
      bloomRadius: 16,
      bloomKnee: 0.3,
      vignetteFeather: 0.45,
      vignetteExposure: 0.12,
      grain: 0.01
    },
    /** Cold blue moon through a high window; silver rims, ink shadows. */
    moonlit: {
      ...DEFAULT_LIGHT_RIG,
      id: "moonlit",
      label: "Moonlit",
      keyAngle: Math.PI * 0.8,
      keyColour: "#c4d8f2",
      keyIntensity: 0.72,
      hotSpot: 0.4,
      fillColour: "#3d4f76",
      fillIntensity: 0.24,
      ambientColour: "#1d2233",
      ambientLevel: 0.2,
      ambientOcclusion: 0.86,
      shadowColour: "#0d1120",
      contactStrength: 1.05,
      rimStrength: 0.95,
      rimColour: "#e8f2ff",
      rimSharpness: 3,
      shafts: [
        {
          origin: { x: 0.74, y: -0.06 },
          angle: Math.PI * 0.74,
          width: 0.13,
          length: 1.5,
          softness: 0.78,
          opacity: 0.2,
          spread: 1.9,
          dust: 0.8
        }
      ],
      temperatureShift: -0.5,
      vignette: 0.6,
      vignetteColour: "#080c17",
      bloom: 0.46,
      bloomThreshold: 0.66,
      exposure: 0.92,
      contrast: 0.36,
      saturation: 0.86,
      hazeColour: "#2b3a58",
      hazeStrength: 0.58,
      // --- deferred: hard silver rake, ink shadows, everything cool. ---
      keyOrigin: { x: 0.78, y: -0.12 },
      keyFalloff: 0.6,
      keyRadius: 1.05,
      localColour: 0.4,
      keyElevation: 0.3,
      keyWrap: 0.2,
      specular: 0.45,
      aoRadius: 24,
      aoPower: 1.4,
      bounce: 0.08,
      skyFill: 0.3,
      shadowReach: 165,
      shadowSoftness: 0.3,
      heightScale: 200,
      rimWrap: 0.18,
      temperaturePivot: 0.55,
      shadowTint: 0.4,
      highlightTint: 0.12,
      lift: [-0.08, -0.06, 0],
      gamma: [1.04, 1.02, 0.94],
      gain: [0.9, 0.96, 1.1],
      tonemap: 0.85,
      bloomRadius: 14,
      vignetteFeather: 0.5,
      grain: 0.015
    },
    /** A brass reading lamp just off-frame left: pooled warm light. */
    "lamplit-desk": {
      ...DEFAULT_LIGHT_RIG,
      id: "lamplit-desk",
      label: "Lamplit desk",
      keyAngle: Math.PI * 0.3,
      keyColour: "#ffd9a0",
      keyIntensity: 1.05,
      hotSpot: 0.66,
      fillColour: "#6a7ba0",
      fillIntensity: 0.22,
      ambientColour: "#3a2e24",
      ambientLevel: 0.26,
      ambientOcclusion: 0.8,
      shadowColour: "#211609",
      contactStrength: 1.05,
      rimStrength: 0.86,
      rimColour: "#ffeec4",
      shafts: [
        {
          origin: { x: -0.05, y: 0.06 },
          angle: Math.PI * 0.26,
          width: 0.2,
          length: 1.4,
          softness: 0.88,
          opacity: 0.14,
          spread: 1.8,
          dust: 0.42
        }
      ],
      temperatureShift: 0.7,
      vignette: 0.55,
      bloom: 0.5,
      bloomThreshold: 0.68,
      contrast: 0.32,
      saturation: 1.1,
      hazeStrength: 0.5,
      // --- deferred: a pooled lamp low on the left. ---
      keyOrigin: { x: -0.06, y: 0.18 },
      keyFalloff: 0.72,
      keyRadius: 0.95,
      keyElevation: 0.22,
      keyWrap: 0.34,
      specular: 0.42,
      aoRadius: 24,
      aoPower: 1.25,
      bounce: 0.14,
      skyFill: 0.22,
      shadowReach: 185,
      shadowSoftness: 0.45,
      heightScale: 205,
      temperaturePivot: 0.44,
      shadowTint: 0.26,
      highlightTint: 0.24,
      lift: [-0.07, -0.06, -0.04],
      gamma: [0.98, 1, 1.04],
      gain: [1.08, 1, 0.9],
      tonemap: 0.8,
      bloomRadius: 14,
      grain: 0.013
    },
    /** Storm light: cold, high-contrast, a hard blade of sun through cloud. */
    stormlight: {
      ...DEFAULT_LIGHT_RIG,
      id: "stormlight",
      label: "Stormlight",
      keyAngle: Math.PI * 0.82,
      keyColour: "#e6ecf6",
      keyIntensity: 1.25,
      hotSpot: 0.85,
      fillColour: "#4d5f7d",
      fillIntensity: 0.2,
      ambientColour: "#2b3138",
      ambientLevel: 0.22,
      ambientOcclusion: 0.88,
      shadowColour: "#141920",
      contactStrength: 1.2,
      rimStrength: 1.1,
      rimColour: "#ffffff",
      rimSharpness: 3.6,
      shafts: [
        {
          origin: { x: 0.92, y: -0.08 },
          angle: Math.PI * 0.78,
          width: 0.09,
          length: 1.7,
          softness: 0.42,
          opacity: 0.3,
          spread: 1.35,
          dust: 0.5
        }
      ],
      temperatureShift: -0.24,
      vignette: 0.58,
      vignetteColour: "#0e1319",
      bloom: 0.6,
      bloomThreshold: 0.62,
      exposure: 1,
      contrast: 0.46,
      saturation: 0.92,
      hazeColour: "#54637a",
      hazeStrength: 0.6,
      // --- deferred: a hard blade through cloud. The sharpest shadows we ship. ---
      keyOrigin: { x: 0.96, y: -0.1 },
      keyFalloff: 0.45,
      keyRadius: 1.25,
      keyElevation: 0.2,
      keyWrap: 0.14,
      specular: 0.5,
      aoRadius: 20,
      aoPower: 1.35,
      bounce: 0.1,
      skyFill: 0.3,
      shadowReach: 200,
      shadowSoftness: 0.16,
      heightScale: 210,
      rimWrap: 0.12,
      temperaturePivot: 0.52,
      shadowTint: 0.3,
      highlightTint: 0.06,
      lift: [-0.09, -0.08, -0.04],
      gamma: [1.02, 1.01, 0.98],
      gain: [0.96, 1, 1.06],
      tonemap: 0.9,
      bloomRadius: 15,
      vignetteFeather: 0.5,
      grain: 9e-3
    },
    /** Neon: magenta key, cyan fill, the complementary clash done deliberately. */
    "neon-arcade": {
      ...DEFAULT_LIGHT_RIG,
      id: "neon-arcade",
      label: "Neon arcade",
      keyAngle: Math.PI * 0.72,
      keyColour: "#ff5fb0",
      keyIntensity: 1.1,
      hotSpot: 0.8,
      fillColour: "#38e8ff",
      fillIntensity: 0.42,
      ambientColour: "#1a1030",
      ambientLevel: 0.24,
      ambientOcclusion: 0.82,
      shadowColour: "#120a24",
      contactStrength: 1.1,
      rimStrength: 1.2,
      rimColour: "#8ff6ff",
      rimSharpness: 3.4,
      shafts: [
        {
          origin: { x: 0.9, y: -0.05 },
          angle: Math.PI * 0.74,
          width: 0.14,
          length: 1.5,
          softness: 0.7,
          opacity: 0.22,
          spread: 1.7,
          dust: 0.6
        },
        {
          origin: { x: 0.1, y: -0.05 },
          angle: Math.PI * 0.34,
          width: 0.1,
          length: 1.3,
          softness: 0.8,
          opacity: 0.16,
          colour: "#38e8ff",
          spread: 1.9,
          dust: 0.4
        }
      ],
      temperatureShift: 0.1,
      vignette: 0.62,
      vignetteColour: "#0d0620",
      bloom: 0.8,
      bloomThreshold: 0.55,
      exposure: 1,
      contrast: 0.4,
      saturation: 1.3,
      hazeColour: "#3a2258",
      hazeStrength: 0.55,
      // --- deferred: magenta rake, cyan bounce, everything glowing. ---
      keyOrigin: { x: 0.9, y: -0.05 },
      keyFalloff: 0.55,
      keyRadius: 1.1,
      localColour: 0.5,
      keyElevation: 0.24,
      keyWrap: 0.32,
      specular: 0.6,
      aoRadius: 22,
      aoPower: 1.2,
      bounce: 0.26,
      skyFill: 0.28,
      shadowReach: 170,
      shadowSoftness: 0.35,
      heightScale: 200,
      rimWrap: 0.2,
      temperaturePivot: 0.5,
      shadowTint: 0.45,
      highlightTint: 0.4,
      lift: [-0.04, -0.08, 0.02],
      gamma: [1, 1.02, 0.95],
      gain: [1.06, 0.96, 1.12],
      tonemap: 0.8,
      bloomRadius: 16,
      bloomKnee: 0.3,
      vignetteFeather: 0.45,
      grain: 9e-3
    },
    /** Underwater: green-blue key from above, everything hazed and soft. */
    "reef-caustics": {
      ...DEFAULT_LIGHT_RIG,
      id: "reef-caustics",
      label: "Reef caustics",
      keyAngle: Math.PI * 0.56,
      keyColour: "#bff3ea",
      keyIntensity: 0.95,
      hotSpot: 0.55,
      fillColour: "#2f7fa8",
      fillIntensity: 0.5,
      ambientColour: "#123a4c",
      ambientLevel: 0.4,
      ambientOcclusion: 0.62,
      shadowColour: "#0b2634",
      contactStrength: 0.8,
      rimStrength: 0.7,
      rimColour: "#e6fffb",
      shafts: [
        {
          origin: { x: 0.3, y: -0.06 },
          angle: Math.PI * 0.54,
          width: 0.11,
          length: 1.6,
          softness: 0.85,
          opacity: 0.2,
          spread: 2.2,
          dust: 0.85
        },
        {
          origin: { x: 0.62, y: -0.06 },
          angle: Math.PI * 0.5,
          width: 0.08,
          length: 1.5,
          softness: 0.9,
          opacity: 0.16,
          spread: 2.4,
          dust: 0.7
        },
        {
          origin: { x: 0.86, y: -0.06 },
          angle: Math.PI * 0.58,
          width: 0.13,
          length: 1.4,
          softness: 0.86,
          opacity: 0.14,
          spread: 2,
          dust: 0.6
        }
      ],
      temperatureShift: -0.42,
      vignette: 0.48,
      vignetteColour: "#07202c",
      bloom: 0.44,
      bloomThreshold: 0.7,
      exposure: 1,
      contrast: 0.2,
      saturation: 1.04,
      hazeColour: "#2a7390",
      hazeStrength: 0.82,
      // --- deferred: light from above through water. Soft, hazy, high skyFill. ---
      keyOrigin: { x: 0.5, y: -0.25 },
      keyFalloff: 0.3,
      keyRadius: 1.6,
      localColour: 0.45,
      keyElevation: 0.6,
      keyWrap: 0.5,
      specular: 0.3,
      aoRadius: 28,
      aoPower: 0.95,
      bounce: 0.3,
      skyFill: 0.65,
      shadowReach: 90,
      shadowSoftness: 0.75,
      heightScale: 165,
      rimWrap: 0.4,
      temperaturePivot: 0.5,
      shadowTint: 0.3,
      highlightTint: 0.1,
      lift: [-0.02, 0.02, 0.05],
      gamma: [1.05, 1, 0.97],
      gain: [0.9, 1.02, 1.08],
      tonemap: 0.55,
      bloomRadius: 16,
      vignetteFeather: 0.7,
      hazeDepthBias: 0.04,
      grain: 0.01
    },
    /** A forge/hearth from below-right: dramatic uplight, sooty shadows. */
    "ember-forge": {
      ...DEFAULT_LIGHT_RIG,
      id: "ember-forge",
      label: "Ember forge",
      keyAngle: Math.PI * 1.32,
      keyColour: "#ff8a3d",
      keyIntensity: 1.2,
      hotSpot: 0.86,
      fillColour: "#3c4d76",
      fillIntensity: 0.18,
      ambientColour: "#241812",
      ambientLevel: 0.16,
      ambientOcclusion: 0.92,
      shadowColour: "#150b06",
      contactStrength: 1.2,
      rimStrength: 1.15,
      rimColour: "#ffc06a",
      rimSharpness: 3,
      shafts: [],
      temperatureShift: 0.9,
      vignette: 0.7,
      vignetteColour: "#100704",
      bloom: 0.72,
      bloomThreshold: 0.58,
      exposure: 0.96,
      contrast: 0.5,
      saturation: 1.22,
      hazeColour: "#4d2a16",
      hazeStrength: 0.7,
      // --- deferred: uplight from a forge. Shadows climb the wall. ---
      keyOrigin: { x: 0.6, y: 1.1 },
      keyFalloff: 0.8,
      keyRadius: 0.85,
      localColour: 0.45,
      keyElevation: 0.16,
      keyWrap: 0.38,
      specular: 0.6,
      aoRadius: 28,
      aoPower: 1.45,
      bounce: 0.12,
      skyFill: 0.1,
      shadowReach: 230,
      shadowSoftness: 0.4,
      heightScale: 225,
      rimWrap: 0.16,
      temperaturePivot: 0.42,
      shadowTint: 0.36,
      highlightTint: 0.34,
      lift: [-0.1, -0.1, -0.08],
      gamma: [0.95, 1, 1.08],
      gain: [1.14, 0.96, 0.8],
      tonemap: 0.92,
      bloomRadius: 16,
      vignetteFeather: 0.42,
      grain: 0.01
    },
    /** Pale pink dawn with heavy mist — the softest rig in the set. */
    "dawn-mist": {
      ...DEFAULT_LIGHT_RIG,
      id: "dawn-mist",
      label: "Dawn mist",
      keyAngle: Math.PI * 0.86,
      keyColour: "#ffd8d0",
      keyIntensity: 0.8,
      hotSpot: 0.45,
      fillColour: "#a9b8d8",
      fillIntensity: 0.48,
      ambientColour: "#6b6472",
      ambientLevel: 0.5,
      ambientOcclusion: 0.5,
      shadowColour: "#3b3542",
      contactStrength: 0.7,
      rimStrength: 0.55,
      rimColour: "#fff2ec",
      shafts: [
        {
          origin: { x: 1.02, y: 0.14 },
          angle: Math.PI * 0.88,
          width: 0.3,
          length: 1.5,
          softness: 0.95,
          opacity: 0.2,
          spread: 1.4,
          dust: 0.9
        }
      ],
      temperatureShift: 0.3,
      vignette: 0.26,
      vignetteColour: "#3a3040",
      bloom: 0.55,
      bloomThreshold: 0.64,
      exposure: 1.06,
      contrast: 0.14,
      saturation: 0.94,
      hazeColour: "#b0a8b8",
      hazeStrength: 0.9,
      // --- deferred: the softest rig. Haze everywhere, shadows barely there. ---
      keyOrigin: { x: 1.06, y: 0.12 },
      keyFalloff: 0.35,
      keyRadius: 1.5,
      localColour: 0.3,
      keyElevation: 0.5,
      keyWrap: 0.55,
      specular: 0.16,
      aoRadius: 30,
      aoPower: 0.8,
      bounce: 0.3,
      skyFill: 0.6,
      shadowReach: 70,
      shadowSoftness: 0.85,
      heightScale: 150,
      rimWrap: 0.45,
      temperaturePivot: 0.5,
      shadowTint: 0.2,
      highlightTint: 0.14,
      lift: [0.05, 0.03, 0.05],
      gamma: [1, 1.02, 1.04],
      gain: [1.04, 1, 1.02],
      tonemap: 0.4,
      bloomRadius: 16,
      vignetteFeather: 0.95,
      hazeDepthBias: 0.02,
      grain: 9e-3
    },
    /** Blazing midday: the highest-contrast, most blown-out rig we ship. */
    "noon-blaze": {
      ...DEFAULT_LIGHT_RIG,
      id: "noon-blaze",
      label: "Noon blaze",
      keyAngle: Math.PI * 0.52,
      keyColour: "#fff6d8",
      keyIntensity: 1.35,
      hotSpot: 0.92,
      fillColour: "#8fa6c8",
      fillIntensity: 0.26,
      ambientColour: "#4d4235",
      ambientLevel: 0.3,
      ambientOcclusion: 0.84,
      shadowColour: "#241b12",
      contactStrength: 1.25,
      groundFlatten: 0.24,
      rimStrength: 0.9,
      rimColour: "#ffffff",
      rimSharpness: 3.8,
      shafts: [
        {
          origin: { x: 0.55, y: -0.08 },
          angle: Math.PI * 0.52,
          width: 0.26,
          length: 1.7,
          softness: 0.6,
          opacity: 0.16,
          spread: 1.3,
          dust: 0.65
        }
      ],
      temperatureShift: 0.42,
      vignette: 0.5,
      bloom: 0.75,
      bloomThreshold: 0.6,
      exposure: 1.05,
      contrast: 0.44,
      saturation: 1.12,
      hazeStrength: 0.36,
      // --- deferred: sun overhead. Short hard shadows, blown highlights. ---
      keyOrigin: { x: 0.55, y: -0.2 },
      keyFalloff: 0.3,
      keyRadius: 1.6,
      localColour: 0.34,
      keyElevation: 0.72,
      keyWrap: 0.18,
      specular: 0.5,
      aoRadius: 16,
      aoPower: 1.3,
      bounce: 0.18,
      skyFill: 0.55,
      shadowReach: 70,
      shadowSoftness: 0.2,
      heightScale: 180,
      rimWrap: 0.2,
      temperaturePivot: 0.55,
      shadowTint: 0.24,
      highlightTint: 0.18,
      lift: [-0.05, -0.04, -0.02],
      gamma: [1, 1, 0.98],
      gain: [1.06, 1.03, 0.96],
      tonemap: 0.95,
      bloomRadius: 16,
      vignetteFeather: 0.6,
      grain: 9e-3
    },
    /**
     * Sun through glass and leaves: green-gold, dappled, high skyFill, the light
     * of a conservatory at eleven in the morning. The rig the flora themes want.
     */
    greenhouse: {
      ...DEFAULT_LIGHT_RIG,
      id: "greenhouse",
      label: "Greenhouse daylight",
      keyAngle: Math.PI * 0.64,
      keyColour: "#f6f0c4",
      keyIntensity: 1.08,
      hotSpot: 0.6,
      fillColour: "#8fc39a",
      fillIntensity: 0.44,
      ambientColour: "#4c5a42",
      ambientLevel: 0.42,
      ambientOcclusion: 0.62,
      shadowColour: "#22301f",
      contactStrength: 0.9,
      rimStrength: 0.78,
      rimColour: "#f2ffd8",
      rimSharpness: 2.2,
      shafts: [
        {
          origin: { x: 0.72, y: -0.06 },
          angle: Math.PI * 0.62,
          width: 0.2,
          length: 1.55,
          softness: 0.82,
          opacity: 0.19,
          colour: "#eaf7c0",
          spread: 1.6,
          dust: 0.75
        },
        {
          origin: { x: 0.24, y: -0.06 },
          angle: Math.PI * 0.58,
          width: 0.1,
          length: 1.3,
          softness: 0.9,
          opacity: 0.12,
          colour: "#d8f0a8",
          spread: 2.1,
          dust: 0.6
        }
      ],
      temperatureShift: 0.3,
      vignette: 0.36,
      vignetteColour: "#20291c",
      bloom: 0.52,
      bloomThreshold: 0.66,
      exposure: 1.04,
      contrast: 0.26,
      saturation: 1.14,
      hazeColour: "#7f9a68",
      hazeStrength: 0.5,
      // --- deferred: mid-high sun filtered through canopy. ---
      keyOrigin: { x: 0.72, y: -0.14 },
      keyFalloff: 0.42,
      keyRadius: 1.3,
      localColour: 0.36,
      keyElevation: 0.44,
      keyWrap: 0.36,
      specular: 0.36,
      aoRadius: 24,
      aoPower: 1.05,
      bounce: 0.24,
      skyFill: 0.6,
      shadowReach: 120,
      shadowSoftness: 0.5,
      heightScale: 180,
      rimWrap: 0.3,
      temperaturePivot: 0.48,
      shadowTint: 0.28,
      highlightTint: 0.14,
      lift: [-0.03, 0, -0.02],
      gamma: [1, 0.98, 1.02],
      gain: [1.02, 1.05, 0.94],
      tonemap: 0.65,
      bloomRadius: 14,
      vignetteFeather: 0.7,
      grain: 0.011
    }
  };
  var LIGHT_RIG_IDS = Object.keys(LIGHT_RIGS);
  function getLightRig(id) {
    if (typeof id !== "string") return DEFAULT_LIGHT_RIG;
    return LIGHT_RIGS[id] ?? DEFAULT_LIGHT_RIG;
  }

  // src/render/normals.ts
  function clamp012(x) {
    return x < 0 ? 0 : x > 1 ? 1 : x;
  }
  function num(v, fallback, lo = -1e6, hi = 1e6) {
    if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
    return v < lo ? lo : v > hi ? hi : v;
  }
  function smoothstep01(x) {
    const t = clamp012(x);
    return t * t * (3 - 2 * t);
  }
  function normalFromSlope(dhdu, dhdv, scale = 1) {
    const nx = -dhdu * scale;
    const ny = -dhdv * scale;
    const len = Math.hypot(nx, ny, 1);
    return { nx: nx / len, ny: ny / len, h: 0, a: 1 };
  }
  function sampleShape(shape, u, v) {
    const uu = clamp012(Number.isFinite(u) ? u : 0);
    const vv = clamp012(Number.isFinite(v) ? v : 0);
    switch (shape?.kind) {
      case "plane": {
        const h = num(shape.height, 0, 0, 1);
        const tx = num(shape.tiltX, 0, -1.5, 1.5);
        const ty = num(shape.tiltY, 0, -1.5, 1.5);
        const n = normalFromSlope(Math.tan(tx), Math.tan(ty), 1);
        return { nx: n.nx, ny: n.ny, h, a: 1 };
      }
      case "roundedBox": {
        const axis = shape.axis === "y" ? "y" : "x";
        const r = num(shape.radius, 0.22, 1e-3, 0.5);
        const top = num(shape.height, 0.6, 0, 1);
        const edge = num(shape.edgeHeight, top * 0.55, 0, 1);
        const cross = num(shape.crossRadius, 0.04, 0, 0.5);
        const lean = num(shape.lean, 0, -1.2, 1.2);
        const main = axis === "x" ? uu : vv;
        const off = axis === "x" ? vv : uu;
        const dMain = Math.min(main, 1 - main) / r;
        const tMain = clamp012(dMain);
        const rollMain = Math.sin(tMain * Math.PI / 2);
        const hMain = edge + (top - edge) * rollMain;
        const slopeMag = tMain >= 1 ? 0 : (top - edge) * (Math.PI / 2) * Math.cos(tMain * Math.PI / 2) / Math.max(1e-3, r);
        const signMain = main < 0.5 ? 1 : -1;
        let hCross = 1;
        let slopeCross = 0;
        if (cross > 1e-3) {
          const dCross = clamp012(Math.min(off, 1 - off) / cross);
          hCross = 0.72 + 0.28 * Math.sin(dCross * Math.PI / 2);
          slopeCross = dCross >= 1 ? 0 : 0.28 * (Math.PI / 2) * Math.cos(dCross * Math.PI / 2) / Math.max(1e-3, cross);
          slopeCross *= off < 0.5 ? 1 : -1;
        }
        const h = clamp012(hMain * hCross);
        const dU = axis === "x" ? slopeMag * signMain : slopeCross * hMain;
        const dV = axis === "x" ? slopeCross * hMain : slopeMag * signMain;
        const n = normalFromSlope(dU + Math.tan(lean), dV, 1.35);
        return { nx: n.nx, ny: n.ny, h, a: 1 };
      }
      case "bevel": {
        const size = num(shape.size, 0.12, 1e-3, 0.5);
        const top = num(shape.height, 0.5, 0, 1);
        const edge = num(shape.edgeHeight, top * 0.4, 0, 1);
        const round = num(shape.round, 0.45, 0, 1);
        const e = shape.edges ?? { left: true, right: true, top: true, bottom: true };
        const dl = e.left === false ? 1 : uu / size;
        const dr = e.right === false ? 1 : (1 - uu) / size;
        const dt = e.top === false ? 1 : vv / size;
        const db = e.bottom === false ? 1 : (1 - vv) / size;
        const ramp = (d) => {
          const t = clamp012(d);
          return round <= 0 ? t : t * (1 - round) + smoothstep01(t) * round;
        };
        const rl = ramp(dl);
        const rr = ramp(dr);
        const rt = ramp(dt);
        const rb = ramp(db);
        const tMin = Math.min(rl, rr, rt, rb);
        const h = clamp012(edge + (top - edge) * tMin);
        const grad = (d, sign) => {
          const t = clamp012(d);
          if (t >= 1) return 0;
          const base = round <= 0 ? 1 : 1 - round + round * 6 * t * (1 - t);
          return sign * (top - edge) * base / Math.max(1e-3, size);
        };
        let dU = 0;
        let dV = 0;
        if (rl === tMin) dU += grad(dl, 1);
        if (rr === tMin) dU += grad(dr, -1);
        if (rt === tMin) dV += grad(dt, 1);
        if (rb === tMin) dV += grad(db, -1);
        const n = normalFromSlope(dU, dV, 1.15);
        return { nx: n.nx, ny: n.ny, h, a: 1 };
      }
      case "dome": {
        const top = num(shape.height, 0.55, 0, 1);
        const edge = num(shape.edgeHeight, top * 0.35, 0, 1);
        const power = num(shape.power, 1, 0.15, 6);
        const rib = num(shape.rib, 0, 0, 1);
        const ribAxis = shape.ribAxis === "x" ? "x" : "y";
        const elongate = num(shape.elongate, 0, 0, 0.95);
        const cx = uu * 2 - 1;
        const cy = vv * 2 - 1;
        const sx = 1 - elongate * 0;
        const sy = 1 / (1 - elongate * 0.85);
        const ex = cx * sx;
        const ey = cy / sy;
        const r2 = ex * ex + ey * ey;
        if (r2 >= 1) return { nx: 0, ny: 0, h: edge, a: 0 };
        const dome = Math.pow(1 - r2, 0.5 * power);
        let h = edge + (top - edge) * dome;
        const k = -(top - edge) * power * Math.pow(Math.max(1e-4, 1 - r2), 0.5 * power - 1);
        let dU = k * ex * sx * 2;
        let dV = k * ey * 2 / sy;
        if (rib > 1e-3) {
          const t = ribAxis === "y" ? cx : cy;
          const crease = Math.exp(-(t * t) / 0.02);
          h -= rib * 0.16 * crease * dome;
          const dcrease = -2 * t / 0.02 * crease;
          if (ribAxis === "y") dU -= rib * 0.16 * dcrease * dome * 2;
          else dV -= rib * 0.16 * dcrease * dome * 2;
        }
        const n = normalFromSlope(dU, dV, 0.85);
        const a = smoothstep01((1 - Math.sqrt(r2)) / 0.06);
        return { nx: n.nx, ny: n.ny, h: clamp012(h), a };
      }
      case "cylinder": {
        const axis = shape.axis === "y" ? "y" : "x";
        const top = num(shape.height, 0.5, 0, 1);
        const edge = num(shape.edgeHeight, 0.1, 0, 1);
        const taper = num(shape.taper, 0, 0, 1);
        const across = axis === "x" ? vv : uu;
        const along = axis === "x" ? uu : vv;
        const width = 1 - taper * along;
        const c = (across - 0.5) / Math.max(1e-3, width * 0.5) / 2 + 0.5;
        const t = (clamp012(c) - 0.5) * 2;
        if (Math.abs(t) >= 1) return { nx: 0, ny: 0, h: edge, a: 0 };
        const prof = Math.sqrt(Math.max(0, 1 - t * t));
        const h = clamp012(edge + (top - edge) * prof);
        const slope = -(top - edge) * t / Math.max(1e-3, prof) / Math.max(1e-3, width);
        const dU = axis === "x" ? 0 : slope;
        const dV = axis === "x" ? slope : 0;
        const n = normalFromSlope(dU, dV, 0.9);
        const a = smoothstep01((1 - Math.abs(t)) / 0.09);
        return { nx: n.nx, ny: n.ny, h, a };
      }
      case "sphere": {
        const top = num(shape.height, 0.6, 0, 1);
        const squash = num(shape.squash, 1, 0.1, 1);
        const cx = uu * 2 - 1;
        const cy = vv * 2 - 1;
        const r2 = cx * cx + cy * cy;
        if (r2 >= 1) return { nx: 0, ny: 0, h: 0, a: 0 };
        const z = Math.sqrt(1 - r2);
        const h = clamp012(top * z * squash);
        const len = Math.hypot(cx, cy, z / Math.max(0.1, squash));
        const a = smoothstep01((1 - Math.sqrt(r2)) / 0.05);
        return { nx: cx / len, ny: cy / len, h, a };
      }
      case "wedge": {
        const axis = shape.axis === "y" ? "y" : "x";
        const from = num(shape.from, 0.1, 0, 1);
        const to = num(shape.to, 0.7, 0, 1);
        const round = num(shape.round, 0.2, 0, 1);
        const t = axis === "x" ? uu : vv;
        const shaped = t * (1 - round) + smoothstep01(t) * round;
        const h = clamp012(from + (to - from) * shaped);
        const d = (to - from) * (1 - round + round * 6 * t * (1 - t));
        const n = normalFromSlope(axis === "x" ? d : 0, axis === "x" ? 0 : d, 1);
        return { nx: n.nx, ny: n.ny, h, a: 1 };
      }
      case "groove": {
        const axis = shape.axis === "y" ? "y" : "x";
        const surface = num(shape.height, 0.5, 0, 1);
        const depth = num(shape.depth, 0.18, 0, 1);
        const width = num(shape.width, 0.35, 0.01, 1);
        const round = num(shape.round, 0.6, 0, 1);
        const t = axis === "x" ? uu : vv;
        const d = Math.abs(t - 0.5) / (width * 0.5);
        const inside = clamp012(1 - d);
        const dish = round <= 0 ? d < 1 ? 1 : 0 : Math.pow(inside, 1 + round);
        const h = clamp012(surface - depth * dish);
        const slope = d >= 1 ? 0 : depth * (1 + round) * Math.pow(Math.max(1e-4, inside), round) / (width * 0.5);
        const sign = t < 0.5 ? -1 : 1;
        const dU = axis === "x" ? slope * sign : 0;
        const dV = axis === "x" ? 0 : slope * sign;
        const n = normalFromSlope(dU, dV, 1.5);
        return { nx: n.nx, ny: n.ny, h, a: 1 };
      }
      case "ribs": {
        const axis = shape.axis === "y" ? "y" : "x";
        const base = num(shape.height, 0.5, 0, 1);
        const amp = num(shape.amplitude, 0.1, 0, 1);
        const count = Math.max(1, Math.round(num(shape.count, 6, 1, 64)));
        const round = num(shape.round, 0.75, 0, 1);
        const t = axis === "x" ? uu : vv;
        const phase = t * count * Math.PI * 2;
        const sine = (Math.sin(phase) + 1) * 0.5;
        const square = sine > 0.5 ? 1 : 0;
        const prof = square * (1 - round) + sine * round;
        const h = clamp012(base + amp * (prof - 0.5));
        const d = amp * round * Math.cos(phase) * count * Math.PI;
        const n = normalFromSlope(axis === "x" ? d : 0, axis === "x" ? 0 : d, 1);
        return { nx: n.nx, ny: n.ny, h, a: 1 };
      }
      default:
        return { nx: 0, ny: 0, h: 0, a: 1 };
    }
  }
  function encodeSurface(p) {
    const q = (v) => {
      const x = Math.round(clamp012(v * 0.5 + 0.5) * 255);
      return x < 0 ? 0 : x > 255 ? 255 : x;
    };
    return [q(p.nx), q(p.ny), Math.round(clamp012(p.h) * 255), Math.round(clamp012(p.a) * 255)];
  }
  var PROFILE_MAX = 128;
  function profileSize(shape, w, h) {
    const cw = Math.max(1, Math.min(PROFILE_MAX, Math.ceil(w)));
    const ch = Math.max(1, Math.min(PROFILE_MAX, Math.ceil(h)));
    switch (shape.kind) {
      case "plane":
        return [2, 2];
      case "wedge":
      case "groove":
      case "ribs":
        return shape.axis === "y" ? [2, ch] : [cw, 2];
      case "roundedBox":
        return shape.axis === "y" ? [24, ch] : [cw, 24];
      case "cylinder":
        return shape.axis === "y" ? [cw, 16] : [16, ch];
      default:
        return [cw, ch];
    }
  }
  function shapeKey(shape, w, h) {
    const [pw, ph] = profileSize(shape, w, h);
    const parts = [shape.kind, String(pw), String(ph)];
    for (const [k, v] of Object.entries(shape)) {
      if (k === "kind") continue;
      if (typeof v === "number") parts.push(`${k}:${v.toFixed(4)}`);
      else if (typeof v === "boolean") parts.push(`${k}:${v ? 1 : 0}`);
      else if (v !== null && typeof v === "object") parts.push(`${k}:${JSON.stringify(v)}`);
    }
    return parts.join("|");
  }
  function rasterizeShape2(shape, width, height) {
    const [w, h] = profileSize(shape, width, height);
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const v = h === 1 ? 0.5 : (y + 0.5) / h;
      for (let x = 0; x < w; x++) {
        const u = w === 1 ? 0.5 : (x + 0.5) / w;
        const p = sampleShape(shape, u, v);
        const [r, g, b, a] = encodeSurface(p);
        const i = (y * w + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = a;
      }
    }
    return { data, width: w, height: h };
  }
  var canvasCache = /* @__PURE__ */ new Map();
  function makeCanvas(w, h) {
    const cw = Math.max(1, Math.ceil(w));
    const ch = Math.max(1, Math.ceil(h));
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(cw, ch);
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    return c;
  }
  function shapeCanvas(shape, w, h) {
    const key = shapeKey(shape, w, h);
    const hit = canvasCache.get(key);
    if (hit !== void 0) return hit;
    const raster = rasterizeShape2(shape, w, h);
    const canvas2 = makeCanvas(raster.width, raster.height);
    if (canvas2 === null) return null;
    const ctx = canvas2.getContext("2d");
    if (ctx === null) return null;
    const img = ctx.createImageData(raster.width, raster.height);
    img.data.set(raster.data);
    ctx.putImageData(img, 0, 0);
    canvasCache.set(key, canvas2);
    return canvas2;
  }
  function emitHeight(ctx, shape, opts) {
    const w = opts.width;
    const h = opts.height;
    if (!(w > 0) || !(h > 0)) return;
    const canvas2 = shapeCanvas(shape, w, h);
    if (canvas2 === null) return;
    const rot = opts.rotation ?? 0;
    const alpha = clamp012(opts.opacity ?? 1);
    if (alpha <= 2e-3) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "source-over";
    if (rot !== 0) {
      ctx.translate(opts.x + w / 2, opts.y + h / 2);
      ctx.rotate(rot);
      ctx.translate(-w / 2, -h / 2);
      ctx.drawImage(canvas2, 0, 0, w, h);
    } else {
      ctx.drawImage(canvas2, opts.x, opts.y, w, h);
    }
    ctx.restore();
    const scale = opts.heightScale ?? 1;
    const offset = opts.heightOffset ?? 0;
    if (scale === 1 && offset === 0) return;
    ctx.save();
    if (rot !== 0) {
      ctx.translate(opts.x + w / 2, opts.y + h / 2);
      ctx.rotate(rot);
      ctx.translate(-w / 2 - opts.x, -h / 2 - opts.y);
    }
    if (scale !== 1) {
      ctx.globalCompositeOperation = "multiply";
      const k = Math.round(clamp012(scale) * 255);
      ctx.fillStyle = `rgb(255, 255, ${k})`;
      ctx.fillRect(opts.x, opts.y, w, h);
    }
    if (offset !== 0) {
      ctx.globalCompositeOperation = offset > 0 ? "lighter" : "multiply";
      const k = Math.round(clamp012(Math.abs(offset)) * 255);
      ctx.fillStyle = offset > 0 ? `rgb(0, 0, ${k})` : `rgb(255, 255, ${Math.max(0, 255 - k)})`;
      ctx.fillRect(opts.x, opts.y, w, h);
    }
    ctx.restore();
  }
  function emitSpines(ctx, books) {
    for (const b of books) {
      const proud = clamp012(b.proud ?? 0.5);
      emitHeight(
        ctx,
        {
          kind: "roundedBox",
          axis: "x",
          radius: b.radius ?? 0.24,
          height: 0.42 + proud * 0.5,
          edgeHeight: (0.42 + proud * 0.5) * 0.5,
          crossRadius: 0.035,
          ...b.lean !== void 0 ? { lean: b.lean } : {}
        },
        { x: b.x, y: b.y, width: b.width, height: b.height, ...b.lean !== void 0 ? { rotation: b.lean * 0.35 } : {} }
      );
      const bands = b.bands ?? 0;
      if (bands > 0) {
        emitHeight(
          ctx,
          { kind: "ribs", axis: "y", height: 0.5, amplitude: 0.16, count: bands, round: 0.55 },
          {
            x: b.x + b.width * 0.06,
            y: b.y + b.height * 0.06,
            width: b.width * 0.88,
            height: b.height * 0.88,
            opacity: 0.5
          }
        );
      }
    }
  }

  // src/art/spines.ts
  var MAX_BOARD_STYLE = 2;
  var MAX_RAISED_BANDS = 5;
  var SPINE_HEIGHT_RANGE = { min: 132, max: 300 };
  var SPINE_THICKNESS_RANGE = { min: 8, max: 58 };
  var SPINE_FORMATS = {
    folio: { min: 268, max: 300, label: "Folio" },
    quarto: { min: 238, max: 272, label: "Quarto" },
    octavo: { min: 204, max: 244, label: "Octavo" },
    duodecimo: { min: 170, max: 212, label: "Duodecimo" },
    pocket: { min: 134, max: 178, label: "Pocket" }
  };
  var SPINE_FORMAT_IDS = Object.keys(SPINE_FORMATS);
  var SPINE_BASE_HEIGHT = 232;
  var PALETTES = [
    [{ h: 38, s: 64, l: 52 }, { h: 28, s: 62, l: 31 }],
    // 0  amber
    [{ h: 16, s: 58, l: 47 }, { h: 8, s: 56, l: 27 }],
    // 1  terracotta
    [{ h: 95, s: 30, l: 41 }, { h: 102, s: 34, l: 23 }],
    // 2  moss
    [{ h: 210, s: 28, l: 46 }, { h: 216, s: 34, l: 26 }],
    // 3  dusty blue
    [{ h: 315, s: 26, l: 39 }, { h: 322, s: 32, l: 21 }],
    // 4  plum
    [{ h: 44, s: 62, l: 46 }, { h: 38, s: 58, l: 27 }],
    // 5  ochre
    [{ h: 130, s: 18, l: 51 }, { h: 136, s: 22, l: 31 }],
    // 6  sage
    [{ h: 22, s: 62, l: 39 }, { h: 16, s: 62, l: 22 }],
    // 7  rust
    [{ h: 28, s: 40, l: 51 }, { h: 22, s: 38, l: 31 }],
    // 8  clay
    [{ h: 70, s: 32, l: 37 }, { h: 64, s: 36, l: 21 }],
    // 9  olive
    [{ h: 200, s: 20, l: 41 }, { h: 206, s: 24, l: 23 }],
    // 10 slate
    [{ h: 355, s: 34, l: 55 }, { h: 348, s: 34, l: 35 }],
    // 11 blush
    // --- the deep range the reference is actually built from -----------------
    [{ h: 2, s: 54, l: 33 }, { h: 356, s: 56, l: 17 }],
    // 12 oxblood
    [{ h: 220, s: 46, l: 29 }, { h: 226, s: 50, l: 15 }],
    // 13 navy
    [{ h: 148, s: 36, l: 27 }, { h: 154, s: 40, l: 14 }],
    // 14 forest
    [{ h: 33, s: 46, l: 60 }, { h: 27, s: 42, l: 40 }],
    // 15 tan
    [{ h: 44, s: 40, l: 83 }, { h: 38, s: 32, l: 62 }],
    // 16 cream
    [{ h: 212, s: 12, l: 25 }, { h: 214, s: 14, l: 11 }],
    // 17 ink
    [{ h: 186, s: 36, l: 33 }, { h: 192, s: 40, l: 18 }],
    // 18 teal
    [{ h: 36, s: 76, l: 55 }, { h: 28, s: 72, l: 34 }]
    // 19 saffron
  ];
  var FONTS = [
    '"Caveat Variable", "Caveat", cursive',
    '"Kalam", cursive',
    '"Patrick Hand", cursive'
  ];
  function deriveSpineParams(seed) {
    const rnd = mulberry32(seed >>> 0);
    const silhouette = Math.floor(rnd() * 7);
    const palette = Math.floor(rnd() * PALETTES.length);
    const hueJitter = (rnd() * 2 - 1) * 6;
    const bandCount = Math.floor(rnd() * 4);
    const bands = [];
    for (let i = 0; i < 3; i++) {
      const y = 0.12 + rnd() * 0.76;
      const kind = Math.floor(rnd() * 3);
      if (i < bandCount) bands.push({ y, kind });
    }
    bands.sort((a, b) => a.y - b.y);
    const ornament = Math.floor(rnd() * 12);
    const texture = Math.floor(rnd() * 3);
    const font = Math.floor(rnd() * 3);
    const gilt = rnd() < 0.3;
    const lean = (rnd() * 2 - 1) * 1.2;
    const w = thicknessRoll(rnd);
    const hJitter = (rnd() * 2 - 1) * 6;
    const twoTone = rnd() < 0.3;
    const twoToneSplit = 0.26 + rnd() * 0.22;
    const headTail = rnd() < 0.55;
    const material = pickWeighted(rnd(), MATERIAL_WEIGHTS);
    const cordBias = MATERIAL_CORD_BIAS[material];
    const cordRoll = rnd();
    const raisedBands = cordRoll < cordBias.none ? 0 : 1 + Math.floor(rnd() * cordBias.max);
    const bandGilt = rnd() < (gilt ? 0.75 : 0.34);
    const headTailStyle = Math.floor(rnd() * 3);
    const ornamentOn = rnd() < 0.82;
    const titlePlate = pickWeighted(rnd(), PLATE_WEIGHTS);
    const wearRoll = rnd();
    const wear = clamp(wearRoll * wearRoll * (0.55 + MATERIAL_WEAR_BIAS[material]), 0, 1);
    const edge = pickWeighted(rnd(), EDGE_WEIGHTS);
    const charmRoll = rnd();
    const charm = charmRoll < 0.66 ? "none" : ["ribbon", "tassel", "pressed-flower", "clasp", "wax-seal", "tag"][Math.floor(rnd() * 6)] ?? "none";
    const charmColor = Math.floor(rnd() * 8);
    const boardStyle = Math.floor(rnd() * (MAX_BOARD_STYLE + 1));
    const pageBlock = clamp(0.07 + rnd() * 0.14 + (w < 20 ? 0.07 : 0), 0.06, 0.28);
    const proudRoll = rnd() * 2 - 1;
    const proud = Math.sign(proudRoll) * proudRoll * proudRoll * 10;
    const sunFade = rnd() * rnd();
    const foilWear = clamp(rnd() * rnd() * 1.5, 0, 1);
    const knock = rnd() * rnd();
    const round = material === "leather" || material === "vellum" ? 0.55 + rnd() * 0.45 : material === "cloth" || material === "linen" ? rnd() * 0.6 : rnd() * 0.25;
    const format = pickWeighted(rnd(), FORMAT_WEIGHTS);
    const span = SPINE_FORMATS[format];
    const height = clamp(
      span.min + rnd() * (span.max - span.min) + hJitter * 0.35,
      SPINE_HEIGHT_RANGE.min,
      SPINE_HEIGHT_RANGE.max
    );
    return {
      format,
      seed: seed >>> 0,
      silhouette,
      palette,
      hueJitter,
      bands,
      ornament,
      texture,
      font,
      gilt,
      lean,
      w,
      hJitter,
      twoTone,
      twoToneSplit,
      headTail,
      material,
      raisedBands,
      bandGilt,
      headTailStyle,
      ornamentOn,
      titlePlate,
      wear,
      edge,
      height,
      charm,
      charmColor,
      boardStyle,
      pageBlock,
      proud,
      sunFade,
      foilWear,
      knock,
      round
    };
  }
  var THICKNESS_CLASSES = [
    { id: "pamphlet", label: "Pamphlet", min: 8, max: 13, weight: 9 },
    { id: "slim", label: "Slim", min: 13, max: 20, weight: 17 },
    { id: "trade", label: "Trade", min: 20, max: 28, weight: 26 },
    { id: "standard", label: "Standard", min: 28, max: 37, weight: 24 },
    { id: "stout", label: "Stout", min: 37, max: 46, weight: 15 },
    { id: "tome", label: "Tome", min: 46, max: 58, weight: 9 }
  ];
  function thicknessRoll(rnd) {
    const roll = rnd();
    let total = 0;
    for (const c of THICKNESS_CLASSES) total += c.weight;
    let acc = roll * total;
    let chosen = THICKNESS_CLASSES[2];
    for (const c of THICKNESS_CLASSES) {
      acc -= c.weight;
      if (acc < 0) {
        chosen = c;
        break;
      }
    }
    return clamp(
      chosen.min + rnd() * (chosen.max - chosen.min),
      SPINE_THICKNESS_RANGE.min,
      SPINE_THICKNESS_RANGE.max
    );
  }
  function pickWeighted(roll, table) {
    let total = 0;
    for (const [, wgt] of table) total += wgt;
    let acc = roll * total;
    for (const [value, wgt] of table) {
      acc -= wgt;
      if (acc < 0) return value;
    }
    return table[table.length - 1][0];
  }
  var MATERIAL_WEIGHTS = [
    ["leather", 21],
    ["cloth", 22],
    ["paper", 16],
    ["linen", 13],
    ["vellum", 9],
    ["silk", 10],
    ["marbled", 9]
  ];
  var MATERIAL_CORD_BIAS = {
    leather: { none: 0.2, max: 5 },
    vellum: { none: 0.4, max: 4 },
    cloth: { none: 0.66, max: 3 },
    linen: { none: 0.7, max: 3 },
    paper: { none: 0.86, max: 2 },
    silk: { none: 0.78, max: 2 },
    // Marbled boards are the classic half-leather binding: the spine IS leather,
    // so cords are the norm.
    marbled: { none: 0.24, max: 5 }
  };
  var MATERIAL_WEAR_BIAS = {
    leather: 0.15,
    cloth: 0.3,
    paper: 0.45,
    vellum: 0.2,
    linen: 0.35,
    silk: 0.25,
    marbled: 0.4
  };
  var PLATE_WEIGHTS = [
    ["none", 38],
    ["gilt", 24],
    ["label", 22],
    ["debossed", 16]
  ];
  var FORMAT_WEIGHTS = [
    ["folio", 12],
    ["quarto", 18],
    ["octavo", 34],
    ["duodecimo", 22],
    ["pocket", 14]
  ];
  var EDGE_WEIGHTS = [
    ["plain", 58],
    ["gilt", 18],
    ["speckled", 14],
    ["marbled", 10]
  ];
  function materialFromTexture(texture) {
    return texture === 0 ? "cloth" : texture === 1 ? "leather" : "paper";
  }
  function spineHeightPx(params) {
    return clamp(
      params.height ?? SPINE_BASE_HEIGHT + params.hJitter,
      SPINE_HEIGHT_RANGE.min,
      SPINE_HEIGHT_RANGE.max
    );
  }
  function makeCanvas2(w, h) {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  function get2d(c) {
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("spines: 2d context unavailable");
    return ctx;
  }
  function silhouetteOutline(silhouette, w, h) {
    const tl = { x: 0, y: 0 };
    const tr = { x: w, y: 0 };
    const br = { x: w, y: h };
    const bl = { x: 0, y: h };
    switch (silhouette) {
      case 1:
        return [{ x: w * 0.08, y: 0 }, { x: w * 0.92, y: 0 }, br, bl];
      case 2:
        return [tl, tr, { x: w * 0.94, y: h }, { x: w * 0.06, y: h }];
      case 3:
        return [
          tl,
          tr,
          { x: w * 1.03, y: h * 0.5 },
          br,
          bl,
          { x: -w * 0.03, y: h * 0.5 }
        ];
      case 4:
        return [
          tl,
          { x: w * 0.25, y: h * 0.012 },
          { x: w * 0.5, y: -h * 8e-3 },
          { x: w * 0.75, y: h * 0.012 },
          tr,
          br,
          bl
        ];
      case 5:
        return [
          { x: 0, y: h * 0.02 },
          { x: w * 0.14, y: 0 },
          { x: w * 0.86, y: 0 },
          { x: w, y: h * 0.02 },
          br,
          bl
        ];
      case 6:
        return [
          tl,
          tr,
          { x: w * 0.95, y: h * 0.5 },
          br,
          bl,
          { x: w * 0.05, y: h * 0.5 }
        ];
      default:
        return [tl, tr, br, bl];
    }
  }
  function tracePoly(ctx, pts, close) {
    ctx.beginPath();
    const first = pts[0];
    if (!first) return;
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      ctx.lineTo(p.x, p.y);
    }
    if (close) ctx.closePath();
  }
  function strokePts(ctx, pts, close) {
    tracePoly(ctx, pts, close);
    ctx.stroke();
  }
  function drawOrnament(ctx, kind, cx, cy, s, rnd) {
    const j = (v) => v + (rnd() * 2 - 1) * s * 0.06;
    const pt = (x, y) => ({ x: j(cx + x * s), y: j(cy + y * s) });
    switch (kind) {
      case 0: {
        strokePts(ctx, [pt(0, -1), pt(0.62, 0), pt(0, 1), pt(-0.62, 0)], true);
        break;
      }
      case 1: {
        for (const side of [-1, 1]) {
          strokePts(ctx, [pt(side * 0.12, 0.92), pt(side * 0.42, 0.1), pt(side * 0.34, -0.86)], false);
          for (let i = 0; i < 4; i++) {
            const t = 0.1 + i * 0.27;
            const bx = side * (0.12 + (0.42 - 0.12) * Math.min(1, t * 1.6));
            const by = 0.92 - t * 1.78;
            const ang = side * (0.5 + i * 0.12);
            ctx.beginPath();
            ctx.ellipse(
              cx + (bx + side * 0.26) * s,
              cy + (by - 0.06) * s,
              s * 0.3,
              s * 0.12,
              ang,
              0,
              Math.PI * 2
            );
            ctx.fill();
          }
        }
        strokePts(ctx, [pt(-0.2, 1), pt(0, 0.84), pt(0.2, 1)], false);
        break;
      }
      case 2: {
        const star = [];
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? 1 : 0.45;
          const a = -Math.PI / 2 + i * Math.PI / 5;
          star.push(pt(Math.cos(a) * r, Math.sin(a) * r));
        }
        strokePts(ctx, star, true);
        break;
      }
      case 3: {
        const blob = [];
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * Math.PI * 2;
          const r = 0.55 + rnd() * 0.4;
          blob.push({ x: cx + Math.cos(a) * r * s, y: cy + Math.sin(a) * r * s });
        }
        tracePoly(ctx, blob, true);
        const prevAlpha = ctx.globalAlpha;
        ctx.globalAlpha = prevAlpha * 0.8;
        ctx.fill();
        ctx.globalAlpha = prevAlpha;
        break;
      }
      case 4: {
        for (const dy of [-0.22, 0.22]) {
          strokePts(
            ctx,
            [pt(-0.8, dy - 0.25), pt(-0.4, dy + 0.25), pt(0, dy - 0.25), pt(0.4, dy + 0.25), pt(0.8, dy - 0.25)],
            false
          );
        }
        break;
      }
      case 5: {
        const circle = [];
        for (let i = 0; i < 20; i++) {
          const a = i / 20 * Math.PI * 2;
          circle.push({
            x: cx + Math.cos(a) * 0.55 * s,
            y: cy + Math.sin(a) * 0.55 * s
          });
        }
        strokePts(ctx, circle, true);
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * Math.PI * 2;
          strokePts(ctx, [pt(Math.cos(a) * 0.7, Math.sin(a) * 0.7), pt(Math.cos(a) * 1.05, Math.sin(a) * 1.05)], false);
        }
        break;
      }
      case 6: {
        ctx.beginPath();
        ctx.arc(cx, cy, s * 0.85, -Math.PI * 0.55, Math.PI * 0.55, false);
        ctx.arc(cx + s * 0.42, cy, s * 0.62, Math.PI * 0.62, -Math.PI * 0.62, true);
        ctx.closePath();
        const prevAlpha = ctx.globalAlpha;
        ctx.globalAlpha = prevAlpha * 0.8;
        ctx.fill();
        ctx.globalAlpha = prevAlpha;
        break;
      }
      case 7: {
        const circle = [];
        for (let i = 0; i < 18; i++) {
          const a = i / 18 * Math.PI * 2;
          circle.push({
            x: cx + Math.cos(a) * 0.42 * s,
            y: cy + (-0.35 + Math.sin(a) * 0.42) * s
          });
        }
        strokePts(ctx, circle, true);
        strokePts(ctx, [pt(-0.16, -0.05), pt(-0.3, 0.85), pt(0.3, 0.85), pt(0.16, -0.05)], true);
        break;
      }
      case 8: {
        const leaves = 12;
        for (let i = 0; i < leaves; i++) {
          const t = i / (leaves - 1);
          const a = Math.PI / 2 + (t < 0.5 ? -1 : 1) * ((t < 0.5 ? 1 - t * 2 : t * 2 - 1) * Math.PI * 0.86);
          const bx = Math.cos(a) * 0.78;
          const by = Math.sin(a) * 0.78;
          ctx.beginPath();
          ctx.ellipse(cx + bx * s, cy + by * s, s * 0.3, s * 0.13, a + Math.PI / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.lineWidth = Math.max(1, ctx.lineWidth);
        strokePts(ctx, [pt(-0.26, 1.02), pt(0, 0.8), pt(0.26, 1.02)], false);
        break;
      }
      case 9: {
        const shaftPt = (t) => pt(-0.72 + t * 1.44, 0.9 - t * 1.6 - Math.sin(t * Math.PI) * 0.3);
        const vane = [];
        for (let i = 0; i <= 8; i++) vane.push(shaftPt(0.2 + i / 8 * 0.8));
        for (let i = 8; i >= 0; i--) {
          const t = 0.2 + i / 8 * 0.8;
          const p = shaftPt(t);
          const bulge = Math.sin((t - 0.2) / 0.8 * Math.PI) * 0.42;
          vane.push({ x: p.x - bulge * s, y: p.y + bulge * 0.42 * s });
        }
        tracePoly(ctx, vane, true);
        const prevAlpha = ctx.globalAlpha;
        ctx.globalAlpha = prevAlpha * 0.85;
        ctx.fill();
        ctx.globalAlpha = prevAlpha;
        const shaft = [];
        for (let i = 0; i <= 8; i++) shaft.push(shaftPt(i / 8));
        strokePts(ctx, shaft, false);
        strokePts(ctx, [shaftPt(0), pt(-0.94, 1.06)], false);
        break;
      }
      case 10: {
        strokePts(ctx, [pt(0, 1), pt(0, -0.25)], false);
        for (const [ty, sp] of [
          [0.45, 0.72],
          [0.05, 0.55],
          [-0.35, 0.36]
        ]) {
          strokePts(ctx, [pt(-sp, ty + 0.35), pt(0, ty - 0.2), pt(sp, ty + 0.35)], false);
        }
        strokePts(ctx, [pt(-0.3, 1), pt(0, 0.82), pt(0.3, 1)], false);
        ctx.beginPath();
        ctx.arc(cx, cy - 0.62 * s, s * 0.08, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      default: {
        ctx.beginPath();
        ctx.arc(cx - s * 0.22, cy, s * 0.86, -Math.PI * 0.46, Math.PI * 0.46, false);
        ctx.arc(cx + s * 0.16, cy, s * 0.6, Math.PI * 0.62, -Math.PI * 0.62, true);
        ctx.closePath();
        const prevAlpha = ctx.globalAlpha;
        ctx.globalAlpha = prevAlpha * 0.92;
        ctx.fill();
        ctx.globalAlpha = prevAlpha;
        for (const [sx, sy, sr] of [
          [0.6, -0.62, 0.3],
          [0.86, 0.16, 0.19]
        ]) {
          tracePoly(
            ctx,
            [pt(sx, sy - sr), pt(sx + sr * 0.36, sy), pt(sx, sy + sr), pt(sx - sr * 0.36, sy)],
            true
          );
          ctx.fill();
        }
        break;
      }
    }
  }
  function applyOutlineWear(pts, wear, s, rnd) {
    if (wear <= 0.02 || pts.length < 3) return pts.slice();
    const r = (0.8 + wear * 5) * s;
    const out = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const cur = pts[i];
      const next = pts[(i + 1) % n];
      const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y) || 1;
      const outLen = Math.hypot(next.x - cur.x, next.y - cur.y) || 1;
      const ri = Math.min(r, inLen * 0.45);
      const ro = Math.min(r, outLen * 0.45);
      const bump = wear * 1.8 * s * rnd();
      out.push({
        x: cur.x + (prev.x - cur.x) / inLen * ri,
        y: cur.y + (prev.y - cur.y) / inLen * ri
      });
      out.push({
        x: cur.x + ((prev.x - cur.x) / inLen + (next.x - cur.x) / outLen) * bump,
        y: cur.y + ((prev.y - cur.y) / inLen + (next.y - cur.y) / outLen) * bump
      });
      out.push({
        x: cur.x + (next.x - cur.x) / outLen * ro,
        y: cur.y + (next.y - cur.y) / outLen * ro
      });
    }
    return out;
  }
  function spinePanels(cordYs, reserve, cutPad = 0) {
    const zoneTop = 0.055;
    const zoneBot = 0.945;
    const cuts = [];
    let prev = zoneTop;
    for (const y of [...cordYs].sort((a, b) => a - b)) {
      if (y - cutPad > prev) cuts.push({ y0: prev, y1: y - cutPad });
      prev = Math.max(prev, y + cutPad);
    }
    if (zoneBot > prev) cuts.push({ y0: prev, y1: zoneBot });
    if (!reserve) return cuts;
    const out = [];
    for (const p of cuts) {
      if (reserve.y1 <= p.y0 || reserve.y0 >= p.y1) {
        out.push(p);
        continue;
      }
      if (reserve.y0 > p.y0) out.push({ y0: p.y0, y1: reserve.y0 });
      if (reserve.y1 < p.y1) out.push({ y0: reserve.y1, y1: p.y1 });
    }
    return out;
  }
  var VALUE_CLASSES = [
    { lum: [0.055, 0.115], weight: 0.2 },
    // near-black bindings: the anchors
    { lum: [0.115, 0.19], weight: 0.28 },
    // deep: oxblood / navy / forest
    { lum: [0.19, 0.3], weight: 0.24 },
    // mid-dark: the connective tissue
    { lum: [0.3, 0.44], weight: 0.16 },
    // mid: tan, olive, faded cloth
    { lum: [0.5, 0.7], weight: 0.12 }
    // light: vellum, cream, parchment
  ];
  function valueTargetFor(seed) {
    const r = mulberry32((seed ^ 31262) >>> 0);
    let acc = r();
    for (const cls of VALUE_CLASSES) {
      acc -= cls.weight;
      if (acc < 0) return lerp(cls.lum[0], cls.lum[1], r());
    }
    return 0.22;
  }
  function retone(c, target) {
    const lum = luminance(c);
    if (lum <= 2e-3) return target <= 0.02 ? c : mixRgb(c, { r: 1, g: 1, b: 1 }, target);
    if (target < lum) {
      const k2 = 1 - target / lum;
      const shadow = shiftHsl(c, -6, 0.06, -0.02);
      return mixRgb(c, mixRgb(shadow, { r: 0.03, g: 0.035, b: 0.055 }, 0.9), k2);
    }
    const k = Math.min(0.92, (target - lum) / Math.max(0.08, 1 - lum));
    return mixRgb(c, shiftHsl(c, 4, -0.12, 0.2), k);
  }
  function pigmentFor(colA, colB, hue, seed) {
    const rawA = hslToRgb({ h: colA.h + hue, s: colA.s / 100, l: colA.l / 100 });
    const rawB = hslToRgb({ h: colB.h + hue, s: colB.s / 100, l: colB.l / 100 });
    const target = valueTargetFor(seed);
    const base = retone(mixRgb(rawA, rawB, 0.42), target);
    return {
      base,
      // The shadow tone is a genuine dark — 30% of the mass value, not 80% — and
      // drifts cool, which is what stops a row of books reading as flat cards.
      deep: retone(shiftHsl(base, -8, 0.08, 0), Math.max(0.02, target * 0.34)),
      // The crown lifts and warms toward the key rather than washing out.
      lift: retone(shiftHsl(base, 6, -0.06, 0), Math.min(0.86, target * 1.9 + 0.1)),
      partner: retone(rawB, Math.max(0.035, target * 0.62))
    };
  }
  function toVec(pts) {
    return pts.map((p) => ({ x: p.x, y: p.y }));
  }
  function crownAt(spec) {
    return clamp(0.5 + spec.keySide * 0.17 * spec.round, 0.22, 0.78);
  }
  function paintLeatherPainterly(sf, mask, spec, rnd) {
    const { w, h, scale, pig } = spec;
    const s = Math.max(0.6, scale);
    const grainSize = clamp(w * 0.16, 2.4 * s, 7 * s);
    scumble(sf, mask, brush("sponge", { size: grainSize, colour: pig.deep, opacity: 0.1, spacing: 0.5, grain: 0.95 }), {
      coverage: 0.52,
      passes: 2,
      patchScale: grainSize * 3.4,
      edgeBias: 0.25,
      seed: (spec.seed ^ 7751) >>> 0,
      targetBuildup: 0.45
    });
    scumble(sf, mask, brush("sponge", { size: grainSize * 0.8, colour: pig.lift, opacity: 0.07, spacing: 0.55, grain: 0.95 }), {
      coverage: 0.34,
      passes: 1,
      patchScale: grainSize * 5,
      // Grain catches the light on the side the key comes from.
      weight: (x) => 0.35 + 0.65 * clamp01Local(spec.keySide > 0 ? x / w : 1 - x / w),
      seed: (spec.seed ^ 11121) >>> 0,
      targetBuildup: 0.35
    });
    const creases = 2 + Math.floor(rnd() * 3);
    const creaseBrush = brush("soft", {
      size: Math.max(1.6, w * 0.2),
      colour: pig.deep,
      opacity: 0.055,
      spacing: 0.14,
      jitter: { lum: 0.05, hue: 5, position: 0.5 }
    });
    for (let i = 0; i < creases; i++) {
      const cx = w * (0.16 + rnd() * 0.68);
      const y0 = h * rnd() * 0.4;
      const y1 = y0 + h * (0.28 + rnd() * 0.5);
      const path = [];
      for (let k = 0; k <= 5; k++) {
        const t = k / 5;
        path.push({ x: cx + Math.sin(t * 3.1 + i) * w * 0.12, y: lerp(y0, y1, t) });
      }
      stroke(sf, path, creaseBrush, {
        passes: 2,
        pressure: PRESSURE.arc,
        seed: spec.seed + i * 977 >>> 0,
        alpha: 0.8
      });
    }
    const cracks = Math.round(spec.wear * 34 + 4);
    const crackBrush = brush("ink", {
      size: Math.max(0.9, 1.1 * s),
      colour: pig.deep,
      opacity: 0.3,
      spacing: 0.3,
      jitter: { lum: 0.1, opacity: 0.6, position: 0.4 }
    });
    for (let i = 0; i < cracks; i++) {
      let px = rnd() * w;
      let py = rnd() * h;
      const segs = 2 + Math.floor(rnd() * 3);
      const path = [{ x: px, y: py }];
      let ang = rnd() * Math.PI * 2;
      for (let k = 0; k < segs; k++) {
        ang += (rnd() - 0.5) * 1.9;
        const len = (1.6 + rnd() * 4.5) * s;
        px += Math.cos(ang) * len;
        py += Math.sin(ang) * len;
        path.push({ x: px, y: py });
      }
      stroke(sf, path, crackBrush, {
        passes: 1,
        pressure: PRESSURE.flick,
        wobble: 0.3 * s,
        seed: spec.seed + i * 313 >>> 0,
        alpha: 0.5 + rnd() * 0.5
      });
    }
    const crown = crownAt(spec);
    glaze(sf, mask, shiftHsl(pig.lift, 4, -0.1, 0.06), 0.16, {
      blend: "softlight",
      gradient: (x, y) => {
        const u = x / w;
        const band = Math.exp(-Math.pow((u - crown) / 0.3, 2));
        const v = y / h;
        return band * (0.45 + 0.55 * Math.sin(Math.PI * clamp01Local(v)));
      },
      mottle: 0.34,
      mottleScale: Math.max(10, w * 1.4),
      seed: (spec.seed ^ 20928) >>> 0
    });
  }
  function paintClothPainterly(sf, mask, spec, rnd) {
    const { w, h, scale, pig, boardStyle } = spec;
    const s = Math.max(0.6, scale);
    const ribGap = boardStyle === 1 ? 3.4 * s : boardStyle === 2 ? 5.2 * s : 2.2 * s;
    const warpBrush = brush("bristle", {
      size: Math.max(1.1, ribGap * 0.85),
      colour: pig.deep,
      opacity: 0.075,
      spacing: 0.3,
      grain: 0.8,
      followPath: true,
      jitter: { lum: 0.09, hue: 6, opacity: 0.55, position: 0.35 }
    });
    const warpLift = withBrush(warpBrush, { colour: pig.lift, opacity: 0.055 });
    for (let x = -ribGap; x < w + ribGap; x += ribGap) {
      const jx = x + (rnd() - 0.5) * ribGap * 0.3;
      const b = rnd() < 0.42 ? warpLift : warpBrush;
      stroke(
        sf,
        [
          { x: jx, y: -h * 0.02 },
          { x: jx + (rnd() - 0.5) * 1.2 * s, y: h * 0.5 },
          { x: jx + (rnd() - 0.5) * 1.2 * s, y: h * 1.02 }
        ],
        b,
        { passes: 1, pressure: PRESSURE.flat, taper: 0.02, wobble: 0.35 * s, seed: spec.seed + x * 71 >>> 0 }
      );
    }
    const weftBrush = brush("flat", {
      size: Math.max(1, ribGap * 0.7),
      colour: pig.deep,
      opacity: 0.05,
      spacing: 0.35,
      grain: 0.85,
      jitter: { lum: 0.07, opacity: 0.7, position: 0.4 }
    });
    for (let y = 0; y < h; y += ribGap * 1.15) {
      const jy = y + (rnd() - 0.5) * ribGap * 0.4;
      stroke(
        sf,
        [
          { x: -w * 0.04, y: jy },
          { x: w * 1.04, y: jy }
        ],
        weftBrush,
        { passes: 1, pressure: PRESSURE.flat, taper: 0.05, wobble: 0.25 * s, seed: spec.seed + y * 131 >>> 0, alpha: 0.55 + rnd() * 0.45 }
      );
    }
    scumble(sf, mask, brush("chalk", { size: Math.max(1.4, 2.2 * s), colour: pig.lift, opacity: 0.11, grain: 0.9 }), {
      coverage: 0.12,
      passes: 1,
      patchScale: Math.max(12, w * 1.1),
      seed: (spec.seed ^ 16289) >>> 0,
      targetBuildup: 0.4
    });
    glaze(sf, mask, shiftHsl(pig.base, 16, -0.2, 0.1), 0.1, {
      blend: "softlight",
      mottle: 0.4,
      mottleScale: Math.max(14, w * 2),
      seed: (spec.seed ^ 8888) >>> 0
    });
  }
  function paintPaperPainterly(sf, mask, spec, rnd) {
    const { w, h, scale, pig } = spec;
    const s = Math.max(0.6, scale);
    const fibre = brush("chalk", {
      size: Math.max(1, 1.5 * s),
      colour: pig.deep,
      opacity: 0.05,
      spacing: 0.45,
      grain: 0.95,
      jitter: { lum: 0.12, opacity: 0.8, position: 0.7 }
    });
    const fibres = Math.round(h / (2.4 * s)) + 6;
    for (let i = 0; i < fibres; i++) {
      const x0 = rnd() * w;
      const y0 = rnd() * h;
      const len = h * (0.06 + rnd() * 0.3);
      stroke(
        sf,
        [
          { x: x0, y: y0 },
          { x: x0 + (rnd() - 0.5) * 2.4 * s, y: y0 + len }
        ],
        rnd() < 0.4 ? withBrush(fibre, { colour: pig.lift }) : fibre,
        { passes: 1, pressure: PRESSURE.arc, taper: 0.3, seed: spec.seed + i * 617 >>> 0 }
      );
    }
    const spots = Math.round(6 + spec.wear * 40);
    const fox = brush("soft", { size: Math.max(1.2, 2.4 * s), colour: "#8a5a30", opacity: 0.09, jitter: { hue: 14, lum: 0.12, size: 0.7 } });
    for (let i = 0; i < spots; i++) {
      dab(sf, rnd() * w, rnd() * h, fox, { size: (0.7 + rnd() * 2.6) * s, opacity: 0.04 + rnd() * 0.11 });
    }
    glaze(sf, mask, "#e8dcc0", 0.09, { blend: "softlight", mottle: 0.5, mottleScale: Math.max(16, w * 2.2), seed: (spec.seed ^ 39985) >>> 0 });
  }
  function paintVellumPainterly(sf, mask, spec, rnd) {
    const { w, h, scale, pig } = spec;
    const s = Math.max(0.6, scale);
    const cloud = brush("soft", {
      size: Math.max(4, w * 0.7),
      colour: shiftHsl(pig.lift, 6, -0.1, 0.14),
      opacity: 0.055,
      spacing: 0.3,
      jitter: { lum: 0.1, hue: 9, size: 0.6 }
    });
    for (let i = 0; i < 14; i++) {
      dab(sf, rnd() * w, rnd() * h, cloud, { size: w * (0.5 + rnd() * 1.1), opacity: 0.03 + rnd() * 0.06 });
    }
    scumble(sf, mask, brush("soft", { size: Math.max(2, w * 0.3), colour: shiftHsl(pig.deep, 20, -0.1, 0.08), opacity: 0.05 }), {
      coverage: 0.3,
      passes: 1,
      patchScale: Math.max(18, w * 2.4),
      seed: (spec.seed ^ 30658) >>> 0,
      targetBuildup: 0.3
    });
    const dot = brush("ink", { size: Math.max(0.8, 0.9 * s), colour: shiftHsl(pig.deep, 8, 0, 0.06), opacity: 0.22 });
    const groups = Math.round(10 + h / (6 * s));
    for (let i = 0; i < groups; i++) {
      const gx = rnd() * w;
      const gy = rnd() * h;
      const a = rnd() * Math.PI;
      for (let k = 0; k < 3; k++) {
        dab(sf, gx + Math.cos(a) * k * 1.7 * s, gy + Math.sin(a) * k * 1.7 * s, dot, { opacity: 0.1 + rnd() * 0.16 });
      }
    }
    glaze(sf, mask, "#f3e8cc", 0.14, { blend: "screen", mottle: 0.45, mottleScale: Math.max(12, w * 1.8), seed: (spec.seed ^ 4488) >>> 0 });
  }
  function paintLinenPainterly(sf, mask, spec, rnd) {
    const { w, h, scale, pig } = spec;
    const s = Math.max(0.6, scale);
    const gap = 3.1 * s;
    const hatch = brush("chalk", {
      size: Math.max(1.2, gap * 0.9),
      colour: pig.deep,
      opacity: 0.06,
      spacing: 0.4,
      grain: 1,
      jitter: { lum: 0.13, opacity: 0.8, position: 0.6 }
    });
    for (let x = -gap; x < w + gap; x += gap) {
      stroke(sf, [{ x, y: -2 }, { x: x + (rnd() - 0.5) * 2 * s, y: h + 2 }], hatch, {
        passes: 1,
        pressure: PRESSURE.flat,
        wobble: 0.7 * s,
        seed: spec.seed + x * 89 >>> 0,
        alpha: 0.6 + rnd() * 0.5
      });
    }
    for (let y = -gap; y < h + gap; y += gap * 1.1) {
      stroke(sf, [{ x: -2, y }, { x: w + 2, y: y + (rnd() - 0.5) * 1.6 * s }], withBrush(hatch, { colour: rnd() < 0.4 ? pig.lift : pig.deep, opacity: 0.05 }), {
        passes: 1,
        pressure: PRESSURE.flat,
        wobble: 0.6 * s,
        seed: spec.seed + y * 151 >>> 0,
        alpha: 0.5 + rnd() * 0.5
      });
    }
    const slub = brush("flat", { size: Math.max(1.6, 3 * s), colour: pig.lift, opacity: 0.13, grain: 0.9 });
    for (let i = 0; i < Math.round(w * h * 4e-3); i++) {
      const a = rnd() * Math.PI;
      const sx = rnd() * w;
      const sy = rnd() * h;
      const len = (2 + rnd() * 4) * s;
      stroke(
        sf,
        [
          { x: sx, y: sy },
          { x: sx + Math.cos(a) * len, y: sy + Math.sin(a) * len }
        ],
        rnd() < 0.5 ? slub : withBrush(slub, { colour: pig.deep, opacity: 0.11 }),
        { passes: 1, pressure: PRESSURE.arc, taper: 0.35, seed: spec.seed + i * 41 >>> 0 }
      );
    }
    glaze(sf, mask, "#d8c49a", 0.08, { blend: "softlight", mottle: 0.4, seed: (spec.seed ^ 19745) >>> 0 });
  }
  function paintSilkPainterly(sf, mask, spec, rnd) {
    const { w, h, scale, pig } = spec;
    const s = Math.max(0.6, scale);
    const bands = 3 + Math.floor(rnd() * 3);
    const sheen = brush("soft", {
      size: Math.max(2, w / bands),
      colour: pig.lift,
      opacity: 0.07,
      spacing: 0.16,
      jitter: { lum: 0.07, hue: 5, position: 0.3 }
    });
    for (let i = 0; i < bands; i++) {
      const bx = (i + 0.5) / bands * w;
      stroke(sf, [{ x: bx, y: -2 }, { x: bx, y: h + 2 }], i % 2 === 0 ? sheen : withBrush(sheen, { colour: pig.deep, opacity: 0.06 }), {
        passes: 2,
        pressure: PRESSURE.flat,
        taper: 0.05,
        wobble: 0.8 * s,
        seed: spec.seed + i * 733 >>> 0
      });
    }
    const ripple = brush("soft", { size: Math.max(1.2, 1.8 * s), colour: pig.lift, opacity: 0.06, spacing: 0.2 });
    for (let y = 0; y < h; y += 3.6 * s) {
      const path = [];
      const phase = rnd() * 6.28;
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        path.push({ x: t * w, y: y + Math.sin(phase + t * 5.4) * 2.2 * s });
      }
      stroke(sf, path, y % (7.2 * s) < 3.6 * s ? ripple : withBrush(ripple, { colour: pig.deep }), {
        passes: 1,
        pressure: PRESSURE.arc,
        seed: spec.seed + y * 211 >>> 0,
        alpha: 0.6
      });
    }
    glaze(sf, mask, shiftHsl(pig.lift, 0, 0.06, 0.1), 0.12, {
      blend: "screen",
      gradient: (x) => Math.exp(-Math.pow((x / w - crownAt(spec)) / 0.22, 2)),
      mottle: 0.25,
      seed: (spec.seed ^ 27196) >>> 0
    });
  }
  function paintMarbledPainterly(sf, mask, spec, rnd, variant) {
    const { w, h, scale, pig } = spec;
    const s = Math.max(0.6, scale);
    const inks = [
      shiftHsl(pig.deep, 0, 0.1, 0),
      shiftHsl(pig.base, 24, 0.08, 0.02),
      "#7a2b1e",
      "#1e3a52",
      "#c8a24a"
    ];
    const veinCount = Math.round(h / (3.2 * s));
    const veinBrush = brush("soft", {
      size: Math.max(1.2, 2.4 * s),
      colour: inks[0],
      opacity: 0.14,
      spacing: 0.18,
      jitter: { lum: 0.1, hue: 10, opacity: 0.5, position: 0.5 }
    });
    const combAmp = variant === 2 ? 0.3 : 1;
    for (let i = 0; i < veinCount; i++) {
      const y = i / veinCount * h + (rnd() - 0.5) * 2 * s;
      const colour = inks[i % inks.length];
      const path = [];
      const phase = variant === 0 ? i % 2 * 1.6 : rnd() * 6.28;
      const amp = (variant === 1 ? 3.4 : 2.2) * s * combAmp;
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        path.push({ x: -2 + t * (w + 4), y: y + Math.sin(phase + t * (variant === 1 ? 9 : 5)) * amp });
      }
      stroke(sf, path, withBrush(veinBrush, { colour }), {
        passes: 1,
        pressure: PRESSURE.flat,
        taper: 0.04,
        wobble: 0.5 * s,
        seed: spec.seed + i * 419 >>> 0,
        alpha: 0.45 + rnd() * 0.45
      });
    }
    if (variant === 2) {
      const drop = brush("soft", { size: Math.max(2, 4 * s), colour: inks[2], opacity: 0.13, jitter: { hue: 16, lum: 0.14, size: 0.7 } });
      const halo = withBrush(drop, { colour: "#efe4c4", opacity: 0.09 });
      for (let i = 0; i < Math.round(w * h * 6e-3); i++) {
        const dx = rnd() * w;
        const dy = rnd() * h;
        const r = (1.4 + rnd() * 3.4) * s;
        dab(sf, dx, dy, halo, { size: r * 2.1 });
        dab(sf, dx, dy, withBrush(drop, { colour: inks[1 + Math.floor(rnd() * 4)] }), { size: r });
      }
    }
    glaze(sf, mask, pig.deep, 0.1, { blend: "multiply", mottle: 0.4, seed: (spec.seed ^ 16017) >>> 0 });
  }
  function paintMaterialPainterly(sf, mask, spec, rnd) {
    switch (spec.material) {
      case "leather":
        paintLeatherPainterly(sf, mask, spec, rnd);
        break;
      case "cloth":
        paintClothPainterly(sf, mask, spec, rnd);
        break;
      case "paper":
        paintPaperPainterly(sf, mask, spec, rnd);
        break;
      case "vellum":
        paintVellumPainterly(sf, mask, spec, rnd);
        break;
      case "linen":
        paintLinenPainterly(sf, mask, spec, rnd);
        break;
      case "silk":
        paintSilkPainterly(sf, mask, spec, rnd);
        break;
      default:
        paintMarbledPainterly(sf, mask, spec, rnd, spec.boardStyle);
        break;
    }
  }
  function clamp01Local(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }
  var stencilCanvas = null;
  function makeStencil(w, h, draw) {
    const cw = Math.max(1, Math.ceil(w));
    const ch = Math.max(1, Math.ceil(h));
    if (!stencilCanvas || stencilCanvas.width < cw || stencilCanvas.height < ch) {
      stencilCanvas = makeCanvas2(Math.max(cw, 128), Math.max(ch, 128));
    }
    const c = stencilCanvas;
    const ctx = get2d(c);
    ctx.save();
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#fff";
    draw(ctx);
    ctx.restore();
    const img = ctx.getImageData(0, 0, cw, ch);
    const a = new Float32Array(cw * ch);
    for (let i = 0, o = 0; i < a.length; i++, o += 4) a[i] = img.data[o + 3] / 255;
    return { w: cw, h: ch, a };
  }
  function stampStencil(sf, st, ox, oy, opts) {
    const rotate = opts.rotate ?? false;
    const wear = clamp(opts.wear ?? 0, 0, 1);
    const wearScale = opts.wearScale ?? 7;
    const alphaMul = opts.alpha ?? 1;
    const seed = (opts.seed ?? 20225) >>> 0;
    const d = sf.data;
    const relief = opts.relief ?? null;
    const put = (sx, sy, cov, colour) => {
      const xi = Math.round(sx);
      const yi = Math.round(sy);
      if (xi < 0 || yi < 0 || xi >= sf.width || yi >= sf.height) return;
      const i = (yi * sf.width + xi) * 4;
      const a = clamp01Local(cov);
      if (a <= 4e-3) return;
      const inv = 1 - a;
      d[i] = colour.r * a + d[i] * inv;
      d[i + 1] = colour.g * a + d[i + 1] * inv;
      d[i + 2] = colour.b * a + d[i + 2] * inv;
      d[i + 3] = a + d[i + 3] * inv;
    };
    for (let sy = 0; sy < st.h; sy++) {
      for (let sx = 0; sx < st.w; sx++) {
        const cov = st.a[sy * st.w + sx];
        if (cov <= 0.01) continue;
        const t = st.w > 1 ? sx / (st.w - 1) : 0;
        const u = st.h > 1 ? sy / (st.h - 1) : 0.5;
        const tx = rotate ? ox - (sy - st.h / 2) : ox + sx;
        const ty = rotate ? oy + sx : oy + sy;
        let a = cov * alphaMul;
        if (wear > 0) {
          const n = fbm(tx / wearScale, ty / wearScale, seed, 3);
          const eaten = clamp01Local((n - (0.34 + wear * 0.42)) / 0.22);
          a *= 0.18 + 0.82 * eaten;
          if (wear > 0.6) a *= 1 - (wear - 0.6) * 1.1;
        }
        if (a <= 6e-3) continue;
        if (relief) {
          put(tx + relief.dx, ty + relief.dy, cov * relief.alpha * alphaMul, relief.colour);
        }
        put(tx, ty, a, opts.colour(t, u));
      }
    }
  }
  function foilColour(u, warm, hot, dark) {
    if (u < 0.26) return mixRgb(dark, warm, u / 0.26);
    if (u < 0.5) return mixRgb(warm, hot, (u - 0.26) / 0.24);
    if (u < 0.74) return mixRgb(hot, warm, (u - 0.5) / 0.24);
    return mixRgb(warm, dark, (u - 0.74) / 0.26);
  }
  var FOIL_WARM = parseColour("#c9a227");
  var FOIL_HOT = parseColour("#fff3c6");
  var FOIL_DARK = parseColour("#6d4f0e");
  var FOIL_SILVER = parseColour("#cdd3d8");
  function paintRule(sf, x0, x1, y, thickness, colour, spec, opts = {}) {
    const gold = opts.gold ?? false;
    const wear = clamp(opts.wear ?? spec.foilWear * 0.7, 0, 1);
    const seed = (opts.seed ?? spec.seed) >>> 0;
    const rnd = mulberry32(seed);
    const th = Math.max(0.7, thickness);
    stroke(
      sf,
      [
        { x: x0, y: y + th * 0.85 },
        { x: x1, y: y + th * 0.85 }
      ],
      brush("soft", { size: th * 1.5, colour: spec.pig.deep, opacity: 0.16, spacing: 0.2, jitter: { lum: 0.05, position: 0.2 } }),
      { passes: 1, pressure: PRESSURE.flat, taper: 0.04, seed: seed ^ 17, alpha: 0.8 }
    );
    const steps = Math.max(2, Math.round((x1 - x0) / Math.max(1.2, th * 1.6)));
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps;
      const t1 = (i + 1) / steps;
      if (rnd() < wear * 0.55) continue;
      const c = gold ? foilColour(0.2 + rnd() * 0.6, FOIL_WARM, FOIL_HOT, FOIL_DARK) : colour;
      stroke(
        sf,
        [
          { x: lerp(x0, x1, t0), y: y + (rnd() - 0.5) * th * 0.4 },
          { x: lerp(x0, x1, t1), y: y + (rnd() - 0.5) * th * 0.4 }
        ],
        brush("blade", {
          size: th,
          colour: c,
          opacity: (opts.alpha ?? 0.75) * (0.7 + rnd() * 0.5),
          spacing: 0.12,
          hardness: 0.9,
          jitter: { lum: gold ? 0.14 : 0.06, hue: gold ? 8 : 3, opacity: 0.4, position: 0.25 }
        }),
        { passes: 1, pressure: PRESSURE.flat, taper: 0.02, wobble: th * 0.25, seed: seed + i * 37 >>> 0 }
      );
    }
  }
  function paintCord(sf, cy, cordH, spec, seed) {
    const { w, pig } = spec;
    const top = cy - cordH / 2;
    const rnd = mulberry32(seed >>> 0);
    stroke(
      sf,
      [
        { x: -w * 0.05, y: top + cordH * 1.05 },
        { x: w * 1.05, y: top + cordH * 1.05 }
      ],
      brush("soft", { size: cordH * 1.1, colour: pig.deep, opacity: 0.17, spacing: 0.18, jitter: { lum: 0.05, position: 0.4 } }),
      { passes: 2, pressure: PRESSURE.flat, taper: 0.03, seed: seed ^ 113 }
    );
    const rows = Math.max(3, Math.round(cordH));
    for (let i = 0; i < rows; i++) {
      const v = (i + 0.5) / rows;
      const y = top + v * cordH;
      const n = Math.cos((v - 0.42) * Math.PI);
      const lit = clamp01Local(n * 0.5 + 0.5);
      const colour = lit > 0.62 ? mixRgb(pig.base, pig.lift, (lit - 0.62) / 0.38) : mixRgb(pig.deep, pig.base, lit / 0.62);
      stroke(
        sf,
        [
          { x: -w * 0.04, y },
          { x: w * 1.04, y }
        ],
        brush("flat", {
          size: Math.max(1, cordH / rows + 0.6),
          colour,
          opacity: 0.42,
          spacing: 0.14,
          jitter: { lum: 0.05, hue: 4, opacity: 0.3, position: 0.25 }
        }),
        { passes: 1, pressure: PRESSURE.flat, taper: 0.02, wobble: 0.4, seed: seed + i * 53 >>> 0 }
      );
    }
    if (spec.lightOn) {
      stroke(
        sf,
        [
          { x: w * 0.04, y: top + cordH * 0.3 },
          { x: w * 0.96, y: top + cordH * 0.3 }
        ],
        brush("soft", {
          size: Math.max(0.9, cordH * 0.22),
          colour: mixRgb(pig.lift, FOIL_HOT, 0.35),
          opacity: 0.2 * spec.keyTake,
          spacing: 0.2,
          jitter: { opacity: 0.6, position: 0.3 }
        }),
        { passes: 1, pressure: PRESSURE.arc, taper: 0.16, seed: seed ^ 47 }
      );
    }
    void rnd;
  }
  function paintPageBlockPainterly(sf, x, y, bw, bh, edge, spec, rnd) {
    if (bw <= 0.6 || bh <= 1) return;
    const s = Math.max(0.6, spec.scale);
    const shape = roughenShape(rectShape(x, y, bw, bh), 0.4 * s, (spec.seed ^ 8772) >>> 0, 3.4);
    const paper = edge === "gilt" ? "#b08c34" : "#d8caa4";
    const mask = blockIn(sf, shape, paper, {
      brush: brush("flat", { size: Math.max(1.4, bw * 0.7), colour: paper, opacity: 0.3, grain: 0.5 }),
      passes: 2,
      valueSpread: 0.1,
      hueSpread: 8,
      roughness: 0.35 * s,
      rowFactor: 0.4,
      direction: Math.PI / 2,
      openness: 0.04,
      feather: 0.9,
      seed: (spec.seed ^ 21777) >>> 0
    });
    const leafBrush = brush("blade", {
      size: Math.max(0.7, 0.9 * s),
      colour: "#e8dcbc",
      opacity: 0.3,
      spacing: 0.16,
      hardness: 0.85,
      jitter: { lum: 0.12, hue: 8, opacity: 0.6, position: 0.25 }
    });
    const count = Math.max(3, Math.round(bw / (0.9 * s)));
    for (let i = 0; i < count; i++) {
      const lx = x + (i + 0.5) / count * bw + (rnd() - 0.5) * 0.5 * s;
      const dark = rnd() < 0.34;
      stroke(
        sf,
        [
          { x: lx, y: y + bh * 0.01 },
          { x: lx + (rnd() - 0.5) * 0.8 * s, y: y + bh * 0.99 }
        ],
        withBrush(leafBrush, {
          colour: dark ? "#9b8a68" : rnd() < 0.3 ? "#f6efd8" : "#e0d2b0",
          opacity: dark ? 0.22 : 0.26
        }),
        { passes: 1, pressure: PRESSURE.flat, taper: 0.03, wobble: 0.3 * s, seed: spec.seed + i * 97 >>> 0, alpha: 0.6 + rnd() * 0.5 }
      );
    }
    if (edge === "gilt") {
      glaze(sf, mask, FOIL_WARM, 0.6, { blend: "normal", mottle: 0.35, mottleScale: 9, seed: (spec.seed ^ 136) >>> 0 });
      scumble(sf, mask, brush("soft", { size: Math.max(1.2, bw * 0.6), colour: FOIL_HOT, opacity: 0.16 }), {
        coverage: 0.45,
        passes: 1,
        patchScale: Math.max(6, bh * 0.09),
        seed: (spec.seed ^ 153) >>> 0,
        targetBuildup: 0.5
      });
    } else if (edge === "speckled") {
      const speck = brush("ink", { size: Math.max(0.7, 0.8 * s), colour: "#7d3c22", opacity: 0.4, jitter: { hue: 20, lum: 0.2, size: 0.8 } });
      for (let i = 0; i < Math.round(bw * bh * 0.09); i++) {
        dab(sf, x + rnd() * bw, y + rnd() * bh, speck, { size: (0.5 + rnd() * 1.3) * s, opacity: 0.2 + rnd() * 0.4 });
      }
    } else if (edge === "marbled") {
      const vein = brush("soft", { size: Math.max(0.9, 1.4 * s), colour: "#8a4a2c", opacity: 0.2, jitter: { hue: 24, lum: 0.16 } });
      for (let i = 0; i < Math.round(bh / (4 * s)); i++) {
        const vy = rnd() * bh;
        stroke(
          sf,
          [
            { x: x - 0.5, y: y + vy },
            { x: x + bw * 0.5, y: y + vy + (rnd() - 0.5) * 3 * s },
            { x: x + bw + 0.5, y: y + vy + (rnd() - 0.5) * 3 * s }
          ],
          withBrush(vein, { colour: i % 2 === 0 ? "#8a4a2c" : "#2f4a5e" }),
          { passes: 1, pressure: PRESSURE.arc, seed: spec.seed + i * 173 >>> 0, alpha: 0.5 }
        );
      }
    }
    const outerLeft = spec.keySide > 0;
    glaze(sf, mask, spec.lightOn ? mixRgb(FOIL_HOT, parseColour(spec.rig.keyColour), 0.5) : FOIL_HOT, spec.lightOn ? 0.2 * spec.keyTake : 0.06, {
      blend: "screen",
      gradient: (px) => {
        const u = (px - x) / bw;
        return clamp01Local(outerLeft ? u : 1 - u) ** 1.6;
      },
      mottle: 0.3,
      seed: (spec.seed ^ 2721) >>> 0
    });
    stroke(
      sf,
      [
        { x: outerLeft ? x : x + bw, y },
        { x: outerLeft ? x : x + bw, y: y + bh }
      ],
      brush("soft", { size: Math.max(1, bw * 0.5), colour: spec.pig.deep, opacity: 0.2, spacing: 0.2 }),
      { passes: 1, pressure: PRESSURE.flat, taper: 0.03, seed: (spec.seed ^ 2994) >>> 0 }
    );
  }
  function paintWearPainterly(sf, mask, spec, rnd) {
    const { w, h, scale, pig, wear } = spec;
    if (wear <= 0.02) return;
    const s = Math.max(0.6, scale);
    const boardTone = mixRgb(pig.base, parseColour("#a08a68"), 0.5 + wear * 0.28);
    const rub = brush("chalk", {
      size: Math.max(1.6, w * 0.22),
      colour: boardTone,
      opacity: 0.1,
      spacing: 0.4,
      grain: 0.95,
      jitter: { lum: 0.12, hue: 8, opacity: 0.7, size: 0.6 }
    });
    const rubs = Math.round(wear * 16);
    for (let i = 0; i < rubs; i++) {
      const edgePick = rnd();
      const rx = edgePick < 0.5 ? rnd() < 0.5 ? w * (0.02 + rnd() * 0.12) : w * (0.86 + rnd() * 0.12) : rnd() * w;
      const ry = edgePick < 0.5 ? rnd() * h : rnd() < 0.5 ? h * rnd() * 0.1 : h * (0.9 + rnd() * 0.1);
      dab(sf, rx, ry, rub, { size: (1.6 + rnd() * 4) * s, opacity: 0.05 + rnd() * 0.14 * wear });
    }
    glaze(sf, mask, "#3b3125", 0.16 * (0.4 + wear), {
      blend: "multiply",
      gradient: (_x, y) => clamp01Local((y / h - 0.78) / 0.22) ** 1.4,
      mottle: 0.5,
      mottleScale: Math.max(8, w),
      seed: (spec.seed ^ 26129) >>> 0
    });
    if (spec.sunFade > 0.05) {
      glaze(sf, mask, "#efe4c6", spec.sunFade * 0.24, {
        blend: "screen",
        gradient: (x) => {
          const u = spec.keySide > 0 ? x / w : 1 - x / w;
          return clamp01Local(u) ** 1.5;
        },
        mottle: 0.45,
        mottleScale: Math.max(10, w * 1.5),
        seed: (spec.seed ^ 30498) >>> 0
      });
    }
    if (spec.knock > 0.08) {
      const bump = brush("chalk", { size: Math.max(1.4, 2.6 * s), colour: boardTone, opacity: 0.16, grain: 1, jitter: { lum: 0.14, size: 0.7 } });
      for (const [cx, cy] of [
        [0, 0],
        [w, 0],
        [0, h],
        [w, h]
      ]) {
        const n = Math.round(spec.knock * 5);
        for (let i = 0; i < n; i++) {
          const r = (0.6 + rnd() * 2.4) * s;
          dab(sf, cx + (rnd() - 0.5) * 4 * s, cy + (rnd() - 0.5) * 4 * s, bump, { size: r * 2, opacity: 0.08 + rnd() * 0.16 });
        }
      }
    }
  }
  function renderSpine(ctx, params, x, y, hPx, scale, title, opts = {}) {
    const w = params.w * scale;
    const h = hPx;
    const duo = PALETTES[params.palette % PALETTES.length];
    const [colA, colB] = duo;
    const hue = params.hueJitter;
    const rnd = mulberry32((params.seed ^ 20907) >>> 0);
    const material = params.material ?? materialFromTexture(params.texture);
    const wear = clamp(params.wear ?? 0.12, 0, 1);
    const raisedBands = clamp(Math.round(params.raisedBands ?? 0), 0, MAX_RAISED_BANDS);
    const bandGilt = params.bandGilt ?? params.gilt;
    const headTailStyle = clamp(Math.round(params.headTailStyle ?? 0), 0, 2);
    const ornamentOn = params.ornamentOn ?? true;
    const titlePlate = params.titlePlate ?? "none";
    const edge = params.edge ?? "plain";
    const charm = params.charm ?? "none";
    const boardStyle = clamp(Math.round(params.boardStyle ?? 0), 0, MAX_BOARD_STYLE);
    const round = clamp(params.round ?? 0.4, 0, 1);
    const foilWear = clamp(params.foilWear ?? wear * 0.6, 0, 1);
    const sunFade = clamp(params.sunFade ?? 0, 0, 1);
    const knock = clamp(params.knock ?? wear * 0.5, 0, 1);
    const rig = opts.rig ?? DEFAULT_LIGHT_RIG;
    const lightOn = opts.light !== false;
    const rowPhase = clamp(opts.rowPhase ?? 0.5, 0, 1);
    const depth = clamp(
      opts.depth ?? 0.5 - clamp((params.proud ?? 0) / 20, -0.5, 0.5),
      0,
      1
    );
    const keyTake = lerp(0.55, 1.15, rowPhase) * lerp(1, 0.62, depth);
    const src = keyToSource(rig);
    const keySide = src.x >= 0 ? 1 : -1;
    const pig = pigmentFor(colA, colB, hue, params.seed);
    const spec = {
      w,
      h,
      scale,
      pig,
      material,
      boardStyle,
      wear,
      knock,
      foilWear,
      sunFade,
      round,
      rig,
      lightOn,
      keySide,
      keyTake,
      depth,
      seed: params.seed >>> 0
    };
    const sf = createSurface(Math.max(2, Math.ceil(w)), Math.max(2, Math.ceil(h)));
    const s = Math.max(0.6, scale);
    const inset = Math.min(w * 0.06, Math.max(0.8, 1.1 * s));
    const outline = applyOutlineWear(
      silhouetteOutline(params.silhouette, w - inset * 2, h - inset * 2),
      clamp(wear + knock * 0.45, 0, 1),
      scale,
      rnd
    );
    const shape = roughenShape(
      densifyShape(
        toVec(outline).map((p) => ({ x: p.x + inset, y: p.y + inset })),
        Math.max(2, 5 * s)
      ),
      0.55 * s,
      (params.seed ^ 13073) >>> 0,
      2.4
    );
    const crown = crownAt(spec);
    const mask = blockIn(sf, shape, pig.base, {
      brush: brush("chalk", {
        size: Math.max(2.2, w * 0.42),
        colour: pig.base,
        opacity: 0.2,
        spacing: 0.2,
        grain: 0.7,
        jitter: { lum: 0.07, hue: 8, opacity: 0.45, position: 0.5, size: 0.3, angle: 0.4, sat: 0.06 }
      }),
      passes: 3,
      valueSpread: 0.1,
      hueSpread: 12,
      roughness: 0.5 * s,
      overshoot: 1.8 * s,
      direction: Math.PI / 2,
      openness: 0.05,
      rowFactor: 0.42,
      feather: 1.1,
      edgeNoise: 0.4 * s,
      seed: (params.seed ^ 33196) >>> 0
    });
    scumble(
      sf,
      mask,
      brush("chalk", { size: Math.max(2, w * 0.38), colour: pig.deep, opacity: 0.09, grain: 0.8, spacing: 0.3 }),
      {
        coverage: 0.55,
        passes: 2,
        // Both vertical joints are where the covering turns onto the boards:
        // the darkest lines on any book, and the reason a row reads as objects.
        weight: (px) => {
          const u = px / w;
          return clamp01Local(Math.max(1 - u / 0.3, (u - 0.7) / 0.3)) ** 1.3;
        },
        patchScale: Math.max(6, w * 0.9),
        seed: (params.seed ^ 7181) >>> 0,
        targetBuildup: 0.55
      }
    );
    scumble(
      sf,
      mask,
      brush("chalk", { size: Math.max(2, w * 0.3), colour: pig.lift, opacity: 0.07, grain: 0.75, spacing: 0.32 }),
      {
        coverage: 0.4,
        passes: 1,
        weight: (px, py) => {
          const band = Math.exp(-Math.pow((px / w - crown) / 0.26, 2));
          return band * (0.4 + 0.6 * Math.sin(Math.PI * clamp01Local(py / h)));
        },
        patchScale: Math.max(8, h * 0.12),
        seed: (params.seed ^ 11550) >>> 0,
        targetBuildup: 0.45
      }
    );
    paintMaterialPainterly(sf, mask, spec, rnd);
    if (params.twoTone) {
      const splitY = params.twoToneSplit * h;
      const panelShape = roughenShape(rectShape(-1, -1, w + 2, splitY + 1), 0.5 * s, (params.seed ^ 1185) >>> 0, 3);
      const panelMask = blockIn(sf, panelShape, pig.partner, {
        brush: brush("chalk", { size: Math.max(2, w * 0.4), colour: pig.partner, opacity: 0.18, grain: 0.7 }),
        passes: 2,
        valueSpread: 0.08,
        hueSpread: 9,
        roughness: 0.4 * s,
        direction: Math.PI / 2,
        openness: 0.08,
        rowFactor: 0.45,
        feather: 1,
        seed: (params.seed ^ 1185) >>> 0
      });
      clipToMask(sf, mask, { feather: 1.1 });
      void panelMask;
      if (params.gilt) {
        paintRule(sf, w * 0.05, w * 0.95, splitY, Math.max(0.9, 1.4 * s), FOIL_WARM, spec, { gold: true, seed: (params.seed ^ 81) >>> 0 });
      } else {
        paintRule(sf, w * 0.05, w * 0.95, splitY, Math.max(0.8, s), pig.deep, spec, { seed: (params.seed ^ 82) >>> 0, wear: 0.2 });
      }
    }
    if (round > 0.03) {
      glaze(sf, mask, pig.deep, 0.55 * round, {
        blend: "multiply",
        gradient: (px) => {
          const u = px / w;
          const d0 = Math.abs(u - crown) / Math.max(crown, 1 - crown);
          return clamp01Local(d0 ** 1.7);
        },
        mottle: 0.22,
        mottleScale: Math.max(9, h * 0.2),
        seed: (params.seed ^ 27665) >>> 0
      });
      glaze(sf, mask, lightOn ? mixRgb(pig.lift, parseColour(rig.keyColour), 0.28) : pig.lift, 0.24 * round * (lightOn ? keyTake : 0.7), {
        blend: "screen",
        gradient: (px, py) => {
          const band = Math.exp(-Math.pow((px / w - crown) / 0.2, 2));
          return band * (0.35 + 0.65 * Math.sin(Math.PI * clamp01Local(py / h)) ** 0.7);
        },
        mottle: 0.25,
        mottleScale: Math.max(10, h * 0.22),
        seed: (params.seed ^ 27666) >>> 0
      });
    }
    const blockFrac = clamp(params.pageBlock ?? 0.1, 0.05, 0.24);
    const edgeW = opts.pageBlock === false ? 0 : clamp(w * blockFrac, 2 * s, 9 * s);
    if (edgeW > 0.8) {
      const blockX = keySide > 0 ? w - edgeW - inset * 0.5 : inset * 0.5;
      paintPageBlockPainterly(sf, blockX, h * 0.014, edgeW, h * 0.972, edge, spec, rnd);
    }
    const legacyBands = raisedBands > 0 ? [] : params.bands;
    for (const band of legacyBands) {
      const by = band.y * h;
      if (band.kind === 0) {
        for (const dy of [-1.9 * s, 1.9 * s]) {
          paintRule(sf, w * 0.05, w * 0.95, by + dy, Math.max(0.7, 0.9 * s), pig.deep, spec, {
            seed: params.seed + by * 13 + dy >>> 0,
            wear: 0.25,
            alpha: 0.6
          });
        }
      } else if (band.kind === 1) {
        paintCord(sf, by, clamp(w * 0.2, 3.4 * s, 8 * s), spec, params.seed + by * 29 >>> 0);
      } else {
        paintRule(sf, w * 0.05, w * 0.95, by, Math.max(1, 1.6 * s), FOIL_WARM, spec, {
          gold: true,
          seed: params.seed + by * 37 >>> 0
        });
      }
    }
    const cordYs = [];
    if (raisedBands > 0) {
      const zTop = 0.085;
      const zBot = 0.915;
      for (let i = 0; i < raisedBands; i++) {
        cordYs.push(zTop + (i + 1) / (raisedBands + 1) * (zBot - zTop));
      }
    }
    const cordH = clamp(w * 0.24, 4.2 * s, 11 * s);
    for (const cy of cordYs) {
      paintCord(sf, cy * h, cordH, spec, params.seed + cy * 9973 >>> 0);
      if (bandGilt) {
        for (const gy of [cy * h - cordH * 0.85, cy * h + cordH * 0.85]) {
          paintRule(sf, w * 0.08, w * 0.92, gy, Math.max(0.9, 1.2 * s), FOIL_WARM, spec, {
            gold: true,
            seed: params.seed + gy * 61 >>> 0
          });
        }
      }
    }
    if (params.headTail) {
      const bandH = 3 * s;
      const stripeW = Math.max(1.4 * s, 1.8);
      const capCol = params.gilt ? FOIL_WARM : shiftHsl(pig.partner, 0, -0.06, 0.04);
      const creamCol = parseColour("#ddd0ab");
      for (const cy0 of [0.7 * s, h - bandH - 0.7 * s]) {
        stroke(
          sf,
          [
            { x: w * 0.05, y: cy0 + bandH * 0.5 },
            { x: w * 0.95, y: cy0 + bandH * 0.5 }
          ],
          brush("flat", { size: bandH, colour: creamCol, opacity: 0.34, spacing: 0.2, jitter: { lum: 0.09, position: 0.3 } }),
          { passes: 1, pressure: PRESSURE.flat, taper: 0.06, seed: params.seed + cy0 * 17 >>> 0 }
        );
        const stripeBrush = brush("flat", {
          size: bandH * 0.75,
          colour: capCol,
          opacity: 0.4,
          spacing: 0.2,
          jitter: { lum: 0.1, hue: 6, opacity: 0.5, position: 0.3 }
        });
        for (let sx = w * 0.05; sx < w * 0.95; sx += stripeW * 2) {
          const slant = headTailStyle === 0 ? 0 : bandH * 0.8;
          stroke(
            sf,
            [
              { x: sx, y: cy0 + bandH },
              { x: sx + slant, y: cy0 }
            ],
            stripeBrush,
            { passes: 1, pressure: PRESSURE.flat, taper: 0.1, smooth: false, seed: params.seed + sx * 31 >>> 0, alpha: 0.7 + rnd() * 0.4 }
          );
        }
        paintRule(sf, w * 0.05, w * 0.95, cy0 < h / 2 ? cy0 + bandH : cy0, Math.max(0.6, 0.7 * s), pig.deep, spec, {
          seed: params.seed + cy0 * 71 >>> 0,
          wear: 0.3,
          alpha: 0.5
        });
      }
    }
    const reserve = charmSpineReserve(charm);
    const cutYs = raisedBands > 0 ? cordYs : legacyBands.map((b) => b.y);
    const cutPad = h > 0 ? (raisedBands > 0 ? cordH * 0.95 : 4.6 * scale) / h : 0;
    const panels = spinePanels(cutYs, reserve, cutPad).filter((p) => p.y1 - p.y0 > 0.045);
    let titlePanel = null;
    let ornamentPanel = null;
    if (panels.length > 0) {
      const upper = panels.filter((p) => (p.y0 + p.y1) / 2 < 0.68);
      const pool = upper.length > 0 ? upper : panels;
      const tallest = pool.reduce((a, b) => b.y1 - b.y0 > a.y1 - a.y0 ? b : a);
      const second = panels.length > 1 ? panels[1] : null;
      titlePanel = second !== null && second.y1 - second.y0 >= (tallest.y1 - tallest.y0) * 0.8 ? second : tallest;
      const below = panels.filter((p) => p !== titlePanel && p.y0 >= titlePanel.y1 - 1e-6);
      const rest = below.length > 0 ? below : panels.filter((p) => p !== titlePanel);
      if (rest.length > 0) {
        ornamentPanel = rest.reduce((a, b) => b.y1 - b.y0 > a.y1 - a.y0 ? b : a);
        if (ornamentPanel.y1 - ornamentPanel.y0 < 0.085) ornamentPanel = null;
      }
      if (!ornamentPanel && panels.length === 1) {
        const only = panels[0];
        ornamentPanel = { y0: only.y0 + (only.y1 - only.y0) * 0.74, y1: only.y1 };
        titlePanel = { y0: only.y0, y1: ornamentPanel.y0 };
      }
    }
    const trnd = mulberry32((params.seed ^ 28949) >>> 0);
    if (titlePanel) {
      const py0 = titlePanel.y0 * h;
      const py1 = titlePanel.y1 * h;
      const pad = 4 * scale;
      const availLen = Math.max(0, py1 - py0 - pad * 2);
      const family = FONTS[params.font];
      const mctx = get2d(makeCanvas2(8, 8));
      const maxFont = clamp(w * 0.52, 10 * scale, 20 * scale);
      const minFont = Math.max(6.5 * scale, maxFont * 0.52);
      const fitLen = Math.max(0, availLen - pad * 0.9);
      let fontPx = maxFont;
      let text = title.trim();
      const measure = (t) => {
        mctx.font = `${fontPx.toFixed(2)}px ${family}`;
        let sum = 0;
        for (const ch of t) sum += mctx.measureText(ch).width;
        return sum;
      };
      if (opts.hiRes && text.length > 0 && fitLen > 0) {
        while (measure(text) > fitLen && fontPx > minFont) fontPx = Math.max(minFont, fontPx * 0.94);
        if (measure(text) > fitLen) {
          while (text.length > 1 && measure(`${text}\u2026`) > fitLen) text = text.slice(0, -1);
          const trimmed = text.replace(/[\s,;:.-]+$/u, "");
          text = `${trimmed.length > 0 ? trimmed : text}\u2026`;
        }
      } else {
        text = "";
      }
      mctx.font = `${fontPx.toFixed(2)}px ${family}`;
      const glyphs = [];
      let textLen = 0;
      for (const ch of text) {
        const cw = mctx.measureText(ch).width;
        glyphs.push({ ch, adv: cw });
        textLen += cw;
      }
      const plateLen = textLen > 0 ? Math.min(availLen, textLen + pad * 2.6) : Math.min(availLen, (py1 - py0) * 0.6);
      const plateW = Math.min(w * 0.8, fontPx * 1.95);
      const plateX = w * 0.5 - plateW / 2;
      const plateY = (py0 + py1) / 2 - plateLen / 2;
      if (titlePlate !== "none" && plateLen > 6 * scale) {
        if (titlePlate === "label") {
          const labelShape = roughenShape(
            densifyShape(rectShape(plateX, plateY, plateW, plateLen), 5 * s),
            0.7 * s,
            (params.seed ^ 2465) >>> 0,
            3.2
          );
          stroke(
            sf,
            [
              { x: plateX + plateW * 0.5, y: plateY + plateLen + 1.2 * s },
              { x: plateX + plateW * 0.5, y: plateY - 1 * s }
            ],
            brush("soft", { size: plateW * 1.15, colour: pig.deep, opacity: 0.12, spacing: 0.2 }),
            { passes: 1, pressure: PRESSURE.flat, taper: 0.05, seed: (params.seed ^ 2466) >>> 0 }
          );
          const labelMask = blockIn(sf, labelShape, "#e3d5b2", {
            brush: brush("chalk", { size: Math.max(2, plateW * 0.6), colour: "#e3d5b2", opacity: 0.24, grain: 0.7 }),
            passes: 3,
            valueSpread: 0.07,
            hueSpread: 7,
            roughness: 0.4 * s,
            direction: Math.PI / 2,
            openness: 0.03,
            rowFactor: 0.4,
            feather: 0.9,
            seed: (params.seed ^ 2467) >>> 0
          });
          glaze(sf, labelMask, "#8b7444", 0.16, {
            blend: "multiply",
            gradient: (px, py) => {
              const u = clamp01Local((px - plateX) / plateW);
              const v = clamp01Local((py - plateY) / plateLen);
              return Math.max(Math.abs(u - 0.5) * 1.5, Math.abs(v - 0.5) * 1.5) ** 2;
            },
            mottle: 0.4,
            seed: (params.seed ^ 2468) >>> 0
          });
          paintRule(sf, plateX + 1.8 * s, plateX + plateW - 1.8 * s, plateY + 1.8 * s, Math.max(0.6, 0.7 * s), parseColour("#7a6238"), spec, { wear: 0.35, alpha: 0.5, seed: (params.seed ^ 2469) >>> 0 });
          paintRule(sf, plateX + 1.8 * s, plateX + plateW - 1.8 * s, plateY + plateLen - 1.8 * s, Math.max(0.6, 0.7 * s), parseColour("#7a6238"), spec, { wear: 0.35, alpha: 0.5, seed: (params.seed ^ 2470) >>> 0 });
        } else {
          const gold = titlePlate === "gilt";
          const ruleCol = gold ? FOIL_WARM : pig.deep;
          for (const ry of [plateY, plateY + plateLen]) {
            paintRule(sf, plateX, plateX + plateW, ry, Math.max(0.8, 1.2 * s), ruleCol, spec, {
              gold,
              seed: params.seed + ry * 41 >>> 0
            });
          }
          const vBrush = brush("blade", {
            size: Math.max(0.8, 1.1 * s),
            colour: ruleCol,
            opacity: 0.5,
            spacing: 0.14,
            hardness: 0.9,
            jitter: { lum: gold ? 0.16 : 0.06, hue: gold ? 9 : 3, opacity: 0.5, position: 0.3 }
          });
          for (const rx of [plateX, plateX + plateW]) {
            stroke(
              sf,
              [
                { x: rx, y: plateY },
                { x: rx, y: plateY + plateLen }
              ],
              vBrush,
              { passes: 1, pressure: PRESSURE.flat, taper: 0.03, wobble: 0.35 * s, seed: params.seed + rx * 53 >>> 0, alpha: 1 - foilWear * 0.5 }
            );
          }
        }
      }
      if (glyphs.length > 0) {
        const onLabel = titlePlate === "label";
        const goldTitle = !onLabel && (titlePlate === "gilt" || params.gilt);
        const groundLum = luminance(pig.base);
        const silverTitle = !onLabel && !goldTitle && groundLum < 0.2;
        const runY0 = (py0 + py1) / 2 - textLen / 2;
        const stH = Math.ceil(fontPx * 1.75);
        const st = makeStencil(Math.ceil(textLen + fontPx * 0.6), stH, (c) => {
          c.font = `${fontPx.toFixed(2)}px ${family}`;
          c.textAlign = "left";
          c.textBaseline = "middle";
          let advance = fontPx * 0.3;
          for (const g of glyphs) {
            const wob = (trnd() * 1.2 - 0.6) * scale;
            c.fillText(g.ch, advance, stH / 2 + wob);
            advance += g.adv;
          }
        });
        const inkDark = mixRgb(pig.deep, parseColour("#141019"), 0.45);
        const inkPale = mixRgb(pig.lift, parseColour("#f4ecd8"), 0.6);
        const colourAt = goldTitle ? (t, u) => {
          const foil = foilColour(u, FOIL_WARM, FOIL_HOT, FOIL_DARK);
          const catchAt = clamp(0.24 + rowPhase * 0.5, 0, 1);
          const g = Math.exp(-Math.pow((t - catchAt) / 0.16, 2)) * (lightOn ? keyTake : 0.4);
          return mixRgb(foil, FOIL_HOT, clamp01Local(g * 0.7));
        } : silverTitle ? (_t, u) => foilColour(u, FOIL_SILVER, parseColour("#ffffff"), parseColour("#5d6670")) : onLabel ? () => inkDark : () => groundLum < 0.34 ? inkPale : inkDark;
        stampStencil(sf, st, w / 2, runY0 - fontPx * 0.3, {
          rotate: true,
          colour: colourAt,
          wear: onLabel ? foilWear * 0.35 : foilWear,
          wearScale: Math.max(3.5, fontPx * 0.55),
          alpha: 0.95,
          seed: (params.seed ^ 20830) >>> 0,
          relief: onLabel ? null : {
            colour: goldTitle || silverTitle ? mixRgb(pig.deep, parseColour("#000000"), 0.35) : pig.deep,
            dx: -0.8 * s * keySide,
            dy: 0.85 * s,
            alpha: 0.4
          }
        });
      }
    }
    if (ornamentOn && !charmTakesOrnamentSlot(charm)) {
      const oPanel = ornamentPanel ?? { y0: 0.7, y1: 0.9 };
      const ocy = (oPanel.y0 + oPanel.y1) / 2 * h;
      const oSize = Math.min(w * 0.36, 14 * scale, (oPanel.y1 - oPanel.y0) * h / 2.1);
      if (oSize > 1.6) {
        const box = Math.ceil(oSize * 2.6);
        const ornRnd = mulberry32((params.seed ^ 3095) >>> 0);
        const st = makeStencil(box, box, (c) => {
          c.lineWidth = Math.max(1, 1.1 * scale);
          c.lineJoin = "round";
          c.lineCap = "round";
          drawOrnament(c, params.ornament, box / 2, box / 2, Math.max(2, oSize), ornRnd);
        });
        const gold = params.gilt;
        stampStencil(sf, st, w / 2 - box / 2, ocy - box / 2, {
          colour: gold ? (_t, u) => foilColour(u, FOIL_WARM, FOIL_HOT, FOIL_DARK) : () => mixRgb(pig.deep, parseColour("#0e0b12"), 0.3),
          wear: foilWear * 0.8,
          wearScale: Math.max(3, oSize * 0.5),
          alpha: gold ? 0.9 : 0.7,
          seed: (params.seed ^ 3096) >>> 0,
          relief: {
            colour: mixRgb(pig.deep, parseColour("#000000"), 0.3),
            dx: -0.7 * s * keySide,
            dy: 0.7 * s,
            alpha: 0.35
          }
        });
      }
    }
    paintWearPainterly(sf, mask, spec, rnd);
    if (lightOn) {
      glaze(sf, mask, mixRgb(pig.deep, parseColour(rig.ambientColour), 0.18), 0.62 * (0.7 + depth * 0.5), {
        blend: "multiply",
        gradient: (_x, py) => clamp01Local((py / h - 0.8) / 0.2) ** 1.5,
        mottle: 0.2,
        seed: (params.seed ^ 14849) >>> 0
      });
      glaze(sf, mask, mixRgb(pig.deep, parseColour(rig.ambientColour), 0.24), 0.42 * (0.6 + depth * 0.6), {
        blend: "multiply",
        gradient: (_x, py) => clamp01Local((0.16 - py / h) / 0.16) ** 1.6,
        mottle: 0.2,
        seed: (params.seed ^ 14850) >>> 0
      });
      glaze(sf, mask, mixRgb(pig.deep, parseColour("#0c0a12"), 0.4), 0.5, {
        blend: "multiply",
        gradient: (px) => {
          const u = keySide > 0 ? 1 - px / w : px / w;
          return clamp01Local((0.3 - u) / 0.3) ** 1.4;
        },
        mottle: 0.25,
        mottleScale: Math.max(8, h * 0.15),
        seed: (params.seed ^ 14851) >>> 0
      });
      glaze(sf, mask, parseColour(rig.keyColour), clamp(0.2 * keyTake * rig.keyIntensity, 0, 0.4), {
        blend: "screen",
        gradient: (px, py) => {
          const u = keySide > 0 ? px / w : 1 - px / w;
          const across = 0.35 + 0.65 * clamp01Local(u) ** 1.2;
          const down = 0.55 + 0.45 * clamp01Local(1 - py / h) ** 0.8;
          return across * down;
        },
        mottle: 0.3,
        mottleScale: Math.max(12, h * 0.25),
        seed: (params.seed ^ 14852) >>> 0
      });
      if (opts.neighbourLeft) {
        glaze(sf, mask, opts.neighbourLeft, 0.11, {
          blend: "softlight",
          gradient: (px) => clamp01Local((0.32 - px / w) / 0.32) ** 1.3,
          mottle: 0.3,
          seed: (params.seed ^ 14853) >>> 0
        });
      }
      if (opts.neighbourRight) {
        glaze(sf, mask, opts.neighbourRight, 0.11, {
          blend: "softlight",
          gradient: (px) => clamp01Local((px / w - 0.68) / 0.32) ** 1.3,
          mottle: 0.3,
          seed: (params.seed ^ 14854) >>> 0
        });
      }
      if (depth > 0.55) {
        glaze(sf, mask, parseColour(rig.ambientColour), (depth - 0.55) / 0.45 * 0.22 * rig.hazeStrength, {
          blend: "normal",
          mottle: 0.2,
          seed: (params.seed ^ 14855) >>> 0
        });
      }
    }
    edgeVary(sf, shape, {
      crisp: 0.26,
      lost: 0.3,
      band: Math.max(1.2, 1.6 * s),
      accent: mixRgb(pig.deep, parseColour("#0b0910"), 0.4),
      accentStrength: 0.4,
      lightAngle: rig.keyAngle,
      softness: Math.max(1.2, 2 * s),
      seed: (params.seed ^ 7486) >>> 0
    });
    addGrain(sf, 0.045, 1.5, (params.seed ^ 32273) >>> 0, mask);
    ctx.save();
    ctx.translate(x, y);
    drawSurface(ctx, sf, 0, 0);
    if (charm !== "none") {
      drawSpineCharm(ctx, charm, w, h, {
        color: charmColorCss(params.charmColor ?? 0),
        scale,
        rnd: mulberry32((params.seed ^ 50343) >>> 0),
        gilt: params.gilt
      });
    }
    ctx.restore();
    const nctx = opts.normalCtx;
    if (nctx) {
      emitSpines(nctx, [
        {
          x,
          y,
          width: w,
          height: h,
          proud: clamp(1 - depth, 0, 1),
          radius: clamp(0.16 + round * 0.16, 0.08, 0.4),
          bands: raisedBands
        }
      ]);
    }
  }
  function pickRunCharacter(rnd, previous, remaining, allowFlat, allowGap) {
    const table = [
      ["mixed", 30],
      ["thin-run", 20],
      ["heavy", 14],
      ["leaning-cluster", 14],
      ["flat-stack", allowFlat && remaining >= 2 ? 10 : 0],
      ["gap", allowGap ? 12 : 0]
    ];
    const filtered = table.map(
      ([c, wgt]) => c === previous ? [c, wgt * 0.12] : [c, wgt]
    );
    let total = 0;
    for (const [, wgt] of filtered) total += wgt;
    if (total <= 0) return "mixed";
    let acc = rnd() * total;
    for (const [c, wgt] of filtered) {
      acc -= wgt;
      if (acc < 0) return c;
    }
    return "mixed";
  }
  function runSize(character, rnd, remaining) {
    switch (character) {
      case "gap":
        return 0;
      case "heavy":
        return Math.min(remaining, 1 + Math.floor(rnd() * 2.4));
      case "flat-stack":
        return Math.min(remaining, 2 + Math.floor(rnd() * 3));
      case "thin-run":
        return Math.min(remaining, 3 + Math.floor(rnd() * 4));
      case "leaning-cluster":
        return Math.min(remaining, 2 + Math.floor(rnd() * 3));
      default:
        return Math.min(remaining, 2 + Math.floor(rnd() * 4));
    }
  }
  function suitability(params, character) {
    const bw = params.w;
    const bh = spineHeightPx(params);
    switch (character) {
      case "thin-run":
        return 100 - bw * 2.2;
      case "heavy":
        return bw * 2.4 + bh * 0.16;
      case "flat-stack":
        return bw * 1.1 - Math.abs(bh - 200) * 0.28;
      case "leaning-cluster":
        return 60 - Math.abs(bw - 24) * 1.5;
      default:
        return 40 - Math.abs(bw - 30) * 0.6;
    }
  }
  function shiftAfter(placements, gaps, from, delta, skipGapIndex) {
    if (delta === 0) return;
    for (const p of placements) {
      if (p.x >= from - 1e-3) p.x += delta;
    }
    for (let i = 0; i < gaps.length; i++) {
      if (i === skipGapIndex) continue;
      const g = gaps[i];
      if (g.x >= from - 1e-3) g.x += delta;
    }
  }
  function composeShelfRow(books, opts = {}) {
    const width = Math.max(60, opts.width ?? 900);
    const rnd = mulberry32(((opts.seed ?? 24095) ^ 2654435761) >>> 0);
    const allowLean = opts.lean !== false;
    const allowFlat = opts.flatStacks !== false;
    const allowGap = opts.gaps !== false;
    const minKerf = opts.minKerf ?? 0.6;
    const skylineTarget = clamp(opts.skylineTarget ?? 0.26, 0.05, 0.6);
    if (books.length === 0) {
      return {
        placements: [],
        gaps: [{ x: 0, width, leanedInto: false }],
        width: 0,
        maxHeight: 0,
        minHeight: 0,
        runs: ["gap"],
        skylineVariation: 0,
        thicknessRatio: 1
      };
    }
    const pool = books.map((b, index) => {
      const params = b.params ?? deriveSpineParams(b.seed);
      return { input: b, index, params, height: spineHeightPx(params) };
    });
    const runs = [];
    const runMembers = [];
    const unassigned = pool.slice();
    let previous = null;
    let guard = 0;
    while (unassigned.length > 0 && guard++ < 400) {
      const character = runs.length === 0 ? rnd() < 0.4 ? "heavy" : "mixed" : pickRunCharacter(rnd, previous, unassigned.length, allowFlat, allowGap);
      previous = character;
      if (character === "gap") {
        runs.push("gap");
        runMembers.push([]);
        continue;
      }
      const want = Math.max(1, runSize(character, rnd, unassigned.length));
      const scored = unassigned.map((c) => ({ c, s: suitability(c.params, character) + rnd() * 18 })).sort((a, b) => b.s - a.s);
      const taken = scored.slice(0, want).map((entry) => entry.c);
      for (const t of taken) {
        const at = unassigned.indexOf(t);
        if (at >= 0) unassigned.splice(at, 1);
      }
      runs.push(character);
      runMembers.push(taken);
    }
    if (runs.length === 0) {
      runs.push("mixed");
      runMembers.push(pool.slice());
    }
    for (let i = 0; i < runMembers.length; i++) {
      const a = runMembers[i];
      if (a.length < 3 || runs[i] === "gap" || runs[i] === "flat-stack") continue;
      for (let j = i + 1; j < runMembers.length; j++) {
        const b = runMembers[j];
        if (b.length < 3 || runs[j] === "gap" || runs[j] === "flat-stack") continue;
        if (rnd() < 0.6) {
          const ai = Math.floor(rnd() * a.length);
          const bi = Math.floor(rnd() * b.length);
          const tmp = a[ai];
          a[ai] = b[bi];
          b[bi] = tmp;
        }
        break;
      }
    }
    for (const members of runMembers) {
      for (let i = members.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const tmp = members[i];
        members[i] = members[j];
        members[j] = tmp;
      }
    }
    const flatList = runMembers.flat();
    if (flatList.length >= 2) {
      let maxH = -Infinity;
      let minH = Infinity;
      for (const c of flatList) {
        maxH = Math.max(maxH, c.height);
        minH = Math.min(minH, c.height);
      }
      const variation = maxH > 0 ? (maxH - minH) / maxH : 0;
      if (variation < skylineTarget) {
        const mean = flatList.reduce((s, c) => s + c.height, 0) / flatList.length;
        const need = (skylineTarget - variation) * maxH;
        const span = Math.max(1, maxH - minH);
        for (const c of flatList) {
          const away = c.height - mean;
          const push = Math.sign(away) * need * (0.35 + Math.abs(away) / span * 0.5);
          c.height = clamp(c.height + push, SPINE_HEIGHT_RANGE.min, SPINE_HEIGHT_RANGE.max);
        }
      }
      for (let i = 2; i < flatList.length; i++) {
        const a = flatList[i - 2];
        const b = flatList[i - 1];
        const c = flatList[i];
        const near = (p, q) => Math.abs(p - q) / Math.max(1, p) < 0.03;
        if (near(a.height, b.height) && near(b.height, c.height)) {
          const dir = rnd() < 0.5 ? -1 : 1;
          b.height = clamp(
            b.height + dir * b.height * (0.06 + rnd() * 0.08),
            SPINE_HEIGHT_RANGE.min,
            SPINE_HEIGHT_RANGE.max
          );
        }
      }
    }
    const placements = [];
    const gaps = [];
    let cursor = 0;
    for (let r = 0; r < runs.length; r++) {
      const character = runs[r];
      const members = runMembers[r];
      if (character === "gap") {
        const g = 14 + rnd() * 34;
        gaps.push({ x: cursor, width: g, leanedInto: false });
        cursor += g;
        continue;
      }
      if (character === "flat-stack" && members.length >= 2) {
        const sorted = [...members].sort((a, b) => b.height - a.height);
        const footprint = Math.max(...sorted.map((c) => c.height)) * 0.94;
        let stackY = 0;
        for (let i = 0; i < sorted.length; i++) {
          const c = sorted[i];
          const jitterX = (rnd() * 2 - 1) * Math.min(10, footprint * 0.05);
          placements.push({
            id: c.input.id,
            index: c.index,
            params: c.params,
            title: c.input.title,
            x: cursor + jitterX + (footprint - c.height * 0.94) / 2,
            width: c.height * 0.94,
            height: c.params.w,
            leanDeg: (rnd() * 2 - 1) * 1.6,
            depth: 0.1 + rnd() * 0.3,
            phase: 0,
            pose: "flat",
            run: r,
            runCharacter: character,
            stackY,
            gapAfter: 0
          });
          stackY += c.params.w;
        }
        cursor += footprint + 2 + rnd() * 8;
        continue;
      }
      const leanLast = allowLean && (character === "leaning-cluster" || character !== "heavy" && rnd() < 0.16) && members.length >= 2;
      const runDepth = (rnd() * 2 - 1) * 0.42;
      for (let i = 0; i < members.length; i++) {
        const c = members[i];
        const isLast = i === members.length - 1;
        const doLean = leanLast && isLast;
        const leanDeg = doLean ? (rnd() < 0.5 ? -1 : 1) * (6 + rnd() * 9) : c.params.lean + (rnd() * 2 - 1) * 0.9;
        const rad = Math.abs(leanDeg) * (Math.PI / 180);
        const footprint = c.params.w * Math.cos(rad) + c.height * Math.sin(rad);
        const proud = (c.params.proud ?? 0) / 10;
        const depth = clamp(runDepth * 0.7 + proud * 0.8 + (rnd() * 2 - 1) * 0.18, -1, 1);
        const pose = doLean ? "leaning" : rnd() < 0.07 ? "angled" : "upright";
        placements.push({
          id: c.input.id,
          index: c.index,
          params: c.params,
          title: c.input.title,
          x: cursor,
          width: footprint,
          height: c.height,
          leanDeg,
          depth,
          phase: 0,
          pose,
          run: r,
          runCharacter: character,
          stackY: 0,
          gapAfter: 0
        });
        const kerf = isLast ? 0 : minKerf + rnd() * (character === "thin-run" ? 0.8 : 2.2);
        cursor += footprint + kerf;
      }
      if (leanLast) {
        const last = placements[placements.length - 1];
        const g = Math.max(10, last.height * Math.sin(Math.abs(last.leanDeg) * (Math.PI / 180)) * 0.9);
        gaps.push({ x: cursor, width: g, leanedInto: true });
        cursor += g;
      } else if (r < runs.length - 1 && runs[r + 1] !== "gap") {
        const g = 3 + rnd() * 9;
        gaps.push({ x: cursor, width: g, leanedInto: false });
        cursor += g;
      }
    }
    const used = cursor;
    if (used > 1 && Math.abs(used - width) > 1) {
      const slack = width - used;
      const gapTotal = gaps.reduce((s, g) => s + g.width, 0);
      if (slack > 0 && gaps.length > 0) {
        const weights = gaps.map((g) => g.width + 6);
        const wSum = weights.reduce((s, v) => s + v, 0);
        for (let i = 0; i < gaps.length; i++) {
          const g = gaps[i];
          const add = slack * weights[i] / wSum;
          shiftAfter(placements, gaps, g.x + g.width, add, i);
          g.width += add;
        }
      } else if (slack < 0) {
        const shrink = Math.min(gapTotal * 0.92, -slack);
        if (gapTotal > 0.5) {
          const k = shrink / gapTotal;
          for (let i = 0; i < gaps.length; i++) {
            const g = gaps[i];
            const cut = g.width * k;
            shiftAfter(placements, gaps, g.x + g.width, -cut, i);
            g.width -= cut;
          }
        }
        const nowUsed = placements.reduce((s, p) => Math.max(s, p.x + p.width), 0);
        if (nowUsed > width + 1) {
          const k = width / nowUsed;
          for (const p of placements) {
            p.x *= k;
            p.width *= k;
          }
          for (const g of gaps) {
            g.x *= k;
            g.width *= k;
          }
        }
      }
    }
    let maxHeight = 0;
    let minHeight = Infinity;
    let maxW = 0;
    let minW = Infinity;
    const total = Math.max(
      1,
      placements.reduce((s, p) => Math.max(s, p.x + p.width), 0)
    );
    for (const p of placements) {
      p.phase = clamp((p.x + p.width / 2) / total, 0, 1);
      const drawn = p.pose === "flat" ? p.stackY + p.height : p.height;
      maxHeight = Math.max(maxHeight, drawn);
      minHeight = Math.min(minHeight, drawn);
      maxW = Math.max(maxW, p.params.w);
      minW = Math.min(minW, p.params.w);
    }
    for (const p of placements) {
      const right = p.x + p.width;
      let best = 0;
      for (const g of gaps) {
        if (g.x >= right - 0.5 && g.x - right < 3) best = Math.max(best, g.width);
      }
      p.gapAfter = best;
    }
    if (!Number.isFinite(minHeight)) minHeight = 0;
    if (!Number.isFinite(minW)) minW = 1;
    return {
      placements,
      gaps,
      width: total,
      maxHeight,
      minHeight,
      runs,
      skylineVariation: maxHeight > 0 ? (maxHeight - minHeight) / maxHeight : 0,
      thicknessRatio: minW > 0 ? maxW / minW : 1
    };
  }

  // prototypes/books/scenes/baseline.ts
  var TITLES = [
    "Atlas of Quiet Places",
    "The Nightjar",
    "Compendium",
    "Salt",
    "On Growth and Form",
    "Marginalia",
    "The Long Field",
    "Hedgerow",
    "Vespers",
    "A Book of Hours",
    "Wintering",
    "Tide Tables",
    "The Glass Bead Game",
    "Selected Letters",
    "Ash",
    "Almanac",
    "Chalk",
    "The Peregrine",
    "Field Notes",
    "Ravilious",
    "Orchard",
    "Kelp",
    "The Dark is Rising",
    "Ex Libris",
    "Herbarium",
    "Lantern",
    "Quill",
    "Mycelium",
    "Bone China",
    "The Ninth Wave"
  ];
  function rowInputs(count, seedBase = 1) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const seed = seedBase * 7919 + i * 2654435761 >>> 0;
      out.push({ id: `b${i}`, seed, title: TITLES[i % TITLES.length] });
    }
    return out;
  }
  function drawRow(ctx, w, h, opts = {}) {
    const rig = opts.rig ? getLightRig(opts.rig) : DEFAULT_LIGHT_RIG;
    const books = rowInputs(opts.count ?? 26, opts.seed ?? 1);
    const comp = composeShelfRow(books, { width: w - 40, seed: opts.seed ?? 1 });
    const baseline = h - 60;
    ctx.fillStyle = "#1a130d";
    ctx.fillRect(0, 0, w, h);
    for (const p of comp.placements) {
      const hp = p.height;
      ctx.save();
      ctx.translate(20 + p.x, baseline - hp);
      if (p.leanDeg !== 0) {
        ctx.translate(0, hp);
        ctx.rotate(p.leanDeg * Math.PI / 180);
        ctx.translate(0, -hp);
      }
      renderSpine(ctx, p.params, 0, 0, hp, 1, p.title, {
        hiRes: true,
        rig,
        rowPhase: p.phase,
        depth: (p.depth + 1) / 2
      });
      ctx.restore();
    }
    ctx.fillStyle = "#3a2a1a";
    ctx.fillRect(0, baseline, w, 40);
  }
  var BASELINE_SCENES = [
    {
      name: "baseline-row",
      width: 1200,
      height: 420,
      draw: (ctx, w, h) => drawRow(ctx, w, h, { seed: 3 })
    },
    {
      name: "baseline-zoom",
      width: 1200,
      height: 420,
      draw: (ctx, w, h) => {
        const off = document.createElement("canvas");
        off.width = 1200;
        off.height = 420;
        drawRow(off.getContext("2d"), 1200, 420, { seed: 3 });
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(off, 0, 60, 400, 300, 0, 0, w, h);
      }
    }
  ];

  // prototypes/books/scenes/materials.ts
  var MATERIAL_SCENES = [];

  // prototypes/books/scenes/index.ts
  var SCENES = [...BASELINE_SCENES, ...MATERIAL_SCENES];

  // prototypes/books/main.ts
  var canvas = document.getElementById("cv");
  var bar = document.getElementById("bar");
  var status = document.getElementById("status");
  function runScene(scene) {
    canvas.width = scene.width;
    canvas.height = scene.height;
    canvas.style.width = `${Math.min(scene.width, 1360)}px`;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.save();
    const t0 = performance.now();
    scene.draw(ctx, scene.width, scene.height);
    const ms = Math.round(performance.now() - t0);
    ctx.restore();
    status.textContent = `${scene.name} \u2014 ${scene.width}\xD7${scene.height} \u2014 ${ms}ms`;
    return canvas.toDataURL("image/png");
  }
  for (const scene of SCENES) {
    const b = document.createElement("button");
    b.textContent = scene.name;
    b.onclick = () => runScene(scene);
    bar.insertBefore(b, status);
  }
  window.__harness = {
    list: () => SCENES.map((s) => s.name),
    render: (name) => {
      const scene = SCENES.find((s) => s.name === name);
      if (!scene) throw new Error(`no scene "${name}"`);
      return runScene(scene);
    }
  };
  status.textContent = `${SCENES.length} scenes ready`;
})();
