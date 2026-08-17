import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('AI credential browser boundary', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('tests and keeps a valid localhost key only in module memory', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ valid: true }),
    }));
    const credentials = await import('../src/data/aiCredentials');

    await expect(credentials.testAiCredential('trial_key_that_is_long_enough')).resolves.toEqual({ valid: true });
    expect(fetch).toHaveBeenCalledWith(
      'https://api.cohere.com/v1/check-api-key',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Client-Name': 'Alcove localhost',
        }),
      }),
    );
    await credentials.saveAiCredential('trial_key_that_is_long_enough', 'secure');
    expect(credentials.browserDevAiCredential()).toBe('trial_key_that_is_long_enough');
    expect(await credentials.aiCredentialStatus()).toMatchObject({
      configured: true,
      source: 'session',
      persistent: false,
    });
    await credentials.deleteAiCredential();
    expect(credentials.browserDevAiCredential()).toBeNull();
  });

  it('forgets the localhost key when the module reloads', async () => {
    vi.stubGlobal('window', {});
    const credentials = await import('../src/data/aiCredentials');
    await credentials.saveAiCredential('trial_key_that_is_long_enough', 'session');
    expect(credentials.browserDevAiCredential()).not.toBeNull();

    vi.resetModules();
    const reloaded = await import('../src/data/aiCredentials');
    expect(reloaded.browserDevAiCredential()).toBeNull();
  });

  it('rejects malformed keys before the protected IPC boundary', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    const { testAiCredential } = await import('../src/data/aiCredentials');

    await expect(testAiCredential('contains whitespace')).rejects.toThrow(
      'enter a valid Cohere API key',
    );
  });

  it('surfaces serialized native failures without exposing request data', async () => {
    const { aiCredentialErrorMessage } = await import('../src/data/aiCredentials');
    expect(
      aiCredentialErrorMessage(
        { code: 'network', message: 'Cohere rejected the request (HTTP 411)' },
        'fallback',
      ),
    ).toBe('Cohere rejected the request (HTTP 411)');
    expect(aiCredentialErrorMessage({ apiKey: 'must-not-surface' }, 'fallback')).toBe(
      'fallback',
    );
  });
});
