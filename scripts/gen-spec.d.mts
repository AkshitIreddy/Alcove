/**
 * Types for scripts/gen-spec.mjs — the spec generator is plain ESM so it can
 * run from `npm run spec` without a build step, but tests/script/
 * spec-generated.test.ts imports it, and this is the contract it imports.
 */

/** The vocabulary module the spec is generated from. */
export type SpecVocab = typeof import('../src/script/vocab');

export const ROOT: string;
export const TEMPLATE_PATH: string;
export const VOCAB_PATH: string;
export const SPEC_MD_PATH: string;
export const SPEC_TS_PATH: string;

/** name → the markdown each `<!-- gen:name -->` placeholder expands to. */
export const REGIONS: Record<string, (vocab: SpecVocab) => string>;

/** Render the template against the vocabulary. Throws on an orphan region. */
export function buildSpec(vocab: SpecVocab, template: string): string;

/** The frontend copy: the same markdown as one exported string literal. */
export function renderSpecModule(md: string): string;

/** Names the parser knows that the generated spec never mentions. */
export function missingFromSpec(vocab: SpecVocab, md: string): string[];

/** First differing lines, as `want`/`have` pairs ready to print. */
export function firstDifferences(want: string, have: string, limit?: number): string[];
