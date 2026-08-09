import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UPDATE_NOTES,
  parseUpdateNoteInline,
  parseUpdateNotes,
  type UpdateNoteBlock,
} from '../src/features/system/updateNotes';

const RELEASE = `<div align="center">

<img src="https://example.com/alcove.png" width="96" alt="">

# Alcove v0.5.1

**Built like a storybook library.**

</div>

## What changed

1 improvement and 4 fixes since v0.5.0.

### What's new
- **sound** — Pause ambience while hidden in tray

### Fixed
- **flip** — Let corner curls leave the book
- **navigation** — Keep same-book page links in reader

_Plus 2 maintenance changes._

📖 **[The full changelog](https://github.com/AkshitIreddy/Alcove/blob/main/docs/readme/releases.md)**

---

## Which file do I want?

| You are on | Take this |
| --- | --- |
| Windows | setup.exe |
`;

function textOf(blocks: readonly UpdateNoteBlock[]): string {
  return blocks
    .flatMap((block) =>
      block.kind === 'list'
        ? block.items.flatMap((item) => item.map((part) => part.text))
        : block.content.map((part) => part.text),
    )
    .join(' ');
}

describe('update release notes', () => {
  it('renders the change summary without GitHub-only HTML or download copy', () => {
    const blocks = parseUpdateNotes(RELEASE);
    const text = textOf(blocks);

    expect(blocks.map((block) => block.kind)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'list',
      'heading',
      'list',
      'paragraph',
      'paragraph',
    ]);
    expect(text).toContain('What changed');
    expect(text).toContain('Pause ambience while hidden in tray');
    expect(text).toContain('Keep same-book page links in reader');
    expect(text).not.toContain('<div');
    expect(text).not.toContain('<img');
    expect(text).not.toContain('Which file do I want');
    expect(text).not.toContain('setup.exe');
    expect(text).not.toContain('[The full changelog]');
    expect(
      blocks.some(
        (block) =>
          block.kind === 'paragraph' &&
          block.content.some((part) => part.kind === 'link' && part.strong === true),
      ),
    ).toBe(true);
  });

  it('keeps formatting as typed nodes and accepts only web links', () => {
    const parts = parseUpdateNoteInline(
      '**sound** and _quiet_ with `code`, [safe](https://example.com), [unsafe](javascript:alert(1))',
    );

    expect(parts.map((part) => part.kind)).toEqual([
      'strong',
      'text',
      'em',
      'text',
      'code',
      'text',
      'link',
      'text',
      'text',
      'text',
    ]);
    expect(parts.some((part) => part.kind === 'link' && part.href.startsWith('javascript:'))).toBe(false);
  });

  it('falls back to friendly copy when a feed has no notes', () => {
    expect(textOf(parseUpdateNotes(undefined))).toBe(DEFAULT_UPDATE_NOTES);
    expect(textOf(parseUpdateNotes(' <script>alert(1)</script> '))).toBe(DEFAULT_UPDATE_NOTES);
  });

  it('also trims download instructions from a custom release body', () => {
    const text = textOf(parseUpdateNotes(`# Alcove v0.6.0

Small but lovely.

## Which file do I want?

Do not show this in the app.`));

    expect(text).toBe('Small but lovely.');
  });
});
