/**
 * Keep colour emoji clear of the handwritten rule beneath the words around them.
 *
 * Patrick Hand has no emoji glyphs, so Chromium falls through to the platform
 * colour font. That font's em box sits materially lower than Patrick Hand's:
 * the words ride the ruled line while an emoji appears to hang beneath it.
 * ProseMirror decorations give those Unicode runs one visual hook so CSS can
 * treat them as tiny floating illustrations, without adding a mark to the
 * stored document or changing script/export text.
 */
import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface EmojiTextRange {
  readonly from: number;
  readonly to: number;
}

/**
 * A complete visible emoji, including keycaps, flags, skin tones and ZWJ
 * sequences. Extended_Pictographic deliberately excludes ordinary symbols
 * such as © unless they opt into emoji presentation.
 */
const EMOJI_SEQUENCE =
  /(?:[#*0-9]\uFE0F?\u20E3|\p{Regional_Indicator}{2}|(?:\p{Emoji_Presentation}(?:\uFE0F|\uFE0E)?|\p{Extended_Pictographic}\uFE0F)(?:\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\p{Emoji_Modifier})?)*)/gu;

/** UTF-16 ranges, matching ProseMirror's text offsets. */
export function emojiTextRanges(text: string): readonly EmojiTextRange[] {
  return [...text.matchAll(EMOJI_SEQUENCE)].map((match) => ({
    from: match.index,
    to: match.index + match[0].length,
  }));
}

function emojiDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, position) => {
    if (!node.isText || node.text === undefined) return;
    for (const range of emojiTextRanges(node.text)) {
      decorations.push(
        Decoration.inline(
          position + range.from,
          position + range.to,
          { class: 'nb-inline-emoji' },
          { inclusiveStart: false, inclusiveEnd: false },
        ),
      );
    }
  });
  return decorations.length === 0
    ? DecorationSet.empty
    : DecorationSet.create(doc, decorations);
}

const emojiBaselineKey = new PluginKey<DecorationSet>('nbEmojiBaseline');

export const EmojiBaseline = Extension.create({
  name: 'emojiBaseline',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: emojiBaselineKey,
        state: {
          init: (_, state) => emojiDecorations(state.doc),
          apply: (transaction, previous) =>
            transaction.docChanged
              ? emojiDecorations(transaction.doc)
              : previous,
        },
        props: {
          decorations: (state) =>
            emojiBaselineKey.getState(state) ?? DecorationSet.empty,
        },
      }),
    ];
  },
});
