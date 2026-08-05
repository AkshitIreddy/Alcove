/**
 * footnote — a marker in the prose and the note itself at the foot of the page.
 *
 * THE PAGINATION PROBLEM, AND WHY THE NOTE LIVES IN THE MARKER
 *
 * Pages here are fixed-height and overflow FLOWS ONWARD: PageEditor peels
 * trailing blocks off and BookView prepends them to the next page (see
 * src/editor/pagination.ts). A footnote is only a footnote if the note is on
 * the page its reference landed on — so the note has to travel with the
 * reference, through a mechanism that knows nothing about footnotes.
 *
 * Every design that keeps the notes in a separate place (a trailing block, a
 * side table, a store keyed by page) has to be told about that move, and would
 * be wrong for the one frame before it was. So the note text is an ATTRIBUTE
 * OF THE MARKER. The marker is inline, inside a paragraph; when that paragraph
 * flows to the next page its JSON goes with it, attributes and all, and the
 * note arrives already attached. Nothing in the pagination contract had to
 * learn a thing, and there is no state that can disagree with the document.
 *
 * The cost is that a note is plain text — no bold, no links inside a note.
 * That is a real limit and it is the right trade: the alternative buys marks
 * inside notes with a second document that can drift from the first.
 *
 * WHERE THE NOTES ARE DRAWN
 *
 * A plugin view builds one `<ol class="nb-footnote-rail">` per page editor and
 * puts it in `.nb-page-editor` — NOT inside the ProseMirror element. The
 * overflow drain measures `root.children` and maps them one-to-one onto the
 * doc's top-level blocks, so anything extra in there makes it peel a block too
 * many. Outside, it costs the drain nothing.
 *
 * The rail still has to take its space out of the page, or the prose would run
 * underneath it. It does that through the ONE quantity the drain already reads
 * back live on every pass: the prose root's `padding-bottom`. The rail
 * measures itself and publishes `--nb-footnote-rail`; editor.css adds it to
 * the padding; the next drain pass sees a smaller page and hands the tail
 * onward. That is also why a note can never push its own reference off the
 * page and strand itself: the reference leaves in the same pass, and the note
 * goes with it.
 *
 * NUMBERING is a decoration, not a CSS counter. A counter cannot count what is
 * `display: none`, and a footnote inside a closed toggle is exactly that — the
 * markers after it would have been numbered one lower than the rail's notes.
 * One walk of the document numbers both.
 *
 * HOW TO MEASURE THE ONE THING THAT CAN GO WRONG HERE
 *
 * The rail is `position: absolute`, so it cannot push: if the reservation above
 * ever fails to reach the drain, the notes are simply printed under whatever is
 * standing at the foot of the page. That is what frame 778 of the first demo
 * recording showed — a note running beneath a callout card and its wash — and
 * `scripts/probe-footnote-overprint.mjs` is the instrument for it. It turns to a
 * page carrying notes, measures the rail's top edge against the bottom of every
 * top-level block, and does it three times: as the page was authored, with the
 * page typed full to its fold, and again after a note has been grown long enough
 * to wrap the rail onto a third line UNDER a page that was already full. That
 * last one is the interesting direction — nothing schedules a fresh drain when a
 * note gets taller except the transaction the note's own text arrives in.
 *
 * TWO THINGS THAT MAKE THIS EASY TO MEASURE WRONGLY, both paid for once:
 *
 *  - The page as authored proves nothing. Seed page 25 stands 652px tall in an
 *    821px prose whose rail begins at 712px, so it reads clean whether the
 *    reservation is honoured or not — deleting the reservation outright left the
 *    verdict green. A page with room to spare cannot testify about a mechanism
 *    that only matters when there is none. Hence the fill, and hence the
 *    probe's `--sabotage`, which blanks the rail out of the padding so the check
 *    can be watched going red before it is believed going green.
 *  - `.nb-export-sheet` also wears `.nb-leaf-paper` — on purpose, so every
 *    `.nb-spread …` rule reaches the export capture's staging sheet
 *    (src/editor/script/exporters/capture.ts, and src/flip/offscreenPages.ts
 *    stages one inside the live spread for the turning page's back face). It
 *    holds a whole document, it is never drained, and it lives at left:-11880.
 *    Counted as a leaf it reports tens of blocks and thousands of pixels of
 *    overprint on a page the reader is seeing seven blocks of. A measurement of
 *    this defect that does not exclude it is measuring a page nobody can see.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';

/** A note's marker position in the doc, and the note it carries. */
export interface FootnoteRef {
  /** Position of the marker node itself (`nodeSize` is always 1). */
  readonly pos: number;
  readonly text: string;
}

/**
 * Every footnote in `doc`, in reading order — which is the order they are
 * numbered in and the order they are listed at the foot of the page.
 *
 * Pure and DOM-free so the numbering can be unit-tested; `descendants` reaches
 * into closed toggles, table cells and columns, because a note inside one is
 * still a note on this page.
 */
export function collectFootnotes(doc: ProseMirrorNode): FootnoteRef[] {
  const out: FootnoteRef[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'footnote') {
      const raw: unknown = node.attrs.text;
      out.push({ pos, text: typeof raw === 'string' ? raw : '' });
    }
    return true;
  });
  return out;
}

/** The placeholder a note with nothing written in it shows in the rail. */
export const EMPTY_FOOTNOTE_HINT = 'write the note…';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      /** Drop a footnote marker at the caret and start its note. */
      insertFootnote: (text?: string) => ReturnType;
      /** Rewrite the note at `pos` (used by the rail as the reader types). */
      setFootnoteText: (pos: number, text: string) => ReturnType;
    };
  }
}

export const Footnote = Node.create({
  name: 'footnote',

  inline: true,

  group: 'inline',

  // An atom: the marker is a mark of place, not a place to write. The note is
  // written at the foot of the page, where it will be read.
  atom: true,

  selectable: true,

  draggable: false,

  addAttributes() {
    return {
      text: {
        default: '',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-text') ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-text': typeof attributes.text === 'string' ? attributes.text : '',
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'sup[data-type="footnote"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'sup',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'footnote',
        class: 'nb-footnote-ref',
      }),
    ];
  },

  addCommands() {
    return {
      insertFootnote:
        (text = '') =>
        ({ state, chain }) => {
          // A marker belongs against the word it annotates. The slash menu
          // leaves the space that opened it ("…the cell /footnote"), and a
          // raised number floating a space away from its word reads as a typo.
          const { from } = state.selection;
          const before =
            from > 0 ? state.doc.textBetween(from - 1, from) : '';
          const start = before === ' ' ? from - 1 : from;
          return chain()
            .insertContentAt(
              { from: start, to: from },
              { type: 'footnote', attrs: { text } },
            )
            .run();
        },

      setFootnoteText:
        (pos, text) =>
        ({ state, tr, dispatch }) => {
          const node = state.doc.nodeAt(pos);
          if (node === null || node.type.name !== 'footnote') return false;
          if (node.attrs.text === text) return false;
          if (!dispatch) return true;
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, text });
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [footnoteRailPlugin()];
  },
});

// ---------------------------------------------------------------------------
// Numbering + the rail
// ---------------------------------------------------------------------------

const footnoteKey = new PluginKey('nbFootnotes');

/** `data-note="3"` on every marker, so CSS can print the number. */
function numberingDecorations(state: EditorState): DecorationSet {
  const refs = collectFootnotes(state.doc);
  if (refs.length === 0) return DecorationSet.empty;
  return DecorationSet.create(
    state.doc,
    refs.map((ref, index) =>
      Decoration.node(ref.pos, ref.pos + 1, {
        'data-note': String(index + 1),
      }),
    ),
  );
}

/** True when two note lists would draw the same rail. */
function sameNotes(a: readonly FootnoteRef[], b: readonly FootnoteRef[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((ref, index) => ref.text === b[index]?.text);
}

/**
 * The foot of the page: one `<ol>` of notes, kept in step with the document.
 *
 * Entries are patched rather than rebuilt whenever the count has not changed,
 * because the reader is usually typing INTO one of them — rebuilding would
 * take the caret away on every keystroke.
 */
class FootnoteRail {
  private readonly host: HTMLElement | null;

  private readonly list: HTMLOListElement;

  /** Marker positions, index-aligned with the rail's entries. */
  private positions: number[] = [];

  private notes: FootnoteRef[] = [];

  /** Re-measures when the notes rewrap without the document changing. */
  private readonly resize: ResizeObserver | null;

  constructor(private readonly view: EditorView) {
    this.host = view.dom.parentElement;
    this.list = document.createElement('ol');
    this.list.className = 'nb-footnote-rail';
    this.list.setAttribute('role', 'list');
    this.list.hidden = true;
    this.host?.appendChild(this.list);
    view.dom.addEventListener('click', this.onMarkerClick);
    // A window resize rewraps the notes and changes how much of the page they
    // need, with no transaction to notice it by.
    this.resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => this.measure());
    this.resize?.observe(this.list);
    this.sync();
  }

  update(): void {
    this.sync();
  }

  destroy(): void {
    this.resize?.disconnect();
    this.view.dom.removeEventListener('click', this.onMarkerClick);
    this.list.remove();
    this.host?.style.removeProperty('--nb-footnote-rail');
  }

  /** Clicking a marker puts the caret in its note, which is where you write. */
  private readonly onMarkerClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const marker = target.closest('[data-type="footnote"]');
    if (!(marker instanceof HTMLElement)) return;
    const index = Number(marker.getAttribute('data-note')) - 1;
    const entry = this.list.children[index]?.querySelector('.nb-footnote-note');
    if (!(entry instanceof HTMLElement)) return;
    event.preventDefault();
    entry.focus();
    const range = document.createRange();
    range.selectNodeContents(entry);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  private sync(): void {
    const refs = collectFootnotes(this.view.state.doc);
    // Positions move on EVERY transaction, so they are always refreshed; the
    // rail's DOM is only touched when the notes themselves changed.
    this.positions = refs.map((ref) => ref.pos);
    if (sameNotes(refs, this.notes)) return;
    if (refs.length !== this.notes.length) this.rebuild(refs);
    else this.patch(refs);
    this.notes = refs;
    this.list.hidden = refs.length === 0;
    this.measure();
  }

  private rebuild(refs: readonly FootnoteRef[]): void {
    this.list.replaceChildren();
    refs.forEach((ref, index) => {
      const item = document.createElement('li');
      item.className = 'nb-footnote-entry';

      const mark = document.createElement('span');
      mark.className = 'nb-footnote-index';
      mark.textContent = String(index + 1);
      mark.setAttribute('aria-hidden', 'true');

      const note = document.createElement('div');
      note.className = 'nb-footnote-note';
      // A read-only editor gets read-only notes — the export capture mounts one
      // of these offscreen to rasterize a page, and a caret in a screenshot is
      // a caret in the PDF.
      if (this.view.editable) note.contentEditable = 'plaintext-only';
      note.spellcheck = true;
      note.dataset.hint = EMPTY_FOOTNOTE_HINT;
      note.setAttribute('role', 'textbox');
      note.setAttribute('aria-label', `Note ${index + 1}`);
      note.textContent = ref.text;
      note.addEventListener('input', () => this.commit(index, note));
      note.addEventListener('keydown', this.onNoteKeyDown);

      item.append(mark, note);
      this.list.appendChild(item);
    });
  }

  private patch(refs: readonly FootnoteRef[]): void {
    refs.forEach((ref, index) => {
      const note = this.list.children[index]?.querySelector('.nb-footnote-note');
      if (!(note instanceof HTMLElement)) return;
      if (note === document.activeElement) return; // being typed in
      if (note.textContent !== ref.text) note.textContent = ref.text;
    });
  }

  /** Enter and Escape both mean "done" — a note is one line of afterthought. */
  private readonly onNoteKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    const target = event.target;
    if (target instanceof HTMLElement) target.blur();
    const index = this.entryIndex(target);
    this.view.focus();
    const pos = this.positions[index];
    if (pos !== undefined && pos + 1 <= this.view.state.doc.content.size) {
      const tr = this.view.state.tr.setSelection(
        TextSelection.near(this.view.state.doc.resolve(pos + 1)),
      );
      this.view.dispatch(tr);
    }
  };

  private entryIndex(target: EventTarget | null): number {
    if (!(target instanceof HTMLElement)) return -1;
    const entry = target.closest('.nb-footnote-entry');
    if (entry === null) return -1;
    return Array.prototype.indexOf.call(this.list.children, entry);
  }

  /** Write what was typed back into the marker it belongs to. */
  private commit(index: number, note: HTMLElement): void {
    const pos = this.positions[index];
    if (pos === undefined) return;
    const text = note.textContent ?? '';
    const state = this.view.state;
    const node = state.doc.nodeAt(pos);
    if (node === null || node.type.name !== 'footnote') return;
    if (node.attrs.text === text) return;
    // The rail owns the DOM it is typing in, so this must NOT go back through
    // the patch path on the way home — `notes` is updated first, and `patch`
    // skips the focused entry anyway.
    this.view.dispatch(
      state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, text }),
    );
  }

  /**
   * Publish the rail's height so the prose can reserve it.
   *
   * `offsetHeight` is a forced layout, so it happens only when the rail was
   * actually rebuilt or patched (or rewrapped) — never on a transaction that
   * left the notes alone, which is nearly all of them.
   */
  private measure(): void {
    if (this.host === null) return;
    const height = this.list.hidden ? 0 : this.list.offsetHeight;
    this.host.style.setProperty(
      '--nb-footnote-rail',
      height > 0 ? `${Math.ceil(height) + 10}px` : '0px',
    );
  }
}

function footnoteRailPlugin(): Plugin {
  return new Plugin({
    key: footnoteKey,
    props: {
      decorations: (state) => numberingDecorations(state),
    },
    view: (view) => new FootnoteRail(view),
  });
}
