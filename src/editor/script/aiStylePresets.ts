import { NOTEBOOK_SCRIPT_SPEC } from './spec';

export interface AiSpecStylePreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
  readonly custom?: true;
  readonly basedOn?: string;
}

export const AI_SPEC_STYLE_PRESETS: readonly AiSpecStylePreset[] = [
  {
    id: 'pretty-thoughtful',
    name: 'Pretty & thoughtful',
    description: 'Warm, lively and polished—the welcoming all-rounder.',
    prompt:
      'Create a notebook that feels warm, lively, polished, and genuinely considered. Begin from the subject, audience, and emotional promise of the material; establish a coherent visual language with confident hierarchy, comfortable reading rhythm, and a small related palette. Let neighbouring pages have different jobs—orientation, explanation, visual model, example, reflection or practice—so the notebook develops rather than repeats. Use Alcove’s broad catalogue with judgment: choose motifs and physical treatments because they suit the idea, vary the kinds of visual support, and avoid turning any one sticker, tape, card or flourish into a formula. Preserve breathing room and clarity while adding moments of wit, tenderness or delight. The result should feel art-directed and useful, not merely decorated or mechanically full.',
  },
  {
    id: 'cozy-storybook',
    name: 'Cozy storybook',
    description: 'Gentle, charming and narrative without becoming childish.',
    prompt:
      'Give the notebook a cozy storybook sensibility: warm, human, quietly imaginative, and appropriate to the reader’s age. Find a gentle narrative thread in the subject and let explanations unfold through anticipation, discovery and satisfying return, without inventing facts or becoming childish. Build continuity through tone, colour relationships and recurring ideas rather than copying the same decoration from page to page. Alternate intimate prose with clear visual moments, examples and pauses; choose a few memorable motifs from the full catalogue and let each earn its place. Favour charm with purpose, tactile warmth and inviting pacing over scrapbook clutter or ornamental habits.',
  },
  {
    id: 'visual-learning',
    name: 'Visual learning',
    description: 'Clear, diagram-minded and easy to study at a glance.',
    prompt:
      'Shape the notebook as an excellent visual lesson whose structure is understandable at a glance and rewarding in detail. Identify the conceptual relationships that matter, then choose the best explanatory form—sequence, comparison, hierarchy, worked example, analogy or retrieval practice—without forcing every topic into the same block. Use strong hierarchy, lucid pacing, concise labels and meaningful contrast. Let decoration support grouping, emphasis and memory; vary visual roles instead of repeating a favourite callout or sticker. Keep the pages attractive and energetic, but judge every flourish by whether it improves comprehension, orientation or recall.',
  },
  {
    id: 'playful-discovery',
    name: 'Playful discovery',
    description: 'Curious, energetic and surprising while staying coherent.',
    prompt:
      'Make the notebook feel like an intelligent journey of discovery: curious, energetic, generous and occasionally surprising. Invite prediction, noticing, comparison and small moments of participation, then reward them with clear explanations. Vary pacing and page roles so play emerges from the ideas rather than from constant visual noise. Choose expressive details from across Alcove’s catalogue, but keep a coherent underlying system and avoid repeating the same gag, sticker or physical effect. It should feel clever and alive, never random, juvenile or gimmicky.',
  },
  {
    id: 'quiet-scholarly',
    name: 'Quiet scholarly',
    description: 'Elegant, measured and serious without feeling sterile.',
    prompt:
      'Aim for a quiet scholarly character: elegant, composed, precise and rewarding to linger over. Establish authority through lucid organisation, careful proportions, excellent spacing and a restrained material vocabulary rather than through emptiness or severity. Use subtle variation in paper, lettering, rules, diagrams and marginal notes to distinguish kinds of thought while preserving calm continuity. Include visual explanation when it genuinely clarifies an argument; avoid decorative repetition and novelty for its own sake. The notebook may feel formal, but should remain warm, humane and readable rather than austere or clinical.',
  },
  {
    id: 'bold-editorial',
    name: 'Bold editorial',
    description: 'Confident, vivid and magazine-like with disciplined contrast.',
    prompt:
      'Use a bold editorial sensibility with decisive hierarchy, vivid pacing and a few strong visual statements. Find the central angle of the material and let scale, contrast, rhythm and page sequencing make that argument visible. Balance feature-like moments with calmer explanatory pages; vary composition without losing a recognisable system. Use the catalogue broadly but selectively, choosing treatments that reinforce the editorial voice rather than stacking effects. Preserve legibility and factual nuance, and let the content determine where emphasis belongs so the result feels art-directed rather than loud.',
  },
  {
    id: 'source-faithful',
    name: 'Source-faithful',
    description: 'Conservative interpretation for material that should stay close.',
    prompt:
      'Stay close to the supplied source in meaning, order, emphasis and tone while still making the notebook polished and pleasant to use. Preserve claims, qualifications and the author’s intent; reorganise only where it clearly improves comprehension, and distinguish any added context or analogy. Use hierarchy, spacing, selective diagrams and restrained visual cues to reveal the source’s existing structure rather than imposing a decorative theme. Draw from the catalogue only when a treatment has a clear editorial purpose, and avoid repeated motifs that make different sections look artificially alike.',
  },
] as const;

export const DEFAULT_AI_SPEC_STYLE_ID = 'pretty-thoughtful';
const STORAGE_KEY = 'alcove.ai-spec-styles.v1';
const MAX_CUSTOM_PRESETS = 20;
const MAX_NAME_LENGTH = 60;
const MAX_PROMPT_LENGTH = 2400;

export interface AiSpecStyleState {
  readonly selectedId: string;
  readonly customPresets: readonly AiSpecStylePreset[];
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function cleanCustom(value: unknown): AiSpecStylePreset | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const name = typeof row.name === 'string' ? row.name.trim().slice(0, MAX_NAME_LENGTH) : '';
  const prompt =
    typeof row.prompt === 'string' ? row.prompt.trim().slice(0, MAX_PROMPT_LENGTH) : '';
  const basedOn = typeof row.basedOn === 'string' ? row.basedOn : undefined;
  if (!id.startsWith('custom-') || name === '' || prompt === '') return null;
  return {
    id,
    name,
    prompt,
    description: 'Your own creative direction.',
    custom: true,
    basedOn,
  };
}

export function loadAiSpecStyleState(): AiSpecStyleState {
  const fallback: AiSpecStyleState = {
    selectedId: DEFAULT_AI_SPEC_STYLE_ID,
    customPresets: [],
  };
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const customPresets = Array.isArray(parsed.customPresets)
      ? parsed.customPresets
          .map(cleanCustom)
          .filter((preset): preset is AiSpecStylePreset => preset !== null)
          .slice(0, MAX_CUSTOM_PRESETS)
      : [];
    const choices = [...AI_SPEC_STYLE_PRESETS, ...customPresets];
    const selectedId =
      typeof parsed.selectedId === 'string' &&
      choices.some((preset) => preset.id === parsed.selectedId)
        ? parsed.selectedId
        : DEFAULT_AI_SPEC_STYLE_ID;
    return { selectedId, customPresets };
  } catch {
    return fallback;
  }
}

export function saveAiSpecStyleState(state: AiSpecStyleState): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A denied storage area should not make copying a guide fail.
  }
}

export function resolveAiSpecStyle(
  id: string,
  customPresets: readonly AiSpecStylePreset[],
): AiSpecStylePreset {
  return (
    [...AI_SPEC_STYLE_PRESETS, ...customPresets].find((preset) => preset.id === id) ??
    AI_SPEC_STYLE_PRESETS[0]
  );
}

export function createCustomAiSpecStyle(input: {
  readonly id?: string;
  readonly name: string;
  readonly prompt: string;
  readonly basedOn?: string;
}): AiSpecStylePreset | null {
  const name = input.name.trim().slice(0, MAX_NAME_LENGTH);
  const prompt = input.prompt.trim().slice(0, MAX_PROMPT_LENGTH);
  if (name === '' || prompt === '') return null;
  return {
    id:
      input.id?.startsWith('custom-') === true
        ? input.id
        : `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    prompt,
    description: 'Your own creative direction.',
    custom: true,
    basedOn: input.basedOn,
  };
}

export function composeNotebookScriptSpec(
  preset: AiSpecStylePreset,
  baseSpec = NOTEBOOK_SCRIPT_SPEC,
): string {
  const direction = [
    '## Creative direction chosen by the reader',
    '',
    '### Intent',
    '',
    'Treat this as art direction, not a rigid recipe. First understand the subject, audience, source material and purpose. Use the direction to shape mood, hierarchy, pacing and quality—not to force particular blocks, layouts, colours or decorative devices.',
    '',
    preset.prompt.trim(),
    '',
    '### Creative latitude',
    '',
    'Choose freely from the complete Notebook Script catalogue. Build one coherent visual system, but let pages differ according to their content. Prefer meaningful variation over repeated motifs, and never add an element merely to prove the direction or syntax is present.',
    '',
    '### Quality bar',
    '',
    'Before returning the final attached `.md`, privately review the whole notebook against the chosen direction and the format rules. Check clarity, visual rhythm, catalogue variety, dead space, accidental repetition, incomplete thoughts, awkward page breaks and unsupported syntax. Revise the complete notebook, then return only the improved final file.',
  ].join('\n');
  const title = '# Notebook Script';
  const titleAt = baseSpec.indexOf(title);
  if (titleAt < 0) return `${direction}\n\n${baseSpec}`;
  const insertAt = titleAt + title.length;
  return `${baseSpec.slice(0, insertAt)}\n\n${direction}${baseSpec.slice(insertAt)}`;
}
