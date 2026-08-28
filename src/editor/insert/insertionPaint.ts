/**
 * Let a newly-mounted insertion mask reach the compositor before Notebook
 * Script hands the renderer a synchronous TipTap/pagination transaction.
 *
 * One requestAnimationFrame is not enough: its callback runs before that
 * frame is painted, and resolving a promise there resumes the insertion in a
 * microtask which can block the very paint we were waiting for.  The first
 * frame commits the mask; the second is the safe point from which work may
 * continue.
 */
export function waitForInsertionMaskPaint(
  scheduleFrame: (callback: FrameRequestCallback) => number = requestAnimationFrame,
): Promise<void> {
  return new Promise((resolve) => {
    scheduleFrame(() => {
      scheduleFrame(() => resolve());
    });
  });
}
