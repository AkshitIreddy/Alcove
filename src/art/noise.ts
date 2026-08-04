/**
 * art/noise.ts — deterministic randomness primitives for the art pipeline.
 *
 * Everything in src/art must be reproducible from a 32-bit seed so baked
 * rasters and spine geometry are identical across sessions. No dependency on
 * seedrandom: mulberry32 + fnv1a are inlined per the art-pipeline design doc.
 */

import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';

/** A deterministic replacement for Math.random(): returns values in [0, 1). */
export type RandomFn = () => number;

/**
 * mulberry32 — tiny, fast, high-quality-enough seeded PRNG.
 * Same seed ⇒ same sequence, forever.
 */
export function mulberry32(seed: number): RandomFn {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit FNV-1a string hash — used to derive seeds (e.g. from a book id). */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 1D noise function: x ↦ value in [-1, 1]. */
export type NoiseFunction1D = (x: number) => number;

/**
 * Seeded 2D simplex noise (simplex-noise package fed by a mulberry32 source).
 * Deterministic per seed.
 */
export function seededNoise2D(seed: number): NoiseFunction2D {
  return createNoise2D(mulberry32(seed));
}

/**
 * Seeded 1D simplex noise — a 2D field sampled along a fixed-y line.
 * (simplex-noise has no native 1D variant.)
 */
export function seededNoise1D(seed: number): NoiseFunction1D {
  const noise2d = createNoise2D(mulberry32(seed));
  return (x: number) => noise2d(x, 0.5);
}

/* ----------------------------- tiny helpers ------------------------------ */

/** Linear interpolation a→b by t. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Clamp v into [min, max]. */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
