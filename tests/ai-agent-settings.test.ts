import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// `data/settings` asks the sound engine for its canonical vocabulary. The
// engine owns browser audio/Pixi at module load; this pure merge contract does
// not. Keep the authority shape while leaving the browser out of a Node test.
vi.mock('../src/sound/engine', () => ({
  SOUNDSCAPE_NAMES: [
    'rain',
    'storm',
    'fireplace',
    'crickets',
    'night',
    'wind',
    'stream',
    'forest',
    'shore',
    'cafe',
    'none',
  ],
}));
import { DEFAULT_SETTINGS } from '../src/data/defaults';
import { mergeSettings } from '../src/data/settings';

describe('AI Agent settings', () => {
  it('starts private, scoped, and skippable', () => {
    expect(DEFAULT_SETTINGS.aiAgentSetupSeen).toBe(false);
    expect(DEFAULT_SETTINGS.aiAgentKeyKind).toBe('trial');
    expect(DEFAULT_SETTINGS.aiAgentDefaultContext).toBe('current-page');
    expect(DEFAULT_SETTINGS.aiAgentObfuscatePrivateText).toBe(false);
  });

  it('retains valid preferences and rejects malformed stored values', () => {
    expect(
      mergeSettings({
        aiAgentSetupSeen: true,
        aiAgentKeyKind: 'production',
        aiAgentDefaultContext: 'whole-book',
        aiAgentObfuscatePrivateText: true,
      }),
    ).toMatchObject({
      aiAgentSetupSeen: true,
      aiAgentKeyKind: 'production',
      aiAgentDefaultContext: 'whole-book',
      aiAgentObfuscatePrivateText: true,
    });

    expect(
      mergeSettings({
        aiAgentSetupSeen: 'yes',
        aiAgentKeyKind: 'secret',
        aiAgentDefaultContext: 'entire-library',
        aiAgentObfuscatePrivateText: 'sometimes',
      }),
    ).toMatchObject({
      aiAgentSetupSeen: false,
      aiAgentKeyKind: 'trial',
      aiAgentDefaultContext: 'current-page',
      aiAgentObfuscatePrivateText: false,
    });
  });

  it('keeps the Settings control honest about scope and model tradeoffs', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/features/settings/SettingsPanel.tsx'),
      'utf8',
    );
    expect(source).toContain('mask private text');
    expect(source).toContain('Risk reduction, not anonymization.');
    expect(source).toContain('scanned PDF pages');
    expect(source).toContain('worse at comparing or calculating');
    expect(source).not.toContain('private visual review');
  });
});
