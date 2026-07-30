/**
 * Autosave indicator seam — a tiny reactive pulse the rail's pencil listens
 * to. PageEditor calls `notifySaved()` whenever a debounced save flushes;
 * BookRail scribbles its pencil for a moment on every bump.
 *
 * Kept as its own module (not in editor state) so anything that persists a
 * page (overflow carries, history restores) can pulse it too without
 * importing editor internals.
 */
import { createSignal, type Accessor } from 'solid-js';

const [savedAt, setSavedAt] = createSignal(0);

/** Monotonic timestamp of the last flushed save (0 = never). */
export const lastSavedAt: Accessor<number> = savedAt;

/** Pulse the autosave indicator (call after persisting a page doc). */
export function notifySaved(): void {
  setSavedAt(Date.now());
}
