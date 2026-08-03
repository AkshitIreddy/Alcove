/**
 * Diagram block — an atom node rendering hand-drawn diagrams (tree, mindmap,
 * graph/flowchart, timeline) from a Notebook Script diagram AST.
 *
 * Attrs (block-editor design §3): { kind, data (JSON string of the script
 * diagram AST payload), width }. The Solid node view mounts the renderer
 * lazily (IntersectionObserver), shows a pencil selection halo, and offers a
 * click-to-edit source popover: a textarea holding the fence source,
 * reparsed through the real src/script diagram parsers on apply.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
  For,
  type JSX,
} from 'solid-js';
import {
  NodeViewWrapper,
  SolidNodeViewRenderer,
  type SolidNodeViewProps,
} from '../solid';
import { DiagramRenderer } from '../../diagrams/render/DiagramRenderer';
import '../../styles/diagrams.css';
import {
  decodeDiagramData,
  encodeDiagramData,
  parseDiagramSource,
  printDiagramSource,
} from '../../diagrams/source';
import { isDiagramKind, type DiagramKind } from '../../diagrams/types';
import type { Diag } from '../../script/types';

export interface DiagramAttributes {
  kind: DiagramKind;
  /** JSON string of the script diagram AST payload (see diagrams/source.ts). */
  data: string;
  /** Preferred block width in px (clamped 240–960). */
  width: number;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    diagram: {
      /** Insert a diagram block. */
      insertDiagram: (attrs: Partial<DiagramAttributes> & { kind: DiagramKind }) => ReturnType;
    };
  }
}

const DEFAULT_WIDTH = 640;

function clampWidth(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_WIDTH;
  return Math.min(960, Math.max(240, Math.round(parsed)));
}

const KIND_TITLES: Record<DiagramKind, string> = {
  tree: 'Tree',
  mindmap: 'Mindmap',
  graph: 'Graph',
  flowchart: 'Flowchart',
  timeline: 'Timeline',
};

// ---------------------------------------------------------------------------
// Node view
// ---------------------------------------------------------------------------

function DiagramView(props: SolidNodeViewProps): JSX.Element {
  const kind = (): DiagramKind => {
    const value: unknown = props.node.attrs.kind;
    return isDiagramKind(value) ? value : 'tree';
  };
  const width = (): number => clampWidth(props.node.attrs.width);
  const data = createMemo(() => decodeDiagramData(kind(), props.node.attrs.data));

  // Lazy mount: render the SVG only once the block scrolls near the viewport.
  const [visible, setVisible] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [diags, setDiags] = createSignal<Diag[]>([]);
  let wrapperEl: HTMLElement | undefined;
  let textareaEl: HTMLTextAreaElement | undefined;

  onMount(() => {
    if (typeof IntersectionObserver === 'undefined' || wrapperEl === undefined) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '320px' },
    );
    observer.observe(wrapperEl);
    onCleanup(() => observer.disconnect());
  });

  const openEditor = (): void => {
    setDraft(printDiagramSource(data()));
    setDiags([]);
    setEditing(true);
  };

  createEffect(() => {
    if (editing()) textareaEl?.focus();
  });

  const applyDraft = (): void => {
    const parsed = parseDiagramSource(kind(), draft());
    setDiags(parsed.diagnostics);
    props.updateAttributes({ data: encodeDiagramData(parsed.data) });
    setEditing(false);
  };

  const previewDiags = (): void => {
    setDiags(parseDiagramSource(kind(), draft()).diagnostics);
  };

  return (
    <NodeViewWrapper
      class="nb-diagram"
      classList={{ 'is-selected': props.selected, 'is-editing': editing() }}
      data-kind={kind()}
      ref={(el: HTMLElement) => {
        wrapperEl = el;
      }}
    >
      <div
        class="nb-diagram-canvas"
        style={{ 'max-width': `${width()}px` }}
        contenteditable={false}
      >
        <Show
          when={visible()}
          fallback={<div class="nb-diagram-skeleton" aria-hidden="true" />}
        >
          <DiagramRenderer data={data()} />
        </Show>
        <div class="nb-diagram-chrome">
          <span class="nb-diagram-kind">{KIND_TITLES[kind()]}</span>
          <button
            type="button"
            class="nb-diagram-edit"
            data-tooltip="Edit diagram source"
            aria-label="Edit diagram source"
            onClick={() => (editing() ? setEditing(false) : openEditor())}
          >
            ✎
          </button>
        </div>
        <Show when={editing()}>
          <div class="nb-diagram-popover" contenteditable={false}>
            <div class="nb-diagram-popover-title">
              ``` {kind()} — edit &amp; apply
            </div>
            <textarea
              class="nb-diagram-source"
              spellcheck={false}
              value={draft()}
              ref={(el: HTMLTextAreaElement) => {
                textareaEl = el;
              }}
              onInput={(event) => {
                setDraft(event.currentTarget.value);
                previewDiags();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setEditing(false);
                } else if (
                  event.key === 'Enter' &&
                  (event.ctrlKey || event.metaKey)
                ) {
                  event.preventDefault();
                  applyDraft();
                }
              }}
            />
            <Show when={diags().length > 0}>
              {/* Same shape as the Insert Script dialog's warning list:
                  located, and carrying `expected` when the parser knows it. */}
              <ul class="nb-diagram-diags">
                <For each={diags()}>
                  {(diag) => (
                    <li>
                      <span class="nb-diagram-diag-line">
                        line {diag.line}:{diag.column}
                      </span>{' '}
                      {diag.expected === undefined
                        ? diag.message
                        : `${diag.message} — expected ${diag.expected}`}
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <div class="nb-diagram-popover-actions">
              <button
                type="button"
                class="nb-diagram-btn"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                class="nb-diagram-btn is-primary"
                onClick={applyDraft}
              >
                Apply
              </button>
            </div>
          </div>
        </Show>
      </div>
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export const Diagram = Node.create({
  name: 'diagram',

  group: 'block',

  atom: true,

  draggable: true,

  addAttributes() {
    return {
      kind: {
        default: 'tree' satisfies DiagramKind,
        parseHTML: (element) => {
          const raw = element.getAttribute('data-kind');
          return isDiagramKind(raw) ? raw : 'tree';
        },
        renderHTML: (attributes) => ({ 'data-kind': String(attributes.kind) }),
      },
      data: {
        default: '{"roots":[]}',
        parseHTML: (element) => element.getAttribute('data-diagram') ?? '{"roots":[]}',
        renderHTML: (attributes) => ({
          'data-diagram': String(attributes.data),
        }),
      },
      width: {
        default: DEFAULT_WIDTH,
        parseHTML: (element) => clampWidth(element.getAttribute('data-width')),
        renderHTML: (attributes) => ({ 'data-width': String(attributes.width) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="diagram"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'diagram' }),
    ];
  },

  addCommands() {
    return {
      insertDiagram:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return SolidNodeViewRenderer(DiagramView, {
      // The popover textarea + buttons must keep their events away from
      // ProseMirror, or typing in the source editor edits the document.
      stopEvent: ({ event }) => {
        const target = event.target;
        return (
          target instanceof Element &&
          target.closest('.nb-diagram-popover, .nb-diagram-edit') !== null
        );
      },
    });
  },
});
