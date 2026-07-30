/**
 * ScriptPreview — lightweight read-only rendering of a parsed ScriptDoc.
 *
 * This is NOT the editor: each script block kind maps to simple styled HTML
 * (see src/styles/insert.css) so the Insert Script dialog can show what a
 * paste will roughly look like. Diagrams render as labeled boxes; containers
 * as tinted cards with a name chip.
 */
import { For, Show, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type {
  Block,
  ContainerBlock,
  DiagramBlock,
  Inline,
  ListItem,
  ScriptDoc,
  TableBlock,
} from '../../script/types';

// ---------------------------------------------------------------------------
// Inlines
// ---------------------------------------------------------------------------

function InlineNodes(props: { nodes: Inline[] }): JSX.Element {
  return (
    <For each={props.nodes}>
      {(n) => {
        switch (n.kind) {
          case 'text':
            return <>{n.text}</>;
          case 'code':
            return <code>{n.text}</code>;
          case 'strong':
            return (
              <strong>
                <InlineNodes nodes={n.children} />
              </strong>
            );
          case 'em':
            return (
              <em>
                <InlineNodes nodes={n.children} />
              </em>
            );
          case 'strike':
            return (
              <s>
                <InlineNodes nodes={n.children} />
              </s>
            );
          case 'highlight':
            return (
              <mark data-color={String(n.attrs?.color ?? 'amber')}>
                <InlineNodes nodes={n.children} />
              </mark>
            );
          case 'sup':
            return (
              <sup>
                <InlineNodes nodes={n.children} />
              </sup>
            );
          case 'sub':
            return (
              <sub>
                <InlineNodes nodes={n.children} />
              </sub>
            );
          case 'link':
            return (
              <a
                href={n.href}
                title={n.href}
                onClick={(event) => event.preventDefault()}
              >
                <InlineNodes nodes={n.children} />
              </a>
            );
        }
      }}
    </For>
  );
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function ListItems(props: {
  items: ListItem[];
  ordered: boolean;
  task: boolean;
}): JSX.Element {
  return (
    <Dynamic component={props.ordered ? 'ol' : 'ul'}>
      <For each={props.items}>
        {(item) => (
          <li classList={{ 'nb-ins-task': props.task }}>
            <Show when={props.task}>
              <input type="checkbox" checked={item.checked === true} disabled />
            </Show>
            <span>
              <InlineNodes nodes={item.content} />
            </span>
            <Show when={item.children.length > 0}>
              <ListItems
                items={item.children}
                ordered={props.ordered}
                task={props.task}
              />
            </Show>
          </li>
        )}
      </For>
    </Dynamic>
  );
}

function TablePreview(props: { block: TableBlock }): JSX.Element {
  return (
    <table class="nb-ins-table">
      <Show when={props.block.header}>
        {(header) => (
          <thead>
            <tr>
              <For each={header().cells}>
                {(cell) => (
                  <th>
                    <InlineNodes nodes={cell} />
                  </th>
                )}
              </For>
            </tr>
          </thead>
        )}
      </Show>
      <tbody>
        <For each={props.block.rows}>
          {(row) => (
            <tr>
              <For each={row.cells}>
                {(cell) => (
                  <td>
                    <InlineNodes nodes={cell} />
                  </td>
                )}
              </For>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}

function diagramSummary(block: DiagramBlock): string {
  switch (block.lang) {
    case 'tree':
    case 'mindmap': {
      let count = 0;
      const walk = (nodes: typeof block.roots): void => {
        for (const n of nodes) {
          count += 1;
          walk(n.children);
        }
      };
      walk(block.roots);
      return `${count} node${count === 1 ? '' : 's'}`;
    }
    case 'graph':
    case 'flowchart':
      return `${block.graph.edges.length} edge${
        block.graph.edges.length === 1 ? '' : 's'
      }`;
    case 'timeline':
      return `${block.entries.length} entr${
        block.entries.length === 1 ? 'y' : 'ies'
      }`;
  }
}

function ContainerPreview(props: { block: ContainerBlock }): JSX.Element {
  const label = (): string =>
    props.block.name === 'generic'
      ? (props.block.rawName ?? 'box')
      : props.block.name;
  const tint = (): string => String(props.block.attrs.color ?? '');
  return (
    <div
      class="nb-ins-container"
      data-name={props.block.name}
      data-color={tint()}
    >
      <span class="nb-ins-chip font-ui">
        {label()}
        <Show when={typeof props.block.attrs.variant === 'string'}>
          {' · '}
          {String(props.block.attrs.variant)}
        </Show>
      </span>
      <PreviewBlocks blocks={props.block.children} />
    </div>
  );
}

function PreviewBlock(props: { block: Block }): JSX.Element {
  const b = props.block;
  switch (b.kind) {
    case 'heading':
      return (
        <Dynamic component={`h${b.level}`}>
          <InlineNodes nodes={b.content} />
        </Dynamic>
      );
    case 'paragraph':
      return (
        <p>
          <InlineNodes nodes={b.content} />
        </p>
      );
    case 'quote':
      return (
        <blockquote>
          <InlineNodes nodes={b.content} />
        </blockquote>
      );
    case 'divider':
      return <hr />;
    case 'list':
      return <ListItems items={b.items} ordered={b.ordered} task={false} />;
    case 'taskList':
      return <ListItems items={b.items} ordered={false} task={true} />;
    case 'table':
      return <TablePreview block={b} />;
    case 'image':
      return (
        <figure class="nb-ins-image">
          <img src={b.src} alt={b.alt} loading="lazy" />
          <Show when={b.alt !== ''}>
            <figcaption class="font-ui">{b.alt}</figcaption>
          </Show>
        </figure>
      );
    case 'container':
      return <ContainerPreview block={b} />;
    case 'diagram':
      return (
        <div class="nb-ins-diagram">
          <span class="nb-ins-chip font-ui">{b.lang}</span>
          <span class="nb-ins-diagram-note font-ui">{diagramSummary(b)}</span>
        </div>
      );
    case 'fetchDirective':
      return (
        <div class="nb-ins-fetch font-ui">
          image search: <em>{b.query}</em>
        </div>
      );
  }
}

function PreviewBlocks(props: { blocks: Block[] }): JSX.Element {
  return <For each={props.blocks}>{(b) => <PreviewBlock block={b} />}</For>;
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export default function ScriptPreview(props: { doc: ScriptDoc }): JSX.Element {
  return (
    <div class="nb-ins-preview-doc">
      <Show when={props.doc.frontmatter.title}>
        <div class="nb-ins-fm font-ui">{props.doc.frontmatter.title}</div>
      </Show>
      <PreviewBlocks blocks={props.doc.blocks} />
    </div>
  );
}
