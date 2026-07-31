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
  var NAMED = {
    black: "#000000",
    white: "#ffffff",
    transparent: "#00000000",
    gold: "#c9a227",
    cream: "#f4ead2",
    ink: "#2c2419"
  };
  var BLACK = { r: 0, g: 0, b: 0, a: 1 };
  function hue2rgb(p, q, t) {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  }
  function parseColour(css) {
    if (typeof css !== "string") return { ...BLACK };
    const raw = css.trim().toLowerCase();
    const named = NAMED[raw];
    const s = named ?? raw;
    if (s.startsWith("#")) {
      const hex = s.slice(1);
      const expand = (c) => Number.parseInt(c + c, 16);
      if (hex.length === 3 || hex.length === 4) {
        const r = expand(hex[0]);
        const g = expand(hex[1]);
        const b = expand(hex[2]);
        const a = hex.length === 4 ? expand(hex[3]) / 255 : 1;
        if ([r, g, b].some((v) => Number.isNaN(v))) return { ...BLACK };
        return { r, g, b, a };
      }
      if (hex.length === 6 || hex.length === 8) {
        const n = Number.parseInt(hex.slice(0, 6), 16);
        if (Number.isNaN(n)) return { ...BLACK };
        const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
        return {
          r: n >> 16 & 255,
          g: n >> 8 & 255,
          b: n & 255,
          a: Number.isNaN(a) ? 1 : a
        };
      }
      return { ...BLACK };
    }
    const fn = /^(rgba?|hsla?)\s*\(([^)]*)\)$/.exec(s);
    if (fn === null) return { ...BLACK };
    const kind = fn[1];
    const parts = fn[2].replace(/\//g, " ").split(/[\s,]+/).filter((p2) => p2.length > 0);
    if (parts.length < 3) return { ...BLACK };
    const readAlpha = (p2) => {
      if (p2 === void 0) return 1;
      const v = p2.endsWith("%") ? Number.parseFloat(p2) / 100 : Number.parseFloat(p2);
      return Number.isFinite(v) ? clamp(v, 0, 1) : 1;
    };
    if (kind.startsWith("rgb")) {
      const chan = (p2) => {
        const v = p2.endsWith("%") ? Number.parseFloat(p2) / 100 * 255 : Number.parseFloat(p2);
        return Number.isFinite(v) ? clamp(Math.round(v), 0, 255) : 0;
      };
      return {
        r: chan(parts[0]),
        g: chan(parts[1]),
        b: chan(parts[2]),
        a: readAlpha(parts[3])
      };
    }
    const h = ((Number.parseFloat(parts[0]) || 0) % 360 + 360) % 360 / 360;
    const sat = clamp((Number.parseFloat(parts[1]) || 0) / 100, 0, 1);
    const li = clamp((Number.parseFloat(parts[2]) || 0) / 100, 0, 1);
    if (sat === 0) {
      const v = Math.round(li * 255);
      return { r: v, g: v, b: v, a: readAlpha(parts[3]) };
    }
    const q = li < 0.5 ? li * (1 + sat) : li + sat - li * sat;
    const p = 2 * li - q;
    return {
      r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      g: Math.round(hue2rgb(p, q, h) * 255),
      b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
      a: readAlpha(parts[3])
    };
  }
  function rgbaToCss(c) {
    const r = clamp(Math.round(c.r), 0, 255);
    const g = clamp(Math.round(c.g), 0, 255);
    const b = clamp(Math.round(c.b), 0, 255);
    const a = clamp(c.a, 0, 1);
    return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
  }
  function withAlpha(colour, alpha) {
    const c = typeof colour === "string" ? parseColour(colour) : colour;
    return rgbaToCss({ ...c, a: clamp(alpha, 0, 1) });
  }
  function mixColour(a, b, t) {
    const ca = typeof a === "string" ? parseColour(a) : a;
    const cb = typeof b === "string" ? parseColour(b) : b;
    const k = clamp(t, 0, 1);
    return {
      r: lerp(ca.r, cb.r, k),
      g: lerp(ca.g, cb.g, k),
      b: lerp(ca.b, cb.b, k),
      a: lerp(ca.a, cb.a, k)
    };
  }
  function shiftTemperature(colour, amount) {
    const c = typeof colour === "string" ? parseColour(colour) : colour;
    const k = clamp(amount, -1, 1);
    const before = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const r = c.r + k * 46;
    const g = c.g + k * 14;
    const b = c.b - k * 44;
    const after = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const gain = after > 1 ? lerp(1, before / after, 0.75) : 1;
    return {
      r: clamp(r * gain, 0, 255),
      g: clamp(g * gain, 0, 255),
      b: clamp(b * gain, 0, 255),
      a: c.a
    };
  }
  function blowOut(colour, amount) {
    const c = typeof colour === "string" ? parseColour(colour) : colour;
    const t = clamp(amount, 0, 1);
    const hot = {
      r: lerp(c.r, 255, 0.86),
      g: lerp(c.g, 255, 0.78),
      b: lerp(c.b, 250, 0.62),
      a: c.a
    };
    return mixColour(c, hot, t * t * (3 - 2 * t));
  }
  function falloff(t, curve = "smooth") {
    const x = clamp(t, 0, 1);
    switch (curve) {
      case "linear":
        return 1 - x;
      case "smooth": {
        const u = 1 - x;
        return u * u * (3 - 2 * u);
      }
      case "smoother": {
        const u = 1 - x;
        return u * u * u * (u * (u * 6 - 15) + 10);
      }
      case "sqrt":
        return Math.sqrt(1 - x);
      case "quadratic":
        return (1 - x) * (1 - x);
      case "cubic":
        return (1 - x) * (1 - x) * (1 - x);
      case "inverseSquare":
        return clamp((1 / (1 + 8 * x * x) - 1 / 9) * (9 / 8), 0, 1);
      case "exponential":
        return clamp((Math.exp(-4 * x) - Math.exp(-4)) / (1 - Math.exp(-4)), 0, 1);
      case "gaussian": {
        const g = Math.exp(-4.5 * x * x);
        const edge = Math.exp(-4.5);
        return clamp((g - edge) / (1 - edge), 0, 1);
      }
      default:
        return 1 - x;
    }
  }
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
  function keyDirection(rig) {
    return { x: Math.cos(rig.keyAngle), y: Math.sin(rig.keyAngle) };
  }
  function keyToSource(rig) {
    return { x: -Math.cos(rig.keyAngle), y: -Math.sin(rig.keyAngle) };
  }
  function surfaceLambert(normalAngle, rig, wrap = 0.25) {
    const d = -Math.cos(normalAngle - rig.keyAngle);
    const w = clamp(wrap, 0, 1);
    return clamp((d + w) / (1 + w), 0, 1);
  }
  function rimFactor(normalAngle, rig) {
    const facing = surfaceLambert(normalAngle, rig, 0.1);
    const graze = Math.pow(facing, Math.max(0.05, rig.rimSharpness));
    return clamp(graze * rig.rimStrength, 0, 1);
  }
  function contactShadowSpread(contactSize, gap = 0) {
    const base = Math.max(1.2, contactSize * 0.22);
    return base + Math.max(0, gap) * 1.35;
  }
  function falloffInverse(t) {
    return 1 - falloff(clamp(t, 0, 1), "smooth");
  }
  function atmosphericBlend(depth, rig) {
    return clamp(falloffInverse(clamp(depth, 0, 1)) * rig.hazeStrength, 0, 1);
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
  function castContactShadow(ctx, opts) {
    const rig = opts.rig ?? DEFAULT_LIGHT_RIG;
    const side = opts.side ?? "below";
    const len = Math.max(0, opts.length);
    if (len <= 0) return;
    const gap = Math.max(0, opts.gap ?? 0);
    const spread = contactShadowSpread(len, gap);
    const depth = Math.max(1, opts.depth) + spread * 0.35;
    const strength = clamp((opts.strength ?? 1) * rig.contactStrength, 0, 2);
    if (strength <= 1e-3) return;
    const base = opts.colour ?? rig.shadowColour;
    const tinted = shiftTemperature(
      mixColour(base, rig.fillColour, rig.fillIntensity * 0.22),
      -rig.temperatureShift * 0.55
    );
    const skew = opts.skew ?? depth * 0.18;
    const dir = keyDirection(rig);
    const horizontal = side === "below" || side === "above";
    const sign = side === "below" || side === "right" ? 1 : -1;
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    const passes = [
      [0.3, 1],
      [0.72, 0.52],
      [1, 0.24]
    ];
    for (const [reach, alphaK] of passes) {
      const d = depth * reach;
      const ox = dir.x * skew * reach;
      const oy = dir.y * skew * reach * rig.groundFlatten;
      let grad;
      if (horizontal) {
        grad = ctx.createLinearGradient(0, opts.y, 0, opts.y + sign * d);
      } else {
        grad = ctx.createLinearGradient(opts.x, 0, opts.x + sign * d, 0);
      }
      const a = clamp(0.55 * strength * alphaK, 0, 1);
      grad.addColorStop(0, withAlpha(tinted, a));
      grad.addColorStop(0.34, withAlpha(tinted, a * 0.5));
      grad.addColorStop(0.68, withAlpha(tinted, a * 0.16));
      grad.addColorStop(1, withAlpha(tinted, 0));
      ctx.fillStyle = grad;
      const taper = clamp(opts.taper ?? Math.min(len * 0.16, spread * 1.6), 0, len * 0.45);
      ctx.save();
      ctx.beginPath();
      if (horizontal) {
        const x0 = opts.x - spread * 0.4 + ox;
        const x1 = opts.x + len + spread * 0.4 + ox;
        const y0 = opts.y + oy;
        const y1 = y0 + sign * d;
        ctx.moveTo(x0 + taper, y0);
        ctx.lineTo(x1 - taper, y0);
        ctx.quadraticCurveTo(x1, y0, x1, y1);
        ctx.lineTo(x0, y1);
        ctx.quadraticCurveTo(x0, y0, x0 + taper, y0);
      } else {
        const y0 = opts.y - spread * 0.4 + oy;
        const y1 = opts.y + len + spread * 0.4 + oy;
        const x0 = opts.x + ox;
        const x1 = x0 + sign * d;
        ctx.moveTo(x0, y0 + taper);
        ctx.lineTo(x0, y1 - taper);
        ctx.quadraticCurveTo(x0, y1, x1, y1);
        ctx.lineTo(x1, y0);
        ctx.quadraticCurveTo(x0, y0, x0, y0 + taper);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
  function applyAmbientOcclusion(ctx, opts) {
    const rig = opts.rig ?? DEFAULT_LIGHT_RIG;
    const { x, y, width: w, height: h } = opts;
    if (w <= 0 || h <= 0) return;
    const strength = clamp((opts.strength ?? 1) * rig.ambientOcclusion, 0, 2);
    if (strength <= 1e-3) return;
    const edges = opts.edges ?? ["top", "bottom", "left", "right"];
    const reach = opts.reach ?? Math.min(w, h) * 0.4;
    const curve = opts.curve ?? "smoother";
    const colour = shiftTemperature(rig.shadowColour, -rig.temperatureShift * 0.6);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.globalCompositeOperation = "multiply";
    const stops = 7;
    const addStops = (g, peak2) => {
      for (let i = 0; i <= stops; i++) {
        const t = i / stops;
        g.addColorStop(t, withAlpha(colour, clamp(peak2 * falloff(t, curve), 0, 1)));
      }
    };
    const peak = clamp(0.62 * strength, 0, 0.95);
    for (const edge of edges) {
      let g;
      let rect;
      const rw = Math.min(reach, w);
      const rh = Math.min(reach, h);
      switch (edge) {
        case "top":
          g = ctx.createLinearGradient(0, y, 0, y + rh);
          rect = [x, y, w, rh];
          break;
        case "bottom":
          g = ctx.createLinearGradient(0, y + h, 0, y + h - rh);
          rect = [x, y + h - rh, w, rh];
          break;
        case "left":
          g = ctx.createLinearGradient(x, 0, x + rw, 0);
          rect = [x, y, rw, h];
          break;
        default:
          g = ctx.createLinearGradient(x + w, 0, x + w - rw, 0);
          rect = [x + w - rw, y, rw, h];
          break;
      }
      addStops(g, peak);
      ctx.fillStyle = g;
      ctx.fillRect(rect[0], rect[1], rect[2], rect[3]);
    }
    if (opts.corners !== false) {
      const cr = Math.min(reach * 1.15, Math.min(w, h) * 0.7);
      for (const [cx, cy] of [
        [x, y],
        [x + w, y],
        [x, y + h],
        [x + w, y + h]
      ]) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
        addStops(g, peak * 0.62);
        ctx.fillStyle = g;
        ctx.fillRect(cx - cr, cy - cr, cr * 2, cr * 2);
      }
    }
    ctx.restore();
  }
  function applyCreaseOcclusion(ctx, opts) {
    const rig = opts.rig ?? DEFAULT_LIGHT_RIG;
    const strength = clamp((opts.strength ?? 1) * rig.ambientOcclusion, 0, 2);
    if (strength <= 1e-3 || opts.length <= 0 || opts.reach <= 0) return;
    const colour = shiftTemperature(rig.shadowColour, -rig.temperatureShift * 0.5);
    const bias = clamp(opts.bias ?? 0, -1, 1);
    const near = opts.reach * (1 - bias * 0.6);
    const far = opts.reach * (1 + bias * 0.6);
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    const g = opts.axis === "horizontal" ? ctx.createLinearGradient(0, opts.y - near, 0, opts.y + far) : ctx.createLinearGradient(opts.x - near, 0, opts.x + far, 0);
    const peak = clamp(0.55 * strength, 0, 0.92);
    g.addColorStop(0, withAlpha(colour, 0));
    g.addColorStop(0.32, withAlpha(colour, peak * 0.28));
    g.addColorStop(near / (near + far), withAlpha(colour, peak));
    g.addColorStop(0.72, withAlpha(colour, peak * 0.24));
    g.addColorStop(1, withAlpha(colour, 0));
    ctx.fillStyle = g;
    if (opts.axis === "horizontal") {
      ctx.fillRect(opts.x, opts.y - near, opts.length, near + far);
    } else {
      ctx.fillRect(opts.x - near, opts.y, near + far, opts.length);
    }
    ctx.restore();
  }
  function applyKeyLight(ctx, opts) {
    const rig = opts.rig ?? DEFAULT_LIGHT_RIG;
    const { x, y, width: w, height: h } = opts;
    if (w <= 0 || h <= 0) return;
    let power = clamp((opts.intensity ?? 1) * rig.keyIntensity, 0, 2);
    if (opts.normalAngle !== void 0) power *= surfaceLambert(opts.normalAngle, rig);
    if (power <= 2e-3) return;
    const src = keyToSource(rig);
    const cx = x + w / 2;
    const cy = y + h / 2;
    const reach = Math.hypot(w, h) * 0.6;
    const x0 = cx - src.x * reach;
    const y0 = cy - src.y * reach;
    const x1 = cx + src.x * reach;
    const y1 = cy + src.y * reach;
    const warm = shiftTemperature(rig.keyColour, rig.temperatureShift * 0.5);
    const cool = shiftTemperature(rig.fillColour, -rig.temperatureShift * 0.7);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.globalCompositeOperation = "screen";
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    const peak = clamp(0.42 * power, 0, 0.9);
    g.addColorStop(0, withAlpha(cool, 0));
    g.addColorStop(0.42, withAlpha(warm, peak * 0.16));
    g.addColorStop(0.74, withAlpha(warm, peak * 0.56));
    g.addColorStop(1, withAlpha(blowOut(warm, 0.3), peak));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.globalCompositeOperation = "multiply";
    const sg = ctx.createLinearGradient(x1, y1, x0, y0);
    const shade = clamp(0.4 * power * rig.ambientOcclusion, 0, 0.72);
    const shadowTone = shiftTemperature(
      mixColour(rig.shadowColour, rig.fillColour, rig.fillIntensity * 0.5),
      -rig.temperatureShift
    );
    sg.addColorStop(0, withAlpha(shadowTone, 0));
    sg.addColorStop(0.55, withAlpha(shadowTone, shade * 0.32));
    sg.addColorStop(1, withAlpha(shadowTone, shade));
    ctx.fillStyle = sg;
    ctx.fillRect(x, y, w, h);
    const hot = clamp(opts.hotSpot ?? rig.hotSpot, 0, 1) * power;
    if (hot > 0.02) {
      ctx.globalCompositeOperation = "screen";
      const hx = cx + src.x * w * 0.42;
      const hy = cy + src.y * h * 0.42;
      const hr = Math.max(w, h) * (0.28 + hot * 0.3);
      const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
      const hotCol = blowOut(rig.keyColour, 0.72);
      hg.addColorStop(0, withAlpha(hotCol, clamp(hot * 0.55, 0, 0.85)));
      hg.addColorStop(0.4, withAlpha(hotCol, clamp(hot * 0.2, 0, 0.5)));
      hg.addColorStop(1, withAlpha(hotCol, 0));
      ctx.fillStyle = hg;
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
  }
  function cylinderShading(ctx, rig, cx, cy, radius, axisAngle) {
    const perp = axisAngle + Math.PI / 2;
    const src = keyToSource(rig);
    const along = Math.cos(perp) * src.x + Math.sin(perp) * src.y;
    const px = Math.cos(perp) * radius;
    const py = Math.sin(perp) * radius;
    const s = along >= 0 ? 1 : -1;
    const g = ctx.createLinearGradient(cx - px * s, cy - py * s, cx + px * s, cy + py * s);
    const shadow = shiftTemperature(rig.shadowColour, -rig.temperatureShift * 0.7);
    const lit = blowOut(rig.keyColour, rig.hotSpot * 0.5);
    g.addColorStop(0, withAlpha(shadow, clamp(0.5 * rig.ambientOcclusion, 0, 0.8)));
    g.addColorStop(0.22, withAlpha(shadow, clamp(0.16 * rig.ambientOcclusion, 0, 0.4)));
    g.addColorStop(0.52, withAlpha(lit, clamp(0.34 * rig.keyIntensity, 0, 0.7)));
    g.addColorStop(0.72, withAlpha(lit, clamp(0.12 * rig.keyIntensity, 0, 0.35)));
    g.addColorStop(1, withAlpha(shadow, clamp(0.42 * rig.ambientOcclusion, 0, 0.75)));
    return g;
  }
  function litEdges(rig) {
    const src = keyToSource(rig);
    const out = [];
    if (src.x > 0.15) out.push("right");
    if (src.x < -0.15) out.push("left");
    if (src.y > 0.15) out.push("bottom");
    if (src.y < -0.15) out.push("top");
    return out;
  }
  function applyRimLight(ctx, opts) {
    const rig = opts.rig ?? DEFAULT_LIGHT_RIG;
    const { x, y, width: w, height: h } = opts;
    if (w <= 0 || h <= 0) return;
    const strength = clamp((opts.strength ?? 1) * rig.rimStrength, 0, 2);
    if (strength <= 5e-3) return;
    const t = Math.max(0.6, opts.thickness ?? Math.min(w, h) * 0.085);
    const edges = opts.edges ?? litEdges(rig);
    const colour = blowOut(rig.rimColour, 0.35);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.globalCompositeOperation = "screen";
    for (const edge of edges) {
      const normal = edge === "right" ? 0 : edge === "left" ? Math.PI : edge === "top" ? -Math.PI / 2 : Math.PI / 2;
      const f = rimFactor(normal, { ...rig, rimStrength: 1 });
      const a = clamp(0.7 * strength * f, 0, 1);
      if (a < 0.01) continue;
      let g;
      let rect;
      switch (edge) {
        case "top":
          g = ctx.createLinearGradient(0, y, 0, y + t);
          rect = [x, y, w, t];
          break;
        case "bottom":
          g = ctx.createLinearGradient(0, y + h, 0, y + h - t);
          rect = [x, y + h - t, w, t];
          break;
        case "left":
          g = ctx.createLinearGradient(x, 0, x + t, 0);
          rect = [x, y, t, h];
          break;
        default:
          g = ctx.createLinearGradient(x + w, 0, x + w - t, 0);
          rect = [x + w - t, y, t, h];
          break;
      }
      g.addColorStop(0, withAlpha(colour, a));
      g.addColorStop(0.28, withAlpha(colour, a * 0.52));
      g.addColorStop(0.62, withAlpha(colour, a * 0.14));
      g.addColorStop(1, withAlpha(colour, 0));
      ctx.fillStyle = g;
      ctx.fillRect(rect[0], rect[1], rect[2], rect[3]);
    }
    ctx.restore();
  }
  function applySpecularCatch(ctx, opts) {
    const rig = opts.rig ?? DEFAULT_LIGHT_RIG;
    const r = Math.max(0.4, opts.radius);
    const strength = clamp((opts.strength ?? 1) * (0.4 + rig.keyIntensity * 0.55), 0, 1.4);
    if (strength <= 0.01) return;
    const aspect = Math.max(0.2, opts.aspect ?? 2.2);
    const angle = opts.angle ?? rig.keyAngle + Math.PI / 2;
    const colour = blowOut(opts.colour ?? rig.rimColour, 0.6);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.translate(opts.x, opts.y);
    ctx.rotate(angle);
    ctx.scale(aspect, 1);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, withAlpha(colour, clamp(0.85 * strength, 0, 1)));
    g.addColorStop(0.3, withAlpha(colour, clamp(0.4 * strength, 0, 1)));
    g.addColorStop(0.66, withAlpha(colour, clamp(0.12 * strength, 0, 1)));
    g.addColorStop(1, withAlpha(colour, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  }
  function applyAtmosphericHaze(ctx, opts) {
    const rig = opts.rig ?? DEFAULT_LIGHT_RIG;
    const a = atmosphericBlend(opts.depth, rig) * clamp(opts.strength ?? 1, 0, 2);
    if (a <= 4e-3 || opts.width <= 0 || opts.height <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = withAlpha(rig.hazeColour, clamp(a * 0.42, 0, 0.7));
    ctx.fillRect(opts.x, opts.y, opts.width, opts.height);
    ctx.globalCompositeOperation = "saturation";
    ctx.globalAlpha = clamp(a * 0.5, 0, 0.8);
    ctx.fillStyle = "hsl(30 22% 50%)";
    ctx.fillRect(opts.x, opts.y, opts.width, opts.height);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  function applyColourBleed(ctx, opts) {
    const { x, y, width: w, height: h } = opts;
    if (w <= 0 || h <= 0) return;
    const a = clamp(opts.strength ?? 0.1, 0, 0.6);
    if (a <= 3e-3) return;
    const reach = Math.min(opts.reach ?? Math.min(w, h) * 0.45, opts.from === "left" || opts.from === "right" ? w : h);
    const col = typeof opts.colour === "string" ? parseColour(opts.colour) : opts.colour;
    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    let g;
    let rect;
    switch (opts.from) {
      case "left":
        g = ctx.createLinearGradient(x, 0, x + reach, 0);
        rect = [x, y, reach, h];
        break;
      case "right":
        g = ctx.createLinearGradient(x + w, 0, x + w - reach, 0);
        rect = [x + w - reach, y, reach, h];
        break;
      case "top":
        g = ctx.createLinearGradient(0, y, 0, y + reach);
        rect = [x, y, w, reach];
        break;
      default:
        g = ctx.createLinearGradient(0, y + h, 0, y + h - reach);
        rect = [x, y + h - reach, w, reach];
        break;
    }
    g.addColorStop(0, withAlpha(col, a));
    g.addColorStop(0.45, withAlpha(col, a * 0.4));
    g.addColorStop(1, withAlpha(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(rect[0], rect[1], rect[2], rect[3]);
    ctx.restore();
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
  var GOLD2 = "#c9a227";
  var GRAPHITE = "rgba(58, 50, 42, 0.55)";
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
  var GRANULATION_SIZE = 256;
  var granulationTile = null;
  function makeCanvas(w, h) {
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
  function getGranulationTile() {
    if (granulationTile) return granulationTile;
    const c = makeCanvas(GRANULATION_SIZE, GRANULATION_SIZE);
    const ctx = get2d(c);
    const img = ctx.createImageData(GRANULATION_SIZE, GRANULATION_SIZE);
    const rnd = mulberry32(10844759);
    const data = img.data;
    for (let i = 0; i < data.length; i += 4) {
      const v = Math.round(128 + (rnd() * 2 - 1) * 56);
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    granulationTile = c;
    return c;
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
  function densifyJitter(pts, step, amp, rnd) {
    const out = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const segs = Math.max(1, Math.round(len / step));
      for (let k = 0; k < segs; k++) {
        const t = k / segs;
        out.push({
          x: a.x + (b.x - a.x) * t + (rnd() * 2 - 1) * amp,
          y: a.y + (b.y - a.y) * t + (rnd() * 2 - 1) * amp
        });
      }
    }
    return out;
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
  function jitteredSegment(a, b, step, amp, rnd) {
    const out = [];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const segs = Math.max(1, Math.round(len / step));
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      out.push({
        x: a.x + (b.x - a.x) * t + (rnd() * 2 - 1) * amp,
        y: a.y + (b.y - a.y) * t + (rnd() * 2 - 1) * amp
      });
    }
    return out;
  }
  function jitterRectStroke(ctx, x, y, w, h, step, amp, rnd) {
    const c = [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h }
    ];
    for (let i = 0; i < 4; i++) {
      tracePoly(ctx, jitteredSegment(c[i], c[(i + 1) % 4], step, amp, rnd), false);
      ctx.stroke();
    }
  }
  function hslStr(c, hueShift, dl = 0, ds = 0, alpha = 1) {
    const h = ((c.h + hueShift) % 360 + 360) % 360;
    const s = clamp(c.s + ds, 0, 100);
    const l = clamp(c.l + dl, 0, 100);
    return alpha >= 1 ? `hsl(${h} ${s}% ${l}%)` : `hsl(${h} ${s}% ${l}% / ${alpha})`;
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
  var materialTiles = /* @__PURE__ */ new Map();
  var TILE_SIZE = {
    pebble: 128,
    weave: 48,
    linen: 64,
    laid: 64,
    crackle: 160,
    rib: 32,
    morocco: 144,
    kraft: 96
  };
  function paintCrackleTile(ctx, size, rnd) {
    const walk = (x0, y0, angle, len, depth, width) => {
      let x = x0;
      let y = y0;
      let a = angle;
      const seg = 5 + rnd() * 5;
      const steps = Math.max(2, Math.round(len / seg));
      const pts = [{ x, y }];
      for (let i = 0; i < steps; i++) {
        a += (rnd() * 2 - 1) * 0.55;
        x += Math.cos(a) * seg;
        y += Math.sin(a) * seg;
        pts.push({ x, y });
      }
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = `rgba(22,22,22,${(0.26 + rnd() * 0.2).toFixed(3)})`;
      ctx.lineWidth = width;
      tracePoly(ctx, pts, false);
      ctx.stroke();
      ctx.strokeStyle = `rgba(238,238,238,${(0.12 + rnd() * 0.12).toFixed(3)})`;
      ctx.lineWidth = width * 0.7;
      ctx.save();
      ctx.translate(-width * 0.55, -width * 0.55);
      tracePoly(ctx, pts, false);
      ctx.stroke();
      ctx.restore();
      if (depth > 0) {
        const branches = 1 + Math.floor(rnd() * 2);
        for (let b = 0; b < branches; b++) {
          const at = pts[1 + Math.floor(rnd() * (pts.length - 1))];
          walk(
            at.x,
            at.y,
            a + (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.9),
            len * (0.4 + rnd() * 0.3),
            depth - 1,
            Math.max(0.5, width * 0.72)
          );
        }
      }
    };
    for (let i = 0; i < 14; i++) {
      walk(rnd() * size, rnd() * size, rnd() * Math.PI * 2, 40 + rnd() * 70, 2, 1.1 + rnd() * 0.9);
    }
    for (let i = 0; i < 260; i++) {
      const x = rnd() * size;
      const y = rnd() * size;
      const a = rnd() * Math.PI * 2;
      const l = 2 + rnd() * 6;
      ctx.strokeStyle = `rgba(30,30,30,${(0.08 + rnd() * 0.12).toFixed(3)})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
  }
  function weaveCell(ctx, x, y, c, warp, thread, contrast) {
    const half = thread / 2;
    const drawBar = (vertical, over) => {
      const a = over ? contrast : contrast * 0.55;
      const cx = x + c / 2;
      const cy = y + c / 2;
      if (vertical) {
        const g = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
        g.addColorStop(0, `rgba(34,34,34,${(a * 0.9).toFixed(3)})`);
        g.addColorStop(0.42, `rgba(238,238,238,${(a * 0.75).toFixed(3)})`);
        g.addColorStop(1, `rgba(34,34,34,${a.toFixed(3)})`);
        ctx.fillStyle = g;
        ctx.fillRect(cx - half, y - 0.4, thread, c + 0.8);
      } else {
        const g = ctx.createLinearGradient(0, cy - half, 0, cy + half);
        g.addColorStop(0, `rgba(34,34,34,${(a * 0.9).toFixed(3)})`);
        g.addColorStop(0.42, `rgba(238,238,238,${(a * 0.75).toFixed(3)})`);
        g.addColorStop(1, `rgba(34,34,34,${a.toFixed(3)})`);
        ctx.fillStyle = g;
        ctx.fillRect(x - 0.4, cy - half, c + 0.8, thread);
      }
    };
    drawBar(!warp, false);
    drawBar(warp, true);
  }
  function getMaterialTile(kind) {
    const hit = materialTiles.get(kind);
    if (hit) return hit;
    const size = TILE_SIZE[kind];
    const c = makeCanvas(size, size);
    const ctx = get2d(c);
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, size, size);
    const TILE_SEEDS = {
      pebble: 10369815,
      linen: 5357790,
      laid: 1711374,
      weave: 2824100,
      crackle: 13085761,
      rib: 7453677,
      morocco: 3862720,
      kraft: 9249274
    };
    const rnd = mulberry32(TILE_SEEDS[kind]);
    if (kind === "crackle") {
      paintCrackleTile(ctx, size, rnd);
    } else if (kind === "rib") {
      let y = 0;
      while (y < size) {
        const pitch = 3.4 + rnd() * 1.6;
        const g = ctx.createLinearGradient(0, y, 0, y + pitch);
        g.addColorStop(0, "rgba(28,28,28,0.34)");
        g.addColorStop(0.3, "rgba(226,226,226,0.28)");
        g.addColorStop(0.52, "rgba(198,198,198,0.14)");
        g.addColorStop(1, "rgba(24,24,24,0.36)");
        ctx.fillStyle = g;
        ctx.fillRect(0, y, size, pitch);
        y += pitch;
      }
      for (let x = 0; x < size; x += 2.2) {
        ctx.fillStyle = `rgba(160,160,160,${(0.04 + rnd() * 0.05).toFixed(3)})`;
        ctx.fillRect(x, 0, 0.9, size);
      }
    } else if (kind === "morocco") {
      const rows = 9;
      for (let j = 0; j < rows; j++) {
        const cy = (j + 0.5) / rows * size;
        let x = rnd() * 14;
        while (x < size + 14) {
          const rx = 6 + rnd() * 9;
          const ry = 4 + rnd() * 5;
          const yy = cy + (rnd() * 2 - 1) * 5;
          const g = ctx.createRadialGradient(x - rx * 0.35, yy - ry * 0.4, ry * 0.1, x, yy, rx);
          g.addColorStop(0, "rgba(232,232,232,0.26)");
          g.addColorStop(0.7, "rgba(140,140,140,0.05)");
          g.addColorStop(1, "rgba(24,24,24,0.34)");
          ctx.beginPath();
          ctx.ellipse(x, yy, rx, ry, (rnd() * 2 - 1) * 0.35, 0, Math.PI * 2);
          ctx.fillStyle = g;
          ctx.fill();
          x += rx * 1.5 + rnd() * 4;
        }
      }
      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = "rgba(20,20,20,0.16)";
        ctx.fillRect(rnd() * size, rnd() * size, 1.2 + rnd() * 2.6, 1.1);
      }
    } else if (kind === "kraft") {
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = rnd() < 0.5 ? "rgba(60,60,60,0.1)" : "rgba(228,228,228,0.12)";
        ctx.fillRect(rnd() * size, rnd() * size, 0.9 + rnd() * 1.6, 0.9);
      }
      for (let i = 0; i < 70; i++) {
        ctx.save();
        ctx.translate(rnd() * size, rnd() * size);
        ctx.rotate(rnd() * Math.PI);
        ctx.fillStyle = rnd() < 0.4 ? "rgba(48,42,34,0.2)" : "rgba(236,230,216,0.22)";
        ctx.fillRect(0, 0, 6 + rnd() * 22, 0.9 + rnd() * 0.8);
        ctx.restore();
      }
    } else if (kind === "pebble") {
      for (let i = 0; i < 320; i++) {
        const x = rnd() * size;
        const y = rnd() * size;
        const r = 3.4 + rnd() * 6.5;
        const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.34, r * 0.05, x, y, r);
        g.addColorStop(0, "rgba(236,236,236,0.30)");
        g.addColorStop(0.62, "rgba(150,150,150,0.06)");
        g.addColorStop(1, "rgba(28,28,28,0.30)");
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * (0.68 + rnd() * 0.6), rnd() * Math.PI, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
      }
      for (let i = 0; i < 900; i++) {
        const x = rnd() * size;
        const y = rnd() * size;
        const r = 0.8 + rnd() * 2.2;
        ctx.beginPath();
        ctx.ellipse(x, y, r, r * (0.6 + rnd() * 0.7), rnd() * Math.PI, 0, Math.PI * 2);
        ctx.fillStyle = rnd() < 0.55 ? "rgba(30,30,30,0.22)" : "rgba(236,236,236,0.18)";
        ctx.fill();
      }
    } else if (kind === "weave") {
      const cell = size / 12;
      for (let j = 0; j < 12; j++) {
        for (let i = 0; i < 12; i++) {
          weaveCell(ctx, i * cell, j * cell, cell, (i + j) % 2 === 0, cell * 0.72, 0.4);
        }
      }
      ctx.fillStyle = "rgba(220,220,220,0.05)";
      ctx.fillRect(0, 0, size, size);
    } else if (kind === "linen") {
      const cells = 5;
      const cell = size / cells;
      for (let j = 0; j < cells; j++) {
        for (let i = 0; i < cells; i++) {
          weaveCell(
            ctx,
            i * cell,
            j * cell,
            cell,
            (i + j) % 2 === 0,
            cell * (0.52 + rnd() * 0.3),
            0.42 + rnd() * 0.22
          );
        }
      }
      for (let i = 0; i < 18; i++) {
        const x = rnd() * size;
        const y = Math.floor(rnd() * cells) * cell + cell * 0.5;
        ctx.fillStyle = `rgba(26,26,26,${(0.2 + rnd() * 0.2).toFixed(3)})`;
        ctx.fillRect(x, y - cell * 0.22, 5 + rnd() * 11, cell * 0.44);
        ctx.fillStyle = "rgba(240,240,240,0.2)";
        ctx.fillRect(x, y - cell * 0.26, 5 + rnd() * 9, 1.2);
      }
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = "rgba(246,246,246,0.26)";
        ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2.4, 1 + rnd() * 1.4);
      }
    } else {
      for (let x = 0; x < size; x += 3.6) {
        ctx.fillStyle = `rgba(104,104,104,${(0.05 + rnd() * 0.04).toFixed(3)})`;
        ctx.fillRect(x, 0, 1.3, size);
      }
      for (let y = 0; y < size; y += 19) {
        ctx.fillStyle = "rgba(242,242,242,0.34)";
        ctx.fillRect(0, y, size, 1.8);
        ctx.fillStyle = "rgba(64,64,64,0.2)";
        ctx.fillRect(0, y + 2, size, 1.2);
      }
      for (let i = 0; i < 150; i++) {
        ctx.fillStyle = rnd() < 0.5 ? "rgba(48,48,48,0.14)" : "rgba(244,244,244,0.18)";
        ctx.fillRect(rnd() * size, rnd() * size, 0.9 + rnd() * 1.8, 0.9);
      }
      for (let i = 0; i < 14; i++) {
        ctx.save();
        ctx.translate(rnd() * size, rnd() * size);
        ctx.rotate(rnd() * Math.PI);
        ctx.fillStyle = "rgba(228,228,228,0.28)";
        ctx.fillRect(0, 0, 5 + rnd() * 14, 0.9);
        ctx.restore();
      }
    }
    materialTiles.set(kind, c);
    return c;
  }
  function tileOver(ctx, tile, w, h, tileSize, alpha, mode = "overlay") {
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = mode;
    ctx.globalAlpha = alpha;
    for (let ty = 0; ty < h; ty += tileSize) {
      for (let tx = 0; tx < w; tx += tileSize) {
        ctx.drawImage(tile, tx, ty, tileSize, tileSize);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prev;
  }
  function paintMarbledBoard(ctx, w, h, tones, s, rnd, variant = 0) {
    const px = Math.max(0.5, s);
    ctx.save();
    ctx.fillStyle = "rgba(238, 227, 200, 0.5)";
    ctx.fillRect(0, 0, w, h);
    const inks = [
      tones.dark(-8, 8, 1),
      tones.light(2, 6, 1),
      "#7b2f22",
      "#2f4a6b",
      "#6d5a1f",
      "#4a2f52",
      "#2f5340"
    ];
    if (variant === 2) {
      const drops = Math.round(w * h / Math.max(30, 260 * px * px)) + 26;
      for (let i = 0; i < drops; i++) {
        const cx = rnd() * w;
        const cy = rnd() * h;
        const r = (2.2 + rnd() * 7) * px;
        const col = inks[Math.floor(rnd() * inks.length)];
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, withAlpha(col, 0.62));
        g.addColorStop(0.62, withAlpha(col, 0.42));
        g.addColorStop(0.86, "rgba(252, 246, 226, 0.5)");
        g.addColorStop(1, "rgba(252, 246, 226, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * (0.7 + rnd() * 0.6), rnd() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      const bandH = Math.max(2.4 * px, h / (10 + Math.floor(rnd() * 10)));
      const waveLen = Math.max(8 * px, w * (0.55 + rnd() * 0.9));
      const waveAmp = bandH * (0.7 + rnd() * 1.1);
      const phase = rnd() * Math.PI * 2;
      let y = -bandH * 2;
      let bandIndex = 0;
      ctx.lineCap = "round";
      while (y < h + bandH * 2) {
        const col = inks[(bandIndex + Math.floor(rnd() * 2)) % inks.length];
        const thick = bandH * (0.3 + rnd() * 0.7);
        ctx.strokeStyle = withAlpha(col, 0.42 + rnd() * 0.3);
        ctx.lineWidth = thick;
        ctx.beginPath();
        const steps = Math.max(4, Math.ceil(w / Math.max(1.2, 2 * px)));
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const xx = t * w;
          const yy = y + Math.sin(xx / waveLen * Math.PI * 2 + phase + bandIndex * 0.35) * waveAmp;
          if (k === 0) ctx.moveTo(xx, yy);
          else ctx.lineTo(xx, yy);
        }
        ctx.stroke();
        ctx.strokeStyle = "rgba(250, 243, 222, 0.34)";
        ctx.lineWidth = Math.max(0.5, thick * 0.34);
        ctx.stroke();
        y += bandH;
        bandIndex++;
      }
      const teeth = Math.max(3, Math.round(w / Math.max(3, 6 * px)));
      for (let i = 0; i < teeth; i++) {
        const xx = (i + 0.5) / teeth * w;
        const g = ctx.createLinearGradient(xx - px, 0, xx + px, 0);
        g.addColorStop(0, "rgba(40, 30, 18, 0.1)");
        g.addColorStop(0.5, "rgba(252, 246, 226, 0.16)");
        g.addColorStop(1, "rgba(40, 30, 18, 0.1)");
        ctx.fillStyle = g;
        ctx.fillRect(xx - px, 0, px * 2, h);
      }
      if (variant === 1) {
        const step = Math.max(2.4 * px, h * 0.045);
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate(0.12);
        ctx.translate(-w / 2, -h / 2);
        for (let yy = -h * 0.2; yy < h * 1.2; yy += step) {
          const g = ctx.createLinearGradient(0, yy, 0, yy + step);
          g.addColorStop(0, "rgba(30, 22, 12, 0.24)");
          g.addColorStop(0.42, "rgba(255, 250, 232, 0.2)");
          g.addColorStop(1, "rgba(30, 22, 12, 0.2)");
          ctx.fillStyle = g;
          ctx.fillRect(-w * 0.2, yy, w * 1.4, step);
        }
        ctx.restore();
      }
    }
    tileOver(ctx, getMaterialTile("kraft"), w, h, Math.max(30, 54 * px), 0.28);
    tileOver(ctx, getGranulationTile(), w, h, GRANULATION_SIZE * 2, 0.08, "multiply");
    const glaze = ctx.createLinearGradient(0, 0, w, 0);
    glaze.addColorStop(0, "rgba(0,0,0,0.14)");
    glaze.addColorStop(0.38, "rgba(255,250,236,0.14)");
    glaze.addColorStop(1, "rgba(0,0,0,0.12)");
    ctx.fillStyle = glaze;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  function paintBindingMaterial(ctx, w, h, material, tones, s, rnd, boardStyle = 0) {
    const px = Math.max(0.5, s);
    const variant = clamp(Math.round(boardStyle), 0, MAX_BOARD_STYLE);
    ctx.save();
    ctx.lineCap = "round";
    switch (material) {
      case "leather": {
        if (variant === 1) {
          tileOver(ctx, getMaterialTile("morocco"), w, h, Math.max(52, 92 * px), 0.72);
          tileOver(ctx, getMaterialTile("pebble"), w, h, Math.max(30, 54 * px), 0.28);
        } else {
          tileOver(ctx, getMaterialTile("pebble"), w, h, Math.max(44, 78 * px), 0.66);
        }
        tileOver(ctx, getGranulationTile(), w, h, GRANULATION_SIZE * 2, 0.1, "multiply");
        if (variant === 2) {
          tileOver(ctx, getMaterialTile("crackle"), w, h, Math.max(60, 118 * px), 0.68);
          tileOver(ctx, getMaterialTile("crackle"), w, h, Math.max(26, 46 * px), 0.34);
          for (let i = 0; i < 12; i++) {
            const cx = rnd() * w;
            const cy = rnd() * h;
            const r = (1.2 + rnd() * 3.4) * px;
            const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
            g.addColorStop(0, tones.light(26, -28, 0.3));
            g.addColorStop(1, tones.light(26, -28, 0));
            ctx.fillStyle = g;
            ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
          }
        }
        ctx.strokeStyle = tones.dark(-16, 0, 0.16);
        ctx.lineWidth = Math.max(0.7, 1.1 * px);
        for (let i = 0; i < 5; i++) {
          const cy = (0.08 + rnd() * 0.84) * h;
          ctx.beginPath();
          ctx.moveTo(-w * 0.05, cy);
          ctx.quadraticCurveTo(w * 0.5, cy + (rnd() * 2 - 1) * 9 * px, w * 1.05, cy + (rnd() * 2 - 1) * 6 * px);
          ctx.stroke();
        }
        const gloss = variant === 2 ? 0.4 : 1;
        const sheen = ctx.createLinearGradient(0, 0, w, 0);
        sheen.addColorStop(0, `rgba(255,246,226,0)`);
        sheen.addColorStop(0.34, `rgba(255,246,226,${(0.15 * gloss).toFixed(3)})`);
        sheen.addColorStop(0.52, `rgba(255,246,226,${(0.06 * gloss).toFixed(3)})`);
        sheen.addColorStop(1, "rgba(0,0,0,0.1)");
        ctx.fillStyle = sheen;
        ctx.fillRect(0, 0, w, h);
        break;
      }
      case "cloth": {
        if (variant === 1) {
          tileOver(ctx, getMaterialTile("rib"), w, h, Math.max(14, 26 * px), 0.8);
          tileOver(ctx, getMaterialTile("rib"), w, h, Math.max(7, 13 * px), 0.26);
          tileOver(ctx, getMaterialTile("weave"), w, h, Math.max(16, 26 * px), 0.2);
        } else {
          tileOver(ctx, getMaterialTile("weave"), w, h, Math.max(20, 34 * px), 0.72);
        }
        if (variant === 2) {
          const pg = ctx.createLinearGradient(0, 0, w, 0);
          pg.addColorStop(0, "rgba(0,0,0,0.12)");
          pg.addColorStop(0.36, "rgba(255,252,242,0.2)");
          pg.addColorStop(0.62, "rgba(255,252,242,0.06)");
          pg.addColorStop(1, "rgba(0,0,0,0.14)");
          ctx.fillStyle = pg;
          ctx.fillRect(0, 0, w, h);
        } else {
          ctx.fillStyle = "rgba(238, 236, 230, 0.07)";
          ctx.fillRect(0, 0, w, h);
        }
        for (let i = 0; i < 4; i++) {
          const cx = rnd() * w;
          const cy = rnd() * h;
          const r = (0.16 + rnd() * 0.3) * Math.max(w, h);
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, tones.dark(-6, 2, 0.07));
          g.addColorStop(1, tones.dark(-6, 2, 0));
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
        }
        break;
      }
      case "marbled": {
        paintMarbledBoard(ctx, w, h, tones, s, rnd, variant);
        break;
      }
      case "paper": {
        ctx.fillStyle = "rgba(246, 240, 226, 0.12)";
        ctx.fillRect(0, 0, w, h);
        if (variant === 2) {
          tileOver(ctx, getMaterialTile("kraft"), w, h, Math.max(34, 58 * px), 0.6);
        } else {
          tileOver(ctx, getMaterialTile("laid"), w, h, Math.max(40, 68 * px), 0.42);
        }
        if (variant === 1) {
          const cg = ctx.createLinearGradient(0, 0, w, 0);
          cg.addColorStop(0, "rgba(0,0,0,0.08)");
          cg.addColorStop(0.4, "rgba(255,253,246,0.18)");
          cg.addColorStop(1, "rgba(0,0,0,0.1)");
          ctx.fillStyle = cg;
          ctx.fillRect(0, 0, w, h);
        }
        ctx.strokeStyle = tones.light(16, -12, 0.1);
        ctx.lineWidth = Math.max(0.5, 0.7 * px);
        for (let i = 0; i < 9; i++) {
          const xx = rnd() * w;
          const y0 = rnd() * h * 0.6;
          ctx.beginPath();
          ctx.moveTo(xx, y0);
          ctx.quadraticCurveTo(xx + (rnd() * 2 - 1) * 3 * px, y0 + h * 0.2, xx + (rnd() * 2 - 1) * 2 * px, y0 + h * 0.4);
          ctx.stroke();
        }
        for (let i = 0; i < 40; i++) {
          const r = (0.4 + rnd() * 1.3) * px;
          ctx.beginPath();
          ctx.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(126, 88, 46, ${(0.05 + rnd() * 0.13).toFixed(3)})`;
          ctx.fill();
        }
        break;
      }
      case "vellum": {
        ctx.fillStyle = "rgba(242, 231, 199, 0.46)";
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 9; i++) {
          const cx = rnd() * w;
          const cy = rnd() * h;
          const r = (0.1 + rnd() * 0.3) * Math.max(w, h);
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          const dark = rnd() < 0.45;
          g.addColorStop(0, dark ? "rgba(150, 124, 82, 0.16)" : "rgba(255, 250, 232, 0.2)");
          g.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
        }
        ctx.fillStyle = "rgba(122, 96, 58, 0.24)";
        for (let i = 0; i < 90; i++) {
          const x = rnd() * w;
          const y = rnd() * h;
          ctx.fillRect(x, y, 0.9 * px, 0.9 * px);
          if (rnd() < 0.5) ctx.fillRect(x + 1.6 * px, y + 0.7 * px, 0.8 * px, 0.8 * px);
        }
        const vg = ctx.createLinearGradient(0, 0, w, 0);
        vg.addColorStop(0, "rgba(120, 96, 56, 0.14)");
        vg.addColorStop(0.42, "rgba(255, 252, 238, 0.2)");
        vg.addColorStop(1, "rgba(120, 96, 56, 0.16)");
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, w, h);
        break;
      }
      case "linen": {
        tileOver(ctx, getMaterialTile("linen"), w, h, Math.max(26, 44 * px), 0.78);
        ctx.fillStyle = "rgba(226, 208, 172, 0.14)";
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 34; i++) {
          ctx.fillStyle = `rgba(246, 238, 214, ${(0.12 + rnd() * 0.24).toFixed(3)})`;
          ctx.fillRect(rnd() * w, rnd() * h, (1 + rnd() * 3) * px, 0.9 * px);
        }
        break;
      }
      default: {
        const bands = 5;
        for (let i = 0; i < bands; i++) {
          const cx = (i + 0.5) / bands * w;
          const bw = w / bands;
          const g = ctx.createLinearGradient(cx - bw * 0.5, 0, cx + bw * 0.5, 0);
          g.addColorStop(0, "rgba(0,0,0,0.14)");
          g.addColorStop(0.42, "rgba(255,252,240,0.24)");
          g.addColorStop(0.62, "rgba(255,252,240,0.1)");
          g.addColorStop(1, "rgba(0,0,0,0.12)");
          ctx.fillStyle = g;
          ctx.fillRect(cx - bw * 0.5, 0, bw, h);
        }
        ctx.lineWidth = Math.max(0.5, 0.8 * px);
        for (let i = 0; i < 16; i++) {
          const y0 = i / 16 * h + rnd() * h * 0.02;
          ctx.strokeStyle = i % 2 === 0 ? "rgba(255,252,240,0.11)" : tones.dark(-12, 0, 0.09);
          ctx.beginPath();
          ctx.moveTo(0, y0);
          for (let x = 0; x <= w; x += Math.max(2, 3 * px)) {
            ctx.lineTo(x, y0 + Math.sin(x / Math.max(6, w) * 7 + i) * 2.2 * px);
          }
          ctx.stroke();
        }
        const spec = ctx.createLinearGradient(w * 0.2, 0, w * 0.46, 0);
        spec.addColorStop(0, "rgba(255,255,248,0)");
        spec.addColorStop(0.5, "rgba(255,255,248,0.3)");
        spec.addColorStop(1, "rgba(255,255,248,0)");
        ctx.fillStyle = spec;
        ctx.fillRect(w * 0.2, 0, w * 0.26, h);
        break;
      }
    }
    ctx.restore();
  }
  function paintEdgeTreatment(ctx, x, y, w, h, edge, s, rnd) {
    if (w <= 0.4 || h <= 0.4) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    const base = ctx.createLinearGradient(x, 0, x + w, 0);
    base.addColorStop(0, "#cbbc99");
    base.addColorStop(0.35, "#eae0c4");
    base.addColorStop(1, "#c9b995");
    ctx.fillStyle = base;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(96, 82, 58, 0.22)";
    ctx.lineWidth = Math.max(0.4, 0.5 * s);
    const pitch = Math.max(1.4, 2 * s);
    ctx.beginPath();
    for (let yy = y; yy < y + h; yy += pitch) {
      ctx.moveTo(x, yy);
      ctx.lineTo(x + w, yy);
    }
    ctx.stroke();
    if (edge === "gilt") {
      const g = ctx.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, "#8a6a14");
      g.addColorStop(0.3, "#f3dc93");
      g.addColorStop(0.52, "#c9a227");
      g.addColorStop(0.78, "#f7e7ab");
      g.addColorStop(1, "#7d5f12");
      ctx.globalAlpha = 0.94;
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(255, 248, 214, 0.4)";
      ctx.lineWidth = Math.max(0.4, 0.5 * s);
      for (let i = 0; i < 8; i++) {
        const yy = y + rnd() * h;
        ctx.beginPath();
        ctx.moveTo(x, yy);
        ctx.lineTo(x + w, yy + (rnd() * 2 - 1) * 2 * s);
        ctx.stroke();
      }
    } else if (edge === "marbled") {
      const veins = ["#8d3a2a", "#2f4a6b", "#7b6a2c", "#5d3a5c"];
      ctx.globalAlpha = 0.62;
      for (let i = 0; i < 14; i++) {
        const col = veins[Math.floor(rnd() * veins.length)];
        const y0 = y + rnd() * h;
        const amp = (0.9 + rnd() * 2.6) * s;
        const thick = (0.9 + rnd() * 2.4) * s;
        ctx.strokeStyle = col;
        ctx.lineWidth = thick;
        ctx.beginPath();
        ctx.moveTo(x - 1, y0);
        const steps = Math.max(2, Math.ceil(w / Math.max(1, s)));
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          ctx.lineTo(x + t * (w + 2), y0 + Math.sin(t * 6 + i) * amp);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = "#f0e6cb";
      ctx.lineWidth = Math.max(0.4, 0.6 * s);
      for (let i = 0; i < 18; i++) {
        const yy = y + rnd() * h;
        ctx.beginPath();
        ctx.moveTo(x, yy);
        ctx.lineTo(x + w, yy + 3 * s);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (edge === "speckled") {
      const specks = ["#7a3a24", "#4a3c2a", "#8f6a24"];
      const count = Math.max(24, Math.round(w * h / Math.max(2, 6 * s * s)));
      for (let i = 0; i < count; i++) {
        ctx.fillStyle = specks[Math.floor(rnd() * specks.length)];
        ctx.globalAlpha = 0.25 + rnd() * 0.5;
        const r = (0.3 + rnd() * 0.9) * s;
        ctx.beginPath();
        ctx.arc(x + rnd() * w, y + rnd() * h, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    const sh = ctx.createLinearGradient(x, 0, x + Math.max(1, w * 0.4), 0);
    sh.addColorStop(0, "rgba(38, 30, 20, 0.45)");
    sh.addColorStop(1, "rgba(38, 30, 20, 0)");
    ctx.fillStyle = sh;
    ctx.fillRect(x, y, Math.max(1, w * 0.4), h);
    ctx.restore();
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
  function paintWear(ctx, w, h, wear, tones, s, rnd) {
    if (wear <= 0.02) return;
    const px = Math.max(0.5, s);
    ctx.save();
    const fadeC = w * 0.4;
    const fadeR = w * (0.34 + wear * 0.34);
    const fade = ctx.createLinearGradient(fadeC - fadeR, 0, fadeC + fadeR, 0);
    const fadeA = 0.06 + wear * 0.2;
    fade.addColorStop(0, "rgba(222, 210, 182, 0)");
    fade.addColorStop(0.34, `rgba(224, 212, 184, ${(fadeA * 0.75).toFixed(3)})`);
    fade.addColorStop(0.52, `rgba(226, 214, 186, ${fadeA.toFixed(3)})`);
    fade.addColorStop(1, "rgba(222, 210, 182, 0)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "saturation";
    ctx.globalAlpha = 0.14 + wear * 0.4;
    const sat = ctx.createLinearGradient(fadeC - fadeR, 0, fadeC + fadeR, 0);
    sat.addColorStop(0, "hsl(0 0% 60% / 0)");
    sat.addColorStop(0.5, "hsl(0 0% 60%)");
    sat.addColorStop(1, "hsl(0 0% 60% / 0)");
    ctx.fillStyle = sat;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    const scuffs = Math.round(3 + wear * 16);
    ctx.lineCap = "round";
    for (let i = 0; i < scuffs; i++) {
      const edgeX = rnd() < 0.5 ? (0.6 + rnd() * 1.6) * px : w - (0.6 + rnd() * 1.6) * px;
      const wy = rnd() * h;
      const len = (4 + rnd() * 22) * px;
      ctx.strokeStyle = tones.light(28 + rnd() * 14, -20, 0.14 + wear * 0.34);
      ctx.lineWidth = (0.5 + rnd() * 0.9) * px;
      ctx.beginPath();
      ctx.moveTo(edgeX, wy);
      ctx.lineTo(edgeX + (rnd() * 2 - 1) * 1.2 * px, wy + len);
      ctx.stroke();
    }
    if (wear > 0.3) {
      const patches = Math.round(1 + wear * 5);
      for (let i = 0; i < patches; i++) {
        const cx = rnd() < 0.5 ? (1 + rnd() * 3) * px : w - (1 + rnd() * 3) * px;
        const cy = rnd() * h;
        const rx = (2 + rnd() * 5) * px;
        const ry = (5 + rnd() * 26) * px;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
        g.addColorStop(0, tones.light(30, -26, 0.34 * wear));
        g.addColorStop(1, tones.light(30, -26, 0));
        ctx.fillStyle = g;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry));
        ctx.fillRect(-Math.max(rx, ry), -Math.max(rx, ry), Math.max(rx, ry) * 2, Math.max(rx, ry) * 2);
        ctx.restore();
      }
    }
    for (const [cx, cy] of [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h]
    ]) {
      const r = (1.6 + wear * 6 + rnd() * 2) * px;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, tones.light(34, -28, 0.2 + wear * 0.42));
      g.addColorStop(1, tones.light(34, -28, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    const grime = ctx.createLinearGradient(0, h * 0.86, 0, h);
    grime.addColorStop(0, "rgba(44, 34, 22, 0)");
    grime.addColorStop(1, `rgba(44, 34, 22, ${(0.08 + wear * 0.22).toFixed(3)})`);
    ctx.fillStyle = grime;
    ctx.fillRect(0, h * 0.86, w, h * 0.14);
    if (wear > 0.8) {
      const t = (wear - 0.8) / 0.2;
      for (const capY of [0, h]) {
        const dir = capY === 0 ? 1 : -1;
        const capH = (2.5 + t * 5) * px;
        const g = ctx.createLinearGradient(0, capY, 0, capY + dir * capH);
        g.addColorStop(0, tones.light(36, -32, 0.3 + t * 0.34));
        g.addColorStop(1, tones.light(36, -32, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, Math.min(capY, capY + dir * capH), w, capH);
        ctx.fillStyle = tones.light(30, -30, 0.24 + t * 0.3);
        const nx = (0.2 + rnd() * 0.6) * w;
        ctx.beginPath();
        ctx.ellipse(nx, capY, (1.6 + rnd() * 3) * px, (1.4 + t * 3.4) * px, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (wear > 0.62) {
      ctx.strokeStyle = "rgba(38, 28, 18, 0.34)";
      ctx.lineWidth = Math.max(0.4, 0.6 * px);
      const cracks = Math.round((wear - 0.62) * 12);
      for (let i = 0; i < cracks; i++) {
        const x0 = rnd() < 0.5 ? 1.5 * px : w - 1.5 * px;
        const y0 = rnd() < 0.5 ? rnd() * h * 0.22 : h * (0.78 + rnd() * 0.22);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        let cxp = x0;
        let cyp = y0;
        for (let k = 0; k < 4; k++) {
          cxp += (rnd() * 2 - 1) * 3 * px;
          cyp += (rnd() < 0.5 ? -1 : 1) * (2 + rnd() * 5) * px;
          ctx.lineTo(cxp, cyp);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
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
    const tones = {
      light: (dl = 0, ds = 0, a = 1) => hslStr(colA, hue, dl, ds, a),
      dark: (dl = 0, ds = 0, a = 1) => hslStr(colB, hue, dl, ds, a)
    };
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
    ctx.save();
    ctx.translate(x, y);
    const outline = applyOutlineWear(
      silhouetteOutline(params.silhouette, w, h),
      clamp(wear + knock * 0.45, 0, 1),
      scale,
      rnd
    );
    const step = Math.max(4, 6 * scale);
    const fillPts = densifyJitter(outline, step, 0.6 * scale, rnd);
    tracePoly(ctx, fillPts, true);
    ctx.fillStyle = hslStr(colA, hue);
    ctx.fill();
    ctx.save();
    tracePoly(ctx, fillPts, true);
    ctx.clip();
    const g1 = ctx.createLinearGradient(0, 0, 0, h);
    g1.addColorStop(0, hslStr(colA, hue, 8));
    g1.addColorStop(0.55, hslStr(colA, hue));
    g1.addColorStop(1, hslStr(colB, hue));
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = g1;
    ctx.fillRect(-w * 0.05, 0, w * 1.1, h);
    const g2 = ctx.createLinearGradient(0, 0, w, 0);
    g2.addColorStop(0, hslStr(colB, hue, -6));
    g2.addColorStop(0.18, hslStr(colA, hue, 10));
    g2.addColorStop(0.82, hslStr(colA, hue, 6));
    g2.addColorStop(1, hslStr(colB, hue, -8));
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = g2;
    ctx.fillRect(-w * 0.05, 0, w * 1.1, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    if (params.twoTone) {
      const splitY = params.twoToneSplit * h;
      const g3 = ctx.createLinearGradient(0, 0, 0, splitY);
      g3.addColorStop(0, hslStr(colB, hue, -2, 4, 0.92));
      g3.addColorStop(1, hslStr(colB, hue, -10, 2, 0.92));
      ctx.fillStyle = g3;
      ctx.fillRect(-w * 0.05, 0, w * 1.1, splitY);
      if (params.gilt) {
        ctx.fillStyle = GOLD2;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(w * 0.04, splitY - 1.1 * scale, w * 0.92, 2.2 * scale);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = hslStr(colB, hue, -22, 0, 0.7);
      ctx.lineWidth = Math.max(0.7, 0.8 * scale);
      strokePts(
        ctx,
        jitteredSegment({ x: 0, y: splitY }, { x: w, y: splitY }, step, 0.4 * scale, rnd),
        false
      );
    }
    tracePoly(ctx, fillPts, true);
    ctx.lineWidth = 4 * scale;
    ctx.strokeStyle = hslStr(colB, hue, -12, 0, 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;
    paintBindingMaterial(ctx, w, h, material, tones, scale, rnd, boardStyle);
    if (round > 0.03) {
      const crown = clamp(0.5 + keySide * 0.16 * (lightOn ? 1 : 0), 0.2, 0.8);
      const rg = ctx.createLinearGradient(0, 0, w, 0);
      const deep = 0.34 * round;
      const lift = 0.26 * round;
      rg.addColorStop(0, hslStr(colB, hue, -30, 0, deep));
      rg.addColorStop(Math.max(0.06, crown - 0.34), hslStr(colB, hue, -14, 0, deep * 0.35));
      rg.addColorStop(crown, hslStr(colA, hue, 22, -6, lift));
      rg.addColorStop(Math.min(0.94, crown + 0.34), hslStr(colB, hue, -16, 0, deep * 0.42));
      rg.addColorStop(1, hslStr(colB, hue, -32, 0, deep * 1.05));
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, w, h);
      const jointR = Math.max(0.8, w * 0.1);
      applyCreaseOcclusion(ctx, {
        rig,
        x: 0,
        y: 0,
        length: h,
        axis: "vertical",
        reach: jointR,
        strength: 0.7 * round,
        bias: 0.55
      });
      applyCreaseOcclusion(ctx, {
        rig,
        x: w,
        y: 0,
        length: h,
        axis: "vertical",
        reach: jointR,
        strength: 0.7 * round,
        bias: -0.55
      });
    }
    const blockFrac = clamp(params.pageBlock ?? 0.1, 0.05, 0.24);
    const edgeW = opts.pageBlock === false ? 0 : clamp(w * blockFrac, 2.2 * scale, 9 * scale);
    if (edgeW > 0.5) {
      const blockX = keySide > 0 ? w - edgeW : 0;
      paintEdgeTreatment(ctx, blockX, h * 0.012, edgeW, h * 0.976, edge, scale, rnd);
      if (lightOn) {
        applyKeyLight(ctx, {
          rig,
          x: blockX,
          y: h * 0.012,
          width: edgeW,
          height: h * 0.976,
          intensity: keyTake * 1.15,
          hotSpot: 0.2
        });
      }
      castContactShadow(ctx, {
        rig,
        x: keySide > 0 ? blockX : blockX + edgeW,
        y: h * 0.012,
        length: h * 0.976,
        depth: Math.max(1.2, edgeW * 0.6),
        side: keySide > 0 ? "left" : "right",
        strength: 0.7,
        skew: 0
      });
      const capH = Math.max(0.8, 1.6 * scale);
      const capG = ctx.createLinearGradient(0, 0, 0, capH * 2.4);
      capG.addColorStop(0, "rgba(246, 238, 214, 0.7)");
      capG.addColorStop(1, "rgba(246, 238, 214, 0)");
      ctx.fillStyle = capG;
      ctx.fillRect(blockX, 0, edgeW, capH * 2.4);
    }
    const inkBand = hslStr(colB, hue, -18, 0, 0.8);
    const embossLight = hslStr(colA, hue, 26, -8, 0.5);
    const legacyBands = raisedBands > 0 ? [] : params.bands;
    for (const band of legacyBands) {
      const by = band.y * h;
      if (band.kind === 0) {
        ctx.lineWidth = Math.max(0.7, 0.7 * scale);
        for (const dy of [-1.8 * scale, 1.8 * scale]) {
          ctx.strokeStyle = embossLight;
          strokePts(ctx, jitteredSegment({ x: w * 0.06, y: by + dy - 0.9 * scale }, { x: w * 0.94, y: by + dy - 0.9 * scale }, step, 0.35 * scale, rnd), false);
          ctx.strokeStyle = inkBand;
          strokePts(ctx, jitteredSegment({ x: w * 0.06, y: by + dy }, { x: w * 0.94, y: by + dy }, step, 0.4 * scale, rnd), false);
        }
      } else if (band.kind === 1) {
        ctx.fillStyle = hslStr(colB, hue, -8, 0, 0.65);
        ctx.fillRect(0, by - 3 * scale, w, 6 * scale);
        ctx.strokeStyle = embossLight;
        ctx.lineWidth = Math.max(0.6, 0.6 * scale);
        strokePts(ctx, jitteredSegment({ x: 0, y: by - 3.8 * scale }, { x: w, y: by - 3.8 * scale }, step, 0.35 * scale, rnd), false);
        ctx.strokeStyle = inkBand;
        ctx.lineWidth = Math.max(0.7, 0.7 * scale);
        for (const dy of [-3 * scale, 3 * scale]) {
          strokePts(ctx, jitteredSegment({ x: 0, y: by + dy }, { x: w, y: by + dy }, step, 0.4 * scale, rnd), false);
        }
      } else {
        ctx.fillStyle = hslStr(colB, hue, -20, 0, 0.4);
        ctx.fillRect(w * 0.05, by + 1.2 * scale, w * 0.9, 1.2 * scale);
        ctx.fillStyle = GOLD2;
        const prevAlpha = ctx.globalAlpha;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(w * 0.05, by - 1.4 * scale, w * 0.9, 2.8 * scale);
        ctx.globalAlpha = prevAlpha;
        ctx.fillStyle = "rgba(255, 244, 214, 0.55)";
        ctx.fillRect(w * 0.08, by - 1.4 * scale, w * 0.84, 0.8 * scale);
        ctx.strokeStyle = hslStr(colB, hue, -20, 0, 0.5);
        ctx.lineWidth = Math.max(0.5, 0.5 * scale);
        strokePts(ctx, jitteredSegment({ x: w * 0.05, y: by }, { x: w * 0.95, y: by }, step, 0.3 * scale, rnd), false);
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
    const cordH = clamp(w * 0.24, 4.2 * scale, 11 * scale);
    for (const cy of cordYs) {
      const by = cy * h;
      const top = by - cordH / 2;
      castContactShadow(ctx, {
        rig,
        x: -w * 0.02,
        y: top + cordH,
        length: w * 1.04,
        depth: cordH * 0.95,
        side: "below",
        strength: 0.85,
        gap: cordH * 0.25,
        skew: cordH * 0.4,
        taper: w * 0.1
      });
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, top, w, cordH);
      ctx.clip();
      ctx.fillStyle = hslStr(colA, hue, 6, -4, 0.9);
      ctx.fillRect(0, top, w, cordH);
      ctx.fillStyle = cylinderShading(ctx, rig, w / 2, top + cordH / 2, cordH / 2, 0);
      ctx.fillRect(0, top, w, cordH);
      tileOver(
        ctx,
        getMaterialTile(material === "leather" && boardStyle === 1 ? "morocco" : "pebble"),
        w,
        cordH,
        Math.max(20, 44 * scale),
        0.2
      );
      ctx.restore();
      const crownY = top + cordH * (keySide > 0 ? 0.3 : 0.32);
      ctx.lineWidth = Math.max(0.6, 0.8 * scale);
      ctx.strokeStyle = withAlpha(blowOut(rig.rimColour, 0.4), 0.42 * keyTake);
      strokePts(
        ctx,
        jitteredSegment({ x: 0, y: crownY }, { x: w, y: crownY }, step, 0.3 * scale, rnd),
        false
      );
      ctx.strokeStyle = hslStr(colB, hue, -34, 0, 0.55);
      ctx.lineWidth = Math.max(0.5, 0.6 * scale);
      for (const sy of [top, top + cordH]) {
        strokePts(
          ctx,
          jitteredSegment({ x: 0, y: sy }, { x: w, y: sy }, step, 0.3 * scale, rnd),
          false
        );
      }
      if (bandGilt) {
        for (const gy of [top - cordH * 0.34, top + cordH * 1.12]) {
          const gh = Math.max(0.8, 1.2 * scale);
          ctx.fillStyle = hslStr(colB, hue, -30, 0, 0.45);
          ctx.fillRect(w * 0.07, gy + gh * 0.85, w * 0.86, gh * 0.8);
          ctx.fillStyle = GOLD2;
          ctx.globalAlpha = 0.92;
          ctx.fillRect(w * 0.07, gy, w * 0.86, gh);
          ctx.globalAlpha = 1;
          ctx.fillStyle = "rgba(255, 246, 216, 0.5)";
          ctx.fillRect(w * 0.07, gy, w * 0.86, gh * 0.4);
        }
        if (lightOn) {
          applySpecularCatch(ctx, {
            rig,
            x: w * (keySide > 0 ? 0.72 : 0.28),
            y: top - cordH * 0.34,
            radius: Math.max(1.4, w * 0.16),
            aspect: 3.4,
            angle: 0,
            strength: 0.55 * keyTake,
            colour: "#fff2c0"
          });
        }
      }
    }
    if (params.headTail) {
      const bandH = 3.2 * scale;
      const stripeW = Math.max(1.5 * scale, 2);
      const capColor = params.gilt ? GOLD2 : hslStr(colB, hue, -6, -6);
      const creamColor = "hsl(41 40% 82%)";
      for (const [cy0, edgeY] of [
        [0.6 * scale, 0],
        [h - bandH - 0.6 * scale, h]
      ]) {
        ctx.fillStyle = creamColor;
        ctx.globalAlpha = 0.62;
        ctx.fillRect(w * 0.04, cy0, w * 0.92, bandH);
        ctx.globalAlpha = 0.62;
        ctx.fillStyle = capColor;
        if (headTailStyle === 1) {
          for (let sx = w * 0.02; sx < w * 0.98; sx += stripeW * 2) {
            ctx.beginPath();
            ctx.moveTo(sx, cy0 + bandH);
            ctx.lineTo(sx + stripeW, cy0 + bandH);
            ctx.lineTo(sx + stripeW + bandH * 0.8, cy0);
            ctx.lineTo(sx + bandH * 0.8, cy0);
            ctx.closePath();
            ctx.fill();
          }
        } else if (headTailStyle === 2) {
          ctx.globalAlpha = 0.6;
          ctx.fillStyle = creamColor;
          ctx.fillRect(w * 0.04, cy0, w * 0.92, bandH);
          ctx.globalAlpha = 0.62;
          ctx.strokeStyle = capColor;
          ctx.lineWidth = Math.max(0.7, 0.9 * scale);
          for (let sx = w * 0.03; sx < w * 0.99; sx += stripeW * 1.35) {
            ctx.beginPath();
            ctx.moveTo(sx, cy0 + bandH);
            ctx.lineTo(sx + bandH * 0.75, cy0);
            ctx.stroke();
          }
          ctx.strokeStyle = "rgba(255, 250, 232, 0.32)";
          ctx.lineWidth = Math.max(0.5, 0.6 * scale);
          ctx.beginPath();
          ctx.moveTo(w * 0.05, cy0 + bandH * 0.3);
          ctx.lineTo(w * 0.95, cy0 + bandH * 0.3);
          ctx.stroke();
        } else {
          for (let sx = w * 0.04; sx < w * 0.96; sx += stripeW * 2) {
            ctx.fillRect(sx, cy0, Math.min(stripeW, w * 0.96 - sx), bandH);
          }
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = hslStr(colB, hue, -24, 0, 0.4);
        ctx.lineWidth = Math.max(0.5, 0.5 * scale);
        const seamY = edgeY === 0 ? cy0 + bandH : cy0;
        strokePts(ctx, jitteredSegment({ x: w * 0.03, y: seamY }, { x: w * 0.97, y: seamY }, step, 0.35 * scale, rnd), false);
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
      const maxFont = clamp(w * 0.52, 10 * scale, 20 * scale);
      const minFont = Math.max(6.5 * scale, maxFont * 0.52);
      const fitLen = Math.max(0, availLen - pad * 0.9);
      let fontPx = maxFont;
      let text = title.trim();
      const measure = (t) => {
        ctx.font = `${fontPx.toFixed(2)}px ${family}`;
        let sum = 0;
        for (const ch of t) sum += ctx.measureText(ch).width;
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
      ctx.font = `${fontPx.toFixed(2)}px ${family}`;
      const glyphs = [];
      let textLen = 0;
      for (const ch of text) {
        const cw = ctx.measureText(ch).width;
        glyphs.push({ ch, adv: cw });
        textLen += cw;
      }
      const plateLen = textLen > 0 ? Math.min(availLen, textLen + pad * 2.6) : Math.min(availLen, (py1 - py0) * 0.6);
      const plateW = Math.min(w * 0.78, fontPx * 1.9);
      const plateX = w * 0.5 - plateW / 2;
      const plateY = (py0 + py1) / 2 - plateLen / 2;
      if (titlePlate !== "none" && plateLen > 6 * scale) {
        ctx.save();
        if (titlePlate === "gilt") {
          ctx.fillStyle = hslStr(colB, hue, -8, 2, 0.32);
          ctx.fillRect(plateX, plateY, plateW, plateLen);
          ctx.strokeStyle = GOLD2;
          ctx.lineWidth = Math.max(0.9, 1.3 * scale);
          jitterRectStroke(ctx, plateX, plateY, plateW, plateLen, step, 0.4 * scale, rnd);
          ctx.strokeStyle = "rgba(201, 162, 39, 0.55)";
          ctx.lineWidth = Math.max(0.5, 0.7 * scale);
          const gi = Math.min(3.2 * scale, plateW * 0.14, plateLen * 0.1);
          jitterRectStroke(ctx, plateX + gi, plateY + gi, plateW - gi * 2, plateLen - gi * 2, step, 0.35 * scale, rnd);
        } else if (titlePlate === "label") {
          ctx.fillStyle = "rgba(40, 32, 22, 0.32)";
          ctx.fillRect(plateX + 1.2 * scale, plateY + 1.6 * scale, plateW, plateLen);
          ctx.fillStyle = "#efe3c4";
          ctx.fillRect(plateX, plateY, plateW, plateLen);
          ctx.strokeStyle = "rgba(120, 96, 58, 0.55)";
          ctx.lineWidth = Math.max(0.5, 0.7 * scale);
          jitterRectStroke(ctx, plateX + 1.8 * scale, plateY + 1.8 * scale, plateW - 3.6 * scale, plateLen - 3.6 * scale, step, 0.4 * scale, rnd);
          ctx.strokeStyle = "rgba(150, 124, 82, 0.4)";
          jitterRectStroke(ctx, plateX, plateY, plateW, plateLen, step, 0.5 * scale, rnd);
        } else {
          ctx.fillStyle = hslStr(colB, hue, -12, 0, 0.4);
          ctx.fillRect(plateX, plateY, plateW, plateLen);
          ctx.strokeStyle = hslStr(colB, hue, -32, 0, 0.7);
          ctx.lineWidth = Math.max(0.7, 1 * scale);
          ctx.beginPath();
          ctx.moveTo(plateX, plateY + plateLen);
          ctx.lineTo(plateX, plateY);
          ctx.lineTo(plateX + plateW, plateY);
          ctx.stroke();
          ctx.strokeStyle = hslStr(colA, hue, 28, -8, 0.55);
          ctx.beginPath();
          ctx.moveTo(plateX + plateW, plateY);
          ctx.lineTo(plateX + plateW, plateY + plateLen);
          ctx.lineTo(plateX, plateY + plateLen);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (glyphs.length > 0) {
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const lift = material === "vellum" ? 20 : material === "paper" ? 9 : 0;
        const panelL = colA.l * 0.55 + colB.l * 0.45 + lift + wear * 6;
        const onLabel = titlePlate === "label";
        const goldTitle = !onLabel && (titlePlate === "gilt" || params.gilt);
        const paleTitle = !onLabel && !goldTitle && panelL < 48;
        const titleInk = onLabel ? hslStr(colB, hue, -34, 6, 0.95) : goldTitle ? GOLD2 : paleTitle ? hslStr(colA, hue, clamp(94 - colA.l, 0, 100), -46, 0.94) : hslStr(colB, hue, -38, 0, 0.94);
        const reliefInk = onLabel ? null : paleTitle ? hslStr(colB, hue, -30, 0, 0.5) : hslStr(colA, hue, 26, -12, 0.5);
        const runY0 = (py0 + py1) / 2 - textLen / 2;
        ctx.save();
        ctx.translate(w / 2, runY0);
        ctx.rotate(Math.PI / 2);
        let advance = 0;
        for (const g of glyphs) {
          const wob = (trnd() * 1.2 - 0.6) * scale;
          if (reliefInk !== null) {
            ctx.fillStyle = hslStr(colB, hue, -34, 0, 0.4);
            ctx.fillText(g.ch, advance - 0.55 * scale * keySide, wob - 0.6 * scale);
            ctx.fillStyle = reliefInk;
            ctx.fillText(g.ch, advance + 0.75 * scale, wob + 0.75 * scale);
          }
          if (goldTitle) {
            const gg = ctx.createLinearGradient(advance, -fontPx * 0.55, advance, fontPx * 0.55);
            gg.addColorStop(0, "#8a6a14");
            gg.addColorStop(0.28, "#f5e29b");
            gg.addColorStop(0.5, GOLD2);
            gg.addColorStop(0.74, "#fff2c4");
            gg.addColorStop(1, "#7d5f12");
            ctx.fillStyle = gg;
          } else {
            ctx.fillStyle = titleInk;
          }
          ctx.fillText(g.ch, advance, wob);
          advance += g.adv;
        }
        ctx.restore();
        if (goldTitle) {
          const runLen = textLen;
          const runX0 = w / 2 - fontPx * 0.6;
          if (foilWear > 0.04 && runLen > 2) {
            const rubs = Math.round(4 + foilWear * 26);
            for (let i = 0; i < rubs; i++) {
              const ry = runY0 + trnd() * runLen;
              const rx = w / 2 + (trnd() * 2 - 1) * fontPx * 0.55;
              const rr = (0.6 + trnd() * 2.4) * scale * (0.5 + foilWear);
              const g = ctx.createRadialGradient(rx, ry, 0, rx, ry, rr);
              const a = clamp(foilWear * (0.35 + trnd() * 0.6), 0, 0.9);
              g.addColorStop(0, hslStr(colB, hue, -6, 0, a));
              g.addColorStop(1, hslStr(colB, hue, -6, 0, 0));
              ctx.fillStyle = g;
              ctx.fillRect(rx - rr, ry - rr, rr * 2, rr * 2);
            }
            if (foilWear > 0.55) {
              ctx.fillStyle = hslStr(colB, hue, -4, 0, (foilWear - 0.55) * 0.5);
              ctx.fillRect(runX0, runY0 - fontPx * 0.4, fontPx * 1.3, runLen + fontPx * 0.8);
            }
          }
          if (lightOn) {
            const catchAt = clamp(0.24 + rowPhase * 0.5, 0, 1);
            applySpecularCatch(ctx, {
              rig,
              x: w / 2 + keySide * fontPx * 0.14,
              y: runY0 + runLen * catchAt,
              radius: Math.max(2, fontPx * 0.85),
              aspect: 0.42,
              angle: Math.PI / 2,
              strength: clamp((1 - foilWear * 0.7) * keyTake * 1.1, 0, 1.3),
              colour: "#fff6d2"
            });
            applySpecularCatch(ctx, {
              rig,
              x: w / 2,
              y: runY0 + runLen * 0.5,
              radius: Math.max(3, runLen * 0.4),
              aspect: 0.2,
              angle: Math.PI / 2,
              strength: clamp((1 - foilWear) * keyTake * 0.32, 0, 0.6),
              colour: "#ffe9a8"
            });
          }
        }
      }
    }
    if (ornamentOn && !charmTakesOrnamentSlot(charm)) {
      const oPanel = ornamentPanel ?? { y0: 0.7, y1: 0.9 };
      const ocy = (oPanel.y0 + oPanel.y1) / 2 * h;
      const oSize = Math.min(w * 0.36, 14 * scale, (oPanel.y1 - oPanel.y0) * h / 2.1);
      const inkColor = params.gilt ? GOLD2 : hslStr(colB, hue, -24, 0, 0.85);
      ctx.strokeStyle = inkColor;
      ctx.fillStyle = inkColor;
      ctx.lineWidth = Math.max(1, 1.1 * scale);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      drawOrnament(ctx, params.ornament, w / 2, ocy, Math.max(2, oSize), rnd);
    }
    const tile = getGranulationTile();
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = 0.06;
    for (let ty = 0; ty < h; ty += GRANULATION_SIZE) {
      for (let tx = 0; tx < w; tx += GRANULATION_SIZE) {
        ctx.drawImage(tile, tx, ty);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    paintWear(ctx, w, h, wear, tones, scale, rnd);
    if (charm !== "none") {
      drawSpineCharm(ctx, charm, w, h, {
        color: charmColorCss(params.charmColor ?? 0),
        scale,
        rnd: mulberry32((params.seed ^ 50343) >>> 0),
        gilt: params.gilt
      });
    }
    if (lightOn) {
      applyAmbientOcclusion(ctx, {
        rig,
        x: 0,
        y: 0,
        width: w,
        height: h,
        edges: ["bottom"],
        reach: Math.min(h * 0.3, 30 * scale),
        strength: 0.9 + depth * 0.4,
        corners: false
      });
      applyAmbientOcclusion(ctx, {
        rig,
        x: 0,
        y: 0,
        width: w,
        height: h,
        edges: ["top"],
        reach: Math.min(h * 0.22, 22 * scale),
        strength: 0.62 + depth * 0.5,
        corners: false
      });
      applyAmbientOcclusion(ctx, {
        rig,
        x: 0,
        y: 0,
        width: w,
        height: h,
        edges: ["left", "right"],
        reach: Math.max(1, w * 0.22),
        strength: 0.34 + depth * 0.5,
        corners: true
      });
      if (sunFade > 0.05) {
        const fx = keySide > 0 ? w : 0;
        const fg = ctx.createLinearGradient(fx, 0, fx - keySide * w * 0.85, 0);
        const fa = sunFade * 0.3 * (0.4 + rowPhase * 0.9);
        fg.addColorStop(0, `rgba(236, 224, 196, ${fa.toFixed(3)})`);
        fg.addColorStop(0.55, `rgba(236, 224, 196, ${(fa * 0.4).toFixed(3)})`);
        fg.addColorStop(1, "rgba(236, 224, 196, 0)");
        ctx.fillStyle = fg;
        ctx.fillRect(0, 0, w, h);
        ctx.save();
        ctx.globalCompositeOperation = "saturation";
        ctx.globalAlpha = sunFade * 0.34;
        const sg = ctx.createLinearGradient(fx, 0, fx - keySide * w * 0.85, 0);
        sg.addColorStop(0, "hsl(0 0% 55%)");
        sg.addColorStop(1, "hsl(0 0% 55% / 0)");
        ctx.fillStyle = sg;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
      applyKeyLight(ctx, {
        rig,
        x: 0,
        y: 0,
        width: w,
        height: h,
        intensity: keyTake,
        // A book facing the viewer takes the key almost head-on; the surface
        // normal is straight out of the frame, which the 2D rig treats as
        // "fully facing", so the modulation lives in `keyTake` instead.
        hotSpot: rig.hotSpot * clamp(keyTake, 0, 1) * (material === "silk" ? 1.3 : 1)
      });
      const edgesLit = litEdges(rig).filter((e) => e !== "bottom");
      applyRimLight(ctx, {
        rig,
        x: 0,
        y: 0,
        width: w,
        height: h,
        edges: edgesLit,
        thickness: Math.max(1, w * 0.14),
        strength: keyTake * (material === "vellum" || material === "silk" ? 1.25 : 1)
      });
      if (opts.neighbourLeft) {
        applyColourBleed(ctx, {
          x: 0,
          y: 0,
          width: w,
          height: h,
          colour: opts.neighbourLeft,
          from: "left",
          reach: Math.max(1.5, w * 0.4),
          strength: 0.13
        });
      }
      if (opts.neighbourRight) {
        applyColourBleed(ctx, {
          x: 0,
          y: 0,
          width: w,
          height: h,
          colour: opts.neighbourRight,
          from: "right",
          reach: Math.max(1.5, w * 0.4),
          strength: 0.13
        });
      }
      if (depth > 0.55) {
        applyAtmosphericHaze(ctx, {
          rig,
          x: 0,
          y: 0,
          width: w,
          height: h,
          depth: (depth - 0.55) / 0.45,
          strength: 0.85
        });
      }
    }
    ctx.restore();
    ctx.strokeStyle = GRAPHITE;
    ctx.lineWidth = Math.max(0.8, 0.9 * scale);
    ctx.lineJoin = "round";
    const passA = densifyJitter(outline, step, 0.7 * scale, rnd);
    tracePoly(ctx, passA, true);
    ctx.stroke();
    const passB = densifyJitter(outline, step, 0.55 * scale, rnd);
    ctx.save();
    ctx.translate(0.5 * scale, -0.4 * scale);
    tracePoly(ctx, passB, true);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
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
