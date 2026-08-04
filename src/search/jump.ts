/**
 * src/search/jump.ts — click-to-jump from search results into a book page.
 *
 * `requestSearchJump` opens the book through the existing appState open flow
 * and parks a pending jump; BookView consumes it through `useSearchJump`
 * (one hook call) once its page list is loaded: flip to the page's spread,
 * then pulse-highlight the first match on the landed leaf.
 *
 * The pulse never mutates ProseMirror's DOM — it measures the match with a
 * Range and drops fixed-position overlay chips on document.body (styles in
 * src/styles/search.css), removed automatically after the animation.
 */

import { createEffect, createSignal } from 'solid-js';
import { openBookAnywhere } from '../features/bookshelf/openAnywhere';
import { spreadOfSlot } from '../views/spread';
import { recordBookOpened } from './recents';

export interface SearchJump {
  bookId: string;
  pageId: string;
  /** Match strings to pulse, tried in order (phrase first, then words). */
  terms: string[];
  stamp: number;
}

const [pendingJump, setPendingJump] = createSignal<SearchJump | null>(null);

/** Open `bookId` via appState and queue a flip-to-page + pulse-highlight. */
export function requestSearchJump(
  bookId: string,
  pageId: string,
  terms: readonly string[],
): void {
  recordBookOpened(bookId);
  setPendingJump({
    bookId,
    pageId,
    terms: terms.map((t) => t.trim()).filter((t) => t !== ''),
    stamp: Date.now(),
  });
  // Search is library-wide, so a hit can live in a case the reader is not
  // standing in — open it there. See features/bookshelf/openAnywhere.ts.
  void openBookAnywhere(bookId);
}

// ---------------------------------------------------------------------------
// BookView side
// ---------------------------------------------------------------------------

export interface SearchJumpHost {
  /** Id of the book the view currently shows, or null while loading. */
  bookId(): string | null;
  /** Ord-ascending page list (slot = array index). */
  pages(): ReadonlyArray<{ readonly id: string }>;
  setSpreadIndex(index: number): void;
  getPaper(side: 'left' | 'right'): HTMLElement | null;
}

/**
 * Consume pending search jumps. Call once from BookView's setup (component
 * root); re-runs whenever a jump lands or the page list hydrates.
 */
export function useSearchJump(host: SearchJumpHost): void {
  createEffect(() => {
    const jump = pendingJump();
    if (jump === null) return;
    if (host.bookId() !== jump.bookId) return;
    const slot = host.pages().findIndex((page) => page.id === jump.pageId);
    if (slot < 0) return; // pages still loading (or page gone — stays parked)
    setPendingJump(null);
    host.setSpreadIndex(spreadOfSlot(slot));
    const side: 'left' | 'right' = slot % 2 === 0 ? 'left' : 'right';
    pulseWhenReady(() => host.getPaper(side), jump.terms);
  });
}

// ---------------------------------------------------------------------------
// Pulse-highlight
// ---------------------------------------------------------------------------

const PULSE_POLL_MS = 120;
const PULSE_TIMEOUT_MS = 5000;
const PULSE_LIFETIME_MS = 2400;
const MAX_PULSE_CHIPS = 4;

/** First match's client rects: precise text-node hit, else the whole block. */
function findMatchRects(prose: HTMLElement, terms: readonly string[]): DOMRect[] | null {
  const lowered = terms.map((t) => t.toLowerCase());

  // Tier 1 — a single text node containing a term (tight rects).
  const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const data = node.textContent ?? '';
    const dataLower = data.toLowerCase();
    for (const term of lowered) {
      const idx = dataLower.indexOf(term);
      if (idx < 0) continue;
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + term.length);
      const rects = Array.from(range.getClientRects()).filter(
        (r) => r.width > 1 && r.height > 1,
      );
      if (rects.length > 0) return rects;
    }
  }

  // Tier 2 — a block whose combined text contains a term (marks split nodes).
  for (const block of Array.from(prose.children)) {
    const text = block.textContent?.toLowerCase() ?? '';
    if (lowered.some((term) => text.includes(term))) {
      const rect = block.getBoundingClientRect();
      if (rect.width > 1 && rect.height > 1) return [rect];
    }
  }
  return null;
}

function spawnPulseChips(rects: readonly DOMRect[]): void {
  for (const rect of rects.slice(0, MAX_PULSE_CHIPS)) {
    const chip = document.createElement('div');
    chip.className = 'nb-search-pulse';
    chip.style.left = `${rect.left - 6}px`;
    chip.style.top = `${rect.top - 4}px`;
    chip.style.width = `${rect.width + 12}px`;
    chip.style.height = `${rect.height + 8}px`;
    document.body.appendChild(chip);
    setTimeout(() => chip.remove(), PULSE_LIFETIME_MS);
  }
}

/**
 * Poll (leaf remounts + font swaps shift layout) until the landed leaf shows
 * a match, then overlay the pulse. Gives up quietly after the timeout.
 */
function pulseWhenReady(
  getPaper: () => HTMLElement | null,
  terms: readonly string[],
): void {
  const startedAt = Date.now();
  const attempt = (): void => {
    const paper = getPaper();
    const prose = paper?.querySelector<HTMLElement>('.nb-prose') ?? null;
    if (prose !== null) {
      const rects =
        terms.length > 0
          ? findMatchRects(prose, terms)
          : [prose.getBoundingClientRect()];
      if (rects !== null && rects.length > 0) {
        spawnPulseChips(rects);
        return;
      }
    }
    if (Date.now() - startedAt < PULSE_TIMEOUT_MS) {
      setTimeout(attempt, PULSE_POLL_MS);
    }
  };
  attempt();
}
