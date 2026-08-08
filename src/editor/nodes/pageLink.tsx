/**
 * pageLink — an inline atom pointing at another page in the library.
 *
 * Attrs: `{ pageId, bookId, label }`. Inserted by the `[[` picker
 * (src/editor/links/), listed from the other end by the backlinks tab
 * (src/editor/backlinks/), and read back out of the search index by
 * src/search/extract.ts, which is what makes the other end findable at all.
 *
 * WHY IT IS AN ATOM AND NOT A LINK MARK. A mark spans text the reader owns:
 * they can type inside it, split it, half-delete it, and every one of those
 * leaves a link whose words no longer say where it goes. A page reference is
 * one indivisible thing — you either point at that page or you do not — so it
 * is a node with no editable content, and backspace removes the whole
 * reference rather than eroding it a letter at a time. (`link`, the mark, is
 * still the right shape for a WEB address, which decorates words the reader
 * really did write. Both exist; they are not the same gesture.)
 *
 * WHAT IT DRAWS, AND WHY THAT IS NOT WHAT IT STORES. `label` is a snapshot,
 * taken when the link was made. The chip shows the target's CURRENT derived
 * name when the index can supply one, and falls back to the snapshot when it
 * cannot — so renaming a page's heading renames every reference to it without
 * a single document being rewritten behind the reader's back. A background
 * pass that "fixed up" labels would be a write storm nobody asked for, and it
 * would fight the undo history for ownership of text the reader never typed.
 *
 * A target that has been deleted draws struck through and stops navigating.
 * The reference stays in the document — restoring the page from a backup
 * brings the link back to life on the next sweep, and silently deleting the
 * reader's words because a row went missing is not a repair.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import { createEffect, createSignal, onCleanup, type JSX } from 'solid-js';
import { loadPageCard, linkGraphVersion, type PageCard } from '../../search/backlinks';
import { requestSearchJump } from '../../search/jump';
import { play } from '../../sound/engine';
import {
  NodeViewWrapper,
  SolidNodeViewRenderer,
  type SolidNodeViewProps,
} from '../solid';

export interface PageLinkAttributes {
  /** Target page id. The only attribute that matters; the rest are comfort. */
  pageId: string;
  /** Target book id, so a jump can open the right book without a lookup. */
  bookId: string;
  /** The name the page had when the link was made (see the file header). */
  label: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageLink: {
      /** Insert a reference to another page at the caret. */
      insertPageLink: (attrs: PageLinkAttributes) => ReturnType;
    };
  }
}

function attrString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Two bowed sheets — the mark that says "this points at a page". */
function PageMark(): JSX.Element {
  return (
    <svg class="nb-pagelink-mark" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6.4 4.6 C 9.4 4.1 12.4 4.1 15.4 4.6 C 15.9 8.9 15.9 13.2 15.4 17.5 C 12.4 18 9.4 18 6.4 17.5 C 5.9 13.2 5.9 8.9 6.4 4.6 Z"
        fill="var(--paper-cream)"
        stroke="var(--ink-sepia)"
        stroke-width="1.6"
        stroke-linejoin="round"
      />
      <path
        d="M9.1 8.4 C 10.6 8.2 12.1 8.2 13.6 8.4 M9.1 11.6 C 10.4 11.4 11.7 11.4 13 11.6"
        fill="none"
        stroke="var(--ink-sepia-soft)"
        stroke-width="1.4"
        stroke-linecap="round"
      />
      <path
        d="M17.8 7.2 C 18.9 10.6 19 14.2 18.1 17.7 C 18.1 18.9 17.3 19.7 16.1 19.9 C 14.1 20.2 12.1 20.3 10.1 20.2"
        fill="none"
        stroke="var(--ink-sepia)"
        stroke-width="1.6"
        stroke-linecap="round"
      />
    </svg>
  );
}

function PageLinkView(props: SolidNodeViewProps): JSX.Element {
  const pageId = (): string => attrString(props.node.attrs.pageId);
  const bookId = (): string => attrString(props.node.attrs.bookId);
  const label = (): string => attrString(props.node.attrs.label);

  /** Null while unresolved, the card once the graph has answered. */
  const [card, setCard] = createSignal<PageCard | null>(null);
  const [missing, setMissing] = createSignal(false);

  let alive = true;
  onCleanup(() => {
    alive = false;
  });

  /**
   * Resolve against the link graph — again whenever it moves, so a heading
   * edited on the target page renames the chip on the next save rather than on
   * the next reload.
   */
  const resolve = (): void => {
    const id = pageId();
    if (id === '') return;
    void loadPageCard(id).then((found) => {
      if (!alive) return;
      setCard(found);
      setMissing(found === null);
    });
  };

  // Reading the version signal inside the effect is what subscribes this chip
  // to every later bump (see backlinks.ts) — the resolve itself is async and
  // would otherwise track nothing at all.
  createEffect(() => {
    linkGraphVersion();
    resolve();
  });

  const words = (): string => {
    const resolved = card();
    if (resolved !== null && !resolved.untitled) return resolved.title;
    const stored = label().trim();
    if (stored !== '') return stored;
    return resolved?.title ?? 'a page';
  };

  const where = (): string => {
    const resolved = card();
    if (resolved === null) return missing() ? 'that page is gone' : 'another page';
    return `${resolved.bookTitle} · page ${resolved.ord + 1}`;
  };

  const follow = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (missing()) {
      return;
    }
    const resolved = card();
    const book = resolved?.bookId ?? bookId();
    if (book === '' || pageId() === '') return;
    void play('page-flip');
    requestSearchJump(book, pageId(), []);
  };

  return (
    <NodeViewWrapper
      class="nb-pagelink"
      classList={{ 'is-selected': props.selected, 'is-missing': missing() }}
      data-page-link={pageId()}
      data-tooltip={where()}
      data-tooltip-side="top"
      // mousedown so the chip answers before ProseMirror moves the selection
      // into it; click still fires and is what actually navigates.
      onMouseDown={(event: MouseEvent) => event.preventDefault()}
      onClick={follow}
    >
      <PageMark />
      <span class="nb-pagelink-words">{words()}</span>
    </NodeViewWrapper>
  );
}

export const PageLink = Node.create({
  name: 'pageLink',

  inline: true,

  group: 'inline',

  atom: true,

  selectable: true,

  addAttributes() {
    return {
      pageId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-page-id') ?? '',
        renderHTML: (attributes) => ({
          'data-page-id': attrString(attributes.pageId),
        }),
      },
      bookId: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-book-id') ?? '',
        renderHTML: (attributes) => ({
          'data-book-id': attrString(attributes.bookId),
        }),
      },
      label: {
        default: '',
        parseHTML: (element) =>
          element.getAttribute('data-label') ?? element.textContent ?? '',
        renderHTML: (attributes) => ({
          'data-label': attrString(attributes.label),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="page-link"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    // The label rides in the element's text as well as its attribute: an
    // export, a clipboard paste into another app, or the html-to-image page
    // snapshot all read the text, and a chip that says nothing in any of them
    // would be a hole in the sentence.
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'page-link',
        class: 'nb-pagelink',
      }),
      attrString(node.attrs.label) || 'a page',
    ];
  },

  addCommands() {
    return {
      insertPageLink:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return SolidNodeViewRenderer(PageLinkView);
  },
});
