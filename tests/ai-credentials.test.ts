import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('AI credential browser boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('never misreports an untested localhost key as rejected by Cohere', async () => {
    vi.stubGlobal('window', {});
    const { testAiCredential } = await import('../src/data/aiCredentials');

    await expect(testAiCredential('trial_key_that_is_long_enough')).rejects.toThrow(
      'Cohere keys can only be tested in the Alcove desktop app',
    );
  });

  it('rejects malformed keys before the protected IPC boundary', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    const { testAiCredential } = await import('../src/data/aiCredentials');

    await expect(testAiCredential('contains whitespace')).rejects.toThrow(
      'enter a valid Cohere API key',
    );
  });
});
