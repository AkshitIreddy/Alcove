import { parseNotebookScriptPages } from '../../editor/script/pageBoundaries';
import type { Block, ContainerName } from '../../script';
import type {
  AgentState,
  NotebookScriptDiagnostic,
  NotebookScriptValidation,
} from './types';

/**
 * A semantic role, rather than a catalogue widget name. Two differently named
 * cards serving the same purpose are one role; a comparison table and a
 * revealable self-check are genuinely different editorial moves.
 */
export type NotebookCraftRole =
  | 'annotation'
  | 'comparison'
  | 'focus'
  | 'parallel'
  | 'practice'
  | 'relationship'
  | 'reveal'
  | 'sequence'
  | 'source-voice'
  | 'technical'
  | 'visual-evidence';

export interface NotebookCraftFeature {
  readonly pageNumber: number;
  readonly role: NotebookCraftRole;
  readonly kind: string;
}

export interface NotebookCraftProfile {
  readonly pageCount: number;
  readonly features: readonly NotebookCraftFeature[];
  readonly roles: readonly NotebookCraftRole[];
  readonly featuredPageNumbers: readonly number[];
}

const FOCUS_CONTAINERS = new Set<ContainerName>([
  'sticky-note',
  'callout',
  'card',
  'banner',
  'index-card',
]);

function containerRole(name: ContainerName): NotebookCraftRole | null {
  if (FOCUS_CONTAINERS.has(name)) return 'focus';
  switch (name) {
    case 'columns': return 'parallel';
    case 'quote-card': return 'source-voice';
    case 'spoiler':
    case 'toggle': return 'reveal';
    case 'ledger': return 'comparison';
    case 'marginalia': return 'annotation';
    default: return null;
  }
}

function actualImage(block: Extract<Block, { readonly kind: 'image' }>): boolean {
  const asset = typeof block.attrs.asset === 'string' ? block.attrs.asset.trim() : '';
  return block.src.trim() !== '' || asset !== '';
}

function collectFeatures(
  blocks: readonly Block[],
  pageNumber: number,
  output: NotebookCraftFeature[],
): void {
  for (const block of blocks) {
    switch (block.kind) {
      case 'table':
        output.push({ pageNumber, role: 'comparison', kind: 'table' });
        break;
      case 'taskList':
        output.push({ pageNumber, role: 'practice', kind: 'task-list' });
        break;
      case 'mathBlock':
        output.push({ pageNumber, role: 'technical', kind: 'display-math' });
        break;
      case 'code':
        output.push({ pageNumber, role: 'technical', kind: 'code' });
        break;
      case 'diagram':
        output.push({
          pageNumber,
          role: block.lang === 'timeline' ? 'sequence' : 'relationship',
          kind: `diagram:${block.lang}`,
        });
        break;
      case 'image':
        // A real reader-supplied or already-managed image may carry meaning.
        // Empty portable slots deliberately do not satisfy the craft gate: the
        // model must never manufacture an image request to pass validation.
        if (actualImage(block)) {
          output.push({ pageNumber, role: 'visual-evidence', kind: 'managed-image' });
        }
        break;
      case 'container': {
        const role = containerRole(block.name);
        if (role !== null) {
          output.push({ pageNumber, role, kind: `container:${block.name}` });
        }
        collectFeatures(block.children, pageNumber, output);
        break;
      }
      default:
        break;
    }
  }
}

/** Inspect authored pages only; spill-page layout remains the native renderer's job. */
export function notebookCraftProfile(script: string): NotebookCraftProfile {
  const pages = parseNotebookScriptPages(script).pages;
  const features: NotebookCraftFeature[] = [];
  pages.forEach((page, index) => collectFeatures(page.doc.blocks, index + 1, features));
  return {
    pageCount: pages.length,
    features,
    roles: [...new Set(features.map((feature) => feature.role))].sort(),
    featuredPageNumbers: [...new Set(features.map((feature) => feature.pageNumber))].sort(
      (left, right) => left - right,
    ),
  };
}

type CraftPreference = 'plain' | 'composed';

const PLAIN_CRAFT_REQUEST = new RegExp([
  String.raw`\b(?:keep|make|leave|render|format|design)\s+(?:(?:the|these|those|my|your)\s+)?(?:pages?|notes?|page\s+layout|layout|design|style|format(?:ting)?|output|result|it|this|that)\b[\s\S]{0,18}\b(?:plain|minimal|minimalist|bare|unstyled)\b`,
  String.raw`\b(?:minimal|minimalist|plain|bare|unstyled)\s+(?:pages?|notes?|page\s+layout|layout|style|format(?:ting)?|design|output)\b`,
  String.raw`\b(?:pages?|notes?|page\s+layout|layout|style|format(?:ting)?|design|output)\s+(?:plain|minimal|minimalist|bare|unstyled)\b`,
  String.raw`\b(?:use|write|output|return|render)\s+(?:(?:only|just)\s+)?(?:plain\s+text|paragraphs?|bullets?|a\s+basic\s+list)\b`,
  String.raw`\b(?:format|render|keep|leave|make)\s+(?:it|this|that|the\s+(?:content|text))\s+as\s+(?:plain\s+text|minimal|minimalist|bare|unstyled)\b`,
  String.raw`\b(?:only|just)\s+(?:use\s+)?(?:plain\s+text|paragraphs?|bullets?|a\s+basic\s+list)\b`,
  String.raw`\b(?:plain\s+text|paragraphs?|bullets?|a\s+basic\s+list)\s+only\b`,
  String.raw`\b(?:plain|minimal|minimalist|bare|unstyled)(?:\s+(?:pages?|notes?|layout|style))?\s*,?\s+please\b`,
  String.raw`\bbasic\s+(?:bullet\s+points?|bullets?|paragraphs?|list)\s+(?:are|is)\s+(?:fine|enough|okay|ok)\b`,
  String.raw`\b(?:no|without)\s+(?:any\s+)?(?:special|decorative|fancy|visual|catalog(?:ue)?)[\s-]*(?:formatting|blocks?|items?|elements?|styling|design)?\b`,
  String.raw`\b(?:do\s+not|don['’]?t)\s+(?:reformat|reorganise|reorganize|decorate|embellish|redesign)\b`,
  String.raw`\b(?:verbatim|word[ -]for[ -]word|exact transcription|copy (?:it|this|that) exactly|keep (?:it|this|that) as[ -]is|preserve (?:it|this|that) exactly)\b`,
].join('|'), 'iu');

const COMPOSED_CRAFT_REQUEST = new RegExp(
  String.raw`\b(?:engaging|playful|visual|designed|polished|lively|fun|cute|catalog(?:ue)?|callouts?|cards?|diagrams?|timelines?|tables?|spoil(?:er|ers)|toggles?|special\s+(?:blocks?|items?|elements?))\b`,
  'iu',
);

const NEGATED_PLAIN_CRAFT_REQUEST = new RegExp([
  String.raw`\b(?:do\s+not|don['’]?t|never)\s+(?:(?:leave|keep|make|render)\s+(?:(?:it|this|that|the\s+(?:page|pages|layout|notes?|text))\s+)?(?:as\s+)?|use\s+)(?:only\s+)?(?:too\s+)?(?:plain(?:\s+text)?|minimal|minimalist|bare|unstyled)\b`,
  String.raw`\bnot\s+(?:too\s+)?(?:plain|minimal|minimalist|bare|unstyled)\b`,
  String.raw`\b(?:avoid|skip|reject|anything\s+but)\b[\s\S]{0,18}\b(?:plain|minimal|minimalist|bare|unstyled|plain\s+text)\b`,
].join('|'), 'iu');

function explicitPreference(text: string): CraftPreference | undefined {
  // Negating a restraint reverses its meaning: "don't leave it plain" and
  // "make it not minimal" ask for composition even if no catalogue noun is
  // present. Resolve that contrast before the broad plain-mode patterns.
  if (NEGATED_PLAIN_CRAFT_REQUEST.test(text)) return 'composed';
  // A negative such as "no fancy cards" contains a catalogue noun too. That
  // explicit restraint owns the sentence before richer positive keywords.
  if (PLAIN_CRAFT_REQUEST.test(text)) return 'plain';
  if (COMPOSED_CRAFT_REQUEST.test(text)) return 'composed';
  return undefined;
}

/**
 * Style is conversational state. The newest explicit reader instruction wins,
 * while a Book-style creative direction remains available before follow-ups.
 */
export function notebookCraftPreference(state: AgentState): CraftPreference {
  const signals = [
    state.taskBrief.goal,
    state.taskBrief.desiredOutcome,
    state.taskBrief.creativeDirection,
    ...state.conversation
      .filter((message) => message.role === 'user')
      .map((message) => message.text),
  ].filter((value): value is string => typeof value === 'string' && value.trim() !== '');
  let preference: CraftPreference = 'composed';
  for (const signal of signals) preference = explicitPreference(signal) ?? preference;
  return preference;
}

function requiredCraft(pageCount: number): {
  readonly features: number;
  readonly roles: number;
  readonly pages: number;
} {
  if (pageCount < 2) return { features: 0, roles: 0, pages: 0 };
  return {
    features: Math.min(4, Math.ceil(pageCount / 2)),
    roles: pageCount === 2 ? 1 : 2,
    pages: pageCount === 2 ? 1 : Math.min(3, Math.ceil(pageCount / 2)),
  };
}

function subjectSpecificRepair(script: string): string {
  if (/\b(?:versus|vs\.?|compare|comparison|contrast|differences?|similarities?)\b/iu.test(script)) {
    return 'For this comparison, a compact table or parallel columns can carry the contrast, with a callout, reveal, or diagram for the main takeaway.';
  }
  if (/\b(?:first|next|then|finally|before|after|process|stages?|steps?|history|chronology)\b/iu.test(script)) {
    return 'For this sequence, use a timeline or flowchart for the progression, then a callout, card, or reveal for the consequence or recall check.';
  }
  if (/\b(?:equation|formula|algorithm|code|function|theorem|proof|calculation)\b/iu.test(script)) {
    return 'For this technical material, use the native code, maths, table, or relationship-diagram block that explains the content, plus a focused example or caution card.';
  }
  return 'Choose structures that match the content—for example a comparison table, parallel columns, relationship diagram, focused callout, or revealable recall check.';
}

interface OuterDocumentFence {
  readonly body: string;
  readonly language: string;
}

function outerDocumentFence(script: string): OuterDocumentFence | null {
  const trimmed = script.trim();
  const firstBreak = trimmed.indexOf('\n');
  const lastBreak = trimmed.lastIndexOf('\n');
  if (firstBreak < 0 || lastBreak <= firstBreak) return null;
  const opening = trimmed.slice(0, firstBreak).trim().match(/^(`{3,}|~{3,})\s*([\w-]*)\s*$/u);
  if (opening === null) return null;
  const fence = opening[1]!;
  const language = opening[2]!.toLowerCase();
  if (!['', 'md', 'markdown', 'text', 'plaintext', 'notebook', 'notebook-script'].includes(language)) {
    return null;
  }
  const closing = trimmed.slice(lastBreak + 1).trim();
  if (closing !== fence) return null;
  const body = trimmed.slice(firstBreak + 1, lastBreak).replace(/\r$/u, '');
  if (['md', 'markdown', 'notebook', 'notebook-script'].includes(language)) {
    return { body, language };
  }
  const hasNotebookOnlySyntax = /^(?:\s*::page\s*|\s*:::\s*[\w-]+(?:\s|\{|$))$/mu.test(body);
  const hasHeading = /^\s*#{1,3}\s+\S/mu.test(body);
  const hasListOrTable = /^\s*(?:[-+*]\s+\S|\d+[.)]\s+\S|\|.+\|\s*$)/mu.test(body);
  if (!hasNotebookOnlySyntax && !(hasHeading && hasListOrTable)) return null;
  return { body, language };
}

/**
 * Cohere occasionally encloses a complete document in the same Markdown fence
 * used for chat presentation. For explicit document-language fences only, the
 * submit boundary can remove that unambiguous envelope locally instead of
 * spending a provider repair turn. Bare/text fences stay fail-closed because
 * they may be intentional source examples.
 */
export function normalizeNotebookScriptSubmission(script: string): {
  readonly script: string;
  readonly outerDocumentFenceRemoved: boolean;
} {
  const outer = outerDocumentFence(script);
  if (
    outer === null ||
    !['md', 'markdown', 'notebook', 'notebook-script'].includes(outer.language)
  ) {
    return { script, outerDocumentFenceRemoved: false };
  }
  return { script: outer.body, outerDocumentFenceRemoved: true };
}

function wholeScriptFenceDiagnostic(script: string): NotebookScriptDiagnostic | null {
  if (outerDocumentFence(script) === null) return null;
  return {
    severity: 'error',
    code: 'craft.whole-script-code-fence',
    message:
      'The entire Notebook Script is wrapped in a Markdown/code fence, so headings, emphasis, lists, tables, containers and page markers would render as literal source text. Remove only the outer opening and closing fence; keep intentional inner diagram or code fences around their own payloads.',
  };
}

/**
 * Parseability is necessary but not sufficient for an ordinary multi-page AI
 * note. This gate rejects the repeated heading/list template before the model
 * spends a render and visual-review pass on it.
 */
export function notebookCraftDiagnostics(
  script: string,
  state: AgentState,
  renderedPageCount?: number,
): readonly NotebookScriptDiagnostic[] {
  const wrapper = wholeScriptFenceDiagnostic(script);
  if (wrapper !== null) return [wrapper];
  if (notebookCraftPreference(state) === 'plain') return [];
  const profile = notebookCraftProfile(script);
  // Native pagination may turn one authored section into several real leaves.
  // Use the larger rendered count once it is known so a long headings/lists
  // document cannot bypass the quality floor merely by omitting `::page`.
  const effectivePageCount = Math.max(profile.pageCount, renderedPageCount ?? 0);
  const required = requiredCraft(effectivePageCount);
  // Source offsets do not currently map catalogue blocks to spill leaves. We
  // can still enforce the total structures/roles precisely and require them
  // across every authored section that could be proved from the script.
  const requiredAuthoredPages = Math.min(required.pages, profile.pageCount);
  if (
    profile.features.length >= required.features &&
    profile.roles.length >= required.roles &&
    profile.featuredPageNumbers.length >= requiredAuthoredPages
  ) {
    return [];
  }
  if (required.features === 0) return [];
  return [{
    severity: 'error',
    code: 'craft.semantic-variety-required',
    message: [
      effectivePageCount === profile.pageCount
        ? `This ${profile.pageCount}-page draft uses ${profile.features.length} meaning-bearing catalogue structure${profile.features.length === 1 ? '' : 's'} in ${profile.roles.length} semantic role${profile.roles.length === 1 ? '' : 's'} across ${profile.featuredPageNumbers.length} page${profile.featuredPageNumbers.length === 1 ? '' : 's'}; it needs at least ${required.features} structures in ${required.roles} different roles across ${required.pages} pages.`
        : `Native pagination expanded this ${profile.pageCount}-section draft to ${effectivePageCount} real pages, but it uses ${profile.features.length} meaning-bearing catalogue structure${profile.features.length === 1 ? '' : 's'} in ${profile.roles.length} semantic role${profile.roles.length === 1 ? '' : 's'}; a ${effectivePageCount}-page result needs at least ${required.features} structures in ${required.roles} different roles.`,
      'Headings, paragraphs, ordinary lists, stickers, colour and paper styling alone do not count.',
      subjectSpecificRepair(script),
      'Use only native Notebook Script blocks that improve meaning. External image placeholders or generation prompts are not required and must stay absent unless the reader explicitly requested them.',
    ].join(' '),
  }];
}

/** Attach craft diagnostics to the same immutable validation receipt. */
export function withNotebookCraftValidation(
  validation: NotebookScriptValidation,
  script: string,
  state: AgentState,
  renderedPageCount?: number,
): NotebookScriptValidation {
  const staticDiagnostics = [
    ...validation.staticDiagnostics.filter(
      (diagnostic) => !diagnostic.code.startsWith('craft.'),
    ),
    ...notebookCraftDiagnostics(script, state, renderedPageCount),
  ];
  return {
    ...validation,
    staticDiagnostics,
    valid: [
      ...validation.parserDiagnostics,
      ...staticDiagnostics,
      ...validation.imageDiagnostics,
      ...validation.pageLedgerDiagnostics,
    ].every((diagnostic) => diagnostic.severity !== 'error'),
  };
}
