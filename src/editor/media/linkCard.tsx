/**
 * linkCard block — an atom node rendering a hand-drawn preview card for a
 * URL (docs/design/block-editor.md §3). Metadata is fetched by the Rust
 * `fetch_link_preview` command (OG scraping stays out of the webview); the
 * paste plugin inserts the card in `loading` state and patches attrs when
 * the preview arrives. On failure the card degrades to a plain link chip.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import { Show, type JSX } from 'solid-js';
import {
  NodeViewWrapper,
  SolidNodeViewRenderer,
  type SolidNodeViewProps,
} from '../solid';
import { isTauri } from '../../data/db';
import { hostOf } from './urlGuard';

export const LINK_CARD_STATUSES = ['loading', 'ready', 'plain'] as const;
export type LinkCardStatus = (typeof LINK_CARD_STATUSES)[number];

export interface LinkCardAttributes {
  url: string;
  title: string | null;
  description: string | null;
  imageDataUri: string | null;
  favicon: string | null;
  siteName: string | null;
  status: LinkCardStatus;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    linkCard: {
      /** Insert a link preview card for `url` (loading state by default). */
      insertLinkCard: (attrs: Partial<LinkCardAttributes> & { url: string }) => ReturnType;
    };
  }
}

/** Open a URL in the system browser (Tauri) or a new tab (dev). */
export function openExternal(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  if (isTauri()) {
    void import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url));
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function LinkCardView(props: SolidNodeViewProps): JSX.Element {
  const url = (): string => stringOrNull(props.node.attrs.url) ?? '';
  const status = (): LinkCardStatus => {
    const raw: unknown = props.node.attrs.status;
    return (LINK_CARD_STATUSES as readonly unknown[]).includes(raw)
      ? (raw as LinkCardStatus)
      : 'plain';
  };
  const title = (): string =>
    stringOrNull(props.node.attrs.title) ?? hostOf(url()) ?? url();
  const description = (): string | null =>
    stringOrNull(props.node.attrs.description);
  const image = (): string | null => stringOrNull(props.node.attrs.imageDataUri);
  const favicon = (): string | null => stringOrNull(props.node.attrs.favicon);
  const host = (): string => hostOf(url());

  return (
    <NodeViewWrapper
      class="nb-link-card"
      classList={{
        'is-selected': props.selected,
        'is-loading': status() === 'loading',
        'is-plain': status() === 'plain',
      }}
      data-status={status()}
    >
      <div
        class="nb-link-card-paper"
        role="link"
        aria-label={`Open ${title()} in browser`}
        onClick={() => openExternal(url())}
      >
        <div class="nb-link-card-body">
          <div class="nb-link-card-title-row">
            <Show when={favicon()}>
              {(src) => <img class="nb-link-card-favicon" src={src()} alt="" />}
            </Show>
            <span class="nb-link-card-title">
              {status() === 'loading' ? 'Fetching preview…' : title()}
            </span>
          </div>
          <Show when={status() === 'ready' && description()}>
            {(text) => <p class="nb-link-card-description">{text()}</p>}
          </Show>
          <span class="nb-link-card-host">{host() || url()}</span>
        </div>
        <Show when={status() === 'ready' && image()}>
          {(src) => (
            <span class="nb-link-card-polaroid">
              <img src={src()} alt="" draggable={false} />
            </span>
          )}
        </Show>
      </div>
      <button
        type="button"
        class="nb-media-remove"
        contenteditable={false}
        data-tooltip="Remove link card"
        aria-label="Remove link card"
        onClick={(event) => {
          event.stopPropagation();
          props.deleteNode();
        }}
      >
        ×
      </button>
    </NodeViewWrapper>
  );
}

export const LinkCard = Node.create({
  name: 'linkCard',

  group: 'block',

  atom: true,

  draggable: true,

  selectable: true,

  addAttributes() {
    const stringAttr = (dataName: string) => ({
      default: null as string | null,
      parseHTML: (element: HTMLElement) => element.getAttribute(dataName),
      renderHTML: (attributes: Record<string, unknown>) => {
        const value = attributes[
          dataName
            .replace(/^data-/, '')
            .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
        ];
        return typeof value === 'string' ? { [dataName]: value } : {};
      },
    });
    return {
      url: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-url') ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-url': String(attributes.url ?? ''),
        }),
      },
      title: stringAttr('data-title'),
      description: stringAttr('data-description'),
      imageDataUri: { default: null as string | null, rendered: false },
      favicon: { default: null as string | null, rendered: false },
      siteName: stringAttr('data-site-name'),
      status: {
        default: 'loading' satisfies LinkCardStatus,
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute('data-status');
          return (LINK_CARD_STATUSES as readonly string[]).includes(raw ?? '')
            ? raw
            : 'plain';
        },
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-status': String(attributes.status ?? 'plain'),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="link-card"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'link-card' })];
  },

  addCommands() {
    return {
      insertLinkCard:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return SolidNodeViewRenderer(LinkCardView);
  },
});
