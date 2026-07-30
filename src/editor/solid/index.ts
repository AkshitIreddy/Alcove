/**
 * Vendored SolidJS bindings for TipTap v3 (based on @vrite/tiptap-solid, MIT).
 * Kept in-repo per docs/design/block-editor.md §1 so upgrades are controlled.
 */
export { createTiptapEditor } from './createTiptapEditor';
export { createEditorTransaction } from './createEditorTransaction';
export {
  NodeViewContent,
  NodeViewWrapper,
  SolidNodeViewRenderer,
  type SolidNodeViewProps,
} from './SolidNodeViewRenderer';
