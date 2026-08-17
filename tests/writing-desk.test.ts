import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/sound/engine', () => ({
  SOUNDSCAPE_NAMES: [
    'rain', 'storm', 'fireplace', 'crickets', 'night', 'wind',
    'stream', 'forest', 'shore', 'cafe', 'none',
  ],
}));

import { DEFAULT_SETTINGS } from '../src/data/defaults';
import { mergeSettings } from '../src/data/settings';
import {
  DEFAULT_WRITING_DESK_ID,
  WRITING_DESKS,
  WRITING_DESK_FAMILIES,
  WRITING_DESK_SHORTLIST,
  writingDeskColor,
} from '../src/features/settings/writingDesk';
import {
  TASTE_AXES,
  TASTE_QUESTIONS,
  isTasteComplete,
  resolveTaste,
} from '../src/features/tutorial/tasteProfile';

describe('writing desk appearance', () => {
  it('persists only authored flat colours and falls back safely', () => {
    expect(DEFAULT_SETTINGS.writingDeskColor).toBe(DEFAULT_WRITING_DESK_ID);
    expect(mergeSettings({ writingDeskColor: 'mint' }).writingDeskColor).toBe('mint');
    expect(mergeSettings({ writingDeskColor: '#bad-css' }).writingDeskColor).toBe(
      DEFAULT_WRITING_DESK_ID,
    );
    expect(new Set(WRITING_DESKS.map((desk) => desk.color)).size).toBe(
      WRITING_DESKS.length,
    );
    expect(WRITING_DESKS).toHaveLength(25);
    expect(WRITING_DESK_SHORTLIST.map((desk) => desk.id)).toEqual([
      'linen',
      'blush',
      'coral',
      'rose',
      'mint',
      'sky',
      'buttercup',
      'teal',
    ]);
    expect(new Set(WRITING_DESKS.map((desk) => desk.id)).size).toBe(25);
    expect(new Set(WRITING_DESKS.map((desk) => desk.family))).toEqual(
      new Set(WRITING_DESK_FAMILIES),
    );
    const relativeLuminance = (hex: string): number => {
      const channels = hex
        .slice(1)
        .match(/../g)!
        .map((pair) => Number.parseInt(pair, 16) / 255)
        .map((channel) =>
          channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4,
        );
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    expect(WRITING_DESKS.every((desk) => relativeLuminance(desk.color) >= 0.48)).toBe(
      true,
    );
    expect(WRITING_DESKS.every((desk) => desk.tone === 'light')).toBe(true);
    expect(writingDeskColor('clay')).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('asks for the desk during onboarding and applies the chosen answer', () => {
    expect(TASTE_AXES).toEqual(['room', 'pitch', 'palette', 'paper', 'desk', 'sound']);
    expect(TASTE_QUESTIONS.find((question) => question.axis === 'desk')).toMatchObject({
      shape: 'desks',
      options: expect.arrayContaining([
        expect.objectContaining({ id: 'linen' }),
        expect.objectContaining({ id: 'cranberry' }),
      ]),
    });
    const answers = {
      room: 'bare-desk',
      pitch: 'warm',
      paper: 'bare',
      desk: 'sky',
      sound: 'paper',
    } as const;
    expect(isTasteComplete(answers)).toBe(true);
    expect(resolveTaste(answers).writingDesk).toBe('sky');
  });
});
