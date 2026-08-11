/**
 * math / mathInline — an equation on its own line, and maths inside a sentence.
 *
 * Both are ATOMS holding one `latex` string, drawn by `./mathTex.ts` (which is
 * pure, and is where the interesting decisions live). The document JSON is the
 * storage format, so what is stored is the source a reader typed — never the
 * rendered markup. That is the whole reason this is an attribute rather than a
 * tree of nodes: a formula is one thought, it is edited as one string, and it
 * survives a renderer rewrite untouched.
 *
 * EDITING is click-to-source: the node view draws the maths; clicking it swaps
 * the rendering for the LaTeX in a small editable field, and Enter, Escape or
 * a click elsewhere puts the rendering back. There is no popover, no side
 * panel and no second editor instance — the formula is edited exactly where it
 * is read, which is the same bargain the footnote rail makes.
 *
 * INPUT RULES make it discoverable without the slash menu: `$x^2$` becomes
 * inline maths as you close the dollar, and `$$` on an empty line opens an
 * equation block. Both are what a reader who knows any maths tool will try
 * first.
 *
 * Pagination needs nothing: an equation block is one top-level block and flows
 * like a paragraph; inline maths rides inside its paragraph.
 */
import { InputRule, Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import type { NodeViewRendererProps } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { mathToHtml } from './mathTex';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    math: {
      /** An equation on its own line. */
      insertEquation: (latex?: string) => ReturnType;
      /** Maths inside the sentence being written. */
      insertInlineMath: (latex?: string) => ReturnType;
    };
  }
}

function latexOf(node: ProseMirrorNode): string {
  const raw: unknown = node.attrs.latex;
  return typeof raw === 'string' ? raw : '';
}

const latexAttribute = {
  default: '',
  parseHTML: (element: HTMLElement): string =>
    element.getAttribute('data-latex') ?? element.textContent ?? '',
  renderHTML: (attributes: Record<string, unknown>): Record<string, unknown> => ({
    'data-latex': typeof attributes.latex === 'string' ? attributes.latex : '',
  }),
};

/**
 * The node view both nodes share.
 *
 * Written against the DOM rather than through the Solid bindings on purpose:
 * everything it does is `innerHTML` of a string the renderer already built,
 * and a reactive root per formula would buy nothing but a lifecycle to leak.
 */
function mathNodeView(display: boolean) {
  return (props: NodeViewRendererProps) => {
    const { editor, getPos } = props;
    let node = props.node;
    const dom: HTMLElement = document.createElement(display ? 'div' : 'span');
    dom.className = display ? 'nb-math nb-math-block' : 'nb-math nb-math-inline';
    dom.setAttribute('data-type', display ? 'math' : 'mathInline');

    let field: HTMLElement | null = null;
    let fitFrame = 0;

    /**
     * Keep a long display equation on the paper without giving it a web-style
     * horizontal scrollbar. Most equations stay at the authored 1.25em; only
     * a genuinely over-wide row is optically reduced, with a conservative
     * readability floor. The AI guide still tells writers to split very long
     * derivations—this is the safety net for a single modest overrun.
     */
    const fitDisplayMath = (): void => {
      if (!display || field !== null || !dom.isConnected) return;
      const rendered = dom.querySelector<HTMLElement>('.nb-math-render');
      if (rendered === null) return;
      rendered.style.fontSize = '';
      rendered.removeAttribute('data-fit-scale');
      const available = dom.clientWidth;
      const needed = rendered.getBoundingClientRect().width;
      if (available <= 0 || needed <= available) return;
      const scale = Math.max(0.62, (available - 2) / needed);
      rendered.style.fontSize = `${(1.25 * scale).toFixed(3)}em`;
      rendered.setAttribute('data-fit-scale', scale.toFixed(3));
    };

    const scheduleFit = (): void => {
      cancelAnimationFrame(fitFrame);
      fitFrame = requestAnimationFrame(fitDisplayMath);
    };

    const draw = (): void => {
      if (field !== null) return; // being edited — do not pull the rug
      dom.innerHTML = mathToHtml(latexOf(node), { display });
      scheduleFit();
    };

    const commit = (next: string): void => {
      const pos = typeof getPos === 'function' ? getPos() : null;
      if (pos === null || pos === undefined) return;
      if (next === latexOf(node)) return;
      editor.view.dispatch(
        editor.view.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          latex: next,
        }),
      );
    };

    const close = (commitFirst: boolean): void => {
      if (field === null) return;
      const text = field.textContent ?? '';
      field = null;
      dom.classList.remove('is-editing');
      if (commitFirst) commit(text);
      draw();
    };

    const open = (): void => {
      if (!editor.isEditable || field !== null) return;
      dom.classList.add('is-editing');
      dom.innerHTML = '';
      const input: HTMLElement = document.createElement(display ? 'div' : 'span');
      input.className = 'nb-math-source';
      input.contentEditable = 'plaintext-only';
      input.spellcheck = false;
      input.textContent = latexOf(node);
      input.dataset.hint = display ? '\\frac{a}{b}' : 'x^2';
      input.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          close(true);
          editor.commands.focus();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          close(false);
          editor.commands.focus();
        }
      });
      input.addEventListener('blur', () => close(true));
      dom.appendChild(input);
      field = input;
      input.focus();
      const range = document.createRange();
      range.selectNodeContents(input);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    };

    dom.addEventListener('mousedown', (event) => {
      if (!editor.isEditable) return;
      // A click on a formula means "let me fix it" — the alternative is a
      // node selection, which looks identical and does nothing.
      event.preventDefault();
      open();
    });

    draw();

    // A formula that arrives EMPTY is one the reader just asked for — from the
    // slash menu, or by typing `$$`. Open its source straight away rather than
    // making them click the placeholder they have not read yet. The focus test
    // is what keeps a saved-empty formula from grabbing the caret on load.
    if (latexOf(node) === '' && editor.isEditable && editor.isFocused) {
      requestAnimationFrame(() => {
        if (dom.isConnected) open();
      });
    }

    return {
      dom,
      update: (updated: ProseMirrorNode): boolean => {
        if (updated.type !== node.type) return false;
        node = updated;
        draw();
        return true;
      },
      selectNode: () => dom.classList.add('is-selected'),
      deselectNode: () => dom.classList.remove('is-selected'),
      stopEvent: () => field !== null,
      ignoreMutation: () => true,
      destroy: () => {
        cancelAnimationFrame(fitFrame);
        field = null;
      },
    };
  };
}

export const MathBlock = Node.create({
  name: 'math',

  group: 'block',

  atom: true,

  draggable: true,

  addAttributes() {
    return { latex: latexAttribute };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="math"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'math' }),
      latexOf(node),
    ];
  },

  addNodeView() {
    return mathNodeView(true);
  },

  addCommands() {
    return {
      insertEquation:
        (latex = '') =>
        ({ chain }) =>
          chain().insertContent({ type: 'math', attrs: { latex } }).run(),

      insertInlineMath:
        (latex = '') =>
        ({ chain }) =>
          chain().insertContent({ type: 'mathInline', attrs: { latex } }).run(),
    };
  },

  addInputRules() {
    return [
      // `$$` on its own opens an equation; the source is typed into the block.
      nodeInputRule({
        find: /^\$\$$/,
        type: this.type,
        getAttributes: () => ({ latex: '' }),
      }),
    ];
  },
});

export const MathInline = Node.create({
  name: 'mathInline',

  inline: true,

  group: 'inline',

  atom: true,

  addAttributes() {
    return { latex: latexAttribute };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="mathInline"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-type': 'mathInline' }),
      latexOf(node),
    ];
  },

  addNodeView() {
    return mathNodeView(false);
  },

  addInputRules() {
    const type = this.type;
    return [
      // `$x^2$` — closing the pair converts what is between them. The source
      // must not be empty (`$$` is the block rule above) and must not span a
      // second dollar, so a lone `$` in prose is never eaten.
      //
      // Hand-rolled rather than `nodeInputRule`: that helper, when the pattern
      // captures a group, replaces only the CAPTURE and puts the last matched
      // character back (it is shaped for `![alt](src)`, where the brackets are
      // meant to survive). Here that left the dollars on the page around the
      // rendered maths.
      new InputRule({
        find: /\$([^$\n]+)\$$/,
        handler: ({ state, range, match }) => {
          const latex = match[1] ?? '';
          if (latex.trim() === '') return null;
          state.tr.replaceWith(range.from, range.to, type.create({ latex }));
          return undefined;
        },
      }),
    ];
  },
});
