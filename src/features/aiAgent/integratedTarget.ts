import { Editor, type JSONContent } from '@tiptap/core';
import type { PageDoc } from '../../data/types';
import type { IntegratedNotebookInsertionTarget } from './reviewedReceipt';

/**
 * Apply a fragment to a disposable copy of its exact surrounding page.
 * This is the sole merge used for approval: BookView later installs the
 * resulting reviewed document verbatim and never repeats this operation.
 */
export async function buildIntegratedTargetDocument(input: {
  readonly targetDoc: PageDoc;
  readonly draftDoc: PageDoc;
  readonly target: IntegratedNotebookInsertionTarget;
}): Promise<PageDoc> {
  const { createEditorExtensions } = await import('../../editor/extensions');
  const editor = new Editor({
    extensions: createEditorExtensions(),
    content: input.targetDoc as JSONContent,
  });
  try {
    const max = editor.state.doc.content.size;
    const content = (input.draftDoc.content ?? []) as JSONContent[];
    if (input.target.kind === 'caret') {
      const position = Math.max(0, Math.min(input.target.position, max));
      if (content.length > 0) {
        editor.commands.insertContentAt(position, content, { updateSelection: false });
      }
    } else {
      const from = Math.max(0, Math.min(input.target.from, max));
      const to = Math.max(from, Math.min(input.target.to, max));
      if (content.length === 0) editor.commands.deleteRange({ from, to });
      else {
        editor.commands.insertContentAt({ from, to }, content, {
          updateSelection: false,
        });
      }
    }
    return editor.getJSON() as PageDoc;
  } finally {
    editor.destroy();
  }
}
