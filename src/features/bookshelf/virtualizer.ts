/**
 * features/bookshelf/virtualizer.ts — floor windowing + pooling.
 *
 * Pure windowing math (testable in node) plus a tiny generic object pool the
 * world uses for FloorView instances (cap 12; excess destroyed).
 */

import { FLOOR_H, VIRTUALIZER_MARGIN } from './constants';

export interface FloorRange {
  first: number;
  last: number;
}

/**
 * Which floors intersect the viewport (± margin). Floors are virtual and
 * endless downward, so `first` is clamped to 0 but `last` is unbounded.
 */
export function computeRange(
  camY: number,
  viewportH: number,
  zoom: number,
  margin: number = VIRTUALIZER_MARGIN,
): FloorRange {
  const first = Math.max(0, Math.floor((camY - margin) / FLOOR_H));
  const last = Math.max(
    first,
    Math.floor((camY + viewportH / zoom + margin) / FLOOR_H),
  );
  return { first, last };
}

export interface WindowDiff {
  /** Floor indices to mount, ascending. */
  add: number[];
  /** Floor indices to release. */
  remove: number[];
}

/** Diff the mounted floor set against the target range. */
export function diffWindow(
  mounted: ReadonlySet<number>,
  range: FloorRange,
): WindowDiff {
  const add: number[] = [];
  const remove: number[] = [];
  for (let i = range.first; i <= range.last; i++) {
    if (!mounted.has(i)) add.push(i);
  }
  for (const i of mounted) {
    if (i < range.first || i > range.last) remove.push(i);
  }
  return { add, remove };
}

/** Default FloorView pool cap per the design doc. */
export const FLOOR_POOL_CAP = 12;

/**
 * Minimal object pool. Released items beyond `cap` are destroyed outright;
 * acquire() reuses a pooled item when available.
 */
export class Pool<T> {
  private readonly free: T[] = [];

  constructor(
    private readonly factory: () => T,
    private readonly onRelease: (item: T) => void,
    private readonly onDestroy: (item: T) => void,
    private readonly cap: number = FLOOR_POOL_CAP,
  ) {}

  get size(): number {
    return this.free.length;
  }

  acquire(): T {
    const pooled = this.free.pop();
    return pooled !== undefined ? pooled : this.factory();
  }

  release(item: T): void {
    this.onRelease(item);
    if (this.free.length >= this.cap) {
      this.onDestroy(item);
      return;
    }
    this.free.push(item);
  }

  drain(): void {
    for (const item of this.free) this.onDestroy(item);
    this.free.length = 0;
  }
}
