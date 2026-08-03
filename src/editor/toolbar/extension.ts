/**
 * Selection toolbar — the six inline marks, on a card that follows the
 * selection.
 *
 * IT IS A PLUGIN VIEW, NOT A NODE VIEW, AND THAT IS THE WHOLE DESIGN.
 *
 * A node view owns a piece of ProseMirror's document DOM: PM decides when to
 * build it, when to tear it down, and re-renders it whenever the node changes.
 * A floating toolbar keyed to a SELECTION has none of those lifetimes — the
 * selection crosses nodes, survives edits, and exists when no node is selected
 * at all. Hanging one off a node means PM and the toolbar both believe they
 * own the same element, and the toolbar loses that argument on every keystroke
 * (blown-away caret, lost focus, a card that re-mounts mid-drag).
 *
 * So the card lives on `document.body`, is positioned from the selection's
 * client rect, and touches ProseMirror only through transactions. The prose
 * DOM is untouched — which is also what keeps the toolbar out of the page-flip
 * snapshots (src/flip) and out of the pagination drain's `root.children` count
 * (src/editor/pagination.ts), the same reason the footnote rail and the drag
 * handle layer live outside the prose.
 *
 * VISIBILITY is deliberately narrow: an editable editor, a non-empty text
 * selection, focus in the editor or in the toolbar's own link field, no
 * in-flight pointer drag, no IME composition, and not inside a code block
 * (where five of the six marks would be a lie).
 */
import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { computePosition, flip, offset, shift } from '@floating-ui/dom';
import { createComponent } from 'solid-js';
import { createStore, type SetStoreFunction } from 'solid-js/store';
import { render } from 'solid-js/web';
import { play } from '../../sound/engine';
import SelectionToolbar from './SelectionToolbar';
import {
  NO_ACTIVE_MARKS,
  applySelectionHighlight,
  applySelectionLink,
  clearSelectionHighlight,
  clearSelectionLink,
  readActiveMarks,
  selectionHighlightStyle,
  selectionHref,
  selectionWash,
  toggleSelectionMark,
  type HighlightStyle,
  type HighlightWash,
  type SelectionAction,
  type SelectionActiveMap,
  type SelectionTray,
} from './actions';

const selectionToolbarKey = new PluginKey('nb-selection-toolbar');

interface ToolbarState {
  active: SelectionActiveMap;
  tray: SelectionTray | null;
  wash: HighlightWash;
  hlStyle: HighlightStyle;
  href: string;
  hasLink: boolean;
  linkError: boolean;
}

/**
 * True when the caret sits inside a node that renders its own literal text —
 * a code block. Bold inside one is not bold, it is three characters of noise
 * in a snippet the reader will paste somewhere that matters.
 */
function inLiteralBlock(view: EditorView): boolean {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (name === 'codeBlock' || name === 'math' || name === 'mathInline') return true;
  }
  return false;
}

/** The selection's box in viewport coordinates, or null when unmeasurable. */
function selectionRect(view: EditorView): DOMRect | null {
  const { from, to } = view.state.selection;
  try {
    const start = view.coordsAtPos(from, 1);
    const end = view.coordsAtPos(to, -1);
    const left = Math.min(start.left, end.left);
    const right = Math.max(start.right, end.right);
    const top = Math.min(start.top, end.top);
    const bottom = Math.max(start.bottom, end.bottom);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
    return new DOMRect(left, top, Math.max(1, right - left), Math.max(1, bottom - top));
  } catch {
    // coordsAtPos throws while the view is being torn down or re-parsed.
    return null;
  }
}

class SelectionToolbarView {
  private readonly host: HTMLDivElement;

  private readonly dispose: () => void;

  private readonly state: ToolbarState;

  private readonly setState: SetStoreFunction<ToolbarState>;

  /** Suppressed between pointerdown and pointerup (a selection being dragged). */
  private dragging = false;

  private up = false;

  /** The selection the card is currently anchored to, so a move can close a tray. */
  private anchor = '';

  private destroyed = false;

  constructor(
    private readonly view: EditorView,
    private readonly editor: Editor,
  ) {
    const [state, setState] = createStore<ToolbarState>({
      active: { ...NO_ACTIVE_MARKS },
      tray: null,
      wash: 'amber',
      hlStyle: 'marker',
      href: '',
      hasLink: false,
      linkError: false,
    });
    this.state = state;
    this.setState = setState;

    this.host = document.createElement('div');
    this.host.className = 'nb-seltool-portal';
    this.host.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.host);

    this.dispose = render(
      () =>
        createComponent(SelectionToolbar, {
          get active() {
            return state.active;
          },
          get tray() {
            return state.tray;
          },
          get wash() {
            return state.wash;
          },
          get hlStyle() {
            return state.hlStyle;
          },
          get href() {
            return state.href;
          },
          get hasLink() {
            return state.hasLink;
          },
          get linkError() {
            return state.linkError;
          },
          onPress: this.onPress,
          onWash: this.onWash,
          onHighlightStyle: this.onHighlightStyle,
          onClearHighlight: this.onClearHighlight,
          onHrefInput: this.onHrefInput,
          onApplyLink: this.onApplyLink,
          onRemoveLink: this.onRemoveLink,
          onDismiss: this.onDismiss,
        }),
      this.host,
    );

    this.view.dom.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp, true);
    window.addEventListener('scroll', this.onViewportChange, true);
    window.addEventListener('resize', this.onViewportChange);
    this.sync();
  }

  update(): void {
    this.sync();
  }

  destroy(): void {
    this.destroyed = true;
    this.view.dom.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp, true);
    window.removeEventListener('scroll', this.onViewportChange, true);
    window.removeEventListener('resize', this.onViewportChange);
    this.dispose();
    this.host.remove();
  }

  /** Escape closes the tray first, then the card — PageEditor routes it here. */
  handleEscape(): boolean {
    if (!this.up) return false;
    if (this.state.tray !== null) {
      this.setState({ tray: null, linkError: false });
      this.view.focus();
      return true;
    }
    return false;
  }

  /** Ctrl-K: open the link tray on whatever is selected. */
  openLinkTray(): boolean {
    if (!this.up) return false;
    this.setTray('link');
    return true;
  }

  // -- events ---------------------------------------------------------------

  private readonly onPointerDown = (): void => {
    this.dragging = true;
    this.hide();
  };

  private readonly onPointerUp = (): void => {
    if (!this.dragging) return;
    this.dragging = false;
    // The selection is settled by the time the browser has dispatched this;
    // one frame later ProseMirror has read it back into its own state.
    requestAnimationFrame(() => {
      if (!this.destroyed) this.sync();
    });
  };

  private readonly onViewportChange = (): void => {
    if (this.up) this.place();
  };

  private readonly onPress = (action: SelectionAction): void => {
    if (action.tray !== null) {
      this.setTray(this.state.tray === action.tray ? null : action.tray);
      return;
    }
    toggleSelectionMark(this.editor, action.id);
    void play('pop-soft');
  };

  private readonly onWash = (wash: HighlightWash): void => {
    applySelectionHighlight(this.editor, wash, this.state.hlStyle);
    void play('pop-soft');
  };

  private readonly onHighlightStyle = (style: HighlightStyle): void => {
    // A style with no wash under it would be a squiggle in no colour, so the
    // press means "highlight it this way" — wash included.
    applySelectionHighlight(this.editor, this.state.wash, style);
    void play('pop-soft');
  };

  private readonly onClearHighlight = (): void => {
    clearSelectionHighlight(this.editor);
  };

  private readonly onHrefInput = (value: string): void => {
    this.setState({ href: value, linkError: false });
  };

  private readonly onApplyLink = (): void => {
    if (applySelectionLink(this.editor, this.state.href)) {
      this.setState({ tray: null, linkError: false });
      void play('pop-soft');
    } else {
      this.setState('linkError', true);
    }
  };

  private readonly onRemoveLink = (): void => {
    clearSelectionLink(this.editor);
    this.setState({ tray: null, href: '', hasLink: false, linkError: false });
  };

  private readonly onDismiss = (): void => {
    this.setState({ tray: null, linkError: false });
    this.view.focus();
  };

  // -- state ----------------------------------------------------------------

  private setTray(tray: SelectionTray | null): void {
    if (tray === 'link') {
      const href = selectionHref(this.editor);
      this.setState({ tray, href, hasLink: href !== '', linkError: false });
    } else {
      this.setState({ tray, linkError: false });
    }
    if (tray !== null) void play('pop-soft');
    // A tray makes the card taller; re-anchor so it does not grow off-screen.
    requestAnimationFrame(() => {
      if (!this.destroyed && this.up) this.place();
    });
  }

  private shouldShow(): boolean {
    if (this.destroyed || this.dragging) return false;
    const view = this.view;
    if (!view.editable || view.composing) return false;
    const selection = view.state.selection;
    if (!(selection instanceof TextSelection) || selection.empty) return false;
    if (inLiteralBlock(view)) return false;
    // A tray the reader deliberately opened outlives a focus wobble. Opening
    // one is a statement about the selection under it, and that selection is
    // still there — tearing the tray down because the caret left the prose for
    // a beat is how a link field closes under the hand reaching for it.
    if (this.state.tray !== null) return true;
    // Otherwise focus decides, and it may legitimately sit in the toolbar.
    const inToolbar =
      document.activeElement !== null && this.host.contains(document.activeElement);
    if (!view.hasFocus() && !inToolbar) return false;
    return true;
  }

  private sync(): void {
    if (!this.shouldShow()) {
      this.hide();
      return;
    }
    const { from, to } = this.view.state.selection;
    const anchor = `${from}:${to}`;
    if (anchor !== this.anchor) {
      // A new selection is a new subject; whatever tray was open was about the
      // old one.
      this.anchor = anchor;
      if (this.state.tray !== null) this.setState({ tray: null, linkError: false });
    }
    this.setState({
      active: readActiveMarks(this.editor),
      wash: selectionWash(this.editor),
      hlStyle: selectionHighlightStyle(this.editor),
      hasLink: this.editor.isActive('link'),
    });
    this.show();
    this.place();
  }

  private show(): void {
    if (this.up) return;
    this.up = true;
    this.host.classList.add('is-up');
    this.host.setAttribute('aria-hidden', 'false');
  }

  private hide(): void {
    if (!this.up) return;
    this.up = false;
    this.anchor = '';
    this.host.classList.remove('is-up');
    this.host.setAttribute('aria-hidden', 'true');
    if (this.state.tray !== null) this.setState({ tray: null, linkError: false });
  }

  private place(): void {
    const rect = selectionRect(this.view);
    const card = this.host.firstElementChild;
    if (rect === null || !(card instanceof HTMLElement)) return;
    void computePosition({ getBoundingClientRect: () => rect }, card, {
      placement: 'top',
      strategy: 'fixed',
      middleware: [offset(10), flip({ padding: 12 }), shift({ padding: 12 })],
    }).then(({ x, y }) => {
      if (this.destroyed || !this.up) return;
      // Transform-only positioning — never animate layout properties.
      card.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    });
  }
}

/** Live toolbar views, so the keymap can reach the one that is showing. */
const liveViews = new WeakMap<EditorView, SelectionToolbarView>();

export const SelectionToolbarExtension = Extension.create({
  name: 'selectionToolbar',

  addKeyboardShortcuts() {
    return {
      'Mod-k': () => liveViews.get(this.editor.view)?.openLinkTray() ?? false,
      Escape: () => liveViews.get(this.editor.view)?.handleEscape() ?? false,
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: selectionToolbarKey,
        view: (view) => {
          const instance = new SelectionToolbarView(view, editor);
          liveViews.set(view, instance);
          return {
            update: () => instance.update(),
            destroy: () => {
              liveViews.delete(view);
              instance.destroy();
            },
          };
        },
      }),
    ];
  },
});
