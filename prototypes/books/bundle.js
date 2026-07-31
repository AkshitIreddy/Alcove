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
  var fastFloor = (x2) => Math.floor(x2) | 0;
  var grad2 = /* @__PURE__ */ new Float64Array([
    1,
    1,
    -1,
    1,
    1,
    -1,
    -1,
    -1,
    1,
    0,
    -1,
    0,
    1,
    0,
    -1,
    0,
    0,
    1,
    0,
    -1,
    0,
    1,
    0,
    -1
  ]);
  function createNoise2D(random = Math.random) {
    const perm = buildPermutationTable(random);
    const permGrad2x = new Float64Array(perm).map((v2) => grad2[v2 % 12 * 2]);
    const permGrad2y = new Float64Array(perm).map((v2) => grad2[v2 % 12 * 2 + 1]);
    return function noise2D(x2, y2) {
      let n0 = 0;
      let n1 = 0;
      let n2 = 0;
      const s2 = (x2 + y2) * F2;
      const i2 = fastFloor(x2 + s2);
      const j2 = fastFloor(y2 + s2);
      const t3 = (i2 + j2) * G2;
      const X0 = i2 - t3;
      const Y0 = j2 - t3;
      const x0 = x2 - X0;
      const y0 = y2 - Y0;
      let i1, j1;
      if (x0 > y0) {
        i1 = 1;
        j1 = 0;
      } else {
        i1 = 0;
        j1 = 1;
      }
      const x1 = x0 - i1 + G2;
      const y1 = y0 - j1 + G2;
      const x22 = x0 - 1 + 2 * G2;
      const y22 = y0 - 1 + 2 * G2;
      const ii = i2 & 255;
      const jj = j2 & 255;
      let t0 = 0.5 - x0 * x0 - y0 * y0;
      if (t0 >= 0) {
        const gi0 = ii + perm[jj];
        const g0x = permGrad2x[gi0];
        const g0y = permGrad2y[gi0];
        t0 *= t0;
        n0 = t0 * t0 * (g0x * x0 + g0y * y0);
      }
      let t1 = 0.5 - x1 * x1 - y1 * y1;
      if (t1 >= 0) {
        const gi1 = ii + i1 + perm[jj + j1];
        const g1x = permGrad2x[gi1];
        const g1y = permGrad2y[gi1];
        t1 *= t1;
        n1 = t1 * t1 * (g1x * x1 + g1y * y1);
      }
      let t22 = 0.5 - x22 * x22 - y22 * y22;
      if (t22 >= 0) {
        const gi2 = ii + 1 + perm[jj + 1];
        const g2x = permGrad2x[gi2];
        const g2y = permGrad2y[gi2];
        t22 *= t22;
        n2 = t22 * t22 * (g2x * x22 + g2y * y22);
      }
      return 70 * (n0 + n1 + n2);
    };
  }
  function buildPermutationTable(random) {
    const tableSize = 512;
    const p2 = new Uint8Array(tableSize);
    for (let i2 = 0; i2 < tableSize / 2; i2++) {
      p2[i2] = i2;
    }
    for (let i2 = 0; i2 < tableSize / 2 - 1; i2++) {
      const r2 = i2 + ~~(random() * (256 - i2));
      const aux = p2[i2];
      p2[i2] = p2[r2];
      p2[r2] = aux;
    }
    for (let i2 = 256; i2 < tableSize; i2++) {
      p2[i2] = p2[i2 - 256];
    }
    return p2;
  }

  // src/art/noise.ts
  function mulberry32(seed) {
    let a2 = seed >>> 0;
    return () => {
      a2 = a2 + 1831565813 >>> 0;
      let t3 = a2;
      t3 = Math.imul(t3 ^ t3 >>> 15, t3 | 1);
      t3 ^= t3 + Math.imul(t3 ^ t3 >>> 7, t3 | 61);
      return ((t3 ^ t3 >>> 14) >>> 0) / 4294967296;
    };
  }
  function seededNoise2D(seed) {
    return createNoise2D(mulberry32(seed));
  }
  function lerp(a2, b2, t3) {
    return a2 + (b2 - a2) * t3;
  }
  function clamp(v2, min, max) {
    return v2 < min ? min : v2 > max ? max : v2;
  }
  function fract(v2) {
    return v2 - Math.floor(v2);
  }

  // src/art/brush.ts
  var clamp01 = (v2) => v2 < 0 ? 0 : v2 > 1 ? 1 : v2;
  function parseColour(input) {
    if (typeof input !== "string") {
      if ("r" in input) return { r: clamp01(input.r), g: clamp01(input.g), b: clamp01(input.b) };
      return hslToRgb(input);
    }
    const s2 = input.trim().toLowerCase();
    if (s2.startsWith("#")) {
      const hex = s2.slice(1);
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
    const nums = s2.match(/-?[\d.]+/g)?.map(Number) ?? [];
    if (s2.startsWith("hsl")) {
      return hslToRgb({ h: nums[0] ?? 0, s: (nums[1] ?? 0) / 100, l: (nums[2] ?? 0) / 100 });
    }
    return { r: (nums[0] ?? 0) / 255, g: (nums[1] ?? 0) / 255, b: (nums[2] ?? 0) / 255 };
  }
  function hslToRgb({ h: h2, s: s2, l: l2 }) {
    const hh = (h2 % 360 + 360) % 360;
    const ss = clamp01(s2);
    const ll = clamp01(l2);
    if (ss === 0) return { r: ll, g: ll, b: ll };
    const c2 = (1 - Math.abs(2 * ll - 1)) * ss;
    const x2 = c2 * (1 - Math.abs(hh / 60 % 2 - 1));
    const m2 = ll - c2 / 2;
    let r2 = 0;
    let g2 = 0;
    let b2 = 0;
    if (hh < 60) [r2, g2, b2] = [c2, x2, 0];
    else if (hh < 120) [r2, g2, b2] = [x2, c2, 0];
    else if (hh < 180) [r2, g2, b2] = [0, c2, x2];
    else if (hh < 240) [r2, g2, b2] = [0, x2, c2];
    else if (hh < 300) [r2, g2, b2] = [x2, 0, c2];
    else [r2, g2, b2] = [c2, 0, x2];
    return { r: r2 + m2, g: g2 + m2, b: b2 + m2 };
  }
  function rgbToHsl({ r: r2, g: g2, b: b2 }) {
    const max = Math.max(r2, g2, b2);
    const min = Math.min(r2, g2, b2);
    const l2 = (max + min) / 2;
    const d2 = max - min;
    if (d2 === 0) return { h: 0, s: 0, l: l2 };
    const s2 = d2 / (1 - Math.abs(2 * l2 - 1));
    let h2;
    if (max === r2) h2 = 60 * ((g2 - b2) / d2 % 6);
    else if (max === g2) h2 = 60 * ((b2 - r2) / d2 + 2);
    else h2 = 60 * ((r2 - g2) / d2 + 4);
    return { h: (h2 + 360) % 360, s: clamp01(s2), l: l2 };
  }
  function mixRgb(a2, b2, t3) {
    return { r: a2.r + (b2.r - a2.r) * t3, g: a2.g + (b2.g - a2.g) * t3, b: a2.b + (b2.b - a2.b) * t3 };
  }
  function shiftHsl(colour, dh, ds, dl) {
    const hsl = rgbToHsl(parseColour(colour));
    return hslToRgb({ h: hsl.h + dh, s: clamp01(hsl.s + ds), l: clamp01(hsl.l + dl) });
  }
  function luminance({ r: r2, g: g2, b: b2 }) {
    return 0.2126 * r2 + 0.7152 * g2 + 0.0722 * b2;
  }
  function createSurface(width, height, ground) {
    const w2 = Math.max(1, Math.round(width));
    const h2 = Math.max(1, Math.round(height));
    const surface = { width: w2, height: h2, data: new Float32Array(w2 * h2 * 4) };
    if (ground !== void 0) fillSurface(surface, ground);
    return surface;
  }
  function fillSurface(surface, colour, alpha = 1) {
    const c2 = parseColour(colour);
    const a2 = clamp01(alpha);
    const d2 = surface.data;
    for (let i2 = 0; i2 < d2.length; i2 += 4) {
      d2[i2] = c2.r * a2;
      d2[i2 + 1] = c2.g * a2;
      d2[i2 + 2] = c2.b * a2;
      d2[i2 + 3] = a2;
    }
  }
  function getPixel(surface, x2, y2) {
    const xi = Math.max(0, Math.min(surface.width - 1, Math.round(x2)));
    const yi = Math.max(0, Math.min(surface.height - 1, Math.round(y2)));
    const i2 = (yi * surface.width + xi) * 4;
    const a2 = surface.data[i2 + 3];
    if (a2 <= 1e-6) return { r: 0, g: 0, b: 0, a: 0 };
    return { r: surface.data[i2] / a2, g: surface.data[i2 + 1] / a2, b: surface.data[i2 + 2] / a2, a: a2 };
  }
  function surfaceToRGBA8(surface, background) {
    const out = new Uint8ClampedArray(surface.width * surface.height * 4);
    const d2 = surface.data;
    const bg = background === void 0 ? null : parseColour(background);
    for (let i2 = 0, o2 = 0; i2 < d2.length; i2 += 4, o2 += 4) {
      let a2 = d2[i2 + 3];
      let r2 = d2[i2];
      let g2 = d2[i2 + 1];
      let b2 = d2[i2 + 2];
      if (bg) {
        r2 += bg.r * (1 - a2);
        g2 += bg.g * (1 - a2);
        b2 += bg.b * (1 - a2);
        a2 = 1;
      }
      if (a2 <= 1e-6) {
        out[o2] = 0;
        out[o2 + 1] = 0;
        out[o2 + 2] = 0;
        out[o2 + 3] = 0;
        continue;
      }
      out[o2] = clamp01(r2 / a2) * 255;
      out[o2 + 1] = clamp01(g2 / a2) * 255;
      out[o2 + 2] = clamp01(b2 / a2) * 255;
      out[o2 + 3] = clamp01(a2) * 255;
    }
    return out;
  }
  function surfaceToImageData(surface, background) {
    return new ImageData(surfaceToRGBA8(surface, background), surface.width, surface.height);
  }
  function drawSurface(ctx, surface, x2 = 0, y2 = 0) {
    const tmp = document.createElement("canvas");
    tmp.width = surface.width;
    tmp.height = surface.height;
    const tctx = tmp.getContext("2d");
    tctx.putImageData(surfaceToImageData(surface), 0, 0);
    ctx.drawImage(tmp, x2, y2);
  }
  function compositeSurface(dst, src, x2 = 0, y2 = 0, alpha = 1, blend = "normal") {
    const ox = Math.round(x2);
    const oy = Math.round(y2);
    const x0 = Math.max(0, ox);
    const y0 = Math.max(0, oy);
    const x1 = Math.min(dst.width, ox + src.width);
    const y1 = Math.min(dst.height, oy + src.height);
    const a2 = clamp01(alpha);
    if (a2 <= 0) return;
    for (let dy = y0; dy < y1; dy++) {
      for (let dx = x0; dx < x1; dx++) {
        const si = ((dy - oy) * src.width + (dx - ox)) * 4;
        const sa = src.data[si + 3];
        if (sa <= 2e-3) continue;
        compositePixel(dst.data, (dy * dst.width + dx) * 4, src.data[si] / sa, src.data[si + 1] / sa, src.data[si + 2] / sa, sa * a2, blend);
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
    const d2 = surface.data;
    for (let y2 = 0; y2 < surface.height; y2++) {
      for (let x2 = 0; x2 < surface.width; x2++) {
        const i2 = (y2 * surface.width + x2) * 4;
        if (d2[i2 + 3] <= 2e-3) continue;
        const sx = x2 + ox;
        const sy = y2 + oy;
        let dist = maskDistanceAt(mask, sx, sy);
        if (noise > 0) dist -= (clamp01((fbm(sx / noiseScale, sy / noiseScale, seed, 3) - 0.26) / 0.48) - 0.5) * 2 * noise;
        const k = clamp01(0.5 - dist / (feather * 2));
        if (k >= 0.999) continue;
        d2[i2] *= k;
        d2[i2 + 1] *= k;
        d2[i2 + 2] *= k;
        d2[i2 + 3] *= k;
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
  function compositePixel(d2, i2, r2, g2, b2, aS, mode) {
    if (aS <= 0) return;
    const aD = d2[i2 + 3];
    if (mode === "erase") {
      const keep = 1 - aS;
      d2[i2] *= keep;
      d2[i2 + 1] *= keep;
      d2[i2 + 2] *= keep;
      d2[i2 + 3] = aD * keep;
      return;
    }
    if (mode === "normal" || aD <= 1e-6) {
      const inv2 = 1 - aS;
      d2[i2] = r2 * aS + d2[i2] * inv2;
      d2[i2 + 1] = g2 * aS + d2[i2 + 1] * inv2;
      d2[i2 + 2] = b2 * aS + d2[i2 + 2] * inv2;
      d2[i2 + 3] = aS + aD * inv2;
      return;
    }
    const cdR = d2[i2] / aD;
    const cdG = d2[i2 + 1] / aD;
    const cdB = d2[i2 + 2] / aD;
    const bR = blendChannel(mode, cdR, r2);
    const bG = blendChannel(mode, cdG, g2);
    const bB = blendChannel(mode, cdB, b2);
    const mR = (1 - aD) * r2 + aD * bR;
    const mG = (1 - aD) * g2 + aD * bG;
    const mB = (1 - aD) * b2 + aD * bB;
    const inv = 1 - aS;
    d2[i2] = mR * aS + d2[i2] * inv;
    d2[i2 + 1] = mG * aS + d2[i2 + 1] * inv;
    d2[i2 + 2] = mB * aS + d2[i2 + 2] * inv;
    d2[i2 + 3] = aS + aD * inv;
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
  function hash2(x2, y2, seed) {
    let h2 = x2 * 374761393 + y2 * 668265263 + seed * 1274126177 | 0;
    h2 = h2 ^ h2 >>> 13 | 0;
    h2 = Math.imul(h2, 1274126177);
    return ((h2 ^ h2 >>> 16) >>> 0) / 4294967296;
  }
  function valueNoise(x2, y2, seed) {
    const xi = Math.floor(x2);
    const yi = Math.floor(y2);
    const xf = x2 - xi;
    const yf = y2 - yi;
    const u2 = xf * xf * (3 - 2 * xf);
    const v2 = yf * yf * (3 - 2 * yf);
    const a2 = hash2(xi, yi, seed);
    const b2 = hash2(xi + 1, yi, seed);
    const c2 = hash2(xi, yi + 1, seed);
    const e2 = hash2(xi + 1, yi + 1, seed);
    return (a2 + (b2 - a2) * u2) * (1 - v2) + (c2 + (e2 - c2) * u2) * v2;
  }
  function fbm(x2, y2, seed, octaves = 3) {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let fx = x2;
    let fy = y2;
    for (let o2 = 0; o2 < octaves; o2++) {
      sum += valueNoise(fx, fy, seed + o2 * 1013) * amp;
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
    const c2 = (px - 1) / 2;
    const seed = (variant & 7) * 7919 + px * 31 + hB * 101;
    const rand = mulberry32(seed);
    const squash = 1 + (rand() - 0.5) * 0.28;
    const tilt = (rand() - 0.5) * 0.5;
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);
    const bristleCount = 5 + Math.floor(rand() * 7);
    const bristleY = [];
    const bristleW = [];
    for (let i2 = 0; i2 < bristleCount; i2++) {
      bristleY.push((i2 / (bristleCount - 1) - 0.5) * 2 + (rand() - 0.5) * 0.18);
      bristleW.push(0.35 + rand() * 0.65);
    }
    for (let y2 = 0; y2 < px; y2++) {
      for (let x2 = 0; x2 < px; x2++) {
        const dx0 = (x2 - c2) / c2;
        const dy0 = (y2 - c2) / c2;
        const lx = (dx0 * cosT + dy0 * sinT) * squash;
        const ly = (-dx0 * sinT + dy0 * cosT) / squash;
        let a2 = 0;
        switch (kind) {
          case "soft": {
            const r2 = Math.hypot(lx, ly);
            if (r2 >= 1) break;
            const exp = 1.05 + hardness * 5.5;
            a2 = Math.pow(1 - r2, exp);
            break;
          }
          case "ink": {
            const r2 = Math.hypot(lx, ly);
            const edge = 1 - Math.max(0, Math.min(1, (r2 - (0.82 - hardness * 0.12)) / 0.2));
            a2 = edge;
            break;
          }
          case "bristle": {
            const r2 = Math.hypot(lx, ly);
            if (r2 >= 1) break;
            const body = Math.pow(1 - r2, 0.8 + hardness * 2.4);
            let streak = 0;
            for (let i2 = 0; i2 < bristleCount; i2++) {
              const d2 = Math.abs(ly - bristleY[i2]);
              const w2 = 0.06 + 0.09 * bristleW[i2];
              if (d2 < w2 * 2.6) streak = Math.max(streak, bristleW[i2] * Math.exp(-(d2 * d2) / (2 * w2 * w2)));
            }
            const along = 0.55 + 0.45 * (1 - Math.abs(lx));
            a2 = body * (0.18 + 0.95 * streak) * along;
            break;
          }
          case "chalk": {
            const r2 = Math.hypot(lx, ly);
            if (r2 >= 1) break;
            const body = Math.pow(1 - r2, 0.55 + hardness * 1.9);
            const n2 = fbm((x2 + seed) * 0.85, (y2 - seed) * 0.85, seed, 3);
            const bite = 1 - grain;
            const tooth = Math.max(0, (n2 - 0.34 * grain) / (1 - 0.34 * grain));
            a2 = body * (bite + (1 - bite) * tooth * 1.35);
            break;
          }
          case "flat": {
            const ax = Math.abs(lx);
            const ay = Math.abs(ly) / 0.42;
            if (ax >= 1 || ay >= 1) break;
            const endFall = Math.pow(1 - ax, 0.35 + (1 - hardness) * 1.4);
            const sideFall = Math.pow(1 - ay, 0.3 + (1 - hardness) * 1.6);
            let streak = 1;
            for (let i2 = 0; i2 < bristleCount; i2++) {
              const d2 = Math.abs(ly / 0.42 - bristleY[i2]);
              if (d2 < 0.1) streak = Math.min(streak, 0.55 + bristleW[i2] * 0.45);
            }
            a2 = endFall * sideFall * streak;
            break;
          }
          case "blade": {
            const ax = Math.abs(lx);
            const ay = Math.abs(ly) / 0.34;
            if (ax >= 1 || ay >= 1) break;
            const crisp = ly < 0 ? 1 : Math.pow(1 - ay, 1.6);
            a2 = Math.pow(1 - ax, 0.3) * crisp * (1 - ay * 0.35);
            break;
          }
          case "sponge": {
            const r2 = Math.hypot(lx, ly);
            if (r2 >= 1) break;
            const body = Math.pow(1 - r2, 0.7);
            const n2 = fbm((x2 + seed * 0.5) * 0.5, (y2 + seed * 0.7) * 0.5, seed + 5, 3);
            const clump = Math.max(0, (n2 - 0.42) / 0.58);
            a2 = body * clump * 1.8;
            break;
          }
        }
        if (a2 > 0) {
          const jn = hash2(x2 * 7 + variant, y2 * 13 - variant, seed + 991);
          a2 *= 1 - grain * 0.22 * jn;
        }
        alpha[y2 * px + x2] = a2 > 1 ? 1 : a2 < 0 ? 0 : a2;
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
  function dab(surface, x2, y2, b2, opts = {}) {
    const size = Math.max(1.2, opts.size ?? b2.size);
    const alphaMul = clamp01((opts.opacity ?? b2.opacity) * b2.flow);
    if (alphaMul <= 6e-4) return;
    const angle = opts.angle ?? b2.angle;
    const colour = opts.colour === void 0 ? b2.colour : parseColour(opts.colour);
    const blend = opts.blend ?? b2.blend;
    const variant = opts.variant ?? Math.floor(hash2(Math.round(x2 * 3.1), Math.round(y2 * 3.7), 4919) * b2.variants);
    const kernel = makeKernel(b2.kind, Math.min(256, Math.max(3, Math.round(size))), b2.hardness, b2.grain, variant);
    const k = kernel.size;
    const kc = (k - 1) / 2;
    const scale = k / size;
    const half = size * 0.5 * Math.SQRT2 + 1;
    const x0 = Math.max(0, Math.floor(x2 - half));
    const x1 = Math.min(surface.width - 1, Math.ceil(x2 + half));
    const y0 = Math.max(0, Math.floor(y2 - half));
    const y1 = Math.min(surface.height - 1, Math.ceil(y2 + half));
    if (x1 < x0 || y1 < y0) return;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const stepX = cos * scale;
    const stepY = sin * scale;
    const d2 = surface.data;
    const ka = kernel.alpha;
    const { r: r2, g: g2, b: bl } = colour;
    const kMax = k - 1;
    const w2 = surface.width;
    const bilinear = size >= 14;
    const normal = blend === "normal";
    for (let py = y0; py <= y1; py++) {
      const dy = py + 0.5 - y2;
      const dx0 = x0 + 0.5 - x2;
      let kx = (dx0 * cos - dy * sin) * scale + kc;
      let ky = (dx0 * sin + dy * cos) * scale + kc;
      let idx = (py * w2 + x0) * 4;
      for (let px = x0; px <= x1; px++, kx += stepX, ky += stepY, idx += 4) {
        if (kx < 0 || ky < 0 || kx > kMax || ky > kMax) continue;
        const ix = kx | 0;
        const iy = ky | 0;
        let a2;
        if (bilinear) {
          const fx = kx - ix;
          const fy = ky - iy;
          const ix1 = ix + 1 < k ? ix + 1 : ix;
          const iy1 = iy + 1 < k ? iy + 1 : iy;
          const row0 = iy * k;
          const row1 = iy1 * k;
          a2 = (ka[row0 + ix] * (1 - fx) + ka[row0 + ix1] * fx) * (1 - fy) + (ka[row1 + ix] * (1 - fx) + ka[row1 + ix1] * fx) * fy;
        } else {
          a2 = ka[iy * k + ix];
        }
        if (a2 <= 8e-4) continue;
        const aS = a2 * alphaMul;
        if (normal) {
          const inv = 1 - aS;
          d2[idx] = r2 * aS + d2[idx] * inv;
          d2[idx + 1] = g2 * aS + d2[idx + 1] * inv;
          d2[idx + 2] = bl * aS + d2[idx + 2] * inv;
          d2[idx + 3] = aS + d2[idx + 3] * inv;
        } else {
          compositePixel(d2, idx, r2, g2, bl, aS, blend);
        }
      }
    }
  }
  function pathLength(pts) {
    let len = 0;
    for (let i2 = 1; i2 < pts.length; i2++) len += Math.hypot(pts[i2].x - pts[i2 - 1].x, pts[i2].y - pts[i2 - 1].y);
    return len;
  }
  function smoothPath(pts, subdivisions = 8) {
    if (pts.length < 3) return pts.map((p2) => ({ ...p2 }));
    const out = [];
    const at = (i2) => pts[Math.max(0, Math.min(pts.length - 1, i2))];
    for (let i2 = 0; i2 < pts.length - 1; i2++) {
      const p0 = at(i2 - 1);
      const p1 = at(i2);
      const p2 = at(i2 + 1);
      const p3 = at(i2 + 2);
      for (let s2 = 0; s2 < subdivisions; s2++) {
        const t3 = s2 / subdivisions;
        const t22 = t3 * t3;
        const t32 = t22 * t3;
        out.push({
          x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t3 + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t22 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t32),
          y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t3 + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t22 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t32)
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
    const s2 = Math.max(0.15, step);
    let travelled = 0;
    let carry = 0;
    for (let i2 = 1; i2 < pts.length; i2++) {
      const a2 = pts[i2 - 1];
      const b2 = pts[i2];
      const dx = b2.x - a2.x;
      const dy = b2.y - a2.y;
      const segLen = Math.hypot(dx, dy);
      if (segLen < 1e-9) continue;
      const angle = Math.atan2(dy, dx);
      let d2 = carry;
      while (d2 <= segLen) {
        const u2 = d2 / segLen;
        out.push({ x: a2.x + dx * u2, y: a2.y + dy * u2, angle, t: (travelled + d2) / total });
        d2 += s2;
      }
      carry = d2 - segLen;
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
    arc: (t3) => Math.sin(Math.PI * clamp01(t3)) ** 0.55,
    /** Lands hard, lifts off — a flick. */
    flick: (t3) => Math.pow(1 - clamp01(t3), 0.7),
    /** Lifts on, presses down — for stems thickening into a trunk. */
    swell: (t3) => Math.pow(clamp01(t3), 0.7),
    /** Two accents with a thin waist — a leaf ridge or a decorative rule. */
    double: (t3) => 0.45 + 0.55 * Math.abs(Math.cos(Math.PI * clamp01(t3)))
  };
  function stroke(surface, path, b2, opts = {}) {
    if (path.length === 0) return;
    const rng = opts.rng ?? mulberry32((opts.seed ?? 20973) >>> 0);
    const passes = Math.max(1, Math.round(opts.passes ?? 2));
    const taper = typeof opts.taper === "number" ? [opts.taper, opts.taper] : opts.taper ?? [0.12, 0.12];
    const pressure = opts.pressure ?? PRESSURE.arc;
    const wobbleAmp = opts.wobble ?? b2.size * 0.06;
    const alphaMul = opts.alpha ?? 1;
    let pts = path.map((p2) => ({ ...p2 }));
    if (opts.closed && pts.length > 2) pts.push({ ...pts[0] });
    if ((opts.smooth ?? true) && pts.length >= 3) pts = smoothPath(pts, 6);
    const step = Math.max(0.4, b2.size * b2.spacing);
    const samples = resamplePath(pts, step);
    if (samples.length === 0) return;
    const hsl = rgbToHsl(b2.colour);
    for (let pass = 0; pass < passes; pass++) {
      const passSeedX = rng() * 1e3;
      const passSeedY = rng() * 1e3;
      const lateral = pass === 0 ? 0 : (rng() * 2 - 1) * (opts.passOffset ?? b2.size * 0.16);
      const passAlpha = pass === 0 ? 1 : 0.62 + rng() * 0.3;
      for (let i2 = 0; i2 < samples.length; i2++) {
        const s2 = samples[i2];
        const j2 = b2.jitter;
        let profile = pressure(s2.t);
        const [tIn, tOut] = taper;
        if (tIn > 0 && s2.t < tIn) profile *= Math.pow(s2.t / tIn, 0.6);
        if (tOut > 0 && s2.t > 1 - tOut) profile *= Math.pow((1 - s2.t) / tOut, 0.6);
        if (profile <= 8e-3) continue;
        const nx = -Math.sin(s2.angle);
        const ny = Math.cos(s2.angle);
        const wob = wobbleAmp === 0 ? 0 : (fbm(s2.t * 7 + passSeedX, passSeedY, 17, 2) - 0.5) * 2 * wobbleAmp;
        const scat = (rng() * 2 - 1) * b2.scatter * b2.size;
        const off = lateral + wob + scat;
        const jx = (rng() * 2 - 1) * j2.position;
        const jy = (rng() * 2 - 1) * j2.position;
        const x2 = s2.x + nx * off + jx;
        const y2 = s2.y + ny * off + jy;
        const size = b2.size * profile * (1 + (rng() * 2 - 1) * j2.size);
        const opacity = b2.opacity * passAlpha * alphaMul * (0.55 + 0.45 * profile) * (1 + (rng() * 2 - 1) * j2.opacity);
        const angle = (b2.followPath ? s2.angle + b2.angle : b2.angle) + (rng() * 2 - 1) * j2.angle;
        const grad = opts.gradient?.(s2.t);
        const colour = hslToRgb({
          h: hsl.h + (rng() * 2 - 1) * j2.hue + (grad?.dh ?? 0),
          s: clamp01(hsl.s + (rng() * 2 - 1) * j2.sat + (grad?.ds ?? 0)),
          l: clamp01(hsl.l + (rng() * 2 - 1) * j2.lum + (grad?.dl ?? 0))
        });
        dab(surface, x2, y2, b2, { size, opacity, angle, colour, variant: Math.floor(rng() * b2.variants) });
      }
    }
  }
  function rectShape(x2, y2, w2, h2) {
    return [
      { x: x2, y: y2 },
      { x: x2 + w2, y: y2 },
      { x: x2 + w2, y: y2 + h2 },
      { x: x2, y: y2 + h2 }
    ];
  }
  function densifyShape(shape, maxSegment) {
    const out = [];
    const n2 = shape.length;
    const step = Math.max(0.5, maxSegment);
    for (let i2 = 0; i2 < n2; i2++) {
      const a2 = shape[i2];
      const b2 = shape[(i2 + 1) % n2];
      const len = Math.hypot(b2.x - a2.x, b2.y - a2.y);
      const parts = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k < parts; k++) {
        out.push({ x: a2.x + (b2.x - a2.x) * k / parts, y: a2.y + (b2.y - a2.y) * k / parts });
      }
    }
    return out;
  }
  function roughenShape(shape, amount, seed = 1, frequency = 2.2) {
    let perimeter = 0;
    for (let i2 = 0; i2 < shape.length; i2++) {
      const a2 = shape[i2];
      const b2 = shape[(i2 + 1) % shape.length];
      perimeter += Math.hypot(b2.x - a2.x, b2.y - a2.y);
    }
    if (shape.length < perimeter / Math.max(2, amount * 2.5)) {
      shape = densifyShape(shape, Math.max(2, amount * 2.5));
    }
    const n2 = shape.length;
    let cx = 0;
    let cy = 0;
    for (const p2 of shape) {
      cx += p2.x;
      cy += p2.y;
    }
    cx /= n2;
    cy /= n2;
    return shape.map((p2, i2) => {
      const t3 = i2 / n2 * frequency * Math.PI * 2;
      const d2 = (fbm(Math.cos(t3) * 2 + 4, Math.sin(t3) * 2 + 4, seed, 2) - 0.5) * 2 * amount;
      const dx = p2.x - cx;
      const dy = p2.y - cy;
      const len = Math.hypot(dx, dy) || 1;
      return { x: p2.x + dx / len * d2, y: p2.y + dy / len * d2 };
    });
  }
  function rasterizeShape(shape, pad = 8) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p2 of shape) {
      if (p2.x < minX) minX = p2.x;
      if (p2.y < minY) minY = p2.y;
      if (p2.x > maxX) maxX = p2.x;
      if (p2.y > maxY) maxY = p2.y;
    }
    const x0 = Math.floor(minX - pad);
    const y0 = Math.floor(minY - pad);
    const w2 = Math.max(1, Math.ceil(maxX + pad) - x0);
    const h2 = Math.max(1, Math.ceil(maxY + pad) - y0);
    const coverage = new Float32Array(w2 * h2);
    const SUB = 4;
    const subWeight = 1 / SUB;
    const xs = [];
    const n2 = shape.length;
    for (let sy = 0; sy < h2 * SUB; sy++) {
      const py = y0 + (sy + 0.5) / SUB;
      xs.length = 0;
      for (let i2 = 0, j2 = n2 - 1; i2 < n2; j2 = i2++) {
        const yi = shape[i2].y;
        const yj = shape[j2].y;
        if (yi > py === yj > py) continue;
        xs.push(shape[i2].x + (py - yi) / (yj - yi) * (shape[j2].x - shape[i2].x));
      }
      if (xs.length < 2) continue;
      xs.sort((a2, b2) => a2 - b2);
      const row = sy / SUB | 0;
      const rowBase = row * w2;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        let xa = xs[k] - x0;
        let xb = xs[k + 1] - x0;
        if (xb <= 0 || xa >= w2) continue;
        if (xa < 0) xa = 0;
        if (xb > w2) xb = w2;
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
    for (let i2 = 0; i2 < coverage.length; i2++) if (coverage[i2] > 1) coverage[i2] = 1;
    return { x: x0, y: y0, width: w2, height: h2, coverage, distance: chamferSDF(coverage, w2, h2) };
  }
  function chamferSDF(coverage, w2, h2) {
    const BIG = 1e9;
    const inner = new Float32Array(w2 * h2);
    const outer = new Float32Array(w2 * h2);
    for (let i2 = 0; i2 < coverage.length; i2++) {
      const solid = coverage[i2] >= 0.5;
      inner[i2] = solid ? BIG : 0;
      outer[i2] = solid ? 0 : BIG;
    }
    const sweep = (f2) => {
      const D1 = 1;
      const D2 = 1.41421356;
      for (let y2 = 0; y2 < h2; y2++) {
        for (let x2 = 0; x2 < w2; x2++) {
          const i2 = y2 * w2 + x2;
          let v2 = f2[i2];
          if (x2 > 0) v2 = Math.min(v2, f2[i2 - 1] + D1);
          if (y2 > 0) v2 = Math.min(v2, f2[i2 - w2] + D1);
          if (x2 > 0 && y2 > 0) v2 = Math.min(v2, f2[i2 - w2 - 1] + D2);
          if (x2 < w2 - 1 && y2 > 0) v2 = Math.min(v2, f2[i2 - w2 + 1] + D2);
          f2[i2] = v2;
        }
      }
      for (let y2 = h2 - 1; y2 >= 0; y2--) {
        for (let x2 = w2 - 1; x2 >= 0; x2--) {
          const i2 = y2 * w2 + x2;
          let v2 = f2[i2];
          if (x2 < w2 - 1) v2 = Math.min(v2, f2[i2 + 1] + D1);
          if (y2 < h2 - 1) v2 = Math.min(v2, f2[i2 + w2] + D1);
          if (x2 < w2 - 1 && y2 < h2 - 1) v2 = Math.min(v2, f2[i2 + w2 + 1] + D2);
          if (x2 > 0 && y2 < h2 - 1) v2 = Math.min(v2, f2[i2 + w2 - 1] + D2);
          f2[i2] = v2;
        }
      }
    };
    sweep(inner);
    sweep(outer);
    const sdf = new Float32Array(w2 * h2);
    for (let i2 = 0; i2 < sdf.length; i2++) sdf[i2] = outer[i2] > 0 ? outer[i2] : -inner[i2];
    return sdf;
  }
  function maskCoverageAt(mask, x2, y2) {
    const mx = Math.round(x2) - mask.x;
    const my = Math.round(y2) - mask.y;
    if (mx < 0 || my < 0 || mx >= mask.width || my >= mask.height) return 0;
    return mask.coverage[my * mask.width + mx];
  }
  function maskDistanceAt(mask, x2, y2) {
    const mx = Math.round(x2) - mask.x;
    const my = Math.round(y2) - mask.y;
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
    for (const p2 of shape) {
      minX = Math.min(minX, p2.x);
      minY = Math.min(minY, p2.y);
      maxX = Math.max(maxX, p2.x);
      maxY = Math.max(maxY, p2.y);
    }
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const short = Math.min(bw, bh);
    const rough = opts.roughness ?? Math.max(0.6, short * 0.04);
    const silhouette = rough > 0 ? roughenShape(shape, rough, seed, 2.6) : shape.map((p2) => ({ ...p2 }));
    const mask = rasterizeShape(silhouette, Math.max(6, short * 0.25));
    const overshoot = opts.overshoot ?? Math.max(1.2, short * 0.05);
    const passes = Math.max(1, Math.round(opts.passes ?? 2));
    const valueSpread = opts.valueSpread ?? 0.11;
    const hueSpread = opts.hueSpread ?? 12;
    const openness = clamp01(opts.openness ?? 0.08);
    const b2 = opts.brush ?? brush("chalk", {
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
      const under = withBrush(b2, {
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
          gradient: (t3) => ({ dl: (t3 - 0.5) * valueSpread * 0.9, dh: (t3 - 0.5) * hueSpread * 0.8 })
        });
      }
    }
    for (let pass = 0; pass < passes; pass++) {
      const angle = dir + (pass - (passes - 1) / 2) * 0.18 + (rng() * 2 - 1) * 0.08;
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const span = Math.hypot(bw, bh) / 2 + overshoot + b2.size;
      const rowStep = Math.max(1.2, b2.size * (opts.rowFactor ?? 0.55));
      for (let vRow = -span; vRow <= span; vRow += rowStep) {
        const lineSeed = rng();
        const v2 = vRow + (rng() * 2 - 1) * rowStep * 0.4;
        const rowAngle = angle + (rng() * 2 - 1) * 0.09;
        const rcos = Math.cos(rowAngle);
        const rsin = Math.sin(rowAngle);
        const path = [];
        for (let u2 = -span; u2 <= span; u2 += Math.max(2, b2.size * 0.5)) {
          path.push({ x: cx + u2 * rcos - v2 * rsin, y: cy + u2 * rsin + v2 * rcos });
        }
        const kept = [];
        let run = [];
        for (const p2 of path) {
          const d2 = maskDistanceAt(mask, p2.x, p2.y);
          const slop = overshoot * (0.35 + 0.65 * fbm(p2.x * 0.05, p2.y * 0.05, seed + 3, 2));
          if (d2 < slop) run.push(p2);
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
          const local = seg.map((p2) => ({ x: p2.x - lox, y: p2.y - loy }));
          stroke(layer, local, withBrush(b2, { colour: colourHere, blend: "normal" }), {
            pressure: PRESSURE.flat,
            taper: 0.03,
            passes: 1,
            smooth: false,
            alpha: 1 - openness * fbm(mid.x * 0.03, mid.y * 0.03, seed + 21, 2),
            rng,
            wobble: b2.size * 0.1
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
  function scumble(surface, mask, b2, opts = {}) {
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
    const hsl = rgbToHsl(b2.colour);
    const area = mask.width * mask.height;
    const budgetKernel = makeKernel(
      b2.kind,
      Math.min(256, Math.max(3, Math.round(b2.size))),
      b2.hardness,
      b2.grain,
      0
    );
    let kSum = 0;
    for (const a2 of budgetKernel.alpha) kSum += a2;
    const kMean = Math.max(0.02, kSum / budgetKernel.alpha.length);
    const perStamp = Math.max(1, b2.size * b2.size * kMean);
    const need = -Math.log(1 - Math.min(0.985, clamp01(opts.targetBuildup ?? 0.5)));
    const q2 = PAINT_QUALITY;
    const flow = Math.max(0.06, Math.min(1, b2.opacity * b2.flow / q2));
    const opacityScale = flow / Math.max(1e-6, b2.opacity * b2.flow);
    const total = Math.min(4e4, Math.round(area * need / (perStamp * flow) * density / passes));
    if (total <= 0) return;
    let deepest = 1;
    for (let i2 = 0; i2 < mask.distance.length; i2 += 7) deepest = Math.min(deepest, mask.distance[i2]);
    const depth = Math.max(2, -deepest);
    for (let pass = 0; pass < passes; pass++) {
      const px = rng() * 500;
      const py = rng() * 500;
      const passAlpha = 1 - pass * 0.12;
      for (let n2 = 0; n2 < total; n2++) {
        const x2 = mask.x + rng() * mask.width;
        const y2 = mask.y + rng() * mask.height;
        const cov = maskCoverageAt(mask, x2, y2);
        if (cov < threshold) continue;
        const wgt = opts.weight ? clamp01(opts.weight(x2, y2)) : 1;
        if (wgt <= 0.01 || rng() > wgt) continue;
        const patch = clamp01((fbm((x2 + px) / patchScale, (y2 + py) / patchScale, seed + pass * 37, 3) - 0.26) / 0.48);
        let keep = patch;
        if (edgeBias !== 0) {
          const d2 = -maskDistanceAt(mask, x2, y2) / depth;
          keep *= edgeBias > 0 ? 1 - d2 * edgeBias : 1 + d2 * edgeBias;
        }
        if (keep < 1 - coverage) continue;
        const size = b2.size * (1 + (rng() * 2 - 1) * sizeSpread);
        const angle = (opts.direction ?? rng() * Math.PI * 2) + (rng() * 2 - 1) * (opts.direction === void 0 ? 0 : b2.jitter.angle);
        const opacity = b2.opacity * opacityScale * passAlpha * alphaMul * cov * (0.5 + 0.5 * wgt) * (0.35 + 0.9 * keep) * (1 + (rng() * 2 - 1) * b2.jitter.opacity);
        const colour = hslToRgb({
          h: hsl.h + (rng() * 2 - 1) * b2.jitter.hue + (patch - 0.5) * b2.jitter.hue * 1.6,
          s: clamp01(hsl.s + (rng() * 2 - 1) * b2.jitter.sat),
          l: clamp01(hsl.l + (rng() * 2 - 1) * b2.jitter.lum + (patch - 0.5) * b2.jitter.lum * 1.8)
        });
        dab(surface, x2, y2, b2, { size, opacity, angle, colour, variant: Math.floor(rng() * b2.variants) });
      }
    }
  }
  function glaze(surface, mask, colour, alpha, opts = {}) {
    const c2 = parseColour(colour);
    const blend = opts.blend ?? "normal";
    const mottle = opts.mottle ?? 0.18;
    const mottleScale = opts.mottleScale ?? 90;
    const seed = (opts.seed ?? 24994) >>> 0;
    const clip = opts.clip ?? mask !== null;
    const x0 = mask && clip ? Math.max(0, mask.x) : 0;
    const y0 = mask && clip ? Math.max(0, mask.y) : 0;
    const x1 = mask && clip ? Math.min(surface.width, mask.x + mask.width) : surface.width;
    const y1 = mask && clip ? Math.min(surface.height, mask.y + mask.height) : surface.height;
    const d2 = surface.data;
    for (let y2 = y0; y2 < y1; y2++) {
      for (let x2 = x0; x2 < x1; x2++) {
        let a2 = alpha;
        if (mask && clip) {
          const cov = mask.coverage[(y2 - mask.y) * mask.width + (x2 - mask.x)];
          if (cov <= 2e-3) continue;
          a2 *= cov;
        }
        if (opts.gradient) {
          a2 *= opts.gradient(x2, y2);
          if (a2 <= 8e-4) continue;
        }
        if (mottle > 0) {
          a2 *= 1 - mottle + mottle * 2 * fbm(x2 / mottleScale, y2 / mottleScale, seed, 3);
        }
        if (a2 <= 8e-4) continue;
        compositePixel(d2, (y2 * surface.width + x2) * 4, c2.r, c2.g, c2.b, a2 > 1 ? 1 : a2, blend);
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
    for (let i2 = 0; i2 < samples.length; i2++) {
      const s2 = samples[i2];
      const f2 = clamp01((fbm(s2.x * frequency * 0.06, s2.y * frequency * 0.06, seed, 2) - 0.24) / 0.52);
      if (f2 > 1 - crispFrac) {
        let colour;
        if (opts.accent !== void 0) {
          colour = parseColour(opts.accent);
        } else {
          const px = getPixel(surface, s2.x, s2.y);
          const hsl = rgbToHsl({ r: px.r, g: px.g, b: px.b });
          let lift = -0.16;
          if (opts.lightAngle !== void 0) {
            const nrm = s2.angle - Math.PI / 2;
            const facing = Math.cos(nrm - (opts.lightAngle + Math.PI));
            lift = facing > 0.2 ? 0.14 * facing : -0.18;
          }
          colour = hslToRgb({ h: hsl.h + (lift > 0 ? -6 : 8), s: clamp01(hsl.s + 0.05), l: clamp01(hsl.l + lift) });
        }
        const nx = -Math.sin(s2.angle);
        const ny = Math.cos(s2.angle);
        for (const side of [-0.35, 0.3]) {
          dab(surface, s2.x + nx * band * side, s2.y + ny * band * side, accentBrush, {
            colour,
            angle: s2.angle,
            size: accentBrush.size * (0.7 + rng() * 0.7),
            opacity: accentStrength * (0.55 + rng() * 0.6)
          });
        }
      } else if (f2 < lostFrac) {
        blurDisc(surface, s2.x, s2.y, softness * (1.1 + rng() * 0.9), 0.9);
      }
    }
  }
  function blurDisc(surface, cx, cy, radius, amount = 1) {
    const r2 = Math.max(1, Math.round(radius));
    const x0 = Math.max(1, Math.floor(cx - r2));
    const x1 = Math.min(surface.width - 2, Math.ceil(cx + r2));
    const y0 = Math.max(1, Math.floor(cy - r2));
    const y1 = Math.min(surface.height - 2, Math.ceil(cy + r2));
    if (x1 <= x0 || y1 <= y0) return;
    const w2 = surface.width;
    const d2 = surface.data;
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const src = new Float32Array(bw * bh * 4);
    for (let y2 = 0; y2 < bh; y2++) {
      const from = ((y0 + y2) * w2 + x0) * 4;
      src.set(d2.subarray(from, from + bw * 4), y2 * bw * 4);
    }
    const kr = Math.max(1, Math.round(r2 * 0.4));
    for (let y2 = 0; y2 < bh; y2++) {
      for (let x2 = 0; x2 < bw; x2++) {
        const sx = x0 + x2;
        const sy = y0 + y2;
        const dist = Math.hypot(sx + 0.5 - cx, sy + 0.5 - cy);
        if (dist > r2) continue;
        const wgt = amount * (1 - dist / r2);
        if (wgt <= 4e-3) continue;
        let ar = 0;
        let ag = 0;
        let ab = 0;
        let aa = 0;
        let n2 = 0;
        for (let ky = -kr; ky <= kr; ky++) {
          const yy = y2 + ky;
          if (yy < 0 || yy >= bh) continue;
          for (let kx = -kr; kx <= kr; kx++) {
            const xx = x2 + kx;
            if (xx < 0 || xx >= bw) continue;
            const i2 = (yy * bw + xx) * 4;
            ar += src[i2];
            ag += src[i2 + 1];
            ab += src[i2 + 2];
            aa += src[i2 + 3];
            n2++;
          }
        }
        if (n2 === 0) continue;
        const o2 = (sy * w2 + sx) * 4;
        const inv = 1 - wgt;
        d2[o2] = d2[o2] * inv + ar / n2 * wgt;
        d2[o2 + 1] = d2[o2 + 1] * inv + ag / n2 * wgt;
        d2[o2 + 2] = d2[o2 + 2] * inv + ab / n2 * wgt;
        d2[o2 + 3] = d2[o2 + 3] * inv + aa / n2 * wgt;
      }
    }
  }
  function addGrain(surface, amount = 0.05, scale = 1.6, seed = 7, mask = null) {
    const d2 = surface.data;
    for (let y2 = 0; y2 < surface.height; y2++) {
      for (let x2 = 0; x2 < surface.width; x2++) {
        const i2 = (y2 * surface.width + x2) * 4;
        if (d2[i2 + 3] <= 2e-3) continue;
        let k = amount;
        if (mask) {
          const cov = maskCoverageAt(mask, x2, y2);
          if (cov <= 2e-3) continue;
          k *= cov;
        }
        const n2 = (fbm(x2 / scale, y2 / scale, seed, 2) - 0.5) * 2 * k;
        const m2 = 1 + n2;
        d2[i2] = clamp01(d2[i2] * m2);
        d2[i2 + 1] = clamp01(d2[i2 + 1] * m2);
        d2[i2 + 2] = clamp01(d2[i2 + 2] * m2);
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
    (c2) => c2 !== "none"
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
    const n2 = CHARM_COLORS.length;
    const i2 = (Math.trunc(index) % n2 + n2) % n2;
    return CHARM_COLORS[i2];
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
    const h2 = raw.replace("#", "");
    const full = h2.length === 3 ? `${h2[0]}${h2[0]}${h2[1]}${h2[1]}${h2[2]}${h2[2]}` : h2;
    const n2 = Number.parseInt(full.slice(0, 6), 16);
    if (!Number.isFinite(n2)) return [128, 128, 128];
    return [n2 >> 16 & 255, n2 >> 8 & 255, n2 & 255];
  }
  function rgbCss(r2, g2, b2, a2 = 1) {
    const cl = (v2) => Math.round(clamp(v2, 0, 255));
    return a2 >= 1 ? `rgb(${cl(r2)} ${cl(g2)} ${cl(b2)})` : `rgb(${cl(r2)} ${cl(g2)} ${cl(b2)} / ${a2})`;
  }
  function mixHex(a2, b2, t3, alpha = 1) {
    const [r1, g1, b1] = hexToRgb(a2);
    const [r2, g2, b22] = hexToRgb(b2);
    return rgbCss(r1 + (r2 - r1) * t3, g1 + (g2 - g1) * t3, b1 + (b22 - b1) * t3, alpha);
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
    for (let i2 = 1; i2 < pts.length; i2++) ctx.lineTo(pts[i2].x, pts[i2].y);
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
  }
  function strokePath(ctx, pts, style, width) {
    const first = pts[0];
    if (!first) return;
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i2 = 1; i2 < pts.length; i2++) ctx.lineTo(pts[i2].x, pts[i2].y);
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }
  function blobPath(cx, cy, r2, n2, wobble, rnd) {
    const pts = [];
    for (let i2 = 0; i2 < n2; i2++) {
      const a2 = i2 / n2 * Math.PI * 2;
      const rr = r2 * (1 + (rnd() * 2 - 1) * wobble);
      pts.push({ x: cx + Math.cos(a2) * rr, y: cy + Math.sin(a2) * rr });
    }
    return pts;
  }
  function softShadow(ctx, x2, y2, w2, h2, alpha) {
    const g2 = ctx.createRadialGradient(x2 + w2 / 2, y2 + h2 / 2, 0, x2 + w2 / 2, y2 + h2 / 2, Math.max(w2, h2) * 0.75);
    g2.addColorStop(0, `rgba(30, 22, 14, ${alpha})`);
    g2.addColorStop(1, "rgba(30, 22, 14, 0)");
    ctx.fillStyle = g2;
    ctx.fillRect(x2 - w2 * 0.4, y2 - h2 * 0.4, w2 * 1.8, h2 * 1.8);
  }
  function ribbonStrip(ctx, x0, y0, x1, y1, wTop, wBot, color, s2, notch = true, sway = 0.22) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.max(1e-3, Math.hypot(dx, dy));
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const bow = sway * len * 0.32;
    const STEPS = 14;
    const centre = (t3) => {
      const b2 = 4 * t3 * (1 - t3);
      return {
        x: x0 + dx * t3 + nx * bow * b2,
        y: y0 + dy * t3 + ny * bow * b2
      };
    };
    const halfAt = (t3) => (wTop + (wBot - wTop) * t3) * 0.5;
    const left = [];
    const right = [];
    for (let i2 = 0; i2 <= STEPS; i2++) {
      const t3 = i2 / STEPS;
      const c2 = centre(t3);
      const hw = halfAt(t3);
      left.push({ x: c2.x - nx * hw, y: c2.y - ny * hw });
      right.push({ x: c2.x + nx * hw, y: c2.y + ny * hw });
    }
    const tail = centre(1);
    const notchDepth = notch ? Math.min(wBot * 0.8, len * 0.2) : 0;
    const body = [
      ...left,
      { x: tail.x - ux * notchDepth, y: tail.y - uy * notchDepth },
      ...right.reverse()
    ];
    const g2 = ctx.createLinearGradient(
      x0 - nx * wTop * 0.5,
      y0 - ny * wTop * 0.5,
      x0 + nx * wTop * 0.5,
      y0 + ny * wTop * 0.5
    );
    g2.addColorStop(0, shadeHex(color, -0.38));
    g2.addColorStop(0.3, shadeHex(color, 0.26));
    g2.addColorStop(0.58, color);
    g2.addColorStop(1, shadeHex(color, -0.46));
    const first = body[0];
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (let i2 = 1; i2 < body.length; i2++) ctx.lineTo(body[i2].x, body[i2].y);
    ctx.closePath();
    ctx.fillStyle = g2;
    ctx.fill();
    const rail = (off, style, width) => {
      const pts = [];
      for (let i2 = 0; i2 <= STEPS; i2++) {
        const t3 = i2 / STEPS;
        const c2 = centre(t3);
        const hw = halfAt(t3) * off;
        pts.push({ x: c2.x + nx * hw, y: c2.y + ny * hw });
      }
      strokePath(ctx, pts, style, width);
    };
    rail(0.24, shadeHex(color, 0.55, 0.5), Math.max(0.7, wTop * 0.16));
    rail(-0.96, shadeHex(color, -0.58, 0.55), Math.max(0.5, 0.7 * s2));
    rail(0.96, shadeHex(color, -0.4, 0.4), Math.max(0.4, 0.5 * s2));
  }
  function tasselBody(ctx, cx, cy, size, color, rnd) {
    const knotR = size * 0.26;
    const g2 = ctx.createRadialGradient(cx - knotR * 0.35, cy - knotR * 0.4, knotR * 0.1, cx, cy, knotR);
    g2.addColorStop(0, shadeHex(color, 0.4));
    g2.addColorStop(1, shadeHex(color, -0.3));
    ctx.beginPath();
    ctx.ellipse(cx, cy, knotR, knotR * 1.15, 0, 0, Math.PI * 2);
    ctx.fillStyle = g2;
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
    for (let i2 = 0; i2 < threads; i2++) {
      const t3 = i2 / (threads - 1);
      const spread = (t3 - 0.5) * size * 0.92;
      const len = skirtLen * (0.72 + rnd() * 0.34);
      strokePath(
        ctx,
        [
          { x: cx + spread * 0.28, y: skirtTop },
          { x: cx + spread * 0.8, y: skirtTop + len * 0.55 },
          { x: cx + spread, y: skirtTop + len }
        ],
        i2 % 3 === 0 ? shadeHex(color, -0.34) : i2 % 3 === 1 ? color : shadeHex(color, 0.24),
        Math.max(0.55, size * 0.075)
      );
    }
  }
  function pressedFlower(ctx, cx, cy, r2, stemTo, color, rnd) {
    const petal = mixHex(color, "#f6ecd8", 0.62);
    const petalDeep = mixHex(color, "#f6ecd8", 0.34);
    strokePath(
      ctx,
      [
        { x: cx, y: cy },
        { x: (cx + stemTo.x) / 2 + r2 * 0.25, y: (cy + stemTo.y) / 2 },
        stemTo
      ],
      "rgba(105, 118, 70, 0.85)",
      Math.max(0.6, r2 * 0.14)
    );
    for (const [t3, side] of [
      [0.34, 1],
      [0.62, -1]
    ]) {
      const lx = cx + (stemTo.x - cx) * t3 + r2 * 0.16;
      const ly = cy + (stemTo.y - cy) * t3;
      ctx.beginPath();
      ctx.ellipse(lx + side * r2 * 0.42, ly + r2 * 0.1, r2 * 0.44, r2 * 0.17, side * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(122, 138, 82, 0.72)";
      ctx.fill();
      ctx.strokeStyle = "rgba(80, 92, 50, 0.55)";
      ctx.lineWidth = Math.max(0.4, r2 * 0.05);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.9;
    for (let i2 = 0; i2 < 5; i2++) {
      const a2 = i2 / 5 * Math.PI * 2 + rnd() * 0.22;
      const px = cx + Math.cos(a2) * r2 * 0.52;
      const py = cy + Math.sin(a2) * r2 * 0.52;
      ctx.beginPath();
      ctx.ellipse(px, py, r2 * 0.56, r2 * 0.32, a2, 0, Math.PI * 2);
      ctx.fillStyle = i2 % 2 === 0 ? petal : petalDeep;
      ctx.fill();
      ctx.strokeStyle = mixHex(color, "#4a3a2a", 0.4, 0.45);
      ctx.lineWidth = Math.max(0.35, r2 * 0.045);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r2 * 0.24, 0, Math.PI * 2);
    ctx.fillStyle = "#a8863c";
    ctx.fill();
    for (let i2 = 0; i2 < 6; i2++) {
      const a2 = i2 / 6 * Math.PI * 2;
      strokePath(
        ctx,
        [
          { x: cx, y: cy },
          { x: cx + Math.cos(a2) * r2 * 0.3, y: cy + Math.sin(a2) * r2 * 0.3 }
        ],
        "rgba(120, 92, 40, 0.6)",
        Math.max(0.3, r2 * 0.05)
      );
    }
  }
  function claspBand(ctx, x2, y2, w2, h2, m2, s2, plate) {
    softShadow(ctx, x2, y2 + h2 * 0.5, w2, h2, 0.16);
    const g2 = ctx.createLinearGradient(0, y2, 0, y2 + h2);
    g2.addColorStop(0, m2.lo);
    g2.addColorStop(0.22, m2.hi);
    g2.addColorStop(0.5, m2.mid);
    g2.addColorStop(0.82, shadeHex(m2.mid, -0.28));
    g2.addColorStop(1, m2.lo);
    ctx.fillStyle = g2;
    ctx.fillRect(x2, y2, w2, h2);
    strokePath(
      ctx,
      [
        { x: x2, y: y2 + h2 * 0.5 },
        { x: x2 + w2, y: y2 + h2 * 0.5 }
      ],
      shadeHex(m2.lo, -0.2, 0.5),
      Math.max(0.5, 0.6 * s2)
    );
    const rr = Math.min(h2 * 0.24, w2 * 0.06);
    for (const rx of [x2 + w2 * 0.14, x2 + w2 * 0.86]) {
      ctx.beginPath();
      ctx.arc(rx, y2 + h2 * 0.5, rr, 0, Math.PI * 2);
      ctx.fillStyle = m2.hi;
      ctx.fill();
      ctx.strokeStyle = shadeHex(m2.lo, -0.1, 0.7);
      ctx.lineWidth = Math.max(0.4, 0.5 * s2);
      ctx.stroke();
    }
    ctx.strokeStyle = shadeHex(m2.lo, -0.3, 0.75);
    ctx.lineWidth = Math.max(0.5, 0.7 * s2);
    ctx.strokeRect(x2, y2, w2, h2);
    if (plate) {
      const pw = w2 * 0.3;
      const ph = h2 * 1.75;
      const px = x2 + w2 * 0.5 - pw * 0.5;
      const py = y2 + h2 * 0.5 - ph * 0.5;
      const pg = ctx.createLinearGradient(px, py, px, py + ph);
      pg.addColorStop(0, m2.hi);
      pg.addColorStop(0.45, m2.mid);
      pg.addColorStop(1, m2.lo);
      ctx.beginPath();
      const r2 = Math.min(pw, ph) * 0.28;
      ctx.moveTo(px + r2, py);
      ctx.arcTo(px + pw, py, px + pw, py + ph, r2);
      ctx.arcTo(px + pw, py + ph, px, py + ph, r2);
      ctx.arcTo(px, py + ph, px, py, r2);
      ctx.arcTo(px, py, px + pw, py, r2);
      ctx.closePath();
      ctx.fillStyle = pg;
      ctx.fill();
      ctx.strokeStyle = shadeHex(m2.lo, -0.25, 0.8);
      ctx.lineWidth = Math.max(0.5, 0.7 * s2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(px + pw * 0.5, py + ph * 0.5, pw * 0.16, ph * 0.14, 0, 0, Math.PI * 2);
      ctx.fillStyle = shadeHex(m2.lo, -0.5, 0.85);
      ctx.fill();
    }
  }
  function waxSeal(ctx, cx, cy, r2, color, s2, rnd) {
    softShadow(ctx, cx - r2, cy - r2 * 0.6, r2 * 2, r2 * 1.6, 0.22);
    const wax = mixHex(color, "#8a1c18", 0.42);
    const outer = blobPath(cx, cy, r2, 16, 0.13, rnd);
    fillPath(ctx, outer, shadeHex(wax, -0.18));
    const g2 = ctx.createRadialGradient(cx - r2 * 0.3, cy - r2 * 0.36, r2 * 0.06, cx, cy, r2 * 1.02);
    g2.addColorStop(0, shadeHex(wax, 0.42));
    g2.addColorStop(0.55, wax);
    g2.addColorStop(1, shadeHex(wax, -0.42));
    const inner = blobPath(cx, cy, r2 * 0.9, 14, 0.09, rnd);
    fillPath(ctx, inner, "rgba(0,0,0,0)");
    ctx.beginPath();
    const f2 = inner[0];
    ctx.moveTo(f2.x, f2.y);
    for (let i2 = 1; i2 < inner.length; i2++) ctx.lineTo(inner[i2].x, inner[i2].y);
    ctx.closePath();
    ctx.fillStyle = g2;
    ctx.fill();
    const sig = r2 * 0.56;
    for (const [dx, dy, col, wdt] of [
      [0.7 * s2, 0.7 * s2, shadeHex(wax, 0.45, 0.7), 1],
      [0, 0, shadeHex(wax, -0.62, 0.9), 1.25]
    ]) {
      ctx.save();
      ctx.translate(dx, dy);
      ctx.beginPath();
      ctx.arc(cx, cy, sig * 0.94, 0, Math.PI * 2);
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(0.9, r2 * 0.11 * wdt);
      ctx.stroke();
      for (let i2 = 0; i2 < 6; i2++) {
        const a2 = i2 / 6 * Math.PI + 0.2;
        strokePath(
          ctx,
          [
            { x: cx - Math.cos(a2) * sig * 0.6, y: cy - Math.sin(a2) * sig * 0.6 },
            { x: cx + Math.cos(a2) * sig * 0.6, y: cy + Math.sin(a2) * sig * 0.6 }
          ],
          col,
          Math.max(0.8, r2 * 0.09 * wdt)
        );
      }
      ctx.restore();
    }
    ctx.beginPath();
    ctx.ellipse(cx - r2 * 0.36, cy - r2 * 0.46, r2 * 0.28, r2 * 0.14, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 240, 230, 0.26)";
    ctx.fill();
  }
  function kraftTag(ctx, x2, y2, w2, h2, color, s2, rnd) {
    softShadow(ctx, x2, y2 + h2 * 0.15, w2, h2, 0.18);
    const chamfer = Math.min(w2 * 0.34, h2 * 0.22);
    const body = [
      { x: x2 + w2 * 0.5, y: y2 },
      { x: x2 + w2, y: y2 + chamfer },
      { x: x2 + w2, y: y2 + h2 },
      { x: x2, y: y2 + h2 },
      { x: x2, y: y2 + chamfer }
    ];
    const g2 = ctx.createLinearGradient(x2, y2, x2 + w2, y2 + h2);
    g2.addColorStop(0, shadeHex(KRAFT, 0.14));
    g2.addColorStop(1, shadeHex(KRAFT, -0.12));
    fillPath(ctx, body, "rgba(0,0,0,0)");
    ctx.beginPath();
    const f2 = body[0];
    ctx.moveTo(f2.x, f2.y);
    for (let i2 = 1; i2 < body.length; i2++) ctx.lineTo(body[i2].x, body[i2].y);
    ctx.closePath();
    ctx.fillStyle = g2;
    ctx.fill();
    ctx.strokeStyle = shadeHex(KRAFT_LO, -0.2, 0.7);
    ctx.lineWidth = Math.max(0.5, 0.7 * s2);
    ctx.stroke();
    const holeR = Math.min(w2 * 0.11, h2 * 0.09);
    ctx.beginPath();
    ctx.arc(x2 + w2 * 0.5, y2 + chamfer * 0.85, holeR, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(46, 38, 30, 0.72)";
    ctx.fill();
    strokePath(
      ctx,
      [
        { x: x2 + w2 * 0.5, y: y2 + chamfer * 0.85 },
        { x: x2 + w2 * 0.5 + (rnd() * 2 - 1) * w2 * 0.1, y: y2 - h2 * 0.42 },
        { x: x2 + w2 * 0.34, y: y2 - h2 * 0.86 }
      ],
      mixHex(color, "#d9c9a4", 0.35),
      Math.max(0.6, 0.9 * s2)
    );
    for (let i2 = 0; i2 < 2; i2++) {
      const ly = y2 + h2 * (0.55 + i2 * 0.22);
      strokePath(
        ctx,
        [
          { x: x2 + w2 * 0.18, y: ly },
          { x: x2 + w2 * (0.5 + rnd() * 0.12), y: ly - h2 * 0.03 },
          { x: x2 + w2 * (0.72 + rnd() * 0.1), y: ly }
        ],
        INK,
        Math.max(0.5, 0.7 * s2)
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
  function drawSpineCharm(ctx, kind, w2, h2, opts) {
    if (kind === "none") return;
    const { color, rnd } = opts;
    const s2 = Math.max(0.4, opts.scale);
    const m2 = metal(opts.gilt);
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    switch (kind) {
      case "ribbon": {
        const rw = clamp(w2 * 0.34, 4.2 * s2, 10 * s2);
        const cx = w2 * 0.6;
        ribbonStrip(ctx, cx, h2 * 0.79, cx + rw * 0.42, h2 * 0.995, rw * 0.9, rw * 1.05, color, s2, true, 0.34);
        strokePath(
          ctx,
          [
            { x: cx - rw * 0.62, y: h2 * 0.793 },
            { x: cx + rw * 0.62, y: h2 * 0.793 }
          ],
          "rgba(30, 24, 18, 0.4)",
          Math.max(0.5, 0.7 * s2)
        );
        break;
      }
      case "tassel": {
        const cx = w2 * 0.64;
        strokePath(
          ctx,
          [
            { x: cx - w2 * 0.3, y: h2 * 0.01 },
            { x: cx - w2 * 0.06, y: h2 * 0.05 },
            { x: cx, y: h2 * 0.1 }
          ],
          shadeHex(color, -0.15),
          Math.max(0.9, 1.4 * s2)
        );
        tasselBody(ctx, cx, h2 * 0.145, Math.min(w2 * 0.62, 17 * s2), color, rnd);
        break;
      }
      case "pressed-flower": {
        const cx = w2 * 0.42;
        pressedFlower(
          ctx,
          cx,
          h2 * 0.082,
          Math.min(w2 * 0.42, 12 * s2),
          { x: cx + w2 * 0.26, y: h2 * 0.2 },
          color,
          rnd
        );
        break;
      }
      case "clasp": {
        const bandH = clamp(h2 * 0.062, 6 * s2, 13 * s2);
        claspBand(ctx, -w2 * 0.02, h2 * 0.525 - bandH / 2, w2 * 1.04, bandH, m2, s2, true);
        break;
      }
      case "wax-seal": {
        waxSeal(ctx, w2 * 0.5, h2 * 0.775, Math.min(w2 * 0.44, 16 * s2), color, s2, rnd);
        break;
      }
      default: {
        const tw = clamp(w2 * 0.62, 12 * s2, 22 * s2);
        const th = tw * 1.35;
        kraftTag(ctx, w2 * 0.5 - tw / 2, h2 * 0.115, tw, th, color, s2, rnd);
        strokePath(
          ctx,
          [
            { x: 0, y: h2 * 0.038 },
            { x: w2 * 0.5, y: h2 * 0.052 },
            { x: w2, y: h2 * 0.034 }
          ],
          mixHex(color, "#d9c9a4", 0.35),
          Math.max(0.6, 0.9 * s2)
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
  function clamp012(x2) {
    return x2 < 0 ? 0 : x2 > 1 ? 1 : x2;
  }
  function num(v2, fallback, lo = -1e6, hi = 1e6) {
    if (typeof v2 !== "number" || !Number.isFinite(v2)) return fallback;
    return v2 < lo ? lo : v2 > hi ? hi : v2;
  }
  function smoothstep01(x2) {
    const t3 = clamp012(x2);
    return t3 * t3 * (3 - 2 * t3);
  }
  function normalFromSlope(dhdu, dhdv, scale = 1) {
    const nx = -dhdu * scale;
    const ny = -dhdv * scale;
    const len = Math.hypot(nx, ny, 1);
    return { nx: nx / len, ny: ny / len, h: 0, a: 1 };
  }
  function sampleShape(shape, u2, v2) {
    const uu = clamp012(Number.isFinite(u2) ? u2 : 0);
    const vv = clamp012(Number.isFinite(v2) ? v2 : 0);
    switch (shape?.kind) {
      case "plane": {
        const h2 = num(shape.height, 0, 0, 1);
        const tx = num(shape.tiltX, 0, -1.5, 1.5);
        const ty = num(shape.tiltY, 0, -1.5, 1.5);
        const n2 = normalFromSlope(Math.tan(tx), Math.tan(ty), 1);
        return { nx: n2.nx, ny: n2.ny, h: h2, a: 1 };
      }
      case "roundedBox": {
        const axis = shape.axis === "y" ? "y" : "x";
        const r2 = num(shape.radius, 0.22, 1e-3, 0.5);
        const top = num(shape.height, 0.6, 0, 1);
        const edge = num(shape.edgeHeight, top * 0.55, 0, 1);
        const cross = num(shape.crossRadius, 0.04, 0, 0.5);
        const lean = num(shape.lean, 0, -1.2, 1.2);
        const main = axis === "x" ? uu : vv;
        const off = axis === "x" ? vv : uu;
        const dMain = Math.min(main, 1 - main) / r2;
        const tMain = clamp012(dMain);
        const rollMain = Math.sin(tMain * Math.PI / 2);
        const hMain = edge + (top - edge) * rollMain;
        const slopeMag = tMain >= 1 ? 0 : (top - edge) * (Math.PI / 2) * Math.cos(tMain * Math.PI / 2) / Math.max(1e-3, r2);
        const signMain = main < 0.5 ? 1 : -1;
        let hCross = 1;
        let slopeCross = 0;
        if (cross > 1e-3) {
          const dCross = clamp012(Math.min(off, 1 - off) / cross);
          hCross = 0.72 + 0.28 * Math.sin(dCross * Math.PI / 2);
          slopeCross = dCross >= 1 ? 0 : 0.28 * (Math.PI / 2) * Math.cos(dCross * Math.PI / 2) / Math.max(1e-3, cross);
          slopeCross *= off < 0.5 ? 1 : -1;
        }
        const h2 = clamp012(hMain * hCross);
        const dU = axis === "x" ? slopeMag * signMain : slopeCross * hMain;
        const dV = axis === "x" ? slopeCross * hMain : slopeMag * signMain;
        const n2 = normalFromSlope(dU + Math.tan(lean), dV, 1.35);
        return { nx: n2.nx, ny: n2.ny, h: h2, a: 1 };
      }
      case "bevel": {
        const size = num(shape.size, 0.12, 1e-3, 0.5);
        const top = num(shape.height, 0.5, 0, 1);
        const edge = num(shape.edgeHeight, top * 0.4, 0, 1);
        const round = num(shape.round, 0.45, 0, 1);
        const e2 = shape.edges ?? { left: true, right: true, top: true, bottom: true };
        const dl = e2.left === false ? 1 : uu / size;
        const dr = e2.right === false ? 1 : (1 - uu) / size;
        const dt = e2.top === false ? 1 : vv / size;
        const db = e2.bottom === false ? 1 : (1 - vv) / size;
        const ramp = (d2) => {
          const t3 = clamp012(d2);
          return round <= 0 ? t3 : t3 * (1 - round) + smoothstep01(t3) * round;
        };
        const rl = ramp(dl);
        const rr = ramp(dr);
        const rt = ramp(dt);
        const rb = ramp(db);
        const tMin = Math.min(rl, rr, rt, rb);
        const h2 = clamp012(edge + (top - edge) * tMin);
        const grad = (d2, sign) => {
          const t3 = clamp012(d2);
          if (t3 >= 1) return 0;
          const base = round <= 0 ? 1 : 1 - round + round * 6 * t3 * (1 - t3);
          return sign * (top - edge) * base / Math.max(1e-3, size);
        };
        let dU = 0;
        let dV = 0;
        if (rl === tMin) dU += grad(dl, 1);
        if (rr === tMin) dU += grad(dr, -1);
        if (rt === tMin) dV += grad(dt, 1);
        if (rb === tMin) dV += grad(db, -1);
        const n2 = normalFromSlope(dU, dV, 1.15);
        return { nx: n2.nx, ny: n2.ny, h: h2, a: 1 };
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
        let h2 = edge + (top - edge) * dome;
        const k = -(top - edge) * power * Math.pow(Math.max(1e-4, 1 - r2), 0.5 * power - 1);
        let dU = k * ex * sx * 2;
        let dV = k * ey * 2 / sy;
        if (rib > 1e-3) {
          const t3 = ribAxis === "y" ? cx : cy;
          const crease = Math.exp(-(t3 * t3) / 0.02);
          h2 -= rib * 0.16 * crease * dome;
          const dcrease = -2 * t3 / 0.02 * crease;
          if (ribAxis === "y") dU -= rib * 0.16 * dcrease * dome * 2;
          else dV -= rib * 0.16 * dcrease * dome * 2;
        }
        const n2 = normalFromSlope(dU, dV, 0.85);
        const a2 = smoothstep01((1 - Math.sqrt(r2)) / 0.06);
        return { nx: n2.nx, ny: n2.ny, h: clamp012(h2), a: a2 };
      }
      case "cylinder": {
        const axis = shape.axis === "y" ? "y" : "x";
        const top = num(shape.height, 0.5, 0, 1);
        const edge = num(shape.edgeHeight, 0.1, 0, 1);
        const taper = num(shape.taper, 0, 0, 1);
        const across = axis === "x" ? vv : uu;
        const along = axis === "x" ? uu : vv;
        const width = 1 - taper * along;
        const c2 = (across - 0.5) / Math.max(1e-3, width * 0.5) / 2 + 0.5;
        const t3 = (clamp012(c2) - 0.5) * 2;
        if (Math.abs(t3) >= 1) return { nx: 0, ny: 0, h: edge, a: 0 };
        const prof = Math.sqrt(Math.max(0, 1 - t3 * t3));
        const h2 = clamp012(edge + (top - edge) * prof);
        const slope = -(top - edge) * t3 / Math.max(1e-3, prof) / Math.max(1e-3, width);
        const dU = axis === "x" ? 0 : slope;
        const dV = axis === "x" ? slope : 0;
        const n2 = normalFromSlope(dU, dV, 0.9);
        const a2 = smoothstep01((1 - Math.abs(t3)) / 0.09);
        return { nx: n2.nx, ny: n2.ny, h: h2, a: a2 };
      }
      case "sphere": {
        const top = num(shape.height, 0.6, 0, 1);
        const squash = num(shape.squash, 1, 0.1, 1);
        const cx = uu * 2 - 1;
        const cy = vv * 2 - 1;
        const r2 = cx * cx + cy * cy;
        if (r2 >= 1) return { nx: 0, ny: 0, h: 0, a: 0 };
        const z = Math.sqrt(1 - r2);
        const h2 = clamp012(top * z * squash);
        const len = Math.hypot(cx, cy, z / Math.max(0.1, squash));
        const a2 = smoothstep01((1 - Math.sqrt(r2)) / 0.05);
        return { nx: cx / len, ny: cy / len, h: h2, a: a2 };
      }
      case "wedge": {
        const axis = shape.axis === "y" ? "y" : "x";
        const from = num(shape.from, 0.1, 0, 1);
        const to = num(shape.to, 0.7, 0, 1);
        const round = num(shape.round, 0.2, 0, 1);
        const t3 = axis === "x" ? uu : vv;
        const shaped = t3 * (1 - round) + smoothstep01(t3) * round;
        const h2 = clamp012(from + (to - from) * shaped);
        const d2 = (to - from) * (1 - round + round * 6 * t3 * (1 - t3));
        const n2 = normalFromSlope(axis === "x" ? d2 : 0, axis === "x" ? 0 : d2, 1);
        return { nx: n2.nx, ny: n2.ny, h: h2, a: 1 };
      }
      case "groove": {
        const axis = shape.axis === "y" ? "y" : "x";
        const surface = num(shape.height, 0.5, 0, 1);
        const depth = num(shape.depth, 0.18, 0, 1);
        const width = num(shape.width, 0.35, 0.01, 1);
        const round = num(shape.round, 0.6, 0, 1);
        const t3 = axis === "x" ? uu : vv;
        const d2 = Math.abs(t3 - 0.5) / (width * 0.5);
        const inside = clamp012(1 - d2);
        const dish = round <= 0 ? d2 < 1 ? 1 : 0 : Math.pow(inside, 1 + round);
        const h2 = clamp012(surface - depth * dish);
        const slope = d2 >= 1 ? 0 : depth * (1 + round) * Math.pow(Math.max(1e-4, inside), round) / (width * 0.5);
        const sign = t3 < 0.5 ? -1 : 1;
        const dU = axis === "x" ? slope * sign : 0;
        const dV = axis === "x" ? 0 : slope * sign;
        const n2 = normalFromSlope(dU, dV, 1.5);
        return { nx: n2.nx, ny: n2.ny, h: h2, a: 1 };
      }
      case "ribs": {
        const axis = shape.axis === "y" ? "y" : "x";
        const base = num(shape.height, 0.5, 0, 1);
        const amp = num(shape.amplitude, 0.1, 0, 1);
        const count = Math.max(1, Math.round(num(shape.count, 6, 1, 64)));
        const round = num(shape.round, 0.75, 0, 1);
        const t3 = axis === "x" ? uu : vv;
        const phase = t3 * count * Math.PI * 2;
        const sine = (Math.sin(phase) + 1) * 0.5;
        const square = sine > 0.5 ? 1 : 0;
        const prof = square * (1 - round) + sine * round;
        const h2 = clamp012(base + amp * (prof - 0.5));
        const d2 = amp * round * Math.cos(phase) * count * Math.PI;
        const n2 = normalFromSlope(axis === "x" ? d2 : 0, axis === "x" ? 0 : d2, 1);
        return { nx: n2.nx, ny: n2.ny, h: h2, a: 1 };
      }
      default:
        return { nx: 0, ny: 0, h: 0, a: 1 };
    }
  }
  function encodeSurface(p2) {
    const q2 = (v2) => {
      const x2 = Math.round(clamp012(v2 * 0.5 + 0.5) * 255);
      return x2 < 0 ? 0 : x2 > 255 ? 255 : x2;
    };
    return [q2(p2.nx), q2(p2.ny), Math.round(clamp012(p2.h) * 255), Math.round(clamp012(p2.a) * 255)];
  }
  var PROFILE_MAX = 128;
  function profileSize(shape, w2, h2) {
    const cw = Math.max(1, Math.min(PROFILE_MAX, Math.ceil(w2)));
    const ch = Math.max(1, Math.min(PROFILE_MAX, Math.ceil(h2)));
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
  function shapeKey(shape, w2, h2) {
    const [pw, ph] = profileSize(shape, w2, h2);
    const parts = [shape.kind, String(pw), String(ph)];
    for (const [k, v2] of Object.entries(shape)) {
      if (k === "kind") continue;
      if (typeof v2 === "number") parts.push(`${k}:${v2.toFixed(4)}`);
      else if (typeof v2 === "boolean") parts.push(`${k}:${v2 ? 1 : 0}`);
      else if (v2 !== null && typeof v2 === "object") parts.push(`${k}:${JSON.stringify(v2)}`);
    }
    return parts.join("|");
  }
  function rasterizeShape2(shape, width, height) {
    const [w2, h2] = profileSize(shape, width, height);
    const data = new Uint8ClampedArray(w2 * h2 * 4);
    for (let y2 = 0; y2 < h2; y2++) {
      const v2 = h2 === 1 ? 0.5 : (y2 + 0.5) / h2;
      for (let x2 = 0; x2 < w2; x2++) {
        const u2 = w2 === 1 ? 0.5 : (x2 + 0.5) / w2;
        const p2 = sampleShape(shape, u2, v2);
        const [r2, g2, b2, a2] = encodeSurface(p2);
        const i2 = (y2 * w2 + x2) * 4;
        data[i2] = r2;
        data[i2 + 1] = g2;
        data[i2 + 2] = b2;
        data[i2 + 3] = a2;
      }
    }
    return { data, width: w2, height: h2 };
  }
  var canvasCache = /* @__PURE__ */ new Map();
  function makeCanvas(w2, h2) {
    const cw = Math.max(1, Math.ceil(w2));
    const ch = Math.max(1, Math.ceil(h2));
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(cw, ch);
    if (typeof document === "undefined") return null;
    const c2 = document.createElement("canvas");
    c2.width = cw;
    c2.height = ch;
    return c2;
  }
  function shapeCanvas(shape, w2, h2) {
    const key = shapeKey(shape, w2, h2);
    const hit = canvasCache.get(key);
    if (hit !== void 0) return hit;
    const raster = rasterizeShape2(shape, w2, h2);
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
    const w2 = opts.width;
    const h2 = opts.height;
    if (!(w2 > 0) || !(h2 > 0)) return;
    const canvas2 = shapeCanvas(shape, w2, h2);
    if (canvas2 === null) return;
    const rot = opts.rotation ?? 0;
    const alpha = clamp012(opts.opacity ?? 1);
    if (alpha <= 2e-3) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = "source-over";
    if (rot !== 0) {
      ctx.translate(opts.x + w2 / 2, opts.y + h2 / 2);
      ctx.rotate(rot);
      ctx.translate(-w2 / 2, -h2 / 2);
      ctx.drawImage(canvas2, 0, 0, w2, h2);
    } else {
      ctx.drawImage(canvas2, opts.x, opts.y, w2, h2);
    }
    ctx.restore();
    const scale = opts.heightScale ?? 1;
    const offset = opts.heightOffset ?? 0;
    if (scale === 1 && offset === 0) return;
    ctx.save();
    if (rot !== 0) {
      ctx.translate(opts.x + w2 / 2, opts.y + h2 / 2);
      ctx.rotate(rot);
      ctx.translate(-w2 / 2 - opts.x, -h2 / 2 - opts.y);
    }
    if (scale !== 1) {
      ctx.globalCompositeOperation = "multiply";
      const k = Math.round(clamp012(scale) * 255);
      ctx.fillStyle = `rgb(255, 255, ${k})`;
      ctx.fillRect(opts.x, opts.y, w2, h2);
    }
    if (offset !== 0) {
      ctx.globalCompositeOperation = offset > 0 ? "lighter" : "multiply";
      const k = Math.round(clamp012(Math.abs(offset)) * 255);
      ctx.fillStyle = offset > 0 ? `rgb(0, 0, ${k})` : `rgb(255, 255, ${Math.max(0, 255 - k)})`;
      ctx.fillRect(opts.x, opts.y, w2, h2);
    }
    ctx.restore();
  }
  function emitSpines(ctx, books) {
    for (const b2 of books) {
      const proud = clamp012(b2.proud ?? 0.5);
      emitHeight(
        ctx,
        {
          kind: "roundedBox",
          axis: "x",
          radius: b2.radius ?? 0.24,
          height: 0.42 + proud * 0.5,
          edgeHeight: (0.42 + proud * 0.5) * 0.5,
          crossRadius: 0.035,
          ...b2.lean !== void 0 ? { lean: b2.lean } : {}
        },
        { x: b2.x, y: b2.y, width: b2.width, height: b2.height, ...b2.lean !== void 0 ? { rotation: b2.lean * 0.35 } : {} }
      );
      const bands = b2.bands ?? 0;
      if (bands > 0) {
        emitHeight(
          ctx,
          { kind: "ribs", axis: "y", height: 0.5, amplitude: 0.16, count: bands, round: 0.55 },
          {
            x: b2.x + b2.width * 0.06,
            y: b2.y + b2.height * 0.06,
            width: b2.width * 0.88,
            height: b2.height * 0.88,
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
    for (let i2 = 0; i2 < 3; i2++) {
      const y2 = 0.12 + rnd() * 0.76;
      const kind = Math.floor(rnd() * 3);
      if (i2 < bandCount) bands.push({ y: y2, kind });
    }
    bands.sort((a2, b2) => a2.y - b2.y);
    const ornament = Math.floor(rnd() * 12);
    const texture = Math.floor(rnd() * 3);
    const font = Math.floor(rnd() * 3);
    const gilt = rnd() < 0.3;
    const lean = (rnd() * 2 - 1) * 1.2;
    const w2 = thicknessRoll(rnd);
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
    const pageBlock = clamp(0.07 + rnd() * 0.14 + (w2 < 20 ? 0.07 : 0), 0.06, 0.28);
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
      w: w2,
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
    for (const c2 of THICKNESS_CLASSES) total += c2.weight;
    let acc = roll * total;
    let chosen = THICKNESS_CLASSES[2];
    for (const c2 of THICKNESS_CLASSES) {
      acc -= c2.weight;
      if (acc < 0) {
        chosen = c2;
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
  var GRANULATION_SIZE = 256;
  var granulationTile = null;
  function makeCanvas2(w2, h2) {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w2, h2);
    const c2 = document.createElement("canvas");
    c2.width = w2;
    c2.height = h2;
    return c2;
  }
  function get2d(c2) {
    const ctx = c2.getContext("2d");
    if (!ctx) throw new Error("spines: 2d context unavailable");
    return ctx;
  }
  function getGranulationTile() {
    if (granulationTile) return granulationTile;
    const c2 = makeCanvas2(GRANULATION_SIZE, GRANULATION_SIZE);
    const ctx = get2d(c2);
    const img = ctx.createImageData(GRANULATION_SIZE, GRANULATION_SIZE);
    const rnd = mulberry32(10844759);
    const data = img.data;
    for (let i2 = 0; i2 < data.length; i2 += 4) {
      const v2 = Math.round(128 + (rnd() * 2 - 1) * 56);
      data[i2] = v2;
      data[i2 + 1] = v2;
      data[i2 + 2] = v2;
      data[i2 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    granulationTile = c2;
    return c2;
  }
  function silhouetteOutline(silhouette, w2, h2) {
    const tl = { x: 0, y: 0 };
    const tr = { x: w2, y: 0 };
    const br = { x: w2, y: h2 };
    const bl = { x: 0, y: h2 };
    switch (silhouette) {
      case 1:
        return [{ x: w2 * 0.08, y: 0 }, { x: w2 * 0.92, y: 0 }, br, bl];
      case 2:
        return [tl, tr, { x: w2 * 0.94, y: h2 }, { x: w2 * 0.06, y: h2 }];
      case 3:
        return [
          tl,
          tr,
          { x: w2 * 1.03, y: h2 * 0.5 },
          br,
          bl,
          { x: -w2 * 0.03, y: h2 * 0.5 }
        ];
      case 4:
        return [
          tl,
          { x: w2 * 0.25, y: h2 * 0.012 },
          { x: w2 * 0.5, y: -h2 * 8e-3 },
          { x: w2 * 0.75, y: h2 * 0.012 },
          tr,
          br,
          bl
        ];
      case 5:
        return [
          { x: 0, y: h2 * 0.02 },
          { x: w2 * 0.14, y: 0 },
          { x: w2 * 0.86, y: 0 },
          { x: w2, y: h2 * 0.02 },
          br,
          bl
        ];
      case 6:
        return [
          tl,
          tr,
          { x: w2 * 0.95, y: h2 * 0.5 },
          br,
          bl,
          { x: w2 * 0.05, y: h2 * 0.5 }
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
    for (let i2 = 1; i2 < pts.length; i2++) {
      const p2 = pts[i2];
      ctx.lineTo(p2.x, p2.y);
    }
    if (close) ctx.closePath();
  }
  function strokePts(ctx, pts, close) {
    tracePoly(ctx, pts, close);
    ctx.stroke();
  }
  function drawOrnament(ctx, kind, cx, cy, s2, rnd) {
    const j2 = (v2) => v2 + (rnd() * 2 - 1) * s2 * 0.06;
    const pt = (x2, y2) => ({ x: j2(cx + x2 * s2), y: j2(cy + y2 * s2) });
    switch (kind) {
      case 0: {
        strokePts(ctx, [pt(0, -1), pt(0.62, 0), pt(0, 1), pt(-0.62, 0)], true);
        break;
      }
      case 1: {
        for (const side of [-1, 1]) {
          strokePts(ctx, [pt(side * 0.12, 0.92), pt(side * 0.42, 0.1), pt(side * 0.34, -0.86)], false);
          for (let i2 = 0; i2 < 4; i2++) {
            const t3 = 0.1 + i2 * 0.27;
            const bx = side * (0.12 + (0.42 - 0.12) * Math.min(1, t3 * 1.6));
            const by = 0.92 - t3 * 1.78;
            const ang = side * (0.5 + i2 * 0.12);
            ctx.beginPath();
            ctx.ellipse(
              cx + (bx + side * 0.26) * s2,
              cy + (by - 0.06) * s2,
              s2 * 0.3,
              s2 * 0.12,
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
        for (let i2 = 0; i2 < 10; i2++) {
          const r2 = i2 % 2 === 0 ? 1 : 0.45;
          const a2 = -Math.PI / 2 + i2 * Math.PI / 5;
          star.push(pt(Math.cos(a2) * r2, Math.sin(a2) * r2));
        }
        strokePts(ctx, star, true);
        break;
      }
      case 3: {
        const blob = [];
        for (let i2 = 0; i2 < 8; i2++) {
          const a2 = i2 / 8 * Math.PI * 2;
          const r2 = 0.55 + rnd() * 0.4;
          blob.push({ x: cx + Math.cos(a2) * r2 * s2, y: cy + Math.sin(a2) * r2 * s2 });
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
        for (let i2 = 0; i2 < 20; i2++) {
          const a2 = i2 / 20 * Math.PI * 2;
          circle.push({
            x: cx + Math.cos(a2) * 0.55 * s2,
            y: cy + Math.sin(a2) * 0.55 * s2
          });
        }
        strokePts(ctx, circle, true);
        for (let i2 = 0; i2 < 8; i2++) {
          const a2 = i2 / 8 * Math.PI * 2;
          strokePts(ctx, [pt(Math.cos(a2) * 0.7, Math.sin(a2) * 0.7), pt(Math.cos(a2) * 1.05, Math.sin(a2) * 1.05)], false);
        }
        break;
      }
      case 6: {
        ctx.beginPath();
        ctx.arc(cx, cy, s2 * 0.85, -Math.PI * 0.55, Math.PI * 0.55, false);
        ctx.arc(cx + s2 * 0.42, cy, s2 * 0.62, Math.PI * 0.62, -Math.PI * 0.62, true);
        ctx.closePath();
        const prevAlpha = ctx.globalAlpha;
        ctx.globalAlpha = prevAlpha * 0.8;
        ctx.fill();
        ctx.globalAlpha = prevAlpha;
        break;
      }
      case 7: {
        const circle = [];
        for (let i2 = 0; i2 < 18; i2++) {
          const a2 = i2 / 18 * Math.PI * 2;
          circle.push({
            x: cx + Math.cos(a2) * 0.42 * s2,
            y: cy + (-0.35 + Math.sin(a2) * 0.42) * s2
          });
        }
        strokePts(ctx, circle, true);
        strokePts(ctx, [pt(-0.16, -0.05), pt(-0.3, 0.85), pt(0.3, 0.85), pt(0.16, -0.05)], true);
        break;
      }
      case 8: {
        const leaves = 12;
        for (let i2 = 0; i2 < leaves; i2++) {
          const t3 = i2 / (leaves - 1);
          const a2 = Math.PI / 2 + (t3 < 0.5 ? -1 : 1) * ((t3 < 0.5 ? 1 - t3 * 2 : t3 * 2 - 1) * Math.PI * 0.86);
          const bx = Math.cos(a2) * 0.78;
          const by = Math.sin(a2) * 0.78;
          ctx.beginPath();
          ctx.ellipse(cx + bx * s2, cy + by * s2, s2 * 0.3, s2 * 0.13, a2 + Math.PI / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.lineWidth = Math.max(1, ctx.lineWidth);
        strokePts(ctx, [pt(-0.26, 1.02), pt(0, 0.8), pt(0.26, 1.02)], false);
        break;
      }
      case 9: {
        const shaftPt = (t3) => pt(-0.72 + t3 * 1.44, 0.9 - t3 * 1.6 - Math.sin(t3 * Math.PI) * 0.3);
        const vane = [];
        for (let i2 = 0; i2 <= 8; i2++) vane.push(shaftPt(0.2 + i2 / 8 * 0.8));
        for (let i2 = 8; i2 >= 0; i2--) {
          const t3 = 0.2 + i2 / 8 * 0.8;
          const p2 = shaftPt(t3);
          const bulge = Math.sin((t3 - 0.2) / 0.8 * Math.PI) * 0.42;
          vane.push({ x: p2.x - bulge * s2, y: p2.y + bulge * 0.42 * s2 });
        }
        tracePoly(ctx, vane, true);
        const prevAlpha = ctx.globalAlpha;
        ctx.globalAlpha = prevAlpha * 0.85;
        ctx.fill();
        ctx.globalAlpha = prevAlpha;
        const shaft = [];
        for (let i2 = 0; i2 <= 8; i2++) shaft.push(shaftPt(i2 / 8));
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
        ctx.arc(cx, cy - 0.62 * s2, s2 * 0.08, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      default: {
        ctx.beginPath();
        ctx.arc(cx - s2 * 0.22, cy, s2 * 0.86, -Math.PI * 0.46, Math.PI * 0.46, false);
        ctx.arc(cx + s2 * 0.16, cy, s2 * 0.6, Math.PI * 0.62, -Math.PI * 0.62, true);
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
  function applyOutlineWear(pts, wear, s2, rnd) {
    if (wear <= 0.02 || pts.length < 3) return pts.slice();
    const r2 = (0.8 + wear * 5) * s2;
    const out = [];
    const n2 = pts.length;
    for (let i2 = 0; i2 < n2; i2++) {
      const prev = pts[(i2 - 1 + n2) % n2];
      const cur = pts[i2];
      const next = pts[(i2 + 1) % n2];
      const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y) || 1;
      const outLen = Math.hypot(next.x - cur.x, next.y - cur.y) || 1;
      const ri = Math.min(r2, inLen * 0.45);
      const ro = Math.min(r2, outLen * 0.45);
      const bump = wear * 1.8 * s2 * rnd();
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
    for (const y2 of [...cordYs].sort((a2, b2) => a2 - b2)) {
      if (y2 - cutPad > prev) cuts.push({ y0: prev, y1: y2 - cutPad });
      prev = Math.max(prev, y2 + cutPad);
    }
    if (zoneBot > prev) cuts.push({ y0: prev, y1: zoneBot });
    if (!reserve) return cuts;
    const out = [];
    for (const p2 of cuts) {
      if (reserve.y1 <= p2.y0 || reserve.y0 >= p2.y1) {
        out.push(p2);
        continue;
      }
      if (reserve.y0 > p2.y0) out.push({ y0: p2.y0, y1: reserve.y0 });
      if (reserve.y1 < p2.y1) out.push({ y0: reserve.y1, y1: p2.y1 });
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
    const r2 = mulberry32((seed ^ 31262) >>> 0);
    let acc = r2();
    for (const cls of VALUE_CLASSES) {
      acc -= cls.weight;
      if (acc < 0) return lerp(cls.lum[0], cls.lum[1], r2());
    }
    return 0.22;
  }
  function retone(c2, target) {
    const lum = luminance(c2);
    if (lum <= 2e-3) return target <= 0.02 ? c2 : mixRgb(c2, { r: 1, g: 1, b: 1 }, target);
    if (target < lum) {
      const k2 = 1 - target / lum;
      const shadow = shiftHsl(c2, -6, 0.06, -0.02);
      return mixRgb(c2, mixRgb(shadow, { r: 0.03, g: 0.035, b: 0.055 }, 0.9), k2);
    }
    const k = Math.min(0.92, (target - lum) / Math.max(0.08, 1 - lum));
    return mixRgb(c2, shiftHsl(c2, 4, -0.12, 0.2), k);
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
    return pts.map((p2) => ({ x: p2.x, y: p2.y }));
  }
  function crownAt(spec) {
    return clamp(0.5 + spec.keySide * 0.17 * spec.round, 0.22, 0.78);
  }
  function paintLeatherPainterly(sf, mask, spec, rnd) {
    const { w: w2, h: h2, scale, pig } = spec;
    const s2 = Math.max(0.6, scale);
    const grainSize = clamp(w2 * 0.16, 2.4 * s2, 7 * s2);
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
      weight: (x2) => 0.35 + 0.65 * clamp01Local(spec.keySide > 0 ? x2 / w2 : 1 - x2 / w2),
      seed: (spec.seed ^ 11121) >>> 0,
      targetBuildup: 0.35
    });
    const creases = 2 + Math.floor(rnd() * 3);
    const creaseBrush = brush("soft", {
      size: Math.max(1.6, w2 * 0.2),
      colour: pig.deep,
      opacity: 0.055,
      spacing: 0.14,
      jitter: { lum: 0.05, hue: 5, position: 0.5 }
    });
    for (let i2 = 0; i2 < creases; i2++) {
      const cx = w2 * (0.16 + rnd() * 0.68);
      const y0 = h2 * rnd() * 0.4;
      const y1 = y0 + h2 * (0.28 + rnd() * 0.5);
      const path = [];
      for (let k = 0; k <= 5; k++) {
        const t3 = k / 5;
        path.push({ x: cx + Math.sin(t3 * 3.1 + i2) * w2 * 0.12, y: lerp(y0, y1, t3) });
      }
      stroke(sf, path, creaseBrush, {
        passes: 2,
        pressure: PRESSURE.arc,
        seed: spec.seed + i2 * 977 >>> 0,
        alpha: 0.8
      });
    }
    const cracks = Math.round(spec.wear * 34 + 4);
    const crackBrush = brush("ink", {
      size: Math.max(0.9, 1.1 * s2),
      colour: pig.deep,
      opacity: 0.3,
      spacing: 0.3,
      jitter: { lum: 0.1, opacity: 0.6, position: 0.4 }
    });
    for (let i2 = 0; i2 < cracks; i2++) {
      let px = rnd() * w2;
      let py = rnd() * h2;
      const segs = 2 + Math.floor(rnd() * 3);
      const path = [{ x: px, y: py }];
      let ang = rnd() * Math.PI * 2;
      for (let k = 0; k < segs; k++) {
        ang += (rnd() - 0.5) * 1.9;
        const len = (1.6 + rnd() * 4.5) * s2;
        px += Math.cos(ang) * len;
        py += Math.sin(ang) * len;
        path.push({ x: px, y: py });
      }
      stroke(sf, path, crackBrush, {
        passes: 1,
        pressure: PRESSURE.flick,
        wobble: 0.3 * s2,
        seed: spec.seed + i2 * 313 >>> 0,
        alpha: 0.5 + rnd() * 0.5
      });
    }
    const crown = crownAt(spec);
    glaze(sf, mask, shiftHsl(pig.lift, 4, -0.1, 0.06), 0.16, {
      blend: "softlight",
      gradient: (x2, y2) => {
        const u2 = x2 / w2;
        const band = Math.exp(-Math.pow((u2 - crown) / 0.3, 2));
        const v2 = y2 / h2;
        return band * (0.45 + 0.55 * Math.sin(Math.PI * clamp01Local(v2)));
      },
      mottle: 0.34,
      mottleScale: Math.max(10, w2 * 1.4),
      seed: (spec.seed ^ 20928) >>> 0
    });
  }
  function paintClothPainterly(sf, mask, spec, rnd) {
    const { w: w2, h: h2, scale, pig, boardStyle } = spec;
    const s2 = Math.max(0.6, scale);
    const ribGap = boardStyle === 1 ? 3.4 * s2 : boardStyle === 2 ? 5.2 * s2 : 2.2 * s2;
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
    for (let x2 = -ribGap; x2 < w2 + ribGap; x2 += ribGap) {
      const jx = x2 + (rnd() - 0.5) * ribGap * 0.3;
      const b2 = rnd() < 0.42 ? warpLift : warpBrush;
      stroke(
        sf,
        [
          { x: jx, y: -h2 * 0.02 },
          { x: jx + (rnd() - 0.5) * 1.2 * s2, y: h2 * 0.5 },
          { x: jx + (rnd() - 0.5) * 1.2 * s2, y: h2 * 1.02 }
        ],
        b2,
        { passes: 1, pressure: PRESSURE.flat, taper: 0.02, wobble: 0.35 * s2, seed: spec.seed + x2 * 71 >>> 0 }
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
    for (let y2 = 0; y2 < h2; y2 += ribGap * 1.15) {
      const jy = y2 + (rnd() - 0.5) * ribGap * 0.4;
      stroke(
        sf,
        [
          { x: -w2 * 0.04, y: jy },
          { x: w2 * 1.04, y: jy }
        ],
        weftBrush,
        { passes: 1, pressure: PRESSURE.flat, taper: 0.05, wobble: 0.25 * s2, seed: spec.seed + y2 * 131 >>> 0, alpha: 0.55 + rnd() * 0.45 }
      );
    }
    scumble(sf, mask, brush("chalk", { size: Math.max(1.4, 2.2 * s2), colour: pig.lift, opacity: 0.11, grain: 0.9 }), {
      coverage: 0.12,
      passes: 1,
      patchScale: Math.max(12, w2 * 1.1),
      seed: (spec.seed ^ 16289) >>> 0,
      targetBuildup: 0.4
    });
    glaze(sf, mask, shiftHsl(pig.base, 16, -0.2, 0.1), 0.1, {
      blend: "softlight",
      mottle: 0.4,
      mottleScale: Math.max(14, w2 * 2),
      seed: (spec.seed ^ 8888) >>> 0
    });
  }
  function paintPaperPainterly(sf, mask, spec, rnd) {
    const { w: w2, h: h2, scale, pig } = spec;
    const s2 = Math.max(0.6, scale);
    const fibre = brush("chalk", {
      size: Math.max(1, 1.5 * s2),
      colour: pig.deep,
      opacity: 0.05,
      spacing: 0.45,
      grain: 0.95,
      jitter: { lum: 0.12, opacity: 0.8, position: 0.7 }
    });
    const fibres = Math.round(h2 / (2.4 * s2)) + 6;
    for (let i2 = 0; i2 < fibres; i2++) {
      const x0 = rnd() * w2;
      const y0 = rnd() * h2;
      const len = h2 * (0.06 + rnd() * 0.3);
      stroke(
        sf,
        [
          { x: x0, y: y0 },
          { x: x0 + (rnd() - 0.5) * 2.4 * s2, y: y0 + len }
        ],
        rnd() < 0.4 ? withBrush(fibre, { colour: pig.lift }) : fibre,
        { passes: 1, pressure: PRESSURE.arc, taper: 0.3, seed: spec.seed + i2 * 617 >>> 0 }
      );
    }
    const spots = Math.round(6 + spec.wear * 40);
    const fox = brush("soft", { size: Math.max(1.2, 2.4 * s2), colour: "#8a5a30", opacity: 0.09, jitter: { hue: 14, lum: 0.12, size: 0.7 } });
    for (let i2 = 0; i2 < spots; i2++) {
      dab(sf, rnd() * w2, rnd() * h2, fox, { size: (0.7 + rnd() * 2.6) * s2, opacity: 0.04 + rnd() * 0.11 });
    }
    glaze(sf, mask, "#e8dcc0", 0.09, { blend: "softlight", mottle: 0.5, mottleScale: Math.max(16, w2 * 2.2), seed: (spec.seed ^ 39985) >>> 0 });
  }
  function paintVellumPainterly(sf, mask, spec, rnd) {
    const { w: w2, h: h2, scale, pig } = spec;
    const s2 = Math.max(0.6, scale);
    const cloud = brush("soft", {
      size: Math.max(4, w2 * 0.7),
      colour: shiftHsl(pig.lift, 6, -0.1, 0.14),
      opacity: 0.055,
      spacing: 0.3,
      jitter: { lum: 0.1, hue: 9, size: 0.6 }
    });
    for (let i2 = 0; i2 < 14; i2++) {
      dab(sf, rnd() * w2, rnd() * h2, cloud, { size: w2 * (0.5 + rnd() * 1.1), opacity: 0.03 + rnd() * 0.06 });
    }
    scumble(sf, mask, brush("soft", { size: Math.max(2, w2 * 0.3), colour: shiftHsl(pig.deep, 20, -0.1, 0.08), opacity: 0.05 }), {
      coverage: 0.3,
      passes: 1,
      patchScale: Math.max(18, w2 * 2.4),
      seed: (spec.seed ^ 30658) >>> 0,
      targetBuildup: 0.3
    });
    const dot = brush("ink", { size: Math.max(0.8, 0.9 * s2), colour: shiftHsl(pig.deep, 8, 0, 0.06), opacity: 0.22 });
    const groups = Math.round(10 + h2 / (6 * s2));
    for (let i2 = 0; i2 < groups; i2++) {
      const gx = rnd() * w2;
      const gy = rnd() * h2;
      const a2 = rnd() * Math.PI;
      for (let k = 0; k < 3; k++) {
        dab(sf, gx + Math.cos(a2) * k * 1.7 * s2, gy + Math.sin(a2) * k * 1.7 * s2, dot, { opacity: 0.1 + rnd() * 0.16 });
      }
    }
    glaze(sf, mask, "#f3e8cc", 0.14, { blend: "screen", mottle: 0.45, mottleScale: Math.max(12, w2 * 1.8), seed: (spec.seed ^ 4488) >>> 0 });
  }
  function paintLinenPainterly(sf, mask, spec, rnd) {
    const { w: w2, h: h2, scale, pig } = spec;
    const s2 = Math.max(0.6, scale);
    const gap = 3.1 * s2;
    const hatch = brush("chalk", {
      size: Math.max(1.2, gap * 0.9),
      colour: pig.deep,
      opacity: 0.06,
      spacing: 0.4,
      grain: 1,
      jitter: { lum: 0.13, opacity: 0.8, position: 0.6 }
    });
    for (let x2 = -gap; x2 < w2 + gap; x2 += gap) {
      stroke(sf, [{ x: x2, y: -2 }, { x: x2 + (rnd() - 0.5) * 2 * s2, y: h2 + 2 }], hatch, {
        passes: 1,
        pressure: PRESSURE.flat,
        wobble: 0.7 * s2,
        seed: spec.seed + x2 * 89 >>> 0,
        alpha: 0.6 + rnd() * 0.5
      });
    }
    for (let y2 = -gap; y2 < h2 + gap; y2 += gap * 1.1) {
      stroke(sf, [{ x: -2, y: y2 }, { x: w2 + 2, y: y2 + (rnd() - 0.5) * 1.6 * s2 }], withBrush(hatch, { colour: rnd() < 0.4 ? pig.lift : pig.deep, opacity: 0.05 }), {
        passes: 1,
        pressure: PRESSURE.flat,
        wobble: 0.6 * s2,
        seed: spec.seed + y2 * 151 >>> 0,
        alpha: 0.5 + rnd() * 0.5
      });
    }
    const slub = brush("flat", { size: Math.max(1.6, 3 * s2), colour: pig.lift, opacity: 0.13, grain: 0.9 });
    for (let i2 = 0; i2 < Math.round(w2 * h2 * 4e-3); i2++) {
      const a2 = rnd() * Math.PI;
      const sx = rnd() * w2;
      const sy = rnd() * h2;
      const len = (2 + rnd() * 4) * s2;
      stroke(
        sf,
        [
          { x: sx, y: sy },
          { x: sx + Math.cos(a2) * len, y: sy + Math.sin(a2) * len }
        ],
        rnd() < 0.5 ? slub : withBrush(slub, { colour: pig.deep, opacity: 0.11 }),
        { passes: 1, pressure: PRESSURE.arc, taper: 0.35, seed: spec.seed + i2 * 41 >>> 0 }
      );
    }
    glaze(sf, mask, "#d8c49a", 0.08, { blend: "softlight", mottle: 0.4, seed: (spec.seed ^ 19745) >>> 0 });
  }
  function paintSilkPainterly(sf, mask, spec, rnd) {
    const { w: w2, h: h2, scale, pig } = spec;
    const s2 = Math.max(0.6, scale);
    const bands = 3 + Math.floor(rnd() * 3);
    const sheen = brush("soft", {
      size: Math.max(2, w2 / bands),
      colour: pig.lift,
      opacity: 0.07,
      spacing: 0.16,
      jitter: { lum: 0.07, hue: 5, position: 0.3 }
    });
    for (let i2 = 0; i2 < bands; i2++) {
      const bx = (i2 + 0.5) / bands * w2;
      stroke(sf, [{ x: bx, y: -2 }, { x: bx, y: h2 + 2 }], i2 % 2 === 0 ? sheen : withBrush(sheen, { colour: pig.deep, opacity: 0.06 }), {
        passes: 2,
        pressure: PRESSURE.flat,
        taper: 0.05,
        wobble: 0.8 * s2,
        seed: spec.seed + i2 * 733 >>> 0
      });
    }
    const ripple = brush("soft", { size: Math.max(1.2, 1.8 * s2), colour: pig.lift, opacity: 0.06, spacing: 0.2 });
    for (let y2 = 0; y2 < h2; y2 += 3.6 * s2) {
      const path = [];
      const phase = rnd() * 6.28;
      for (let k = 0; k <= 6; k++) {
        const t3 = k / 6;
        path.push({ x: t3 * w2, y: y2 + Math.sin(phase + t3 * 5.4) * 2.2 * s2 });
      }
      stroke(sf, path, y2 % (7.2 * s2) < 3.6 * s2 ? ripple : withBrush(ripple, { colour: pig.deep }), {
        passes: 1,
        pressure: PRESSURE.arc,
        seed: spec.seed + y2 * 211 >>> 0,
        alpha: 0.6
      });
    }
    glaze(sf, mask, shiftHsl(pig.lift, 0, 0.06, 0.1), 0.12, {
      blend: "screen",
      gradient: (x2) => Math.exp(-Math.pow((x2 / w2 - crownAt(spec)) / 0.22, 2)),
      mottle: 0.25,
      seed: (spec.seed ^ 27196) >>> 0
    });
  }
  function paintMarbledPainterly(sf, mask, spec, rnd, variant) {
    const { w: w2, h: h2, scale, pig } = spec;
    const s2 = Math.max(0.6, scale);
    const inks = [
      shiftHsl(pig.deep, 0, 0.1, 0),
      shiftHsl(pig.base, 24, 0.08, 0.02),
      "#7a2b1e",
      "#1e3a52",
      "#c8a24a"
    ];
    const veinCount = Math.round(h2 / (3.2 * s2));
    const veinBrush = brush("soft", {
      size: Math.max(1.2, 2.4 * s2),
      colour: inks[0],
      opacity: 0.14,
      spacing: 0.18,
      jitter: { lum: 0.1, hue: 10, opacity: 0.5, position: 0.5 }
    });
    const combAmp = variant === 2 ? 0.3 : 1;
    for (let i2 = 0; i2 < veinCount; i2++) {
      const y2 = i2 / veinCount * h2 + (rnd() - 0.5) * 2 * s2;
      const colour = inks[i2 % inks.length];
      const path = [];
      const phase = variant === 0 ? i2 % 2 * 1.6 : rnd() * 6.28;
      const amp = (variant === 1 ? 3.4 : 2.2) * s2 * combAmp;
      for (let k = 0; k <= 8; k++) {
        const t3 = k / 8;
        path.push({ x: -2 + t3 * (w2 + 4), y: y2 + Math.sin(phase + t3 * (variant === 1 ? 9 : 5)) * amp });
      }
      stroke(sf, path, withBrush(veinBrush, { colour }), {
        passes: 1,
        pressure: PRESSURE.flat,
        taper: 0.04,
        wobble: 0.5 * s2,
        seed: spec.seed + i2 * 419 >>> 0,
        alpha: 0.45 + rnd() * 0.45
      });
    }
    if (variant === 2) {
      const drop = brush("soft", { size: Math.max(2, 4 * s2), colour: inks[2], opacity: 0.13, jitter: { hue: 16, lum: 0.14, size: 0.7 } });
      const halo = withBrush(drop, { colour: "#efe4c4", opacity: 0.09 });
      for (let i2 = 0; i2 < Math.round(w2 * h2 * 6e-3); i2++) {
        const dx = rnd() * w2;
        const dy = rnd() * h2;
        const r2 = (1.4 + rnd() * 3.4) * s2;
        dab(sf, dx, dy, halo, { size: r2 * 2.1 });
        dab(sf, dx, dy, withBrush(drop, { colour: inks[1 + Math.floor(rnd() * 4)] }), { size: r2 });
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
  function clamp01Local(v2) {
    return v2 < 0 ? 0 : v2 > 1 ? 1 : v2;
  }
  function blowOutRgb(c2, amount) {
    const k = clamp01Local(amount);
    return mixRgb(c2, { r: 1, g: 0.985, b: 0.94 }, k);
  }
  var stencilCanvas = null;
  function makeStencil(w2, h2, draw) {
    const cw = Math.max(1, Math.ceil(w2));
    const ch = Math.max(1, Math.ceil(h2));
    if (!stencilCanvas || stencilCanvas.width < cw || stencilCanvas.height < ch) {
      stencilCanvas = makeCanvas2(Math.max(cw, 128), Math.max(ch, 128));
    }
    const c2 = stencilCanvas;
    const ctx = get2d(c2);
    ctx.save();
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#fff";
    draw(ctx);
    ctx.restore();
    const img = ctx.getImageData(0, 0, cw, ch);
    const a2 = new Float32Array(cw * ch);
    for (let i2 = 0, o2 = 0; i2 < a2.length; i2++, o2 += 4) a2[i2] = img.data[o2 + 3] / 255;
    return { w: cw, h: ch, a: a2 };
  }
  function stampStencil(sf, st, ox, oy, opts) {
    const rotate = opts.rotate ?? false;
    const wear = clamp(opts.wear ?? 0, 0, 1);
    const wearScale = opts.wearScale ?? 7;
    const alphaMul = opts.alpha ?? 1;
    const seed = (opts.seed ?? 20225) >>> 0;
    const d2 = sf.data;
    const relief = opts.relief ?? null;
    const put = (sx, sy, cov, colour) => {
      const xi = Math.round(sx);
      const yi = Math.round(sy);
      if (xi < 0 || yi < 0 || xi >= sf.width || yi >= sf.height) return;
      const i2 = (yi * sf.width + xi) * 4;
      const a2 = clamp01Local(cov);
      if (a2 <= 4e-3) return;
      const inv = 1 - a2;
      d2[i2] = colour.r * a2 + d2[i2] * inv;
      d2[i2 + 1] = colour.g * a2 + d2[i2 + 1] * inv;
      d2[i2 + 2] = colour.b * a2 + d2[i2 + 2] * inv;
      d2[i2 + 3] = a2 + d2[i2 + 3] * inv;
    };
    for (let sy = 0; sy < st.h; sy++) {
      for (let sx = 0; sx < st.w; sx++) {
        const cov = st.a[sy * st.w + sx];
        if (cov <= 0.01) continue;
        const t3 = st.w > 1 ? sx / (st.w - 1) : 0;
        const u2 = st.h > 1 ? sy / (st.h - 1) : 0.5;
        const tx = rotate ? ox - (sy - st.h / 2) : ox + sx;
        const ty = rotate ? oy + sx : oy + sy;
        let a2 = cov * alphaMul;
        if (wear > 0) {
          const n2 = fbm(tx / wearScale, ty / wearScale, seed, 3);
          const eaten = clamp01Local((n2 - (0.34 + wear * 0.42)) / 0.22);
          a2 *= 0.18 + 0.82 * eaten;
          if (wear > 0.6) a2 *= 1 - (wear - 0.6) * 1.1;
        }
        if (a2 <= 6e-3) continue;
        if (relief) {
          put(tx + relief.dx, ty + relief.dy, cov * relief.alpha * alphaMul, relief.colour);
        }
        put(tx, ty, a2, opts.colour(t3, u2));
      }
    }
  }
  function foilColour(u2, warm, hot, dark) {
    if (u2 < 0.26) return mixRgb(dark, warm, u2 / 0.26);
    if (u2 < 0.5) return mixRgb(warm, hot, (u2 - 0.26) / 0.24);
    if (u2 < 0.74) return mixRgb(hot, warm, (u2 - 0.5) / 0.24);
    return mixRgb(warm, dark, (u2 - 0.74) / 0.26);
  }
  var FOIL_WARM = parseColour("#c9a227");
  var FOIL_HOT = parseColour("#fff3c6");
  var FOIL_DARK = parseColour("#6d4f0e");
  var FOIL_SILVER = parseColour("#cdd3d8");
  function paintRule(sf, x0, x1, y2, thickness, colour, spec, opts = {}) {
    const gold = opts.gold ?? false;
    const wear = clamp(opts.wear ?? spec.foilWear * 0.7, 0, 1);
    const seed = (opts.seed ?? spec.seed) >>> 0;
    const rnd = mulberry32(seed);
    const th = Math.max(0.7, thickness);
    stroke(
      sf,
      [
        { x: x0, y: y2 + th * 0.85 },
        { x: x1, y: y2 + th * 0.85 }
      ],
      brush("soft", { size: th * 1.5, colour: spec.pig.deep, opacity: 0.16, spacing: 0.2, jitter: { lum: 0.05, position: 0.2 } }),
      { passes: 1, pressure: PRESSURE.flat, taper: 0.04, seed: seed ^ 17, alpha: 0.8 }
    );
    const steps = Math.max(2, Math.round((x1 - x0) / Math.max(1.2, th * 1.6)));
    for (let i2 = 0; i2 < steps; i2++) {
      const t0 = i2 / steps;
      const t1 = (i2 + 1) / steps;
      if (rnd() < wear * 0.55) continue;
      const c2 = gold ? foilColour(0.2 + rnd() * 0.6, FOIL_WARM, FOIL_HOT, FOIL_DARK) : colour;
      stroke(
        sf,
        [
          { x: lerp(x0, x1, t0), y: y2 + (rnd() - 0.5) * th * 0.4 },
          { x: lerp(x0, x1, t1), y: y2 + (rnd() - 0.5) * th * 0.4 }
        ],
        brush("blade", {
          size: th,
          colour: c2,
          opacity: (opts.alpha ?? 0.75) * (0.7 + rnd() * 0.5),
          spacing: 0.12,
          hardness: 0.9,
          jitter: { lum: gold ? 0.14 : 0.06, hue: gold ? 8 : 3, opacity: 0.4, position: 0.25 }
        }),
        { passes: 1, pressure: PRESSURE.flat, taper: 0.02, wobble: th * 0.25, seed: seed + i2 * 37 >>> 0 }
      );
    }
  }
  function paintCord(sf, cy, cordH, spec, seed) {
    const { w: w2, pig } = spec;
    const top = cy - cordH / 2;
    const rnd = mulberry32(seed >>> 0);
    stroke(
      sf,
      [
        { x: -w2 * 0.05, y: top + cordH * 1.05 },
        { x: w2 * 1.05, y: top + cordH * 1.05 }
      ],
      brush("soft", { size: cordH * 1.1, colour: pig.deep, opacity: 0.17, spacing: 0.18, jitter: { lum: 0.05, position: 0.4 } }),
      { passes: 2, pressure: PRESSURE.flat, taper: 0.03, seed: seed ^ 113 }
    );
    const rows = Math.max(3, Math.round(cordH));
    for (let i2 = 0; i2 < rows; i2++) {
      const v2 = (i2 + 0.5) / rows;
      const y2 = top + v2 * cordH;
      const n2 = Math.cos((v2 - 0.42) * Math.PI);
      const lit = clamp01Local(n2 * 0.5 + 0.5);
      const colour = lit > 0.62 ? mixRgb(pig.base, pig.lift, (lit - 0.62) / 0.38) : mixRgb(pig.deep, pig.base, lit / 0.62);
      stroke(
        sf,
        [
          { x: -w2 * 0.04, y: y2 },
          { x: w2 * 1.04, y: y2 }
        ],
        brush("flat", {
          size: Math.max(1, cordH / rows + 0.6),
          colour,
          opacity: 0.42,
          spacing: 0.14,
          jitter: { lum: 0.05, hue: 4, opacity: 0.3, position: 0.25 }
        }),
        { passes: 1, pressure: PRESSURE.flat, taper: 0.02, wobble: 0.4, seed: seed + i2 * 53 >>> 0 }
      );
    }
    if (spec.lightOn) {
      stroke(
        sf,
        [
          { x: w2 * 0.04, y: top + cordH * 0.3 },
          { x: w2 * 0.96, y: top + cordH * 0.3 }
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
  function paintPageBlockPainterly(sf, x2, y2, bw, bh, edge, spec, rnd) {
    if (bw <= 0.6 || bh <= 1) return;
    const s2 = Math.max(0.6, spec.scale);
    const shape = roughenShape(rectShape(x2, y2, bw, bh), 0.4 * s2, (spec.seed ^ 8772) >>> 0, 3.4);
    const paper = edge === "gilt" ? "#9c7c2e" : "#bcab86";
    const mask = blockIn(sf, shape, paper, {
      brush: brush("flat", { size: Math.max(1.4, bw * 0.7), colour: paper, opacity: 0.3, grain: 0.5 }),
      passes: 2,
      valueSpread: 0.1,
      hueSpread: 8,
      roughness: 0.35 * s2,
      rowFactor: 0.4,
      direction: Math.PI / 2,
      openness: 0.04,
      feather: 0.9,
      seed: (spec.seed ^ 21777) >>> 0
    });
    const leafBrush = brush("blade", {
      size: Math.max(0.7, 0.9 * s2),
      colour: "#e8dcbc",
      opacity: 0.3,
      spacing: 0.16,
      hardness: 0.85,
      jitter: { lum: 0.12, hue: 8, opacity: 0.6, position: 0.25 }
    });
    const count = Math.max(3, Math.round(bw / (0.9 * s2)));
    for (let i2 = 0; i2 < count; i2++) {
      const lx = x2 + (i2 + 0.5) / count * bw + (rnd() - 0.5) * 0.5 * s2;
      const dark = rnd() < 0.34;
      stroke(
        sf,
        [
          { x: lx, y: y2 + bh * 0.01 },
          { x: lx + (rnd() - 0.5) * 0.8 * s2, y: y2 + bh * 0.99 }
        ],
        withBrush(leafBrush, {
          colour: dark ? "#7e7052" : rnd() < 0.28 ? "#e2d6b6" : "#c6b590",
          opacity: dark ? 0.24 : 0.24
        }),
        { passes: 1, pressure: PRESSURE.flat, taper: 0.03, wobble: 0.3 * s2, seed: spec.seed + i2 * 97 >>> 0, alpha: 0.6 + rnd() * 0.5 }
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
      const speck = brush("ink", { size: Math.max(0.7, 0.8 * s2), colour: "#7d3c22", opacity: 0.4, jitter: { hue: 20, lum: 0.2, size: 0.8 } });
      for (let i2 = 0; i2 < Math.round(bw * bh * 0.09); i2++) {
        dab(sf, x2 + rnd() * bw, y2 + rnd() * bh, speck, { size: (0.5 + rnd() * 1.3) * s2, opacity: 0.2 + rnd() * 0.4 });
      }
    } else if (edge === "marbled") {
      const vein = brush("soft", { size: Math.max(0.9, 1.4 * s2), colour: "#8a4a2c", opacity: 0.2, jitter: { hue: 24, lum: 0.16 } });
      for (let i2 = 0; i2 < Math.round(bh / (4 * s2)); i2++) {
        const vy = rnd() * bh;
        stroke(
          sf,
          [
            { x: x2 - 0.5, y: y2 + vy },
            { x: x2 + bw * 0.5, y: y2 + vy + (rnd() - 0.5) * 3 * s2 },
            { x: x2 + bw + 0.5, y: y2 + vy + (rnd() - 0.5) * 3 * s2 }
          ],
          withBrush(vein, { colour: i2 % 2 === 0 ? "#8a4a2c" : "#2f4a5e" }),
          { passes: 1, pressure: PRESSURE.arc, seed: spec.seed + i2 * 173 >>> 0, alpha: 0.5 }
        );
      }
    }
    const outerLeft = spec.keySide > 0;
    glaze(sf, mask, spec.lightOn ? mixRgb(FOIL_HOT, parseColour(spec.rig.keyColour), 0.5) : FOIL_HOT, spec.lightOn ? 0.13 * spec.keyTake : 0.05, {
      blend: "screen",
      gradient: (px) => {
        const u2 = (px - x2) / bw;
        return clamp01Local(outerLeft ? u2 : 1 - u2) ** 2.2;
      },
      mottle: 0.35,
      seed: (spec.seed ^ 2721) >>> 0
    });
    glaze(sf, mask, spec.pig.deep, 0.4, {
      blend: "multiply",
      gradient: (px) => {
        const u2 = (px - x2) / bw;
        return clamp01Local(outerLeft ? 1 - u2 * 2.2 : (u2 - 0.55) / 0.45) ** 1.2;
      },
      mottle: 0.3,
      seed: (spec.seed ^ 2722) >>> 0
    });
    stroke(
      sf,
      [
        { x: outerLeft ? x2 : x2 + bw, y: y2 },
        { x: outerLeft ? x2 : x2 + bw, y: y2 + bh }
      ],
      brush("soft", { size: Math.max(1, bw * 0.5), colour: spec.pig.deep, opacity: 0.2, spacing: 0.2 }),
      { passes: 1, pressure: PRESSURE.flat, taper: 0.03, seed: (spec.seed ^ 2994) >>> 0 }
    );
  }
  function paintWearPainterly(sf, mask, spec, rnd) {
    const { w: w2, h: h2, scale, pig, wear } = spec;
    if (wear <= 0.02) return;
    const s2 = Math.max(0.6, scale);
    const boardTone = mixRgb(pig.base, parseColour("#a08a68"), 0.5 + wear * 0.28);
    const rub = brush("chalk", {
      size: Math.max(1.6, w2 * 0.22),
      colour: boardTone,
      opacity: 0.1,
      spacing: 0.4,
      grain: 0.95,
      jitter: { lum: 0.12, hue: 8, opacity: 0.7, size: 0.6 }
    });
    const rubs = Math.round(wear * 16);
    for (let i2 = 0; i2 < rubs; i2++) {
      const edgePick = rnd();
      const rx = edgePick < 0.5 ? rnd() < 0.5 ? w2 * (0.02 + rnd() * 0.12) : w2 * (0.86 + rnd() * 0.12) : rnd() * w2;
      const ry = edgePick < 0.5 ? rnd() * h2 : rnd() < 0.5 ? h2 * rnd() * 0.1 : h2 * (0.9 + rnd() * 0.1);
      dab(sf, rx, ry, rub, { size: (1.6 + rnd() * 4) * s2, opacity: 0.05 + rnd() * 0.14 * wear });
    }
    glaze(sf, mask, "#3b3125", 0.16 * (0.4 + wear), {
      blend: "multiply",
      gradient: (_x, y2) => clamp01Local((y2 / h2 - 0.78) / 0.22) ** 1.4,
      mottle: 0.5,
      mottleScale: Math.max(8, w2),
      seed: (spec.seed ^ 26129) >>> 0
    });
    if (spec.sunFade > 0.05) {
      glaze(sf, mask, "#efe4c6", spec.sunFade * 0.24, {
        blend: "screen",
        gradient: (x2) => {
          const u2 = spec.keySide > 0 ? x2 / w2 : 1 - x2 / w2;
          return clamp01Local(u2) ** 1.5;
        },
        mottle: 0.45,
        mottleScale: Math.max(10, w2 * 1.5),
        seed: (spec.seed ^ 30498) >>> 0
      });
    }
    if (spec.knock > 0.08) {
      const bump = brush("chalk", { size: Math.max(1.4, 2.6 * s2), colour: boardTone, opacity: 0.16, grain: 1, jitter: { lum: 0.14, size: 0.7 } });
      for (const [cx, cy] of [
        [0, 0],
        [w2, 0],
        [0, h2],
        [w2, h2]
      ]) {
        const n2 = Math.round(spec.knock * 5);
        for (let i2 = 0; i2 < n2; i2++) {
          const r2 = (0.6 + rnd() * 2.4) * s2;
          dab(sf, cx + (rnd() - 0.5) * 4 * s2, cy + (rnd() - 0.5) * 4 * s2, bump, { size: r2 * 2, opacity: 0.08 + rnd() * 0.16 });
        }
      }
    }
  }
  function renderSpine(ctx, params, x2, y2, hPx, scale, title, opts = {}) {
    const w2 = params.w * scale;
    const h2 = hPx;
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
      w: w2,
      h: h2,
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
    const sf = createSurface(Math.max(2, Math.ceil(w2)), Math.max(2, Math.ceil(h2)));
    const s2 = Math.max(0.6, scale);
    const inset = Math.min(w2 * 0.06, Math.max(0.8, 1.1 * s2));
    const outline = applyOutlineWear(
      silhouetteOutline(params.silhouette, w2 - inset * 2, h2 - inset * 2),
      clamp(wear + knock * 0.45, 0, 1),
      scale,
      rnd
    );
    const shape = roughenShape(
      densifyShape(
        toVec(outline).map((p2) => ({ x: p2.x + inset, y: p2.y + inset })),
        Math.max(2, 5 * s2)
      ),
      0.55 * s2,
      (params.seed ^ 13073) >>> 0,
      2.4
    );
    const crown = crownAt(spec);
    const mask = blockIn(sf, shape, pig.base, {
      brush: brush("chalk", {
        size: Math.max(2.2, w2 * 0.42),
        colour: pig.base,
        opacity: 0.2,
        spacing: 0.2,
        grain: 0.7,
        jitter: { lum: 0.07, hue: 8, opacity: 0.45, position: 0.5, size: 0.3, angle: 0.4, sat: 0.06 }
      }),
      passes: 3,
      valueSpread: 0.1,
      hueSpread: 12,
      roughness: 0.5 * s2,
      overshoot: 1.8 * s2,
      direction: Math.PI / 2,
      openness: 0.05,
      rowFactor: 0.42,
      feather: 1.1,
      edgeNoise: 0.4 * s2,
      seed: (params.seed ^ 33196) >>> 0
    });
    scumble(
      sf,
      mask,
      brush("chalk", { size: Math.max(2, w2 * 0.38), colour: pig.deep, opacity: 0.09, grain: 0.8, spacing: 0.3 }),
      {
        coverage: 0.55,
        passes: 2,
        // Both vertical joints are where the covering turns onto the boards:
        // the darkest lines on any book, and the reason a row reads as objects.
        weight: (px) => {
          const u2 = px / w2;
          return clamp01Local(Math.max(1 - u2 / 0.3, (u2 - 0.7) / 0.3)) ** 1.3;
        },
        patchScale: Math.max(6, w2 * 0.9),
        seed: (params.seed ^ 7181) >>> 0,
        targetBuildup: 0.55
      }
    );
    scumble(
      sf,
      mask,
      brush("chalk", { size: Math.max(2, w2 * 0.3), colour: pig.lift, opacity: 0.07, grain: 0.75, spacing: 0.32 }),
      {
        coverage: 0.4,
        passes: 1,
        weight: (px, py) => {
          const band = Math.exp(-Math.pow((px / w2 - crown) / 0.26, 2));
          return band * (0.4 + 0.6 * Math.sin(Math.PI * clamp01Local(py / h2)));
        },
        patchScale: Math.max(8, h2 * 0.12),
        seed: (params.seed ^ 11550) >>> 0,
        targetBuildup: 0.45
      }
    );
    paintMaterialPainterly(sf, mask, spec, rnd);
    if (params.twoTone) {
      const splitY = params.twoToneSplit * h2;
      const panelShape = roughenShape(rectShape(-1, -1, w2 + 2, splitY + 1), 0.5 * s2, (params.seed ^ 1185) >>> 0, 3);
      const panelMask = blockIn(sf, panelShape, pig.partner, {
        brush: brush("chalk", { size: Math.max(2, w2 * 0.4), colour: pig.partner, opacity: 0.18, grain: 0.7 }),
        passes: 2,
        valueSpread: 0.08,
        hueSpread: 9,
        roughness: 0.4 * s2,
        direction: Math.PI / 2,
        openness: 0.08,
        rowFactor: 0.45,
        feather: 1,
        seed: (params.seed ^ 1185) >>> 0
      });
      clipToMask(sf, mask, { feather: 1.1 });
      void panelMask;
      if (params.gilt) {
        paintRule(sf, w2 * 0.05, w2 * 0.95, splitY, Math.max(0.9, 1.4 * s2), FOIL_WARM, spec, { gold: true, seed: (params.seed ^ 81) >>> 0 });
      } else {
        paintRule(sf, w2 * 0.05, w2 * 0.95, splitY, Math.max(0.8, s2), pig.deep, spec, { seed: (params.seed ^ 82) >>> 0, wear: 0.2 });
      }
    }
    if (round > 0.03) {
      glaze(sf, mask, pig.deep, 0.55 * round, {
        blend: "multiply",
        gradient: (px) => {
          const u2 = px / w2;
          const d0 = Math.abs(u2 - crown) / Math.max(crown, 1 - crown);
          return clamp01Local(d0 ** 1.7);
        },
        mottle: 0.22,
        mottleScale: Math.max(9, h2 * 0.2),
        seed: (params.seed ^ 27665) >>> 0
      });
      glaze(sf, mask, lightOn ? mixRgb(pig.lift, parseColour(rig.keyColour), 0.28) : pig.lift, 0.24 * round * (lightOn ? keyTake : 0.7), {
        blend: "screen",
        gradient: (px, py) => {
          const band = Math.exp(-Math.pow((px / w2 - crown) / 0.2, 2));
          return band * (0.35 + 0.65 * Math.sin(Math.PI * clamp01Local(py / h2)) ** 0.7);
        },
        mottle: 0.25,
        mottleScale: Math.max(10, h2 * 0.22),
        seed: (params.seed ^ 27666) >>> 0
      });
    }
    const blockFrac = clamp(params.pageBlock ?? 0.1, 0.05, 0.24);
    const edgeW = opts.pageBlock === false ? 0 : clamp(w2 * blockFrac, 2 * s2, 9 * s2);
    if (edgeW > 0.8) {
      const blockX = keySide > 0 ? w2 - edgeW - inset * 0.5 : inset * 0.5;
      paintPageBlockPainterly(sf, blockX, h2 * 0.014, edgeW, h2 * 0.972, edge, spec, rnd);
    }
    const legacyBands = raisedBands > 0 ? [] : params.bands;
    for (const band of legacyBands) {
      const by = band.y * h2;
      if (band.kind === 0) {
        for (const dy of [-1.9 * s2, 1.9 * s2]) {
          paintRule(sf, w2 * 0.05, w2 * 0.95, by + dy, Math.max(0.7, 0.9 * s2), pig.deep, spec, {
            seed: params.seed + by * 13 + dy >>> 0,
            wear: 0.25,
            alpha: 0.6
          });
        }
      } else if (band.kind === 1) {
        paintCord(sf, by, clamp(w2 * 0.2, 3.4 * s2, 8 * s2), spec, params.seed + by * 29 >>> 0);
      } else {
        paintRule(sf, w2 * 0.05, w2 * 0.95, by, Math.max(1, 1.6 * s2), FOIL_WARM, spec, {
          gold: true,
          seed: params.seed + by * 37 >>> 0
        });
      }
    }
    const cordYs = [];
    if (raisedBands > 0) {
      const zTop = 0.085;
      const zBot = 0.915;
      for (let i2 = 0; i2 < raisedBands; i2++) {
        cordYs.push(zTop + (i2 + 1) / (raisedBands + 1) * (zBot - zTop));
      }
    }
    const cordH = clamp(w2 * 0.24, 4.2 * s2, 11 * s2);
    for (const cy of cordYs) {
      paintCord(sf, cy * h2, cordH, spec, params.seed + cy * 9973 >>> 0);
      if (bandGilt) {
        for (const gy of [cy * h2 - cordH * 0.85, cy * h2 + cordH * 0.85]) {
          paintRule(sf, w2 * 0.08, w2 * 0.92, gy, Math.max(0.9, 1.2 * s2), FOIL_WARM, spec, {
            gold: true,
            seed: params.seed + gy * 61 >>> 0
          });
        }
      }
    }
    if (params.headTail) {
      const bandH = 3 * s2;
      const stripeW = Math.max(1.4 * s2, 1.8);
      const capCol = params.gilt ? FOIL_WARM : shiftHsl(pig.partner, 0, -0.06, 0.04);
      const creamCol = parseColour("#ddd0ab");
      for (const cy0 of [0.7 * s2, h2 - bandH - 0.7 * s2]) {
        stroke(
          sf,
          [
            { x: w2 * 0.05, y: cy0 + bandH * 0.5 },
            { x: w2 * 0.95, y: cy0 + bandH * 0.5 }
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
        for (let sx = w2 * 0.05; sx < w2 * 0.95; sx += stripeW * 2) {
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
        paintRule(sf, w2 * 0.05, w2 * 0.95, cy0 < h2 / 2 ? cy0 + bandH : cy0, Math.max(0.6, 0.7 * s2), pig.deep, spec, {
          seed: params.seed + cy0 * 71 >>> 0,
          wear: 0.3,
          alpha: 0.5
        });
      }
    }
    const reserve = charmSpineReserve(charm);
    const cutYs = raisedBands > 0 ? cordYs : legacyBands.map((b2) => b2.y);
    const cutPad = h2 > 0 ? (raisedBands > 0 ? cordH * 0.95 : 4.6 * scale) / h2 : 0;
    const panels = spinePanels(cutYs, reserve, cutPad).filter((p2) => p2.y1 - p2.y0 > 0.045);
    let titlePanel = null;
    let ornamentPanel = null;
    if (panels.length > 0) {
      const upper = panels.filter((p2) => (p2.y0 + p2.y1) / 2 < 0.68);
      const pool = upper.length > 0 ? upper : panels;
      const tallest = pool.reduce((a2, b2) => b2.y1 - b2.y0 > a2.y1 - a2.y0 ? b2 : a2);
      const second = panels.length > 1 ? panels[1] : null;
      titlePanel = second !== null && second.y1 - second.y0 >= (tallest.y1 - tallest.y0) * 0.8 ? second : tallest;
      const below = panels.filter((p2) => p2 !== titlePanel && p2.y0 >= titlePanel.y1 - 1e-6);
      const rest = below.length > 0 ? below : panels.filter((p2) => p2 !== titlePanel);
      if (rest.length > 0) {
        ornamentPanel = rest.reduce((a2, b2) => b2.y1 - b2.y0 > a2.y1 - a2.y0 ? b2 : a2);
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
      const py0 = titlePanel.y0 * h2;
      const py1 = titlePanel.y1 * h2;
      const pad = 4 * scale;
      const availLen = Math.max(0, py1 - py0 - pad * 2);
      const family = FONTS[params.font];
      const mctx = get2d(makeCanvas2(8, 8));
      const maxFont = clamp(w2 * 0.52, 10 * scale, 20 * scale);
      const minFont = Math.max(6.5 * scale, maxFont * 0.52);
      const fitLen = Math.max(0, availLen - pad * 0.9);
      let fontPx = maxFont;
      let text = title.trim();
      const measure = (t3) => {
        mctx.font = `${fontPx.toFixed(2)}px ${family}`;
        let sum = 0;
        for (const ch of t3) sum += mctx.measureText(ch).width;
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
      const plateW = Math.min(w2 * 0.8, fontPx * 1.95);
      const plateX = w2 * 0.5 - plateW / 2;
      const plateY = (py0 + py1) / 2 - plateLen / 2;
      if (titlePlate !== "none" && plateLen > 6 * scale) {
        if (titlePlate === "label") {
          const labelShape = roughenShape(
            densifyShape(rectShape(plateX, plateY, plateW, plateLen), 5 * s2),
            0.7 * s2,
            (params.seed ^ 2465) >>> 0,
            3.2
          );
          stroke(
            sf,
            [
              { x: plateX + plateW * 0.5, y: plateY + plateLen + 1.2 * s2 },
              { x: plateX + plateW * 0.5, y: plateY - 1 * s2 }
            ],
            brush("soft", { size: plateW * 1.15, colour: pig.deep, opacity: 0.12, spacing: 0.2 }),
            { passes: 1, pressure: PRESSURE.flat, taper: 0.05, seed: (params.seed ^ 2466) >>> 0 }
          );
          const labelMask = blockIn(sf, labelShape, "#e3d5b2", {
            brush: brush("chalk", { size: Math.max(2, plateW * 0.6), colour: "#e3d5b2", opacity: 0.24, grain: 0.7 }),
            passes: 3,
            valueSpread: 0.07,
            hueSpread: 7,
            roughness: 0.4 * s2,
            direction: Math.PI / 2,
            openness: 0.03,
            rowFactor: 0.4,
            feather: 0.9,
            seed: (params.seed ^ 2467) >>> 0
          });
          glaze(sf, labelMask, "#8b7444", 0.16, {
            blend: "multiply",
            gradient: (px, py) => {
              const u2 = clamp01Local((px - plateX) / plateW);
              const v2 = clamp01Local((py - plateY) / plateLen);
              return Math.max(Math.abs(u2 - 0.5) * 1.5, Math.abs(v2 - 0.5) * 1.5) ** 2;
            },
            mottle: 0.4,
            seed: (params.seed ^ 2468) >>> 0
          });
          paintRule(sf, plateX + 1.8 * s2, plateX + plateW - 1.8 * s2, plateY + 1.8 * s2, Math.max(0.6, 0.7 * s2), parseColour("#7a6238"), spec, { wear: 0.35, alpha: 0.5, seed: (params.seed ^ 2469) >>> 0 });
          paintRule(sf, plateX + 1.8 * s2, plateX + plateW - 1.8 * s2, plateY + plateLen - 1.8 * s2, Math.max(0.6, 0.7 * s2), parseColour("#7a6238"), spec, { wear: 0.35, alpha: 0.5, seed: (params.seed ^ 2470) >>> 0 });
        } else {
          const gold = titlePlate === "gilt";
          const ruleCol = gold ? FOIL_WARM : pig.deep;
          for (const ry of [plateY, plateY + plateLen]) {
            paintRule(sf, plateX, plateX + plateW, ry, Math.max(0.8, 1.2 * s2), ruleCol, spec, {
              gold,
              seed: params.seed + ry * 41 >>> 0
            });
          }
          const vBrush = brush("blade", {
            size: Math.max(0.8, 1.1 * s2),
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
              { passes: 1, pressure: PRESSURE.flat, taper: 0.03, wobble: 0.35 * s2, seed: params.seed + rx * 53 >>> 0, alpha: 1 - foilWear * 0.5 }
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
        const st = makeStencil(Math.ceil(textLen + fontPx * 0.6), stH, (c2) => {
          c2.font = `${fontPx.toFixed(2)}px ${family}`;
          c2.textAlign = "left";
          c2.textBaseline = "middle";
          let advance = fontPx * 0.3;
          for (const g2 of glyphs) {
            const wob = (trnd() * 1.2 - 0.6) * scale;
            c2.fillText(g2.ch, advance, stH / 2 + wob);
            advance += g2.adv;
          }
        });
        const inkDark = mixRgb(pig.deep, parseColour("#141019"), 0.45);
        const inkPale = mixRgb(pig.lift, parseColour("#f4ecd8"), 0.6);
        const colourAt = goldTitle ? (t3, u2) => {
          const foil = foilColour(u2, FOIL_WARM, FOIL_HOT, FOIL_DARK);
          const catchAt = clamp(0.24 + rowPhase * 0.5, 0, 1);
          const g2 = Math.exp(-Math.pow((t3 - catchAt) / 0.16, 2)) * (lightOn ? keyTake : 0.4);
          return mixRgb(foil, FOIL_HOT, clamp01Local(g2 * 0.7));
        } : silverTitle ? (_t, u2) => foilColour(u2, FOIL_SILVER, parseColour("#ffffff"), parseColour("#5d6670")) : onLabel ? () => inkDark : () => groundLum < 0.34 ? inkPale : inkDark;
        stampStencil(sf, st, w2 / 2, runY0 - fontPx * 0.3, {
          rotate: true,
          colour: colourAt,
          wear: onLabel ? foilWear * 0.35 : foilWear,
          wearScale: Math.max(3.5, fontPx * 0.55),
          alpha: 0.95,
          seed: (params.seed ^ 20830) >>> 0,
          relief: onLabel ? null : {
            colour: goldTitle || silverTitle ? mixRgb(pig.deep, parseColour("#000000"), 0.35) : pig.deep,
            dx: -0.8 * s2 * keySide,
            dy: 0.85 * s2,
            alpha: 0.4
          }
        });
      }
    }
    if (ornamentOn && !charmTakesOrnamentSlot(charm)) {
      const oPanel = ornamentPanel ?? { y0: 0.7, y1: 0.9 };
      const ocy = (oPanel.y0 + oPanel.y1) / 2 * h2;
      const oSize = Math.min(w2 * 0.36, 14 * scale, (oPanel.y1 - oPanel.y0) * h2 / 2.1);
      if (oSize > 1.6) {
        const box = Math.ceil(oSize * 2.6);
        const ornRnd = mulberry32((params.seed ^ 3095) >>> 0);
        const st = makeStencil(box, box, (c2) => {
          c2.lineWidth = Math.max(1, 1.1 * scale);
          c2.lineJoin = "round";
          c2.lineCap = "round";
          drawOrnament(c2, params.ornament, box / 2, box / 2, Math.max(2, oSize), ornRnd);
        });
        const gold = params.gilt;
        stampStencil(sf, st, w2 / 2 - box / 2, ocy - box / 2, {
          colour: gold ? (_t, u2) => foilColour(u2, FOIL_WARM, FOIL_HOT, FOIL_DARK) : () => mixRgb(pig.deep, parseColour("#0e0b12"), 0.3),
          wear: foilWear * 0.8,
          wearScale: Math.max(3, oSize * 0.5),
          alpha: gold ? 0.9 : 0.7,
          seed: (params.seed ^ 3096) >>> 0,
          relief: {
            colour: mixRgb(pig.deep, parseColour("#000000"), 0.3),
            dx: -0.7 * s2 * keySide,
            dy: 0.7 * s2,
            alpha: 0.35
          }
        });
      }
    }
    paintWearPainterly(sf, mask, spec, rnd);
    if (lightOn) {
      glaze(sf, mask, mixRgb(pig.deep, parseColour(rig.ambientColour), 0.18), 0.42 * (0.7 + depth * 0.5), {
        blend: "multiply",
        gradient: (_x, py) => clamp01Local((py / h2 - 0.86) / 0.14) ** 1.5,
        mottle: 0.2,
        seed: (params.seed ^ 14849) >>> 0
      });
      glaze(sf, mask, mixRgb(pig.deep, parseColour(rig.ambientColour), 0.24), 0.26 * (0.6 + depth * 0.6), {
        blend: "multiply",
        gradient: (_x, py) => clamp01Local((0.12 - py / h2) / 0.12) ** 1.6,
        mottle: 0.2,
        seed: (params.seed ^ 14850) >>> 0
      });
      glaze(sf, mask, mixRgb(pig.deep, parseColour("#0c0a12"), 0.4), 0.34, {
        blend: "multiply",
        gradient: (px) => {
          const u2 = keySide > 0 ? 1 - px / w2 : px / w2;
          return clamp01Local((0.2 - u2) / 0.2) ** 1.5;
        },
        mottle: 0.25,
        mottleScale: Math.max(8, h2 * 0.15),
        seed: (params.seed ^ 14851) >>> 0
      });
      glaze(sf, mask, parseColour(rig.keyColour), clamp(0.34 * keyTake * rig.keyIntensity, 0, 0.6), {
        blend: "screen",
        gradient: (px, py) => {
          const u2 = keySide > 0 ? px / w2 : 1 - px / w2;
          const across = 0.3 + 0.7 * clamp01Local(u2) ** 1.1;
          const down = 0.42 + 0.58 * clamp01Local(1 - py / h2) ** 0.7;
          return across * down;
        },
        mottle: 0.3,
        mottleScale: Math.max(12, h2 * 0.25),
        seed: (params.seed ^ 14852) >>> 0
      });
      glaze(sf, mask, blowOutRgb(parseColour(rig.rimColour), 0.45), clamp(0.3 * keyTake, 0, 0.5), {
        blend: "screen",
        gradient: (px, py) => {
          const u2 = keySide > 0 ? px / w2 : 1 - px / w2;
          const lip = Math.exp(-Math.pow((u2 - 0.9) / 0.09, 2));
          return lip * (0.35 + 0.65 * Math.sin(Math.PI * clamp01Local(py / h2)) ** 0.6);
        },
        mottle: 0.4,
        mottleScale: Math.max(8, h2 * 0.14),
        seed: (params.seed ^ 14856) >>> 0
      });
      if (opts.neighbourLeft) {
        glaze(sf, mask, opts.neighbourLeft, 0.11, {
          blend: "softlight",
          gradient: (px) => clamp01Local((0.32 - px / w2) / 0.32) ** 1.3,
          mottle: 0.3,
          seed: (params.seed ^ 14853) >>> 0
        });
      }
      if (opts.neighbourRight) {
        glaze(sf, mask, opts.neighbourRight, 0.11, {
          blend: "softlight",
          gradient: (px) => clamp01Local((px / w2 - 0.68) / 0.32) ** 1.3,
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
      band: Math.max(1.2, 1.6 * s2),
      accent: mixRgb(pig.deep, parseColour("#0b0910"), 0.4),
      accentStrength: 0.4,
      lightAngle: rig.keyAngle,
      softness: Math.max(1.2, 2 * s2),
      seed: (params.seed ^ 7486) >>> 0
    });
    addGrain(sf, 0.045, 1.5, (params.seed ^ 32273) >>> 0, mask);
    ctx.save();
    ctx.translate(x2, y2);
    drawSurface(ctx, sf, 0, 0);
    if (charm !== "none") {
      drawSpineCharm(ctx, charm, w2, h2, {
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
          x: x2,
          y: y2,
          width: w2,
          height: h2,
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
      ([c2, wgt]) => c2 === previous ? [c2, wgt * 0.12] : [c2, wgt]
    );
    let total = 0;
    for (const [, wgt] of filtered) total += wgt;
    if (total <= 0) return "mixed";
    let acc = rnd() * total;
    for (const [c2, wgt] of filtered) {
      acc -= wgt;
      if (acc < 0) return c2;
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
    const pool = books.map((b2, index) => {
      const params = b2.params ?? deriveSpineParams(b2.seed);
      return { input: b2, index, params, height: spineHeightPx(params) };
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
      const scored = unassigned.map((c2) => ({ c: c2, s: suitability(c2.params, character) + rnd() * 18 })).sort((a2, b2) => b2.s - a2.s);
      const taken = scored.slice(0, want).map((entry) => entry.c);
      for (const t3 of taken) {
        const at = unassigned.indexOf(t3);
        if (at >= 0) unassigned.splice(at, 1);
      }
      runs.push(character);
      runMembers.push(taken);
    }
    if (runs.length === 0) {
      runs.push("mixed");
      runMembers.push(pool.slice());
    }
    for (let i2 = 0; i2 < runMembers.length; i2++) {
      const a2 = runMembers[i2];
      if (a2.length < 3 || runs[i2] === "gap" || runs[i2] === "flat-stack") continue;
      for (let j2 = i2 + 1; j2 < runMembers.length; j2++) {
        const b2 = runMembers[j2];
        if (b2.length < 3 || runs[j2] === "gap" || runs[j2] === "flat-stack") continue;
        if (rnd() < 0.6) {
          const ai = Math.floor(rnd() * a2.length);
          const bi = Math.floor(rnd() * b2.length);
          const tmp = a2[ai];
          a2[ai] = b2[bi];
          b2[bi] = tmp;
        }
        break;
      }
    }
    for (const members of runMembers) {
      for (let i2 = members.length - 1; i2 > 0; i2--) {
        const j2 = Math.floor(rnd() * (i2 + 1));
        const tmp = members[i2];
        members[i2] = members[j2];
        members[j2] = tmp;
      }
    }
    const flatList = runMembers.flat();
    if (flatList.length >= 2) {
      let maxH = -Infinity;
      let minH = Infinity;
      for (const c2 of flatList) {
        maxH = Math.max(maxH, c2.height);
        minH = Math.min(minH, c2.height);
      }
      const variation = maxH > 0 ? (maxH - minH) / maxH : 0;
      if (variation < skylineTarget) {
        const mean = flatList.reduce((s2, c2) => s2 + c2.height, 0) / flatList.length;
        const need = (skylineTarget - variation) * maxH;
        const span = Math.max(1, maxH - minH);
        for (const c2 of flatList) {
          const away = c2.height - mean;
          const push = Math.sign(away) * need * (0.35 + Math.abs(away) / span * 0.5);
          c2.height = clamp(c2.height + push, SPINE_HEIGHT_RANGE.min, SPINE_HEIGHT_RANGE.max);
        }
      }
      for (let i2 = 2; i2 < flatList.length; i2++) {
        const a2 = flatList[i2 - 2];
        const b2 = flatList[i2 - 1];
        const c2 = flatList[i2];
        const near = (p2, q2) => Math.abs(p2 - q2) / Math.max(1, p2) < 0.03;
        if (near(a2.height, b2.height) && near(b2.height, c2.height)) {
          const dir = rnd() < 0.5 ? -1 : 1;
          b2.height = clamp(
            b2.height + dir * b2.height * (0.06 + rnd() * 0.08),
            SPINE_HEIGHT_RANGE.min,
            SPINE_HEIGHT_RANGE.max
          );
        }
      }
    }
    const placements = [];
    const gaps = [];
    let cursor = 0;
    for (let r2 = 0; r2 < runs.length; r2++) {
      const character = runs[r2];
      const members = runMembers[r2];
      if (character === "gap") {
        const g2 = 14 + rnd() * 34;
        gaps.push({ x: cursor, width: g2, leanedInto: false });
        cursor += g2;
        continue;
      }
      if (character === "flat-stack" && members.length >= 2) {
        const sorted = [...members].sort((a2, b2) => b2.height - a2.height);
        const footprint = Math.max(...sorted.map((c2) => c2.height)) * 0.94;
        let stackY = 0;
        for (let i2 = 0; i2 < sorted.length; i2++) {
          const c2 = sorted[i2];
          const jitterX = (rnd() * 2 - 1) * Math.min(10, footprint * 0.05);
          placements.push({
            id: c2.input.id,
            index: c2.index,
            params: c2.params,
            title: c2.input.title,
            x: cursor + jitterX + (footprint - c2.height * 0.94) / 2,
            width: c2.height * 0.94,
            height: c2.params.w,
            leanDeg: (rnd() * 2 - 1) * 1.6,
            depth: 0.1 + rnd() * 0.3,
            phase: 0,
            pose: "flat",
            run: r2,
            runCharacter: character,
            stackY,
            gapAfter: 0
          });
          stackY += c2.params.w;
        }
        cursor += footprint + 2 + rnd() * 8;
        continue;
      }
      const leanLast = allowLean && (character === "leaning-cluster" || character !== "heavy" && rnd() < 0.16) && members.length >= 2;
      const runDepth = (rnd() * 2 - 1) * 0.42;
      for (let i2 = 0; i2 < members.length; i2++) {
        const c2 = members[i2];
        const isLast = i2 === members.length - 1;
        const doLean = leanLast && isLast;
        const leanDeg = doLean ? (rnd() < 0.5 ? -1 : 1) * (6 + rnd() * 9) : c2.params.lean + (rnd() * 2 - 1) * 0.9;
        const rad = Math.abs(leanDeg) * (Math.PI / 180);
        const footprint = c2.params.w * Math.cos(rad) + c2.height * Math.sin(rad);
        const proud = (c2.params.proud ?? 0) / 10;
        const depth = clamp(runDepth * 0.7 + proud * 0.8 + (rnd() * 2 - 1) * 0.18, -1, 1);
        const pose = doLean ? "leaning" : rnd() < 0.07 ? "angled" : "upright";
        placements.push({
          id: c2.input.id,
          index: c2.index,
          params: c2.params,
          title: c2.input.title,
          x: cursor,
          width: footprint,
          height: c2.height,
          leanDeg,
          depth,
          phase: 0,
          pose,
          run: r2,
          runCharacter: character,
          stackY: 0,
          gapAfter: 0
        });
        const kerf = isLast ? 0 : minKerf + rnd() * (character === "thin-run" ? 0.8 : 2.2);
        cursor += footprint + kerf;
      }
      if (leanLast) {
        const last = placements[placements.length - 1];
        const g2 = Math.max(10, last.height * Math.sin(Math.abs(last.leanDeg) * (Math.PI / 180)) * 0.9);
        gaps.push({ x: cursor, width: g2, leanedInto: true });
        cursor += g2;
      } else if (r2 < runs.length - 1 && runs[r2 + 1] !== "gap") {
        const g2 = 3 + rnd() * 9;
        gaps.push({ x: cursor, width: g2, leanedInto: false });
        cursor += g2;
      }
    }
    {
      const byRun = /* @__PURE__ */ new Map();
      for (const p2 of placements) {
        const key = p2.pose === "flat" ? p2.run : p2.index + 1e6;
        const list = byRun.get(key);
        if (list) list.push(p2);
        else byRun.set(key, [p2]);
      }
      const groups = [];
      for (const members of byRun.values()) {
        let x0 = Infinity;
        let x1 = -Infinity;
        for (const m2 of members) {
          x0 = Math.min(x0, m2.x);
          x1 = Math.max(x1, m2.x + m2.width);
        }
        groups.push({ members, x0, x1, after: 0, flat: members[0]?.pose === "flat", leanedInto: false });
      }
      groups.sort((a2, b2) => a2.x0 - b2.x0);
      const leanGap = /* @__PURE__ */ new Set();
      for (let i2 = 0; i2 < groups.length; i2++) {
        const g2 = groups[i2];
        const next = groups[i2 + 1];
        g2.after = next ? Math.max(0, next.x0 - g2.x1) : 0;
        const tipped = g2.members.some((m2) => Math.abs(m2.leanDeg) > 4);
        if (tipped) leanGap.add(i2);
        g2.leanedInto = tipped;
      }
      const holeCap = Math.min(52, Math.max(20, width * 0.04));
      let spacing = groups.map((g2, i2) => {
        if (i2 === groups.length - 1) return 0;
        const tight = minKerf + (g2.after > 0 ? Math.min(g2.after, 3.2) : 0);
        return leanGap.has(i2) ? Math.min(Math.max(g2.after, 10), holeCap) : tight;
      });
      const bookSpan = () => groups.reduce((s2, g2) => s2 + (g2.x1 - g2.x0), 0);
      const spanTotal = () => bookSpan() + spacing.reduce((s2, v2) => s2 + v2, 0);
      let slack = width - spanTotal();
      if (slack > 2) {
        const total2 = bookSpan();
        if (total2 > 1) {
          const k = Math.min(1.38, 1 + slack / total2);
          if (k > 1.001) {
            for (const g2 of groups) {
              const gx0 = g2.x0;
              for (const m2 of g2.members) {
                const rel = m2.x - gx0;
                if (m2.pose === "flat") {
                  m2.x = gx0 + rel * k;
                } else {
                  m2.x = gx0 + rel * k;
                  m2.width *= k;
                  m2.params = {
                    ...m2.params,
                    w: clamp(m2.params.w * k, SPINE_THICKNESS_RANGE.min, SPINE_THICKNESS_RANGE.max * 1.25)
                  };
                }
              }
              g2.x1 = gx0 + (g2.x1 - gx0) * k;
            }
            slack = width - spanTotal();
          }
        }
      }
      if (slack > 1 && groups.length > 1) {
        const holes = spacing.length - 1;
        const room = spacing.map((v2, i2) => i2 < holes ? Math.max(0, holeCap - v2) : 0);
        const roomTotal = room.reduce((s2, v2) => s2 + v2, 0);
        if (roomTotal > 0.5) {
          const take = Math.min(slack, roomTotal);
          spacing = spacing.map((v2, i2) => v2 + room[i2] * (take / roomTotal));
          slack = width - spanTotal();
        }
      }
      if (slack < 0) {
        const spaceTotal = spacing.reduce((s2, v2) => s2 + v2, 0);
        const cut = Math.min(spaceTotal * 0.85, -slack);
        if (spaceTotal > 0.5) {
          const k = 1 - cut / spaceTotal;
          spacing = spacing.map((v2) => v2 * k);
          slack = width - spanTotal();
        }
        if (slack < -1) {
          const total2 = bookSpan();
          const k = Math.max(0.55, (total2 + slack) / Math.max(1, total2));
          for (const g2 of groups) {
            const gx0 = g2.x0;
            for (const m2 of g2.members) {
              const rel = m2.x - gx0;
              m2.x = gx0 + rel * k;
              if (m2.pose !== "flat") {
                m2.width *= k;
                m2.params = {
                  ...m2.params,
                  w: clamp(m2.params.w * k, SPINE_THICKNESS_RANGE.min, SPINE_THICKNESS_RANGE.max * 1.25)
                };
              }
            }
            g2.x1 = gx0 + (g2.x1 - gx0) * k;
          }
          slack = width - spanTotal();
        }
      }
      gaps.length = 0;
      let cur = 0;
      for (let i2 = 0; i2 < groups.length; i2++) {
        const g2 = groups[i2];
        const shift = cur - g2.x0;
        for (const m2 of g2.members) m2.x += shift;
        g2.x1 += shift;
        cur = g2.x1;
        const gapW = spacing[i2];
        if (gapW > 4) gaps.push({ x: cur, width: gapW, leanedInto: g2.leanedInto });
        cur += gapW;
        for (const m2 of g2.members) m2.gapAfter = gapW;
      }
      if (width - cur > 6) gaps.push({ x: cur, width: width - cur, leanedInto: false });
    }
    let maxHeight = 0;
    let minHeight = Infinity;
    let maxW = 0;
    let minW = Infinity;
    const total = Math.max(
      1,
      placements.reduce((s2, p2) => Math.max(s2, p2.x + p2.width), 0)
    );
    for (const p2 of placements) {
      p2.phase = clamp((p2.x + p2.width / 2) / total, 0, 1);
      const drawn = p2.pose === "flat" ? p2.stackY + p2.height : p2.height;
      maxHeight = Math.max(maxHeight, drawn);
      minHeight = Math.min(minHeight, drawn);
      maxW = Math.max(maxW, p2.params.w);
      minW = Math.min(minW, p2.params.w);
    }
    for (const p2 of placements) {
      const right = p2.x + p2.width;
      let best = 0;
      for (const g2 of gaps) {
        if (g2.x >= right - 0.5 && g2.x - right < 3) best = Math.max(best, g2.width);
      }
      p2.gapAfter = best;
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
    for (let i2 = 0; i2 < count; i2++) {
      const seed = seedBase * 7919 + i2 * 2654435761 >>> 0;
      out.push({ id: `b${i2}`, seed, title: TITLES[i2 % TITLES.length] });
    }
    return out;
  }
  function drawRow(ctx, w2, h2, opts = {}) {
    const rig = opts.rig ? getLightRig(opts.rig) : DEFAULT_LIGHT_RIG;
    const books = rowInputs(opts.count ?? 26, opts.seed ?? 1);
    const comp = composeShelfRow(books, { width: w2 - 40, seed: opts.seed ?? 1 });
    const baseline = h2 - 60;
    ctx.fillStyle = "#1a130d";
    ctx.fillRect(0, 0, w2, h2);
    for (const p2 of comp.placements) {
      ctx.save();
      if (p2.pose === "flat") {
        ctx.translate(20 + p2.x, baseline - p2.stackY);
        ctx.rotate(-Math.PI / 2);
        renderSpine(ctx, p2.params, 0, 0, p2.width, 1, p2.title, {
          hiRes: true,
          rig,
          rowPhase: p2.phase,
          depth: (p2.depth + 1) / 2
        });
      } else {
        const hp = p2.height;
        ctx.translate(20 + p2.x, baseline - hp);
        if (p2.leanDeg !== 0) {
          ctx.translate(0, hp);
          ctx.rotate(p2.leanDeg * Math.PI / 180);
          ctx.translate(0, -hp);
        }
        renderSpine(ctx, p2.params, 0, 0, hp, 1, p2.title, {
          hiRes: true,
          rig,
          rowPhase: p2.phase,
          depth: (p2.depth + 1) / 2
        });
      }
      ctx.restore();
    }
    ctx.fillStyle = "#3a2a1a";
    ctx.fillRect(0, baseline, w2, 40);
  }
  var BASELINE_SCENES = [
    {
      name: "baseline-row",
      width: 1200,
      height: 420,
      draw: (ctx, w2, h2) => drawRow(ctx, w2, h2, { seed: 3 })
    },
    {
      name: "baseline-zoom",
      width: 1200,
      height: 420,
      draw: (ctx, w2, h2) => {
        const off = document.createElement("canvas");
        off.width = 1200;
        off.height = 420;
        drawRow(off.getContext("2d"), 1200, 420, { seed: 3 });
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(off, 0, 60, 400, 300, 0, 0, w2, h2);
      }
    }
  ];

  // prototypes/books/scenes/materials.ts
  var MATERIAL_SCENES = [];

  // src/art/themes.ts
  var THEME_IDS = [
    "blossom",
    "robot",
    "dino",
    "candy",
    "reef",
    "voyager",
    "athenaeum",
    "conservatory",
    "observatory",
    "cottage",
    "scriptorium",
    "sakura",
    "attic",
    "apothecary"
  ];
  var DEFAULT_THEME_ID = "blossom";
  function isThemeId(value) {
    return typeof value === "string" && THEME_IDS.includes(value);
  }
  var BLOSSOM = {
    id: "blossom",
    name: "Blossom Grove",
    blurb: "A living tree: birch, bright leaf vines and cherry blossom over the crown.",
    wood: {
      light: "#fdf3e2",
      dark: "#b98a55",
      grain: "birch",
      ringFreq: 2.2,
      ringGamma: 1.2,
      along: 6e-3,
      across: 0.045,
      knots: 0.6,
      streaks: 5,
      contrast: 0.74,
      finish: "wax",
      sheen: 0.4
    },
    joinery: {
      kind: "vine-tie",
      metal: "#57c25c",
      metalDark: "#2f7d3c",
      highlight: "rgba(226, 255, 214, 0.75)",
      size: 4,
      density: 0.6
    },
    crown: {
      profile: "arch",
      carving: "blossom",
      height: 50,
      overhang: 14,
      bead: { colour: "rgba(95, 191, 98, 0.75)", width: 1.6 },
      centrepiece: "blossom"
    },
    rail: {
      inlay: "vine",
      inlayColour: "#5fbf62",
      edge: "rounded",
      width: 34,
      ink: "rgba(92, 74, 52, 0.5)"
    },
    plate: {
      kind: "painted-sign",
      body: "#4fb95a",
      bodyDark: "#2c7c39",
      ink: "rgba(255, 252, 236, 0.96)",
      fixing: "screws",
      w: 112,
      h: 32,
      font: '"Caveat Variable", Caveat, cursive',
      fontSize: 22,
      burn: 0,
      radius: 9
    },
    wallpaper: { pattern: "blossom-sky", colourway: "blossom", tile: 256 },
    backdrops: ["papered", "glazed", "panelled"],
    light: {
      pools: [
        { x: 0.24, y: 0.06, radius: 0.72, colour: "#fff4c2", intensity: 0.56, drift: 12 },
        { x: 0.82, y: 0.46, radius: 0.44, colour: "#ffd9e6", intensity: 0.34, drift: 8 },
        { x: 0.5, y: 1.02, radius: 0.5, colour: "#c8f5b0", intensity: 0.24, drift: 5 }
      ],
      ambient: { colour: "#ffeec0", amount: 0.08 },
      rim: { colour: "#fffbe6", width: 2.4, intensity: 0.38 },
      vignette: { amount: 0.16, colour: "#2f7a5e" },
      driftSeconds: 38,
      flicker: 0,
      shafts: false
    },
    flora: {
      species: ["blossom-branch", "ivy-trail", "moss-tuft", "potted-plant", "grass-tuft"],
      density: "lush",
      anchors: ["crown-top", "rail-top", "case-corner", "joint-gap", "shelf-underside", "pot"]
    },
    props: [
      { kind: "blossom-sprig", anchor: "shelf", weight: 4, fallback: 0 },
      { kind: "birdhouse", anchor: "shelf", weight: 2, fallback: 3 },
      { kind: "terracotta-pot", anchor: "shelf", weight: 3, fallback: 0 },
      { kind: "jam-jar", anchor: "shelf", weight: 2, fallback: 1 }
    ],
    spineDefaults: {
      materials: ["cloth", "paper", "linen"],
      pigments: ["#e75480", "#4fb95a", "#f7b32b", "#4aa3e0", "#b06fd6", "#ff8f6b"],
      gilt: 0.2,
      bands: 0.3,
      wear: 0.16
    },
    motes: { kind: "petals", density: 22, colour: "#ffb3cf", drift: 7 },
    // The grove is open to the sky: you see it straight through the case.
    backing: "wallpaper"
  };
  var ROBOT = {
    id: "robot",
    name: "Robot Workshop",
    blurb: "Cherry-red enamel over navy steel, cyan LEDs and an amber bench lamp.",
    wood: {
      light: "#c7d8e8",
      dark: "#2c3a48",
      grain: "brushed",
      ringFreq: 1.8,
      ringGamma: 1,
      along: 4e-3,
      across: 0.09,
      knots: 0,
      streaks: 14,
      contrast: 0.8,
      finish: "metal",
      sheen: 0.85,
      paint: { colour: "#d81f36", shade: "#8e1122", chipping: 0.14, opacity: 0.94 }
    },
    joinery: {
      kind: "hex-bolt",
      metal: "#e2ecf6",
      metalDark: "#66788a",
      highlight: "rgba(255, 255, 255, 0.9)",
      size: 4.2,
      density: 0.9
    },
    crown: {
      profile: "gantry",
      carving: "circuit",
      height: 48,
      overhang: 8,
      bead: { colour: "rgba(60, 232, 255, 0.85)", width: 1.6 },
      centrepiece: "gear"
    },
    rail: {
      inlay: "led-strip",
      inlayColour: "#3ce8ff",
      edge: "sharp",
      width: 36,
      ink: "rgba(26, 36, 48, 0.7)"
    },
    plate: {
      kind: "led-panel",
      body: "#101d28",
      bodyDark: "#060d14",
      ink: "rgba(96, 245, 255, 0.98)",
      fixing: "screws",
      w: 112,
      h: 30,
      font: '"Nunito Sans", sans-serif',
      fontSize: 16,
      burn: 0,
      radius: 4
    },
    wallpaper: { pattern: "circuit-trace", colourway: "chrome", tile: 256 },
    backdrops: ["papered", "panelled", "boarded"],
    light: {
      pools: [
        { x: 0.13, y: 0.16, radius: 0.48, colour: "#38ecff", intensity: 0.56, drift: 5 },
        { x: 0.87, y: 0.64, radius: 0.42, colour: "#ff45c8", intensity: 0.48, drift: 5 },
        { x: 0.52, y: 0, radius: 0.52, colour: "#ffcf6a", intensity: 0.4, drift: 8 }
      ],
      ambient: { colour: "#5fcfff", amount: 0.17 },
      rim: { colour: "#8ff6ff", width: 2.8, intensity: 0.64 },
      vignette: { amount: 0.46, colour: "#0a141f" },
      driftSeconds: 26,
      flicker: 0.14,
      shafts: false
    },
    flora: { species: [], density: "none", anchors: [] },
    props: [
      { kind: "robot-arm", anchor: "shelf", weight: 4, fallback: 3 },
      { kind: "gear-stack", anchor: "shelf", weight: 3, fallback: 4 },
      { kind: "oil-can", anchor: "shelf", weight: 2, fallback: 1 },
      { kind: "glow-bottle", anchor: "shelf", weight: 2, fallback: 2 }
    ],
    spineDefaults: {
      materials: ["cloth", "leather", "linen"],
      pigments: ["#e8342f", "#12c8e8", "#ffc21c", "#f04ecb", "#2f6fe0", "#3ad17a"],
      gilt: 0.18,
      bands: 0.35,
      wear: 0.3
    },
    motes: { kind: "sparks", density: 20, colour: "#ffb347", drift: 9 },
    shelfDetail: "drawers"
  };
  var DINO = {
    id: "dino",
    name: "Dino Dig",
    blurb: "Amber timber against jungle green, fossil bones and volcano sunset light.",
    wood: {
      light: "#d69340",
      dark: "#46260a",
      grain: "knotty",
      ringFreq: 2.8,
      ringGamma: 1.5,
      along: 7e-3,
      across: 0.044,
      knots: 3.6,
      streaks: 8,
      contrast: 1.08,
      finish: "matte",
      sheen: 0.3
    },
    joinery: {
      kind: "bone-pin",
      metal: "#f4e8cc",
      metalDark: "#a48f68",
      highlight: "rgba(255, 255, 244, 0.85)",
      size: 4.4,
      density: 0.7
    },
    crown: {
      profile: "gable",
      carving: "fossil",
      height: 46,
      overhang: 10,
      bead: { colour: "rgba(255, 176, 58, 0.7)", width: 1.6 },
      centrepiece: "skull"
    },
    rail: {
      inlay: "painted-line",
      inlayColour: "#35c257",
      edge: "rough",
      width: 36,
      ink: "rgba(58, 34, 14, 0.6)"
    },
    plate: {
      kind: "amber-stone",
      body: "#f0930e",
      bodyDark: "#8f4708",
      ink: "rgba(56, 26, 4, 0.92)",
      fixing: "rivets",
      w: 108,
      h: 32,
      font: '"Kalam", cursive',
      fontSize: 20,
      burn: 0,
      radius: 12
    },
    wallpaper: { pattern: "fern-footprint", colourway: "jungle", tile: 256 },
    backdrops: ["papered", "boarded", "plastered"],
    light: {
      pools: [
        { x: 0.5, y: 0.98, radius: 0.78, colour: "#ff7a1f", intensity: 0.58, drift: 6 },
        { x: 0.12, y: 0.1, radius: 0.46, colour: "#ffd257", intensity: 0.4, drift: 8 },
        { x: 0.9, y: 0.3, radius: 0.46, colour: "#4fd06a", intensity: 0.38, drift: 5 }
      ],
      ambient: { colour: "#ffb03e", amount: 0.16 },
      rim: { colour: "#ffd08a", width: 2.2, intensity: 0.5 },
      vignette: { amount: 0.44, colour: "#16230a" },
      driftSeconds: 30,
      flicker: 0.08,
      shafts: false
    },
    flora: {
      species: ["fern-frond", "ivy-trail", "moss-tuft", "grass-tuft", "potted-plant"],
      density: "lush",
      anchors: ["rail-top", "case-corner", "joint-gap", "shelf-underside", "pot"]
    },
    props: [
      { kind: "fossil-skull", anchor: "shelf", weight: 4, fallback: 3 },
      { kind: "amber-specimen", anchor: "shelf", weight: 3, fallback: 1 },
      { kind: "palm-frond", anchor: "shelf", weight: 3, fallback: 0 },
      { kind: "crate", anchor: "shelf", weight: 2, fallback: 4 }
    ],
    spineDefaults: {
      materials: ["leather", "cloth", "paper"],
      pigments: ["#2f9e4f", "#e8760f", "#c9302c", "#137a6e", "#f0b323", "#7a4a1e"],
      gilt: 0.24,
      bands: 0.5,
      wear: 0.5
    },
    motes: { kind: "pollen", density: 30, colour: "#ffd88a", drift: 5 },
    // The dig site is open to the jungle and the volcano behind it.
    backing: "wallpaper"
  };
  var CANDY = {
    id: "candy",
    name: "Candy Shop",
    blurb: "Glossy bubblegum and mint, peppermint stripes and a sugar sparkle.",
    wood: {
      light: "#ffe2ef",
      dark: "#f39ac4",
      grain: "gloss",
      ringFreq: 1.6,
      ringGamma: 1,
      along: 5e-3,
      across: 0.05,
      knots: 0,
      streaks: 3,
      contrast: 0.5,
      finish: "gloss",
      sheen: 0.8,
      paint: { colour: "#ff5f9e", shade: "#c22f7c", chipping: 0.05, opacity: 0.94 }
    },
    joinery: {
      kind: "candy-stud",
      metal: "#68e8c4",
      metalDark: "#2aa88c",
      highlight: "rgba(255, 255, 255, 0.92)",
      size: 4,
      density: 0.8
    },
    crown: {
      profile: "crest",
      carving: "candy-stripe",
      height: 46,
      overhang: 14,
      bead: { colour: "rgba(255, 244, 140, 0.9)", width: 2 },
      centrepiece: "lollipop"
    },
    rail: {
      inlay: "candy-stripe",
      inlayColour: "#ff5f9e",
      edge: "rounded",
      width: 34,
      ink: "rgba(150, 66, 108, 0.5)"
    },
    plate: {
      kind: "candy-wrapper",
      body: "#ffe45c",
      bodyDark: "#e8a81c",
      ink: "rgba(176, 40, 104, 0.95)",
      fixing: "none",
      w: 108,
      h: 32,
      font: '"Caveat Variable", Caveat, cursive',
      fontSize: 22,
      burn: 0,
      radius: 10
    },
    wallpaper: { pattern: "peppermint-stripe", colourway: "bubblegum", tile: 256 },
    backdrops: ["papered", "panelled", "boarded"],
    light: {
      pools: [
        { x: 0.3, y: 0.08, radius: 0.66, colour: "#fffbe0", intensity: 0.5, drift: 8 },
        { x: 0.78, y: 0.6, radius: 0.46, colour: "#b8ffe8", intensity: 0.34, drift: 6 },
        { x: 0.5, y: 1, radius: 0.44, colour: "#ffd9f0", intensity: 0.32, drift: 4 }
      ],
      ambient: { colour: "#ffd6ea", amount: 0.1 },
      rim: { colour: "#ffffff", width: 2.2, intensity: 0.5 },
      vignette: { amount: 0.18, colour: "#a33d74" },
      driftSeconds: 32,
      flicker: 0,
      shafts: false
    },
    flora: {
      species: ["potted-plant", "moss-tuft"],
      density: "sparse",
      anchors: ["pot", "joint-gap"]
    },
    props: [
      { kind: "lollipop", anchor: "shelf", weight: 4, fallback: 1 },
      { kind: "candy-jar", anchor: "shelf", weight: 4, fallback: 1 },
      { kind: "cupcake", anchor: "shelf", weight: 3, fallback: 0 },
      { kind: "jam-jar", anchor: "shelf", weight: 2, fallback: 4 }
    ],
    spineDefaults: {
      materials: ["paper", "silk", "cloth"],
      pigments: ["#ff5f9e", "#3fd6b0", "#ffd93d", "#b47cf0", "#5ec8ff", "#ff8a5c"],
      gilt: 0.16,
      bands: 0.2,
      wear: 0.08
    },
    motes: { kind: "confetti", density: 26, colour: "#fff2a8", drift: 6 },
    shelfDetail: "bunting"
  };
  var REEF = {
    id: "reef",
    name: "Coral Reef",
    blurb: "Turquoise case, coral branches and kelp, sunbeams falling through blue.",
    wood: {
      light: "#a8ece4",
      dark: "#227f88",
      grain: "straight",
      ringFreq: 2.4,
      ringGamma: 1.3,
      along: 7e-3,
      across: 0.05,
      knots: 0.4,
      streaks: 6,
      contrast: 0.66,
      finish: "gloss",
      sheen: 0.6,
      paint: { colour: "#22bfb8", shade: "#0e7d86", chipping: 0.3, opacity: 0.9 }
    },
    joinery: {
      kind: "shell-rivet",
      metal: "#ffddc6",
      metalDark: "#d3937c",
      highlight: "rgba(255, 255, 255, 0.9)",
      size: 4,
      density: 0.65
    },
    crown: {
      profile: "arch",
      carving: "coral",
      height: 48,
      overhang: 12,
      bead: { colour: "rgba(255, 138, 118, 0.8)", width: 1.6 },
      centrepiece: "shell"
    },
    rail: {
      inlay: "coral-line",
      inlayColour: "#ff7a63",
      edge: "rounded",
      width: 34,
      ink: "rgba(18, 72, 88, 0.55)"
    },
    plate: {
      kind: "shell",
      body: "#ffe0cb",
      bodyDark: "#dea287",
      ink: "rgba(20, 78, 100, 0.92)",
      fixing: "none",
      w: 104,
      h: 32,
      font: '"Patrick Hand", cursive',
      fontSize: 20,
      burn: 0,
      radius: 14
    },
    wallpaper: { pattern: "reef-bubble", colourway: "lagoon", tile: 256 },
    backdrops: ["papered", "glazed", "panelled"],
    light: {
      pools: [
        { x: 0.3, y: -0.06, radius: 0.62, colour: "#c8fbff", intensity: 0.54, drift: 10 },
        { x: 0.72, y: -0.02, radius: 0.5, colour: "#a6f0ff", intensity: 0.42, drift: 12 },
        { x: 0.5, y: 0.9, radius: 0.44, colour: "#ff9c7a", intensity: 0.3, drift: 5 }
      ],
      ambient: { colour: "#2fd3d8", amount: 0.18 },
      rim: { colour: "#dcffff", width: 2.4, intensity: 0.46 },
      vignette: { amount: 0.42, colour: "#07314f" },
      driftSeconds: 24,
      flicker: 0.1,
      shafts: true
    },
    flora: {
      species: ["ivy-trail", "fern-frond", "moss-tuft", "pothos-trail"],
      density: "lush",
      anchors: ["rail-top", "case-corner", "shelf-underside", "joint-gap"]
    },
    props: [
      { kind: "coral-fan", anchor: "shelf", weight: 4, fallback: 0 },
      { kind: "conch", anchor: "shelf", weight: 3, fallback: 3 },
      { kind: "glow-bottle", anchor: "shelf", weight: 2, fallback: 2 },
      { kind: "glass-cloche", anchor: "shelf", weight: 2, fallback: 1 }
    ],
    spineDefaults: {
      materials: ["cloth", "silk", "linen"],
      pigments: ["#ff7a63", "#17b5c4", "#ffc75f", "#2f76c9", "#f25f9c", "#3fc98a"],
      gilt: 0.22,
      bands: 0.3,
      wear: 0.24
    },
    motes: { kind: "bubbles", density: 32, colour: "#d6f9ff", drift: -12 },
    // Open water behind the shelves rather than a timber back.
    backing: "wallpaper"
  };
  var VOYAGER = {
    id: "voyager",
    name: "Star Voyager",
    blurb: "Indigo and violet lacquer, neon rails, planets and comet trails.",
    wood: {
      light: "#5646b8",
      dark: "#150f36",
      grain: "flame",
      ringFreq: 3,
      ringGamma: 1.8,
      along: 5e-3,
      across: 0.055,
      knots: 0.3,
      streaks: 9,
      contrast: 1,
      finish: "lacquer",
      sheen: 0.75
    },
    joinery: {
      kind: "star-rivet",
      metal: "#c8d2ff",
      metalDark: "#4b3f8f",
      highlight: "rgba(255, 255, 255, 0.9)",
      size: 4,
      density: 0.7
    },
    crown: {
      profile: "crest",
      carving: "starfield",
      height: 50,
      overhang: 11,
      bead: { colour: "rgba(120, 244, 255, 0.85)", width: 1.6 },
      centrepiece: "planet"
    },
    rail: {
      inlay: "neon",
      inlayColour: "#ff45d0",
      edge: "sharp",
      width: 34,
      ink: "rgba(20, 14, 44, 0.7)"
    },
    plate: {
      kind: "neon",
      body: "#1a1246",
      bodyDark: "#0a0724",
      ink: "rgba(120, 246, 255, 0.98)",
      fixing: "rivets",
      w: 110,
      h: 32,
      font: '"Kalam", cursive',
      fontSize: 20,
      burn: 0,
      radius: 6
    },
    wallpaper: { pattern: "nebula", colourway: "nebula", tile: 256 },
    backdrops: ["papered", "glazed", "panelled"],
    light: {
      pools: [
        { x: 0.18, y: 0.12, radius: 0.5, colour: "#7cf5ff", intensity: 0.5, drift: 7 },
        { x: 0.84, y: 0.44, radius: 0.44, colour: "#ff4fd8", intensity: 0.46, drift: 7 },
        { x: 0.46, y: 0.94, radius: 0.46, colour: "#9a6bff", intensity: 0.36, drift: 5 }
      ],
      ambient: { colour: "#6a4ad8", amount: 0.2 },
      rim: { colour: "#9ef8ff", width: 2.6, intensity: 0.66 },
      vignette: { amount: 0.5, colour: "#0a0630" },
      driftSeconds: 44,
      flicker: 0.06,
      shafts: false
    },
    flora: { species: [], density: "none", anchors: [] },
    props: [
      { kind: "rocket", anchor: "shelf", weight: 4, fallback: 1 },
      { kind: "planet", anchor: "shelf", weight: 4, fallback: 3 },
      { kind: "telescope", anchor: "shelf", weight: 2, fallback: 1 },
      { kind: "star-chart", anchor: "shelf", weight: 2, fallback: 4 }
    ],
    spineDefaults: {
      materials: ["leather", "silk", "cloth"],
      pigments: ["#5b3fd6", "#12d3e8", "#ff45b8", "#ffcf3f", "#3f7bff", "#8aff9e"],
      gilt: 0.42,
      bands: 0.45,
      wear: 0.14
    },
    motes: { kind: "stars", density: 24, colour: "#b6f0ff", drift: 2 },
    // There is no back to this case; there is only the nebula.
    backing: "wallpaper"
  };
  var ATHENAEUM = {
    id: "athenaeum",
    name: "Old Athenaeum",
    blurb: "Quartersawn oak, brass and gilt \u2014 the refined default.",
    wood: {
      light: "#a87c45",
      dark: "#3c2410",
      grain: "quartersawn",
      ringFreq: 3.4,
      ringGamma: 1.7,
      along: 6e-3,
      across: 0.05,
      knots: 1.4,
      streaks: 7,
      contrast: 1,
      finish: "wax",
      sheen: 0.5
    },
    joinery: {
      kind: "peg",
      metal: "#7d5f3f",
      metalDark: "#43301f",
      highlight: "rgba(255, 240, 214, 0.42)",
      size: 3.6,
      density: 0.7
    },
    crown: {
      profile: "stepped",
      carving: "dentil",
      height: 46,
      overhang: 10,
      bead: { colour: "rgba(255, 198, 62, 0.72)", width: 1.2 },
      centrepiece: "diamond"
    },
    rail: {
      inlay: "gold-pinstripe",
      inlayColour: "rgba(255, 198, 62, 0.72)",
      edge: "sharp",
      width: 34,
      ink: "rgba(60, 52, 44, 0.55)"
    },
    plate: {
      kind: "brass",
      body: "#d8ac3c",
      bodyDark: "#8f6a15",
      ink: "rgba(52, 38, 16, 0.85)",
      fixing: "screws",
      w: 108,
      h: 30,
      font: '"Caveat Variable", Caveat, cursive',
      fontSize: 20,
      burn: 0,
      radius: 3
    },
    wallpaper: { pattern: "damask", colourway: "tobacco", tile: 256 },
    backdrops: ["panelled", "papered", "plastered"],
    light: {
      pools: [
        { x: 0.26, y: 0.16, radius: 0.44, colour: "#ffd070", intensity: 0.6, drift: 10 },
        { x: 0.78, y: 0.52, radius: 0.38, colour: "#ffbe62", intensity: 0.42, drift: 7 }
      ],
      ambient: { colour: "#ffc76a", amount: 0.17 },
      rim: null,
      vignette: { amount: 0.46, colour: "#241708" },
      driftSeconds: 34,
      flicker: 0,
      shafts: false
    },
    flora: { species: ["ivy-trail"], density: "sparse", anchors: ["pot", "rail-top"] },
    props: [
      { kind: "hourglass", anchor: "shelf", weight: 3, fallback: 1 },
      { kind: "globe", anchor: "shelf", weight: 2, fallback: 3 },
      { kind: "candlestick", anchor: "shelf", weight: 2, fallback: 2 },
      { kind: "inkwell", anchor: "shelf", weight: 2, fallback: 4 }
    ],
    spineDefaults: {
      materials: ["leather", "cloth", "leather"],
      pigments: ["#a02a22", "#1f7a4a", "#d09a18", "#3b3a96", "#b0561c", "#7a2f6a"],
      gilt: 0.62,
      bands: 0.8,
      wear: 0.3
    },
    motes: { kind: "dust", density: 26, colour: "#f2dcb4", drift: 5 }
  };
  var CONSERVATORY = {
    id: "conservatory",
    name: "Fern Conservatory",
    blurb: "Chipped sage paint, enamel plates and things growing everywhere.",
    wood: {
      light: "#dccdae",
      dark: "#b09b78",
      grain: "straight",
      ringFreq: 2.4,
      ringGamma: 1.3,
      along: 8e-3,
      across: 0.04,
      knots: 0.8,
      streaks: 4,
      contrast: 0.6,
      finish: "painted",
      sheen: 0.22,
      paint: { colour: "#5cb96b", shade: "#247a45", chipping: 0.55, opacity: 0.94 }
    },
    joinery: {
      kind: "mitre",
      metal: "#7fce88",
      metalDark: "#3f9a5e",
      highlight: "rgba(255, 255, 246, 0.5)",
      size: 2.4,
      density: 0.35
    },
    crown: {
      profile: "ogee",
      carving: "scallop",
      height: 44,
      overhang: 12,
      bead: { colour: "rgba(246, 250, 240, 0.5)", width: 1.2 },
      centrepiece: "rosette"
    },
    rail: {
      inlay: "painted-line",
      inlayColour: "rgba(238, 246, 232, 0.55)",
      edge: "chamfer",
      width: 32,
      ink: "rgba(74, 84, 66, 0.5)"
    },
    plate: {
      kind: "enamel",
      body: "#f2f4ea",
      bodyDark: "#c3ccb8",
      ink: "rgba(58, 78, 60, 0.85)",
      fixing: "rivets",
      w: 104,
      h: 32,
      font: '"Patrick Hand", cursive',
      fontSize: 19,
      burn: 0,
      radius: 14
    },
    wallpaper: { pattern: "botanical-toile", colourway: "eucalyptus", tile: 256 },
    backdrops: ["glazed", "boarded", "papered"],
    light: {
      pools: [
        { x: 0.5, y: -0.08, radius: 0.8, colour: "#d8ffe0", intensity: 0.5, drift: 4 },
        { x: 0.38, y: 1.02, radius: 0.52, colour: "#ffd47a", intensity: 0.32, drift: 3 }
      ],
      ambient: { colour: "#9fe6a8", amount: 0.15 },
      rim: { colour: "#f4fff2", width: 2.5, intensity: 0.3 },
      vignette: { amount: 0.24, colour: "#2e4030" },
      driftSeconds: 46,
      flicker: 0,
      shafts: false
    },
    flora: {
      species: ["ivy-trail", "pothos-trail", "moss-tuft", "fern-frond", "potted-plant"],
      density: "lush",
      anchors: ["rail-top", "shelf-underside", "case-corner", "joint-gap", "pot", "crown-top"]
    },
    props: [
      { kind: "terracotta-pot", anchor: "shelf", weight: 4, fallback: 0 },
      { kind: "watering-can", anchor: "shelf", weight: 2, fallback: 3 },
      { kind: "glass-cloche", anchor: "shelf", weight: 2, fallback: 1 },
      { kind: "seed-packet", anchor: "shelf", weight: 2, fallback: 4 }
    ],
    spineDefaults: {
      materials: ["paper", "linen", "cloth"],
      pigments: ["#5aa84a", "#e0c063", "#3f9fb0", "#d98a5a", "#9a6fc4", "#e0705f"],
      gilt: 0.08,
      bands: 0.2,
      wear: 0.35
    },
    motes: { kind: "pollen", density: 34, colour: "#f6f0b8", drift: -3 }
  };
  var OBSERVATORY = {
    id: "observatory",
    name: "Moonlit Observatory",
    blurb: "Near-black walnut, silver inlay and a sky full of tiny gold stars.",
    wood: {
      light: "#544a86",
      dark: "#141033",
      grain: "flame",
      ringFreq: 2.8,
      ringGamma: 2,
      along: 5e-3,
      across: 0.055,
      knots: 0.6,
      streaks: 8,
      contrast: 1.05,
      finish: "lacquer",
      sheen: 0.68
    },
    joinery: {
      kind: "brass-bracket",
      metal: "#b6bcc4",
      metalDark: "#6a717b",
      highlight: "rgba(238, 246, 255, 0.65)",
      size: 3.2,
      density: 0.5
    },
    crown: {
      profile: "stepped",
      carving: "star-punch",
      height: 48,
      overhang: 9,
      bead: { colour: "rgba(196, 206, 220, 0.6)", width: 1 },
      centrepiece: "star"
    },
    rail: {
      inlay: "silver",
      inlayColour: "rgba(214, 228, 255, 0.75)",
      edge: "sharp",
      width: 34,
      ink: "rgba(24, 22, 28, 0.7)"
    },
    plate: {
      kind: "slate",
      body: "#3b4048",
      bodyDark: "#22262c",
      ink: "rgba(216, 226, 240, 0.9)",
      fixing: "rivets",
      w: 106,
      h: 30,
      font: '"Kalam", cursive',
      fontSize: 19,
      burn: 0,
      radius: 2
    },
    wallpaper: { pattern: "constellation", colourway: "midnight", tile: 256 },
    backdrops: ["papered", "glazed", "panelled"],
    light: {
      pools: [
        { x: 0.16, y: 0.1, radius: 0.7, colour: "#a8d0ff", intensity: 0.58, drift: 5 },
        { x: 0.86, y: 0.78, radius: 0.38, colour: "#ffa53f", intensity: 0.4, drift: 3 }
      ],
      ambient: { colour: "#5a6fd8", amount: 0.2 },
      rim: { colour: "#dce8ff", width: 2.2, intensity: 0.6 },
      vignette: { amount: 0.5, colour: "#0d1020" },
      driftSeconds: 52,
      flicker: 0,
      shafts: false
    },
    flora: { species: [], density: "none", anchors: [] },
    props: [
      { kind: "orrery", anchor: "shelf", weight: 3, fallback: 3 },
      { kind: "telescope", anchor: "shelf", weight: 3, fallback: 1 },
      { kind: "moon-dial", anchor: "shelf", weight: 2, fallback: 3 },
      { kind: "star-chart", anchor: "shelf", weight: 2, fallback: 4 }
    ],
    spineDefaults: {
      materials: ["leather", "silk", "cloth"],
      pigments: ["#2b3fb0", "#7a2f9e", "#1f7a9e", "#8a90e0", "#e0b83f", "#c43f8a"],
      gilt: 0.5,
      bands: 0.6,
      wear: 0.2
    },
    motes: { kind: "sparkle", density: 20, colour: "#e8f0ff", drift: 1 }
  };
  var COTTAGE = {
    id: "cottage",
    name: "Cottage Nook",
    blurb: "Honey pine, knots and knitting \u2014 warm and thoroughly lived in.",
    wood: {
      light: "#f5c877",
      dark: "#a5641e",
      grain: "knotty",
      ringFreq: 2.6,
      ringGamma: 1.4,
      along: 7e-3,
      across: 0.042,
      knots: 4.2,
      streaks: 6,
      contrast: 0.92,
      finish: "matte",
      sheen: 0.28
    },
    joinery: {
      kind: "painted-chip",
      metal: "#f3e2cb",
      metalDark: "#c39a6e",
      highlight: "rgba(255, 250, 236, 0.6)",
      size: 3,
      density: 0.5
    },
    crown: {
      profile: "flat",
      carving: "ovolo",
      height: 40,
      overhang: 13,
      bead: { colour: "rgba(255, 122, 138, 0.7)", width: 1.8 },
      centrepiece: "rosette"
    },
    rail: {
      inlay: "painted-line",
      inlayColour: "rgba(255, 122, 138, 0.7)",
      edge: "rounded",
      width: 32,
      ink: "rgba(96, 70, 46, 0.5)"
    },
    plate: {
      kind: "paper-tag",
      body: "#f5e7cd",
      bodyDark: "#d8c39c",
      ink: "rgba(112, 74, 46, 0.85)",
      fixing: "string",
      w: 100,
      h: 34,
      font: '"Caveat Variable", Caveat, cursive',
      fontSize: 21,
      burn: 0,
      radius: 4
    },
    wallpaper: { pattern: "gingham-floral", colourway: "rose-cream", tile: 256 },
    backdrops: ["boarded", "papered", "panelled"],
    light: {
      pools: [
        { x: 0.92, y: 0.3, radius: 0.74, colour: "#ffc464", intensity: 0.58, drift: 12 },
        { x: 0.34, y: 0.68, radius: 0.46, colour: "#ffd08a", intensity: 0.36, drift: 8 }
      ],
      ambient: { colour: "#ffc98a", amount: 0.16 },
      rim: { colour: "#fff0d2", width: 2, intensity: 0.26 },
      vignette: { amount: 0.36, colour: "#5e3a20" },
      driftSeconds: 40,
      flicker: 0,
      shafts: false
    },
    flora: {
      species: ["potted-plant", "string-of-hearts", "moss-tuft"],
      density: "sparse",
      anchors: ["pot", "rail-top", "shelf-underside"]
    },
    props: [
      { kind: "jam-jar", anchor: "shelf", weight: 3, fallback: 0 },
      { kind: "yarn-ball", anchor: "shelf", weight: 3, fallback: 3 },
      { kind: "thimble", anchor: "shelf", weight: 2, fallback: 1 },
      { kind: "bunting", anchor: "shelf-underside", weight: 2, fallback: 4 }
    ],
    spineDefaults: {
      materials: ["cloth", "linen", "paper"],
      pigments: ["#f0899e", "#ffd166", "#7fc98a", "#d98ac4", "#6fb6d6", "#e8825c"],
      gilt: 0.12,
      bands: 0.25,
      wear: 0.55
    },
    motes: { kind: "dust", density: 24, colour: "#ffe6bc", drift: 4 },
    shelfDetail: "bunting"
  };
  var SCRIPTORIUM = {
    id: "scriptorium",
    name: "Scriptorium",
    blurb: "Blackened timber, iron straps, limewashed plaster and candlelight.",
    wood: {
      light: "#6b5230",
      dark: "#1e150c",
      grain: "weathered",
      ringFreq: 2.2,
      ringGamma: 2.1,
      along: 5e-3,
      across: 0.06,
      knots: 2.4,
      streaks: 9,
      contrast: 1.1,
      finish: "raw",
      sheen: 0.1
    },
    joinery: {
      kind: "iron-strap",
      metal: "#5b5751",
      metalDark: "#2b2823",
      highlight: "rgba(220, 214, 200, 0.4)",
      size: 9,
      density: 0.9
    },
    crown: {
      profile: "beam",
      carving: "plain",
      height: 52,
      overhang: 6,
      bead: null,
      centrepiece: "none"
    },
    rail: {
      inlay: "none",
      inlayColour: "rgba(0, 0, 0, 0)",
      edge: "rough",
      width: 38,
      ink: "rgba(24, 20, 14, 0.65)"
    },
    plate: {
      kind: "wood-burnt",
      body: "#8a6d4a",
      bodyDark: "#4e3a24",
      ink: "rgba(38, 24, 12, 0.9)",
      fixing: "nails",
      w: 104,
      h: 30,
      font: '"Kalam", cursive',
      fontSize: 19,
      burn: 0.85,
      radius: 2
    },
    wallpaper: { pattern: "plain-limewash", colourway: "limewash", tile: 256 },
    backdrops: ["plastered", "boarded", "papered"],
    light: {
      pools: [
        { x: 0.14, y: 0.24, radius: 0.32, colour: "#ffa326", intensity: 0.66, drift: 3 },
        { x: 0.52, y: 0.08, radius: 0.28, colour: "#ff8f18", intensity: 0.54, drift: 2 },
        { x: 0.86, y: 0.6, radius: 0.3, colour: "#ffb038", intensity: 0.58, drift: 3 }
      ],
      ambient: { colour: "#e09332", amount: 0.2 },
      rim: { colour: "#ffcf8a", width: 1.8, intensity: 0.34 },
      vignette: { amount: 0.72, colour: "#150e08" },
      driftSeconds: 22,
      flicker: 0.55,
      shafts: false
    },
    flora: { species: ["cobweb"], density: "sparse", anchors: ["case-corner", "crown-top"] },
    props: [
      { kind: "quill", anchor: "shelf", weight: 3, fallback: 2 },
      { kind: "wax-seal", anchor: "shelf", weight: 2, fallback: 4 },
      { kind: "scroll", anchor: "shelf", weight: 3, fallback: 4 },
      { kind: "bell", anchor: "shelf", weight: 2, fallback: 1 }
    ],
    spineDefaults: {
      materials: ["vellum", "leather", "paper"],
      pigments: ["#e8d8a8", "#a82a1e", "#d0a02a", "#2f6a4a", "#3a5a9e", "#7a3a1e"],
      gilt: 0.45,
      bands: 0.7,
      wear: 0.7
    },
    motes: { kind: "dust", density: 48, colour: "#e8cf9a", drift: 6 },
    // The scriptorium's own limewashed wall shows straight through the case.
    backing: "wallpaper"
  };
  var SAKURA = {
    id: "sakura",
    name: "Sakura Pavilion",
    blurb: "Pale hinoki, flawless joinery, rice paper and drifting petals.",
    wood: {
      light: "#f0e0c2",
      dark: "#cbb188",
      grain: "fine",
      ringFreq: 4.6,
      ringGamma: 1.2,
      along: 4e-3,
      across: 0.07,
      knots: 0.2,
      streaks: 5,
      contrast: 0.5,
      finish: "raw",
      sheen: 0.2
    },
    joinery: {
      kind: "mitre",
      metal: "#e2d0ae",
      metalDark: "#b39d78",
      highlight: "rgba(255, 252, 244, 0.7)",
      size: 2,
      density: 0.3
    },
    crown: {
      profile: "flat",
      carving: "plain",
      height: 36,
      overhang: 16,
      bead: null,
      centrepiece: "crane"
    },
    rail: {
      inlay: "none",
      inlayColour: "rgba(0, 0, 0, 0)",
      edge: "chamfer",
      width: 30,
      ink: "rgba(120, 104, 78, 0.45)"
    },
    plate: {
      kind: "wood-burnt",
      body: "#e8d6b4",
      bodyDark: "#c2ab86",
      ink: "rgba(70, 58, 42, 0.82)",
      fixing: "none",
      w: 92,
      h: 30,
      font: '"Patrick Hand", cursive',
      fontSize: 19,
      burn: 0,
      radius: 2
    },
    wallpaper: { pattern: "rice-paper-bamboo", colourway: "rice", tile: 256 },
    backdrops: ["shoji", "papered", "boarded"],
    light: {
      pools: [
        { x: 0.5, y: 0.3, radius: 0.95, colour: "#fff2dc", intensity: 0.46, drift: 3 },
        { x: 0.2, y: 0.82, radius: 0.44, colour: "#ffc6da", intensity: 0.34, drift: 2 }
      ],
      ambient: { colour: "#ffe4d0", amount: 0.11 },
      rim: { colour: "#fffaf2", width: 1.6, intensity: 0.22 },
      vignette: { amount: 0.16, colour: "#7c6a58" },
      driftSeconds: 60,
      flicker: 0,
      shafts: false
    },
    flora: {
      species: ["blossom-branch", "moss-tuft"],
      density: "sparse",
      anchors: ["crown-top", "joint-gap"]
    },
    props: [
      { kind: "tea-bowl", anchor: "shelf", weight: 3, fallback: 0 },
      { kind: "ink-stone", anchor: "shelf", weight: 2, fallback: 4 },
      { kind: "paper-crane", anchor: "shelf", weight: 3, fallback: 1 }
    ],
    spineDefaults: {
      materials: ["paper", "silk", "linen"],
      pigments: ["#2f5fbf", "#ff9ec2", "#6fbf5a", "#e8d9a8", "#e0607a", "#8a6fd0"],
      gilt: 0.06,
      bands: 0.1,
      wear: 0.12
    },
    motes: { kind: "petals", density: 16, colour: "#ffb0cc", drift: 8 }
  };
  var ATTIC = {
    id: "attic",
    name: "Attic Archive",
    blurb: "Grey barn wood, mismatched planks and a zigzag of warm bulbs.",
    wood: {
      light: "#c9b48f",
      dark: "#6e5f48",
      grain: "weathered",
      ringFreq: 2.9,
      ringGamma: 1.9,
      along: 6e-3,
      across: 0.052,
      knots: 3,
      streaks: 11,
      contrast: 0.85,
      finish: "raw",
      sheen: 0.06
    },
    joinery: {
      kind: "nail-head",
      metal: "#8a8177",
      metalDark: "#4d463e",
      highlight: "rgba(240, 236, 226, 0.5)",
      size: 2.6,
      density: 1
    },
    crown: {
      profile: "gable",
      carving: "plain",
      height: 42,
      overhang: 8,
      bead: null,
      centrepiece: "none"
    },
    rail: {
      inlay: "none",
      inlayColour: "rgba(0, 0, 0, 0)",
      edge: "rough",
      width: 33,
      ink: "rgba(58, 52, 44, 0.55)"
    },
    plate: {
      kind: "tin",
      body: "#a8a49b",
      bodyDark: "#6d6960",
      ink: "rgba(48, 44, 38, 0.85)",
      fixing: "nails",
      w: 102,
      h: 30,
      font: '"Nunito Sans", sans-serif',
      fontSize: 15,
      burn: 0,
      radius: 1
    },
    wallpaper: { pattern: "lath-plaster", colourway: "greyboard", tile: 256 },
    backdrops: ["papered", "boarded", "plastered"],
    light: {
      pools: [
        { x: 0.12, y: 0.12, radius: 0.3, colour: "#ffb347", intensity: 0.62, drift: 6 },
        { x: 0.38, y: 0.04, radius: 0.28, colour: "#ffa832", intensity: 0.58, drift: 6 },
        { x: 0.64, y: 0.14, radius: 0.28, colour: "#ffbe58", intensity: 0.56, drift: 6 },
        { x: 0.9, y: 0.05, radius: 0.28, colour: "#ff9f2e", intensity: 0.54, drift: 6 }
      ],
      ambient: { colour: "#d8a45c", amount: 0.18 },
      rim: null,
      vignette: { amount: 0.66, colour: "#241d16" },
      driftSeconds: 18,
      flicker: 0.12,
      shafts: true
    },
    flora: { species: ["cobweb", "grass-tuft"], density: "sparse", anchors: ["case-corner", "joint-gap"] },
    props: [
      { kind: "crate", anchor: "shelf", weight: 3, fallback: 4 },
      { kind: "suitcase", anchor: "shelf", weight: 2, fallback: 4 },
      { kind: "dusty-jar", anchor: "shelf", weight: 3, fallback: 1 },
      { kind: "newspapers", anchor: "shelf", weight: 2, fallback: 4 }
    ],
    spineDefaults: {
      materials: ["paper", "cloth", "linen"],
      pigments: ["#d29a42", "#7f9e8a", "#c06a3a", "#4f7a9e", "#e0c070", "#a85a6a"],
      gilt: 0.04,
      bands: 0.15,
      wear: 0.9
    },
    motes: { kind: "dust", density: 62, colour: "#e6d5b4", drift: 7 },
    // No back boards at all in the attic — you see the lath straight through.
    backing: "wallpaper"
  };
  var APOTHECARY = {
    id: "apothecary",
    name: "Amber Apothecary",
    blurb: "Cherry and brass, tiny drawers, and bottles that glow from within.",
    wood: {
      light: "#c26a24",
      dark: "#57200c",
      grain: "flame",
      ringFreq: 3.1,
      ringGamma: 1.6,
      along: 55e-4,
      across: 0.048,
      knots: 1,
      streaks: 8,
      contrast: 1,
      finish: "lacquer",
      sheen: 0.6
    },
    joinery: {
      kind: "brass-bracket",
      metal: "#c9a94f",
      metalDark: "#8a6a24",
      highlight: "rgba(255, 238, 190, 0.6)",
      size: 3.4,
      density: 0.8
    },
    crown: {
      profile: "pediment",
      carving: "dentil",
      height: 50,
      overhang: 12,
      bead: { colour: "rgba(214, 172, 74, 0.6)", width: 1.2 },
      centrepiece: "mortar"
    },
    rail: {
      inlay: "brass-bead",
      inlayColour: "rgba(214, 172, 74, 0.55)",
      edge: "rounded",
      width: 34,
      ink: "rgba(56, 32, 20, 0.6)"
    },
    plate: {
      kind: "brass",
      body: "#c7a54a",
      bodyDark: "#8a6a24",
      ink: "rgba(48, 30, 12, 0.88)",
      fixing: "screws",
      w: 96,
      h: 28,
      font: '"Kalam", cursive',
      fontSize: 18,
      burn: 0,
      radius: 3
    },
    wallpaper: { pattern: "apothecary-labels", colourway: "amber", tile: 256 },
    backdrops: ["papered", "panelled", "plastered"],
    light: {
      pools: [
        { x: 0.22, y: 0.72, radius: 0.34, colour: "#ffb257", intensity: 0.5, drift: 4 },
        { x: 0.56, y: 0.86, radius: 0.28, colour: "#ffc266", intensity: 0.44, drift: 4 },
        { x: 0.84, y: 0.66, radius: 0.3, colour: "#ffa93f", intensity: 0.46, drift: 4 },
        { x: 0.5, y: 0.1, radius: 0.5, colour: "#f2c17e", intensity: 0.22, drift: 6 }
      ],
      ambient: { colour: "#ff9f22", amount: 0.2 },
      rim: { colour: "#ffdc9a", width: 2, intensity: 0.4 },
      vignette: { amount: 0.52, colour: "#2a1408" },
      driftSeconds: 30,
      flicker: 0.18,
      shafts: false
    },
    flora: {
      species: ["herb-bundle", "ivy-trail"],
      density: "sparse",
      anchors: ["shelf-underside", "rail-top"]
    },
    props: [
      { kind: "mortar-pestle", anchor: "shelf", weight: 3, fallback: 4 },
      { kind: "brass-scales", anchor: "shelf", weight: 2, fallback: 1 },
      { kind: "glow-bottle", anchor: "shelf", weight: 4, fallback: 2 }
    ],
    spineDefaults: {
      materials: ["leather", "paper", "cloth"],
      pigments: ["#e07a14", "#c2331e", "#e0a824", "#2f7a6a", "#8a3f9e", "#f0b83a"],
      gilt: 0.4,
      bands: 0.5,
      wear: 0.45
    },
    motes: { kind: "sparkle", density: 22, colour: "#ffd28a", drift: 3 },
    shelfDetail: "drawers"
  };
  var THEMES = {
    blossom: BLOSSOM,
    robot: ROBOT,
    dino: DINO,
    candy: CANDY,
    reef: REEF,
    voyager: VOYAGER,
    athenaeum: ATHENAEUM,
    conservatory: CONSERVATORY,
    observatory: OBSERVATORY,
    cottage: COTTAGE,
    scriptorium: SCRIPTORIUM,
    sakura: SAKURA,
    attic: ATTIC,
    apothecary: APOTHECARY
  };
  function getTheme(id) {
    return isThemeId(id) ? THEMES[id] : THEMES[DEFAULT_THEME_ID];
  }

  // node_modules/@tauri-apps/api/external/tslib/tslib.es6.js
  function __classPrivateFieldGet(receiver, state, kind, f2) {
    if (kind === "a" && !f2) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f2 : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f2 : kind === "a" ? f2.call(receiver) : f2 ? f2.value : state.get(receiver);
  }
  function __classPrivateFieldSet(receiver, state, value, kind, f2) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f2) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f2 : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return kind === "a" ? f2.call(receiver, value) : f2 ? f2.value = value : state.set(receiver, value), value;
  }

  // node_modules/@tauri-apps/api/core.js
  var _Channel_onmessage;
  var _Channel_nextMessageIndex;
  var _Channel_pendingMessages;
  var _Channel_messageEndIndex;
  var _Resource_rid;
  var SERIALIZE_TO_IPC_FN = "__TAURI_TO_IPC_KEY__";
  function transformCallback(callback, once = false) {
    return window.__TAURI_INTERNALS__.transformCallback(callback, once);
  }
  var Channel = class {
    constructor(onmessage) {
      _Channel_onmessage.set(this, void 0);
      _Channel_nextMessageIndex.set(this, 0);
      _Channel_pendingMessages.set(this, []);
      _Channel_messageEndIndex.set(this, void 0);
      __classPrivateFieldSet(this, _Channel_onmessage, onmessage || (() => {
      }), "f");
      this.id = transformCallback((rawMessage) => {
        const index = rawMessage.index;
        if ("end" in rawMessage) {
          if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
            this.cleanupCallback();
          } else {
            __classPrivateFieldSet(this, _Channel_messageEndIndex, index, "f");
          }
          return;
        }
        const message = rawMessage.message;
        if (index == __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")) {
          __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message);
          __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
          while (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") in __classPrivateFieldGet(this, _Channel_pendingMessages, "f")) {
            const message2 = __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
            __classPrivateFieldGet(this, _Channel_onmessage, "f").call(this, message2);
            delete __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f")];
            __classPrivateFieldSet(this, _Channel_nextMessageIndex, __classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") + 1, "f");
          }
          if (__classPrivateFieldGet(this, _Channel_nextMessageIndex, "f") === __classPrivateFieldGet(this, _Channel_messageEndIndex, "f")) {
            this.cleanupCallback();
          }
        } else {
          __classPrivateFieldGet(this, _Channel_pendingMessages, "f")[index] = message;
        }
      });
    }
    cleanupCallback() {
      window.__TAURI_INTERNALS__.unregisterCallback(this.id);
    }
    set onmessage(handler) {
      __classPrivateFieldSet(this, _Channel_onmessage, handler, "f");
    }
    get onmessage() {
      return __classPrivateFieldGet(this, _Channel_onmessage, "f");
    }
    [(_Channel_onmessage = /* @__PURE__ */ new WeakMap(), _Channel_nextMessageIndex = /* @__PURE__ */ new WeakMap(), _Channel_pendingMessages = /* @__PURE__ */ new WeakMap(), _Channel_messageEndIndex = /* @__PURE__ */ new WeakMap(), SERIALIZE_TO_IPC_FN)]() {
      return `__CHANNEL__:${this.id}`;
    }
    toJSON() {
      return this[SERIALIZE_TO_IPC_FN]();
    }
  };
  _Resource_rid = /* @__PURE__ */ new WeakMap();

  // node_modules/@tauri-apps/api/path.js
  var BaseDirectory;
  (function(BaseDirectory2) {
    BaseDirectory2[BaseDirectory2["Audio"] = 1] = "Audio";
    BaseDirectory2[BaseDirectory2["Cache"] = 2] = "Cache";
    BaseDirectory2[BaseDirectory2["Config"] = 3] = "Config";
    BaseDirectory2[BaseDirectory2["Data"] = 4] = "Data";
    BaseDirectory2[BaseDirectory2["LocalData"] = 5] = "LocalData";
    BaseDirectory2[BaseDirectory2["Document"] = 6] = "Document";
    BaseDirectory2[BaseDirectory2["Download"] = 7] = "Download";
    BaseDirectory2[BaseDirectory2["Picture"] = 8] = "Picture";
    BaseDirectory2[BaseDirectory2["Public"] = 9] = "Public";
    BaseDirectory2[BaseDirectory2["Video"] = 10] = "Video";
    BaseDirectory2[BaseDirectory2["Resource"] = 11] = "Resource";
    BaseDirectory2[BaseDirectory2["Temp"] = 12] = "Temp";
    BaseDirectory2[BaseDirectory2["AppConfig"] = 13] = "AppConfig";
    BaseDirectory2[BaseDirectory2["AppData"] = 14] = "AppData";
    BaseDirectory2[BaseDirectory2["AppLocalData"] = 15] = "AppLocalData";
    BaseDirectory2[BaseDirectory2["AppCache"] = 16] = "AppCache";
    BaseDirectory2[BaseDirectory2["AppLog"] = 17] = "AppLog";
    BaseDirectory2[BaseDirectory2["Desktop"] = 18] = "Desktop";
    BaseDirectory2[BaseDirectory2["Executable"] = 19] = "Executable";
    BaseDirectory2[BaseDirectory2["Font"] = 20] = "Font";
    BaseDirectory2[BaseDirectory2["Home"] = 21] = "Home";
    BaseDirectory2[BaseDirectory2["Runtime"] = 22] = "Runtime";
    BaseDirectory2[BaseDirectory2["Template"] = 23] = "Template";
  })(BaseDirectory || (BaseDirectory = {}));

  // node_modules/@tauri-apps/plugin-fs/dist-js/index.js
  var SeekMode;
  (function(SeekMode2) {
    SeekMode2[SeekMode2["Start"] = 0] = "Start";
    SeekMode2[SeekMode2["Current"] = 1] = "Current";
    SeekMode2[SeekMode2["End"] = 2] = "End";
  })(SeekMode || (SeekMode = {}));

  // src/art/bake.ts
  function isTauri() {
    return typeof window !== "undefined" && window["__TAURI_INTERNALS__"] !== void 0;
  }
  var diskEnabled = isTauri();
  var bakeSamples = [];
  if (typeof location !== "undefined" && /[?&](fx|bakeprof)=/.test(location.search)) {
    globalThis["__bakeProfile"] = bakeSamples;
  }

  // node_modules/svg-path-properties/dist/svg-path-properties.esm.js
  function t(t3, n2) {
    for (var e2 = 0; e2 < n2.length; e2++) {
      var i2 = n2[e2];
      i2.enumerable = i2.enumerable || false, i2.configurable = true, "value" in i2 && (i2.writable = true), Object.defineProperty(t3, h(i2.key), i2);
    }
  }
  function n(n2, e2, i2) {
    return e2 && t(n2.prototype, e2), i2 && t(n2, i2), Object.defineProperty(n2, "prototype", { writable: false }), n2;
  }
  function e(t3, n2, e2) {
    return (n2 = h(n2)) in t3 ? Object.defineProperty(t3, n2, { value: e2, enumerable: true, configurable: true, writable: true }) : t3[n2] = e2, t3;
  }
  function i(t3) {
    return (function(t4) {
      if (Array.isArray(t4)) return r(t4);
    })(t3) || (function(t4) {
      if ("undefined" != typeof Symbol && null != t4[Symbol.iterator] || null != t4["@@iterator"]) return Array.from(t4);
    })(t3) || (function(t4, n2) {
      if (!t4) return;
      if ("string" == typeof t4) return r(t4, n2);
      var e2 = Object.prototype.toString.call(t4).slice(8, -1);
      "Object" === e2 && t4.constructor && (e2 = t4.constructor.name);
      if ("Map" === e2 || "Set" === e2) return Array.from(t4);
      if ("Arguments" === e2 || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(e2)) return r(t4, n2);
    })(t3) || (function() {
      throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
    })();
  }
  function r(t3, n2) {
    (null == n2 || n2 > t3.length) && (n2 = t3.length);
    for (var e2 = 0, i2 = new Array(n2); e2 < n2; e2++) i2[e2] = t3[e2];
    return i2;
  }
  function h(t3) {
    var n2 = (function(t4, n3) {
      if ("object" != typeof t4 || null === t4) return t4;
      var e2 = t4[Symbol.toPrimitive];
      if (void 0 !== e2) {
        var i2 = e2.call(t4, n3 || "default");
        if ("object" != typeof i2) return i2;
        throw new TypeError("@@toPrimitive must return a primitive value.");
      }
      return ("string" === n3 ? String : Number)(t4);
    })(t3, "string");
    return "symbol" == typeof n2 ? n2 : String(n2);
  }
  var a = { a: 7, c: 6, h: 1, l: 2, m: 2, q: 4, s: 4, t: 2, v: 1, z: 0 };
  var s = /([astvzqmhlc])([^astvzqmhlc]*)/gi;
  var o = /-?[0-9]*\.?[0-9]+(?:e[-+]?\d+)?/gi;
  var g = function(t3) {
    var n2 = t3.match(o);
    return n2 ? n2.map(Number) : [];
  };
  var u = n((function(t3, n2, i2, r2) {
    var h2 = this;
    e(this, "x0", void 0), e(this, "x1", void 0), e(this, "y0", void 0), e(this, "y1", void 0), e(this, "getTotalLength", (function() {
      return Math.sqrt(Math.pow(h2.x0 - h2.x1, 2) + Math.pow(h2.y0 - h2.y1, 2));
    })), e(this, "getPointAtLength", (function(t4) {
      var n3 = t4 / Math.sqrt(Math.pow(h2.x0 - h2.x1, 2) + Math.pow(h2.y0 - h2.y1, 2));
      n3 = Number.isNaN(n3) ? 1 : n3;
      var e2 = (h2.x1 - h2.x0) * n3, i3 = (h2.y1 - h2.y0) * n3;
      return { x: h2.x0 + e2, y: h2.y0 + i3 };
    })), e(this, "getTangentAtLength", (function(t4) {
      var n3 = Math.sqrt((h2.x1 - h2.x0) * (h2.x1 - h2.x0) + (h2.y1 - h2.y0) * (h2.y1 - h2.y0));
      return { x: (h2.x1 - h2.x0) / n3, y: (h2.y1 - h2.y0) / n3 };
    })), e(this, "getPropertiesAtLength", (function(t4) {
      var n3 = h2.getPointAtLength(t4), e2 = h2.getTangentAtLength(t4);
      return { x: n3.x, y: n3.y, tangentX: e2.x, tangentY: e2.y };
    })), this.x0 = t3, this.x1 = n2, this.y0 = i2, this.y1 = r2;
  }));
  var l = n((function(t3, n2, i2, r2, h2, a2, s2, o2, g2) {
    var u2 = this;
    e(this, "x0", void 0), e(this, "y0", void 0), e(this, "rx", void 0), e(this, "ry", void 0), e(this, "xAxisRotate", void 0), e(this, "LargeArcFlag", void 0), e(this, "SweepFlag", void 0), e(this, "x1", void 0), e(this, "y1", void 0), e(this, "length", void 0), e(this, "getTotalLength", (function() {
      return u2.length;
    })), e(this, "getPointAtLength", (function(t4) {
      t4 < 0 ? t4 = 0 : t4 > u2.length && (t4 = u2.length);
      var n3 = c({ x: u2.x0, y: u2.y0 }, u2.rx, u2.ry, u2.xAxisRotate, u2.LargeArcFlag, u2.SweepFlag, { x: u2.x1, y: u2.y1 }, t4 / u2.length);
      return { x: n3.x, y: n3.y };
    })), e(this, "getTangentAtLength", (function(t4) {
      t4 < 0 ? t4 = 0 : t4 > u2.length && (t4 = u2.length);
      var n3, e2 = 0.05, i3 = u2.getPointAtLength(t4);
      t4 < 0 ? t4 = 0 : t4 > u2.length && (t4 = u2.length);
      var r3 = (n3 = t4 < u2.length - e2 ? u2.getPointAtLength(t4 + e2) : u2.getPointAtLength(t4 - e2)).x - i3.x, h3 = n3.y - i3.y, a3 = Math.sqrt(r3 * r3 + h3 * h3);
      return t4 < u2.length - e2 ? { x: -r3 / a3, y: -h3 / a3 } : { x: r3 / a3, y: h3 / a3 };
    })), e(this, "getPropertiesAtLength", (function(t4) {
      var n3 = u2.getTangentAtLength(t4), e2 = u2.getPointAtLength(t4);
      return { x: e2.x, y: e2.y, tangentX: n3.x, tangentY: n3.y };
    })), this.x0 = t3, this.y0 = n2, this.rx = i2, this.ry = r2, this.xAxisRotate = h2, this.LargeArcFlag = a2, this.SweepFlag = s2, this.x1 = o2, this.y1 = g2;
    var l2 = f(300, (function(e2) {
      return c({ x: t3, y: n2 }, i2, r2, h2, a2, s2, { x: o2, y: g2 }, e2);
    }));
    this.length = l2.arcLength;
  }));
  var c = function(t3, n2, e2, i2, r2, h2, a2, s2) {
    n2 = Math.abs(n2), e2 = Math.abs(e2), i2 = y(i2, 360);
    var o2 = p(i2);
    if (t3.x === a2.x && t3.y === a2.y) return { x: t3.x, y: t3.y, ellipticalArcAngle: 0 };
    if (0 === n2 || 0 === e2) return { x: 0, y: 0, ellipticalArcAngle: 0 };
    var g2 = (t3.x - a2.x) / 2, u2 = (t3.y - a2.y) / 2, l2 = { x: Math.cos(o2) * g2 + Math.sin(o2) * u2, y: -Math.sin(o2) * g2 + Math.cos(o2) * u2 }, c2 = Math.pow(l2.x, 2) / Math.pow(n2, 2) + Math.pow(l2.y, 2) / Math.pow(e2, 2);
    c2 > 1 && (n2 = Math.sqrt(c2) * n2, e2 = Math.sqrt(c2) * e2);
    var f2 = (Math.pow(n2, 2) * Math.pow(e2, 2) - Math.pow(n2, 2) * Math.pow(l2.y, 2) - Math.pow(e2, 2) * Math.pow(l2.x, 2)) / (Math.pow(n2, 2) * Math.pow(l2.y, 2) + Math.pow(e2, 2) * Math.pow(l2.x, 2));
    f2 = f2 < 0 ? 0 : f2;
    var x2 = (r2 !== h2 ? 1 : -1) * Math.sqrt(f2), v2 = x2 * (n2 * l2.y / e2), w2 = x2 * (-e2 * l2.x / n2), L2 = { x: Math.cos(o2) * v2 - Math.sin(o2) * w2 + (t3.x + a2.x) / 2, y: Math.sin(o2) * v2 + Math.cos(o2) * w2 + (t3.y + a2.y) / 2 }, A2 = { x: (l2.x - v2) / n2, y: (l2.y - w2) / e2 }, d2 = M({ x: 1, y: 0 }, A2), b2 = M(A2, { x: (-l2.x - v2) / n2, y: (-l2.y - w2) / e2 });
    !h2 && b2 > 0 ? b2 -= 2 * Math.PI : h2 && b2 < 0 && (b2 += 2 * Math.PI);
    var m2 = d2 + (b2 %= 2 * Math.PI) * s2, P2 = n2 * Math.cos(m2), T2 = e2 * Math.sin(m2);
    return { x: Math.cos(o2) * P2 - Math.sin(o2) * T2 + L2.x, y: Math.sin(o2) * P2 + Math.cos(o2) * T2 + L2.y, ellipticalArcStartAngle: d2, ellipticalArcEndAngle: d2 + b2, ellipticalArcAngle: m2, ellipticalArcCenter: L2, resultantRx: n2, resultantRy: e2 };
  };
  var f = function(t3, n2) {
    t3 = t3 || 500;
    for (var e2, i2 = 0, r2 = [], h2 = [], a2 = n2(0), s2 = 0; s2 < t3; s2++) {
      var o2 = v(s2 * (1 / t3), 0, 1);
      e2 = n2(o2), i2 += x(a2, e2), h2.push([a2, e2]), r2.push({ t: o2, arcLength: i2 }), a2 = e2;
    }
    return e2 = n2(1), h2.push([a2, e2]), i2 += x(a2, e2), r2.push({ t: 1, arcLength: i2 }), { arcLength: i2, arcLengthMap: r2, approximationLines: h2 };
  };
  var y = function(t3, n2) {
    return (t3 % n2 + n2) % n2;
  };
  var p = function(t3) {
    return t3 * (Math.PI / 180);
  };
  var x = function(t3, n2) {
    return Math.sqrt(Math.pow(n2.x - t3.x, 2) + Math.pow(n2.y - t3.y, 2));
  };
  var v = function(t3, n2, e2) {
    return Math.min(Math.max(t3, n2), e2);
  };
  var M = function(t3, n2) {
    var e2 = t3.x * n2.x + t3.y * n2.y, i2 = Math.sqrt((Math.pow(t3.x, 2) + Math.pow(t3.y, 2)) * (Math.pow(n2.x, 2) + Math.pow(n2.y, 2)));
    return (t3.x * n2.y - t3.y * n2.x < 0 ? -1 : 1) * Math.acos(e2 / i2);
  };
  var w = [[], [], [-0.5773502691896257, 0.5773502691896257], [0, -0.7745966692414834, 0.7745966692414834], [-0.33998104358485626, 0.33998104358485626, -0.8611363115940526, 0.8611363115940526], [0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664], [0.6612093864662645, -0.6612093864662645, -0.2386191860831969, 0.2386191860831969, -0.932469514203152, 0.932469514203152], [0, 0.4058451513773972, -0.4058451513773972, -0.7415311855993945, 0.7415311855993945, -0.9491079123427585, 0.9491079123427585], [-0.1834346424956498, 0.1834346424956498, -0.525532409916329, 0.525532409916329, -0.7966664774136267, 0.7966664774136267, -0.9602898564975363, 0.9602898564975363], [0, -0.8360311073266358, 0.8360311073266358, -0.9681602395076261, 0.9681602395076261, -0.3242534234038089, 0.3242534234038089, -0.6133714327005904, 0.6133714327005904], [-0.14887433898163122, 0.14887433898163122, -0.4333953941292472, 0.4333953941292472, -0.6794095682990244, 0.6794095682990244, -0.8650633666889845, 0.8650633666889845, -0.9739065285171717, 0.9739065285171717], [0, -0.26954315595234496, 0.26954315595234496, -0.5190961292068118, 0.5190961292068118, -0.7301520055740494, 0.7301520055740494, -0.8870625997680953, 0.8870625997680953, -0.978228658146057, 0.978228658146057], [-0.1252334085114689, 0.1252334085114689, -0.3678314989981802, 0.3678314989981802, -0.5873179542866175, 0.5873179542866175, -0.7699026741943047, 0.7699026741943047, -0.9041172563704749, 0.9041172563704749, -0.9815606342467192, 0.9815606342467192], [0, -0.2304583159551348, 0.2304583159551348, -0.44849275103644687, 0.44849275103644687, -0.6423493394403402, 0.6423493394403402, -0.8015780907333099, 0.8015780907333099, -0.9175983992229779, 0.9175983992229779, -0.9841830547185881, 0.9841830547185881], [-0.10805494870734367, 0.10805494870734367, -0.31911236892788974, 0.31911236892788974, -0.5152486363581541, 0.5152486363581541, -0.6872929048116855, 0.6872929048116855, -0.827201315069765, 0.827201315069765, -0.9284348836635735, 0.9284348836635735, -0.9862838086968123, 0.9862838086968123], [0, -0.20119409399743451, 0.20119409399743451, -0.3941513470775634, 0.3941513470775634, -0.5709721726085388, 0.5709721726085388, -0.7244177313601701, 0.7244177313601701, -0.8482065834104272, 0.8482065834104272, -0.937273392400706, 0.937273392400706, -0.9879925180204854, 0.9879925180204854], [-0.09501250983763744, 0.09501250983763744, -0.2816035507792589, 0.2816035507792589, -0.45801677765722737, 0.45801677765722737, -0.6178762444026438, 0.6178762444026438, -0.755404408355003, 0.755404408355003, -0.8656312023878318, 0.8656312023878318, -0.9445750230732326, 0.9445750230732326, -0.9894009349916499, 0.9894009349916499], [0, -0.17848418149584785, 0.17848418149584785, -0.3512317634538763, 0.3512317634538763, -0.5126905370864769, 0.5126905370864769, -0.6576711592166907, 0.6576711592166907, -0.7815140038968014, 0.7815140038968014, -0.8802391537269859, 0.8802391537269859, -0.9506755217687678, 0.9506755217687678, -0.9905754753144174, 0.9905754753144174], [-0.0847750130417353, 0.0847750130417353, -0.2518862256915055, 0.2518862256915055, -0.41175116146284263, 0.41175116146284263, -0.5597708310739475, 0.5597708310739475, -0.6916870430603532, 0.6916870430603532, -0.8037049589725231, 0.8037049589725231, -0.8926024664975557, 0.8926024664975557, -0.9558239495713977, 0.9558239495713977, -0.9915651684209309, 0.9915651684209309], [0, -0.16035864564022537, 0.16035864564022537, -0.31656409996362983, 0.31656409996362983, -0.46457074137596094, 0.46457074137596094, -0.600545304661681, 0.600545304661681, -0.7209661773352294, 0.7209661773352294, -0.8227146565371428, 0.8227146565371428, -0.9031559036148179, 0.9031559036148179, -0.96020815213483, 0.96020815213483, -0.9924068438435844, 0.9924068438435844], [-0.07652652113349734, 0.07652652113349734, -0.22778585114164507, 0.22778585114164507, -0.37370608871541955, 0.37370608871541955, -0.5108670019508271, 0.5108670019508271, -0.636053680726515, 0.636053680726515, -0.7463319064601508, 0.7463319064601508, -0.8391169718222188, 0.8391169718222188, -0.912234428251326, 0.912234428251326, -0.9639719272779138, 0.9639719272779138, -0.9931285991850949, 0.9931285991850949], [0, -0.1455618541608951, 0.1455618541608951, -0.2880213168024011, 0.2880213168024011, -0.4243421202074388, 0.4243421202074388, -0.5516188358872198, 0.5516188358872198, -0.6671388041974123, 0.6671388041974123, -0.7684399634756779, 0.7684399634756779, -0.8533633645833173, 0.8533633645833173, -0.9200993341504008, 0.9200993341504008, -0.9672268385663063, 0.9672268385663063, -0.9937521706203895, 0.9937521706203895], [-0.06973927331972223, 0.06973927331972223, -0.20786042668822127, 0.20786042668822127, -0.34193582089208424, 0.34193582089208424, -0.469355837986757, 0.469355837986757, -0.5876404035069116, 0.5876404035069116, -0.6944872631866827, 0.6944872631866827, -0.7878168059792081, 0.7878168059792081, -0.8658125777203002, 0.8658125777203002, -0.926956772187174, 0.926956772187174, -0.9700604978354287, 0.9700604978354287, -0.9942945854823992, 0.9942945854823992], [0, -0.1332568242984661, 0.1332568242984661, -0.26413568097034495, 0.26413568097034495, -0.3903010380302908, 0.3903010380302908, -0.5095014778460075, 0.5095014778460075, -0.6196098757636461, 0.6196098757636461, -0.7186613631319502, 0.7186613631319502, -0.8048884016188399, 0.8048884016188399, -0.8767523582704416, 0.8767523582704416, -0.9329710868260161, 0.9329710868260161, -0.9725424712181152, 0.9725424712181152, -0.9947693349975522, 0.9947693349975522], [-0.06405689286260563, 0.06405689286260563, -0.1911188674736163, 0.1911188674736163, -0.3150426796961634, 0.3150426796961634, -0.4337935076260451, 0.4337935076260451, -0.5454214713888396, 0.5454214713888396, -0.6480936519369755, 0.6480936519369755, -0.7401241915785544, 0.7401241915785544, -0.820001985973903, 0.820001985973903, -0.8864155270044011, 0.8864155270044011, -0.9382745520027328, 0.9382745520027328, -0.9747285559713095, 0.9747285559713095, -0.9951872199970213, 0.9951872199970213]];
  var L = [[], [], [1, 1], [0.8888888888888888, 0.5555555555555556, 0.5555555555555556], [0.6521451548625461, 0.6521451548625461, 0.34785484513745385, 0.34785484513745385], [0.5688888888888889, 0.47862867049936647, 0.47862867049936647, 0.23692688505618908, 0.23692688505618908], [0.3607615730481386, 0.3607615730481386, 0.46791393457269104, 0.46791393457269104, 0.17132449237917036, 0.17132449237917036], [0.4179591836734694, 0.3818300505051189, 0.3818300505051189, 0.27970539148927664, 0.27970539148927664, 0.1294849661688697, 0.1294849661688697], [0.362683783378362, 0.362683783378362, 0.31370664587788727, 0.31370664587788727, 0.22238103445337448, 0.22238103445337448, 0.10122853629037626, 0.10122853629037626], [0.3302393550012598, 0.1806481606948574, 0.1806481606948574, 0.08127438836157441, 0.08127438836157441, 0.31234707704000286, 0.31234707704000286, 0.26061069640293544, 0.26061069640293544], [0.29552422471475287, 0.29552422471475287, 0.26926671930999635, 0.26926671930999635, 0.21908636251598204, 0.21908636251598204, 0.1494513491505806, 0.1494513491505806, 0.06667134430868814, 0.06667134430868814], [0.2729250867779006, 0.26280454451024665, 0.26280454451024665, 0.23319376459199048, 0.23319376459199048, 0.18629021092773426, 0.18629021092773426, 0.1255803694649046, 0.1255803694649046, 0.05566856711617366, 0.05566856711617366], [0.24914704581340277, 0.24914704581340277, 0.2334925365383548, 0.2334925365383548, 0.20316742672306592, 0.20316742672306592, 0.16007832854334622, 0.16007832854334622, 0.10693932599531843, 0.10693932599531843, 0.04717533638651183, 0.04717533638651183], [0.2325515532308739, 0.22628318026289723, 0.22628318026289723, 0.2078160475368885, 0.2078160475368885, 0.17814598076194574, 0.17814598076194574, 0.13887351021978725, 0.13887351021978725, 0.09212149983772845, 0.09212149983772845, 0.04048400476531588, 0.04048400476531588], [0.2152638534631578, 0.2152638534631578, 0.2051984637212956, 0.2051984637212956, 0.18553839747793782, 0.18553839747793782, 0.15720316715819355, 0.15720316715819355, 0.12151857068790319, 0.12151857068790319, 0.08015808715976021, 0.08015808715976021, 0.03511946033175186, 0.03511946033175186], [0.2025782419255613, 0.19843148532711158, 0.19843148532711158, 0.1861610000155622, 0.1861610000155622, 0.16626920581699392, 0.16626920581699392, 0.13957067792615432, 0.13957067792615432, 0.10715922046717194, 0.10715922046717194, 0.07036604748810812, 0.07036604748810812, 0.03075324199611727, 0.03075324199611727], [0.1894506104550685, 0.1894506104550685, 0.18260341504492358, 0.18260341504492358, 0.16915651939500254, 0.16915651939500254, 0.14959598881657674, 0.14959598881657674, 0.12462897125553388, 0.12462897125553388, 0.09515851168249279, 0.09515851168249279, 0.062253523938647894, 0.062253523938647894, 0.027152459411754096, 0.027152459411754096], [0.17944647035620653, 0.17656270536699264, 0.17656270536699264, 0.16800410215645004, 0.16800410215645004, 0.15404576107681028, 0.15404576107681028, 0.13513636846852548, 0.13513636846852548, 0.11188384719340397, 0.11188384719340397, 0.08503614831717918, 0.08503614831717918, 0.0554595293739872, 0.0554595293739872, 0.02414830286854793, 0.02414830286854793], [0.1691423829631436, 0.1691423829631436, 0.16427648374583273, 0.16427648374583273, 0.15468467512626524, 0.15468467512626524, 0.14064291467065065, 0.14064291467065065, 0.12255520671147846, 0.12255520671147846, 0.10094204410628717, 0.10094204410628717, 0.07642573025488905, 0.07642573025488905, 0.0497145488949698, 0.0497145488949698, 0.02161601352648331, 0.02161601352648331], [0.1610544498487837, 0.15896884339395434, 0.15896884339395434, 0.15276604206585967, 0.15276604206585967, 0.1426067021736066, 0.1426067021736066, 0.12875396253933621, 0.12875396253933621, 0.11156664554733399, 0.11156664554733399, 0.09149002162245, 0.09149002162245, 0.06904454273764123, 0.06904454273764123, 0.0448142267656996, 0.0448142267656996, 0.019461788229726478, 0.019461788229726478], [0.15275338713072584, 0.15275338713072584, 0.14917298647260374, 0.14917298647260374, 0.14209610931838204, 0.14209610931838204, 0.13168863844917664, 0.13168863844917664, 0.11819453196151841, 0.11819453196151841, 0.10193011981724044, 0.10193011981724044, 0.08327674157670475, 0.08327674157670475, 0.06267204833410907, 0.06267204833410907, 0.04060142980038694, 0.04060142980038694, 0.017614007139152118, 0.017614007139152118], [0.14608113364969041, 0.14452440398997005, 0.14452440398997005, 0.13988739479107315, 0.13988739479107315, 0.13226893863333747, 0.13226893863333747, 0.12183141605372853, 0.12183141605372853, 0.10879729916714838, 0.10879729916714838, 0.09344442345603386, 0.09344442345603386, 0.0761001136283793, 0.0761001136283793, 0.057134425426857205, 0.057134425426857205, 0.036953789770852494, 0.036953789770852494, 0.016017228257774335, 0.016017228257774335], [0.13925187285563198, 0.13925187285563198, 0.13654149834601517, 0.13654149834601517, 0.13117350478706238, 0.13117350478706238, 0.12325237681051242, 0.12325237681051242, 0.11293229608053922, 0.11293229608053922, 0.10041414444288096, 0.10041414444288096, 0.08594160621706773, 0.08594160621706773, 0.06979646842452049, 0.06979646842452049, 0.052293335152683286, 0.052293335152683286, 0.03377490158481415, 0.03377490158481415, 0.0146279952982722, 0.0146279952982722], [0.13365457218610619, 0.1324620394046966, 0.1324620394046966, 0.12890572218808216, 0.12890572218808216, 0.12304908430672953, 0.12304908430672953, 0.11499664022241136, 0.11499664022241136, 0.10489209146454141, 0.10489209146454141, 0.09291576606003515, 0.09291576606003515, 0.07928141177671895, 0.07928141177671895, 0.06423242140852585, 0.06423242140852585, 0.04803767173108467, 0.04803767173108467, 0.030988005856979445, 0.030988005856979445, 0.013411859487141771, 0.013411859487141771], [0.12793819534675216, 0.12793819534675216, 0.1258374563468283, 0.1258374563468283, 0.12167047292780339, 0.12167047292780339, 0.1155056680537256, 0.1155056680537256, 0.10744427011596563, 0.10744427011596563, 0.09761865210411388, 0.09761865210411388, 0.08619016153195327, 0.08619016153195327, 0.0733464814110803, 0.0733464814110803, 0.05929858491543678, 0.05929858491543678, 0.04427743881741981, 0.04427743881741981, 0.028531388628933663, 0.028531388628933663, 0.0123412297999872, 0.0123412297999872]];
  var A = [[1], [1, 1], [1, 2, 1], [1, 3, 3, 1]];
  var d = function(t3, n2, e2) {
    return { x: (1 - e2) * (1 - e2) * (1 - e2) * t3[0] + 3 * (1 - e2) * (1 - e2) * e2 * t3[1] + 3 * (1 - e2) * e2 * e2 * t3[2] + e2 * e2 * e2 * t3[3], y: (1 - e2) * (1 - e2) * (1 - e2) * n2[0] + 3 * (1 - e2) * (1 - e2) * e2 * n2[1] + 3 * (1 - e2) * e2 * e2 * n2[2] + e2 * e2 * e2 * n2[3] };
  };
  var b = function(t3, n2, e2) {
    return P([3 * (t3[1] - t3[0]), 3 * (t3[2] - t3[1]), 3 * (t3[3] - t3[2])], [3 * (n2[1] - n2[0]), 3 * (n2[2] - n2[1]), 3 * (n2[3] - n2[2])], e2);
  };
  var m = function(t3, n2, e2) {
    var i2, r2, h2;
    i2 = e2 / 2, r2 = 0;
    for (var a2 = 0; a2 < 20; a2++) h2 = i2 * w[20][a2] + i2, r2 += L[20][a2] * _(t3, n2, h2);
    return i2 * r2;
  };
  var P = function(t3, n2, e2) {
    return { x: (1 - e2) * (1 - e2) * t3[0] + 2 * (1 - e2) * e2 * t3[1] + e2 * e2 * t3[2], y: (1 - e2) * (1 - e2) * n2[0] + 2 * (1 - e2) * e2 * n2[1] + e2 * e2 * n2[2] };
  };
  var T = function(t3, n2, e2) {
    void 0 === e2 && (e2 = 1);
    var i2 = t3[0] - 2 * t3[1] + t3[2], r2 = n2[0] - 2 * n2[1] + n2[2], h2 = 2 * t3[1] - 2 * t3[0], a2 = 2 * n2[1] - 2 * n2[0], s2 = 4 * (i2 * i2 + r2 * r2), o2 = 4 * (i2 * h2 + r2 * a2), g2 = h2 * h2 + a2 * a2;
    if (0 === s2) return e2 * Math.sqrt(Math.pow(t3[2] - t3[0], 2) + Math.pow(n2[2] - n2[0], 2));
    var u2 = o2 / (2 * s2), l2 = e2 + u2, c2 = g2 / s2 - u2 * u2, f2 = l2 * l2 + c2 > 0 ? Math.sqrt(l2 * l2 + c2) : 0, y2 = u2 * u2 + c2 > 0 ? Math.sqrt(u2 * u2 + c2) : 0, p2 = u2 + Math.sqrt(u2 * u2 + c2) !== 0 && (l2 + f2) / (u2 + y2) != 0 ? c2 * Math.log(Math.abs((l2 + f2) / (u2 + y2))) : 0;
    return Math.sqrt(s2) / 2 * (l2 * f2 - u2 * y2 + p2);
  };
  var q = function(t3, n2, e2) {
    return { x: 2 * (1 - e2) * (t3[1] - t3[0]) + 2 * e2 * (t3[2] - t3[1]), y: 2 * (1 - e2) * (n2[1] - n2[0]) + 2 * e2 * (n2[2] - n2[1]) };
  };
  function _(t3, n2, e2) {
    var i2 = S(1, e2, t3), r2 = S(1, e2, n2), h2 = i2 * i2 + r2 * r2;
    return Math.sqrt(h2);
  }
  var S = function t2(n2, e2, i2) {
    var r2, h2, a2 = i2.length - 1;
    if (0 === a2) return 0;
    if (0 === n2) {
      h2 = 0;
      for (var s2 = 0; s2 <= a2; s2++) h2 += A[a2][s2] * Math.pow(1 - e2, a2 - s2) * Math.pow(e2, s2) * i2[s2];
      return h2;
    }
    r2 = new Array(a2);
    for (var o2 = 0; o2 < a2; o2++) r2[o2] = a2 * (i2[o2 + 1] - i2[o2]);
    return t2(n2 - 1, e2, r2);
  };
  var N = function(t3, n2, e2) {
    for (var i2 = 1, r2 = t3 / n2, h2 = (t3 - e2(r2)) / n2, a2 = 0; i2 > 1e-3; ) {
      var s2 = e2(r2 + h2), o2 = Math.abs(t3 - s2) / n2;
      if (o2 < i2) i2 = o2, r2 += h2;
      else {
        var g2 = e2(r2 - h2), u2 = Math.abs(t3 - g2) / n2;
        u2 < i2 ? (i2 = u2, r2 -= h2) : h2 /= 2;
      }
      if (++a2 > 500) break;
    }
    return r2;
  };
  var C = n((function(t3, n2, i2, r2, h2, a2, s2, o2) {
    var g2 = this;
    e(this, "a", void 0), e(this, "b", void 0), e(this, "c", void 0), e(this, "d", void 0), e(this, "length", void 0), e(this, "getArcLength", void 0), e(this, "getPoint", void 0), e(this, "getDerivative", void 0), e(this, "getTotalLength", (function() {
      return g2.length;
    })), e(this, "getPointAtLength", (function(t4) {
      var n3 = [g2.a.x, g2.b.x, g2.c.x, g2.d.x], e2 = [g2.a.y, g2.b.y, g2.c.y, g2.d.y], i3 = N(t4, g2.length, (function(t5) {
        return g2.getArcLength(n3, e2, t5);
      }));
      return g2.getPoint(n3, e2, i3);
    })), e(this, "getTangentAtLength", (function(t4) {
      var n3 = [g2.a.x, g2.b.x, g2.c.x, g2.d.x], e2 = [g2.a.y, g2.b.y, g2.c.y, g2.d.y], i3 = N(t4, g2.length, (function(t5) {
        return g2.getArcLength(n3, e2, t5);
      })), r3 = g2.getDerivative(n3, e2, i3), h3 = Math.sqrt(r3.x * r3.x + r3.y * r3.y);
      return h3 > 0 ? { x: r3.x / h3, y: r3.y / h3 } : { x: 0, y: 0 };
    })), e(this, "getPropertiesAtLength", (function(t4) {
      var n3, e2 = [g2.a.x, g2.b.x, g2.c.x, g2.d.x], i3 = [g2.a.y, g2.b.y, g2.c.y, g2.d.y], r3 = N(t4, g2.length, (function(t5) {
        return g2.getArcLength(e2, i3, t5);
      })), h3 = g2.getDerivative(e2, i3, r3), a3 = Math.sqrt(h3.x * h3.x + h3.y * h3.y);
      n3 = a3 > 0 ? { x: h3.x / a3, y: h3.y / a3 } : { x: 0, y: 0 };
      var s3 = g2.getPoint(e2, i3, r3);
      return { x: s3.x, y: s3.y, tangentX: n3.x, tangentY: n3.y };
    })), e(this, "getC", (function() {
      return g2.c;
    })), e(this, "getD", (function() {
      return g2.d;
    })), this.a = { x: t3, y: n2 }, this.b = { x: i2, y: r2 }, this.c = { x: h2, y: a2 }, void 0 !== s2 && void 0 !== o2 ? (this.getArcLength = m, this.getPoint = d, this.getDerivative = b, this.d = { x: s2, y: o2 }) : (this.getArcLength = T, this.getPoint = P, this.getDerivative = q, this.d = { x: 0, y: 0 }), this.length = this.getArcLength([this.a.x, this.b.x, this.c.x, this.d.x], [this.a.y, this.b.y, this.c.y, this.d.y], 1);
  }));
  var O = n((function(t3) {
    var n2 = this;
    e(this, "length", 0), e(this, "partial_lengths", []), e(this, "functions", []), e(this, "initial_point", null), e(this, "getPartAtLength", (function(t4) {
      t4 < 0 ? t4 = 0 : t4 > n2.length && (t4 = n2.length);
      for (var e2 = n2.partial_lengths.length - 1; n2.partial_lengths[e2] >= t4 && e2 > 0; ) e2--;
      return e2++, { fraction: t4 - n2.partial_lengths[e2 - 1], i: e2 };
    })), e(this, "getTotalLength", (function() {
      return n2.length;
    })), e(this, "getPointAtLength", (function(t4) {
      var e2 = n2.getPartAtLength(t4), i2 = n2.functions[e2.i];
      if (i2) return i2.getPointAtLength(e2.fraction);
      if (n2.initial_point) return n2.initial_point;
      throw new Error("Wrong function at this part.");
    })), e(this, "getTangentAtLength", (function(t4) {
      var e2 = n2.getPartAtLength(t4), i2 = n2.functions[e2.i];
      if (i2) return i2.getTangentAtLength(e2.fraction);
      if (n2.initial_point) return { x: 0, y: 0 };
      throw new Error("Wrong function at this part.");
    })), e(this, "getPropertiesAtLength", (function(t4) {
      var e2 = n2.getPartAtLength(t4), i2 = n2.functions[e2.i];
      if (i2) return i2.getPropertiesAtLength(e2.fraction);
      if (n2.initial_point) return { x: n2.initial_point.x, y: n2.initial_point.y, tangentX: 0, tangentY: 0 };
      throw new Error("Wrong function at this part.");
    })), e(this, "getParts", (function() {
      for (var t4 = [], e2 = 0; e2 < n2.functions.length; e2++) if (null !== n2.functions[e2]) {
        n2.functions[e2] = n2.functions[e2];
        var i2 = { start: n2.functions[e2].getPointAtLength(0), end: n2.functions[e2].getPointAtLength(n2.partial_lengths[e2] - n2.partial_lengths[e2 - 1]), length: n2.partial_lengths[e2] - n2.partial_lengths[e2 - 1], getPointAtLength: n2.functions[e2].getPointAtLength, getTangentAtLength: n2.functions[e2].getTangentAtLength, getPropertiesAtLength: n2.functions[e2].getPropertiesAtLength };
        t4.push(i2);
      }
      return t4;
    }));
    for (var r2, h2 = Array.isArray(t3) ? t3 : (function(t4) {
      var n3 = (t4 && t4.length > 0 ? t4 : "M0,0").match(s);
      if (!n3) throw new Error("No path elements found in string ".concat(t4));
      return n3.reduce((function(t5, n4) {
        var e2 = n4.charAt(0), r3 = e2.toLowerCase(), h3 = g(n4.substring(1));
        if ("m" === r3 && h3.length > 2 && (t5.push([e2].concat(i(h3.splice(0, 2)))), r3 = "l", e2 = "m" === e2 ? "l" : "L"), "a" === r3.toLowerCase() && (5 === h3.length || 6 === h3.length)) {
          var s2 = n4.substring(1).trim().split(" ");
          h3 = [Number(s2[0]), Number(s2[1]), Number(s2[2]), Number(s2[3].charAt(0)), Number(s2[3].charAt(1)), Number(s2[3].substring(2)), Number(s2[4])];
        }
        for (; h3.length >= 0; ) {
          if (h3.length === a[r3]) {
            t5.push([e2].concat(i(h3.splice(0, a[r3]))));
            break;
          }
          if (h3.length < a[r3]) throw new Error('Malformed path data: "'.concat(e2, '" must have ').concat(a[r3], " elements and has ").concat(h3.length, ": ").concat(n4));
          t5.push([e2].concat(i(h3.splice(0, a[r3]))));
        }
        return t5;
      }), []);
    })(t3), o2 = [0, 0], c2 = [0, 0], f2 = [0, 0], y2 = 0; y2 < h2.length; y2++) {
      if ("M" === h2[y2][0]) f2 = [(o2 = [h2[y2][1], h2[y2][2]])[0], o2[1]], this.functions.push(null), 0 === y2 && (this.initial_point = { x: h2[y2][1], y: h2[y2][2] });
      else if ("m" === h2[y2][0]) f2 = [(o2 = [h2[y2][1] + o2[0], h2[y2][2] + o2[1]])[0], o2[1]], this.functions.push(null);
      else if ("L" === h2[y2][0]) this.length += Math.sqrt(Math.pow(o2[0] - h2[y2][1], 2) + Math.pow(o2[1] - h2[y2][2], 2)), this.functions.push(new u(o2[0], h2[y2][1], o2[1], h2[y2][2])), o2 = [h2[y2][1], h2[y2][2]];
      else if ("l" === h2[y2][0]) this.length += Math.sqrt(Math.pow(h2[y2][1], 2) + Math.pow(h2[y2][2], 2)), this.functions.push(new u(o2[0], h2[y2][1] + o2[0], o2[1], h2[y2][2] + o2[1])), o2 = [h2[y2][1] + o2[0], h2[y2][2] + o2[1]];
      else if ("H" === h2[y2][0]) this.length += Math.abs(o2[0] - h2[y2][1]), this.functions.push(new u(o2[0], h2[y2][1], o2[1], o2[1])), o2[0] = h2[y2][1];
      else if ("h" === h2[y2][0]) this.length += Math.abs(h2[y2][1]), this.functions.push(new u(o2[0], o2[0] + h2[y2][1], o2[1], o2[1])), o2[0] = h2[y2][1] + o2[0];
      else if ("V" === h2[y2][0]) this.length += Math.abs(o2[1] - h2[y2][1]), this.functions.push(new u(o2[0], o2[0], o2[1], h2[y2][1])), o2[1] = h2[y2][1];
      else if ("v" === h2[y2][0]) this.length += Math.abs(h2[y2][1]), this.functions.push(new u(o2[0], o2[0], o2[1], o2[1] + h2[y2][1])), o2[1] = h2[y2][1] + o2[1];
      else if ("z" === h2[y2][0] || "Z" === h2[y2][0]) this.length += Math.sqrt(Math.pow(f2[0] - o2[0], 2) + Math.pow(f2[1] - o2[1], 2)), this.functions.push(new u(o2[0], f2[0], o2[1], f2[1])), o2 = [f2[0], f2[1]];
      else if ("C" === h2[y2][0]) r2 = new C(o2[0], o2[1], h2[y2][1], h2[y2][2], h2[y2][3], h2[y2][4], h2[y2][5], h2[y2][6]), this.length += r2.getTotalLength(), o2 = [h2[y2][5], h2[y2][6]], this.functions.push(r2);
      else if ("c" === h2[y2][0]) (r2 = new C(o2[0], o2[1], o2[0] + h2[y2][1], o2[1] + h2[y2][2], o2[0] + h2[y2][3], o2[1] + h2[y2][4], o2[0] + h2[y2][5], o2[1] + h2[y2][6])).getTotalLength() > 0 ? (this.length += r2.getTotalLength(), this.functions.push(r2), o2 = [h2[y2][5] + o2[0], h2[y2][6] + o2[1]]) : this.functions.push(new u(o2[0], o2[0], o2[1], o2[1]));
      else if ("S" === h2[y2][0]) {
        if (y2 > 0 && ["C", "c", "S", "s"].indexOf(h2[y2 - 1][0]) > -1) {
          if (r2) {
            var p2 = r2.getC();
            r2 = new C(o2[0], o2[1], 2 * o2[0] - p2.x, 2 * o2[1] - p2.y, h2[y2][1], h2[y2][2], h2[y2][3], h2[y2][4]);
          }
        } else r2 = new C(o2[0], o2[1], o2[0], o2[1], h2[y2][1], h2[y2][2], h2[y2][3], h2[y2][4]);
        r2 && (this.length += r2.getTotalLength(), o2 = [h2[y2][3], h2[y2][4]], this.functions.push(r2));
      } else if ("s" === h2[y2][0]) {
        if (y2 > 0 && ["C", "c", "S", "s"].indexOf(h2[y2 - 1][0]) > -1) {
          if (r2) {
            var x2 = r2.getC(), v2 = r2.getD();
            r2 = new C(o2[0], o2[1], o2[0] + v2.x - x2.x, o2[1] + v2.y - x2.y, o2[0] + h2[y2][1], o2[1] + h2[y2][2], o2[0] + h2[y2][3], o2[1] + h2[y2][4]);
          }
        } else r2 = new C(o2[0], o2[1], o2[0], o2[1], o2[0] + h2[y2][1], o2[1] + h2[y2][2], o2[0] + h2[y2][3], o2[1] + h2[y2][4]);
        r2 && (this.length += r2.getTotalLength(), o2 = [h2[y2][3] + o2[0], h2[y2][4] + o2[1]], this.functions.push(r2));
      } else if ("Q" === h2[y2][0]) {
        if (o2[0] == h2[y2][1] && o2[1] == h2[y2][2]) {
          var M2 = new u(h2[y2][1], h2[y2][3], h2[y2][2], h2[y2][4]);
          this.length += M2.getTotalLength(), this.functions.push(M2);
        } else r2 = new C(o2[0], o2[1], h2[y2][1], h2[y2][2], h2[y2][3], h2[y2][4], void 0, void 0), this.length += r2.getTotalLength(), this.functions.push(r2);
        o2 = [h2[y2][3], h2[y2][4]], c2 = [h2[y2][1], h2[y2][2]];
      } else if ("q" === h2[y2][0]) {
        if (0 != h2[y2][1] || 0 != h2[y2][2]) r2 = new C(o2[0], o2[1], o2[0] + h2[y2][1], o2[1] + h2[y2][2], o2[0] + h2[y2][3], o2[1] + h2[y2][4], void 0, void 0), this.length += r2.getTotalLength(), this.functions.push(r2);
        else {
          var w2 = new u(o2[0] + h2[y2][1], o2[0] + h2[y2][3], o2[1] + h2[y2][2], o2[1] + h2[y2][4]);
          this.length += w2.getTotalLength(), this.functions.push(w2);
        }
        c2 = [o2[0] + h2[y2][1], o2[1] + h2[y2][2]], o2 = [h2[y2][3] + o2[0], h2[y2][4] + o2[1]];
      } else if ("T" === h2[y2][0]) {
        if (y2 > 0 && ["Q", "q", "T", "t"].indexOf(h2[y2 - 1][0]) > -1) r2 = new C(o2[0], o2[1], 2 * o2[0] - c2[0], 2 * o2[1] - c2[1], h2[y2][1], h2[y2][2], void 0, void 0), this.functions.push(r2), this.length += r2.getTotalLength();
        else {
          var L2 = new u(o2[0], h2[y2][1], o2[1], h2[y2][2]);
          this.functions.push(L2), this.length += L2.getTotalLength();
        }
        c2 = [2 * o2[0] - c2[0], 2 * o2[1] - c2[1]], o2 = [h2[y2][1], h2[y2][2]];
      } else if ("t" === h2[y2][0]) {
        if (y2 > 0 && ["Q", "q", "T", "t"].indexOf(h2[y2 - 1][0]) > -1) r2 = new C(o2[0], o2[1], 2 * o2[0] - c2[0], 2 * o2[1] - c2[1], o2[0] + h2[y2][1], o2[1] + h2[y2][2], void 0, void 0), this.length += r2.getTotalLength(), this.functions.push(r2);
        else {
          var A2 = new u(o2[0], o2[0] + h2[y2][1], o2[1], o2[1] + h2[y2][2]);
          this.length += A2.getTotalLength(), this.functions.push(A2);
        }
        c2 = [2 * o2[0] - c2[0], 2 * o2[1] - c2[1]], o2 = [h2[y2][1] + o2[0], h2[y2][2] + o2[1]];
      } else if ("A" === h2[y2][0]) {
        var d2 = new l(o2[0], o2[1], h2[y2][1], h2[y2][2], h2[y2][3], 1 === h2[y2][4], 1 === h2[y2][5], h2[y2][6], h2[y2][7]);
        this.length += d2.getTotalLength(), o2 = [h2[y2][6], h2[y2][7]], this.functions.push(d2);
      } else if ("a" === h2[y2][0]) {
        var b2 = new l(o2[0], o2[1], h2[y2][1], h2[y2][2], h2[y2][3], 1 === h2[y2][4], 1 === h2[y2][5], o2[0] + h2[y2][6], o2[1] + h2[y2][7]);
        this.length += b2.getTotalLength(), o2 = [o2[0] + h2[y2][6], o2[1] + h2[y2][7]], this.functions.push(b2);
      }
      this.partial_lengths.push(this.length);
    }
  }));
  var j = n((function(t3) {
    var n2 = this;
    if (e(this, "inst", void 0), e(this, "getTotalLength", (function() {
      return n2.inst.getTotalLength();
    })), e(this, "getPointAtLength", (function(t4) {
      return n2.inst.getPointAtLength(t4);
    })), e(this, "getTangentAtLength", (function(t4) {
      return n2.inst.getTangentAtLength(t4);
    })), e(this, "getPropertiesAtLength", (function(t4) {
      return n2.inst.getPropertiesAtLength(t4);
    })), e(this, "getParts", (function() {
      return n2.inst.getParts();
    })), this.inst = new O(t3), !(this instanceof j)) return new j(t3);
  }));

  // src/art/wood.ts
  function makeCanvas2D(w2, h2) {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w2, h2);
    const c2 = document.createElement("canvas");
    c2.width = w2;
    c2.height = h2;
    return c2;
  }
  function parseHex(colour) {
    const rgb = /^\s*rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(colour);
    if (rgb) {
      return {
        r: clamp255(Number(rgb[1])),
        g: clamp255(Number(rgb[2])),
        b: clamp255(Number(rgb[3]))
      };
    }
    const s2 = colour.replace("#", "").trim();
    const full = s2.length === 3 ? s2.split("").map((c2) => c2 + c2).join("") : s2;
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: 128, g: 128, b: 128 };
    const n2 = Number.parseInt(full, 16);
    return { r: n2 >> 16 & 255, g: n2 >> 8 & 255, b: n2 & 255 };
  }
  function clamp255(n2) {
    return !Number.isFinite(n2) ? 0 : n2 < 0 ? 0 : n2 > 255 ? 255 : Math.round(n2);
  }
  function hexAlpha(hex, alpha) {
    const { r: r2, g: g2, b: b2 } = parseHex(hex);
    return `rgba(${r2}, ${g2}, ${b2}, ${alpha})`;
  }
  function paintWood(ctx, wood, w2, h2, opts) {
    const vertical = opts.direction === "vertical";
    const scale = opts.pixelScale ?? 1;
    const contrast = (opts.contrast ?? 1) * wood.contrast;
    const rnd = mulberry32(opts.seed >>> 0);
    const noise = seededNoise2D(opts.seed >>> 0);
    const light = parseHex(wood.light);
    const dark = parseHex(wood.dark);
    const alongLen = vertical ? h2 : w2;
    const acrossLen = vertical ? w2 : h2;
    const knotCount = opts.knots ?? Math.max(0, Math.round(wood.knots * alongLen / 240));
    const knots = [];
    for (let i2 = 0; i2 < knotCount; i2++) {
      knots.push({
        along: rnd() * alongLen,
        across: acrossLen * (0.15 + rnd() * 0.7),
        r: 4 + rnd() * (wood.grain === "knotty" ? 9 : 5)
      });
    }
    const BAND = 3;
    const devW = Math.max(1, Math.ceil(w2 * scale));
    const devH = Math.max(1, Math.ceil(h2 * scale));
    const lw = Math.max(1, Math.ceil(devW / BAND));
    const lh = Math.max(1, Math.ceil(devH / BAND));
    const low = makeCanvas2D(lw, lh);
    const lowCtx = low.getContext("2d");
    if (!lowCtx) throw new Error("wood: 2d context unavailable");
    const img = lowCtx.createImageData(lw, lh);
    const data = img.data;
    const flame = wood.grain === "flame";
    const weathered = wood.grain === "weathered";
    for (let py = 0; py < lh; py++) {
      const sy = py * BAND / scale;
      for (let px = 0; px < lw; px++) {
        const sx = px * BAND / scale;
        const a2 = vertical ? sy : sx;
        const c2 = vertical ? sx : sy;
        let g2 = noise(a2 * wood.along, c2 * wood.across);
        if (flame) g2 += 0.35 * noise(a2 * wood.along * 3.1 + 40, c2 * wood.across * 0.35);
        let ring = g2 * wood.ringFreq;
        for (const k of knots) {
          const d2 = Math.hypot(a2 - k.along, c2 - k.across);
          ring += 0.55 * Math.exp(-(d2 * d2) / (k.r * k.r)) * Math.sin(d2 * 0.35);
        }
        let t3 = Math.pow(fract(ring), wood.ringGamma);
        t3 = 0.5 + (t3 - 0.5) * contrast;
        if (weathered) t3 *= 0.72;
        t3 = t3 < 0 ? 0 : t3 > 1 ? 1 : t3;
        const i2 = (py * lw + px) * 4;
        data[i2] = Math.round(lerp(light.r, dark.r, t3));
        data[i2 + 1] = Math.round(lerp(light.g, dark.g, t3));
        data[i2 + 2] = Math.round(lerp(light.b, dark.b, t3));
        data[i2 + 3] = 255;
      }
    }
    lowCtx.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(low, 0, 0, lw, lh, 0, 0, w2, h2);
    ctx.restore();
    ctx.save();
    ctx.lineCap = "round";
    if (wood.grain === "quartersawn") {
      const flecks = Math.round(alongLen * acrossLen / 900);
      for (let i2 = 0; i2 < flecks; i2++) {
        const a2 = rnd() * alongLen;
        const c2 = rnd() * acrossLen;
        const len = 3 + rnd() * 9;
        const tilt = (rnd() * 2 - 1) * 0.5;
        ctx.strokeStyle = `rgba(255, 236, 200, ${0.05 + rnd() * 0.1})`;
        ctx.lineWidth = 0.8 + rnd() * 1.1;
        const x0 = vertical ? c2 : a2;
        const y0 = vertical ? a2 : c2;
        const dx = vertical ? len : len * tilt;
        const dy = vertical ? len * tilt : len;
        ctx.beginPath();
        ctx.moveTo(x0 - dx / 2, y0 - dy / 2);
        ctx.lineTo(x0 + dx / 2, y0 + dy / 2);
        ctx.stroke();
      }
    } else if (weathered) {
      const splits = Math.max(2, Math.round(alongLen / 90));
      for (let i2 = 0; i2 < splits; i2++) {
        const c2 = rnd() * acrossLen;
        const a0 = rnd() * alongLen * 0.7;
        const len = alongLen * (0.15 + rnd() * 0.45);
        for (const [colour, off, width] of [
          ["rgba(28, 24, 18, 0.42)", 0, 1.1],
          ["rgba(255, 250, 238, 0.16)", 1.2, 0.8]
        ]) {
          ctx.strokeStyle = colour;
          ctx.lineWidth = width;
          ctx.beginPath();
          for (let s2 = 0; s2 <= 6; s2++) {
            const a2 = a0 + len * s2 / 6;
            const cc = c2 + off + (rnd() * 2 - 1) * 1.2;
            const x2 = vertical ? cc : a2;
            const y2 = vertical ? a2 : cc;
            if (s2 === 0) ctx.moveTo(x2, y2);
            else ctx.lineTo(x2, y2);
          }
          ctx.stroke();
        }
      }
    } else if (wood.grain === "birch") {
      const marks = Math.round(alongLen * acrossLen / 1400);
      for (let i2 = 0; i2 < marks; i2++) {
        const a2 = rnd() * alongLen;
        const c2 = rnd() * acrossLen;
        const len = 4 + rnd() * 14;
        const thick = 0.8 + rnd() * 1.6;
        ctx.strokeStyle = `rgba(74, 58, 42, ${0.16 + rnd() * 0.22})`;
        ctx.lineWidth = thick;
        ctx.lineCap = "butt";
        const x0 = vertical ? c2 : a2;
        const y0 = vertical ? a2 : c2;
        const dx = vertical ? 0 : len * 0.06;
        const dy = vertical ? len * 0.06 : 0;
        const px = vertical ? len : 0;
        const py = vertical ? 0 : len;
        ctx.beginPath();
        ctx.moveTo(x0 - px / 2 - dx, y0 - py / 2 - dy);
        ctx.lineTo(x0 + px / 2 + dx, y0 + py / 2 + dy);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255, 252, 244, 0.3)";
        ctx.lineWidth = thick * 0.6;
        ctx.beginPath();
        ctx.moveTo(x0 - px / 2, y0 - py / 2 + (vertical ? 1.4 : 1.4));
        ctx.lineTo(x0 + px / 2, y0 + py / 2 + 1.4);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(255, 253, 246, 0.14)";
      ctx.fillRect(0, 0, w2, h2);
    } else if (wood.grain === "brushed") {
      const lines = Math.round(acrossLen * 1.6);
      for (let i2 = 0; i2 < lines; i2++) {
        const c2 = rnd() * acrossLen;
        const bright = rnd() < 0.5;
        ctx.strokeStyle = bright ? `rgba(255, 255, 255, ${0.03 + rnd() * 0.07})` : `rgba(20, 30, 42, ${0.03 + rnd() * 0.08})`;
        ctx.lineWidth = 0.5 + rnd() * 0.9;
        const a0 = rnd() * alongLen * 0.5;
        const len = alongLen * (0.4 + rnd() * 0.6);
        ctx.beginPath();
        if (vertical) {
          ctx.moveTo(c2, a0);
          ctx.lineTo(c2 + (rnd() * 2 - 1) * 0.6, a0 + len);
        } else {
          ctx.moveTo(a0, c2);
          ctx.lineTo(a0 + len, c2 + (rnd() * 2 - 1) * 0.6);
        }
        ctx.stroke();
      }
      for (let i2 = 0; i2 < Math.max(2, Math.round(acrossLen / 40)); i2++) {
        const c2 = rnd() * acrossLen;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.24)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        if (vertical) {
          ctx.moveTo(c2, 0);
          ctx.lineTo(c2, alongLen);
        } else {
          ctx.moveTo(0, c2);
          ctx.lineTo(alongLen, c2);
        }
        ctx.stroke();
      }
    } else if (wood.grain === "gloss") {
      const g2 = vertical ? ctx.createLinearGradient(0, 0, w2, 0) : ctx.createLinearGradient(0, 0, 0, h2);
      g2.addColorStop(0, hexAlpha(wood.light, 0.5));
      g2.addColorStop(0.45, "rgba(255, 255, 255, 0)");
      g2.addColorStop(1, hexAlpha(wood.dark, 0.35));
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, w2, h2);
      for (let i2 = 0; i2 < Math.round(w2 * h2 / 900); i2++) {
        ctx.fillStyle = rnd() < 0.5 ? "rgba(255, 255, 255, 0.3)" : hexAlpha(wood.dark, 0.16);
        ctx.beginPath();
        ctx.arc(rnd() * w2, rnd() * h2, 0.4 + rnd() * 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (wood.grain === "knotty") {
      for (const k of knots) {
        ctx.strokeStyle = "rgba(96, 60, 28, 0.2)";
        for (let r2 = k.r + 3; r2 < k.r + 22; r2 += 3.5) {
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          const steps = 14;
          const side = rnd() < 0.5 ? 1 : -1;
          for (let s2 = 0; s2 <= steps; s2++) {
            const u2 = -1 + 2 * s2 / steps;
            const aa = k.along + u2 * r2 * 2.6;
            const cc = k.across + (1 - u2 * u2) * r2 * side * 0.9;
            const x2 = vertical ? cc : aa;
            const y2 = vertical ? aa : cc;
            if (s2 === 0) ctx.moveTo(x2, y2);
            else ctx.lineTo(x2, y2);
          }
          ctx.stroke();
        }
        const kx = vertical ? k.across : k.along;
        const ky = vertical ? k.along : k.across;
        const eye = ctx.createRadialGradient(kx, ky, 0, kx, ky, k.r);
        eye.addColorStop(0, "rgba(70, 40, 16, 0.72)");
        eye.addColorStop(0.6, "rgba(102, 64, 28, 0.35)");
        eye.addColorStop(1, "rgba(102, 64, 28, 0)");
        ctx.fillStyle = eye;
        ctx.beginPath();
        ctx.arc(kx, ky, k.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    const streakCount = Math.max(2, Math.round(wood.streaks * alongLen / 100));
    ctx.save();
    ctx.lineCap = "round";
    for (let i2 = 0; i2 < streakCount; i2++) {
      const darkStroke = rnd() < 0.55;
      ctx.strokeStyle = darkStroke ? hexAlpha(wood.dark, 0.05 + rnd() * 0.09) : hexAlpha(wood.light, 0.06 + rnd() * 0.1);
      ctx.lineWidth = 0.6 + rnd() * 1.3;
      const c0 = rnd() * acrossLen;
      const drift = (rnd() * 2 - 1) * 5;
      const a0 = -10 + rnd() * alongLen * 0.4;
      const len = alongLen * (0.3 + rnd() * 0.7);
      ctx.beginPath();
      for (let s2 = 0; s2 <= 5; s2++) {
        const a2 = a0 + len * s2 / 5;
        const c2 = c0 + drift * s2 / 5 + (rnd() * 2 - 1) * 1.3;
        const x2 = vertical ? c2 : a2;
        const y2 = vertical ? a2 : c2;
        if (s2 === 0) ctx.moveTo(x2, y2);
        else ctx.lineTo(x2, y2);
      }
      ctx.stroke();
    }
    ctx.restore();
    const tile = getGranulationTile();
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.07;
    for (let ty = 0; ty < h2; ty += 256) {
      for (let tx = 0; tx < w2; tx += 256) ctx.drawImage(tile, tx, ty);
    }
    ctx.restore();
    if (wood.paint && !opts.bare) paintFilm(ctx, wood.paint, w2, h2, vertical, rnd);
    if (!opts.noFinish) woodFinish(ctx, wood, w2, h2, vertical);
  }
  function paintFilm(ctx, paint, w2, h2, vertical, rnd) {
    ctx.save();
    ctx.globalAlpha = paint.opacity;
    ctx.fillStyle = paint.colour;
    ctx.fillRect(0, 0, w2, h2);
    ctx.globalAlpha = 1;
    const along = vertical ? h2 : w2;
    const across = vertical ? w2 : h2;
    ctx.lineCap = "round";
    const strokes = Math.max(3, Math.round(across / 5));
    for (let i2 = 0; i2 < strokes; i2++) {
      ctx.strokeStyle = rnd() < 0.5 ? paint.shade : "#ffffff";
      ctx.globalAlpha = 0.05 + rnd() * 0.06;
      ctx.lineWidth = 1 + rnd() * 2.4;
      const c2 = rnd() * across;
      ctx.beginPath();
      if (vertical) {
        ctx.moveTo(c2, rnd() * along * 0.2);
        ctx.lineTo(c2 + (rnd() * 2 - 1) * 2, along * (0.5 + rnd() * 0.5));
      } else {
        ctx.moveTo(rnd() * along * 0.2, c2);
        ctx.lineTo(along * (0.5 + rnd() * 0.5), c2 + (rnd() * 2 - 1) * 2);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const chipCount = Math.round(paint.chipping * ((w2 + h2) / 26));
    const chipShape = (cx, cy, r2) => {
      const p2 = new Path2D();
      const pts = 6 + Math.floor(rnd() * 4);
      for (let i2 = 0; i2 <= pts; i2++) {
        const ang = i2 / pts * Math.PI * 2;
        const rr = r2 * (0.45 + rnd() * 0.75);
        const x2 = cx + Math.cos(ang) * rr;
        const y2 = cy + Math.sin(ang) * rr * 0.8;
        if (i2 === 0) p2.moveTo(x2, y2);
        else p2.lineTo(x2, y2);
      }
      p2.closePath();
      return p2;
    };
    for (let i2 = 0; i2 < chipCount; i2++) {
      const edge = Math.floor(rnd() * 4);
      const r2 = 2 + rnd() * 5;
      let cx;
      let cy;
      if (edge === 0) {
        cx = rnd() * w2;
        cy = rnd() * 3;
      } else if (edge === 1) {
        cx = rnd() * w2;
        cy = h2 - rnd() * 3;
      } else if (edge === 2) {
        cx = rnd() * 3;
        cy = rnd() * h2;
      } else {
        cx = w2 - rnd() * 3;
        cy = rnd() * h2;
      }
      const shape = chipShape(cx, cy, r2);
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.fill(shape);
      ctx.restore();
      ctx.strokeStyle = paint.shade;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.stroke(shape);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
  function woodFinish(ctx, wood, w2, h2, vertical) {
    if (wood.sheen <= 1e-3) return;
    ctx.save();
    const g2 = vertical ? ctx.createLinearGradient(0, 0, w2, 0) : ctx.createLinearGradient(0, 0, 0, h2);
    switch (wood.finish) {
      case "lacquer": {
        g2.addColorStop(0, `rgba(255, 252, 244, ${0.03 * wood.sheen})`);
        g2.addColorStop(0.2, `rgba(255, 250, 236, ${0.5 * wood.sheen})`);
        g2.addColorStop(0.34, `rgba(255, 248, 232, ${0.1 * wood.sheen})`);
        g2.addColorStop(0.72, "rgba(255, 255, 255, 0)");
        g2.addColorStop(1, `rgba(20, 12, 6, ${0.28 * wood.sheen})`);
        break;
      }
      case "wax": {
        g2.addColorStop(0, `rgba(255, 246, 226, ${0.34 * wood.sheen})`);
        g2.addColorStop(0.42, `rgba(255, 244, 220, ${0.1 * wood.sheen})`);
        g2.addColorStop(0.85, "rgba(255, 255, 255, 0)");
        g2.addColorStop(1, `rgba(38, 26, 14, ${0.22 * wood.sheen})`);
        break;
      }
      case "limewash": {
        g2.addColorStop(0, `rgba(255, 255, 250, ${0.5 * wood.sheen})`);
        g2.addColorStop(1, `rgba(240, 238, 228, ${0.2 * wood.sheen})`);
        break;
      }
      case "gloss": {
        g2.addColorStop(0, `rgba(255, 255, 255, ${0.34 * wood.sheen})`);
        g2.addColorStop(0.14, `rgba(255, 255, 255, ${0.72 * wood.sheen})`);
        g2.addColorStop(0.3, `rgba(255, 255, 255, ${0.08 * wood.sheen})`);
        g2.addColorStop(0.72, `rgba(70, 20, 50, ${0.16 * wood.sheen})`);
        g2.addColorStop(1, `rgba(255, 240, 250, ${0.4 * wood.sheen})`);
        break;
      }
      case "metal": {
        g2.addColorStop(0, `rgba(240, 250, 255, ${0.42 * wood.sheen})`);
        g2.addColorStop(0.28, `rgba(255, 255, 255, ${0.16 * wood.sheen})`);
        g2.addColorStop(0.62, `rgba(14, 26, 40, ${0.26 * wood.sheen})`);
        g2.addColorStop(0.9, `rgba(120, 200, 240, ${0.18 * wood.sheen})`);
        g2.addColorStop(1, `rgba(255, 255, 255, ${0.3 * wood.sheen})`);
        break;
      }
      case "painted":
      case "matte": {
        g2.addColorStop(0, `rgba(255, 250, 240, ${0.24 * wood.sheen})`);
        g2.addColorStop(0.6, "rgba(255, 255, 255, 0)");
        g2.addColorStop(1, `rgba(46, 34, 22, ${0.16 * wood.sheen})`);
        break;
      }
      default: {
        g2.addColorStop(0, `rgba(255, 250, 238, ${0.3 * wood.sheen})`);
        g2.addColorStop(1, `rgba(40, 32, 22, ${0.14 * wood.sheen})`);
        break;
      }
    }
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w2, h2);
    ctx.restore();
  }

  // prototypes/books/scenes/shelf.ts
  var PLANK_H = 26;
  function drawCase(ctx, w2, h2, opts = {}) {
    const rig = opts.rigId ? getLightRig(opts.rigId) : DEFAULT_LIGHT_RIG;
    const seed = opts.seed ?? 7;
    const rows = opts.rows ?? 2;
    const theme = getTheme("cottage");
    ctx.save();
    paintWood(ctx, theme.wood, w2, h2, { seed: seed * 31, direction: "vertical", contrast: 0.8 });
    ctx.restore();
    const margin = 34;
    const rowH = (h2 - margin) / rows;
    for (let r2 = 0; r2 < rows; r2++) {
      const baseline = margin + rowH * (r2 + 1) - PLANK_H;
      const avail = w2 - margin * 2;
      const books = rowInputs(30, seed + r2 * 13);
      const comp = composeShelfRow(books, { width: avail, seed: seed + r2 * 101 });
      for (const p2 of comp.placements) {
        ctx.save();
        if (p2.pose === "flat") {
          ctx.translate(margin + p2.x, baseline - p2.stackY);
          ctx.rotate(-Math.PI / 2);
          renderSpine(ctx, p2.params, 0, 0, p2.width, 1, p2.title, {
            hiRes: true,
            rig,
            rowPhase: p2.phase,
            depth: (p2.depth + 1) / 2
          });
        } else {
          const hp = Math.min(p2.height, rowH - PLANK_H - 8);
          ctx.translate(margin + p2.x, baseline - hp);
          if (p2.leanDeg !== 0) {
            ctx.translate(0, hp);
            ctx.rotate(p2.leanDeg * Math.PI / 180);
            ctx.translate(0, -hp);
          }
          renderSpine(ctx, p2.params, 0, 0, hp, 1, p2.title, {
            hiRes: true,
            rig,
            rowPhase: p2.phase,
            depth: (p2.depth + 1) / 2
          });
        }
        ctx.restore();
      }
      ctx.save();
      ctx.translate(0, baseline);
      paintWood(ctx, theme.wood, w2, PLANK_H, { seed: seed * 17 + r2, direction: "horizontal" });
      ctx.restore();
    }
  }
  var SHELF_SCENES = [
    {
      name: "shelf",
      width: 1e3,
      height: 560,
      draw: (ctx, w2, h2) => drawCase(ctx, w2, h2, { seed: 7 })
    },
    {
      name: "shelf-crop",
      width: 1e3,
      height: 560,
      draw: (ctx, w2, h2) => {
        const off = document.createElement("canvas");
        off.width = 1e3;
        off.height = 560;
        drawCase(off.getContext("2d"), 1e3, 560, { seed: 7 });
        ctx.drawImage(off, 120, 40, 430, 240, 0, 0, w2, h2);
      }
    }
  ];

  // prototypes/books/scenes/index.ts
  var SCENES = [...BASELINE_SCENES, ...SHELF_SCENES, ...MATERIAL_SCENES];

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
    const b2 = document.createElement("button");
    b2.textContent = scene.name;
    b2.onclick = () => runScene(scene);
    bar.insertBefore(b2, status);
  }
  window.__harness = {
    list: () => SCENES.map((s2) => s2.name),
    render: (name) => {
      const scene = SCENES.find((s2) => s2.name === name);
      if (!scene) throw new Error(`no scene "${name}"`);
      return runScene(scene);
    }
  };
  status.textContent = `${SCENES.length} scenes ready`;
})();
