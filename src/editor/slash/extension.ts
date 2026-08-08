/**
 * Slash-command extension — @tiptap/suggestion wired to a Solid-rendered
 * menu in a body portal, positioned with @floating-ui/dom
 * (computePosition + flip + shift), keyboard nav swallowing arrows/enter.
 */
import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, {
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from '@tiptap/suggestion';
import { computePosition, flip, offset, shift } from '@floating-ui/dom';
import { createStore } from 'solid-js/store';
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import SlashMenu from './SlashMenu';
import { filterSlashCommands, type SlashCommand } from './registry';

const slashPluginKey = new PluginKey('nb-slash-commands');

interface MenuState {
  items: readonly SlashCommand[];
  selected: number;
}

/** Width of the editable region containing the slash, not the whole leaf. */
function availableWidth(editor: Editor): number | null {
  try {
    const dom = editor.view.domAtPos(editor.state.selection.from).node;
    const element = dom instanceof Element ? dom : dom.parentElement;
    const region = element?.closest<HTMLElement>(
      '[data-type="col"], .nb-prose',
    );
    if (region === null || region === undefined) return null;
    return Math.max(84, Math.floor(region.getBoundingClientRect().width));
  } catch {
    return null;
  }
}

function sizeForEditor(host: HTMLElement, editor: Editor): void {
  const width = availableWidth(editor);
  if (width === null) return;
  host.style.setProperty('--nb-slash-available-width', `${width}px`);
  host.classList.toggle('is-narrow', width < 220);
  host.classList.toggle('is-very-narrow', width < 150);
}

function createSlashRenderer(): ReturnType<
  NonNullable<Parameters<typeof Suggestion<SlashCommand, SlashCommand>>[0]['render']>
> {
  let host: HTMLDivElement | null = null;
  let disposeRoot: (() => void) | null = null;
  let dismissed = false;
  let boundEditor: Editor | null = null;

  const [state, setState] = createStore<MenuState>({ items: [], selected: 0 });
  let executeSelected: (command: SlashCommand) => void = () => undefined;

  const reposition = (
    clientRect: (() => DOMRect | null) | null | undefined,
  ): void => {
    const element = host;
    const rect = clientRect?.();
    if (!element || !rect) return;
    const reference = {
      getBoundingClientRect: () => rect,
    };
    void computePosition(reference, element, {
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
    onStart: (props: SuggestionProps<SlashCommand, SlashCommand>): void => {
      dismissed = false;
      executeSelected = (command) => props.command(command);
      setState({ items: props.items, selected: 0 });

      // Belt-and-braces: never leave an orphan portal if the editor is
      // destroyed (e.g. HMR remount) while the menu is open.
      boundEditor = props.editor;
      boundEditor.on('destroy', close);

      host = document.createElement('div');
      host.className = 'nb-slash-portal';
      host.style.position = 'fixed';
      host.style.top = '0';
      host.style.left = '0';
      host.style.zIndex = 'var(--z-menus)';
      sizeForEditor(host, props.editor);
      document.body.appendChild(host);

      disposeRoot = render(
        () =>
          createComponent(SlashMenu, {
            get items() {
              return state.items as SlashCommand[];
            },
            get selectedIndex() {
              return state.selected;
            },
            onSelect: (item: SlashCommand) => executeSelected(item),
            onHover: (index: number) => setState('selected', index),
          }),
        host,
      );

      reposition(props.clientRect);
    },

    onUpdate: (props: SuggestionProps<SlashCommand, SlashCommand>): void => {
      if (dismissed) return;
      executeSelected = (command) => props.command(command);
      setState({
        items: props.items,
        selected: Math.min(state.selected, Math.max(0, props.items.length - 1)),
      });
      if (host !== null) sizeForEditor(host, props.editor);
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

export const SlashCommands = Extension.create({
  name: 'slashCommands',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashCommand, SlashCommand>({
        pluginKey: slashPluginKey,
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }: { query: string }) => filterSlashCommands(query),
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: Range;
          props: SlashCommand;
        }) => {
          props.run({ editor, range });
        },
        render: createSlashRenderer,
      }),
    ];
  },
});
