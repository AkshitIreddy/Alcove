/**
 * src/features/packs/schema.ts — what a reader-supplied pack IS, written down
 * ONCE, as data.
 *
 * The reader asked for this:
 *
 *   "option for user to add their own customisation options like textures or
 *    effects or sound whatever, when uploading for category it will open a
 *    popup with upload button information on how to do it along with a custom
 *    ai prompt they give to an ai that will tell it the specifications of how
 *    to build and package it for the user to upload it here"
 *
 * Three surfaces come out of that sentence — an importer, a page of human
 * instructions, and a prompt a model can be handed — and the only way they
 * stay in agreement is if none of them is written by hand. So this file is
 * the single description, and the other three are DERIVED:
 *
 *      schema.ts (this file)
 *            │
 *            ├── validate.ts   what the importer accepts
 *            ├── prompt.ts     what the AI is told to produce
 *            └── PackDialog    what the reader is told to do
 *
 * The failure this prevents is specific and has happened elsewhere in this
 * tree: `CataloguePanel` once read the script vocabulary while the editor read
 * its own, and forty-five values per axis existed, validated, rendered, and
 * could not be reached from any menu. A prompt maintained beside a validator
 * drifts exactly like that, except the reader finds out by pasting a file that
 * a model produced correctly and being told it is wrong.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE ENUM VALUES ARE NOT WRITTEN HERE
 * ─────────────────────────────────────────────────────────────────────────
 * `categories.ts` fills every `EnumField.values` straight from the vocabulary
 * module that owns it — `WALLPAPER_PATTERNS`, `BUILD_IDS`, `FAMILY_NAMES`.
 * A copied list is a list that goes stale the first time somebody adds a
 * fifty-first motif, and the reader's model would be told about fifty.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * TWO KINDS OF INTAKE
 * ─────────────────────────────────────────────────────────────────────────
 * A pack is either a MANIFEST (one JSON file, which a model can write in full)
 * or FILES (bytes a model cannot emit — audio). The distinction is not
 * cosmetic: it changes what the prompt asks for. A manifest prompt asks for
 * JSON; a files prompt asks for a self-contained script that WRITES the files,
 * which is the honest way to get audio out of a chat window and is how this
 * repo's own cues are made (`scripts/gen-sounds.mjs`).
 */

/**
 * The number in `"alcovePack": 1`.
 *
 * Bumped only when an older file would import WRONGLY rather than merely
 * incompletely — the validator already reports a missing field by name, so
 * adding an optional one is not a format change.
 */
export const PACK_FORMAT = 1;

/** Every category the importer knows a shape for. */
export type PackCategoryId = 'wallpaper' | 'carpentry' | 'sticker' | 'sound';

/** JSON a model can write, or bytes it can only write a script for. */
export type PackIntake = 'manifest' | 'files';

/* ========================================================================== *
 *                              fields on an item                             *
 * ========================================================================== */

interface FieldBase {
  /** The JSON key, exactly as it must appear. */
  readonly key: string;
  /** What it is, in the app's own words. Printed to the reader AND the model. */
  readonly label: string;
  readonly required: boolean;
  /** One extra line of guidance, when the label alone would mislead. */
  readonly note?: string;
}

export interface TextField extends FieldBase {
  readonly kind: 'text';
  readonly maxLength: number;
}

export interface EnumField extends FieldBase {
  readonly kind: 'enum';
  /** Filled from the owning vocabulary module — never typed out here. */
  readonly values: readonly string[];
}

export interface SvgField extends FieldBase {
  readonly kind: 'svg';
  readonly maxBytes: number;
}

export type PackField = TextField | EnumField | SvgField;

/* ========================================================================== *
 *                            files, for audio packs                          *
 * ========================================================================== */

/** One file the reader is expected to supply, and what it is for. */
export interface FileNaming {
  /** The exact stem that always works — no guessing, no aliases needed. */
  readonly name: string;
  /** What the app plays it for, in plain English. */
  readonly label: string;
  /** Other stems the matcher accepts for the same slot. */
  readonly alsoAccepts: readonly string[];
}

export interface FileIntake {
  readonly extensions: readonly string[];
  readonly maxBytes: number;
  readonly naming: readonly FileNaming[];
  /**
   * Every slot is optional, and saying so is the difference between a feature
   * somebody finishes and one they abandon.
   */
  readonly partialIsFine: true;
}

/* ========================================================================== *
 *                                a category                                  *
 * ========================================================================== */

export interface PackCategory {
  readonly id: PackCategoryId;
  /** Title case, for the dialog heading. */
  readonly title: string;
  /** "wallpaper" — used in sentences the dialog builds. */
  readonly noun: string;
  /** "wallpapers". */
  readonly plural: string;
  /** One line: what this category adds to the app. */
  readonly blurb: string;
  readonly intake: PackIntake;
  /** What the model should call the file it hands back. */
  readonly fileName: string;
  /** Ceiling on one pack, so a runaway generation is refused, not absorbed. */
  readonly maxItems: number;
  /** Per-item fields. Empty for a files category. */
  readonly fields: readonly PackField[];
  /** Present exactly when `intake` is 'files'. */
  readonly files?: FileIntake;
  /** Numbered steps a person follows, with no model involved at all. */
  readonly howTo: readonly string[];
  /** Rules the validator really enforces, stated so the model can obey them. */
  readonly rules: readonly string[];
  /** Taste, not correctness — what separates a good pack from a valid one. */
  readonly craft: readonly string[];
  /**
   * Items that MUST validate. `tests/packs.test.ts` pulls this back out of the
   * generated prompt and runs it through the importer, which is what stops the
   * example from being aspirational.
   */
  readonly example: readonly Record<string, unknown>[];
  /** The honest limitation, said out loud in the dialog rather than hidden. */
  readonly caveat: string;
}

/* ========================================================================== *
 *                     categories that are NOT supported yet                  *
 * ========================================================================== */

/* ========================================================================== *
 *                          problems, in plain English                        *
 * ========================================================================== */

/**
 * One reason a pack was refused.
 *
 * `where` is a JSON path the reader can find with their eyes — `items[3].ink`
 * — because "invalid pack" with no location is a message that makes somebody
 * delete the file and give up.
 */
export interface PackProblem {
  readonly where: string;
  readonly message: string;
}

/**
 * The importer's answer. All-or-nothing on purpose: the brief's words were
 * "a pack that silently half-imports is worse than a rejection", and a reader
 * who gets eleven of twelve wallpapers with no idea which one is missing has
 * no way to fix their file.
 */
export type PackCheck<T> =
  | { readonly ok: true; readonly pack: T; readonly notes: readonly string[] }
  | { readonly ok: false; readonly problems: readonly PackProblem[] };

/* ========================================================================== *
 *                             small pure helpers                             *
 * ========================================================================== */

/**
 * Levenshtein distance, capped — used only to say "did you mean 'herringbone'"
 * when a model writes 'herringbones'.
 *
 * Iterative single-row, because these run over a hundred-odd short words per
 * bad field and a matrix would be the only allocation in the whole validator.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let row: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const next: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(next[j - 1]! + 1, row[j]! + 1, row[j - 1]! + cost);
    }
    row = next;
  }
  return row[b.length]!;
}

/**
 * The closest allowed value to what was written, or null when nothing is
 * close enough to be worth suggesting.
 *
 * The threshold matters. Suggesting "bee" for "gradient" is worse than
 * suggesting nothing: it reads as though the app half-understood, and sends
 * the reader to fix a word that was never nearly right.
 */
export function nearestValue(
  written: string,
  values: readonly string[],
): string | null {
  const lower = written.toLowerCase();
  let best: { value: string; distance: number } | null = null;
  for (const value of values) {
    const distance = editDistance(lower, value.toLowerCase());
    if (best === null || distance < best.distance) best = { value, distance };
  }
  if (best === null) return null;
  const limit = Math.max(1, Math.floor(Math.max(lower.length, best.value.length) / 3));
  return best.distance <= limit ? best.value : null;
}

/** `pattern`, `scale`, `ink` — for "the fields here are …". */
export function fieldKeys(category: PackCategory): readonly string[] {
  return category.fields.map((f) => f.key);
}

/** A one-line description of what a field will accept. */
export function fieldSummary(field: PackField): string {
  switch (field.kind) {
    case 'text':
      return `text, up to ${field.maxLength} characters`;
    case 'enum':
      return `one of ${field.values.length} words`;
    case 'svg':
      return `SVG source, up to ${Math.round(field.maxBytes / 1024)} KB`;
  }
}
