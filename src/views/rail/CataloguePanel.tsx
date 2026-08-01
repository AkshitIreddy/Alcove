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
 */
import { For, Show, createMemo, createSignal, type JSX } from 'solid-js';
import { NodeSelection } from '@tiptap/pm/state';
import { activeEditor } from '../../editor/insert/activeEditor';
import { STICKER_IDS, stickerSvg, type StickerId } from '../../editor/nodes/stickers';
import { SQUIGGLE_DATA_URI } from '../../editor/effects/blockEffects';
import type { CalloutTint } from '../../editor/nodes/callout';
import { SLASH_COMMANDS, fuzzyScore, type SlashCommand } from '../../editor/slash/registry';
import { EFFECT_AXES, type EffectAxis } from '../../editor/effects/vocabulary';
import UserStickersSection from '../../features/templates/UserStickersSection';
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
  { id: 'trim', label: 'tape & trim', blurb: 'dresses the block your cursor is on' },
  { id: 'lettering', label: 'lettering', blurb: 'which hand, what ink, how big' },
  { id: 'stickers', label: 'stickers', blurb: 'drops in at your cursor' },
];

/* ========================================================================== *
 *                                  entries                                   *
 * ========================================================================== */

interface CatalogueEntry {
  readonly id: string;
  readonly label: string;
  readonly shelf: ShelfId;
  /** Extra words the search should match ("post-it" finds the sticky note). */
  readonly keywords: readonly string[];
  /** A tiny picture of the thing, drawn in its own idiom where one exists. */
  readonly art?: () => JSX.Element;
  /** Present on toggles: whether the block under the caret already has it. */
  readonly pressed?: () => boolean;
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
    keywords: [axis.key, entry.value, axis.label, ...entry.tags],
  }));
}

const EFFECTS: readonly EffectSpec[] = [
  { key: 'rotate', value: -2, label: 'tilt left', shelf: 'trim', keywords: ['rotate', 'tilt'] },
  { key: 'rotate', value: 2, label: 'tilt right', shelf: 'trim', keywords: ['rotate', 'tilt'] },
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
 * second, hand-drawn copy of each effect to fall out of step with the first.
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

  const toggleEffect = (spec: EffectSpec): void => {
    const editor = activeEditor();
    const target = topBlockPos();
    if (!editor || !target) return;
    const next = target.attrs[spec.key] === spec.value ? null : spec.value;
    editor.view.dispatch(editor.state.tr.setNodeAttribute(target.pos, spec.key, next));
    editor.commands.focus();
    setPulse((n) => n + 1);
  };

  const isApplied = (spec: EffectSpec): boolean => {
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
    const editor = activeEditor();
    if (!editor) return;
    editor.chain().focus().insertSticker({ stickerId }).run();
    setPulse((n) => n + 1);
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
        keywords: spec.keywords ?? [spec.key],
        art: effectArt(spec),
        pressed: () => isApplied(spec),
        run: () => toggleEffect(spec),
      });
    }

    for (const id of STICKER_IDS) {
      out.push({
        id: `sticker-${id}`,
        label: id,
        shelf: 'stickers',
        keywords: ['sticker', 'doodle', id],
        art: () => (
          <span
            class="nb-cat-glyph"
            // eslint-disable-next-line solid/no-innerhtml -- stickerSvg
            innerHTML={stickerSvg(id)}
          />
        ),
        run: () => insertSticker(id),
      });
    }

    return out;
  });

  /** Search first, shelf filter second — a query looks everywhere. */
  const visible = createMemo<CatalogueEntry[]>(() => {
    const q = query().trim();
    if (q !== '') {
      const scored: { entry: CatalogueEntry; score: number }[] = [];
      for (const entry of entries()) {
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
    return only === null ? entries() : entries().filter((e) => e.shelf === only);
  });

  const shelvesShown = createMemo<readonly Shelf[]>(() => {
    const present = new Set(visible().map((e) => e.shelf));
    return SHELVES.filter((s) => present.has(s.id));
  });

  const searching = (): boolean => query().trim() !== '';

  return (
    <div class="nb-catalogue">
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
              <div class="nb-cat-grid" role="group" aria-label={s.label}>
                <For each={visible().filter((e) => e.shelf === s.id)}>
                  {(entry) => (
                    <button
                      type="button"
                      class="nb-cat-item"
                      data-entry={entry.id}
                      aria-pressed={entry.pressed?.() ?? undefined}
                      classList={{ 'is-on': entry.pressed?.() ?? false }}
                      onClick={() => entry.run()}
                    >
                      <Show when={entry.art}>{(art) => art()()}</Show>
                      <span class="nb-cat-label">{entry.label}</span>
                    </button>
                  )}
                </For>
              </div>
            </section>
          )}
        </For>
      </Show>

      <Show when={!searching() && (shelf() === null || shelf() === 'stickers')}>
        <UserStickersSection />
      </Show>

      <section class="nb-panel-section nb-panel-section-divided">
        <div class="nb-chip-row">
          <button type="button" class="nb-chip nb-chip-ghost" onClick={clearEffects}>
            start this block again
          </button>
        </div>
        <p class="nb-panel-footnote">
          paper, cards and diagrams drop in at your cursor; tape, trim and
          lettering dress the block the cursor is already on — click an applied
          one again to take it off
        </p>
      </section>
    </div>
  );
}
