import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNotebookScriptPages } from '../src/editor/script/pageBoundaries';

const ROOT = resolve(import.meta.dirname, '..');
const sourcePath = resolve(ROOT, 'shots-now/fixtures/ai-agent-study-notes.md');
const provenancePath = resolve(
  ROOT,
  'shots-now/fixtures/ai-agent-study-notes.provenance.json',
);
const bridgePath = resolve(ROOT, 'src/views/rail/aiAgentDemoBridge.ts');
const bookViewPath = resolve(ROOT, 'src/views/BookView.tsx');
const demoPath = resolve(ROOT, 'shots-now/demo-gif.mjs');

describe('AI Agent documentation fixture', () => {
  it('uses the real product opening and an honest pointer-driven Review interaction', () => {
    const film = readFileSync(resolve(ROOT, 'shots-now/demo-gif.mjs'), 'utf8');

    expect(film).not.toContain('stageRealBookHandoff');
    expect(film).not.toContain('revealRealBookHandoff');
    expect(film).not.toContain('__demo-book-handoff');
    expect(film).toContain("t.click('.nb-ai-preview-stage', { via: 'cursor'");
    expect(film).toContain('show the next reviewed page');
  });

  it('is a clean, intentional three-page Notebook Script planned around the supplied 3:2 image', () => {
    const source = readFileSync(sourcePath, 'utf8');
    const parsed = parseNotebookScriptPages(source);

    expect(parsed.pages).toHaveLength(3);
    expect(parsed.preview.diagnostics).toEqual([]);
    expect((source.match(/placeholder="/g) ?? [])).toHaveLength(0);
    expect(source).toContain('__HUFFMAN_KITTENS_BLOB_URL__');
    expect(source).toContain('Huffman Coding with Kittens');
    expect(source).not.toContain('fetch:');
    expect(source).not.toContain('::fetch');
  });

  it('records that playback is frozen Cohere-authored demo data, not a live provider run', () => {
    const provenance = JSON.parse(readFileSync(provenancePath, 'utf8')) as {
      kind?: string;
      provider?: string;
      model?: string;
      review?: string[];
    };

    expect(provenance).toMatchObject({
      kind: 'deterministic-demo-fixture',
      provider: 'Cohere',
      model: 'command-a-plus-05-2026',
    });
    expect(provenance.review?.join(' ')).toContain('playback never calls a provider');
  });

  it('keeps the force-only bridge bounded, reversible and smaller than the product controller', () => {
    const bridge = readFileSync(bridgePath, 'utf8');
    const bookView = readFileSync(bookViewPath, 'utf8');
    const demo = readFileSync(demoPath, 'utf8');
    const publicContract = bridge.match(
      /export interface AiAgentDemoPublicBridge \{([\s\S]*?)\n\}/,
    )?.[1] ?? '';

    expect(publicContract.match(/^\s{2}[a-z]+\(/gm)).toEqual([
      '  state(',
      '  open(',
      '  advance(',
      '  reset(',
    ]);
    expect(bridge).toContain(
      "new URLSearchParams(window.location.search).get('fx') === 'force'",
    );
    expect(bookView).toContain(
      "new URLSearchParams(window.location.search).get('fx') !== 'force'",
    );
    expect(bridge).toContain('await prior.disposeAll()');
    expect(bridge).toContain('prior.releaseUrls()');
    expect(bridge).toContain('generation.pageCount !== 3');
    expect(bridge).toContain('generation.pages.length !== 3');
    expect(bridge).toContain('insertReviewedPages(hydratedStudyNotesScript)');
    expect(bridge).toContain('const restored = await options.restoreInsertedPages()');
    expect(bridge).toContain('if (!restored)');
    expect(bookView).toContain("if ('__TAURI_INTERNALS__' in window)");
    expect(bookView).toContain('const anchor = activePage()');
    expect(bookView).toContain('await insertPagesAfter(anchor.id, additions)');
    expect(bookView).toContain('actualRun.join');
    expect(bookView).toContain('exact three reviewed pages');
    expect(bookView).toContain('restoreInsertedPages: async () =>');
    expect(bookView).toContain('const restored = await restoreScriptInsertion(true)');
    expect(bridge).toContain("? { id, kind: 'message', role, text, citations: [CITATION] }");
    expect(bridge).not.toMatch(/SqliteAgentPersistence|CohereTauriAgentProvider|applyApprovedAiProposal/);
    expect(bridge).toContain("imageGenerationPrompts: []");
    expect(bridge).not.toContain('demo-image-prompt-');
    expect(bridge).toContain("kind: 'image' as const");
    expect(demo).toContain("const DEMO_STAGING = `${QA_DIR}/demo.next.webp`");
    expect(demo).toContain('function promoteDemoPair()');
    expect(demo).toContain('promoteDemoPair();');
    expect(demo).toContain('Try the reviewer-held MP4 first');
    expect(demo).toContain("writeQaStill(page, 'ai-agent-thinking-answer')");
    expect(demo).toContain("writeQaStill(page, 'ai-agent-thinking-pages')");
    expect(demo).toContain("writeQaStill(page, 'ai-agent-full-preview')");
    expect(demo).toContain("writeQaStill(page, 'ai-agent-pages-settling')");
    expect(demo).toContain("turn('Read, Check, Decode', 16)");
    expect(demo).toContain("jumpWithThumbnail('Your first five minutes', 0");
    expect(demo).toContain("writeQaStill(page, 'welcome-writing-page')");
    expect(demo).not.toContain('placeCaretInInsertedPage');
    expect(demo).not.toContain("writeQaStill(page, 'ai-agent-written-page')");
    expect(demo).toContain("writeQaStill(page, 'ai-agent-restored')");
  });
});
