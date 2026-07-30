/**
 * The editor's extension set — docs/design/block-editor.md §2, everything
 * installed in package.json (Mathematics/TableOfContents are not installed,
 * so they are not listed).
 *
 * `createEditorExtensions()` builds the full schema; UI-coupled extensions
 * (drag handle, slash menu, placeholder) are opt-in so pure-logic tests can
 * derive the storage schema with `getSchema()` in a Node environment.
 */
import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { DragHandle, type DragHandleOptions } from '@tiptap/extension-drag-handle';
import Highlight from '@tiptap/extension-highlight';
import NodeRange from '@tiptap/extension-node-range';
import Placeholder from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { TextStyleKit } from '@tiptap/extension-text-style';
import UniqueID from '@tiptap/extension-unique-id';
import { offset } from '@floating-ui/dom';
import { common, createLowlight } from 'lowlight';
import { nanoid } from 'nanoid';
import { NotebookDocument } from './document';
import { MediaImage } from './media';
import { customNodeExtensions } from './nodes';
import { SlashCommands } from './slash/extension';

/** Block-level types that carry a stable UniqueID `id` attribute. */
export const BLOCK_ID_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'codeBlock',
  'horizontalRule',
  'table',
  'details',
  'callout',
  'imageRow',
  'sticky-note',
  'polaroid',
  'washi-box',
  'card',
  'quote-card',
  'banner',
  'spoiler',
  'columns',
  'col',
] as const;

export interface EditorExtensionsOptions {
  /**
   * Interactive chrome: drag handle, slash menu, placeholder. Off for
   * schema-only use (tests, script round-tripping).
   */
  interactive?: boolean;
  /** Placeholder text for empty blocks. */
  placeholder?: string;
  /** Drag handle config (element factory + callbacks), required if interactive. */
  dragHandle?: Pick<
    DragHandleOptions,
    'render' | 'onNodeChange' | 'onElementDragStart' | 'onElementDragEnd'
  >;
}

export function createEditorExtensions(
  options: EditorExtensionsOptions = {},
): AnyExtension[] {
  const lowlight = createLowlight(common);

  const extensions: AnyExtension[] = [
    NotebookDocument,

    StarterKit.configure({
      // Our Document carries pageStyle/lineHeightPx.
      document: false,
      // Lowlight variant below replaces the plain code block.
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4] },
      link: {
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
      },
      dropcursor: {
        color: 'var(--wash-amber)',
        width: 3,
      },
    }),

    UniqueID.configure({
      attributeName: 'id',
      types: [...BLOCK_ID_TYPES],
      generateID: () => `b_${nanoid(10)}`,
    }),

    Details.configure({ persist: true }),
    DetailsSummary,
    DetailsContent,

    TableKit.configure({
      table: { resizable: true, lastColumnResizable: false },
    }),

    TaskList,
    TaskItem.configure({ nested: true }),

    // TextStyleKit bundles TextStyle + Color/FontFamily/FontSize/LineHeight…
    TextStyleKit,
    Highlight.configure({ multicolor: true }),

    MediaImage.configure({ allowBase64: true }),

    CodeBlockLowlight.configure({
      lowlight,
      defaultLanguage: null,
    }),

    NodeRange.configure({ key: null }),

    ...customNodeExtensions(),
  ];

  if (options.interactive ?? false) {
    extensions.push(
      Placeholder.configure({
        placeholder: options.placeholder ?? 'Type / for commands…',
        includeChildren: true,
      }),
      SlashCommands,
    );
    if (options.dragHandle) {
      extensions.push(
        DragHandle.configure({
          ...options.dragHandle,
          computePositionConfig: {
            placement: 'left-start',
            middleware: [offset(10)],
          },
        }),
      );
    }
  }

  return extensions;
}
