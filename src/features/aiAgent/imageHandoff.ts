import { parseNotebookScriptPages } from '../../editor/script/pageBoundaries';
import type { Block } from '../../script';
import type {
  ImageGenerationAspect,
  ImageGenerationPrompt,
  ImageGenerationRole,
  ImagePromptHandoff,
  PortableImageSlot,
} from './types';

/**
 * Generous source sizes for modern image generators. Alcove only constrains
 * the displayed block; the original generated/uploaded pixels remain intact
 * for the full-screen image viewer.
 */
export const IMAGE_GENERATION_DIMENSIONS: Readonly<
  Record<ImageGenerationAspect, { readonly width: number; readonly height: number }>
> = {
  square_1_1: { width: 1024, height: 1024 },
  landscape_4_3: { width: 1536, height: 1152 },
  landscape_3_2: { width: 1536, height: 1024 },
  wide_16_9: { width: 1536, height: 864 },
  portrait_4_5: { width: 1024, height: 1280 },
  portrait_3_4: { width: 1024, height: 1365 },
  banner_3_1: { width: 1536, height: 512 },
};

export const IMAGE_GENERATION_ASPECT_LABELS: Readonly<Record<ImageGenerationAspect, string>> = {
  square_1_1: 'Square 1:1',
  landscape_4_3: 'Landscape 4:3',
  landscape_3_2: 'Landscape 3:2',
  wide_16_9: 'Wide 16:9',
  portrait_4_5: 'Portrait 4:5',
  portrait_3_4: 'Portrait 3:4',
  banner_3_1: 'Banner 3:1',
};

export const IMAGE_GENERATION_ROLE_LABELS: Readonly<Record<ImageGenerationRole, string>> = {
  hero: 'Opening image',
  explanatory_diagram: 'Explanatory diagram',
  concept_illustration: 'Concept illustration',
  analogy_scene: 'Analogy scene',
  reference: 'Reference image',
  decorative: 'Decorative image',
};

function walkBlocks(blocks: readonly Block[], visit: (block: Block) => void): void {
  for (const block of blocks) {
    visit(block);
    if (block.kind === 'container') walkBlocks(block.children, visit);
  }
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function optionalWidth(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.min(100, Math.max(10, Math.round(numeric)));
}

/** Extract every intentional empty-source upload card in reading order. */
export function extractPortableImageSlots(script: string): readonly PortableImageSlot[] {
  const parsed = parseNotebookScriptPages(script);
  const slots: PortableImageSlot[] = [];
  parsed.pages.forEach((page, pageIndex) => {
    let pageOrdinal = 0;
    walkBlocks(page.doc.blocks, (block) => {
      if (block.kind !== 'image' || block.src.trim() !== '') return;
      const placeholder = optionalString(block.attrs.placeholder);
      const asset = optionalString(block.attrs.asset);
      if (placeholder === undefined || asset !== undefined) return;
      pageOrdinal += 1;
      slots.push({
        slotId: `page-${pageIndex + 1}-image-${pageOrdinal}`,
        pageNumber: pageIndex + 1,
        ordinal: slots.length + 1,
        alt: block.alt.trim(),
        placeholder,
        ...(optionalString(block.attrs.caption) === undefined
          ? {}
          : { caption: optionalString(block.attrs.caption) }),
        ...(optionalString(block.attrs.style) === undefined
          ? {}
          : { frame: optionalString(block.attrs.style) }),
        ...(optionalWidth(block.attrs.width) === undefined
          ? {}
          : { displayWidthPercent: optionalWidth(block.attrs.width) }),
      });
    });
  });
  return slots;
}

export interface ImagePromptDraft {
  readonly slotId: string;
  readonly role: ImageGenerationRole;
  readonly aspect: ImageGenerationAspect;
  readonly prompt: string;
  readonly avoid?: string;
}

function promptWithDimensions(
  prompt: string,
  aspect: ImageGenerationAspect,
  dimensions: { readonly width: number; readonly height: number },
): string {
  const aspectLabel = IMAGE_GENERATION_ASPECT_LABELS[aspect];
  const dimensionSentence =
    `Output exactly ${dimensions.width} x ${dimensions.height} pixels (${aspectLabel} aspect ratio).`;
  if (prompt.trim().endsWith(dimensionSentence)) return prompt.trim();
  return [
    prompt.trim().replace(/[\s.]+$/u, ''),
    dimensionSentence,
  ].join('. ');
}

/**
 * Build an exact one-prompt-per-slot handoff. Unknown, duplicate or missing
 * slot ids are rejected so the model cannot silently strand an upload card.
 */
export function buildImagePromptHandoff(input: {
  readonly draftHash: string;
  readonly script: string;
  readonly prompts: readonly ImagePromptDraft[];
  readonly now: string;
}): ImagePromptHandoff {
  const slots = extractPortableImageSlots(input.script);
  const slotById = new Map(slots.map((slot) => [slot.slotId, slot] as const));
  const seen = new Set<string>();
  const promptsBySlot = new Map<string, ImageGenerationPrompt>();
  input.prompts.forEach((candidate) => {
    const slot = slotById.get(candidate.slotId);
    if (slot === undefined) {
      throw new Error(`image prompt names unknown slot ${candidate.slotId}`);
    }
    if (seen.has(candidate.slotId)) {
      throw new Error(`image prompt repeats slot ${candidate.slotId}`);
    }
    const authoredPrompt = candidate.prompt.trim();
    if (authoredPrompt.length < 24) {
      throw new Error(`image prompt for ${candidate.slotId} is too short to be useful`);
    }
    seen.add(candidate.slotId);
    const dimensions = IMAGE_GENERATION_DIMENSIONS[candidate.aspect];
    const prompt = promptWithDimensions(authoredPrompt, candidate.aspect, dimensions);
    const avoid = optionalString(candidate.avoid);
    promptsBySlot.set(candidate.slotId, {
      id: `${input.draftHash}:${candidate.slotId}`,
      slot,
      role: candidate.role,
      aspect: candidate.aspect,
      widthPx: dimensions.width,
      heightPx: dimensions.height,
      prompt,
      ...(avoid === undefined ? {} : { avoid }),
    });
  });
  const missing = slots.filter((slot) => !seen.has(slot.slotId));
  if (missing.length > 0) {
    throw new Error(
      `image prompts are missing ${missing.map((slot) => slot.slotId).join(', ')}`,
    );
  }
  if (promptsBySlot.size > slots.length) {
    throw new Error('image prompt handoff contains more prompts than portable slots');
  }
  const prompts = slots.map((slot) => promptsBySlot.get(slot.slotId)!);
  return { draftHash: input.draftHash, prompts, createdAt: input.now };
}

export function imagePromptHandoffMatchesDraft(
  handoff: ImagePromptHandoff | undefined,
  draftHash: string,
  script: string,
): boolean {
  const slots = extractPortableImageSlots(script);
  if (slots.length === 0) return handoff === undefined || handoff.prompts.length === 0;
  if (handoff === undefined || handoff.draftHash !== draftHash) return false;
  if (handoff.prompts.length !== slots.length) return false;
  return slots.every((slot, index) => {
    const prompt = handoff.prompts[index];
    if (prompt === undefined || prompt.slot.slotId !== slot.slotId) return false;
    const dimensions = IMAGE_GENERATION_DIMENSIONS[prompt.aspect];
    const aspectLabel = IMAGE_GENERATION_ASPECT_LABELS[prompt.aspect];
    return (
      prompt.widthPx === dimensions.width &&
      prompt.heightPx === dimensions.height &&
      prompt.prompt.includes(
        `Output exactly ${dimensions.width} x ${dimensions.height} pixels (${aspectLabel} aspect ratio).`,
      )
    );
  });
}
