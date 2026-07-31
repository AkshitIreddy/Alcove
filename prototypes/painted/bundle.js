"use strict";
(() => {
  // prototypes/painted/scenes/smoke.ts
  var smokeScene = {
    name: "smoke",
    width: 400,
    height: 200,
    draw(ctx, w, h) {
      ctx.fillStyle = "#2a2016";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#d9a441";
      ctx.fillRect(40, 40, w - 80, h - 80);
      ctx.fillStyle = "#2a2016";
      ctx.font = "24px sans-serif";
      ctx.fillText("harness ok", 60, h / 2 + 8);
    }
  };

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

  // src/art/brush.ts
  var clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
  function clampTo(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
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
  function setPaintQuality(q) {
    PAINT_QUALITY = clampTo(q, 0.2, 2);
  }
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
  function ellipseShape(cx, cy, rx, ry, segments = 48, rotation = 0) {
    const out = [];
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    for (let i = 0; i < segments; i++) {
      const a = i / segments * Math.PI * 2;
      const px = Math.cos(a) * rx;
      const py = Math.sin(a) * ry;
      out.push({ x: cx + px * cos - py * sin, y: cy + px * sin + py * cos });
    }
    return out;
  }
  function leafShape(cx, cy, length, width, angle = 0, bulge = 0.42, asymmetry = 0.12, segments = 28) {
    const out = [];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const skew = Math.log(0.5) / Math.log(clampTo(bulge, 0.08, 0.92));
    const side = (t, sign) => {
      const p = Math.sin(Math.PI * Math.pow(clamp01(t), skew));
      const w = Math.pow(Math.max(0, p), 0.72) * (width / 2) * (1 + sign * asymmetry);
      const lx = t * length - length / 2;
      const ly = sign * w + Math.sin(t * Math.PI) * width * 0.05;
      return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
    };
    for (let i = 0; i <= segments; i++) out.push(side(i / segments, 1));
    for (let i = segments; i >= 0; i--) out.push(side(i / segments, -1));
    return out;
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
  function gradeSurface(surface, opts = {}) {
    const contrast = opts.contrast ?? 1.15;
    const pivot = opts.pivot ?? 0.42;
    const black = opts.black ?? -0.02;
    const tintStrength = opts.tintStrength ?? 0.12;
    const sat = opts.saturation ?? 1.06;
    const shadow = parseColour(opts.shadowTint ?? "#2a3550");
    const highlight = parseColour(opts.highlightTint ?? "#ffd9a0");
    const d = surface.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a <= 2e-3) continue;
      let r = d[i] / a;
      let g = d[i + 1] / a;
      let b = d[i + 2] / a;
      r = clamp01(pivot + (r - pivot) * contrast + black);
      g = clamp01(pivot + (g - pivot) * contrast + black);
      b = clamp01(pivot + (b - pivot) * contrast + black);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const sw = Math.pow(1 - lum, 2) * tintStrength;
      const hw = Math.pow(lum, 2) * tintStrength;
      r = clamp01(r * (1 - sw - hw) + shadow.r * sw + highlight.r * hw);
      g = clamp01(g * (1 - sw - hw) + shadow.g * sw + highlight.g * hw);
      b = clamp01(b * (1 - sw - hw) + shadow.b * sw + highlight.b * hw);
      if (sat !== 1) {
        const l2 = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = clamp01(l2 + (r - l2) * sat);
        g = clamp01(l2 + (g - l2) * sat);
        b = clamp01(l2 + (b - l2) * sat);
      }
      d[i] = r * a;
      d[i + 1] = g * a;
      d[i + 2] = b * a;
    }
  }

  // prototypes/painted/scenes/contact.ts
  var GROUND = "#1c150e";
  var LEAF_GREEN = "#5c7a35";
  var SPINE_RED = "#7d2f28";
  var PLANK_BROWN = "#6b4a2c";
  function leafPoly(w, h) {
    return leafShape(w / 2, h / 2, h * 0.72, h * 0.34, -Math.PI / 2.35, 0.4, 0.14, 30);
  }
  function spinePoly(w, h) {
    return rectShape(w / 2 - w * 0.16, h * 0.1, w * 0.32, h * 0.8);
  }
  function plankPoly(w, h) {
    return rectShape(w * 0.07, h * 0.35, w * 0.86, h * 0.3);
  }
  var SUBJECT = {
    leaf: { poly: leafPoly, colour: LEAF_GREEN },
    spine: { poly: spinePoly, colour: SPINE_RED },
    plank: { poly: plankPoly, colour: PLANK_BROWN }
  };
  function drawFill(ctx, w, h, key) {
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, w, h);
    const poly = SUBJECT[key].poly(w, h);
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (const p of poly.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fillStyle = SUBJECT[key].colour;
    ctx.fill();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#ffffff";
    ctx.save();
    ctx.clip();
    ctx.fillRect(0, 0, w * 0.35, h);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  function paintWithBrush(w, h, key, b, seed) {
    const s = createSurface(w, h, GROUND);
    blockIn(s, SUBJECT[key].poly(w, h), SUBJECT[key].colour, {
      brush: withBrush(b, { colour: SUBJECT[key].colour }),
      passes: 3,
      seed
    });
    return s;
  }
  function paintFull(w, h, key, seed) {
    const s = createSurface(w, h, GROUND);
    const poly = SUBJECT[key].poly(w, h);
    const base = SUBJECT[key].colour;
    const mask = blockIn(s, poly, base, {
      passes: 3,
      valueSpread: 0.11,
      hueSpread: 14,
      openness: 0.16,
      seed
    });
    const u = (x) => (x - mask.x) / mask.width;
    const v = (y) => (y - mask.y) / mask.height;
    scumble(
      s,
      mask,
      brush("chalk", { size: Math.max(4, w * 0.05), colour: "#1a1b2a", opacity: 0.16, grain: 0.85 }),
      {
        coverage: 0.42,
        passes: 2,
        targetBuildup: 0.3,
        patchScale: w * 0.13,
        seed: seed + 1,
        weight: (x, y) => Math.max(0, Math.min(1, u(x) * 1.5 + v(y) * 0.45 - 0.4))
      }
    );
    glaze(s, mask, "#20263c", 0.26, {
      blend: "multiply",
      gradient: (x, y) => Math.max(0, Math.min(1, x / w * 1.3 + y / h * 0.35 - 0.35)),
      mottle: 0.25,
      seed: seed + 2
    });
    scumble(
      s,
      mask,
      brush("bristle", { size: Math.max(3.5, w * 0.04), colour: "#c9a35c", opacity: 0.15, grain: 0.6 }),
      {
        coverage: 0.4,
        passes: 2,
        targetBuildup: 0.32,
        seed: seed + 3,
        patchScale: w * 0.11,
        direction: key === "plank" ? 0 : -Math.PI / 2.3,
        weight: (x, y) => Math.pow(Math.max(0, 1 - u(x) * 1.15 - v(y) * 0.3), 1.1)
      }
    );
    glaze(s, mask, "#ffcf8a", 0.28, {
      blend: "softlight",
      gradient: (x, y) => Math.pow(Math.max(0, 1 - x / w * 1.25 - y / h * 0.2), 1.5),
      mottle: 0.2,
      seed: seed + 4
    });
    if (key === "leaf") {
      const mid = brush("blade", { size: 3.2, colour: "#d8c37a", opacity: 0.4, followPath: true });
      stroke(s, [
        { x: w / 2 + h * 0.1, y: h * 0.86 },
        { x: w / 2, y: h * 0.5 },
        { x: w / 2 - h * 0.04, y: h * 0.16 }
      ], mid, { pressure: PRESSURE.flick, taper: [0.05, 0.35], passes: 2, seed: seed + 5 });
      const vein = brush("blade", { size: 1.9, colour: "#b7c07a", opacity: 0.24, followPath: true });
      for (let i = 0; i < 9; i++) {
        const t = 0.14 + i / 9 * 0.72;
        const sy = h * (0.88 - t * 0.72);
        const dir = i % 2 ? 1 : -1;
        stroke(s, [
          { x: w / 2 + (0.5 - t) * h * 0.1, y: sy },
          { x: w / 2 + dir * h * 0.09 * (1 - Math.abs(t - 0.45)), y: sy - h * 0.075 }
        ], vein, { pressure: PRESSURE.flick, taper: [0.02, 0.5], passes: 1, seed: seed + 60 + i, wobble: 1.2 });
      }
    } else if (key === "spine") {
      const bandY = [0.24, 0.42, 0.62, 0.79];
      const x0 = w / 2 - w * 0.16;
      const x1 = w / 2 + w * 0.16;
      for (const by of bandY) {
        const y = h * by;
        stroke(s, [{ x: x0 - 1, y }, { x: x1 + 1, y }], brush("flat", {
          size: 5.5,
          colour: "#3a1512",
          opacity: 0.3,
          followPath: true
        }), { pressure: PRESSURE.flat, taper: 0.03, passes: 1, seed: seed + 7, wobble: 0.7 });
        stroke(s, [{ x: x0 - 1, y: y - 2.4 }, { x: x1 + 1, y: y - 2.4 }], brush("flat", {
          size: 2.6,
          colour: "#e0b268",
          opacity: 0.34,
          followPath: true
        }), { pressure: PRESSURE.arc, taper: 0.12, passes: 1, seed: seed + 8, wobble: 0.6 });
      }
      for (let i = 0; i < 5; i++) {
        const y = h * 0.5 + (i - 2) * 4.2;
        stroke(
          s,
          [
            { x: x0 + w * 0.05, y },
            { x: x1 - w * 0.05 - i % 2 * w * 0.06, y }
          ],
          brush("ink", { size: 2.1, colour: "#f0cb7d", opacity: 0.3 + i % 3 * 0.12, followPath: true }),
          { pressure: PRESSURE.double, taper: 0.1, passes: 1, seed: seed + 30 + i, wobble: 0.5 }
        );
      }
      const pages = rectShape(x1, h * 0.115, w * 0.05, h * 0.78);
      const pm = blockIn(s, pages, "#c9b489", { passes: 2, valueSpread: 0.1, seed: seed + 9 });
      scumble(s, pm, brush("blade", { size: 2.4, colour: "#8a7752", opacity: 0.18 }), {
        coverage: 0.5,
        direction: Math.PI / 2,
        targetBuildup: 0.35,
        seed: seed + 10,
        passes: 1
      });
    } else {
      for (let i = 0; i < 16; i++) {
        const y = h * 0.36 + i / 16 * h * 0.28 + Math.sin(i * 2.3) * 1.4;
        stroke(s, [
          { x: w * 0.06, y },
          { x: w * 0.35, y: y + Math.sin(i) * 2.2 },
          { x: w * 0.68, y: y - Math.cos(i * 1.7) * 2.6 },
          { x: w * 0.94, y: y + Math.sin(i * 0.7) * 1.5 }
        ], brush("blade", {
          size: 1.5 + i % 3 * 0.8,
          colour: i % 3 === 0 ? "#3a2716" : "#8a6236",
          opacity: 0.16 + i % 4 * 0.05,
          followPath: true
        }), { pressure: PRESSURE.arc, taper: 0.16, passes: 1, seed: seed + 80 + i, wobble: 1.1 });
      }
      const knot = roughenShape(ellipseShape(w * 0.63, h * 0.49, 5.5, 3.4, 20), 1.1, seed + 12);
      const km = rasterizeShape(knot, 6);
      scumble(s, km, brush("chalk", { size: 4, colour: "#2a1a0d", opacity: 0.24 }), {
        coverage: 0.85,
        passes: 2,
        targetBuildup: 0.7,
        seed: seed + 13
      });
    }
    edgeVary(s, poly, {
      crisp: 0.3,
      lost: 0.22,
      band: 3,
      lightAngle: Math.PI * 0.75,
      accentStrength: 0.42,
      seed: seed + 14
    });
    glaze(s, null, "#0d0a08", 0.42, {
      blend: "multiply",
      gradient: (x, y) => Math.pow(Math.max(0, (Math.hypot(x / w - 0.42, y / h - 0.4) - 0.42) / 0.5), 1.4),
      mottle: 0.1,
      seed: seed + 15
    });
    addGrain(s, 0.045, 1.7, seed + 16);
    gradeSurface(s, { contrast: 1.16, pivot: 0.4, black: -0.025, tintStrength: 0.14, saturation: 1.1 });
    return s;
  }
  var COLS = [
    { label: "ctx.fill (old)", render: () => "fill" },
    { label: "soft", render: (w, h, k) => paintWithBrush(w, h, k, brush("soft", { size: Math.max(6, w * 0.16), opacity: 0.13 }), 11) },
    { label: "bristle", render: (w, h, k) => paintWithBrush(w, h, k, brush("bristle", { size: Math.max(6, w * 0.15), opacity: 0.16 }), 22) },
    { label: "chalk", render: (w, h, k) => paintWithBrush(w, h, k, brush("chalk", { size: Math.max(6, w * 0.16), opacity: 0.15 }), 33) },
    { label: "flat", render: (w, h, k) => paintWithBrush(w, h, k, brush("flat", { size: Math.max(7, w * 0.2), opacity: 0.17 }), 44) },
    { label: "sponge", render: (w, h, k) => paintWithBrush(w, h, k, brush("sponge", { size: Math.max(7, w * 0.18), opacity: 0.16 }), 55) },
    { label: "FULL RECIPE", render: (w, h, k) => paintFull(w, h, k, 101) }
  ];
  var ROWS = ["leaf", "spine", "plank"];
  var CELL_W = 170;
  var CELL_H = 190;
  var PAD = 12;
  var HEAD = 30;
  var LABEL = 22;
  var contactScene = {
    name: "contact",
    width: PAD + COLS.length * (CELL_W + PAD) + 70,
    height: HEAD + ROWS.length * (CELL_H + LABEL + PAD) + PAD,
    draw(ctx, w, h) {
      ctx.fillStyle = "#0e0b08";
      ctx.fillRect(0, 0, w, h);
      ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "middle";
      COLS.forEach((col, ci) => {
        ctx.fillStyle = ci === COLS.length - 1 ? "#f0c46a" : ci === 0 ? "#e07a6a" : "#9c9282";
        ctx.textAlign = "center";
        ctx.fillText(col.label, PAD + 70 + ci * (CELL_W + PAD) + CELL_W / 2, HEAD / 2 + 4);
      });
      ROWS.forEach((key, ri) => {
        const y = HEAD + ri * (CELL_H + LABEL + PAD);
        ctx.fillStyle = "#8d8375";
        ctx.textAlign = "left";
        ctx.fillText(key, 10, y + CELL_H / 2);
        COLS.forEach((col, ci) => {
          const x = PAD + 70 + ci * (CELL_W + PAD);
          const out = col.render(CELL_W, CELL_H, key);
          if (out === "fill") {
            ctx.save();
            ctx.translate(x, y);
            drawFill(ctx, CELL_W, CELL_H, key);
            ctx.restore();
          } else {
            drawSurface(ctx, out, x, y);
          }
          ctx.strokeStyle = ci === COLS.length - 1 ? "#8a6a2a" : "#2c241a";
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, CELL_W - 1, CELL_H - 1);
        });
      });
    }
  };

  // prototypes/painted/scenes/detail.ts
  var GROUND2 = "#181109";
  var KEY = Math.PI * 0.75;
  function paintLeaf(w, h, seed, upTo = 99) {
    const s = createSurface(w, h, GROUND2);
    const poly = leafShape(w * 0.5, h * 0.52, h * 0.78, h * 0.4, -Math.PI / 2.2, 0.4, 0.16, 40);
    const mask = blockIn(s, poly, "#3d5226", {
      passes: 3,
      valueSpread: 0.12,
      hueSpread: 16,
      roughness: h * 0.012,
      seed
    });
    const u = (x) => (x - mask.x) / mask.width;
    const v = (y) => (y - mask.y) / mask.height;
    if (upTo < 2) return finish(s, seed);
    scumble(s, mask, brush("chalk", { size: w * 0.05, colour: "#1d2a2e", opacity: 0.16, grain: 0.85 }), {
      coverage: 0.42,
      passes: 2,
      patchScale: w * 0.13,
      targetBuildup: 0.3,
      seed: seed + 1,
      weight: (x, y) => Math.max(0, Math.min(1, u(x) * 1.5 + v(y) * 0.45 - 0.42))
    });
    glaze(s, mask, "#182234", 0.24, {
      blend: "multiply",
      gradient: (x, y) => Math.max(0, Math.min(1, x / w * 1.4 + y / h * 0.5 - 0.5)),
      mottle: 0.25,
      seed: seed + 2
    });
    if (upTo < 3) return finish(s, seed);
    scumble(s, mask, brush("bristle", { size: w * 0.038, colour: "#9fbc4e", opacity: 0.15, grain: 0.6 }), {
      coverage: 0.4,
      passes: 2,
      patchScale: w * 0.1,
      targetBuildup: 0.32,
      direction: -Math.PI / 2.2,
      seed: seed + 3,
      weight: (x, y) => Math.pow(Math.max(0, 1 - u(x) * 1.15 - v(y) * 0.3), 1.1)
    });
    scumble(s, mask, brush("sponge", { size: w * 0.028, colour: "#d8e07a", opacity: 0.14 }), {
      coverage: 0.26,
      passes: 1,
      patchScale: w * 0.07,
      targetBuildup: 0.26,
      edgeBias: 0.25,
      seed: seed + 4,
      weight: (x, y) => Math.pow(Math.max(0, 1 - u(x) * 1.5 - v(y) * 0.45), 1.4)
    });
    glaze(s, mask, "#ffd88f", 0.26, {
      blend: "softlight",
      gradient: (x, y) => Math.pow(Math.max(0, 1 - x / w * 1.35 - y / h * 0.3), 1.4),
      mottle: 0.22,
      seed: seed + 5
    });
    if (upTo < 4) return finish(s, seed);
    const tip = { x: w * 0.5 - h * 0.05, y: h * 0.14 };
    const base = { x: w * 0.5 + h * 0.1, y: h * 0.9 };
    stroke(
      s,
      [base, { x: w * 0.5 + h * 0.02, y: h * 0.5 }, tip],
      brush("blade", { size: w * 0.022, colour: "#e6dc9a", opacity: 0.42, followPath: true }),
      { pressure: PRESSURE.flick, taper: [0.04, 0.4], passes: 2, seed: seed + 6, wobble: 1.4 }
    );
    for (let i = 0; i < 13; i++) {
      const t = 0.1 + i / 13 * 0.78;
      const ax = base.x + (tip.x - base.x) * t;
      const ay = base.y + (tip.y - base.y) * t;
      const dir = i % 2 ? 1 : -1;
      const reach = h * 0.17 * Math.sin(Math.PI * Math.min(1, t * 1.15));
      stroke(s, [
        { x: ax, y: ay },
        { x: ax + dir * reach * 0.75, y: ay - reach * 0.5 },
        { x: ax + dir * reach, y: ay - reach * 0.95 }
      ], brush("blade", {
        size: w * 0.012,
        colour: i % 3 ? "#b9c778" : "#8fa35c",
        opacity: 0.24,
        followPath: true
      }), { pressure: PRESSURE.flick, taper: [0.02, 0.55], passes: 1, seed: seed + 20 + i, wobble: 1.2 });
    }
    for (let i = 0; i < 3; i++) {
      const bx = w * (0.36 + i * 0.14);
      const by = h * (0.3 + i * 37 % 40 / 100);
      const bm = rasterizeShape(roughenShape(ellipseShape(bx, by, w * 0.035, w * 0.026, 18), 2.2, seed + i), 5);
      scumble(s, bm, brush("chalk", { size: w * 0.02, colour: i ? "#6d5a22" : "#3c3a1c", opacity: 0.16 }), {
        coverage: 0.6,
        passes: 1,
        seed: seed + 40 + i
      });
    }
    if (upTo < 5) return finish(s, seed);
    edgeVary(s, poly, { crisp: 0.34, lost: 0.24, band: 3.4, lightAngle: KEY, accentStrength: 0.5, seed: seed + 7 });
    return finish(s, seed);
  }
  function finish(s, seed) {
    addGrain(s, 0.05, 1.8, seed + 90);
    gradeSurface(s, { contrast: 1.18, pivot: 0.4, black: -0.03, tintStrength: 0.15, saturation: 1.12 });
    return s;
  }
  function paintSpine(w, h, seed) {
    const s = createSurface(w, h, GROUND2);
    const x0 = w * 0.28;
    const x1 = w * 0.7;
    const poly = rectShape(x0, h * 0.07, x1 - x0, h * 0.86);
    const mask = blockIn(s, poly, "#5e2321", {
      passes: 3,
      valueSpread: 0.1,
      hueSpread: 12,
      roughness: w * 6e-3,
      feather: 1.1,
      seed
    });
    scumble(s, mask, brush("chalk", { size: w * 0.03, colour: "#3a1210", opacity: 0.22, grain: 0.9 }), {
      coverage: 0.44,
      passes: 2,
      patchScale: w * 0.08,
      targetBuildup: 0.3,
      seed: seed + 1,
      weight: (x) => Math.max(0.15, Math.min(1, (x - x0) / (x1 - x0) * 1.4))
    });
    scumble(s, mask, brush("sponge", { size: w * 0.018, colour: "#8c4a36", opacity: 0.2 }), {
      coverage: 0.3,
      passes: 1,
      patchScale: w * 0.055,
      targetBuildup: 0.26,
      seed: seed + 2,
      weight: (x) => Math.pow(Math.max(0, 1 - (x - x0) / (x1 - x0) * 1.3), 1.3)
    });
    for (let i = 0; i < 30; i++) {
      const cy = h * (0.08 + i / 30 * 0.84);
      stroke(
        s,
        [
          { x: x0 + w * 0.01, y: cy },
          { x: (x0 + x1) / 2, y: cy + (i % 2 ? 2.5 : -2.5) },
          { x: x1 - w * 0.01, y: cy + (i % 3 ? -1.5 : 2) }
        ],
        brush("blade", { size: 1.3, colour: i % 4 ? "#43191a" : "#8a5140", opacity: 0.12, followPath: true }),
        { pressure: PRESSURE.arc, taper: 0.2, passes: 1, seed: seed + 100 + i, wobble: 1.6 }
      );
    }
    glaze(s, mask, "#141c30", 0.3, {
      blend: "multiply",
      gradient: (x) => Math.pow(Math.max(0, (x - x0) / (x1 - x0)), 1.5),
      mottle: 0.16,
      seed: seed + 3
    });
    glaze(s, mask, "#ffd18a", 0.28, {
      blend: "softlight",
      gradient: (x) => Math.pow(Math.max(0, 1 - (x - x0) / (x1 - x0)), 1.8),
      mottle: 0.18,
      seed: seed + 4
    });
    for (const by of [0.2, 0.36, 0.55, 0.72, 0.87]) {
      const y = h * by;
      stroke(
        s,
        [{ x: x0 - 1, y: y + 3 }, { x: x1 + 1, y: y + 3 }],
        brush("flat", { size: w * 0.05, colour: "#240b0b", opacity: 0.3, followPath: true }),
        { pressure: PRESSURE.flat, taper: 0.03, passes: 1, seed: seed + 5, wobble: 0.8 }
      );
      stroke(
        s,
        [{ x: x0 - 1, y }, { x: x1 + 1, y }],
        brush("flat", { size: w * 0.035, colour: "#7c3a2e", opacity: 0.35, followPath: true }),
        { pressure: PRESSURE.flat, taper: 0.03, passes: 1, seed: seed + 6, wobble: 0.7 }
      );
      stroke(
        s,
        [{ x: x0 - 1, y: y - w * 0.02 }, { x: x1 * 0.86, y: y - w * 0.02 }],
        brush("blade", { size: w * 0.014, colour: "#e8bd76", opacity: 0.4, followPath: true }),
        { pressure: PRESSURE.arc, taper: 0.15, passes: 1, seed: seed + 7, wobble: 0.6 }
      );
    }
    for (let i = 0; i < 4; i++) {
      const y = h * 0.44 + i * (h * 0.018);
      const inset = w * (0.02 + i % 2 * 0.04);
      stroke(
        s,
        [{ x: x0 + inset + w * 0.02, y }, { x: x1 - inset - w * 0.02, y }],
        brush("ink", { size: w * 0.012, colour: "#f4d288", opacity: 0.22 + i % 3 * 0.16, followPath: true }),
        { pressure: PRESSURE.double, taper: 0.12, passes: 1, seed: seed + 200 + i, wobble: 0.7 }
      );
    }
    const pages = rectShape(x1, h * 0.085, w * 0.075, h * 0.845);
    const pm = blockIn(s, pages, "#c4ac7e", { passes: 2, valueSpread: 0.12, roughness: 0.8, seed: seed + 8 });
    scumble(s, pm, brush("blade", { size: w * 6e-3, colour: "#7d6a45", opacity: 0.16 }), {
      coverage: 0.6,
      passes: 2,
      direction: Math.PI / 2,
      seed: seed + 9
    });
    glaze(s, pm, "#ffe0a8", 0.3, { blend: "screen", gradient: (_x, y) => Math.pow(Math.max(0, 1 - y / h * 2.2), 2), mottle: 0.2, seed: seed + 10 });
    edgeVary(s, poly, { crisp: 0.4, lost: 0.16, band: 3, lightAngle: KEY, accentStrength: 0.5, seed: seed + 11 });
    return finish(s, seed);
  }
  function paintPlank(w, h, seed) {
    const s = createSurface(w, h, GROUND2);
    const poly = rectShape(w * 0.04, h * 0.3, w * 0.92, h * 0.34);
    const mask = blockIn(s, poly, "#6a4626", {
      passes: 3,
      valueSpread: 0.1,
      hueSpread: 10,
      roughness: 1.2,
      feather: 1.2,
      direction: 0,
      seed
    });
    for (let i = 0; i < 46; i++) {
      const y = h * 0.31 + i / 46 * h * 0.32;
      const path = [];
      for (let k = 0; k <= 6; k++) {
        const x = w * (0.03 + k / 6 * 0.94);
        path.push({ x, y: y + Math.sin(k * 1.7 + i) * 2.4 + Math.sin(k * 0.6 + i * 2.2) * 1.3 });
      }
      stroke(s, path, brush("blade", {
        size: 1 + i % 4 * 0.7,
        colour: i % 5 === 0 ? "#301d0e" : i % 3 === 0 ? "#946a3c" : "#4d3319",
        opacity: 0.1 + i % 4 * 0.05,
        followPath: true
      }), { pressure: PRESSURE.arc, taper: 0.1, passes: 1, seed: seed + 300 + i, wobble: 1.4 });
    }
    for (const [kx, ky, kr] of [[0.34, 0.47, 1], [0.72, 0.44, 0.7]]) {
      const km = rasterizeShape(roughenShape(ellipseShape(w * kx, h * ky, w * 0.022 * kr, h * 0.05 * kr, 22), 1.4, seed), 8);
      scumble(s, km, brush("chalk", { size: w * 0.012, colour: "#241305", opacity: 0.2 }), {
        coverage: 0.85,
        passes: 2,
        seed: seed + 12
      });
      for (let r = 1; r <= 3; r++) {
        const ring = roughenShape(ellipseShape(w * kx, h * ky, w * (0.022 + r * 0.012) * kr, h * (0.05 + r * 0.025) * kr, 30), 1.6, seed + r);
        stroke(
          s,
          ring,
          brush("blade", { size: 1.2, colour: "#3a2410", opacity: 0.16, followPath: true }),
          { closed: true, pressure: PRESSURE.flat, taper: 0, passes: 1, seed: seed + 400 + r, wobble: 1.1 }
        );
      }
    }
    glaze(s, mask, "#101828", 0.34, {
      blend: "multiply",
      gradient: (_x, y) => Math.pow(Math.max(0, (y / h - 0.3) / 0.34), 1.3),
      mottle: 0.2,
      seed: seed + 13
    });
    glaze(s, mask, "#ffcf87", 0.42, {
      blend: "softlight",
      gradient: (_x, y) => Math.pow(Math.max(0, 1 - (y / h - 0.28) / 0.2), 1.6),
      mottle: 0.18,
      seed: seed + 14
    });
    edgeVary(s, poly, { crisp: 0.38, lost: 0.2, band: 3, lightAngle: KEY, accentStrength: 0.45, seed: seed + 15 });
    return finish(s, seed);
  }
  var D_W = 400;
  var D_H = 460;
  var detailScene = {
    name: "detail",
    width: 3 * D_W + 4 * 14,
    height: D_H + 44,
    draw(ctx, w, h) {
      ctx.fillStyle = "#0e0b08";
      ctx.fillRect(0, 0, w, h);
      const items = [
        ["leaf", paintLeaf(D_W, D_H, 7)],
        ["spine", paintSpine(D_W, D_H, 19)],
        ["plank", paintPlank(D_W, D_H, 29)]
      ];
      items.forEach(([label, surf], i) => {
        const x = 14 + i * (D_W + 14);
        drawSurface(ctx, surf, x, 30);
        ctx.fillStyle = "#a2977f";
        ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(label, x, 16);
      });
    }
  };
  var zoomScene = {
    name: "zoom",
    width: 1290,
    height: 470,
    draw(ctx, w, h) {
      ctx.fillStyle = "#0e0b08";
      ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = false;
      const leaf = paintLeaf(D_W, D_H, 7);
      const spine = paintSpine(D_W, D_H, 19);
      const crops = [
        [leaf, 118, 90, "leaf edge + blade"],
        [spine, 96, 120, "spine: leather, band, foil"]
      ];
      crops.forEach(([surf, cx, cy, label], i) => {
        const x = 10 + i * 640;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, 28, 620, 430);
        ctx.clip();
        ctx.translate(x - cx * 3, 28 - cy * 3);
        ctx.scale(3, 3);
        drawSurface(ctx, surf, 0, 0);
        ctx.restore();
        ctx.fillStyle = "#a2977f";
        ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        ctx.fillText(label, x, 14);
      });
    }
  };
  var qualityScene = {
    name: "quality",
    width: 3 * 300 + 4 * 12,
    height: 360 + 44,
    draw(ctx, w, h) {
      ctx.fillStyle = "#0e0b08";
      ctx.fillRect(0, 0, w, h);
      ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      [1, 0.6, 0.35].forEach((q, i) => {
        setPaintQuality(q);
        const t0 = performance.now();
        const surf = paintSpine(300, 360, 19);
        const ms = Math.round(performance.now() - t0);
        const x = 12 + i * (300 + 12);
        drawSurface(ctx, surf, x, 30);
        ctx.fillStyle = i === 0 ? "#f0c46a" : "#a2977f";
        ctx.fillText(`quality ${q} \u2014 ${ms}ms`, x, 16);
      });
      setPaintQuality(1);
    }
  };
  var L_W = 260;
  var L_H = 300;
  var LAYER_LABELS = ["1 blockIn", "2 + shade", "3 + light", "4 + detail", "5 + edgeVary"];
  var layersScene = {
    name: "layers",
    width: LAYER_LABELS.length * (L_W + 12) + 12,
    height: L_H + 44,
    draw(ctx, w, h) {
      ctx.fillStyle = "#0e0b08";
      ctx.fillRect(0, 0, w, h);
      ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      LAYER_LABELS.forEach((label, i) => {
        const x = 12 + i * (L_W + 12);
        drawSurface(ctx, paintLeaf(L_W, L_H, 7, i + 1), x, 30);
        ctx.fillStyle = i === LAYER_LABELS.length - 1 ? "#f0c46a" : "#a2977f";
        ctx.fillText(label, x, 16);
      });
    }
  };

  // prototypes/painted/scenes/mass.ts
  var CW = 150;
  var CH = 190;
  var ZOOM = 2;
  var VARIANTS = [
    { label: "current .10/.28/.34/3", kind: "chalk", spacing: 0.1, rowFactor: 0.28, opacity: 0.34, passes: 3, sizeFactor: 0.5 },
    { label: "spacing .22", kind: "chalk", spacing: 0.22, rowFactor: 0.28, opacity: 0.34, passes: 3, sizeFactor: 0.5 },
    { label: "row .5", kind: "chalk", spacing: 0.18, rowFactor: 0.5, opacity: 0.42, passes: 3, sizeFactor: 0.5 },
    { label: "row .6 \xB7 2 pass", kind: "chalk", spacing: 0.2, rowFactor: 0.6, opacity: 0.5, passes: 2, sizeFactor: 0.5 },
    { label: "row .6 \xB7 big head", kind: "chalk", spacing: 0.22, rowFactor: 0.6, opacity: 0.5, passes: 2, sizeFactor: 0.85 },
    { label: "bristle row .55", kind: "bristle", spacing: 0.2, rowFactor: 0.55, opacity: 0.5, passes: 2, sizeFactor: 0.7 },
    { label: "flat row .55", kind: "flat", spacing: 0.16, rowFactor: 0.55, opacity: 0.5, passes: 2, sizeFactor: 0.7 },
    { label: "flat row .7 \xB7 3 pass", kind: "flat", spacing: 0.18, rowFactor: 0.7, opacity: 0.55, passes: 3, sizeFactor: 0.8 }
  ];
  var massScene = {
    name: "mass",
    width: 4 * (CW * ZOOM + 12) + 12,
    height: 2 * (CH * ZOOM + 30) + 12,
    draw(ctx, w, h) {
      ctx.fillStyle = "#0e0b08";
      ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingEnabled = false;
      ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      VARIANTS.forEach((v, i) => {
        const col = i % 4;
        const row = i / 4 | 0;
        const x = 12 + col * (CW * ZOOM + 12);
        const y = 26 + row * (CH * ZOOM + 30);
        const s = createSurface(CW, CH, "#181109");
        const short = CH * 0.62;
        blockIn(s, rectShape(CW * 0.16, CH * 0.1, CW * 0.68, CH * 0.8), "#6a2b26", {
          brush: brush(v.kind, {
            size: short * v.sizeFactor * 0.5,
            opacity: v.opacity,
            spacing: v.spacing,
            grain: 0.62,
            hardness: 0.45,
            jitter: { size: 0.3, opacity: 0.4, angle: 0.4, hue: 8, sat: 0.06, lum: 0.08, position: 1.4 }
          }),
          passes: v.passes,
          rowFactor: v.rowFactor,
          valueSpread: 0.13,
          hueSpread: 14,
          seed: 4242
        });
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(ZOOM, ZOOM);
        drawSurface(ctx, s, 0, 0);
        ctx.restore();
        ctx.fillStyle = "#a2977f";
        ctx.fillText(v.label, x, y - 12);
      });
    }
  };

  // prototypes/painted/scenes/index.ts
  var SCENES = [contactScene, detailScene, layersScene, zoomScene, qualityScene, massScene, smokeScene];

  // prototypes/painted/main.ts
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
  if (SCENES.length) runScene(SCENES[0]);
})();
