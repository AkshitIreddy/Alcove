/**
 * src/editor/nodes/codeBlock.tsx — a code block that is actually for code.
 *
 * The reader's words: *"our notebook should also support being able to hold
 * code of different langauges with inbuilt indenting, colours for the code and
 * what not needed for displaying programming code, and customising how it
 * looks in settings"*.
 *
 * What was there before was `CodeBlockLowlight.configure({ lowlight })` and
 * twenty lines of token colours in `editor.css`. That is not nothing — it
 * highlighted — but it had no way to say WHICH language, no indentation at
 * all (Tab moved focus out of the page), no way to change how it looked, and
 * everything it held was flattened into paragraphs the moment the page went
 * through Notebook Script.
 *
 * This extends the same extension rather than replacing it, so the storage
 * schema is untouched: `codeBlock` with a `language` attribute, exactly the
 * node every existing page already contains.
 *
 * ## What is added, and why each piece is here
 *
 *   - a LANGUAGE PICKER on the block — an aged-paper card in the app's own
 *     hand, in the slash menu's register. See `LanguagePicker` below for what
 *     it replaced and why.
 *   - INDENTATION that behaves — see `../codeIndent.ts` for the arithmetic
 *     and `escapeHatch` below for the part that matters most.
 *   - LANGUAGE DETECTION on paste, both from what the clipboard declares and
 *     from what the text looks like (`../codeHighlight.ts`).
 *   - LINE NUMBERS, as widget decorations, gated on the reader's setting.
 *
 * ## Tab, and not stealing it
 *
 * Tab inside a code block has to insert an indent, and Tab is also the only
 * way somebody navigating by keyboard gets OUT of a block and on to the next
 * control. Both are true at once and the usual answer — "trap Tab, it's a
 * code editor" — is the one that leaves a reader stuck inside a block with no
 * way forward. So this uses the escape hatch every serious editor has settled
 * on: Escape releases Tab for one press. Press Escape, press Tab, and focus
 * leaves normally; carry on typing and Tab indents again. The block says so
 * in its own footer, because an accessibility affordance nobody is told about
 * is not one.
 */

import {
  CodeBlockLowlight,
  type CodeBlockLowlightOptions,
} from '@tiptap/extension-code-block-lowlight';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { findChildren } from '@tiptap/core';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type JSX,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom';

import {
  NodeViewContent,
  NodeViewWrapper,
  SolidNodeViewRenderer,
  type SolidNodeViewProps,
} from '../solid';
import {
  CODE_LANGUAGE_CHOICES,
  filterCodeLanguages,
  indentUnit,
  languageLabel,
  resolveLanguage,
  type CodeLanguageChoice,
} from '../codeLanguages';
import { createHoverIntent } from '../menu/hoverIntent';
import {
  autoIndent,
  backspaceIndent,
  indentRange,
  outdentRange,
  toggleComment,
  type CodeEdit,
} from '../codeIndent';
import {
  clipboardLanguage,
  detectLanguage,
  fencedPaste,
  lowlight,
} from '../codeHighlight';
import {
  codeLook,
  subscribeCodeLook,
} from '../../features/settings/codeAppearancePrefs';

/* ============================== the escape hatch ========================== */

/**
 * Editors whose next Tab should move focus instead of indenting.
 *
 * A WeakSet keyed on the editor rather than a module flag: two pages are open
 * at once in a spread, and releasing Tab on the left one must not release it
 * on the right. It is cleared by the next keystroke that is not Tab, so the
 * release lasts exactly as long as the reader's intent to leave.
 */
const released = new WeakSet<object>();

/** Mark this editor's next Tab as "let it through". */
function release(editor: object): void {
  released.add(editor);
}

/** Consume the release, if there is one. */
function takeRelease(editor: object): boolean {
  if (!released.has(editor)) return false;
  released.delete(editor);
  return true;
}

/* ============================== line numbers ============================= */

const lineNumberKey = new PluginKey<DecorationSet>('nbCodeLineNumbers');

/**
 * A number for every logical line, hanging in the block's left padding.
 *
 * ## Why these are INLINE decorations and not widgets
 *
 * A widget is the obvious tool — "put a thing at this position" — and it is
 * the wrong one here, in a way that took driving the real app to find. A
 * widget at a line start sits in the contentDOM as an extra child of `<code>`,
 * and the highlighter is re-wrapping the text around it on almost every
 * keystroke: type `def` in a Python block and lowlight replaces the plain text
 * node with `<span class="hljs-keyword">`. With a widget in front of it,
 * ProseMirror read the resulting DOM selection back as an element-level
 * position and mapped it to the START of the block, so the fourth character
 * you typed went in front of the first three. `def totals(x):` came out as
 * ` totals(x):def`. It reproduced at human typing speed, with and without the
 * node view, with and without a key, with and without `ignoreSelection`.
 *
 * An INLINE decoration has none of that exposure: it is the same mechanism
 * lowlight itself uses, it wraps existing text rather than adding a child, and
 * the two nest cleanly. So the number is drawn by `::before` on a span around
 * the line's FIRST CHARACTER.
 *
 * ## The hanging, and why the gutter is not a column
 *
 * `::before` is an inline-block of width N with a margin-left of -N, so it
 * advances the line by zero and sits inside the padding the code already
 * reserves. Numbered and unnumbered code therefore start at the same column,
 * and — the thing a separate gutter column cannot do — a line that WRAPS
 * continues under the code rather than under the numbers.
 *
 * An empty line has no first character to wrap and so gets no number. That is
 * the one thing this approach cannot do, and it is a much smaller price than
 * a caret that jumps.
 */
function lineNumberDecorations(doc: ProseMirrorNode, name: string): DecorationSet {
  const decorations: Decoration[] = [];
  findChildren(doc, (node) => node.type.name === name).forEach((block) => {
    const text = block.node.textContent;
    const start = block.pos + 1;
    let offset = 0;
    let line = 1;
    for (;;) {
      const nl = text.indexOf('\n', offset);
      const end = nl === -1 ? text.length : nl;
      if (end > offset) {
        decorations.push(
          Decoration.inline(start + offset, start + offset + 1, {
            nodeName: 'span',
            class: 'nb-code-num',
            // An ATTRIBUTE, drawn by `content: attr(data-line)`. Not a text
            // node: `search/jump.ts` walks text nodes looking for a hit to
            // pulse, and would have pulsed the number 12 when the reader
            // searched for "12". Generated content is in no text walk, no
            // selection and no copy.
            'data-line': String(line),
          }),
        );
      }
      if (nl === -1) break;
      offset = nl + 1;
      line += 1;
    }
  });
  return DecorationSet.create(doc, decorations);
}

/* ================================ the node =============================== */

/** Text content and caret offsets of the code block the selection is in. */
interface CodeContext {
  readonly text: string;
  /** Doc position of the first character. */
  readonly start: number;
  /** Selection head/anchor as offsets into `text`. */
  readonly from: number;
  readonly to: number;
  readonly language: string | null;
}

function codeContext(state: EditorState, typeName: string): CodeContext | null {
  const { $from, from, to } = state.selection;
  if ($from.parent.type.name !== typeName) return null;
  const start = $from.start();
  return {
    text: $from.parent.textContent,
    start,
    from: from - start,
    to: Math.max(from, to) - start,
    language:
      typeof $from.parent.attrs.language === 'string'
        ? ($from.parent.attrs.language as string)
        : null,
  };
}

/** Turn a `CodeEdit` (string offsets) into a dispatched transaction. */
function applyEdit(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  context: CodeContext,
  edit: CodeEdit,
): boolean {
  if (dispatch === undefined) return true;
  const { start } = context;
  const tr = state.tr;
  const from = start + edit.from;
  const to = start + edit.to;
  if (edit.text === '') tr.delete(from, to);
  else tr.replaceWith(from, to, state.schema.text(edit.text));
  const head = tr.doc.resolve(start + edit.caret);
  tr.setSelection(
    edit.anchor === undefined
      ? TextSelection.near(head)
      : TextSelection.between(tr.doc.resolve(start + edit.anchor), head),
  );
  dispatch(tr.scrollIntoView());
  return true;
}

export const NotebookCodeBlock = CodeBlockLowlight.extend({
  addOptions(): CodeBlockLowlightOptions {
    return {
      ...(this.parent?.() as CodeBlockLowlightOptions),
      lowlight,
      defaultLanguage: null,
      // Tab is handled here, with the escape hatch. The parent's own
      // implementation traps it unconditionally and would win nothing but a
      // reader who cannot leave the block.
      enableTabIndentation: false,
    };
  },

  addKeyboardShortcuts() {
    const parent = this.parent?.() ?? {};
    const typeName = this.name;

    /** Every shortcut that edits also cancels a pending Tab release. */
    const editing =
      (handler: () => boolean) =>
      (): boolean => {
        released.delete(this.editor);
        return handler();
      };

    return {
      ...parent,

      /**
       * Escape hands Tab back to the browser for one press.
       *
       * It returns false whether or not the caret is in a code block, so
       * nothing else that listens for Escape (the slash menu, a dialog, the
       * selection toolbar) loses it — this only ever ADDS a flag.
       */
      Escape: () => {
        if (codeContext(this.editor.state, typeName) !== null) {
          release(this.editor);
        }
        return parent.Escape?.({ editor: this.editor }) ?? false;
      },

      Tab: () => {
        const context = codeContext(this.editor.state, typeName);
        if (context === null) return false;
        // The reader asked to leave. Let the browser move focus.
        if (takeRelease(this.editor)) return false;
        const { state, view } = this.editor;
        return applyEdit(
          state,
          view.dispatch.bind(view),
          context,
          indentRange(
            context.text,
            context.from,
            context.to,
            indentUnit(context.language),
          ),
        );
      },

      'Shift-Tab': () => {
        const context = codeContext(this.editor.state, typeName);
        if (context === null) return false;
        if (takeRelease(this.editor)) return false;
        const edit = outdentRange(
          context.text,
          context.from,
          context.to,
          indentUnit(context.language),
        );
        // Nothing left to give: swallow it anyway. Letting Shift-Tab through
        // from a line that is already at column zero would move focus
        // BACKWARDS out of the page mid-edit, which reads as a glitch.
        if (edit === null) return true;
        const { state, view } = this.editor;
        return applyEdit(state, view.dispatch.bind(view), context, edit);
      },

      Enter: editing(() => {
        // The parent handles the triple-Enter exit and returns false when it
        // does not apply, so it goes first and auto-indent picks up the rest.
        if (parent.Enter?.({ editor: this.editor }) === true) return true;
        const context = codeContext(this.editor.state, typeName);
        if (context === null || context.from !== context.to) return false;
        const spec = resolveLanguage(context.language);
        const edit = autoIndent(context.text, context.from, {
          unit: indentUnit(context.language),
          offside: spec.offside,
          wordBlocks: spec.wordBlocks,
        });
        if (edit === null) return false;
        const { state, view } = this.editor;
        return applyEdit(state, view.dispatch.bind(view), context, edit);
      }),

      Backspace: editing(() => {
        const context = codeContext(this.editor.state, typeName);
        if (context !== null && context.from === context.to) {
          const eat = backspaceIndent(
            context.text,
            context.from,
            indentUnit(context.language),
          );
          if (eat > 0) {
            const { state, view } = this.editor;
            return applyEdit(state, view.dispatch.bind(view), context, {
              from: context.from - eat,
              to: context.from,
              text: '',
              caret: context.from - eat,
            });
          }
        }
        // The parent's Backspace lifts an empty block out of the document.
        return parent.Backspace?.({ editor: this.editor }) ?? false;
      }),

      /** Comment or uncomment the lines the selection touches. */
      'Mod-/': editing(() => {
        const context = codeContext(this.editor.state, typeName);
        if (context === null) return false;
        const edit = toggleComment(
          context.text,
          context.from,
          context.to,
          resolveLanguage(context.language).comment,
        );
        if (edit === null) return true;
        const { state, view } = this.editor;
        return applyEdit(state, view.dispatch.bind(view), context, edit);
      }),
    };
  },

  addProseMirrorPlugins() {
    const typeName = this.name;
    const type = this.type;

    return [
      ...(this.parent?.() ?? []),

      /* ------------------------- language on paste ----------------------- */
      new Plugin({
        key: new PluginKey('nbCodePaste'),
        props: {
          handlePaste: (view, event) => {
            const data = event.clipboardData;
            if (data === null) return false;
            const text = data.getData('text/plain');
            if (text === '') return false;
            const { $from } = view.state.selection;
            const inside = $from.parent.type.name === typeName;

            if (inside) {
              /*
               * Inside a block: keep the paste, but LABEL it.
               *
               * The text goes in through the normal path (returning false),
               * and the language is set only when the block does not already
               * carry one — a reader who chose Rust and pastes a JSON blob
               * into it has made a choice, and this is not the place to
               * overrule it.
               */
              if (
                typeof $from.parent.attrs.language === 'string' &&
                $from.parent.attrs.language !== ''
              ) {
                return false;
              }
              const detected =
                clipboardLanguage(data) ?? detectLanguage(text);
              if (detected === null) return false;
              const pos = $from.before();
              const tr = view.state.tr.setNodeAttribute(
                pos,
                'language',
                detected,
              );
              view.dispatch(tr);
              return false;
            }

            /*
             * Outside a block: a complete Markdown fence becomes one.
             *
             * This is the single most common way code arrives — copied out of
             * a chat window or an AI answer, backticks and all — and pasting
             * it used to produce three paragraphs, two of which were rows of
             * backticks.
             */
            const fenced = fencedPaste(text);
            if (fenced === null) return false;
            const language = fenced.language ?? fenced.rawLanguage;
            const { tr, schema } = view.state;
            tr.replaceSelectionWith(
              type.create(
                { language: language ?? detectLanguage(fenced.code) },
                fenced.code === '' ? null : schema.text(fenced.code),
              ),
            );
            if (tr.selection.$from.parent.type !== type) {
              tr.setSelection(
                TextSelection.near(
                  tr.doc.resolve(Math.max(0, tr.selection.from - 2)),
                ),
              );
            }
            tr.setMeta('paste', true);
            view.dispatch(tr);
            return true;
          },
        },
      }),

      /* --------------------------- line numbers -------------------------- */
      new Plugin<DecorationSet>({
        key: lineNumberKey,
        state: {
          init: (_, { doc }) =>
            codeLook().numbers
              ? lineNumberDecorations(doc, typeName)
              : DecorationSet.empty,
          apply: (tr, value) => {
            if (tr.getMeta(lineNumberKey) === true || tr.docChanged) {
              return codeLook().numbers
                ? lineNumberDecorations(tr.doc, typeName)
                : DecorationSet.empty;
            }
            return value.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return lineNumberKey.getState(state) ?? DecorationSet.empty;
          },
        },
        /*
         * The setting lives outside ProseMirror, so turning line numbers on
         * changes nothing a transaction would notice. The subscription pokes
         * each open editor with an empty transaction carrying this plugin's
         * key, which is the smallest thing that makes `apply` recompute — and
         * it is per-view, so the two pages of a spread both update and
         * neither leaks a listener when its editor is torn down.
         */
        view: (editorView) => {
          const off = subscribeCodeLook(() => {
            editorView.dispatch(editorView.state.tr.setMeta(lineNumberKey, true));
          });
          return { destroy: off };
        },
      }),
    ];
  },

  addNodeView() {
    return SolidNodeViewRenderer(CodeBlockView, {
      // Everything in the tab is chrome. Without this a click on the language
      // picker collapses the selection into a node selection first, and the
      // card opens with the block flashing blue behind it. (The card itself is
      // in a body portal, so ProseMirror never sees its events at all.)
      stopEvent: ({ event }) => {
        const target = event.target;
        return (
          target instanceof Element && target.closest('.nb-code-tab') !== null
        );
      },
    });
  },
});

/* ============================ the language picker ========================= */

/**
 * The block's language, chosen from a card drawn in this app's own hand.
 *
 * ## What this replaced
 *
 * A native `<select>`, sitting transparently on top of a drawn word so the
 * CLOSED control looked right. The reader's report was two faults in one
 * sentence: *"the dropdown isn't in our app UI, and it also goes all the way
 * down to the bottom"*. Both are the platform popup rather than the app —
 * Chromium draws its own list, in its own colours, at whatever height
 * seventy-two rows come to, which on a laptop is the full window. Nothing in
 * CSS reaches inside it.
 *
 * ## The pattern it follows, rather than a sixth one
 *
 * The slash menu, the `[[` page picker and the studio's design sheets are the
 * three places this app already presents a long list, and they agree: an
 * aged-paper card, a search field, sections with headings, arrow keys, a
 * highlighted row, a count. This is the same card, positioned by the same
 * `@floating-ui/dom` call the slash menu is positioned by — `flip` so it opens
 * upward when the block sits near the foot of the page, and `size` so its
 * height is capped by the space actually available. That cap is the second
 * fault, fixed at the root: the list scrolls INSIDE the card, and the card is
 * never taller than the window can hold.
 *
 * ## What a native select gave for free, and is given back here
 *
 * The old comment argued native because a hand-drawn popup would have to
 * re-implement type-ahead, arrow keys, Escape and scroll-into-view. It does,
 * and they are here: a search field (better than type-ahead over seventy-one
 * names, and the same thing every other list in this app does), Up, Down,
 * Home, End, PageUp, PageDown, Enter to take the active row, Escape to close,
 * and focus handed back to the tab either way so a keyboard reader is never
 * left standing in a portal that has gone.
 *
 * The listbox is a REAL listbox — `role="listbox"` with `role="option"` rows
 * grouped into `role="group"` shelves, driven by `aria-activedescendant` from
 * the search field, which is the combobox pattern rather than a div with
 * click handlers on it.
 */

/** Distinct ids per instance: two pages of a spread both have code blocks. */
let pickerSeq = 0;

interface LanguagePickerProps {
  /** The block's stored language, `null` for auto. */
  readonly language: string | null;
  /** The word on the tab, already resolved. */
  readonly label: string;
  onPick(id: string | null): void;
}

function LanguagePicker(props: LanguagePickerProps): JSX.Element {
  const uid = `nb-langpick-${(pickerSeq += 1)}`;
  const listId = `${uid}-list`;
  const rowId = (index: number): string => `${uid}-r${index}`;

  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal('');
  const [active, setActive] = createSignal(0);

  let trigger: HTMLButtonElement | undefined;
  let card: HTMLDivElement | undefined;
  let field: HTMLInputElement | undefined;
  let stopFollowing: (() => void) | undefined;

  // The card opens under the tab, which is very often under a resting mouse —
  // and an element appearing beneath a stationary pointer still fires
  // mouseenter. Without this the highlight leaves the row the reader is
  // reading. See menu/hoverIntent.ts for the bug in full.
  const pointerMoved = createHoverIntent();

  const rows = createMemo<readonly CodeLanguageChoice[]>(() =>
    filterCodeLanguages(query()),
  );

  /**
   * The rows cut into shelves, carrying the flat index with them.
   *
   * A consecutive run is the right grouping here (unlike the studio's sheets,
   * which gather by name): `CODE_LANGUAGE_CHOICES` is already in shelf order,
   * so a shelf can never appear twice. While a query is live the headings go
   * away entirely — a hit list split into four one-row sections is harder to
   * scan than a plain run, which is the whole reason somebody typed.
   */
  const sections = createMemo(() => {
    const searching = query().trim() !== '';
    const out: { title: string; items: { row: CodeLanguageChoice; i: number }[] }[] =
      [];
    rows().forEach((row, i) => {
      const title = searching ? '' : row.shelf;
      const last = out[out.length - 1];
      if (last !== undefined && last.title === title) last.items.push({ row, i });
      else out.push({ title, items: [{ row, i }] });
    });
    return out;
  });

  /** Where the reader's own language sits in the unfiltered list. */
  const indexOfCurrent = (): number => {
    const here = props.language;
    const at = rows().findIndex((row) => row.id === here);
    return at < 0 ? 0 : at;
  };

  const place = (): void => {
    const anchor = trigger;
    const el = card;
    if (anchor === undefined || el === undefined) return;
    void computePosition(anchor, el, {
      placement: 'bottom-start',
      strategy: 'fixed',
      middleware: [
        offset(8),
        flip({ padding: 12 }),
        shift({ padding: 12 }),
        // THE SECOND FAULT, fixed where it starts. `flip` has already chosen a
        // side by the time this runs, so `availableHeight` is the room really
        // left on that side; the card takes it, or 420px, whichever is less.
        // Floored at 180 so a block wedged against the bottom of the window
        // still gets a card with rows in it rather than a sliver — `flip`
        // picks the roomier side first, so both sides can only be under 180 in
        // a window shorter than about 400px.
        size({
          padding: 12,
          apply: ({ availableHeight, elements }) => {
            elements.floating.style.setProperty(
              '--nb-langpick-max',
              `${Math.max(180, Math.min(420, Math.round(availableHeight)))}px`,
            );
          },
        }),
      ],
    }).then(({ x, y }) => {
      // transform-only positioning — never animate layout properties.
      el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    });
  };

  /**
   * Focus goes back to the tab it came from.
   *
   * A portal that vanishes while it holds focus drops a keyboard reader on
   * `<body>`, which is the one way out of this control nobody can recover from
   * without a mouse. Asked TWICE, and the second one is not superstition: the
   * card is torn down by the same synchronous update that closes it, so the
   * browser is settling focus after an element was removed from under it, and
   * it lands on `<body>` a frame later — taking this call with it. Under a
   * throttled headless frame clock it happened about one run in four.
   */
  const backToTab = (): void => {
    const el = trigger;
    if (el === undefined) return;
    el.focus();
    requestAnimationFrame(() => {
      if (el.isConnected && document.activeElement !== el) el.focus();
    });
  };

  const close = (refocus: boolean): void => {
    if (!open()) return;
    setOpen(false);
    setQuery('');
    if (refocus) backToTab();
  };

  const openNow = (startAt: number): void => {
    if (open()) return;
    setQuery('');
    setActive(startAt);
    setOpen(true);
  };

  const pick = (row: CodeLanguageChoice): void => {
    props.onPick(row.id);
    close(true);
  };

  /* ------------------------------ the wiring ----------------------------- */

  createEffect(() => {
    const isOpen = open();
    stopFollowing?.();
    stopFollowing = undefined;
    if (!isOpen) return;
    const anchor = trigger;
    const el = card;
    if (anchor === undefined || el === undefined) return;
    // `autoUpdate` rather than one measurement: the page under this block can
    // reflow while the card is open (an overflowing block peels to the next
    // leaf), and a card left behind at the old position is worse than one that
    // never opened.
    stopFollowing = autoUpdate(anchor, el, place);
    field?.focus();
  });

  createEffect(() => {
    if (!open()) return;
    const index = active();
    card
      ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  });

  /** Close when the reader points somewhere else. */
  createEffect(() => {
    if (!open()) return;
    const onDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (card?.contains(target) === true) return;
      if (trigger?.contains(target) === true) return;
      // No refocus: the reader has already said where they want to be.
      close(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    onCleanup(() => document.removeEventListener('pointerdown', onDown, true));
  });

  onCleanup(() => stopFollowing?.());

  const step = (delta: number): void => {
    const count = rows().length;
    if (count === 0) return;
    setActive((active() + delta + count) % count);
  };

  const onFieldKeyDown = (event: KeyboardEvent): void => {
    const count = rows().length;
    switch (event.key) {
      case 'ArrowDown':
        step(1);
        break;
      case 'ArrowUp':
        step(-1);
        break;
      case 'PageDown':
        setActive(Math.min(count - 1, active() + 8));
        break;
      case 'PageUp':
        setActive(Math.max(0, active() - 8));
        break;
      case 'Home':
        setActive(0);
        break;
      case 'End':
        setActive(Math.max(0, count - 1));
        break;
      case 'Enter': {
        const row = rows()[active()];
        if (row !== undefined) pick(row);
        break;
      }
      case 'Escape':
        close(true);
        break;
      case 'Tab':
        // Tab means "I am done here" — close, and let focus move on normally.
        // Deliberately NOT prevented: this block already costs a reader one
        // escape hatch to get past (see the header), and a second trap on the
        // way out of the picker would be the same mistake twice.
        //
        // Put on the tab by hand rather than through `close(true)`, and both
        // halves of that matter. The trigger is what Tab then steps off, which
        // it cannot do from an element that has just been removed; and
        // `backToTab`'s next-frame retry would snatch focus back from wherever
        // Tab had legitimately taken it.
        setOpen(false);
        setQuery('');
        trigger?.focus();
        return;
      default:
        return;
    }
    // Everything above is handled here and nowhere else: `installShortcuts`
    // listens on window and steps aside for a prevented key, which is what
    // keeps Home and PageDown from also driving the shelf behind the page.
    event.preventDefault();
    event.stopPropagation();
  };

  const onTriggerKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    openNow(indexOfCurrent());
  };

  return (
    <>
      <button
        type="button"
        class="nb-code-lang"
        ref={(el) => (trigger = el)}
        aria-haspopup="listbox"
        aria-expanded={open()}
        aria-controls={open() ? listId : undefined}
        // The VALUE is in the name, so a screen reader says what the block is
        // set to without the reader having to open the thing to find out.
        aria-label={`code language — ${props.label}`}
        onClick={() => (open() ? close(true) : openNow(indexOfCurrent()))}
        onKeyDown={onTriggerKeyDown}
      >
        <span class="nb-code-lang-word font-ui">{props.label}</span>
      </button>

      <Show when={open()}>
        {/* A body portal, exactly as the slash menu is: the card has to escape
            the page's own clipping, and a page in this app never scrolls. */}
        <Portal>
          <div class="nb-langpick" ref={(el) => (card = el)}>
            <div class="nb-langpick-head font-ui">the language of this block</div>
            <input
              ref={(el) => (field = el)}
              class="nb-langpick-search font-ui"
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                rows().length > 0 ? rowId(active()) : undefined
              }
              aria-label="search the languages"
              placeholder="search…"
              autocomplete="off"
              spellcheck={false}
              value={query()}
              onInput={(event) => {
                setQuery(event.currentTarget.value);
                setActive(0);
              }}
              onKeyDown={onFieldKeyDown}
            />
            {/* Says how many, the way the studio's sheets do — and `aria-live`
                so a reader who cannot see the list shrink is told that it did.
                Above the list rather than under it, so it does not scroll
                away from the field it is describing. */}
            <p class="nb-langpick-count font-ui" aria-live="polite">
              {query().trim() === ''
                ? `${CODE_LANGUAGE_CHOICES.length - 1} languages, and auto`
                : `${rows().length} of ${CODE_LANGUAGE_CHOICES.length}`}
            </p>
            <div class="nb-langpick-list" id={listId} role="listbox" aria-label="code language">
              <For each={sections()}>
                {(section) => (
                  <div
                    role="group"
                    aria-label={section.title === '' ? 'languages' : section.title}
                  >
                    <Show when={section.title !== ''}>
                      <div class="nb-langpick-shelf">{section.title}</div>
                    </Show>
                    <For each={section.items}>
                      {(entry) => (
                        <button
                          type="button"
                          role="option"
                          class="nb-langpick-item"
                          classList={{
                            'is-active': entry.i === active(),
                            'is-current': entry.row.id === props.language,
                          }}
                          id={rowId(entry.i)}
                          data-index={entry.i}
                          data-lang={entry.row.id ?? 'auto'}
                          // Which row the KEYBOARD is on. The reader's stored
                          // choice is `aria-current` below — two different
                          // questions, and a listbox that answers them with one
                          // attribute cannot say "you are looking at rust and
                          // this block is still python".
                          aria-selected={entry.i === active()}
                          aria-current={
                            entry.row.id === props.language ? 'true' : undefined
                          }
                          // mousedown, not click: a click would land after the
                          // outside-pointerdown listener had already closed the
                          // card out from under it.
                          onMouseDown={(event) => {
                            event.preventDefault();
                            pick(entry.row);
                          }}
                          onMouseEnter={() => {
                            if (pointerMoved()) setActive(entry.i);
                          }}
                        >
                          <span class="nb-langpick-tick" aria-hidden="true" />
                          <span class="nb-langpick-text">
                            <span class="nb-langpick-name">{entry.row.label}</span>
                            <span class="nb-langpick-note font-ui">
                              {entry.row.note}
                            </span>
                          </span>
                        </button>
                      )}
                    </For>
                  </div>
                )}
              </For>
              <Show when={rows().length === 0}>
                <p class="nb-langpick-empty font-accent">
                  nothing by that name — try a shorter word?
                </p>
              </Show>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  );
}

/* ============================== the node view ============================ */

function CodeBlockView(props: SolidNodeViewProps): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(copyTimer));

  const language = (): string | null => {
    const raw = props.node.attrs.language;
    return typeof raw === 'string' && raw !== '' ? raw : null;
  };

  /**
   * The word on the tab.
   *
   * `auto` is honest rather than coy: with no language the highlighter is
   * guessing, and a chip that said "plain" while the block was being coloured
   * would be describing a different block.
   */
  const label = createMemo(() => languageLabel(language()));

  const copy = (): void => {
    void navigator.clipboard
      .writeText(props.node.textContent)
      .then(() => {
        setCopied(true);
        clearTimeout(copyTimer);
        copyTimer = setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => {
        // No clipboard permission. Saying nothing is better than a toast the
        // reader cannot act on; the text is right there to select.
      });
  };

  return (
    <NodeViewWrapper
      class="nb-code"
      classList={{ 'is-selected': props.selected }}
      data-nb-block-flow="feature"
      data-language={language() ?? 'auto'}
    >
      <div class="nb-code-tab" contenteditable={false}>
        <span class="nb-code-tab-plate">
          <LanguagePicker
            language={language()}
            label={label()}
            onPick={(next) => props.updateAttributes({ language: next })}
          />
        </span>
        <button
          type="button"
          class="nb-code-copy font-ui"
          data-tooltip={copied() ? 'on the clipboard' : 'copy this block'}
          onClick={copy}
        >
          <Show when={copied()} fallback="copy">
            copied
          </Show>
        </button>
      </div>
      <pre class="nb-code-sheet">
        <NodeViewContent as="code" class="nb-code-body" spellcheck={false} />
      </pre>
      {/* The escape hatch, said out loud. It is only drawn while the caret is
          in this block (CSS on .is-editing), so it is a reminder rather than
          a permanent label on every code block on the page. */}
      <span class="nb-code-hint font-ui" contenteditable={false} aria-hidden="true">
        Tab indents · Esc then Tab leaves
      </span>
    </NodeViewWrapper>
  );
}
