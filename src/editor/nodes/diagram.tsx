/**
 * Diagram block — an atom node rendering hand-drawn diagrams (tree, mindmap,
 * graph/flowchart, timeline) from a Notebook Script diagram AST.
 *
 * Attrs (block-editor design §3): { kind, data (JSON string of the script
 * diagram AST payload), width }. The Solid node view shows a pencil selection
 * halo and offers a click-to-edit source popover: a textarea holding the fence
 * source, reparsed through the real src/script diagram parsers on apply.
 *
 * It also decides WHEN to draw — see "When to draw" below. The short version
 * is that the placeholder is now the rare answer rather than the first one:
 * getting that backwards is what let a finished diagram turn back into an
 * empty dashed box under the reader's hands.
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
// When to draw
// ---------------------------------------------------------------------------

/**
 * How far outside the viewport still counts as "the reader is nearly here".
 * Shared by the synchronous mount test and the observer that backs it up, so
 * the two cannot disagree about where the line is.
 */
const LAZY_MARGIN = 320;

/**
 * Diagrams laid out at least once in this session, keyed by the thing that
 * would be laid out again.
 *
 * The placeholder is a promise that a drawing is on its way. Showing it for
 * art that has ALREADY been drawn breaks that promise, and the reader watched
 * it break: a page turn remounts the leaf (BookView keys leaves on
 * `id@version`, so a doc-version bump tears the whole PageEditor down), the
 * fresh node view started at `visible = false` again, and a finished tree
 * became an empty dashed box for as long as it took an IntersectionObserver
 * callback to arrive. So a diagram that has been drawn once is never handed
 * back its own skeleton — the last good drawing simply reappears.
 *
 * Keyed on kind + source rather than on node identity because node identity is
 * exactly what a remount destroys. Two blocks holding the same source share a
 * key, which is harmless: they draw the same picture.
 */
const drawnOnce = new Set<number>();

/**
 * Past this many distinct diagrams the memory starts over. It is a hint, not a
 * record — losing it costs one synchronous rect test, which is the answer it
 * would have given anyway — so it is not worth an eviction policy or a byte
 * more than the cap.
 */
const DRAWN_ONCE_CAP = 4096;

/** FNV-1a over kind + source: cheap, and 32 bits is plenty for a hint. */
function drawKey(kind: DiagramKind, data: string): number {
  const source = `${kind}:${data}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function rememberDrawn(key: number): void {
  if (drawnOnce.size >= DRAWN_ONCE_CAP) drawnOnce.clear();
  drawnOnce.add(key);
}

/**
 * Is this block worth drawing right now, before anything has had a chance to
 * observe it?
 *
 * The laziness this backs up is only ever worth having when we can see that
 * the block is genuinely far from the reader. Every other answer is "draw":
 * the cost of drawing something nobody looks at is one text-measured layout
 * (diagrams/measure.ts does its measuring on a canvas, never through a
 * reflow), and the cost of NOT drawing it is a placeholder somebody looks at.
 *
 * Two of those "every other answer" cases are the whole reason this function
 * exists:
 *
 *  - **A node view mounts detached.** SolidNodeViewRenderer builds its host
 *    with `document.createElement` and ProseMirror inserts it afterwards, so
 *    at `onMount` there is nothing to measure. Answering "later" here is what
 *    made every remount flash its skeleton.
 *  - **A staged sheet is never scrolled anywhere.** The exporters and the
 *    flip's offscreen page capture park a whole read-only page at
 *    `left:-12000px` inside `.nb-export-offscreen` (editor/script/exporters/
 *    capture.ts) and photograph it. An IntersectionObserver there will not
 *    fire in this life, so the diagram stayed a skeleton and the rasterizer
 *    dutifully photographed the skeleton — which is how the turning page's
 *    back and the page revealed beneath the curl came to show a dashed box
 *    where a hand-drawn tree belongs.
 */
function worthDrawingNow(el: HTMLElement): boolean {
  if (typeof window === 'undefined') return true;
  if (!el.isConnected) return true;
  if (el.closest('.nb-export-offscreen') !== null) return true;
  const rect = el.getBoundingClientRect();
  // Zero-sized means it has not been laid out yet, which is not the same
  // answer as "it is somewhere else" — measure again when there is something
  // to measure, and meanwhile draw.
  if (rect.width === 0 && rect.height === 0) return true;
  const viewW = window.innerWidth || document.documentElement.clientWidth;
  const viewH = window.innerHeight || document.documentElement.clientHeight;
  return (
    rect.bottom > -LAZY_MARGIN &&
    rect.top < viewH + LAZY_MARGIN &&
    rect.right > -LAZY_MARGIN &&
    rect.left < viewW + LAZY_MARGIN
  );
}

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

  /**
   * Lazy mount, in three tiers, most confident first.
   *
   * 1. Have we drawn this exact diagram before? Then draw it now, before the
   *    first render, so a remount never even builds a skeleton element.
   * 2. Otherwise, at mount, ask whether it is worth drawing anyway — which is
   *    the answer for anything on a page the reader is looking at and for
   *    anything on a staged sheet about to be photographed.
   * 3. Only when the block is measurably far away does the observer get to
   *    hold the drawing back, and only then is the placeholder ever seen.
   */
  const drawn = createMemo(() =>
    drawKey(kind(), String(props.node.attrs.data ?? '')),
  );
  const [visible, setVisible] = createSignal(drawnOnce.has(drawn()));
  const reveal = (): void => {
    rememberDrawn(drawn());
    setVisible(true);
  };
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [diags, setDiags] = createSignal<Diag[]>([]);
  let wrapperEl: HTMLElement | undefined;
  let textareaEl: HTMLTextAreaElement | undefined;

  onMount(() => {
    if (visible()) {
      rememberDrawn(drawn());
      return;
    }
    if (
      typeof IntersectionObserver === 'undefined' ||
      wrapperEl === undefined ||
      worthDrawingNow(wrapperEl)
    ) {
      reveal();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          reveal();
          observer.disconnect();
        }
      },
      { rootMargin: `${LAZY_MARGIN}px` },
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
