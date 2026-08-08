/**
 * `[[` — the page picker.
 *
 * @tiptap/suggestion wired to a Solid card in a body portal, exactly like the
 * slash menu (src/editor/slash/extension.ts) and for the same reason: the menu
 * must not live in ProseMirror's DOM, or every keystroke re-parents it.
 *
 * WHY `[[` AND NOT A SLASH COMMAND. A page reference is written INSIDE a
 * sentence — "see [[Photosynthesis]] for the numbers" — and the slash menu is
 * for turning the line you are on into a different kind of block. Both exist:
 * the slash entry "Link to a page" types the two brackets for the reader who
 * does not know the shorthand yet, and then this is what answers.
 *
 * `allowSpaces` is on, because page names have spaces in them and a picker
 * that stops matching at the first one can only ever find single-word pages.
 * The cost is that the query runs to the end of the line until something is
 * picked or Escape is pressed — which is how every wiki-link picker behaves,
 * and is why Escape is handled first in `onKeyDown`.
 *
 * THE TARGET LIST IS ASYNC and comes from the search index, never from a
 * second store of pages: src/search/backlinks.ts builds one link graph for the
 * whole library and caches it, so a keystroke here is a map lookup and a sort.
 */
import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, {
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from '@tiptap/suggestion';
import { computePosition, flip, offset, shift } from '@floating-ui/dom';
import { createComponent } from 'solid-js';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { bumpLinkGraph, loadLinkTargets, type PageCard } from '../../search/backlinks';
import { pageIdOfEditor } from '../instances';
import PageLinkMenu from './PageLinkMenu';

const pageLinkPluginKey = new PluginKey('nb-page-links');

/** How many pages the card offers at once (it is a card, not a directory). */
const MAX_TARGETS = 7;

interface MenuState {
  items: readonly PageCard[];
  selected: number;
  loading: boolean;
}

/**
 * Put the chosen page in the document.
 *
 * A trailing space is part of the insertion on purpose: the caret has to land
 * OUTSIDE the atom or the next thing typed disappears into a node that holds
 * no text, and a reader who has just written a reference mid-sentence is
 * about to keep writing that sentence.
 */
export function insertPageLinkAt(
  editor: Editor,
  range: Range,
  card: PageCard,
): boolean {
  const done = editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent([
      {
        type: 'pageLink',
        attrs: {
          pageId: card.pageId,
          bookId: card.bookId,
          label: card.title,
        },
      },
      { type: 'text', text: ' ' },
    ])
    .run();
  // The graph the picker just read from is now one edge out of date, and the
  // backlinks tab on the OTHER page is looking at the same cache.
  if (done) bumpLinkGraph();
  return done;
}

function createPageLinkRenderer(): ReturnType<
  NonNullable<Parameters<typeof Suggestion<PageCard, PageCard>>[0]['render']>
> {
  let host: HTMLDivElement | null = null;
  let disposeRoot: (() => void) | null = null;
  let dismissed = false;
  let boundEditor: Editor | null = null;

  const [state, setState] = createStore<MenuState>({
    items: [],
    selected: 0,
    loading: true,
  });
  let executeSelected: (card: PageCard) => void = () => undefined;

  const reposition = (
    clientRect: (() => DOMRect | null) | null | undefined,
  ): void => {
    const element = host;
    const rect = clientRect?.();
    if (!element || !rect) return;
    void computePosition({ getBoundingClientRect: () => rect }, element, {
      placement: 'bottom-start',
      strategy: 'fixed',
      middleware: [offset(8), flip({ padding: 12 }), shift({ padding: 12 })],
    }).then(({ x, y }) => {
      // transform-only positioning — never animate layout properties.
      element.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    });
  };

  const close = (): void => {
    disposeRoot?.();
    disposeRoot = null;
    host?.remove();
    host = null;
    if (boundEditor) {
      boundEditor.off('destroy', close);
      boundEditor = null;
    }
  };

  const moveSelection = (delta: number): void => {
    const count = state.items.length;
    if (count === 0) return;
    setState('selected', (state.selected + delta + count) % count);
  };

  return {
    onBeforeStart: (): void => {
      setState({ items: [], selected: 0, loading: true });
    },

    onStart: (props: SuggestionProps<PageCard, PageCard>): void => {
      dismissed = false;
      executeSelected = (card) => props.command(card);
      setState({ items: props.items, selected: 0, loading: false });

      boundEditor = props.editor;
      boundEditor.on('destroy', close);

      host = document.createElement('div');
      host.className = 'nb-pagepick-portal';
      host.style.position = 'fixed';
      host.style.top = '0';
      host.style.left = '0';
      host.style.zIndex = 'var(--z-menus)';
      document.body.appendChild(host);

      disposeRoot = render(
        () =>
          createComponent(PageLinkMenu, {
            get items() {
              return state.items;
            },
            get selectedIndex() {
              return state.selected;
            },
            get loading() {
              return state.loading;
            },
            onSelect: (item: PageCard) => executeSelected(item),
            onHover: (index: number) => setState('selected', index),
          }),
        host,
      );

      reposition(props.clientRect);
    },

    onBeforeUpdate: (): void => {
      setState('loading', true);
    },

    onUpdate: (props: SuggestionProps<PageCard, PageCard>): void => {
      if (dismissed) return;
      executeSelected = (card) => props.command(card);
      setState({
        items: props.items,
        selected: Math.min(state.selected, Math.max(0, props.items.length - 1)),
        loading: false,
      });
      reposition(props.clientRect);
    },

    onKeyDown: (props: SuggestionKeyDownProps): boolean => {
      if (dismissed) return false;
      const { event } = props;
      if (event.key === 'Escape') {
        dismissed = true;
        close();
        return true;
      }
      if (event.key === 'ArrowDown') {
        moveSelection(1);
        return true;
      }
      if (event.key === 'ArrowUp') {
        moveSelection(-1);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = state.items[state.selected];
        if (item) {
          executeSelected(item);
          return true;
        }
        // Nothing to pick: let the key do its ordinary job rather than
        // swallowing the reader's Enter into a menu that cannot answer.
        return false;
      }
      return false;
    },

    onExit: (): void => {
      close();
      dismissed = false;
    },
  };
}

export const PageLinkSuggestions = Extension.create({
  name: 'pageLinkSuggestions',

  addProseMirrorPlugins() {
    return [
      Suggestion<PageCard, PageCard>({
        pluginKey: pageLinkPluginKey,
        editor: this.editor,
        char: '[[',
        allowSpaces: true,
        allowedPrefixes: null,
        startOfLine: false,
        items: ({ query, editor }: { query: string; editor: Editor }) =>
          loadLinkTargets({
            query,
            fromPageId: pageIdOfEditor(editor) ?? undefined,
            limit: MAX_TARGETS,
          }),
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: Range;
          props: PageCard;
        }) => {
          insertPageLinkAt(editor, range, props);
        },
        render: createPageLinkRenderer,
      }),
    ];
  },
});
