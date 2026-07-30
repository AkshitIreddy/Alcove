/**
 * features/bookshelf/input.ts — pointer/wheel handling for the shelf canvas.
 *
 * Pointer events with setPointerCapture; click-vs-drag threshold 5px OR
 * 250ms; wheel routing: Ctrl+wheel and pinch-trackpad (Chromium reports
 * pinches as ctrlKey wheels) zoom to the cursor, plain wheel scrolls
 * vertically (shift/horizontal deltas pan x). Velocity samples are collected
 * per move for the weighted-momentum release.
 */

import type { DragSample, Vec2 } from './camera';

/** Drag threshold: beyond this many px OR held longer than DRAG_TIME_MS. */
export const DRAG_DIST_PX = 5;
export const DRAG_TIME_MS = 250;

/** Max retained velocity samples (weighted-velocity uses the last 4). */
const MAX_SAMPLES = 4;

export interface InputCallbacks {
  onWheelZoom(deltaY: number, cursor: Vec2): void;
  /** Plain-wheel scroll, screen px. */
  onWheelPan(dx: number, dy: number): void;
  onDragStart(): void;
  /** Screen-px delta since the previous move. */
  onDragMove(dx: number, dy: number): void;
  /** Release with screen-px/s velocity samples, most recent first. */
  onDragEnd(samples: readonly DragSample[]): void;
  onTap(cursor: Vec2): void;
  /** Cursor position while not dragging; null when the pointer leaves. */
  onHover(cursor: Vec2 | null): void;
}

interface PointerTracking {
  id: number;
  startX: number;
  startY: number;
  startT: number;
  lastX: number;
  lastY: number;
  lastT: number;
  dragging: boolean;
  samples: DragSample[];
}

export class ShelfInput {
  /** While frozen (pull-out in progress) every event is swallowed. */
  frozen = false;

  private tracking: PointerTracking | null = null;
  private readonly ac = new AbortController();

  constructor(
    private readonly el: HTMLElement,
    private readonly cb: InputCallbacks,
  ) {
    const opts: AddEventListenerOptions = { signal: this.ac.signal };
    el.addEventListener('wheel', this.onWheel, { ...opts, passive: false });
    el.addEventListener('pointerdown', this.onPointerDown, opts);
    el.addEventListener('pointermove', this.onPointerMove, opts);
    el.addEventListener('pointerup', this.onPointerUp, opts);
    el.addEventListener('pointercancel', this.onPointerCancel, opts);
    el.addEventListener('pointerleave', this.onPointerLeave, opts);
    el.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
  }

  destroy(): void {
    this.ac.abort();
    this.tracking = null;
  }

  private cursorOf(e: MouseEvent): Vec2 {
    const rect = this.el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.frozen) return;
    if (e.ctrlKey || e.metaKey) {
      this.cb.onWheelZoom(e.deltaY, this.cursorOf(e));
      return;
    }
    // Shift+wheel pans horizontally (browsers may pre-swap deltas).
    const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
    const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY;
    this.cb.onWheelPan(dx, dy);
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.frozen || !e.isPrimary || e.button !== 0) return;
    this.el.setPointerCapture(e.pointerId);
    const now = e.timeStamp;
    this.tracking = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startT: now,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: now,
      dragging: false,
      samples: [],
    };
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.frozen) return;
    const t = this.tracking;
    if (t === null || e.pointerId !== t.id) {
      this.cb.onHover(this.cursorOf(e));
      return;
    }
    const dx = e.clientX - t.lastX;
    const dy = e.clientY - t.lastY;
    const dt = Math.max((e.timeStamp - t.lastT) / 1000, 1e-4);
    t.lastX = e.clientX;
    t.lastY = e.clientY;
    t.lastT = e.timeStamp;
    if (!t.dragging) {
      const dist = Math.hypot(e.clientX - t.startX, e.clientY - t.startY);
      const held = e.timeStamp - t.startT;
      if (dist > DRAG_DIST_PX || held > DRAG_TIME_MS) {
        t.dragging = true;
        this.cb.onDragStart();
      }
    }
    if (t.dragging) {
      t.samples.unshift({ dx, dy, dt });
      if (t.samples.length > MAX_SAMPLES) t.samples.length = MAX_SAMPLES;
      this.cb.onDragMove(dx, dy);
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const t = this.tracking;
    if (t === null || e.pointerId !== t.id) return;
    this.tracking = null;
    if (this.frozen) return;
    if (t.dragging) {
      this.cb.onDragEnd(t.samples);
    } else {
      const dist = Math.hypot(e.clientX - t.startX, e.clientY - t.startY);
      const held = e.timeStamp - t.startT;
      if (dist <= DRAG_DIST_PX && held <= DRAG_TIME_MS) {
        this.cb.onTap(this.cursorOf(e));
      }
    }
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    const t = this.tracking;
    if (t === null || e.pointerId !== t.id) return;
    this.tracking = null;
    if (t.dragging && !this.frozen) this.cb.onDragEnd([]);
  };

  private readonly onPointerLeave = (): void => {
    if (this.tracking === null) this.cb.onHover(null);
  };
}
