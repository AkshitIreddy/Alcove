/**
 * features/bookshelf/input.ts — pointer/wheel handling for the shelf canvas.
 *
 * Pointer events with setPointerCapture. Gesture ROUTING lives in gestures.ts
 * (pure, tested); this class only tracks pointer state and forwards decisions:
 *   - wheel: classifyWheel → zoom-to-cursor (plain + ctrl/pinch) or pan
 *     (shift = vertical, sideways deltas = horizontal). The listener is
 *     non-passive and ALWAYS preventDefaults so the webview never page-zooms.
 *   - pointerdown asks the world whether a book spine is under the cursor;
 *     the drag threshold is 8px on a spine, 5px on the shelf/wall, and the
 *     world decides pull-vs-pan when the threshold is crossed.
 *   - click-vs-drag: within threshold AND under 250ms ⇒ tap.
 * Velocity samples are collected per move for the weighted-momentum release.
 */

import type { DragSample, Vec2 } from './camera';
import { classifyWheel, dragThresholdFor, type WheelMode } from './gestures';

/** Tap time cap: held longer than this is a drag, not a click. */
export const DRAG_TIME_MS = 250;

/** Max retained velocity samples (weighted-velocity uses the last 4). */
const MAX_SAMPLES = 4;

export interface InputCallbacks {
  onWheelZoom(deltaY: number, cursor: Vec2, sensitivity: number): void;
  /** Wheel pan, screen px. */
  onWheelPan(dx: number, dy: number): void;
  /** A primary pointer went down at `cursor`. Return true when it hit a book. */
  onPointerDown(cursor: Vec2): boolean;
  /**
   * The drag threshold was crossed. (dx, dy) is the total displacement since
   * pointerdown; `onBook` echoes the onPointerDown hit. The world routes this
   * to a shelf pan or a book pull (classifyDrag).
   */
  onDragStart(dx: number, dy: number, onBook: boolean): void;
  /** Screen-px delta since the previous move, plus the current cursor. */
  onDragMove(dx: number, dy: number, cursor: Vec2): void;
  /** Release with velocity samples and the final canvas-local cursor. */
  onDragEnd(samples: readonly DragSample[], cursor: Vec2): void;
  /** The pointer was cancelled mid-drag (capture lost, etc.). */
  onDragCancel(): void;
  onTap(cursor: Vec2): void;
  /** Cursor position while not dragging; null when the pointer leaves. */
  onHover(cursor: Vec2 | null): void;
  /** Right-click / context-menu gesture at `cursor` (wave-2 shelf menu). */
  onContextMenu?(cursor: Vec2): void;
}

interface PointerTracking {
  id: number;
  startX: number;
  startY: number;
  startT: number;
  lastX: number;
  lastY: number;
  lastT: number;
  onBook: boolean;
  dragging: boolean;
  samples: DragSample[];
}

export class ShelfInput {
  /** While frozen (pull-out in progress) every event is swallowed. */
  frozen = false;

  /** What a plain wheel spin does (mirrors settings.wheelMode). */
  wheelMode: WheelMode = 'zoom';

  private tracking: PointerTracking | null = null;
  private readonly ac = new AbortController();

  constructor(
    private readonly el: HTMLElement,
    private readonly cb: InputCallbacks,
  ) {
    const opts: AddEventListenerOptions = { signal: this.ac.signal };
    // Non-passive on purpose: preventDefault must stop webview page-zoom.
    el.addEventListener('wheel', this.onWheel, { ...opts, passive: false });
    el.addEventListener('pointerdown', this.onPointerDown, opts);
    el.addEventListener('pointermove', this.onPointerMove, opts);
    el.addEventListener('pointerup', this.onPointerUp, opts);
    el.addEventListener('pointercancel', this.onPointerCancel, opts);
    el.addEventListener('pointerleave', this.onPointerLeave, opts);
    el.addEventListener(
      'contextmenu',
      (e) => {
        e.preventDefault();
        if (!this.frozen) this.cb.onContextMenu?.(this.cursorOf(e));
      },
      opts,
    );
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
    const action = classifyWheel(e, this.wheelMode);
    if (action.kind === 'zoom') {
      this.cb.onWheelZoom(action.deltaY, this.cursorOf(e), action.sensitivity);
    } else {
      this.cb.onWheelPan(action.dx, action.dy);
    }
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.frozen || !e.isPrimary || e.button !== 0) return;
    this.el.setPointerCapture(e.pointerId);
    const now = e.timeStamp;
    const onBook = this.cb.onPointerDown(this.cursorOf(e));
    this.tracking = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startT: now,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: now,
      onBook,
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
      const totalDx = e.clientX - t.startX;
      const totalDy = e.clientY - t.startY;
      const dist = Math.hypot(totalDx, totalDy);
      const held = e.timeStamp - t.startT;
      if (dist > dragThresholdFor(t.onBook) || (!t.onBook && held > DRAG_TIME_MS)) {
        t.dragging = true;
        this.cb.onDragStart(totalDx, totalDy, t.onBook);
      }
    }
    if (t.dragging) {
      t.samples.unshift({ dx, dy, dt });
      if (t.samples.length > MAX_SAMPLES) t.samples.length = MAX_SAMPLES;
      this.cb.onDragMove(dx, dy, this.cursorOf(e));
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const t = this.tracking;
    if (t === null || e.pointerId !== t.id) return;
    this.tracking = null;
    if (this.frozen) return;
    if (t.dragging) {
      this.cb.onDragEnd(t.samples, this.cursorOf(e));
    } else {
      const dist = Math.hypot(e.clientX - t.startX, e.clientY - t.startY);
      const held = e.timeStamp - t.startT;
      if (dist <= dragThresholdFor(t.onBook) && held <= DRAG_TIME_MS) {
        this.cb.onTap(this.cursorOf(e));
      }
    }
  };

  private readonly onPointerCancel = (e: PointerEvent): void => {
    const t = this.tracking;
    if (t === null || e.pointerId !== t.id) return;
    this.tracking = null;
    if (t.dragging && !this.frozen) this.cb.onDragCancel();
  };

  private readonly onPointerLeave = (): void => {
    if (this.tracking === null) this.cb.onHover(null);
  };
}
