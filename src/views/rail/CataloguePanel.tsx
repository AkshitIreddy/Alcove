/**
 * src/views/rail/CataloguePanel.tsx — THE CATALOGUE.
 *
 * Everything you can put on a page, in one browsable place. It replaces
 * "Stickers & effects", a name that named two shelves out of seven and hid the
 * rest: the panel already reached the whole editor, but a reader looking for a
 * quote card or a flowchart had no reason to open something called "stickers".
 *
 * Seven shelves, and you browse them the way you browse a stationer's:
 *
 *   paper & cards   the things a page has stuck to it — index cards, an
 *                   envelope, a stamp, a luggage tag, sticky notes, polaroids
 *   text blocks     the ordinary furniture — headings, lists, tables, code
 *   callouts        the four asides, each in its own wash
 *   diagrams        tree, mindmap, flowchart, graph, timeline
 *   tape & trim     what you do TO a block once it is written
 *   lettering       which hand it is written in, in what ink, how big
 *   stickers        the doodles, built-in and imported
 *
 * Two rules hold the thing together:
 *
 *  - **One source of truth per shelf.** Insertables come from the slash-menu
 *    registry (`SLASH_COMMANDS`), so a block added there appears here for
 *    free and the two menus can never offer different sets. Effects come from
 *    `src/editor/effects/vocabulary.ts` — the EDITOR's domain, which is what
 *    `BlockEffects` will accept as an attribute value.
 *
 *    Not `src/script/vocab.ts`, which is the writing *language's* domain and is
 *    deliberately smaller and slower-moving, because a name there is a promise
 *    to a chatbot. This panel read that one for a while and the two drifted
 *    hard: it offered five tapes and three washis while the editor accepted
 *    fifty of each, so forty-five values per axis existed, validated, rendered
 *    and could not be reached from any menu. A reader's panel has to offer what
 *    the editor accepts; the script domain stays small on purpose.
 *  - **Everything is searchable.** The shelves are for browsing; the search
 *    box is for when you already know the word.
 *  - **A shelf is not a heap.** "tape & trim" is eight vocabularies, not one:
 *    fifty tapes, fifty washis, fifty lifts, fifty frames, fifty papers, fifty
 *    underlines, fifty tints and the two tilts. They used to arrive as one
 *    undivided run of 352 tiles, so a reader who scrolled past the tapes had no
 *    way to know the frames existed. Each axis is now its own captioned run,
 *    capped at `CAP` with the real remaining count on the way in — which is
 *    what the reader asked for, and also what stops one panel open from
 *    building 557 tiles and three thousand DOM nodes.
 */
import { For, Show, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { NodeSelection } from '@tiptap/pm/state';
import { activeEditor } from '../../editor/insert/activeEditor';
import {
  armEffect,
  armSticker,
  armedStickerId,
  disarmMark,
  isArmedEffect,
} from '../../editor/effects/freePlacement';
import {
  BLOCK_ONLY_REASONS,
  DOODLE_KEY,
  PLACEABLE_AXES,
  isPlaceableKey,
} from '../../editor/effects/placeableEffects';
import { doodleSvg, type DoodleKind } from '../../editor/effects/doodles';
import { STICKER_IDS, stickerSvg, type StickerId } from '../../editor/nodes/stickers';
import { SQUIGGLE_DATA_URI } from '../../editor/effects/blockEffects';
import type { CalloutTint } from '../../editor/nodes/callout';
import { SLASH_COMMANDS, fuzzyScore, type SlashCommand } from '../../editor/slash/registry';
import { EFFECT_AXES, type EffectAxis } from '../../editor/effects/vocabulary';
import UserStickersSection from '../../features/templates/UserStickersSection';
// The studio's strip worked this out first; there is one implementation of
// "show a head, offer the rest" and this is a customer of it, not a copy. The
// same goes for the reader's own hand on a list: `createCuration` is the one
// controller, and the two shelves below are two more of its customers.
import { CAP, Capped, StarMark, createCuration, starWords } from './DesignStrip';
import type { CurationRow } from './DesignStrip';
import type { CurationAxis } from '../../data/shelfOfMine';
import '../../styles/catalogue.css';

/* ========================================================================== *
 *                                 the shelves                                *
 * ========================================================================== */

type ShelfId =
  | 'paper'
  | 'blocks'
  | 'callouts'
  | 'diagrams'
  | 'trim'
  | 'lettering'
  | 'stickers';

interface Shelf {
  readonly id: ShelfId;
  readonly label: string;
  /** One line under the shelf heading. Says what the shelf is FOR. */
  readonly blurb: string;
}

const SHELVES: readonly Shelf[] = [
  { id: 'paper', label: 'paper & cards', blurb: 'things stuck to the page' },
  { id: 'blocks', label: 'text blocks', blurb: 'the ordinary furniture' },
  { id: 'callouts', label: 'callouts', blurb: 'an aside, in its own wash' },
  { id: 'diagrams', label: 'diagrams', blurb: 'drawn from a few lines of text' },
  // Two modes here as well now, and the old blurb ("dresses the block your
  // cursor is on") flatly contradicted the one a reader had just chosen.
  { id: 'trim', label: 'tape & trim', blurb: 'on a block, or anywhere you point' },
  { id: 'lettering', label: 'lettering', blurb: 'which hand, what ink, how big' },
  // Not "drops in at your cursor" any more: this shelf now has two modes and
  // the heading was flatly contradicting the one the reader had just chosen.
  { id: 'stickers', label: 'stickers', blurb: 'at your cursor, or anywhere you point' },
];

/**
 * The two shelves that are LISTS a reader curates, and the word each is keyed
 * by in `data/shelfOfMine.ts`.
 *
 * Only two of the seven, deliberately. "paper & cards" is the stationery
 * drawer — twenty things a page can have stuck to it, most of which a given
 * writer will never once reach for — and "stickers" is fifty doodles. Those
 * are the shelves where a reader's own hand pays: the other five are either
 * short (four callouts, five diagrams) or are ATTRIBUTES of the block under
 * the caret rather than a list of things, and pruning a tape you can toggle
 * off again is a different act from pruning a drawer you have to scroll.
 *
 * The axis words are shared with the store and can never be renamed without
 * splitting a reader's curation in two — which is why they are written here
 * once, next to the shelf ids, rather than at each of the three places below
 * that need them.
 */
const SHELF_AXIS = {
  paper: 'stationery',
  stickers: 'sticker',
} as const satisfies Partial<Record<ShelfId, CurationAxis>>;

type CuratedShelf = keyof typeof SHELF_AXIS;

const isCuratedShelf = (shelf: ShelfId): shelf is CuratedShelf =>
  Object.prototype.hasOwnProperty.call(SHELF_AXIS, shelf);

/* ========================================================================== *
 *                                  entries                                   *
 * ========================================================================== */

interface CatalogueEntry {
  readonly id: string;
  readonly label: string;
  readonly shelf: ShelfId;
  /**
   * The run within the shelf this belongs to — an axis name, "tape", "ink".
   * Omitted for the things that are simply themselves: a stamp is not one of
   * fifty stamps. Every entry with a group gets its own captioned, capped run.
   */
  readonly group?: string;
  /** One line under the group heading, the axis's own words. */
  readonly groupBlurb?: string;
  /** Extra words the search should match ("post-it" finds the sticky note). */
  readonly keywords: readonly string[];
  /** A tiny picture of the thing, drawn in its own idiom where one exists. */
  readonly art?: () => JSX.Element;
  /** Present on toggles: whether the block under the caret already has it. */
  readonly pressed?: () => boolean;
  /**
   * A hand-drawn tooltip, when this tile will not do what the mode implies.
   *
   * The one case, and the reason the field exists: with "anywhere on the page"
   * chosen, a lift, an underline, a tilt or a tint still dresses the block the
   * cursor is in, because none of them has an extent of its own on bare paper.
   * That is a real answer rather than a limitation, so the tile carries it —
   * `BLOCK_ONLY_REASONS` in `effects/placeableEffects.ts` is where each is
   * written down, and this is the reader's way to it.
   */
  readonly hint?: () => string | undefined;
  run(): void;
}

/**
 * Which slash commands land on which shelf.
 *
 * Explicit rather than derived from the slash `section`, because the slash
 * menu has three sections and the catalogue has seven shelves — the same
 * commands, sorted for browsing rather than for typing. A command missing from
 * this table simply does not appear here, which is right for `turn-into`
 * (those act on the block you are in) and for `today` (a navigation, not an
 * insert).
 */
const SLASH_SHELF: Readonly<Record<string, ShelfId>> = {
  /* paper & cards */
  'index-card': 'paper',
  envelope: 'paper',
  stamp: 'paper',
  tag: 'paper',
  marginalia: 'paper',
  'sticky-note': 'paper',
  polaroid: 'paper',
  'washi-box': 'paper',
  card: 'paper',
  'quote-card': 'paper',
  banner: 'paper',
  spoiler: 'paper',
  columns: 'paper',
  /* the keepsake drawer, and the two fastenings after it */
  'pressed-flower': 'paper',
  'ticket-stub': 'paper',
  postcard: 'paper',
  ledger: 'paper',
  'photo-corner': 'paper',
  'wax-seal': 'paper',
  'map-pin': 'paper',
  /* text blocks */
  paragraph: 'blocks',
  'heading-1': 'blocks',
  'heading-2': 'blocks',
  'heading-3': 'blocks',
  'bullet-list': 'blocks',
  'ordered-list': 'blocks',
  'task-list': 'blocks',
  toggle: 'blocks',
  blockquote: 'blocks',
  'code-block': 'blocks',
  table: 'blocks',
  divider: 'blocks',
  /* diagrams */
  'diagram-tree': 'diagrams',
  'diagram-mindmap': 'diagrams',
  'diagram-flowchart': 'diagrams',
  'diagram-graph': 'diagrams',
  'diagram-timeline': 'diagrams',
};

/** The block-attribute toggles, keyed by shelf, straight off the vocabulary. */
interface EffectSpec {
  readonly key: string;
  readonly value: string | number;
  readonly label: string;
  readonly shelf: ShelfId;
  /** The axis's own heading — `EffectAxis.label`, never re-worded here. */
  readonly group: string;
  readonly groupBlurb: string;
  readonly keywords?: readonly string[];
}

/**
 * Every effect the editor accepts, built from the EDITOR's own vocabulary.
 *
 * This used to read `src/script/vocab.ts` plus a hand-written label map, and
 * the two drifted badly: the script domain offers five tapes and three washis
 * because a name there is a promise to a chatbot and moves slowly, while
 * `effects/vocabulary.ts` grew to fifty of each. The panel is a READER's menu,
 * so it must offer what the editor will accept — otherwise forty-five values
 * per axis exist, validate, render, and are unreachable from any UI.
 *
 * Labels and search tags come from the vocabulary too, so a value added there
 * appears here named correctly, for free. The hand-written map this replaces
 * was a second place to forget.
 */
function enumEffects(axis: EffectAxis): EffectSpec[] {
  const shelf: ShelfId = axis.shelf === 'colour' ? 'trim' : axis.shelf;
  return axis.values.map((entry) => ({
    key: axis.key,
    value: entry.value,
    label: entry.label,
    shelf,
    // Straight off the axis. `EffectAxis.label` is documented as "heading for
    // the axis inside its shelf" — this is the shelf, and this is the heading.
    group: axis.label,
    groupBlurb: axis.blurb,
    keywords: [axis.key, entry.value, axis.label, ...entry.tags],
  }));
}

const TILT_BLURB = 'lean the whole block off square';

/**
 * One seed for every doodle tile, so the picker is a specimen sheet.
 *
 * A placed doodle takes its own seed (`pageMarkNode`), which is what gives two
 * stars on a page two different hands. A picker is the other job: a tile that
 * re-rolled its wobble would be showing the reader a drawing they are not about
 * to get.
 */
const DOODLE_TILE_SEED = 0x5eed;

const EFFECTS: readonly EffectSpec[] = [
  {
    key: 'rotate',
    value: -2,
    label: 'tilt left',
    shelf: 'trim',
    group: 'tilt',
    groupBlurb: TILT_BLURB,
    keywords: ['rotate', 'tilt'],
  },
  {
    key: 'rotate',
    value: 2,
    label: 'tilt right',
    shelf: 'trim',
    group: 'tilt',
    groupBlurb: TILT_BLURB,
    keywords: ['rotate', 'tilt'],
  },
  ...EFFECT_AXES.flatMap(enumEffects),
];

/** Every attribute the "start again" button clears. */
const EFFECT_KEYS = [...new Set(EFFECTS.map((e) => e.key))];

/**
 * A live specimen of one trim, drawn by the trim's OWN stylesheet.
 *
 * A stationer lays out specimens because you choose tape by looking at tape.
 * The tile therefore renders a fragment carrying the real data-attribute under
 * `.nb-fx-specimen`, the second scope every rule in effects.css answers to, so
 * the tile is painted by the same declarations that will paint the page — no
 * second, hand-made copy of each effect to fall out of step with the first.
 * (Not `.nb-prose`: the tutorial spotlight and the e2e helpers resolve that one
 * document-wide, and a decoy in the left rail would capture them.) The wrapper
 * scales and clips, because a torn-paper block is 300px wide and a tile is 84.
 */
function effectArt(spec: EffectSpec): () => JSX.Element {
  const attrs: Record<string, string> = { [`data-${spec.key}`]: String(spec.value) };
  const style: Record<string, string> = {};
  // Two effects are fed by an inline custom property rather than by the
  // attribute alone; BlockEffects writes them on the real block, so the
  // specimen has to write them too.
  if (spec.key === 'rotate') style['--nb-rotate'] = `${String(spec.value)}deg`;
  if (spec.key === 'underline' && spec.value === 'squiggle') {
    style['--nb-squiggle'] = `url("${SQUIGGLE_DATA_URI}")`;
  }
  const word = spec.key === 'align' ? 'A a a' : 'Aa';
  return () => (
    <span class="nb-cat-demo" aria-hidden="true">
      <span class="nb-fx-specimen">
        <span class="nb-cat-demo-block" style={style} {...attrs}>
          {word}
        </span>
      </span>
    </span>
  );
}

/* ========================================================================== *
 *                             editor plumbing                                *
 * ========================================================================== */

/** Position + attrs of the top-level block under the selection, or null. */
function topBlockPos(): { pos: number; attrs: Record<string, unknown> } | null {
  const editor = activeEditor();
  if (!editor) return null;
  const sel = editor.state.selection;
  if (sel instanceof NodeSelection && sel.$from.depth === 0) {
    return { pos: sel.from, attrs: sel.node.attrs as Record<string, unknown> };
  }
  if (sel.$from.depth < 1) return null;
  const pos = sel.$from.before(1);
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return null;
  return { pos, attrs: node.attrs as Record<string, unknown> };
}

/** One captioned, capped run of tiles inside a shelf. */
interface CatalogueRun {
  /** The axis's heading, or '' for the shelf's own ungrouped things. */
  readonly name: string;
  readonly blurb: string;
  readonly items: CatalogueEntry[];
}

/** A slash command's icon as a catalogue tile picture. */
function slashArt(icon: SlashCommand['icon']): () => JSX.Element {
  if (icon.kind === 'sticker') {
    const markup = stickerSvg(icon.stickerId);
    // eslint-disable-next-line solid/no-innerhtml -- our own deterministic
    // markup, straight out of stickerSvg.
    return () => <span class="nb-cat-glyph" innerHTML={markup} />;
  }
  return () => <span class="nb-cat-glyph">{icon.text}</span>;
}

export default function CataloguePanel(): JSX.Element {
  const [query, setQuery] = createSignal('');
  const [shelf, setShelf] = createSignal<ShelfId | null>(null);
  // Bumped after every apply so the pressed states re-read the document. The
  // editor's own selection is not a Solid signal, so nothing else would.
  const [pulse, setPulse] = createSignal(0);

  /**
   * How a thing lands: at the caret / on the block, or wherever the reader
   * points.
   *
   * The reader: *"give user the option to drag and place stickers or any
   * effects, like i mean click on it and put it anywhere on the page, not
   * caring about where lines are"*. So the two shelves that CAN answer that —
   * stickers, and the placeable half of tape & trim — carry the same pair of
   * chips, and the second one is the mode they asked for: pick a thing here,
   * then click the page, and it sticks there, above the ruling, above the text,
   * dragged afterwards with the pointer.
   *
   * ONE mode across both shelves, not one each. A reader who has said "anywhere
   * on the page" has said it about their whole hand, and two independent
   * switches would mean picking a sticker silently un-picking the tape.
   * `editor/effects/freePlacement.ts` holds the one fact the two ends share and
   * `effects/placeableEffects.ts` holds which effects can travel this way at
   * all.
   *
   * The mode is remembered so somebody decorating a page can place six things
   * without re-choosing between each one — and a pick SURVIVES closing the
   * sheet, which is deliberate: the panel pushes the book sideways, so "put
   * this one in the far corner" wants the sheet out of the way first. What
   * makes that safe rather than mysterious is that the armed mark says so at
   * the foot of the page and offers the way out (`.nb-place-hint` in BookView),
   * so there is never a crosshair cursor with no visible cause. The cleanup
   * below is the last resort: closing the BOOK puts the mark down, since this
   * panel lives as long as the book view does and only unmounts with it.
   */
  const [freeMode, setFreeMode] = createSignal(false);
  onCleanup(() => disarmMark());

  /** Do the two placement chips belong on this shelf? */
  const hasPlacementModes = (shelfId: ShelfId): boolean =>
    shelfId === 'stickers' || shelfId === 'trim';

  /**
   * A trim tile: dress the block under the caret, or arm the mark.
   *
   * Only the PLACEABLE axes take the second branch. Free-placing a lift, an
   * underline or a tint would put an attribute on the page that paints nothing
   * — `[data-color]` in particular sets three custom properties and no pixels —
   * so those keep dressing the block even in free mode, and the note under the
   * chips says so rather than leaving the reader to discover it by clicking.
   */
  const runEffect = (spec: EffectSpec): void => {
    if (freeMode() && isPlaceableKey(spec.key)) {
      // Clicking the armed one again puts it down: a mode you cannot leave by
      // pressing the thing that started it is a mode people get stuck in.
      if (isArmedEffect(spec.key, String(spec.value))) disarmMark();
      else armEffect(spec.key, String(spec.value));
      return;
    }
    toggleEffect(spec);
  };

  const toggleEffect = (spec: EffectSpec): void => {
    const editor = activeEditor();
    const target = topBlockPos();
    if (!editor || !target) return;
    const next = target.attrs[spec.key] === spec.value ? null : spec.value;
    editor.view.dispatch(editor.state.tr.setNodeAttribute(target.pos, spec.key, next));
    editor.commands.focus();
    setPulse((n) => n + 1);
  };

  /**
   * Lit when the tile is "on" — which means two different things by mode.
   *
   * In free mode it is the mark waiting for somewhere to land; otherwise it is
   * the attribute already on the block under the caret. Reading the document
   * while armed would light nothing and the reader would have no sign that
   * their click had been taken.
   */
  const isApplied = (spec: EffectSpec): boolean => {
    if (freeMode() && isPlaceableKey(spec.key)) {
      return isArmedEffect(spec.key, String(spec.value));
    }
    pulse();
    return topBlockPos()?.attrs[spec.key] === spec.value;
  };

  const clearEffects = (): void => {
    const editor = activeEditor();
    const target = topBlockPos();
    if (!editor || !target) return;
    let tr = editor.state.tr;
    for (const key of EFFECT_KEYS) {
      if (target.attrs[key] != null) tr = tr.setNodeAttribute(target.pos, key, null);
    }
    if (tr.docChanged) editor.view.dispatch(tr);
    setPulse((n) => n + 1);
  };

  /**
   * Run a slash command from here.
   *
   * The registry's commands all take a `range` to delete — the "/query" the
   * reader typed. From the panel there is no such text, so the range is the
   * caret collapsed on itself and `deleteRange` becomes a no-op. That is the
   * whole adapter, and it is why this panel and the slash menu can share one
   * list of insertables instead of two that drift.
   */
  const runCommand = (command: SlashCommand): void => {
    const editor = activeEditor();
    if (!editor) return;
    const at = editor.state.selection.from;
    command.run({ editor, range: { from: at, to: at } });
    setPulse((n) => n + 1);
  };

  const insertCallout = (tint: CalloutTint, icon: StickerId): void => {
    const editor = activeEditor();
    if (!editor) return;
    editor.chain().focus().setCallout({ tint, icon }).run();
    setPulse((n) => n + 1);
  };

  const insertSticker = (stickerId: StickerId): void => {
    if (freeMode()) {
      // Arm it; `BookView` places it on the next click on a leaf. Clicking the
      // armed sticker again puts it down — a mode you cannot leave by pressing
      // the thing that started it is a mode people get stuck in.
      if (armedStickerId() === stickerId) disarmMark();
      else armSticker(stickerId);
      return;
    }
    const editor = activeEditor();
    if (!editor) return;
    editor.chain().focus().insertSticker({ stickerId }).run();
    setPulse((n) => n + 1);
  };

  /**
   * A pencil doodle, which is placeable and NOTHING ELSE.
   *
   * The five sketches in `effects/doodles.ts` have always had a position and a
   * size — `planDoodles` gives every page two to four of them in the margins —
   * and until now the only thing that could choose either was a seed off the
   * page id. There is no block attribute for one, so "at the cursor" has no
   * meaning here: clicking a doodle switches the shelf into free mode and arms
   * it, rather than being a tile that does nothing in one of the two modes.
   */
  const armDoodle = (kind: string): void => {
    setFreeMode(true);
    if (isArmedEffect(DOODLE_KEY, kind)) disarmMark();
    else armEffect(DOODLE_KEY, kind);
  };

  /* ------------------------------ the entries ---------------------------- */

  const entries = createMemo<CatalogueEntry[]>(() => {
    const out: CatalogueEntry[] = [];

    for (const command of SLASH_COMMANDS) {
      const target = SLASH_SHELF[command.id];
      if (target === undefined) continue;
      out.push({
        id: `cmd-${command.id}`,
        label: command.title,
        shelf: target,
        keywords: [...command.keywords, command.subtitle ?? ''],
        art: slashArt(command.icon),
        run: () => runCommand(command),
      });
    }

    // The four callouts, each as itself rather than as one "callout" you then
    // have to click twice to recolour.
    const CALLOUTS: readonly { tint: CalloutTint; icon: StickerId; label: string }[] = [
      { tint: 'sky', icon: 'sparkle', label: 'note' },
      { tint: 'moss', icon: 'leaf', label: 'tip' },
      { tint: 'terracotta', icon: 'bee', label: 'warning' },
      { tint: 'amber', icon: 'star', label: 'important' },
    ];
    for (const callout of CALLOUTS) {
      out.push({
        id: `callout-${callout.label}`,
        label: callout.label,
        shelf: 'callouts',
        keywords: ['callout', 'aside', callout.label, callout.tint],
        art: () => (
          <span class="nb-cat-glyph" data-tint={callout.tint}>
            <span
              // eslint-disable-next-line solid/no-innerhtml -- stickerSvg
              innerHTML={stickerSvg(callout.icon)}
            />
          </span>
        ),
        run: () => insertCallout(callout.tint, callout.icon),
      });
    }

    for (const spec of EFFECTS) {
      out.push({
        id: `fx-${spec.key}-${String(spec.value)}`,
        label: spec.label,
        shelf: spec.shelf,
        group: spec.group,
        groupBlurb: spec.groupBlurb,
        keywords: spec.keywords ?? [spec.key],
        art: effectArt(spec),
        pressed: () => isApplied(spec),
        hint: () =>
          freeMode() && !isPlaceableKey(spec.key)
            ? BLOCK_ONLY_REASONS[spec.key]
            : undefined,
        run: () => runEffect(spec),
      });
    }

    // The five pencil doodles. On the trim shelf rather than with the stickers
    // because a doodle is a mark you make ON the paper, which is what that
    // whole shelf is; and in their own captioned run, because they are the one
    // axis here with no block-attribute form at all.
    for (const axis of PLACEABLE_AXES) {
      if (axis.key !== DOODLE_KEY) continue;
      for (const kind of axis.values) {
        out.push({
          id: `fx-doodle-${kind}`,
          label: kind,
          shelf: 'trim',
          group: axis.label,
          groupBlurb: axis.blurb,
          keywords: ['doodle', 'pencil', 'sketch', kind, 'place', 'anywhere'],
          art: () => (
            <span class="nb-cat-glyph nb-cat-doodle">
              <span
                // eslint-disable-next-line solid/no-innerhtml -- deterministic
                // markup from doodleSvg; no user text ever reaches it.
                innerHTML={doodleSvg(kind as DoodleKind, DOODLE_TILE_SEED)}
              />
            </span>
          ),
          pressed: () => isArmedEffect(DOODLE_KEY, kind),
          run: () => armDoodle(kind),
        });
      }
    }

    for (const id of STICKER_IDS) {
      out.push({
        id: `sticker-${id}`,
        label: id,
        shelf: 'stickers',
        keywords: ['sticker', 'doodle', id, 'place', 'anywhere'],
        art: () => (
          <span
            class="nb-cat-glyph"
            // eslint-disable-next-line solid/no-innerhtml -- stickerSvg
            innerHTML={stickerSvg(id)}
          />
        ),
        // Lit while it is the one waiting for somewhere to land.
        pressed: () => armedStickerId() === id,
        run: () => insertSticker(id),
      });
    }

    return out;
  });

  /*
   * The reader's hand on the two long shelves.
   *
   * One controller per axis rather than one per RUN, because each of these
   * shelves is a single ungrouped run (see `runsOn`) and because a removal is
   * keyed by (axis, entry id) — two controllers over one axis would be two
   * menus writing the same rows, which is the drift the shared controller
   * exists to make impossible.
   *
   * `activeId` is '' on purpose. On a strip it names the entry the reader is
   * WEARING, so a removed-but-current tile keeps showing; nothing here is worn
   * — a sticker is dropped and gone — so a removal takes effect immediately,
   * which is what a reader who just removed one expects to see.
   */
  const shelfRows = (shelf: CuratedShelf): readonly CurationRow[] =>
    entries()
      .filter((entry) => entry.shelf === shelf)
      .map((entry) => ({ id: entry.id, name: entry.label }));

  const paperCuration = createCuration<CurationRow>(() => ({
    axis: SHELF_AXIS.paper,
    label: 'paper & cards',
    options: shelfRows('paper'),
    activeId: '',
  }));

  const stickerCuration = createCuration<CurationRow>(() => ({
    axis: SHELF_AXIS.stickers,
    label: 'stickers',
    options: shelfRows('stickers'),
    activeId: '',
  }));

  const curationFor = (
    shelf: ShelfId,
  ): ReturnType<typeof createCuration<CurationRow>> | null =>
    shelf === 'paper' ? paperCuration : shelf === 'stickers' ? stickerCuration : null;

  /**
   * Everything on offer, with the reader's removals taken out.
   *
   * BEFORE the search box, not after — the same order `DesignPicker` puts them
   * in, and for the same reason: a removed entry that the search still finds is
   * a removal that only half happened, and the reader meets the other half at
   * the worst moment, when they have typed its name and it comes back.
   *
   * Order is deliberately NOT applied here. Stars lead a FAMILY, and the
   * families only exist once `runsOn` has split a shelf into its runs.
   */
  const curated = createMemo<CatalogueEntry[]>(() => {
    const kept = new Set(
      [...paperCuration.list(), ...stickerCuration.list()].map((row) => row.id),
    );
    return entries().filter((entry) => !isCuratedShelf(entry.shelf) || kept.has(entry.id));
  });

  /** Search first, shelf filter second — a query looks everywhere. */
  const visible = createMemo<CatalogueEntry[]>(() => {
    const q = query().trim();
    if (q !== '') {
      const scored: { entry: CatalogueEntry; score: number }[] = [];
      for (const entry of curated()) {
        let best = fuzzyScore(q, entry.label);
        for (const word of entry.keywords) {
          const s = fuzzyScore(q, word);
          if (s !== null && (best === null || s - 2 > best)) best = s - 2;
        }
        if (best !== null) scored.push({ entry, score: best });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.map((s) => s.entry);
    }
    const only = shelf();
    return only === null ? curated() : curated().filter((e) => e.shelf === only);
  });

  const shelvesShown = createMemo<readonly Shelf[]>(() => {
    const present = new Set(visible().map((e) => e.shelf));
    return SHELVES.filter((s) => present.has(s.id));
  });

  const searching = (): boolean => query().trim() !== '';

  /**
   * One shelf, split into its runs.
   *
   * Gathered by NAME rather than by consecutive block, for the same reason
   * DesignPicker gathers its groups that way: an ordering that is nearly but
   * not quite sorted prints the same heading twice with cards in between, and
   * that reads as a bug. The ungrouped run keeps the empty name and therefore
   * keeps its place — for "paper & cards" it is the whole shelf, and for
   * "stickers" it is the fifty doodles.
   *
   * Built per shelf rather than once for everything, because the shelves are
   * rendered independently and a shared index would be a second thing to keep
   * in step with `visible()`.
   */
  const runsOn = (shelfId: ShelfId): readonly CatalogueRun[] => {
    const runs: CatalogueRun[] = [];
    const byName = new Map<string, CatalogueRun>();
    for (const entry of visible()) {
      if (entry.shelf !== shelfId) continue;
      const name = entry.group ?? '';
      let run = byName.get(name);
      if (run === undefined) {
        run = { name, blurb: entry.groupBlurb ?? '', items: [] };
        byName.set(name, run);
        runs.push(run);
      }
      run.items.push(entry);
    }
    /*
     * The stars, applied to the tiles.
     *
     * The removals were already taken out upstream (`curated`); what is left
     * here is ORDER, and order is the half that must not touch a hit list. A
     * reader who typed a word wants the closest match first — a starred tile
     * jumping to the head of their search results is the same lie `cappedTo`
     * refuses to tell when it declines to pin the active row into a query.
     *
     * Taken from the controller's own list rather than by re-sorting on
     * `starsOf` here: a second copy of that ordering is exactly what drifts.
     */
    const curation = curationFor(shelfId);
    if (curation === null || searching()) return runs;
    const at = new Map(curation.list().map((row, index) => [row.id, index]));
    return runs.map((run) => ({
      ...run,
      items: [...run.items].sort((a, b) => (at.get(a.id) ?? 0) - (at.get(b.id) ?? 0)),
    }));
  };

  return (
    <div class="nb-catalogue">
      {/* Search AND the shelf tabs, in one block that stays put. They are how
          you get anywhere else in the drawer, and losing them four hundred
          pixels down a shelf is the same complaint as losing a back button. */}
      <div class="nb-cat-head nb-sheet-head">
        <div class="nb-cat-search">
          <input
            type="search"
            class="nb-cat-search-input"
            placeholder="search the catalogue…"
            aria-label="Search the catalogue"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </div>

        <Show when={!searching()}>
          <div class="nb-cat-shelves" role="group" aria-label="Shelves">
            <button
              type="button"
              class="nb-chip"
              aria-pressed={shelf() === null}
              onClick={() => setShelf(null)}
            >
              everything
            </button>
            <For each={SHELVES}>
              {(s) => (
                <button
                  type="button"
                  class="nb-chip"
                  aria-pressed={shelf() === s.id}
                  onClick={() => setShelf(shelf() === s.id ? null : s.id)}
                >
                  {s.label}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>

      <Show
        when={visible().length > 0}
        fallback={
          <p class="nb-panel-footnote nb-cat-empty">
            nothing here by that name. try “tape”, “quote”, “flowchart”…
          </p>
        }
      >
        <For each={shelvesShown()}>
          {(s) => (
            <section class="nb-panel-section nb-cat-shelf" data-shelf={s.id}>
              <h3 class="nb-panel-section-title">
                {s.label} <em class="nb-panel-row-hint">{s.blurb}</em>
              </h3>

              {/* Where a thing lands. Only the two shelves that can answer
                  "anywhere" carry the choice, so the control lives on the shelf
                  rather than in the panel head — the other five would be
                  offering a mode that does nothing on them. */}
              <Show when={hasPlacementModes(s.id)}>
                <div
                  class="nb-cat-mode nb-chip-row"
                  role="group"
                  aria-label="Where it lands"
                >
                  <button
                    type="button"
                    class="nb-chip"
                    data-mode="anchored"
                    aria-pressed={!freeMode()}
                    onClick={() => {
                      setFreeMode(false);
                      disarmMark();
                    }}
                  >
                    {s.id === 'trim' ? 'on this block' : 'at the cursor'}
                  </button>
                  <button
                    type="button"
                    class="nb-chip"
                    data-mode="free"
                    aria-pressed={freeMode()}
                    onClick={() => setFreeMode(true)}
                  >
                    anywhere on the page
                  </button>
                </div>
                <p class="nb-panel-footnote nb-cat-mode-note">
                  <Show
                    when={freeMode()}
                    fallback={
                      <Show
                        when={s.id === 'trim'}
                        fallback={
                          <>the sticker drops in beside your caret, like a word</>
                        }
                      >
                        every trim dresses the block your cursor is in
                      </Show>
                    }
                  >
                    <Show
                      when={s.id === 'trim'}
                      fallback={
                        <>
                          pick one, then click the page — it sticks where you
                          point, over the ruling, and you can drag it after
                        </>
                      }
                    >
                      {/* Naming the split rather than letting a reader find it
                          by clicking: tape, washi, frames, paper and doodles are
                          THINGS, and a lift, an underline or a tint is something
                          you do TO a block — see effects/placeableEffects.ts. */}
                      pick a tape, washi, frame, paper or doodle, then click the
                      page — it sticks where you point and you can drag or
                      stretch it after. lifts, underlines, tilts and tints still
                      dress the block your cursor is in: they have nothing to
                      hold on to on bare paper
                    </Show>
                  </Show>
                </p>
              </Show>

              <For each={runsOn(s.id)}>
                {(run) => (
                  <>
                    <Show when={run.name !== ''}>
                      <h4 class="nb-cat-run-title">
                        {run.name}
                        <span class="nb-cat-run-count">{run.items.length}</span>
                        <em class="nb-cat-run-blurb">{run.blurb}</em>
                      </h4>
                    </Show>
                    <div
                      class="nb-cat-grid"
                      role="group"
                      aria-label={run.name === '' ? s.label : `${s.label}: ${run.name}`}
                      /* Right-click the shelf itself for what was removed from
                         it. A no-op on the five shelves that name no axis, the
                         same way the strip stands down without one. */
                      on:contextmenu={(event) => curationFor(s.id)?.onListContext(event)}
                    >
                      <Capped
                        each={run.items}
                        limit={CAP}
                        label={run.name === '' ? s.label : run.name}
                        /* NOT `nb-cat-item`: probes and tests count that class
                           to mean "a thing you can add", and a reveal control
                           wearing it would inflate every one of those counts.
                           It borrows the tile's box in CSS instead. */
                        moreClass="nb-cat-more"
                        /* No pinning inside a hit list — see cappedTo. */
                        isActive={
                          searching() ? undefined : (entry) => entry.pressed?.() ?? false
                        }
                        resetKey={`${query()}|${shelf() ?? ''}`}
                      >
                        {(entry) => (
                          <button
                            type="button"
                            class="nb-cat-item"
                            data-entry={entry().id}
                            aria-pressed={entry().pressed?.() ?? undefined}
                            aria-label={
                              (curationFor(s.id)?.starsFor(entry().id) ?? 0) === 0
                                ? undefined
                                : `${entry().label}${starWords(
                                    curationFor(s.id)?.starsFor(entry().id) ?? 0,
                                  )}`
                            }
                            classList={{ 'is-on': entry().pressed?.() ?? false }}
                            /* Only ever set on a tile whose behaviour differs
                               from what the chosen mode implies — see
                               CatalogueEntry.hint. */
                            data-tooltip={entry().hint?.()}
                            data-tooltip-side="right"
                            onClick={() => entry().run()}
                            on:contextmenu={(event) =>
                              curationFor(s.id)?.onEntryContext(event, entry().id)
                            }
                          >
                            {/* The star's positioning context. A catalogue tile
                                is art over a caption, so the plate lands on the
                                art exactly as it does on a strip tile. */}
                            <StarMark stars={curationFor(s.id)?.starsFor(entry().id) ?? 0} />
                            <Show when={entry().art}>{(art) => art()()}</Show>
                            <span class="nb-cat-label">{entry().label}</span>
                          </button>
                        )}
                      </Capped>
                    </div>
                  </>
                )}
              </For>
            </section>
          )}
        </For>
      </Show>

      {/*
        Both restore drawers, once, at the foot.

        The strip and the picker put the overlay directly under the list it
        belongs to; a shelf here is a hundred tiles tall, so "directly under"
        would be off screen either way. `createCuration` scrolls its own drawer
        into view, and the menu is fixed at the pointer, so the drawers land
        where the reader is looking regardless of where they are mounted — and
        one mount apiece is what keeps two menus from ever writing one axis.
      */}
      <paperCuration.Overlay />
      <stickerCuration.Overlay />

      <Show when={!searching() && (shelf() === null || shelf() === 'stickers')}>
        <UserStickersSection />
      </Show>

      <section class="nb-panel-section nb-panel-section-divided">
        <div class="nb-chip-row">
          <button type="button" class="nb-chip nb-chip-ghost" onClick={clearEffects}>
            start this block again
          </button>
        </div>
        {/* "start this block again" clears the block ATTRIBUTES, and always
            did. It has nothing to say about a mark on the page — that comes off
            with the × on its own puck — so the footnote now says which of the
            two it is talking about rather than implying it undoes everything. */}
        <p class="nb-panel-footnote">
          paper, cards and diagrams drop in at your cursor; tape, trim and
          lettering dress the block the cursor is already on — click an applied
          one again to take it off. anything you stuck ON the page comes off with
          the × on its own little bar
        </p>
      </section>
    </div>
  );
}
