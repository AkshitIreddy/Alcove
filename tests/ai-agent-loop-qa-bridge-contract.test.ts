import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const bridge = readFileSync(
  resolve(ROOT, 'src/views/rail/aiAgentLoopQaBridge.ts'),
  'utf8',
);
const bookView = readFileSync(resolve(ROOT, 'src/views/BookView.tsx'), 'utf8');

function quotedValues(source: string): string[] {
  return [...source.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
}

function sourceSection(source: string, start: string, end: string): string {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  expect(startAt, `missing section start: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endAt, `missing section end: ${end}`).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt);
}

describe('force-only Agent loop QA bridge contract', () => {
  it('requires development mode, a browser without Tauri, and the exact QA route in both layers', () => {
    const routeGuard = sourceSection(
      bridge,
      'function assertQaRoute(): void',
      'function argsForTool(',
    );
    const loopMount = sourceSection(
      bookView,
      'Provider-free browser regression for the REAL AgentRuntime/graph/panel',
      "console.error('[ai-agent-loop-qa] bridge unavailable'",
    );

    for (const layer of [routeGuard, loopMount]) {
      expect(layer).toContain('import.meta.env.DEV');
      expect(layer).toContain("'__TAURI_INTERNALS__' in window");
      expect(layer).toContain("query.get('fx') !== 'force'");
      expect(layer).toContain("query.get('qa') !== 'agent-loop'");
    }
    expect(bookView).toContain("import('./rail/aiAgentLoopQaBridge')");
  });

  it('suppresses the documentation demo on the Agent loop route and preserves controller precedence', () => {
    const demoMount = sourceSection(
      bookView,
      'README/demo automation gets the real Agent panel and native page renderer',
      "void import('./rail/aiAgentDemoBridge')",
    );

    expect(demoMount).toContain("query.get('fx') !== 'force'");
    expect(demoMount).toMatch(
      /query\.get\('qa'\)\s*===\s*'agent-loop'/,
    );
    expect(bookView).toMatch(
      /controller=\{\s*aiApplyQaPanelController\(\)\s*\?\?\s*aiLoopQaPanelController\(\)\s*\?\?\s*aiDemoPanelController\(\)\s*\?\?\s*aiPanelController\(\)\s*\}/,
    );
  });

  it('uses only the provider-free in-memory runtime and exposes no mutation seam', () => {
    expect(bridge).toContain('class DeterministicLoopQaProvider implements AgentProvider');
    expect(bridge).toContain('new InMemoryAgentPersistence()');
    expect(bridge).toContain('createProductionNotebookReadAdapter()');
    expect(bridge).toContain('createProductionDraftSandbox()');
    expect(bridge).toContain("readonly id = 'alcove-agent-loop-qa'");
    expect(bridge).toContain(
      "throw new Error('The Agent loop QA bridge never applies notebook pages.')",
    );

    expect(bridge).not.toMatch(
      /CohereTauriAgentProvider|SqliteAgentPersistence|installAiAgentController|applyApprovedAiProposal/,
    );
    expect(bridge).not.toMatch(
      /from ['"](?:\.\.\/)*data\/(?:pages|books|aiAgentApply)['"]/,
    );
    expect(bridge).not.toMatch(
      /\b(?:insertPagesAfter|insertPageAfter|insertPageBefore|createPage|savePageDoc|setPageScript|deletePage)\s*\(/,
    );
    expect(bridge).not.toMatch(/\b(?:fetch|invoke)\s*\(/);

    const options = bridge.match(
      /export interface AiAgentLoopQaBridgeOptions \{([\s\S]*?)\n\}/,
    )?.[1] ?? '';
    expect(
      [...options.matchAll(/readonly\s+([A-Za-z][A-Za-z0-9]*)\s*:/g)]
        .map((match) => match[1]),
    ).toEqual([
      'bookId',
      'bookTitle',
      'defaultInsertionTarget',
      'openPanel',
    ]);
    expect(options).not.toMatch(/applyApproved|onApproved|write|save|delete/i);
  });

  it('pins the six scenarios and the deterministic tool-order contract', () => {
    const scenarioType = bridge.match(
      /export type AiAgentLoopQaScenario\s*=([\s\S]*?);/,
    )?.[1] ?? '';
    expect(quotedValues(scenarioType)).toEqual([
      'healthy-targetless',
      'healthy-production-default',
      'conversation-envelope-recovery',
      'provider-invalid-retry',
      'invalid-repeat',
      'preserve-all',
    ]);

    const priority = bridge.match(
      /const TOOL_PRIORITY = \[([\s\S]*?)\] as const;/,
    )?.[1] ?? '';
    expect(quotedValues(priority)).toEqual([
      'list_source_manifest',
      'read_full_source',
      'inspect_notebook',
      'propose_insertion',
      'submit_notebook_script',
      'validate_notebook_script',
      'render_draft_preview',
      'read_draft_preview_pages',
      'record_visual_review',
      'propose_notebook_patch',
      'submit_notebook_patch',
    ]);

    const healthyTargetless = [
      'inspect_notebook',
      'propose_insertion',
      'submit_notebook_script',
      'validate_notebook_script',
      'render_draft_preview',
      'read_draft_preview_pages',
      'record_visual_review',
      'propose_notebook_patch',
      'submit_notebook_patch',
    ];
    const healthyProductionDefault = healthyTargetless.filter(
      (tool) => tool !== 'propose_insertion',
    );
    const preserveAll = ['read_full_source', ...healthyTargetless];
    const priorityTools = quotedValues(priority);
    const isOrderedSubsequence = (expected: readonly string[]) => {
      let cursor = -1;
      return expected.every((tool) => {
        cursor = priorityTools.indexOf(tool, cursor + 1);
        return cursor >= 0;
      });
    };

    expect(healthyTargetless).toHaveLength(9);
    expect(healthyProductionDefault).toHaveLength(8);
    expect(preserveAll).toHaveLength(10);
    expect(isOrderedSubsequence(healthyTargetless)).toBe(true);
    expect(isOrderedSubsequence(healthyProductionDefault)).toBe(true);
    expect(isOrderedSubsequence(preserveAll)).toBe(true);
    expect(bridge).toContain("scenario === 'invalid-repeat'");
    expect(bridge).toContain("scenario === 'preserve-all'");
    expect(bridge).toContain("scenario === 'healthy-production-default'");
    expect(bridge).toContain("scenario === 'conversation-envelope-recovery'");
    expect(bridge).toContain("scenario === 'provider-invalid-retry'");
  });

  it('pins one bounded plain-prose recovery for a rejected conversation envelope', () => {
    const provider = sourceSection(
      bridge,
      'class DeterministicLoopQaProvider implements AgentProvider',
      'export interface AiAgentLoopQaState',
    );

    expect(provider).toContain("boundary === 'conversation_tool_envelope'");
    expect(provider).toContain(": 'plain_conversation';");
    expect(provider).toContain("type: 'public_text_delta'");
    expect(provider).toContain("type: 'finish', reason: 'stop'");
    expect(provider).toContain('this.sabotageConversationRecovery');
  });

  it('injects invalid provider responses at deterministic validation and preview reading only once', () => {
    const provider = sourceSection(
      bridge,
      'class DeterministicLoopQaProvider implements AgentProvider',
      'export interface AiAgentLoopQaState',
    );

    expect(provider).toContain("selected === 'validate_notebook_script'");
    expect(provider).toContain("selected === 'read_draft_preview_pages'");
    expect(provider).toContain('!this.invalidResponseTools.includes(selected)');
    expect(provider).toContain("code: 'invalid_response'");
    const previewInvalidBlock = provider.slice(
      provider.indexOf('this.attemptedTools.push(selected)'),
    );
    expect(previewInvalidBlock.indexOf('this.attemptedTools.push(selected)')).toBeLessThan(
      previewInvalidBlock.indexOf("code: 'invalid_response'"),
    );
    expect(previewInvalidBlock.indexOf("code: 'invalid_response'")).toBeLessThan(
      previewInvalidBlock.indexOf('this.selectedTools.push(selected)'),
    );
  });
});
