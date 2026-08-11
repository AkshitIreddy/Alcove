/**
 * Vendored SolidJS bindings for TipTap v3 — Solid node views.
 *
 * SolidNodeViewRenderer(Component) returns a TipTap NodeViewRenderer.
 * Per node view instance:
 *   - a Solid root is created via `render()` (createRoot under the hood),
 *   - props are delivered through a `createStore` so `update()` mutates the
 *     store fine-grained — no VDOM diff, exactly where Solid beats the
 *     React bindings,
 *   - `destroy()` disposes the root.
 *
 * Components use <NodeViewWrapper> / <NodeViewContent>; the element carrying
 * `data-node-view-content` is mapped to ProseMirror's contentDOM.
 */
import {
  NodeView,
  type Editor,
  type NodeViewRenderer,
  type NodeViewRendererOptions,
  type NodeViewRendererProps,
} from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Decoration, DecorationSource } from '@tiptap/pm/view';
import {
  createContext,
  splitProps,
  useContext,
  type Component,
  type JSX,
} from 'solid-js';
import { createStore, type SetStoreFunction } from 'solid-js/store';
import { Dynamic, render } from 'solid-js/web';

// ---------------------------------------------------------------------------
// Props delivered to Solid node view components
// ---------------------------------------------------------------------------

/** Reactive + imperative surface a Solid node view component receives. */
export interface SolidNodeViewProps {
  /** The ProseMirror node being rendered (reactive). */
  readonly node: ProseMirrorNode;
  /** Node decorations around this node (reactive). */
  readonly decorations: readonly Decoration[];
  /** Decorations for the node's content (reactive). */
  readonly innerDecorations: DecorationSource;
  /** True while a NodeSelection covers this node (reactive). */
  readonly selected: boolean;
  /** The editor instance (stable). */
  readonly editor: Editor;
  /** Current document position of the node (stable function). */
  readonly getPos: () => number | undefined;
  /** Patch this node's attributes through a transaction. */
  readonly updateAttributes: (attrs: Record<string, unknown>) => void;
  /** Remove this node from the document. */
  readonly deleteNode: () => void;
}

interface NodeViewContextValue {
  readonly isInline: boolean;
  readonly onDragStart: (event: DragEvent) => void;
}

const NodeViewContext = createContext<NodeViewContextValue>();

// ---------------------------------------------------------------------------
// <NodeViewWrapper> / <NodeViewContent>
// ---------------------------------------------------------------------------

type WrapperProps = JSX.HTMLAttributes<HTMLElement> & {
  /** Override the rendered tag; defaults to div (span for inline nodes). */
  as?: keyof JSX.IntrinsicElements;
  children?: JSX.Element;
};

/**
 * Root element of a Solid node view. Forwards TipTap's drag-start handling
 * so `draggable: true` nodes can be dragged by their own chrome.
 */
export function NodeViewWrapper(props: WrapperProps): JSX.Element {
  const context = useContext(NodeViewContext);
  const [local, rest] = splitProps(props, ['as', 'children']);
  return (
    <Dynamic
      component={local.as ?? (context?.isInline ? 'span' : 'div')}
      data-node-view-wrapper=""
      onDragStart={(event: DragEvent) => context?.onDragStart(event)}
      {...rest}
    >
      {local.children}
    </Dynamic>
  );
}

type ContentProps = JSX.HTMLAttributes<HTMLElement> & {
  as?: keyof JSX.IntrinsicElements;
};

/**
 * Marks the element ProseMirror should manage as contentDOM.
 * Render exactly one per node view (none for atoms).
 */
export function NodeViewContent(props: ContentProps): JSX.Element {
  const context = useContext(NodeViewContext);
  const [local, rest] = splitProps(props, ['as']);
  return (
    <Dynamic
      component={local.as ?? (context?.isInline ? 'span' : 'div')}
      data-node-view-content=""
      style={{ 'white-space': 'pre-wrap' }}
      {...rest}
    />
  );
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

interface ReactiveNodeViewState {
  node: ProseMirrorNode;
  decorations: readonly Decoration[];
  innerDecorations: DecorationSource;
  selected: boolean;
}

class SolidNodeView extends NodeView<Component<SolidNodeViewProps>> {
  // `declare` (not `!`) is load-bearing: the base constructor calls mount(),
  // which assigns these. With useDefineForClassFields, real field
  // declarations would re-define them to undefined AFTER super() returns.
  private declare hostElement: HTMLElement;

  private declare disposeRoot: () => void;

  private declare setState: SetStoreFunction<ReactiveNodeViewState>;

  mount(): void {
    const [state, setState] = createStore<ReactiveNodeViewState>({
      node: this.node,
      decorations: this.decorations,
      innerDecorations: this.innerDecorations,
      selected: false,
    });
    this.setState = setState;

    // Fine-grained props: getters read the store, functions stay stable.
    const viewProps: SolidNodeViewProps = {
      editor: this.editor,
      getPos: () => this.getPos(),
      updateAttributes: (attrs) => this.updateAttributes(attrs),
      deleteNode: () => this.deleteNode(),
      get node() {
        return state.node;
      },
      get decorations() {
        return state.decorations;
      },
      get innerDecorations() {
        return state.innerDecorations;
      },
      get selected() {
        return state.selected;
      },
    };

    const contextValue: NodeViewContextValue = {
      isInline: this.node.isInline,
      onDragStart: (event) => this.onDragStart(event),
    };

    const host = document.createElement(this.node.isInline ? 'span' : 'div');
    host.classList.add('nb-node-view');
    host.dataset.nodeViewRoot = this.node.type.name;
    this.hostElement = host;

    const ViewComponent = this.component;
    // render() creates its own reactive root and returns the disposer.
    this.disposeRoot = render(
      () => (
        <NodeViewContext.Provider value={contextValue}>
          <ViewComponent {...viewProps} />
        </NodeViewContext.Provider>
      ),
      host,
    );
  }

  override get dom(): HTMLElement {
    return this.hostElement;
  }

  override get contentDOM(): HTMLElement | null {
    if (this.node.isLeaf) return null;
    return this.hostElement.querySelector<HTMLElement>(
      '[data-node-view-content]',
    );
  }

  update(
    node: ProseMirrorNode,
    decorations: readonly Decoration[],
    innerDecorations: DecorationSource,
  ): boolean {
    if (node.type !== this.node.type) return false;
    // Keep the base class fields current (stopEvent/ignoreMutation use them),
    // then push through the store for fine-grained component updates.
    this.node = node;
    this.decorations = decorations;
    this.innerDecorations = innerDecorations;
    this.setState({ node, decorations, innerDecorations });
    return true;
  }

  selectNode(): void {
    this.setState('selected', true);
  }

  deselectNode(): void {
    this.setState('selected', false);
  }

  override stopEvent(event: Event): boolean {
    /*
     * TipTap's base NodeView protects interactive custom blocks by consuming
     * their DOM events. A context menu is owned by PageEditor, though: it
     * carries page actions as well as block actions and must answer both the
     * visible media and the blank part of a narrow media row. Let only this
     * event reach ProseMirror's shared handleDOMEvents hook; buttons, drags,
     * captions and every other node-view interaction retain the base policy.
     */
    if (event.type === 'contextmenu') return false;
    return super.stopEvent(event);
  }

  destroy(): void {
    this.disposeRoot();
  }
}

/**
 * Wrap a Solid component as a TipTap node view renderer.
 *
 * This is the single sanctioned place `render()` is called for node views —
 * every custom block goes through here so reactive roots are always paired
 * with `destroy()` disposal (no leaked computations, no stale props).
 */
export function SolidNodeViewRenderer(
  component: Component<SolidNodeViewProps>,
  options: Partial<NodeViewRendererOptions> = {},
): NodeViewRenderer {
  return (props: NodeViewRendererProps) =>
    new SolidNodeView(component, props, options);
}
