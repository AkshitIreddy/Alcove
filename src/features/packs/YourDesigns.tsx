/**
 * src/features/packs/YourDesigns.tsx — the reader's own papers and cases,
 * standing in the studio next to the shipped ones.
 *
 * Mounted with one line, like `UserStickersSection` before it:
 *
 *     import YourDesigns from '../../features/packs/YourDesigns';
 *     …
 *     <YourDesigns axis="wallpaper" />
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS AT ALL, WHEN THERE IS ALREADY A PACKS PANEL
 * ─────────────────────────────────────────────────────────────────────────
 * Because of the failure this repo keeps having. `CLAUDE.md` calls it out and
 * `tests/roll-gates.test.ts` was written for it: a vocabulary that is authored,
 * exported, validated and reachable from nowhere. A reader's wallpaper that
 * lives only in a "your packs" list is exactly that — it would be a thing they
 * made, stored correctly, and never saw again while choosing a wallpaper.
 *
 * So the packs panel is the LIBRARY, and this is the SHELF: the papers appear
 * where papers are chosen, one press from the wall, under a heading that says
 * whose they are.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE CARD IS PAINTED BY THE THING IT PICKS
 * ─────────────────────────────────────────────────────────────────────────
 * `drawWallpaperCard` and `drawCaseCard` — the same routines the studio's own
 * tiles use, under the room's own scheme. A card that approximates its subject
 * teaches the reader to distrust the panel, and a reader's own paper is the
 * one they will look hardest at.
 *
 * The `artKey` therefore carries the room's colour key AND the full axis key,
 * because these are drawn pixels and the tile cache validates nothing about a
 * hit. `wallpaperAxisKey` rather than a hand-rolled join: a local copy that has
 * fallen an axis behind serves the wrong picture, which is the same class of
 * bug the scheme tag exists to close.
 */
import { Show, createMemo, onMount, type JSX } from 'solid-js';
import type { FlatCtx } from '../../art/flat';
import { drawCaseCard } from '../../art/flatShelf';
import { shelfDesignTag } from '../../art/shelfDesign';
import { drawWallpaperCard, wallpaperAxisKey } from '../../art/wallpaperDesign';
import { activeRoomDesign, loadDesignPrefs } from '../../data/designPrefs';
import { libraryPrefs, resolveLibrary } from '../../features/bookshelf/libraryPrefs';
import { Capped } from '../../views/rail/DesignStrip';
import { DesignCanvas } from '../../views/rail/designArt';
import { packCategory } from './categories';
import { openPackDialog } from './PackDialog';
import {
  applyCarpentryEntry,
  applyWallpaperEntry,
  entriesIn,
  loadUserPacks,
  shelfDesignOfItem,
  wallpaperSpecOf,
  type PackEntry,
} from './store';
import '../../styles/packs.css';

/** The seed the studio's own case cards use, so yours look like theirs. */
const CARD_SEED = 7;

export interface YourDesignsProps {
  readonly axis: 'wallpaper' | 'carpentry';
  /** Tile width in CSS px. Matches `DesignStrip`'s default. */
  readonly tileW?: number;
  readonly tileH?: number;
}

export default function YourDesigns(props: YourDesignsProps): JSX.Element {
  onMount(() => {
    void loadUserPacks();
    void loadDesignPrefs();
  });

  const category = (): string => packCategory(props.axis)?.plural ?? props.axis;
  const entries = createMemo<readonly PackEntry[]>(() => entriesIn(props.axis));
  const resolved = createMemo(() => resolveLibrary(libraryPrefs));
  const room = (): ReturnType<typeof activeRoomDesign> => activeRoomDesign();

  /** Is this entry what the room is wearing right now? */
  const isActive = (entry: PackEntry): boolean => {
    if (props.axis === 'wallpaper') {
      return wallpaperAxisKey(wallpaperSpecOf(entry.item)) === wallpaperAxisKey(room().wallpaper);
    }
    return entry.item.build === room().build && entry.item.pattern === room().pattern;
  };

  const artKey = (entry: PackEntry): string =>
    props.axis === 'wallpaper'
      ? `packwall|${resolved().key}|${wallpaperAxisKey(wallpaperSpecOf(entry.item))}`
      : `packcase|${resolved().key}|${shelfDesignTag(shelfDesignOfItem(entry.item))}`;

  const paint = (entry: PackEntry) => (ctx: FlatCtx, w: number, h: number) => {
    if (props.axis === 'wallpaper') drawWallpaperCard(ctx, w, h, wallpaperSpecOf(entry.item));
    else drawCaseCard(ctx, w, h, CARD_SEED, shelfDesignOfItem(entry.item));
  };

  const apply = (entry: PackEntry): void => {
    void (props.axis === 'wallpaper'
      ? applyWallpaperEntry(entry.item)
      : applyCarpentryEntry(entry.item));
  };

  return (
    <div class="nb-yours" data-your-designs={props.axis}>
      <div class="nb-yours-head">
        <span class="nb-yours-label">yours</span>
        <button
          type="button"
          class="nb-yours-add"
          data-tooltip={`add your own ${category()}`}
          aria-label={`Add your own ${category()}`}
          onClick={() => openPackDialog(props.axis)}
        >
          + add your own
        </button>
      </div>
      <Show
        when={entries().length > 0}
        fallback={
          <p class="nb-yours-empty font-ui">
            none yet — the popup has instructions and a prompt you can hand to an
            assistant
          </p>
        }
      >
        <div class="nb-strip nb-yours-strip" role="group" aria-label={`Your ${category()}`}>
          {/* Capped like every long list in this app, and this one's length is
              decided by the READER — a pack of twenty-four papers times a few
              packs is more tiles than a panel should build on open. */}
          <Capped
            each={entries()}
            limit={8}
            isActive={isActive}
            label={`your ${category()}`}
            moreClass="nb-strip-tile nb-strip-more"
          >
            {(entry) => (
              <button
                type="button"
                class="nb-strip-tile"
                classList={{ 'is-active': isActive(entry()) }}
                aria-pressed={isActive(entry())}
                aria-label={`${entry().item.name} — from ${entry().packName}`}
                data-tooltip={`${entry().item.name} — ${entry().item.blurb ?? `from ${entry().packName}`}`}
                onClick={() => apply(entry())}
              >
                <DesignCanvas
                  class="nb-strip-art"
                  key={artKey(entry())}
                  w={props.tileW ?? 104}
                  h={props.tileH ?? 72}
                  scheme={resolved().scheme}
                  draw={paint(entry())}
                />
                <span class="nb-strip-name">{entry().item.name}</span>
              </button>
            )}
          </Capped>
        </div>
      </Show>
    </div>
  );
}
