import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const rust = readFileSync(resolve(ROOT, 'src-tauri/src/ai.rs'), 'utf8');
const graph = readFileSync(resolve(ROOT, 'src/features/aiAgent/graph.ts'), 'utf8');

function section(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`missing source section: ${start}`);
  return source.slice(from, to);
}

describe('AI Agent chat retry ownership', () => {
  it('makes exactly one native HTTP attempt per graph-counted chat call', () => {
    const chatOpen = section(
      rust,
      'async fn open_chat_stream(',
      'async fn consume_chat_stream(',
    );
    expect(chatOpen).not.toContain('MAX_ATTEMPTS');
    expect(chatOpen).not.toContain('AiStreamEvent::Retry');
    expect(chatOpen).not.toMatch(/for\s+attempt\s+in/);
    expect(chatOpen.match(/\.send\(\)/g)).toHaveLength(1);

    const jsonRequest = section(
      rust,
      'async fn send_json_with_retry(',
      'async fn test_api_key(',
    );
    expect(jsonRequest).toContain('MAX_ATTEMPTS');
  });

  it('caps graph retries against the same reader-turn provider-call budget', () => {
    const invoke = section(
      graph,
      'async function invokeProviderWithRetry(',
      'export function createAlcoveAgentGraph(',
    );
    expect(invoke).toContain('providerCallsInBudgetWindow(state)');
    expect(invoke).toContain('usage.providerCalls >=');
    expect(invoke).toContain('ProviderCallBudgetExhaustedError');
  });
});
