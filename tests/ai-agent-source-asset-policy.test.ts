import { describe, expect, it } from 'vitest';
import {
  createInitialAgentState,
  applyDominantManagedImageLayout,
  applyVagueManagedImageDefault,
  ensureRequiredManagedImagesInNotebookScript,
  missingRequiredManagedImageAssetPaths,
  notebookScriptManagedImageAssetPaths,
  requiredManagedImageAssetPaths,
  type AgentState,
} from '../src/features/aiAgent';

const NOW = '2026-08-18T08:00:00.000Z';
const ATTACHMENT_ALIAS = `att_${'a'.repeat(64)}`;
const PATH = `ai/attachments/${ATTACHMENT_ALIAS}.png`;

function imageReadState(goal = 'add this to my book'): AgentState {
  const initial = createInitialAgentState({
    identity: {
      taskId: 'task-source-asset',
      threadId: 'thread-source-asset',
      runId: 'run-source-asset',
      bookId: 'book-source-asset',
    },
    goal,
    now: NOW,
    userMessageId: 'reader-source-asset',
  });
  return {
    ...initial,
    sourceIntentTurnId: 'reader-source-asset',
    sourceManifest: {
      version: 1,
      createdAt: NOW,
      digest: 'manifest-source-asset',
      totalEstimatedTokens: 20,
      sources: [{
        id: 'reader-picture',
        title: 'Reader picture.png',
        kind: 'image',
        digest: 'reader-picture-digest',
        mediaType: 'image/png',
        estimatedTokens: 20,
        quarantined: true,
        promptInjectionWarnings: [],
        units: [{
          id: 'reader-picture-unit',
          label: 'Reader picture',
          ordinal: 0,
          digest: 'reader-picture-unit-digest',
          estimatedTokens: 20,
          characters: 0,
          hasText: false,
          hasVisual: true,
          visualEvidence: 'available',
          anchor: { sourceId: 'reader-picture', unitId: 'reader-picture-unit' },
        }],
      }],
    },
    modelHistory: [
      ...initial.modelHistory,
      {
        id: 'reader-picture-read',
        role: 'tool',
        toolCallId: 'read-picture-call',
        toolName: 'read_full_source',
        content: {
          sourceId: 'reader-picture',
          sourceDigest: 'reader-picture-digest',
          units: [{
            unitId: 'reader-picture-unit',
            anchor: { sourceId: 'reader-picture', unitId: 'reader-picture-unit' },
            text: '[Image source: Reader picture.png]',
            digest: 'reader-picture-unit-digest',
          }],
          truncated: false,
          visualRefs: [{
            anchor: { sourceId: 'reader-picture', unitId: 'reader-picture-unit' },
            label: 'Reader picture',
            portableAssetPath: PATH,
            image: {
              resourceId: 'reader-picture',
              mimeType: 'image/png',
              digest: 'reader-picture-digest',
              width: 1024,
              height: 1536,
            },
          }],
        },
        isError: false,
        createdAt: NOW,
      },
    ],
  };
}

describe('reader-supplied image preservation', () => {
  it('requires the exact observed managed path on a real parsed image block', () => {
    const state = imageReadState();
    expect(requiredManagedImageAssetPaths(state)).toEqual([PATH]);
    expect(notebookScriptManagedImageAssetPaths(
      `# Picture\n\n![reader picture](){asset="${PATH}", width=48}`,
    )).toEqual([PATH]);
    expect(missingRequiredManagedImageAssetPaths(
      state,
      `# Picture\n\n![reader picture](){asset="${PATH}", width=48}`,
    )).toEqual([]);
  });

  it('does not accept a placeholder, receipt note or code-fence mention as the image', () => {
    const state = imageReadState();
    for (const script of [
      '# Draft receipt\n\nThe image was reviewed and will be inserted later.',
      '# Picture\n\n![reader picture](){placeholder="add the attached picture"}',
      `# Path only\n\n\`\`\`text\nasset="${PATH}"\n\`\`\``,
    ]) {
      expect(missingRequiredManagedImageAssetPaths(state, script)).toEqual([PATH]);
    }
  });

  it('canonically inserts the required portrait image after the opening heading', () => {
    const state = imageReadState();
    const repaired = ensureRequiredManagedImagesInNotebookScript(
      state,
      '# Week 6\n\nA short note.',
    );
    expect(repaired.insertedPaths).toEqual([PATH]);
    expect(repaired.script).toContain(
      `# Week 6\n\n![Reader picture](){asset="${PATH}", width=48, align=center, style=polaroid, caption="Reader picture"}`,
    );
    expect(missingRequiredManagedImageAssetPaths(state, repaired.script)).toEqual([]);
  });

  it('converts a managed path miswritten as a Markdown URL without duplicating it', () => {
    const state = imageReadState();
    const repaired = ensureRequiredManagedImagesInNotebookScript(
      state,
      `# Week 6\n\n![diagram](${PATH})`,
    );
    expect(repaired.insertedPaths).toEqual([PATH]);
    expect(repaired.script).toContain(
      `![diagram](){asset="${PATH}", width=48, align=center, style=polaroid, caption="diagram"}`,
    );
    expect(repaired.script).not.toContain(`](${PATH})`);
    expect(repaired.script.match(new RegExp(PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')))
      .toHaveLength(1);
  });

  it('canonicalizes an observed raw attachment-id alias and removes duplicates', () => {
    const state = imageReadState();
    const repaired = ensureRequiredManagedImagesInNotebookScript(
      state,
      [
        '# Week 6',
        '',
        `![model alias](/${ATTACHMENT_ALIAS})`,
        '',
        `![already managed](){asset="${PATH}", width=48}`,
      ].join('\n'),
    );
    expect(repaired.script).toContain(`asset="${PATH}"`);
    expect(repaired.script).not.toContain(`](/${ATTACHMENT_ALIAS})`);
    expect(repaired.script.match(new RegExp(PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')))
      .toHaveLength(1);
  });

  it('recovers managed image attributes mistakenly written inside URL parentheses', () => {
    const state = imageReadState(
      'Let the attached picture take up the full page in my book.',
    );
    const repaired = ensureRequiredManagedImagesInNotebookScript(
      state,
      `# Week 6\n\n![diagram](asset="${PATH}", width=1024, align=center, caption="Box packing")`,
    );
    expect(repaired.script).toContain(
      `![diagram](){asset="${PATH}", width=72, align=center, style=polaroid, caption="diagram"}`,
    );
    expect(repaired.script).not.toContain('](asset=');
  });

  it('honours an explicit full-page request with a dominant uncropped portrait width', () => {
    const state = imageReadState(
      'Put the picture on its own page and let it take up the space fully.',
    );
    const repaired = ensureRequiredManagedImagesInNotebookScript(
      state,
      `# Week 6\n\n![diagram](){asset="${PATH}", width=48, align=center}`,
    );
    expect(repaired.script).toContain(
      `![diagram](){asset="${PATH}", width=72, align=center}`,
    );
    expect(repaired.script.match(new RegExp(PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')))
      .toHaveLength(1);
  });

  it('normalizes a dominant image into one image page and one non-empty notes page', () => {
    const state = imageReadState(
      'Put the picture on its own full page and add only a little write-up on other pages.',
    );
    const repaired = ensureRequiredManagedImagesInNotebookScript(
      state,
      [
        '---',
        'paper: grid',
        '---',
        '',
        '# Week 6 — Box packing {sticker=box}',
        '',
        `![diagram](){asset="${PATH}", width=48, align=center}`,
        '',
        '::page',
        '',
        '## Short notes',
        '',
        '- Pick boxes without exceeding capacity.',
        '',
        '::page',
      ].join('\n'),
    );
    const normalized = applyDominantManagedImageLayout(state, repaired.script);
    expect(normalized.relaidOut).toBe(true);
    expect(normalized.script).toContain(
      `# Week 6 — Box packing\n\n![diagram](){asset="${PATH}", width=72, align=center}`,
    );
    expect(normalized.script.match(/^::page$/gmu)).toHaveLength(1);
    expect(normalized.script).toContain('::page\n\n## Short notes');
    expect(normalized.script.trimEnd()).toMatch(/exceeding capacity\.$/u);
  });

  it('compacts an over-expanded vague image request to one image-led page', () => {
    const state = imageReadState();
    const expanded = [
      '# Box Packing Problem',
      '',
      `![Reader picture](){asset="${PATH}", width=48}`,
      '',
      'Imagine each kitten as a box with three measurements.',
      ...Array.from({ length: 30 }, (_, index) =>
        `## Detailed section ${index + 1}\n\n| A | B |\n| --- | --- |\n| ${index} | ${index + 1} |`),
    ].join('\n\n');
    const compacted = applyVagueManagedImageDefault(state, expanded);
    expect(compacted.compacted).toBe(true);
    expect(compacted.script).toContain('# Box Packing Problem');
    expect(compacted.script).toContain(`asset="${PATH}"`);
    expect(compacted.script).not.toContain('Detailed section 1');
    expect(compacted.script).not.toContain('::: callout');
    expect(compacted.script.length).toBeLessThan(1_000);
  });

  it('allows explicit reader refusal to omit the attached image', () => {
    const state = imageReadState('Add notes to my book but do not include the image');
    expect(requiredManagedImageAssetPaths(state)).toEqual([]);
  });
});
