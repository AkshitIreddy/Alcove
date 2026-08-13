import { describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => {
  let resolveEmbed: ((value: unknown) => void) | null = null;
  return {
    calls: [] as Array<{ command: string; args: unknown }>,
    finishEmbed(value: unknown) { resolveEmbed?.(value); },
    invoke: vi.fn((command: string, args: unknown) => {
      native.calls.push({ command, args });
      if (command === 'ai_embed') {
        return new Promise((resolve) => { resolveEmbed = resolve; });
      }
      if (command === 'ai_cancel_run') {
        return Promise.resolve({ runId: 'embed-run', cancelled: true });
      }
      return Promise.reject(new Error(`unexpected command ${command}`));
    }),
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: native.invoke,
  Channel: class<T> { onmessage?: (value: T) => void; },
}));

import { embedAiTexts } from '../src/data/aiGateway';

describe('AI non-streaming gateway cancellation', () => {
  it('cancels the native run and rejects a late embed response after Stop', async () => {
    native.calls.length = 0;
    const controller = new AbortController();
    const pending = embedAiTexts({
      runId: 'embed-run',
      texts: ['private notebook evidence'],
      inputType: 'search_document',
    }, controller.signal);
    await Promise.resolve();
    controller.abort();
    await vi.waitFor(() => {
      expect(native.calls.some((call) => call.command === 'ai_cancel_run')).toBe(true);
    });
    native.finishEmbed({ id: 'late', embeddings: { float: [[1, 2]] } });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
