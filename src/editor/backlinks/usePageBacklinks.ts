/**
 * `createPageBacklinks(pageId)` — the pages that link to this one, as a Solid
 * accessor that keeps itself current.
 *
 * The whole hook is four lines of real work; it exists as its own module so
 * PageEditor can reserve room at the foot of the page BEFORE the tab is drawn
 * (the reserved room is a CSS custom property on `.nb-page`, and the tab is a
 * child of that element — a child cannot tell its parent how tall to be
 * without a layout read, and a layout read per transaction is exactly what the
 * pagination drain cannot afford).
 *
 * It re-runs on `linkGraphVersion()`, which is bumped when a page is saved or
 * a link is inserted (src/search/backlinks.ts). It does NOT poll: a backlink
 * that appeared because another window wrote to the database shows up on the
 * next bump or the next mount, and a notebook is not a chat room.
 */
import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js';
import { linkGraphVersion, loadBacklinks, type PageCard } from '../../search/backlinks';

export function createPageBacklinks(pageId: Accessor<string>): Accessor<PageCard[]> {
  const [cards, setCards] = createSignal<PageCard[]>([]);

  let alive = true;
  onCleanup(() => {
    alive = false;
  });

  createEffect(() => {
    const id = pageId();
    // Read the version inside the effect: that is the subscription. The load
    // below is async and tracks nothing on its own.
    linkGraphVersion();
    if (id === '') {
      setCards([]);
      return;
    }
    void loadBacklinks(id).then((found) => {
      if (!alive || pageId() !== id) return;
      setCards(found);
    });
  });

  return cards;
}
