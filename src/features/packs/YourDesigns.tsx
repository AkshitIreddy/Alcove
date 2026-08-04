/**
 * src/features/packs/YourDesigns.tsx — the reader's own papers and cases,
 * standing in the studio next to the shipped ones.
 *
 * Mounted with one line, like `UserStickersSection` before it:
 *
 *     import YourDesigns from '../../features/packs/YourDesigns';
 *     …
 *     <YourDesigns pack="wallpaper" />
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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS TOOK A PROP CALLED `axis`, AND IT WAS NOT ONE
 * ─────────────────────────────────────────────────────────────────────────
 * It took `axis: 'wallpaper' | 'carpentry'` — a PACK CATEGORY
 * (`categories.ts`), the word the importer, the dialog and `entriesIn` are
 * keyed by. Everywhere else in the app a prop called `axis` is a `CurationAxis`
 * (`data/shelfOfMine.ts`): the word the READER'S curation is keyed by, which
 * goes into their SQLite row and can never be renamed without splitting their
 * stars in two.
 *
 * The two vocabularies overlapped by accident. 'wallpaper' is a member of both,
 * which reads as though they agree; 'carpentry' is in neither the curation list
 * nor anything like it, because a curation axis is a LIST A READER PICKS FROM
 * and there is no such list called "carpentry" — the studio splits that idea
 * into `build`, `pattern` and `named-case`. Two studio files therefore carried
 * `axis="carpentry"` next to `axis="build"`, meaning two unrelated things.
 *
 * So the pack word is `pack` now and `axis` means one thing in this tree. A
 * reader's own case entry names a build and a treatment together, which is
 * exactly what `named-case` already means, so that is the list it is curated
 * in. The mapping lives in {@link CURATED_AS} and nowhere else: a second copy
 * would be a second chance to file one reader's stars under two words.
 */
import { Show, createMemo, onMount, type JSX } from 'solid-js';
import type { FlatCtx } from '../../art/flat';
import { drawCaseCard } from '../../art/flatShelf';
import { shelfDesignTag } from '../../art/shelfDesign';
import { drawWallpaperCard, wallpaperAxisKey } from '../../art/wallpaperDesign';
import { activeRoomDesign, loadDesignPrefs } from '../../data/designPrefs';
import type { CurationAxis } from '../../data/shelfOfMine';
import { libraryPrefs, resolveLibrary } from '../../features/bookshelf/libraryPrefs';
import { Capped, StarMark, createCuration, starWords } from '../../views/rail/DesignStrip';
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

/** The two pack categories that have a home in the library studio. */
export type PackAxis = 'wallpaper' | 'carpentry';

/**
 * Pack category → the reader's curated list its entries join. See the header.
 *
 * Declared as a total record, so adding a third category to this component is a
 * type error until somebody has decided which list a reader curates it in —
 * which is the decision that would otherwise be made by accident, by whichever
 * string happened to also be a `CurationAxis`.
 */
const CURATED_AS: Record<PackAxis, CurationAxis> = {
  wallpaper: 'wallpaper',
  carpentry: 'named-case',
};

/** A pack entry, shaped for `createCuration`: an id and something to call it. */
interface YourRow {
  readonly id: string;
  readonly name: string;
  readonly entry: PackEntry;
}

export interface YourDesignsProps {
  readonly pack: PackAxis;
  /** Tile width in CSS px. Matches `DesignStrip`'s default. */
  readonly tileW?: number;
  readonly tileH?: number;
}

export default function YourDesigns(props: YourDesignsProps): JSX.Element {
  onMount(() => {
    void loadUserPacks();
    void loadDesignPrefs();
  });

  const category = (): string => packCategory(props.pack)?.plural ?? props.pack;
  const entries = createMemo<readonly PackEntry[]>(() => entriesIn(props.pack));
  const resolved = createMemo(() => resolveLibrary(libraryPrefs));
  const room = (): ReturnType<typeof activeRoomDesign> => activeRoomDesign();

  /**
   * The entry's id, and it has to be the PACK's id rather than its position.
   * A reader who stars their third paper and then imports another pack must not
   * find the star has moved onto somebody else's paper.
   */
  const rowOf = (entry: PackEntry): YourRow => ({
    id: `${entry.packId}#${entry.index}`,
    name: entry.item.name,
    entry,
  });

  /** Is this entry what the room is wearing right now? */
  const isActive = (entry: PackEntry): boolean => {
    if (props.pack === 'wallpaper') {
      return wallpaperAxisKey(wallpaperSpecOf(entry.item)) === wallpaperAxisKey(room().wallpaper);
    }
    return entry.item.build === room().build && entry.item.pattern === room().pattern;
  };

  /** The id of the entry the room is wearing, or '' when it is wearing none. */
  const activeId = (): string => {
    const worn = entries().find(isActive);
    return worn === undefined ? '' : rowOf(worn).id;
  };

  /**
   * A reader's own paper is a list entry like any other, so it gets the same
   * hand: star it to the top, take it off the row, get it back out of the
   * drawer. Being the one thing in the studio that could not be starred — the
   * one thing that is actually THEIRS — is the version of this nobody would
   * accept.
   *
   * `activeId` is the entry the room is wearing, which is what keeps a removed
   * paper on the row for exactly as long as the wall is still hung with it.
   */
  const curation = createCuration<YourRow>(() => ({
    axis: CURATED_AS[props.pack],
    label: `your ${category()}`,
    options: entries().map(rowOf),
    activeId: activeId(),
  }));

  const rows = createMemo<readonly YourRow[]>(() => curation.list());

  const artKey = (entry: PackEntry): string =>
    props.pack === 'wallpaper'
      ? `packwall|${resolved().key}|${wallpaperAxisKey(wallpaperSpecOf(entry.item))}`
      : `packcase|${resolved().key}|${shelfDesignTag(shelfDesignOfItem(entry.item))}`;

  const paint = (entry: PackEntry) => (ctx: FlatCtx, w: number, h: number) => {
    if (props.pack === 'wallpaper') drawWallpaperCard(ctx, w, h, wallpaperSpecOf(entry.item));
    else drawCaseCard(ctx, w, h, CARD_SEED, shelfDesignOfItem(entry.item));
  };

  const apply = (entry: PackEntry): void => {
    void (props.pack === 'wallpaper'
      ? applyWallpaperEntry(entry.item)
      : applyCarpentryEntry(entry.item));
  };

  return (
    <div class="nb-yours" data-your-designs={props.pack}>
      <div class="nb-yours-head">
        <span class="nb-yours-label">yours</span>
        <button
          type="button"
          class="nb-yours-add"
          data-tooltip={`add your own ${category()}`}
          aria-label={`Add your own ${category()}`}
          onClick={() => openPackDialog(props.pack)}
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
        <div
          class="nb-strip nb-yours-strip"
          role="group"
          aria-label={`Your ${category()}`}
          on:contextmenu={(event) => curation.onListContext(event)}
        >
          {/* Capped like every long list in this app, and this one's length is
              decided by the READER — a pack of twenty-four papers times a few
              packs is more tiles than a panel should build on open. */}
          <Capped
            each={rows()}
            limit={8}
            isActive={(row) => isActive(row.entry)}
            label={`your ${category()}`}
            moreClass="nb-strip-tile nb-strip-more"
          >
            {(row) => (
              <button
                type="button"
                class="nb-strip-tile"
                classList={{
                  'is-active': isActive(row().entry),
                  'nb-cur-gone': curation.removed(row().id),
                }}
                aria-pressed={isActive(row().entry)}
                aria-label={`${row().name} — from ${row().entry.packName}${starWords(
                  curation.starsFor(row().id),
                )}`}
                data-tooltip={`${row().name} — ${row().entry.item.blurb ?? `from ${row().entry.packName}`}`}
                onClick={() => apply(row().entry)}
                on:contextmenu={(event) => curation.onEntryContext(event, row().id)}
              >
                <span class="nb-mark-wrap">
                  <DesignCanvas
                    class="nb-strip-art"
                    key={artKey(row().entry)}
                    w={props.tileW ?? 104}
                    h={props.tileH ?? 72}
                    scheme={resolved().scheme}
                    draw={paint(row().entry)}
                  />
                  <StarMark stars={curation.starsFor(row().id)} />
                </span>
                <span class="nb-strip-name">{row().name}</span>
              </button>
            )}
          </Capped>
        </div>
      </Show>
      {/* The right-click menu, the restore drawer and their furniture. Outside
          the Show so a reader who removed every one of their own papers can
          still right-click the section and get them back. */}
      <curation.Overlay />
    </div>
  );
}
