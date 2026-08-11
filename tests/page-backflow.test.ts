import { describe, expect, it } from 'vitest';
import { appendBlocksToDoc } from '../src/views/spread';

const paragraph = (text = '') => ({
  type: 'paragraph',
  ...(text === '' ? {} : { content: [{ type: 'text', text }] }),
});

describe('backward page flow', () => {
  it('moves a following block before TipTap trailing-line bookkeeping', () => {
    expect(
      appendBlocksToDoc(
        {
          type: 'doc',
          attrs: { pageStyle: 'ruled' },
          content: [paragraph('previous'), paragraph()],
        },
        [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Next' }] }],
      ),
    ).toEqual({
      type: 'doc',
      attrs: { pageStyle: 'ruled' },
      content: [
        paragraph('previous'),
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Next' }] },
      ],
    });
  });

  it('replaces a truly blank previous page instead of leaving a gap', () => {
    expect(
      appendBlocksToDoc(
        { type: 'doc', content: [paragraph()] },
        [paragraph('pulled back')],
      ).content,
    ).toEqual([paragraph('pulled back')]);
  });

  it('preserves a complete image block while moving it between pages', () => {
    const image = {
      type: 'image',
      attrs: {
        src: 'asset://images/diagram.png',
        assetRelPath: 'images/diagram.png',
        alt: 'A labelled diagram',
        caption: 'The final tree',
        width: 74,
        align: 'right',
        style: 'polaroid',
      },
    };

    expect(
      appendBlocksToDoc(
        { type: 'doc', content: [paragraph('setup')] },
        [image],
      ).content,
    ).toEqual([paragraph('setup'), image]);
  });
});
