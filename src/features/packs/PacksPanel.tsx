/**
 * src/features/packs/PacksPanel.tsx — "your own", the studio's third tab.
 *
 * The library rather than the shelf. `YourDesigns` puts a reader's papers and
 * cases where papers and cases are CHOSEN; this is where the packs themselves
 * are kept — what came in, from which file, who made it, and the way back out.
 *
 * Two things here are not decoration:
 *
 *   THE DROPPED COUNT. A pack outlives the vocabulary it was written against.
 *   `store.ts` re-validates every entry on the way out of SQLite and drops the
 *   ones that no longer name anything this app draws — and then says so, here.
 *   A tile that silently paints the fallback while claiming to be the reader's
 *   own is the exact failure this app has had before, in three other places.
 *
 *   THE FORGET CAVEAT. Forgetting a stickers pack forgets the RECEIPT; the
 *   drawings are in the asset store and stay in the catalogue. Saying that on
 *   the button is better than a reader pressing it and hunting for drawings
 *   they think they deleted.
 */
import { For, Show, createMemo, createSignal, onMount, type JSX } from 'solid-js';
import { PACK_CATEGORIES, UNSUPPORTED_CATEGORIES, packCategory } from './categories';
import { openPackDialog } from './PackDialog';
import type { PackCategory } from './schema';
import {
  MAX_PACKS,
  entriesIn,
  forgetCaveat,
  forgetPack,
  loadUserPacks,
  userPacks,
  type InstalledPack,
} from './store';
import { Capped } from '../../views/rail/DesignStrip';
import '../../styles/packs.css';

function whenAdded(at: number): string {
  if (at === 0) return '';
  try {
    return new Date(at).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export default function PacksPanel(): JSX.Element {
  onMount(() => {
    void loadUserPacks();
  });

  const packs = createMemo<readonly InstalledPack[]>(() => userPacks());
  /** The pack whose forget button is armed, if any. */
  const [arming, setArming] = createSignal<string | null>(null);
  const countIn = (category: PackCategory): number => entriesIn(category.id).length;

  return (
    <div class="nb-packs" data-packs-panel>
      <section class="nb-panel-section">
        <h3 class="nb-panel-section-title">bring in your own</h3>
        <p class="nb-panel-footnote nb-packs-lead">
          make something yourself, or have an assistant make it for you — each one
          opens with instructions and a prompt written from the very rules the
          importer checks against.
        </p>
        <div class="nb-packs-grid" role="group" aria-label="What you can add">
          <For each={PACK_CATEGORIES}>
            {(category) => (
              <button
                type="button"
                class="nb-packs-card"
                data-packs-open={category.id}
                aria-label={`Add your own ${category.plural}`}
                data-tooltip={category.caveat}
                onClick={() => openPackDialog(category.id)}
              >
                <span class="nb-packs-card-title">{category.title}</span>
                <span class="nb-packs-card-blurb font-ui">{category.blurb}</span>
                <span class="nb-packs-card-count font-ui">
                  <Show when={countIn(category) > 0} fallback="add your own">
                    {countIn(category)} of yours
                  </Show>
                </span>
              </button>
            )}
          </For>
        </div>
      </section>

      <section class="nb-panel-section nb-panel-section-divided">
        <h3 class="nb-panel-section-title">what you have brought in</h3>
        <Show
          when={packs().length > 0}
          fallback={
            <p class="nb-panel-footnote">
              nothing yet. Anything you add shows here, with a way back out.
            </p>
          }
        >
          {/*
            A div with `role="list"`, not a <ul>. `Capped` puts its own reveal
            control in as a sibling of the rows, and a bare <button> is not a
            legal child of <ul> — the same reason the catalogue's sticker grid
            hosts its Capped in a div.
          */}
          <div class="nb-packs-list" role="list" aria-label="Your packs">
            <Capped each={packs()} limit={12} label="your packs">
              {(pack) => {
                const category = (): PackCategory | null => packCategory(pack().category);
                const caveat = (): string | null => {
                  const found = category();
                  return found === null ? null : forgetCaveat(found);
                };
                return (
                  <div class="nb-packs-row" role="listitem" data-packs-row={pack().id}>
                    <div class="nb-packs-row-main">
                      <span class="nb-packs-row-name">{pack().name}</span>
                      <span class="nb-packs-row-meta font-ui">
                        {pack().items.length} {category()?.plural ?? 'entries'}
                        <Show when={pack().author !== ''}> · by {pack().author}</Show>
                        <Show when={whenAdded(pack().addedAt) !== ''}>
                          {' '}
                          · {whenAdded(pack().addedAt)}
                        </Show>
                      </span>
                      <Show when={pack().dropped > 0}>
                        <span class="nb-packs-row-dropped font-ui">
                          {pack().dropped} entr{pack().dropped === 1 ? 'y' : 'ies'} in this
                          pack no longer name anything the app draws, so {pack().dropped === 1 ? 'it is' : 'they are'} not shown.
                        </span>
                      </Show>
                    </div>
                    {/*
                      Two presses, because there is no undo behind this one.
                      The reader's separate delete/restore work is about the
                      SHIPPED vocabularies, which can always be un-hidden;
                      forgetting a pack loses recipes that only exist in a file
                      they may no longer have. A confirm is cheaper than that.
                    */}
                    <button
                      type="button"
                      class="nb-packs-forget"
                      classList={{ 'is-arming': arming() === pack().id }}
                      data-packs-forget={pack().id}
                      aria-label={
                        arming() === pack().id
                          ? `Really forget ${pack().name}`
                          : `Forget ${pack().name}`
                      }
                      data-tooltip={caveat() ?? `forget “${pack().name}”`}
                      onClick={() => {
                        // The id is read ONCE. `pack` is an Index accessor, so
                        // after a row is forgotten it points at whatever moved
                        // up into that slot — a disarm timer holding the
                        // accessor would compare against the wrong pack and
                        // leave a stale "sure?" on screen.
                        const id = pack().id;
                        if (arming() !== id) {
                          setArming(id);
                          window.setTimeout(
                            () => setArming((current) => (current === id ? null : current)),
                            4000,
                          );
                          return;
                        }
                        setArming(null);
                        void forgetPack(id);
                      }}
                    >
                      {arming() === pack().id ? 'sure?' : 'forget'}
                    </button>
                  </div>
                );
              }}
            </Capped>
          </div>
          <p class="nb-panel-footnote">
            up to {MAX_PACKS} packs. Forgetting one takes its entries out of the
            studio; anything you have already hung on a wall stays where it is.
          </p>
        </Show>
      </section>

      <section class="nb-panel-section nb-panel-section-divided">
        <h3 class="nb-panel-section-title">not yet, and why</h3>
        <ul class="nb-packs-notyet font-ui" aria-label="What cannot be uploaded yet">
          <For each={UNSUPPORTED_CATEGORIES}>
            {(entry) => (
              <li>
                <span class="nb-packs-notyet-name">{entry.title}</span> — {entry.why}
              </li>
            )}
          </For>
        </ul>
        <p class="nb-panel-footnote">
          said out loud rather than hidden behind an upload button that would drop
          your file.
        </p>
      </section>
    </div>
  );
}
