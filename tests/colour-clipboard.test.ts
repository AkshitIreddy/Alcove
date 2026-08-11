import { describe, expect, it, vi } from 'vitest';
import {
  copyColour,
  pasteColour,
  type ColourTextClipboard,
} from '../src/views/rail/colourClipboard';

describe('studio colour clipboard', () => {
  it('rejects unrelated system clipboard text when no colour was copied', async () => {
    const clipboard: ColourTextClipboard = { readText: vi.fn(async () => 'not a colour') };
    expect(await pasteColour(clipboard)).toBeNull();
  });

  it('normalises a copied colour and mirrors it to the system clipboard', async () => {
    const writeText = vi.fn(async () => undefined);
    const clipboard: ColourTextClipboard = { writeText };

    expect(await copyColour(' #7D9 ', clipboard)).toBe('#77dd99');
    expect(writeText).toHaveBeenCalledWith('#77dd99');
  });

  it('accepts a hex copied from outside Alcove and makes it the internal fallback', async () => {
    const clipboard: ColourTextClipboard = { readText: vi.fn(async () => 'A1b2C3') };

    expect(await pasteColour(clipboard)).toBe('#a1b2c3');
    expect(await pasteColour(null)).toBe('#a1b2c3');
  });

  it('falls back internally when clipboard permission is denied', async () => {
    await copyColour('#204060', null);
    const clipboard: ColourTextClipboard = {
      readText: vi.fn(async () => {
        throw new Error('permission denied');
      }),
    };

    expect(await pasteColour(clipboard)).toBe('#204060');
  });

  it('does not replace the internal colour with invalid clipboard text', async () => {
    await copyColour('#336699', null);
    const clipboard: ColourTextClipboard = { readText: vi.fn(async () => 'hello') };

    expect(await pasteColour(clipboard)).toBe('#336699');
  });
});
