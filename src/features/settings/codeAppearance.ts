/**
 * src/features/settings/codeAppearance.ts — how a code block LOOKS.
 *
 * `appearance.ts` is the fifth vocabulary in this app (the paper, the ink, the
 * hand and the room). This is the sixth, and it exists because the reader
 * asked for the look of code to be theirs: *"colours for the code and what not
 * needed for displaying programming code, and customising how it looks in
 * settings"*.
 *
 * ## Not a stock IDE theme, and why not
 *
 * The obvious move is to drop in Dracula or Solarized and be done. It would
 * be wrong here in the same specific way a photoreal wood texture was wrong on
 * the bookcase: those palettes are built for a full-screen editor on a black
 * or blue-grey field, at chroma levels that are correct against #282a36 and
 * garish against warm cream. Put one on this page and the code block stops
 * being part of the drawing — it becomes a screenshot lying on it.
 *
 * So every theme here is built out of THIS app's palette (`styles/tokens.css`
 * and the wash pigments the whole interface is painted from), and each one is
 * a flat plate with one ink outline, exactly like every other object.
 *
 * ## What is authored and what is derived
 *
 * Authored per theme: which paper rung (or which flat plate) the code sits on,
 * and seven PIGMENTS — one per token role. Nothing else.
 *
 * Everything else is solved, in OKLCh, by the same `solveInkOn` the reading
 * ink is solved by. Each pigment keeps its hue and chroma and moves only in
 * lightness, exactly as far as the plate under it demands and no further. That
 * is what makes it safe to offer thirty rooms × thirty-four inks × twenty-two
 * code themes without shipping an unreadable one, and it is the difference
 * between this and a stock theme: a stock theme has ONE ground, and the moment
 * the reader picks kraft board or the night room it is measuring itself
 * against a page it has never seen.
 *
 * Comments in particular are solved to the SAME floor as everything else.
 * Nearly every IDE theme fails WCAG on its comment colour — grey on grey is
 * the genre's signature — and a comment is prose a human wrote for a human,
 * which makes it the last thing that should be hard to read.
 *
 * `tests/code-appearance.test.ts` measures all of it, every theme against
 * every room and every ink.
 */

import { mixOklab, lum, toHex, toOklch } from '../../art/palette';
import {
  contrastRatio,
  pageGrounds,
  resolveInk,
  solveInkOn,
  solveLuminance,
  type PageGrounds,
} from './appearance';

/* ================================= shape ================================= */

const CODE_THEME_TIERS = ['signature', 'shelf', 'niche', 'oddity'] as const;
type CodeThemeTier = (typeof CODE_THEME_TIERS)[number];

export const CODE_THEME_FAMILIES = ['paper', 'tinted', 'plate', 'quiet'] as const;
export type CodeThemeFamily = (typeof CODE_THEME_FAMILIES)[number];

export const CODE_FAMILY_LABELS: Readonly<Record<CodeThemeFamily, string>> = {
  paper: 'on the page itself',
  tinted: 'a tinted panel',
  plate: 'a dark plate',
  quiet: 'barely coloured',
};

export const CODE_FAMILY_BLURBS: Readonly<Record<CodeThemeFamily, string>> = {
  paper: 'the block is the same stock as the page, one rung down',
  tinted: 'a panel washed in one pigment, still paper',
  plate: 'a flat dark card lying on the page — a printed listing',
  quiet: 'colour used sparingly, or hardly at all',
};

/**
 * The seven roles a token can play, and the hljs classes behind each.
 *
 * Seven rather than the thirty highlight.js emits, because a palette a reader
 * can hold in their head is worth more than one that distinguishes
 * `meta-string` from `string`. The mapping to real class names lives in
 * `styles/editor.css`, next to the rules that use them.
 */
export const CODE_ROLES = [
  'comment',
  'keyword',
  'string',
  'number',
  'name',
  'type',
  'attr',
] as const;
export type CodeRole = (typeof CODE_ROLES)[number];

export const CODE_ROLE_LABELS: Readonly<Record<CodeRole, string>> = {
  comment: 'comments',
  keyword: 'keywords',
  string: 'strings',
  number: 'numbers',
  name: 'names',
  type: 'types',
  attr: 'attributes',
};

/** Where a theme's plate comes from. */
type Plate =
  /** A rung of the page's own paper. */
  | { readonly rung: keyof Omit<PageGrounds, 'dark'> }
  /** A flat colour of its own, re-solved so it always reads against the page. */
  | { readonly fill: string };

export interface CodeThemeSpec {
  readonly id: string;
  readonly label: string;
  readonly blurb: string;
  readonly family: CodeThemeFamily;
  readonly tier: CodeThemeTier;
  readonly plate: Plate;
  /** The pigment for each role. Hue is the promise; lightness is solved. */
  readonly pigments: Readonly<Record<CodeRole, string>>;
  /** The code's own default ink, when it should not simply be the page's. */
  readonly ink?: string;
}

/* =============================== the table =============================== */

/*
 * Every pigment below is a token in `styles/tokens.css` or a member of the
 * same value-and-chroma band. That is the rule the palette was built on
 * ("all twelve base faces sit in the SAME value and chroma band as
 * FLAT.terracotta") and it is why a code block painted from them reads as
 * part of the page rather than as a window onto another application.
 */
const T = {
  terracotta: '#96421d', // --wash-terracotta-deep
  moss: '#4f6138', // --wash-moss-deep
  amber: '#7d5806', // --wash-amber-deep
  sky: '#3a5666', // --wash-sky-deep
  plum: '#5c3448', // --wash-plum-deep
  blush: '#7c3b55', // --wash-blush-deep
  turquoise: '#2c5f56', // --wash-turquoise-deep
  violet: '#444063', // --wash-violet-deep
  lime: '#5c6a1c', // --wash-lime-deep
  coral: '#8f3319', // --wash-coral-deep
  lemon: '#786608', // --wash-lemon-deep
  gilt: '#6a4e0a', // --gilt-ink
  sepia: '#4f3120', // --ink-sepia
  graphite: '#3f3a33', // --ink-graphite
  ink: '#3c5a70', // --ink-blue
} as const;

function theme(
  id: string,
  label: string,
  family: CodeThemeFamily,
  tier: CodeThemeTier,
  plate: Plate,
  pigments: Readonly<Record<CodeRole, string>>,
  blurb: string,
  ink?: string,
): CodeThemeSpec {
  return { id, label, family, tier, plate, pigments, blurb, ...(ink ? { ink } : {}) };
}

/** Shorthand for the seven pigments, in `CODE_ROLES` order. */
const p = (
  comment: string,
  keyword: string,
  string_: string,
  number: string,
  name: string,
  type: string,
  attr: string,
): Readonly<Record<CodeRole, string>> => ({
  comment,
  keyword,
  string: string_,
  number,
  name,
  type,
  attr,
});

const AGED: Plate = { rung: 'aged' };
const DEEP: Plate = { rung: 'deep' };
const CREAM: Plate = { rung: 'cream' };

const CODE_THEME_TABLE: readonly CodeThemeSpec[] = [
  /* --------------------------- on the page itself ------------------------ */
  theme(
    'marginalia', 'marginalia', 'paper', 'signature', AGED,
    p(T.graphite, T.terracotta, T.moss, T.amber, T.sky, T.plum, T.turquoise),
    'the house code block — aged paper and the six wash pigments, one per part',
  ),
  theme(
    'foolscap', 'foolscap', 'paper', 'signature', CREAM,
    p(T.graphite, T.plum, T.moss, T.amber, T.sky, T.terracotta, T.turquoise),
    'no panel at all — the code sits straight on the sheet, ruled at the left',
  ),
  theme(
    'wellpaper', 'the well', 'paper', 'signature', DEEP,
    p(T.sepia, T.terracotta, T.moss, T.gilt, T.sky, T.plum, T.turquoise),
    'set into the page a rung deeper, the way a well or a track is',
  ),
  theme(
    'orchard', 'orchard', 'paper', 'shelf', AGED,
    p(T.graphite, T.coral, T.lime, T.amber, T.turquoise, T.terracotta, T.moss),
    'russet and windfall green, warm the whole way through',
  ),
  theme(
    'inkwell', 'inkwell', 'paper', 'shelf', AGED,
    p(T.graphite, T.ink, T.turquoise, T.violet, T.sky, T.plum, T.moss),
    'a blue-black fountain hand — cool, and quiet about it',
  ),
  theme(
    'botany', 'botany', 'paper', 'shelf', AGED,
    p(T.graphite, T.moss, T.turquoise, T.lime, T.amber, T.terracotta, T.sky),
    'a plant press: five greens and a terracotta pot',
  ),
  theme(
    'foxglove', 'foxglove', 'paper', 'niche', AGED,
    p(T.graphite, T.blush, T.moss, T.plum, T.violet, T.coral, T.turquoise),
    'bruised pinks and purples on warm stock',
  ),

  /* ---------------------------- a tinted panel --------------------------- */
  theme(
    'honeycomb', 'honeycomb', 'tinted', 'signature', { fill: '#f6e7c0' },
    p(T.sepia, T.terracotta, T.moss, T.gilt, T.sky, T.plum, T.turquoise),
    'wax-paper amber, the warmest panel here',
  ),
  theme(
    'blueprint', 'blueprint', 'tinted', 'signature', { fill: '#dbe6ef' },
    p(T.sky, T.ink, T.turquoise, T.violet, T.plum, T.terracotta, T.moss),
    'drafting blue, cool all through — a listing off a plan chest',
  ),
  theme(
    'fernhouse', 'fern house', 'tinted', 'shelf', { fill: '#e2ecd9' },
    p(T.moss, T.terracotta, T.turquoise, T.amber, T.sky, T.plum, T.lime),
    'glasshouse green under a warm accent',
  ),
  theme(
    'rosewater', 'rosewater', 'tinted', 'shelf', { fill: '#f4e2e6' },
    p(T.plum, T.blush, T.turquoise, T.coral, T.violet, T.moss, T.sky),
    'washed pink stock with a dusty rose keyword',
  ),
  theme(
    'ledgerpanel', 'ledger', 'tinted', 'shelf', { fill: '#e6ecda' },
    p(T.moss, T.terracotta, T.lime, T.gilt, T.sky, T.plum, T.turquoise),
    'accounts green — ruled paper, and a column that adds up',
  ),
  theme(
    'lilacpress', 'lilac press', 'tinted', 'niche', { fill: '#e9e3f1' },
    p(T.violet, T.plum, T.moss, T.blush, T.sky, T.terracotta, T.turquoise),
    'pale lilac, an evening panel',
  ),
  theme(
    'sandstone', 'sandstone', 'tinted', 'niche', { fill: '#ece0cb' },
    p(T.sepia, T.coral, T.moss, T.amber, T.turquoise, T.terracotta, T.sky),
    'dry warm stone, the quietest of the warm panels',
  ),

  /* ----------------------------- a dark plate ---------------------------- */
  theme(
    'lamplight', 'lamplight', 'plate', 'signature', { fill: '#2b211a' },
    p('#b9a58e', '#e2a06a', '#a8bd7c', '#e0c169', '#8fb6c6', '#c79cb1', '#7fc0b2'),
    'a flat dark card on the page — a printed listing, after the lamps',
    '#efe2cd',
  ),
  theme(
    'midnightplate', 'midnight', 'plate', 'signature', { fill: '#1f2530' },
    p('#9aa6b5', '#7fb0cc', '#8dc4a6', '#d8b06a', '#b6a4d8', '#dc9a9a', '#68bfae'),
    'ink-blue dark under a cold sea accent',
    '#e2e8ef',
  ),
  theme(
    'observatory', 'observatory', 'plate', 'shelf', { fill: '#1e2a2b' },
    p('#93a6a3', '#6fc0ae', '#b9c98a', '#e0bd76', '#8fbcd2', '#cf9ec0', '#dda57e'),
    'a green-black room lit by a sea-glass lamp',
    '#dfe9e5',
  ),
  theme(
    'cellar', 'cellar', 'plate', 'shelf', { fill: '#241f1c' },
    p('#ac9c8b', '#d9924f', '#b3bd7a', '#e5c476', '#93b8bd', '#c99aa4', '#8ec1a5'),
    'brown-black, oil-lamp warm — the least blue dark here',
    '#ece0d0',
  ),
  theme(
    'velvetplate', 'velvet', 'plate', 'niche', { fill: '#2a1f28' },
    p('#a996a4', '#d295ae', '#a4bf95', '#dfba72', '#9db3d1', '#c79ed6', '#77c1b4'),
    'a plum-black box with a blushed keyword',
    '#ebdde6',
  ),

  /* --------------------------- barely coloured --------------------------- */
  theme(
    'pencil', 'pencil', 'quiet', 'signature', AGED,
    p(T.graphite, T.graphite, T.graphite, T.graphite, T.graphite, T.graphite, T.graphite),
    'one grey pencil, weight and slope only — no colour at all',
  ),
  theme(
    'twotone', 'two tone', 'quiet', 'shelf', AGED,
    p(T.graphite, T.terracotta, T.moss, T.moss, T.sepia, T.terracotta, T.sepia),
    'a red pen and a green one, and nothing else',
  ),
  theme(
    'gilded', 'gilded', 'quiet', 'niche', DEEP,
    p(T.sepia, T.gilt, T.moss, T.gilt, T.sepia, T.gilt, T.moss),
    'gold on a deep rung, the way a spine is stamped',
  ),
];

/* ========================= order, lookup, defaults ======================== */

const TIER_RANK = new Map(CODE_THEME_TIERS.map((t, i) => [t, i] as const));

/** Family run first, then tier inside it — DERIVED, never typed out. */
export const CODE_THEMES: readonly CodeThemeSpec[] = [...CODE_THEME_TABLE].sort(
  (a, b) => {
    const family =
      CODE_THEME_FAMILIES.indexOf(a.family) - CODE_THEME_FAMILIES.indexOf(b.family);
    if (family !== 0) return family;
    return (TIER_RANK.get(a.tier) ?? 0) - (TIER_RANK.get(b.tier) ?? 0);
  },
);

const BY_ID = new Map(CODE_THEMES.map((t) => [t.id, t] as const));

/**
 * Two constants, not one — the carpentry's note applies word for word.
 *
 * `DEFAULT_CODE_THEME_ID` is what a new install opens on; `FALLBACK` is what a
 * junk row resolves to. Merging them means a corrupt value paints the handsome
 * default and a reader can no longer tell a fault from their own choice.
 */
export const DEFAULT_CODE_THEME_ID = 'marginalia';
export const FALLBACK_CODE_THEME_ID = 'pencil';

/** Total: junk out of SQLite gives the plain grey pencil, never a throw. */
export function resolveCodeTheme(id: string | null | undefined): CodeThemeSpec {
  return (
    BY_ID.get(id ?? '') ??
    BY_ID.get(FALLBACK_CODE_THEME_ID) ??
    (CODE_THEMES[0] as CodeThemeSpec)
  );
}

export const CODE_THEME_SHORTLIST: readonly CodeThemeSpec[] = CODE_THEMES.filter(
  (t) => t.tier === 'signature',
);

/** "Surprise me" never rolls an oddity — *"you dont have to be too cruel"*. */
export const CODE_THEME_ROLL: readonly CodeThemeSpec[] = CODE_THEMES.filter(
  (t) => t.tier !== 'oddity',
);

/* ============================ the other axes ============================= */

/**
 * How the block is DRAWN, which is a different question from what colour it
 * is — the same split the room has between its carpentry and its paint.
 *
 * Every one of these is inside the flat language: a fill, one ink outline,
 * corners that bow. None of them is a shadow, a bevel or a glow.
 */
export const CODE_FRAMES = ['plate', 'tab', 'rule', 'card', 'bare'] as const;
export type CodeFrame = (typeof CODE_FRAMES)[number];

export const CODE_FRAME_LABELS: Readonly<Record<CodeFrame, string>> = {
  plate: 'a plate',
  tab: 'a filing tab',
  rule: 'a margin rule',
  card: 'a pinned card',
  bare: 'nothing at all',
};

export const CODE_FRAME_BLURBS: Readonly<Record<CodeFrame, string>> = {
  plate: 'a flat panel with one ink outline, corners bowed',
  tab: 'the panel, with the language on a tab cut into its top edge',
  rule: 'no box — one thick pencil rule down the left, like a quotation',
  card: 'the panel, set a little askew, the way a card lies on a page',
  bare: 'just the code, in its own face — for notes that are mostly code',
};

export const DEFAULT_CODE_FRAME: CodeFrame = 'tab';
export const FALLBACK_CODE_FRAME: CodeFrame = 'plate';

export function resolveCodeFrame(id: string | null | undefined): CodeFrame {
  return CODE_FRAMES.includes(id as CodeFrame)
    ? (id as CodeFrame)
    : FALLBACK_CODE_FRAME;
}

/**
 * The face code is set in.
 *
 * Handwriting is not offered and never will be: a monospaced face is what
 * makes a column of code line up, and the app's own rule about never setting
 * a hand below 13px has a cousin here — never set code in a proportional
 * face, because `l`, `1` and `I` have to be told apart.
 */
export const CODE_FACES = ['system', 'cascadia', 'courier', 'ui'] as const;
export type CodeFace = (typeof CODE_FACES)[number];

export interface CodeFaceSpec {
  readonly id: CodeFace;
  readonly label: string;
  readonly blurb: string;
  readonly stack: string;
}

export const CODE_FACE_SPECS: readonly CodeFaceSpec[] = [
  {
    id: 'system',
    label: 'the machine hand',
    blurb: 'whatever this machine calls its code face — Cascadia, then Consolas',
    stack:
      'ui-monospace, "Cascadia Code", "Cascadia Mono", "Segoe UI Mono", Consolas, monospace',
  },
  {
    id: 'cascadia',
    label: 'cascadia',
    blurb: "Windows' own code face, drawn this decade",
    stack: '"Cascadia Code", "Cascadia Mono", Consolas, ui-monospace, monospace',
  },
  {
    id: 'courier',
    label: 'a typewriter',
    blurb: 'Courier — thin, mechanical, carbon-copy',
    stack: '"Courier New", Courier, ui-monospace, monospace',
  },
  {
    id: 'ui',
    label: 'lucida console',
    blurb: 'wide and plain, the most legible thing here at small sizes',
    stack: '"Lucida Console", "DejaVu Sans Mono", Consolas, ui-monospace, monospace',
  },
];

const FACE_BY_ID = new Map(CODE_FACE_SPECS.map((f) => [f.id, f] as const));

export const DEFAULT_CODE_FACE: CodeFace = 'system';

export function resolveCodeFace(id: string | null | undefined): CodeFaceSpec {
  return FACE_BY_ID.get(id as CodeFace) ?? (CODE_FACE_SPECS[0] as CodeFaceSpec);
}

/** Code type size, in px. Bounds are applied wherever the value is used. */
export const CODE_SIZE_MIN = 12;
export const CODE_SIZE_MAX = 20;
export const DEFAULT_CODE_SIZE = 15;

/* ============================= the derivation ============================ */

/**
 * The floor every code colour is solved to.
 *
 * A hair over WCAG AA for the same reason `appearance.ts` aims past its gate:
 * solving to exactly 4.5 lands some pigments at 4.48:1, inside the binary
 * search's own resolution and outside the standard.
 */
const CODE_AA = 4.6;

/** The code's own reading ink wants more than AA — it is a whole page of type. */
const CODE_INK_RATIO = 6.5;

/**
 * How far a themed plate has to stand off the page it lies on.
 *
 * A CONTRAST RATIO, not a luminance step, and that distinction was a bug:
 * the first cut asked for 26 units of luminance and got them, and a plum-black
 * plate in the velvet room still measured 1.28:1 — because the same number of
 * luminance units buys far less contrast at the dark end of the scale than at
 * the light end, which is the whole reason WCAG is a ratio in the first place.
 *
 * 1.4 is not an accessibility number; nothing is written across this boundary.
 * It is "you can see there is a card there", and it lands the tinted panels at
 * about the strength of `--paper-deep` — a rung the app already uses to say
 * "this is set into the page".
 */
const PLATE_CONTRAST = 1.4;

/**
 * The plate a theme sits on, given the page it is sitting on.
 *
 * A `rung` plate is simply one of the page's own papers, and is left alone: a
 * block set one rung into the sheet is meant to read as a fold, not a card.
 *
 * A `fill` plate keeps its hue and moves only in lightness, away from the page
 * — which is what lets one table serve a lit room and a dark one. In a lit
 * room "away" is darker, so a dark plate stays the darkest thing on the page
 * and a honey panel deepens until it reads as a panel. Under a lamp "away" is
 * lighter, and the same dark plate becomes the light face rather than a black
 * square on a black page.
 */
export function codePlate(theme: CodeThemeSpec, grounds: PageGrounds): string {
  if ('rung' in theme.plate) return grounds[theme.plate.rung];
  const page = grounds.cream;
  const fill = theme.plate.fill;
  if (contrastRatio(fill, page) >= PLATE_CONTRAST) return fill;

  // Binary search for the NEAREST lightness in the away direction that clears
  // the gate, so a plate is never taken further from its authored colour than
  // the room actually requires.
  const away = grounds.dark ? 252 : 4;
  let lo = lum(fill);
  let hi = away;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(solveLuminance(fill, mid), page) >= PLATE_CONTRAST) hi = mid;
    else lo = mid;
  }
  return solveLuminance(fill, hi);
}

/**
 * Every `--code-*` custom property, for one combination of room, ink, stock
 * and code theme.
 *
 * Pure and total — unknown ids resolve — so it can be handed straight out of
 * SQLite, and so a test can walk the whole matrix. Keys whose value is `''`
 * are not produced: unlike `appearanceTokens`, every key here is always
 * written, because the code block has no stylesheet room of its own to fall
 * back to.
 */
export function codeTokens(
  codeThemeId: string,
  appThemeId: string,
  inkId: string,
  paperId: string | null,
): Readonly<Record<string, string>> {
  const spec = resolveCodeTheme(codeThemeId);
  const grounds = pageGrounds(appThemeId, paperId);
  const plate = codePlate(spec, grounds);
  // The tab is folded off the plate, so it has to exist before the ink does.
  const tab = tabFace(plate, grounds);

  /* --------------------------------- ink -------------------------------- */
  // With no ink of its own the block borrows the reader's, which is what
  // keeps a page that is half prose and half code reading as one document.
  //
  // Solved against BOTH faces it lands on, the way `bodyInkFor` is: the code
  // sits on the plate, and the language word and the copy button sit on the
  // tab, which is a step further away. `solveInkOn` only ever moves lightness
  // one way, so taking whichever solve is further from its ground satisfies
  // both at once. Solving against the plate alone put the language chip at
  // 3.4:1 on the darker themes — a label on a control, under AA, and nothing
  // would have caught it because the two are different rules in different
  // files.
  const seed = spec.ink ?? resolveInk(inkId).pigment;
  const onPlate = solveInkOn(seed, plate, CODE_INK_RATIO);
  const ink =
    contrastRatio(onPlate, tab) >= CODE_AA
      ? onPlate
      : solveInkOn(seed, tab, CODE_INK_RATIO);

  /* ------------------------------- the rim ------------------------------ */
  // ONE outline colour on everything — the house rule. On a plate that is
  // already dark the ink line would disappear into it, so the rim is the
  // outline taken as far as it needs to go to still be an outline, at the
  // 3:1 gate a non-text mark is judged by.
  const rim = solveInkOn('#4f3120', plate, 3);

  /* ------------------------------ the roles ----------------------------- */
  const roles: Record<string, string> = {};
  for (const role of CODE_ROLES) {
    roles[`--code-${role}`] = solveInkOn(spec.pigments[role], plate, CODE_AA);
  }

  /*
   * Punctuation and the line numbers are DERIVED from the ink rather than
   * authored, because neither is a colour anybody has an opinion about and
   * both have to stay out of the way. They are the ink mixed toward the plate
   * and then solved back to the floor — quieter than the code, still legible,
   * which is exactly what a bracket and a row of numbers should be.
   */
  const muted = (amount: number): string =>
    solveInkOn(mixOklab(ink, plate, amount), plate, CODE_AA);

  return {
    '--code-plate': plate,
    '--code-rim': rim,
    '--code-ink': ink,
    '--code-punct': muted(0.35),
    '--code-gutter': muted(0.45),
    // The tab the language sits on: a step further from the page than the
    // plate, so it reads as a piece of card in front of it rather than as a
    // continuation of the same sheet.
    '--code-tab': tab,
    '--code-selection': selectionBand(ink, plate),
    ...roles,
  };
}

/** The tab face: the plate, folded one more step away from the page. */
function tabFace(plate: string, grounds: PageGrounds): string {
  const page = lum(grounds.cream);
  const here = lum(plate);
  const step = here <= page ? -16 : 16;
  return solveLuminance(plate, Math.max(6, Math.min(252, here + step)));
}

/**
 * The band a selection inside code is drawn with.
 *
 * Solved rather than typed, exactly as `appearance.ts` solves its own: the
 * largest alpha that still leaves the code ink readable through it, so the
 * selection is as visible as it is allowed to be and never a step more.
 */
function selectionBand(ink: string, plate: string): string {
  const pigment = toHex({ ...toOklch(plate), L: lum(plate) > 128 ? 0.55 : 0.78 });
  let lo = 0.12;
  let hi = 0.55;
  const clears = (alpha: number): boolean =>
    contrastRatio(ink, mix(pigment, plate, alpha)) >= CODE_AA;
  if (!clears(lo)) return `rgba(0, 0, 0, ${lo})`;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (clears(mid)) lo = mid;
    else hi = mid;
  }
  const [r, g, b] = channels(pigment);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(lo * 100) / 100})`;
}

function channels(hex: string): [number, number, number] {
  const raw = hex.trim().replace('#', '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return [128, 128, 128];
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** `top` composited over `bottom` at `alpha`, as a hex. */
function mix(top: string, bottom: string, alpha: number): string {
  const [tr, tg, tb] = channels(top);
  const [br, bg, bb] = channels(bottom);
  const c = (t: number, b: number): string =>
    Math.round(t * alpha + b * (1 - alpha))
      .toString(16)
      .padStart(2, '0');
  return `#${c(tr, br)}${c(tg, bg)}${c(tb, bb)}`;
}

/**
 * The swatch a picker chip paints itself with — the same arithmetic the real
 * block gets, so a chip cannot advertise a look the page will not use.
 */
export interface CodeSwatch {
  readonly plate: string;
  readonly ink: string;
  readonly keyword: string;
  readonly string: string;
  readonly comment: string;
}

export function codeSwatch(
  codeThemeId: string,
  appThemeId: string,
  inkId: string,
  paperId: string | null,
): CodeSwatch {
  const tokens = codeTokens(codeThemeId, appThemeId, inkId, paperId);
  return {
    plate: tokens['--code-plate'],
    ink: tokens['--code-ink'],
    keyword: tokens['--code-keyword'],
    string: tokens['--code-string'],
    comment: tokens['--code-comment'],
  };
}
