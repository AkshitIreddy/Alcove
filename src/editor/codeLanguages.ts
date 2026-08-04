/**
 * src/editor/codeLanguages.ts — the LANGUAGE vocabulary for code blocks.
 *
 * `src/script/vocab.ts` owns the ids (`CODE_LANGS`), because the fence
 * grammar and the highlighter have to know the same set or a note round-trips
 * into a language nobody can colour. This module owns everything a READER
 * sees about them: the word on the picker chip, the shelf it is filed on, how
 * far one press of Tab moves, and whether a newline after `:` should indent.
 *
 * `LANGUAGE_META` is a `Record<CodeLangName, …>`, so TypeScript refuses to
 * compile a language added to the script vocabulary and left undescribed
 * here. That is the same trick `vocab.ts` uses on its own doc tables, and for
 * the same reason: a list that can silently go half-filled always does.
 *
 * ## Tier, order and the shortlist
 *
 * Every entry declares a `tier`, exactly as the carpentry, the bindings and
 * the appearance vocabulary do, and the exported order is DERIVED from
 * group-then-tier rather than typed out. `CODE_LANGUAGE_SHORTLIST` is the
 * signatures alone — the handful the slash menu offers by name, because a flat
 * list of eighty languages in a command palette is a menu you scroll rather
 * than a menu you read. The block's own picker (`CODE_LANGUAGE_CHOICES`, at
 * the foot of this file) shows all of them and hands the reader a search
 * field, which is how every other long list in this app is browsed.
 *
 * ## Indentation
 *
 * `indent` is how many spaces one step is worth, and `0` means a real tab
 * character. Those are not opinions — Go, Makefiles and Gherkin are tab
 * languages (a Makefile with spaces in front of a recipe does not run), and
 * the four-space languages are four because their own formatters say so.
 * `offside` marks the languages where a line ending in `:` opens a block,
 * which is the difference between an editor that helps and one that fights.
 */

import { CODE_LANGS, type CodeLangName } from '../script/vocab';

export { type CodeLangName };

/* ============================== the shelves =============================== */

export const CODE_LANGUAGE_GROUPS = [
  'everyday',
  'web',
  'shell',
  'shelf',
] as const;
export type CodeLanguageGroup = (typeof CODE_LANGUAGE_GROUPS)[number];

const CODE_GROUP_LABELS: Readonly<Record<CodeLanguageGroup, string>> = {
  everyday: 'the everyday ones',
  web: 'the web, and what it carries',
  shell: 'shells, builds and config',
  shelf: 'the rest of the shelf',
};

const CODE_LANGUAGE_TIERS = [
  'signature',
  'shelf',
  'niche',
  'oddity',
] as const;
type CodeLanguageTier = (typeof CODE_LANGUAGE_TIERS)[number];

export interface CodeLanguageSpec {
  /** Canonical id — a highlight.js language name, and what `language` stores. */
  readonly id: CodeLangName;
  /** What the picker chip says. */
  readonly label: string;
  readonly group: CodeLanguageGroup;
  readonly tier: CodeLanguageTier;
  /** Spaces one indent step is worth. `0` means one real tab character. */
  readonly indent: number;
  /** A line ending in `:` opens a block (Python, YAML, and the like). */
  readonly offside?: true;
  /** `do` / `then` / `begin` open a block (Ruby, Lua, shell, Elixir…). */
  readonly wordBlocks?: true;
  /** The line comment marker, for the comment-toggle shortcut. */
  readonly comment: string;
}

type Meta = Omit<CodeLanguageSpec, 'id'>;

/** Terse constructor — this table is scanned far more often than it is edited. */
function m(
  label: string,
  group: CodeLanguageGroup,
  tier: CodeLanguageTier,
  indent: number,
  comment: string,
  extra: Pick<Meta, 'offside' | 'wordBlocks'> = {},
): Meta {
  return { label, group, tier, indent, comment, ...extra };
}

const CURLY = '//';
const HASH = '#';
const DASHES = '--';
const SEMI = ';';

/**
 * Every language, described.
 *
 * The `Record<CodeLangName, Meta>` annotation is load-bearing: adding an id to
 * `CODE_LANGS` and forgetting this table is a compile error rather than a
 * language that shows up in the picker with no name on its chip.
 */
const LANGUAGE_META: Readonly<Record<CodeLangName, Meta>> = {
  /* ---------------------------- the everyday ones ------------------------ */
  plaintext: m('plain', 'everyday', 'signature', 2, HASH),
  javascript: m('javascript', 'everyday', 'signature', 2, CURLY),
  typescript: m('typescript', 'everyday', 'signature', 2, CURLY),
  python: m('python', 'everyday', 'signature', 4, HASH, { offside: true }),
  rust: m('rust', 'everyday', 'signature', 4, CURLY),
  go: m('go', 'everyday', 'signature', 0, CURLY),
  java: m('java', 'everyday', 'shelf', 4, CURLY),
  csharp: m('c#', 'everyday', 'shelf', 4, CURLY),
  cpp: m('c++', 'everyday', 'shelf', 4, CURLY),
  c: m('c', 'everyday', 'shelf', 4, CURLY),
  ruby: m('ruby', 'everyday', 'shelf', 2, HASH, { wordBlocks: true }),
  php: m('php', 'everyday', 'shelf', 4, CURLY),
  swift: m('swift', 'everyday', 'shelf', 4, CURLY),
  kotlin: m('kotlin', 'everyday', 'shelf', 4, CURLY),
  sql: m('sql', 'everyday', 'signature', 2, DASHES),

  /* --------------------- the web, and what it carries -------------------- */
  html: m('html', 'web', 'signature', 2, '<!--'),
  css: m('css', 'web', 'signature', 2, CURLY),
  scss: m('scss / sass', 'web', 'shelf', 2, CURLY),
  less: m('less', 'web', 'niche', 2, CURLY),
  json: m('json', 'web', 'signature', 2, CURLY),
  yaml: m('yaml', 'web', 'signature', 2, HASH, { offside: true }),
  xml: m('xml / svg', 'web', 'shelf', 2, '<!--'),
  graphql: m('graphql', 'web', 'shelf', 2, HASH),
  markdown: m('markdown', 'web', 'shelf', 2, '<!--'),
  diff: m('a diff', 'web', 'shelf', 2, HASH),

  /* --------------------- shells, builds and config ----------------------- */
  bash: m('bash / shell', 'shell', 'signature', 2, HASH, { wordBlocks: true }),
  powershell: m('powershell', 'shell', 'shelf', 4, HASH),
  dos: m('cmd / batch', 'shell', 'niche', 4, '::'),
  makefile: m('makefile', 'shell', 'shelf', 0, HASH),
  dockerfile: m('dockerfile', 'shell', 'shelf', 4, HASH),
  ini: m('ini / toml', 'shell', 'shelf', 2, HASH),
  nginx: m('nginx', 'shell', 'niche', 4, HASH),
  http: m('http', 'shell', 'niche', 2, HASH),
  cmake: m('cmake', 'shell', 'niche', 2, HASH),
  gradle: m('gradle', 'shell', 'niche', 4, CURLY),

  /* ------------------------- the rest of the shelf ----------------------- */
  dart: m('dart', 'shelf', 'shelf', 2, CURLY),
  scala: m('scala', 'shelf', 'shelf', 2, CURLY),
  elixir: m('elixir', 'shelf', 'shelf', 2, HASH, { wordBlocks: true }),
  erlang: m('erlang', 'shelf', 'niche', 4, '%'),
  haskell: m('haskell', 'shelf', 'shelf', 2, DASHES, { offside: true }),
  clojure: m('clojure', 'shelf', 'shelf', 2, SEMI),
  lisp: m('lisp', 'shelf', 'niche', 2, SEMI),
  scheme: m('scheme / racket', 'shelf', 'niche', 2, SEMI),
  ocaml: m('ocaml', 'shelf', 'niche', 2, '(*'),
  fsharp: m('f#', 'shelf', 'niche', 4, CURLY, { offside: true }),
  lua: m('lua', 'shelf', 'shelf', 2, DASHES, { wordBlocks: true }),
  perl: m('perl', 'shelf', 'niche', 4, HASH),
  r: m('r', 'shelf', 'shelf', 2, HASH),
  julia: m('julia', 'shelf', 'niche', 4, HASH, { wordBlocks: true }),
  matlab: m('matlab / octave', 'shelf', 'niche', 4, '%'),
  groovy: m('groovy', 'shelf', 'niche', 4, CURLY),
  objectivec: m('objective-c', 'shelf', 'niche', 4, CURLY),
  vbnet: m('visual basic', 'shelf', 'niche', 4, "'"),
  delphi: m('pascal / delphi', 'shelf', 'niche', 2, CURLY),
  fortran: m('fortran', 'shelf', 'oddity', 2, '!'),
  nim: m('nim', 'shelf', 'niche', 2, HASH, { offside: true }),
  crystal: m('crystal', 'shelf', 'niche', 2, HASH, { wordBlocks: true }),
  elm: m('elm', 'shelf', 'niche', 4, DASHES),
  haxe: m('haxe', 'shelf', 'oddity', 4, CURLY),
  coffeescript: m('coffeescript', 'shelf', 'oddity', 2, HASH, { offside: true }),
  nix: m('nix', 'shelf', 'niche', 2, HASH),
  protobuf: m('protobuf', 'shelf', 'niche', 2, CURLY),
  latex: m('latex', 'shelf', 'shelf', 2, '%'),
  gherkin: m('gherkin', 'shelf', 'niche', 0, HASH),
  wasm: m('webassembly', 'shelf', 'oddity', 2, SEMI),
  llvm: m('llvm ir', 'shelf', 'oddity', 2, SEMI),
  x86asm: m('assembly', 'shelf', 'oddity', 4, SEMI),
  verilog: m('verilog', 'shelf', 'oddity', 2, CURLY),
  vhdl: m('vhdl', 'shelf', 'oddity', 2, DASHES),
  gcode: m('g-code', 'shelf', 'oddity', 2, SEMI),
  brainfuck: m('brainfuck', 'shelf', 'oddity', 2, HASH),
};

/* ========================= order, lookup, resolution ====================== */

const TIER_RANK = new Map(CODE_LANGUAGE_TIERS.map((t, i) => [t, i] as const));

/**
 * Group run first, then tier inside it — DERIVED, never typed out.
 *
 * The same property `tests/plugged-in.test.ts` holds for the appearance
 * vocabulary: a hand-sorted array agrees with its tiers on the day it is
 * written and quietly stops agreeing the day an entry lands in the middle.
 */
const CODE_LANGUAGES: readonly CodeLanguageSpec[] = CODE_LANGS.map(
  (id) => ({ id, ...LANGUAGE_META[id] }),
).sort((a, b) => {
  const group =
    CODE_LANGUAGE_GROUPS.indexOf(a.group) - CODE_LANGUAGE_GROUPS.indexOf(b.group);
  if (group !== 0) return group;
  const tier = (TIER_RANK.get(a.tier) ?? 0) - (TIER_RANK.get(b.tier) ?? 0);
  if (tier !== 0) return tier;
  return a.label.localeCompare(b.label);
});

const BY_ID = new Map(CODE_LANGUAGES.map((spec) => [spec.id, spec] as const));

/** The language a block with nothing chosen is treated as. */
const FALLBACK_LANGUAGE: CodeLanguageSpec = BY_ID.get(
  'plaintext',
) as CodeLanguageSpec;

/**
 * Total. Junk out of SQLite, or a language this app cannot colour, gives
 * plain text — never a throw inside a repaint.
 */
export function resolveLanguage(
  id: string | null | undefined,
): CodeLanguageSpec {
  return BY_ID.get((id ?? '') as CodeLangName) ?? FALLBACK_LANGUAGE;
}

/** The word to show for a block's stored language, `auto` included. */
export function languageLabel(id: string | null | undefined): string {
  if (id === null || id === undefined || id === '') return 'auto';
  return BY_ID.get(id as CodeLangName)?.label ?? id;
}

/** What the picker shows before the reader asks for the rest. */
export const CODE_LANGUAGE_SHORTLIST: readonly CodeLanguageSpec[] =
  CODE_LANGUAGES.filter((spec) => spec.tier === 'signature');

/**
 * The subset `highlightAuto` is allowed to guess from.
 *
 * Auto-detection over eighty grammars is both slower and worse: highlight.js
 * scores by keyword density, and given six lines it will happily decide a
 * shell script is Awk. Restricting it to the languages people actually paste
 * makes the guess boring, which is the correct behaviour for a guess.
 */
export const AUTO_DETECT_SUBSET: readonly CodeLangName[] =
  CODE_LANGUAGE_SHORTLIST.filter((spec) => spec.id !== 'plaintext').map(
    (spec) => spec.id,
  );

/** One indent step for a language: its own spaces, or a real tab. */
export function indentUnit(id: string | null | undefined): string {
  const spec = resolveLanguage(id);
  return spec.indent === 0 ? '\t' : ' '.repeat(spec.indent);
}

/**
 * The languages grouped for the picker, in the derived order.
 *
 * Built here rather than in the node view so the panel and the block cannot
 * disagree about what is on which shelf.
 */
export interface CodeLanguageShelf {
  readonly group: CodeLanguageGroup;
  readonly title: string;
  readonly languages: readonly CodeLanguageSpec[];
}

export const CODE_LANGUAGE_SHELVES: readonly CodeLanguageShelf[] =
  CODE_LANGUAGE_GROUPS.map((group) => ({
    group,
    title: CODE_GROUP_LABELS[group],
    languages: CODE_LANGUAGES.filter((spec) => spec.group === group),
  })).filter((shelf) => shelf.languages.length > 0);

/* =============================== the picker =============================== */

/**
 * One ROW of the language picker — the shelves flattened, `auto` included.
 *
 * The picker walks a flat list because its keyboard does: an index that means
 * the same thing to ArrowDown, to `aria-activedescendant` and to Enter cannot
 * be a position inside one of four nested arrays. The shelf heading is carried
 * on the row instead, and the card starts a new section wherever it changes.
 */
export interface CodeLanguageChoice {
  /** `null` is the `auto` row: no language stored, the highlighter guesses. */
  readonly id: CodeLangName | null;
  readonly label: string;
  /** One line under the name — what choosing this actually buys. */
  readonly note: string;
  /** The heading this row sits under. Empty for the `auto` row. */
  readonly shelf: string;
  /** Everything a search should match, pre-folded. */
  readonly haystack: string;
}

/** How wide one press of Tab is, said in the reader's units rather than mine. */
function indentWords(spec: CodeLanguageSpec): string {
  return spec.indent === 0 ? 'a real tab' : `${spec.indent} spaces`;
}

/**
 * Lowercase, plus a punctuation-stripped copy of the same words.
 *
 * BOTH, because the two halves catch different searches and neither catches
 * the other's: `c#` and `c++` only survive with the punctuation kept, and
 * "objective c" only finds `objective-c` with it gone.
 */
function haystack(...parts: readonly string[]): string {
  const raw = parts.join(' ').toLowerCase();
  return `${raw} ${raw.replace(/[^a-z0-9]+/g, ' ')}`;
}

export const CODE_LANGUAGE_CHOICES: readonly CodeLanguageChoice[] = [
  {
    id: null,
    label: 'auto',
    note: 'let the highlighter work it out',
    shelf: '',
    haystack: haystack('auto automatic guess detect plain none'),
  },
  ...CODE_LANGUAGE_SHELVES.flatMap((shelf) =>
    shelf.languages.map((spec) => ({
      id: spec.id,
      label: spec.label,
      note: `${indentWords(spec)} · ${spec.comment} comments`,
      shelf: shelf.title,
      haystack: haystack(spec.label, spec.id, shelf.title),
    })),
  ),
];

/**
 * The rows a query matches, in the vocabulary's own order.
 *
 * Every word has to hit somewhere, which is the same rule `DesignPicker`
 * searches its sixty rooms by — "shell config" finds bash without either word
 * being in its name. An empty query is the whole list rather than nothing,
 * because the picker opens on it.
 */
export function filterCodeLanguages(
  query: string,
): readonly CodeLanguageChoice[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return CODE_LANGUAGE_CHOICES;
  return CODE_LANGUAGE_CHOICES.filter((row) =>
    words.every((word) => row.haystack.includes(word)),
  );
}
