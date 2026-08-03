/**
 * src/sound/preview.ts — the audition a sound-set chip plays when you pick it.
 *
 * Choosing a voicing from a list of names is choosing blind, which is the one
 * thing a picker for the ear must not make you do. Selecting a set therefore
 * plays a short signature of it — the four things the reader actually named
 * when asking for this: a click, a page, a book, and the thing that answers
 * when you finish something.
 *
 * They are ROLE names, so the signature is voiced by whichever set is active:
 * the same four beats sound like graphite in `Paper`, like a loaded shelf in
 * `Library`, and like an interface in `Studio`. Mute, reduced sound and a set
 * that silences a role are all `play()`'s business, so a silenced beat is
 * simply a rest.
 */

import { play, type FamilyName } from './engine';

/** Beat = [role, milliseconds from the top]. Kept under 1.5 s on purpose. */
const SIGNATURE: readonly (readonly [FamilyName, number])[] = [
  ['click-soft', 0],
  ['page-flip', 260],
  ['book-pull', 620],
  ['check-done', 1180],
];

/** How long one audition runs, derived from the last beat rather than restated. */
export const PREVIEW_MS = SIGNATURE.reduce((last, [, at]) => Math.max(last, at), 0);

let pending: ReturnType<typeof setTimeout>[] = [];

/** Stop an audition already in flight (a second chip pressed, or unmount). */
export function cancelSoundSetPreview(): void {
  for (const timer of pending) clearTimeout(timer);
  pending = [];
}

/**
 * Play the current set's signature. Restarts cleanly if one is already
 * running, so holding down the arrow keys through a row of chips auditions
 * the set under the cursor rather than stacking four of them.
 */
export function previewSoundSet(): void {
  cancelSoundSetPreview();
  for (const [role, at] of SIGNATURE) {
    if (at === 0) {
      void play(role);
      continue;
    }
    pending.push(
      setTimeout(() => {
        void play(role);
      }, at),
    );
  }
}
