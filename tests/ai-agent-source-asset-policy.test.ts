import { describe, expect, it } from 'vitest';
import {
  createInitialAgentState,
  applyConciseManagedImageLayout,
  applyDominantManagedImageLayout,
  applyVagueManagedImageDefault,
  availableAgentToolNames,
  ensureRequiredManagedImagesInNotebookScript,
  missingRequiredManagedImageAssetPaths,
  notebookScriptManagedImageAssetPaths,
  requiredManagedImageAssetPaths,
  type AgentState,
} from '../src/features/aiAgent';
import { parseNotebookScriptPages } from '../src/editor/script/pageBoundaries';
import { readerRequestsConciseAttachedImage } from '../src/features/aiAgent/intent';

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

  it('bounds the exact concise Week 6 request to one image page and one grounded notes page', () => {
    const state = imageReadState(
      'hi can you add this for week 6, the picture has mostly all the details, but maybe you add some fun looking things with info on the same on the next pages but not too much',
    );
    expect(readerRequestsConciseAttachedImage(state)).toBe(true);
    expect(requiredManagedImageAssetPaths(state)).toEqual([PATH]);
    const expanded = [
      '---',
      'paper: grid',
      'wash: sky',
      '---',
      '',
      '# Week 6 — Box Packing with Kittens {sticker=box}',
      '',
      `![Kitten box-packing infographic](){asset="${PATH}", width=48, align=center, style=polaroid, caption="Box packing explained with kittens"}`,
      '',
      '::page',
      '',
      '## The 10-second idea',
      '',
      '::: callout {variant=tip, color=sky}',
      '**Fit test:** compare length, breadth and height. Every dimension of the smaller box must be less than or equal to the matching dimension of the larger box.',
      ':::',
      '',
      '## What rotation changes',
      '',
      '- Without rotation, keep dimensions in their original order.',
      '- With rotation, sort dimensions and compare component by component.',
      ...Array.from({ length: 5 }, (_, index) => [
        '',
        '::page',
        '',
        `## Expanded section ${index + 3}`,
        '',
        index === 0
          ? 'The longest chain shown is W → Z → U → X, giving four nested kittens.'
          : `Unrequested prior-week filler ${index + 1}.`,
        '',
        '| Earlier week | Unrelated detail |',
        '| --- | --- |',
        `| ${index + 1} | should be removed |`,
      ].join('\n')),
    ].join('\n');
    const repaired = ensureRequiredManagedImagesInNotebookScript(state, expanded);
    const compacted = applyConciseManagedImageLayout(state, repaired.script);

    expect(compacted.compacted).toBe(true);
    expect(parseNotebookScriptPages(compacted.script).pages).toHaveLength(2);
    expect(compacted.script.match(/^::page$/gmu)).toHaveLength(1);
    expect(compacted.script).toContain('# Week 6 — Box Packing with Kittens');
    expect(notebookScriptManagedImageAssetPaths(compacted.script)).toEqual([PATH]);
    const managedImage = parseNotebookScriptPages(compacted.script).pages[0]?.doc.blocks.find(
      (block) => block.kind === 'image',
    );
    expect(managedImage?.kind === 'image' ? managedImage.attrs.width : undefined).toBe(58);
    expect(compacted.script).toContain('## The 10-second idea');
    expect(compacted.script).toContain('compare length, breadth and height');
    expect(compacted.script).not.toContain('Expanded section 3');
    expect(compacted.script).not.toContain('Unrequested prior-week filler');
    expect(compacted.script).not.toContain('Earlier week');
    expect(applyConciseManagedImageLayout(state, compacted.script)).toEqual({
      script: compacted.script,
      compacted: false,
    });
  });

  it('recovers a concise raw draft that omitted usable managed-image syntax', () => {
    const state = imageReadState(
      'hi can you add this for week 6, the picture has mostly all the details, but maybe you add some fun looking things with info on the same on the next pages but not too much',
    );
    const raw = [
      '# image',
      '',
      'title: Week 6 — Box Packing Problem with Kittens.',
      '',
      '::page',
      '',
      '## Dimensions matter',
      '',
      'Compare length, breadth and height.',
      '',
      '::page',
      '',
      '## Unrequested expansion',
      '',
      'This third page should never survive the concise contract.',
    ].join('\n');

    const repaired = ensureRequiredManagedImagesInNotebookScript(state, raw);
    const compacted = applyConciseManagedImageLayout(state, repaired.script);

    expect(repaired.insertedPaths).toEqual([PATH]);
    expect(parseNotebookScriptPages(compacted.script).pages.length).toBeLessThanOrEqual(2);
    expect(compacted.script).toContain('# Week 6 — Box Packing Problem with Kittens');
    expect(compacted.script).not.toContain('# image');
    expect(compacted.script).not.toContain('title: Week 6');
    expect(compacted.script).not.toContain('Unrequested expansion');
    expect(compacted.script.match(new RegExp(
      PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'g',
    ))).toHaveLength(1);
  });

  it('does not compact a detailed or multi-image request through the concise-image rule', () => {
    const detailed = imageReadState(
      'The picture has all the details; create a detailed multi-page study guide from it.',
    );
    expect(readerRequestsConciseAttachedImage(detailed)).toBe(false);
    const secondSource: AgentState = {
      ...imageReadState(
        'The pictures have all the details; add only a little write-up to my book.',
      ),
      sourceManifest: {
        ...imageReadState().sourceManifest!,
        sources: [
          ...imageReadState().sourceManifest!.sources,
          {
            ...imageReadState().sourceManifest!.sources[0]!,
            id: 'reader-picture-two',
            title: 'Second picture.png',
            digest: 'reader-picture-two-digest',
            units: [{
              ...imageReadState().sourceManifest!.sources[0]!.units[0]!,
              id: 'reader-picture-two-unit',
              anchor: {
                sourceId: 'reader-picture-two',
                unitId: 'reader-picture-two-unit',
              },
            }],
          },
        ],
      },
    };
    expect(readerRequestsConciseAttachedImage(secondSource)).toBe(false);
    const withNotebookContext: AgentState = {
      ...imageReadState(
        'The picture has all the details; add a little write-up to my book but not too much.',
      ),
      sourceManifest: {
        ...imageReadState().sourceManifest!,
        sources: [
          ...imageReadState().sourceManifest!.sources,
          {
            id: 'placement-context-page',
            title: 'Week 6',
            kind: 'page',
            digest: 'placement-context-digest',
            mediaType: 'text/x-alcove-notebook-script',
            estimatedTokens: 5,
            quarantined: true,
            promptInjectionWarnings: [],
            units: [{
              id: 'placement-context-unit',
              label: 'page 6',
              ordinal: 0,
              digest: 'placement-context-unit-digest',
              estimatedTokens: 5,
              characters: 20,
              hasText: true,
              hasVisual: false,
              visualEvidence: 'none',
              anchor: {
                sourceId: 'placement-context-page',
                unitId: 'placement-context-unit',
                pageNumber: 6,
              },
            }],
          },
        ],
      },
    };
    expect(readerRequestsConciseAttachedImage(withNotebookContext)).toBe(true);
  });

  it('matches concise image requests that ask for a single notes page without saying details', () => {
    const concise = imageReadState(
      'add this picture for week 6, and maybe 1 page of some write up',
    );
    expect(readerRequestsConciseAttachedImage(concise)).toBe(true);
  });

  it('matches concise image requests that ask for another notes page', () => {
    const concise = imageReadState(
      'add this image to my book with another page of write up',
    );
    expect(readerRequestsConciseAttachedImage(concise)).toBe(true);
  });

  it('matches concise image requests when manifest metadata is unavailable but a single image read turn is present', () => {
    const concise = {
      ...imageReadState('add this image to my book with another page of write up'),
      sourceManifest: undefined,
      sourceCoverage: {
        manifestDigest: 'unknown',
        mode: 'relevant',
        requiredUnitIds: ['reader-picture-unit'],
        readUnitIds: ['reader-picture-unit'],
        citedUnitIds: ['reader-picture-unit'],
        omittedUnitIds: [],
        staleSourceIds: [],
        complete: true,
      },
    };
    expect(readerRequestsConciseAttachedImage(concise)).toBe(true);
    expect(requiredManagedImageAssetPaths(concise)).toEqual([PATH]);
    const repaired = ensureRequiredManagedImagesInNotebookScript(
      concise,
      '# Week 6\n\nA short note with the image placeholder.\n\n![Reader picture](){asset="ai/attachments/old-path.png", width=48}',
    );
    expect(repaired.script).toContain(PATH);
    expect(repaired.insertedPaths).toEqual([PATH]);
    const compacted = applyConciseManagedImageLayout(concise, repaired.script);
    expect(compacted.compacted).toBe(true);
    expect(parseNotebookScriptPages(compacted.script).pages).toHaveLength(2);
  });

  it('does not treat non-portable PDF render evidence as an attached image when the manifest is unavailable', () => {
    const imageState = imageReadState(
      'add this image to my book with another page of write up',
    );
    const pdfVisualState: AgentState = {
      ...imageState,
      sourceManifest: undefined,
      modelHistory: imageState.modelHistory.map((turn) => {
        if (turn.role !== 'tool') return turn;
        return {
          ...turn,
          content: {
            sourceId: 'reader-pdf',
            sourceDigest: 'reader-pdf-digest',
            units: [{
              unitId: 'reader-pdf-page-1',
              anchor: {
                sourceId: 'reader-pdf',
                unitId: 'reader-pdf-page-1',
                pageNumber: 1,
              },
              text: 'PDF page text',
              digest: 'reader-pdf-page-1-digest',
            }],
            truncated: false,
            visualRefs: [{
              anchor: {
                sourceId: 'reader-pdf',
                unitId: 'reader-pdf-page-1',
                pageNumber: 1,
              },
              label: 'PDF page 1 · embedded image 1',
              image: {
                resourceId: 'reader-pdf-page-1-image',
                mimeType: 'image/png',
                digest: 'reader-pdf-page-1-image-digest',
                width: 1200,
                height: 1600,
              },
            }],
          },
        };
      }),
    };

    expect(readerRequestsConciseAttachedImage(pdfVisualState)).toBe(false);
    expect(requiredManagedImageAssetPaths(pdfVisualState)).toEqual([]);
  });

  it('keeps concise attached-image intent when current turn reads exactly one image unit even with extra image sources', () => {
    const concise = {
      ...imageReadState('add this image to my book with another page of write up'),
      sourceManifest: {
        ...imageReadState().sourceManifest!,
        sources: [
          ...imageReadState().sourceManifest!.sources,
          {
            id: 'secondary-image',
            title: 'Old image',
            kind: 'image',
            digest: 'secondary-image-digest',
            mediaType: 'image/png',
            estimatedTokens: 10,
            quarantined: true,
            promptInjectionWarnings: [],
            units: [{
              id: 'secondary-image-unit',
              label: 'Old image',
              ordinal: 0,
              digest: 'secondary-image-unit-digest',
              estimatedTokens: 10,
              characters: 0,
              hasText: false,
              hasVisual: true,
              visualEvidence: 'available',
              anchor: { sourceId: 'secondary-image', unitId: 'secondary-image-unit' },
            }],
          },
        ],
      },
      sourceCoverage: {
        manifestDigest: imageReadState().sourceManifest!.digest,
        mode: 'relevant',
        requiredUnitIds: ['reader-picture-unit'],
        readUnitIds: ['reader-picture-unit'],
        readExposures: [{
          unitId: 'reader-picture-unit',
          providerCallCount: 0,
          exposedAt: NOW,
        }],
        citedUnitIds: ['reader-picture-unit'],
        omittedUnitIds: [],
        staleSourceIds: [],
        complete: true,
        updatedAt: NOW,
      },
    };
    expect(readerRequestsConciseAttachedImage(concise)).toBe(true);
    const repaired = applyConciseManagedImageLayout(
      concise,
      ensureRequiredManagedImagesInNotebookScript(
        concise,
        '# Box Packing\n\nA short note.',
      ).script,
    );
    expect(repaired.compacted).toBe(true);
    expect(repaired.script).toContain(PATH);
  });

  it('keeps one whole coherent heading group and never strands a promissory lead-in', () => {
    const state = imageReadState(
      'The picture has all the details; add a little information on the next page but not too much.',
    );
    const repaired = ensureRequiredManagedImagesInNotebookScript(state, [
      '# Box Packing Problem Explained with Kittens',
      '',
      `![Box packing infographic](){asset=${PATH}, width=48, align=center}`,
      '',
      '::page',
      '',
      '## Main Concept',
      '',
      'The infographic explains box packing through three key ways:',
      '',
      '## 1. Dimensions Matter',
      '',
      'Each kitten box has three measurements:',
      '',
      '- **Length** — nose to tail',
      '- **Breadth** — side to side',
      '- **Height** — floor to ears',
      '',
      '## 2. Rotation',
      '',
      'Sort the dimensions before comparing them.',
    ].join('\n'));
    const compacted = applyConciseManagedImageLayout(state, repaired.script);

    expect(parseNotebookScriptPages(compacted.script).pages).toHaveLength(2);
    expect(compacted.script).not.toContain('## Main Concept');
    expect(compacted.script).not.toContain('three key ways:');
    expect(compacted.script).toContain('## 1. Dimensions Matter');
    expect(compacted.script).toContain('Each kitten box has three measurements:');
    expect(compacted.script).toContain('- **Length** — nose to tail');
    expect(compacted.script).toContain('- **Breadth** — side to side');
    expect(compacted.script).toContain('- **Height** — floor to ears');
    expect(compacted.script).not.toMatch(/:\s*$/u);
    expect(applyConciseManagedImageLayout(state, compacted.script).script)
      .toBe(compacted.script);
  });

  it('keeps a coherent grounded notes group authored before the managed image', () => {
    const state = imageReadState(
      'The picture has most of the information; add a short write-up to my book but not too much.',
    );
    const repaired = ensureRequiredManagedImagesInNotebookScript(state, [
      '# Box Packing with Kittens',
      '',
      '## Quick summary',
      '',
      'The picture compares three cases:',
      '',
      '- Fixed dimension order',
      '- Rotation after sorting dimensions',
      '- Longest nesting chain',
      '',
      `![Box packing infographic](){asset=${PATH}, width=48, align=center}`,
    ].join('\n'));
    const compacted = applyConciseManagedImageLayout(state, repaired.script);

    expect(parseNotebookScriptPages(compacted.script).pages).toHaveLength(2);
    expect(compacted.script).toContain('## Quick summary');
    expect(compacted.script).toContain('The picture compares three cases:');
    expect(compacted.script).toContain('- Fixed dimension order');
    expect(compacted.script).toContain('- Rotation after sorting dimensions');
    expect(compacted.script).toContain('- Longest nesting chain');
  });

  it('keeps the original concise contract through explicit preview feedback unless expanded', () => {
    const original = imageReadState(
      'The picture has all the details; add a little write-up to my book but not too much.',
    );
    const revisionId = 'reader-concise-revision';
    const revised: AgentState = {
      ...original,
      conversation: [
        ...original.conversation,
        {
          id: revisionId,
          role: 'user',
          text: 'Keep the same two pages, but make the heading warmer.',
          createdAt: NOW,
        },
      ],
      modelHistory: [
        ...original.modelHistory,
        {
          id: revisionId,
          role: 'user',
          content: 'Keep the same two pages, but make the heading warmer.',
          createdAt: NOW,
        },
      ],
      objective: {
        turnId: revisionId,
        mode: 'notebook_change',
        reason: 'reader_preview_feedback',
      },
      budgetWindow: {
        providerCallsAtStart: 2,
        toolCallsAtStart: 9,
        repairPassesAtStart: 0,
        startedAt: NOW,
        readerMessageId: revisionId,
      },
      draft: {
        runId: original.identity.runId,
        version: 1,
        script: '# Original concise image page',
        draftHash: 'original-concise-draft',
        sourceManifestDigest: original.sourceManifest!.digest,
        sourceReadUnitIds: ['reader-picture-unit'],
        createdAt: NOW,
      },
    };
    expect(readerRequestsConciseAttachedImage(revised)).toBe(true);
    const expandedRevision = [
      '# Warmer Box Packing',
      '',
      `![Box packing infographic](){asset="${PATH}", width=48, align=center}`,
      ...Array.from({ length: 5 }, (_, index) => [
        '',
        '::page',
        '',
        `## Revision section ${index + 1}`,
        '',
        `Grounded note ${index + 1}.`,
      ].join('\n')),
    ].join('\n');
    expect(parseNotebookScriptPages(
      applyConciseManagedImageLayout(revised, expandedRevision).script,
    ).pages.length).toBeLessThanOrEqual(2);

    const expandedFeedback: AgentState = {
      ...revised,
      conversation: [
        ...original.conversation,
        {
          id: revisionId,
          role: 'user',
          text: 'Turn it into a detailed multi-page study guide.',
          createdAt: NOW,
        },
      ],
      modelHistory: [
        ...original.modelHistory,
        {
          id: revisionId,
          role: 'user',
          content: 'Turn it into a detailed multi-page study guide.',
          createdAt: NOW,
        },
      ],
    };
    expect(readerRequestsConciseAttachedImage(expandedFeedback)).toBe(false);
  });

  it('keeps concise image intent even when turn anchor is stale in model history', () => {
    const state = imageReadState('add this image to my book with another page of write up');
    expect(readerRequestsConciseAttachedImage(state)).toBe(true);
    const staleAnchorState: AgentState = {
      ...state,
      budgetWindow: {
        providerCallsAtStart: 0,
        toolCallsAtStart: 0,
        repairPassesAtStart: 0,
        startedAt: NOW,
        readerMessageId: 'reader-message-does-not-exist',
      },
      modelHistory: [
        ...state.modelHistory,
      ],
    };
    expect(requiredManagedImageAssetPaths(staleAnchorState)).toEqual([PATH]);
    expect(readerRequestsConciseAttachedImage(staleAnchorState)).toBe(true);
    const repaired = ensureRequiredManagedImagesInNotebookScript(
      staleAnchorState,
      '# Week 6\n\nA grounded summary with image placeholder missing',
    );
    const compacted = applyConciseManagedImageLayout(staleAnchorState, repaired.script);
    expect(compacted.compacted).toBe(true);
    expect(compacted.script).toContain(`asset=${PATH}`);
  });

  it('uses a plain title value over a generic image heading and drops metadata-only notes', () => {
    const state = imageReadState(
      'The picture has all the details; add a brief write-up to my book but not too much.',
    );
    const repaired = ensureRequiredManagedImagesInNotebookScript(state, [
      '# image',
      '',
      `![Box packing infographic](){asset=${PATH}, width=48, align=center}`,
      '',
      '::page',
      '',
      'title: Week 6 - Box Packing Problem with Kittens.',
      '',
      'paper: grid',
      '',
      'wash: sky',
      '',
      'image: attached infographic',
    ].join('\n'));
    const compacted = applyConciseManagedImageLayout(state, repaired.script);

    expect(parseNotebookScriptPages(compacted.script).pages).toHaveLength(1);
    expect(compacted.script).toContain('# Week 6 - Box Packing Problem with Kittens');
    expect(compacted.script).not.toContain('# image');
    expect(compacted.script).not.toMatch(/^title\s*:/imu);
    expect(compacted.script).not.toMatch(/^paper\s*:/imu);
    expect(compacted.script).not.toMatch(/^wash\s*:/imu);
    expect(compacted.script).not.toMatch(/^image\s*:/imu);
    expect(applyConciseManagedImageLayout(state, compacted.script)).toEqual({
      script: compacted.script,
      compacted: false,
    });
  });

  it('allows one bounded repair for a concise local-layout failure before asking the reader', () => {
    const base = imageReadState(
      'The picture has all the details; add a brief write-up to my book, not too much.',
    );
    const script = ensureRequiredManagedImagesInNotebookScript(
      base,
      '# Box Packing\n\nA short grounded explanation.',
    ).script;
    const draftHash = 'concise-layout-draft';
    const generationId = 'concise-layout-generation';
    const pages = [1, 2].map((pageNumber) => ({
      pageId: `${generationId}:page:${pageNumber}`,
      pageNumber,
      width: 620,
      height: 720,
      image: {
        resourceId: `${generationId}:image:${pageNumber}`,
        mimeType: 'image/png' as const,
        digest: `${generationId}:digest:${pageNumber}`,
        width: 620,
        height: 720,
      },
      textDigest: `text-${pageNumber}`,
      layoutDigest: `layout-${pageNumber}`,
      paginationSpill: pageNumber === 2,
      residualOverflow: false,
    }));
    const state: AgentState = {
      ...base,
      objective: {
        turnId: 'reader-source-asset',
        mode: 'notebook_change',
        decidedBy: 'model_action',
      },
      notebookSnapshot: {
        bookId: base.identity.bookId,
        bookRevision: 'book-revision',
        pageIds: ['existing-page'],
        pageRevisions: { 'existing-page': 'existing-page-revision' },
        capturedAt: NOW,
      },
      insertionTarget: { kind: 'book_end' },
      sourceCoverage: {
        manifestDigest: base.sourceManifest!.digest,
        mode: 'relevant',
        requiredUnitIds: ['reader-picture-unit'],
        readUnitIds: ['reader-picture-unit'],
        readExposures: [{
          unitId: 'reader-picture-unit',
          providerCallCount: 0,
          exposedAt: NOW,
        }],
        citedUnitIds: ['reader-picture-unit'],
        omittedUnitIds: [],
        staleSourceIds: [],
        complete: true,
        updatedAt: NOW,
      },
      draft: {
        runId: base.identity.runId,
        version: 1,
        script,
        draftHash,
        sourceManifestDigest: base.sourceManifest!.digest,
        sourceReadUnitIds: ['reader-picture-unit'],
        createdAt: NOW,
      },
      validation: {
        draftHash,
        parserDiagnostics: [],
        staticDiagnostics: [],
        imageDiagnostics: [],
        pageLedgerDiagnostics: [],
        valid: true,
        checkedAt: NOW,
      },
      previewGeneration: {
        generationId,
        draftHash,
        layoutHash: 'concise-layout-hash',
        rendererVersion: 'test',
        bookSnapshotRevision: 'book-revision',
        createdAt: NOW,
        parserValid: true,
        layoutValid: false,
        stale: false,
        pageCount: 2,
        pages,
        diagnostics: [],
      },
      visualReview: {
        generationId,
        draftHash,
        requiredPageIds: pages.map((page) => page.pageId),
        imageExposures: [],
        inspectedPageIds: pages.map((page) => page.pageId),
        findings: [],
        complete: true,
        passed: false,
        updatedAt: NOW,
      },
    };

    expect([...availableAgentToolNames(state)]).toEqual(['submit_notebook_script']);
  });

  it('keeps concise layout overflow repairable when reviewer findings are actionable', () => {
    const state = imageReadState(
      'The picture has all the details; add a brief write-up to my book, not too much.',
    );
    const script = applyConciseManagedImageLayout(
      state,
      ensureRequiredManagedImagesInNotebookScript(
        state,
        '# Box Packing\n\n## Intro\n\n![Reader picture](){asset="' + PATH + '", width=48}',
      ).script,
    ).script;
    const draftHash = 'concise-layout-findings-draft';
    const generationId = 'concise-layout-findings-generation';
    const pages = [1, 2, 3, 4].map((pageNumber) => ({
      pageId: `${generationId}:page:${pageNumber}`,
      pageNumber,
      width: 620,
      height: 720,
      image: {
        resourceId: `${generationId}:image:${pageNumber}`,
        mimeType: 'image/png' as const,
        digest: `${generationId}:digest:${pageNumber}`,
        width: 620,
        height: 720,
      },
      textDigest: `text-${pageNumber}`,
      layoutDigest: `layout-${pageNumber}`,
      paginationSpill: pageNumber > 1,
      residualOverflow: false,
    }));
    const scenario: AgentState = {
      ...state,
      objective: {
        turnId: 'reader-source-asset',
        mode: 'notebook_change',
        decidedBy: 'model_action',
      },
      notebookSnapshot: {
        bookId: state.identity.bookId,
        bookRevision: 'book-revision',
        pageIds: ['existing-page'],
        pageRevisions: { 'existing-page': 'existing-page-revision' },
        capturedAt: NOW,
      },
      insertionTarget: { kind: 'book_end' },
      sourceCoverage: {
        manifestDigest: state.sourceManifest!.digest,
        mode: 'relevant',
        requiredUnitIds: ['reader-picture-unit'],
        readUnitIds: ['reader-picture-unit'],
        readExposures: [{
          unitId: 'reader-picture-unit',
          providerCallCount: 0,
          exposedAt: NOW,
        }],
        citedUnitIds: ['reader-picture-unit'],
        omittedUnitIds: [],
        staleSourceIds: [],
        complete: true,
        updatedAt: NOW,
      },
      draft: {
        runId: state.identity.runId,
        version: 1,
        script,
        draftHash,
        sourceManifestDigest: state.sourceManifest!.digest,
        sourceReadUnitIds: ['reader-picture-unit'],
        createdAt: NOW,
      },
      validation: {
        draftHash,
        parserDiagnostics: [],
        staticDiagnostics: [],
        imageDiagnostics: [],
        pageLedgerDiagnostics: [],
        valid: true,
        checkedAt: NOW,
      },
      previewGeneration: {
        generationId,
        draftHash,
        layoutHash: 'concise-layout-findings-hash',
        rendererVersion: 'test',
        bookSnapshotRevision: 'book-revision',
        createdAt: NOW,
        parserValid: true,
        layoutValid: false,
        stale: false,
        pageCount: 4,
        pages,
        diagnostics: [],
      },
      visualReview: {
        generationId,
        draftHash,
        requiredPageIds: pages.map((page) => page.pageId),
        imageExposures: [],
        inspectedPageIds: pages.map((page) => page.pageId),
        findings: [{
          pageId: pages[0]!.pageId,
          kind: 'semantic',
          code: 'rendering',
          detail: 'content exceeds this page and overflows',
        }],
        complete: true,
        passed: false,
        updatedAt: NOW,
      },
    };

    expect([...availableAgentToolNames(scenario)]).toEqual(['submit_notebook_script']);
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
