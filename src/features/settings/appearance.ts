/**
 * src/features/settings/appearance.ts — the APPEARANCE vocabulary.
 *
 * `src/art/` carries three vocabularies for the ROOM a book stands in
 * (carpentry, wallpaper, binding) and `src/editor/effects/vocabulary.ts` a
 * fourth for a BLOCK on the page. This is the fifth, and it is the one the
 * settings sheet reads: the paper the whole app is printed on, the ink it is
 * written in, the hand it is written by, and the room those three sit in.
 *
 * ## Why it exists at all
 *
 * The Appearance section shipped with four themes, three hands, three inks and
 * four rulings, hard-coded as literal arrays inside `SettingsPanel.tsx`. Every
 * one of those lists was written the week the panel was, and none of them ever
 * grew, because there was nothing to grow — the values were the picker and the
 * picker was the values. Meanwhile the app had, and still has:
 *
 *   - fifty named inks in `editor/effects/vocabulary.ts` with fifty matching
 *     `[data-ink=…]` rules in `styles/effects.css`, reachable only per BLOCK;
 *   - fifty named papers in the same place, likewise per block;
 *   - nine bundled type families in `src/index.tsx`, of which the app-wide
 *     handwriting picker offered three.
 *
 * So the reader's guess — *"i feel you have already done this though and the
 * option is not showing"* — was right about the ink, right about the paper and
 * right about the hand. This module is where those lists become a vocabulary
 * the panel reads instead of a literal it repeats.
 *
 * ## The four axes, and what each one is allowed to touch
 *
 * They are orthogonal on purpose — repainting the room must not change the
 * paper stock, and choosing a greener ink must not move the accent:
 *
 *   THEME   the room: the accent ramp, the selection wash, and the DEFAULT
 *           paper stock. It also names a `base`, one of the four hand-tuned
 *           rooms in `styles/settings.css`, which is what `data-theme` is set
 *           to — so every `[data-theme='night']` rule in the stylesheets keeps
 *           working and a new theme inherits sixty tokens it does not have to
 *           restate.
 *   PAPER   the stock: `--paper-cream` and the three rungs below it.
 *   INK     the reading ink: `--ink-sepia` and its soft rung. NOT `--ink-line`
 *           — one dark outline colour on everything is most of why the app
 *           reads as a single drawing (see CLAUDE.md), and an ink setting that
 *           moved it would let a reader take the pen away from the drawing.
 *   HAND    `--font-body`, the face every page is written in.
 *
 * ## What is derived and what is authored
 *
 * Authored: one paper hex and one accent hex per theme, one pigment per ink,
 * one ground per paper, one stack per hand. Everything else is DERIVED, in
 * OKLCh, by `art/palette.ts` — the same arithmetic the sixty library rooms are
 * built with, and for the same reason: hand-mixing four rungs per entry across
 * a hundred entries produces a hundred different amounts of fold, and half of
 * them fail their contrast gate quietly.
 *
 * The ink derivation in particular solves against the paper it will actually
 * sit on, at the ratios `styles/tokens.css` states in its contrast contract
 * (body ink 7:1, soft inks 4.5:1). That is what makes it safe to offer a
 * reader an ink called "lilac" without shipping an unreadable page: the
 * pigment names the HUE, and the derivation finds the lightness that hue has
 * to be on that paper. `tests/plugged-in.test.ts` measures it.
 *
 * ## Tier, order and the dice
 *
 * Every entry declares a `tier`, exactly as the carpentry and the bindings do,
 * and the exported order is DERIVED from family-then-tier rather than typed
 * out. `oddity` entries stay pickable and stay out of "surprise me": the
 * reader's rule is *"you dont have to be too cruel"*, so nothing is ever
 * deleted for being odd, only ranked down.
 */

import {
  intoWashBand,
  lum,
  mixOklab,
  toHex,
  toOklch,
  washFaces,
} from '../../art/palette';
import { INK_ALL, PAPER_ALL } from '../../editor/effects/vocabulary';

/* ============================== shared shape ============================== */

/**
 * How well an entry leads its family.
 *
 * `signature` is the shortlist a row opens on; `shelf` and `niche` are behind
 * the "show all" control; `oddity` is offered but never rolled.
 */
export const APPEARANCE_TIERS = ['signature', 'shelf', 'niche', 'oddity'] as const;
export type AppearanceTier = (typeof APPEARANCE_TIERS)[number];

interface Entry {
  readonly id: string;
  /** What the chip says. Lowercase, a stationer's words. */
  readonly label: string;
  /** One line for the tooltip — character, not a description of the colour. */
  readonly blurb: string;
  readonly tier: AppearanceTier;
}

/* ============================== 1. the rooms ============================== */

/**
 * The four hand-tuned rooms in `styles/settings.css`. A theme names one, and
 * that name — not the theme's own id — is what `data-theme` is set to.
 */
export const THEME_BASES = ['parchment', 'pastel', 'botanical', 'night'] as const;
export type ThemeBase = (typeof THEME_BASES)[number];

export const APP_THEME_FAMILIES = ['parchment', 'blossom', 'garden', 'lamplight'] as const;
export type AppThemeFamily = (typeof APP_THEME_FAMILIES)[number];

export const FAMILY_LABELS: Readonly<Record<AppThemeFamily, string>> = {
  parchment: 'warm papers',
  blossom: 'soft papers',
  garden: 'green papers',
  lamplight: 'after dark',
};

export interface AppThemeSpec extends Entry {
  readonly family: AppThemeFamily;
  /** Which of the four stylesheet rooms this one is dressed over. */
  readonly base: ThemeBase;
  /** The page ground, when the paper stock is left on "as the theme". */
  readonly paper: string;
  /** The one colour the interface uses to say "this one". */
  readonly accent: string;
  /** True when the room is lit from a lamp rather than a window. */
  readonly dark: boolean;
}

/**
 * Terse constructor. The table is read far more often than it is written, and
 * a row that fits on a line is a row you can scan for a colour you half
 * remember.
 */
function t(
  id: string,
  label: string,
  family: AppThemeFamily,
  base: ThemeBase,
  paper: string,
  accent: string,
  tier: AppearanceTier,
  blurb: string,
): AppThemeSpec {
  return { id, label, family, base, paper, accent, tier, blurb, dark: base === 'night' };
}

const THEME_TABLE: readonly AppThemeSpec[] = [
  /* ------------------------------ warm papers ---------------------------- */
  // The accent is the MOSS `styles/tokens.css` actually paints the house room
  // with, not the terracotta this row used to claim — the same correction the
  // blossom row below needed, and for the same reason. A shipped room writes no
  // accent tokens (`onBaseRoom`), so nothing on screen contradicted it except
  // the picker chip, which paints itself from `swatchFor` and would otherwise
  // advertise the colour the chrome wore before the opening room went brown.
  t('parchment', 'parchment', 'parchment', 'parchment', '#f7f1e3', '#7d915c', 'signature',
    'the house room — flat cream and the icon’s own leaf green'),
  t('honeycomb', 'honeycomb', 'parchment', 'parchment', '#f9edcf', '#b8791c', 'signature',
    'warm wax paper and a deep honey accent; the loudest of the warm rooms'),
  t('apricot', 'apricot', 'parchment', 'parchment', '#fae7d8', '#c4482a', 'signature',
    'a blushed cream with a fired-clay accent — vivid without shouting'),
  t('manila', 'manila', 'parchment', 'parchment', '#f2e4c6', '#a8552f', 'shelf',
    'buff folder stock, the colour of a filing room'),
  t('sandstone', 'sandstone', 'parchment', 'parchment', '#f0e3cc', '#96421d', 'shelf',
    'dry warm stone; the quietest of the vivid warms'),
  t('oatmeal', 'oatmeal', 'parchment', 'parchment', '#f2ece0', '#7d915c', 'shelf',
    'undyed paper with a moss accent — calm, and it stays calm'),
  t('linenpress', 'linen press', 'parchment', 'parchment', '#f6f2ea', '#5f7d8c', 'shelf',
    'pressed white linen and a slate accent'),
  t('foolscap', 'foolscap', 'parchment', 'parchment', '#f2f0e6', '#7c749f', 'niche',
    'cool office cream with a violet accent — a stationer’s joke that works'),
  t('chartroom', 'chart room', 'parchment', 'parchment', '#eef0e8', '#3a5666', 'niche',
    'chart paper under a deep sea-blue accent'),
  t('ledgerhouse', 'ledger house', 'parchment', 'parchment', '#f3f0df', '#4f6138', 'niche',
    'account paper, ruled green — the counting house without the counting'),
  t('foxglove', 'foxglove', 'parchment', 'parchment', '#f6ecdf', '#8a3a5c', 'oddity',
    'a warm ground under a bruised pink; handsome, and not for every day'),

  /* ------------------------------ soft papers ---------------------------- */
  // The accent is the ROSE styles/settings.css actually paints the blossom room
  // with, not the terracotta this row used to claim. A shipped room writes no
  // accent tokens, so nothing on screen contradicted it — except the picker
  // chip, which paints itself from `swatchFor` and was therefore advertising a
  // colour the room does not use, and the accent INK, which is derived from
  // this hex the moment the reader picks a paper stock.
  t('pastel', 'blossom', 'blossom', 'pastel', '#f9eff2', '#c96186', 'signature',
    'the shipped pastel room — blossom paper, rose accent'),
  t('peony', 'peony', 'blossom', 'pastel', '#fceaf0', '#a8324f', 'signature',
    'the vivid end of the soft papers — deep rose on pale pink'),
  t('rosewater', 'rosewater', 'blossom', 'pastel', '#fbeef0', '#b04d70', 'shelf',
    'washed pink with a dusty rose accent'),
  t('lilacpress', 'lilac press', 'blossom', 'pastel', '#f3eef6', '#6a5f96', 'shelf',
    'pale lilac stock and a soft violet accent'),
  t('seashell', 'seashell', 'blossom', 'pastel', '#f8f0ea', '#2f8478', 'shelf',
    'shell-pink paper cut with a sea-green accent'),
  t('powder', 'powder', 'blossom', 'pastel', '#ecf1f6', '#3a5666', 'niche',
    'powder blue, the coolest room in the app'),
  t('sherbet', 'sherbet', 'blossom', 'pastel', '#fdeedd', '#c05a1e', 'oddity',
    'sweet-shop paper; delightful for a week'),

  /* ----------------------------- green papers ---------------------------- */
  t('botanical', 'botanical', 'garden', 'botanical', '#f0f2e0', '#c07a3a', 'signature',
    'the shipped pressed-leaf room — moss ink, a terracotta-pot accent'),
  t('verdigris', 'verdigris', 'garden', 'botanical', '#e8f0ec', '#1f6b60', 'signature',
    'oxidised copper on a cool green ground — vivid, and still furniture'),
  t('fernhouse', 'fern house', 'garden', 'botanical', '#eaf1e2', '#4f6138', 'shelf',
    'glasshouse green, quiet all the way through'),
  t('orchard', 'orchard', 'garden', 'botanical', '#f2f2dc', '#96421d', 'shelf',
    'windfall paper with a russet accent'),
  t('mossagate', 'moss agate', 'garden', 'botanical', '#edf0e4', '#5c6a1c', 'niche',
    'stone-green paper, an olive accent'),
  t('absinthe', 'absinthe', 'garden', 'botanical', '#eef3d8', '#5c6a1c', 'oddity',
    'a green that is definitely a choice'),

  /* ------------------------------ after dark ----------------------------- */
  t('night', 'night', 'lamplight', 'night', '#2b211a', '#d98a63', 'signature',
    'the shipped dark room — the same drawing, after the lamps'),
  t('midnight', 'midnight', 'lamplight', 'night', '#1e2430', '#7b9aab', 'signature',
    'ink-blue dark with a cold sea accent'),
  t('observatory', 'observatory', 'lamplight', 'night', '#202a2c', '#5aa899', 'shelf',
    'a green-black room lit by a sea-glass lamp'),
  t('cellar', 'cellar', 'lamplight', 'night', '#241f1c', '#b5793f', 'shelf',
    'brown-black, oil-lamp warm'),
  t('velvet', 'velvet', 'lamplight', 'night', '#2a1f28', '#c78ba1', 'niche',
    'a plum-black box with a blushed accent'),
  t('foxfire', 'foxfire', 'lamplight', 'night', '#1f261f', '#9fb35a', 'oddity',
    'lichen light on a forest floor; striking, and strange'),
];

/* ============================== 2. the inks =============================== */

export const INK_FAMILIES = ['neutral', 'warm', 'red', 'green', 'blue', 'purple'] as const;
export type InkFamily = (typeof INK_FAMILIES)[number];

export interface InkSpec extends Entry {
  readonly family: InkFamily;
  /**
   * The pigment. Its HUE is the promise; its lightness is negotiable and is
   * re-solved per paper by `inkFor`, which is what lets a pale name like
   * "lilac" be offered without shipping an unreadable page.
   */
  readonly pigment: string;
  /**
   * True for the three inks `styles/settings.css` already remaps by hand.
   * Those keep their hand-tuned, contrast-tested values in all four rooms —
   * this module writes NOTHING for them, so a reader who has been on sepia
   * since install sees the pixel they have always seen.
   */
  readonly stylesheet?: true;
}

function ink(
  id: string,
  label: string,
  family: InkFamily,
  pigment: string,
  tier: AppearanceTier,
  blurb: string,
  stylesheet?: true,
): InkSpec {
  return { id, label, family, pigment, tier, blurb, ...(stylesheet ? { stylesheet } : {}) };
}

const INK_TABLE: readonly InkSpec[] = [
  /* neutral */
  ink('sepia', 'sepia', 'neutral', '#4f3120', 'signature', 'the house ink — warm brown-black', true),
  ink('graphite', 'graphite', 'neutral', '#3f3a33', 'signature', 'a soft pencil', true),
  ink('ink-blue', 'fountain blue', 'neutral', '#3c5a70', 'signature', 'school-letter blue-black', true),
  ink('charcoal', 'charcoal', 'neutral', '#33302c', 'shelf', 'a drawing black, never quite black'),
  ink('irongall', 'iron gall', 'neutral', '#3b2f22', 'signature', 'the ink every old book is written in'),
  ink('slate', 'slate', 'neutral', '#4a5560', 'shelf', 'cool grey, sober'),
  /* warm */
  ink('walnut', 'walnut', 'warm', '#5a3c26', 'signature', 'furniture brown, warm all through'),
  ink('umber', 'burnt umber', 'warm', '#4a2f1c', 'shelf', 'a painter’s dark earth'),
  ink('bronze', 'bronze', 'warm', '#6a4e2a', 'shelf', 'antique metal, gone matte'),
  ink('ochre', 'ochre', 'warm', '#8a6a1f', 'niche', 'the oldest pigment there is'),
  ink('clay', 'clay', 'warm', '#7a5238', 'niche', 'pale earth, quiet'),
  ink('mustard', 'mustard', 'warm', '#8a7418', 'oddity', 'sharp, retro, and a lot on a whole page'),
  /* red */
  ink('burgundy', 'burgundy', 'red', '#6b1f2e', 'signature', 'a library ink — formal and rich'),
  ink('oxblood', 'oxblood', 'red', '#5e2029', 'shelf', 'bound-leather red'),
  ink('brick', 'brick', 'red', '#8a3a24', 'shelf', 'sturdy, earthy, warm'),
  ink('rust', 'rust', 'red', '#8f4a1c', 'niche', 'autumn iron'),
  ink('madder', 'rose madder', 'red', '#9c4257', 'niche', 'a soft red, gently'),
  ink('crimson', 'crimson', 'red', '#8e2436', 'oddity', 'a marking ink — every line reads as a correction'),
  /* green */
  ink('forest', 'forest', 'green', '#27452f', 'signature', 'deep woodland green'),
  ink('moss', 'moss', 'green', '#4f6138', 'shelf', 'the ribbon green, as an ink'),
  ink('pine', 'pine', 'green', '#23402f', 'shelf', 'dark, cold, winter'),
  ink('olive', 'olive', 'green', '#55603f', 'niche', 'muted field green'),
  ink('fern', 'fern', 'green', '#3f6237', 'niche', 'fresh, woodland'),
  /* blue */
  ink('navy', 'navy', 'blue', '#26364f', 'signature', 'deep, formal, cool'),
  ink('teal', 'teal', 'blue', '#2c5f56', 'signature', 'sea-green and level'),
  ink('cobalt', 'cobalt', 'blue', '#24467e', 'shelf', 'a vivid true blue'),
  ink('denim', 'denim', 'blue', '#3f5a76', 'shelf', 'workwear, faded'),
  ink('jade', 'jade', 'blue', '#2a5a4c', 'niche', 'cool stone'),
  ink('skyink', 'sky', 'blue', '#3a5666', 'niche', 'daylight, calmed down'),
  /* purple */
  ink('indigo', 'indigo', 'purple', '#33305e', 'signature', 'the ink of a night sky'),
  ink('plum', 'plum', 'purple', '#5c3448', 'shelf', 'rich and quiet at once'),
  ink('mulberry', 'mulberry', 'purple', '#6b2f4a', 'shelf', 'fruit-stained'),
  ink('violet', 'violet', 'purple', '#443f66', 'niche', 'soft, dreamy'),
  ink('lilac', 'lilac', 'purple', '#5a4a72', 'oddity', 'pale purple, taken as dark as a page needs'),
];

/* ============================= 3. the papers ============================== */

export const PAPER_FAMILIES = ['plain', 'made', 'coloured', 'technical'] as const;
export type PaperFamily = (typeof PAPER_FAMILIES)[number];

export interface PaperSpec extends Entry {
  readonly family: PaperFamily;
  /** The sheet, as it would be under a window. Dark rooms re-solve it. */
  readonly ground: string;
}

function paper(
  id: string,
  label: string,
  family: PaperFamily,
  ground: string,
  tier: AppearanceTier,
  blurb: string,
): PaperSpec {
  return { id, label, family, ground, tier, blurb };
}

/**
 * The stock id `AUTO_PAPER` means "whatever the room is printed on". It is the
 * default, and it is why picking a theme still changes the page.
 */
export const AUTO_PAPER = 'auto';

const PAPER_TABLE: readonly PaperSpec[] = [
  /* plain */
  paper('cartridge', 'cartridge', 'plain', '#f4f0e4', 'signature', 'drawing stock, a little toothy'),
  paper('linenstock', 'linen stock', 'plain', '#f5f1e7', 'signature', 'woven, formal, stationery'),
  paper('laid', 'laid paper', 'plain', '#f4efe0', 'signature', 'chain lines and a warm ground'),
  paper('cotton', 'cotton rag', 'plain', '#f8f4ea', 'shelf', 'thick, soft, expensive'),
  paper('onion', 'onionskin', 'plain', '#f7f5ec', 'shelf', 'airmail thin, nearly white'),
  paper('hotpress', 'hot-pressed', 'plain', '#f9f6ee', 'shelf', 'smooth, clean, bright'),
  paper('coldpress', 'cold-pressed', 'plain', '#f6f1e6', 'niche', 'watercolour stock'),
  paper('tracing', 'tracing paper', 'plain', '#eef1ef', 'niche', 'cool and see-through'),
  /* made */
  paper('aged', 'aged stock', 'made', '#f3e8cf', 'signature', 'warm, archived, a little foxed'),
  paper('parchment', 'parchment', 'made', '#f2e6c9', 'signature', 'scroll-warm and ancient'),
  paper('handmade', 'handmade sheet', 'made', '#f3ecd9', 'shelf', 'deckled and irregular'),
  paper('vellum', 'vellum', 'made', '#f6efdd', 'shelf', 'delicate, faintly translucent'),
  paper('mulberry', 'mulberry paper', 'made', '#f1ece0', 'niche', 'fibrous and eastern'),
  paper('papyrus', 'papyrus', 'made', '#eee0bd', 'niche', 'woven reed, rough'),
  paper('foxed', 'foxed paper', 'made', '#efe3ca', 'niche', 'antiquarian, spotted with age'),
  paper('marbled', 'marbled paper', 'made', '#efe4d4', 'oddity', 'endpaper stock — rich, and busy under type'),
  /* coloured */
  paper('kraft', 'kraft board', 'coloured', '#e8d3ae', 'signature', 'brown parcel paper'),
  paper('legal', 'legal pad', 'coloured', '#f7efc8', 'shelf', 'american yellow, wide rule'),
  paper('index', 'index stock', 'coloured', '#f6f2e4', 'shelf', 'filed, recipe-box cream'),
  paper('newsprint', 'newsprint', 'coloured', '#eeeae0', 'niche', 'grey, cheap, daily'),
  paper('thermal', 'thermal roll', 'coloured', '#f4f4ef', 'oddity', 'till-receipt white; shiny in every room'),
  /* technical */
  paper('engineer', 'engineering pad', 'technical', '#e9f0e2', 'shelf', 'faint green tint'),
  paper('blueprint', 'blueprint', 'technical', '#dde7ef', 'shelf', 'drafting blue, cool all through'),
  paper('ledger', 'ledger paper', 'technical', '#eef0e2', 'niche', 'accounts green'),
];

/* ============================== 4. the hands ============================== */

export const HAND_FAMILIES = ['bundled', 'printed', 'system'] as const;
export type HandFamily = (typeof HAND_FAMILIES)[number];

export const HAND_FAMILY_LABELS: Readonly<Record<HandFamily, string>> = {
  bundled: 'the app’s own hands',
  printed: 'printed faces',
  system: 'faces on this machine',
};

export interface HandSpec extends Entry {
  readonly family: HandFamily;
  /** The full CSS stack written to `--font-body`. */
  readonly stack: string;
  /**
   * The smallest size this face may be SET at, in px.
   *
   * The house rule is 13px for any handwriting face and 20px for Caveat
   * (CLAUDE.md; `tests/styles.test.ts` gates the stylesheets). A picker chip
   * is 13px, so a face with a small x-height either gets its floor here or
   * gets drawn illegibly next to twenty-six chips that are not — which is
   * both against the rule and the worst possible way to choose a hand.
   */
  readonly floorPx?: number;
  /**
   * The family name to ask `document.fonts.check` about, for faces that are
   * NOT bundled. A hand whose face is missing falls back to another face in
   * its stack, and two chips that draw the same thing is a name that lies —
   * so the panel drops the ones this machine does not have.
   */
  readonly probe?: string;
}

function hand(
  id: string,
  label: string,
  family: HandFamily,
  stack: string,
  tier: AppearanceTier,
  blurb: string,
  probe?: string,
  floorPx?: number,
): HandSpec {
  return {
    id,
    label,
    family,
    stack,
    tier,
    blurb,
    ...(probe === undefined ? {} : { probe }),
    ...(floorPx === undefined ? {} : { floorPx }),
  };
}

/**
 * The floor for a face in a 13px chip.
 *
 * `SMALL_FACE` is for the ones whose lower case is markedly under the others'
 * at the same size — set at 13 they read as a whisper beside Patrick Hand.
 * Caveat's 20 is not a judgement, it is the number CLAUDE.md states.
 */
const CAVEAT_FLOOR = 20;
const SMALL_FACE = 16;

/**
 * Ids are FAMILY NAMES, not invented slugs.
 *
 * `settings.handwritingFont` has stored 'Caveat' / 'Patrick Hand' / 'Kalam'
 * since the app shipped, and a reader's stored value has to keep meaning what
 * it meant. It also keeps this honest: an id here is the face, so a chip
 * cannot promise a hand the stack does not actually name.
 */
const HAND_TABLE: readonly HandSpec[] = [
  /* the nine faces bundled with the app (src/index.tsx) — always available */
  hand('Patrick Hand', 'everyday hand', 'bundled',
    '"Patrick Hand", "Segoe Print", cursive', 'signature', 'the house hand — plain and legible'),
  hand('Caveat', 'quick note', 'bundled',
    '"Caveat Variable", "Caveat", "Segoe Script", cursive', 'signature', 'fast, sloped, cheerful',
    undefined, CAVEAT_FLOOR),
  hand('Kalam', 'brush hand', 'bundled',
    '"Kalam", "Segoe Print", cursive', 'signature', 'a broad nib with some weight in it'),
  hand('Architects Daughter', 'drafting hand', 'bundled',
    '"Architects Daughter", "Segoe Print", cursive', 'signature', 'even capitals, drawing-office neat'),
  hand('Gochi Hand', 'marker', 'bundled',
    '"Gochi Hand", "Segoe Print", cursive', 'signature', 'thick felt tip, poster-loud'),
  hand('Shadows Into Light', 'a light hand', 'bundled',
    '"Shadows Into Light", "Segoe Script", cursive', 'shelf', 'thin, airy, barely pressed',
    undefined, SMALL_FACE),
  hand('Lora', 'book serif', 'printed',
    '"Lora", Georgia, serif', 'signature', 'a reading serif — for pages you sit with'),
  hand('Crimson Pro', 'printed serif', 'printed',
    '"Crimson Pro", "Palatino Linotype", serif', 'shelf', 'typeset and literary'),
  hand('Nunito Sans', 'plain sans', 'printed',
    '"Nunito Sans", "Segoe UI", sans-serif', 'shelf', 'no character at all, on purpose'),

  /* faces Windows ships. Offered only when this machine really has them. */
  hand('Segoe Script', 'a joined hand', 'system',
    '"Segoe Script", "Caveat Variable", cursive', 'shelf', 'looping and joined-up', 'Segoe Script'),
  hand('Segoe Print', 'a printed hand', 'system',
    '"Segoe Print", "Patrick Hand", cursive', 'shelf', 'careful, unjoined, school-taught', 'Segoe Print'),
  hand('Ink Free', 'felt pen', 'system',
    '"Ink Free", "Gochi Hand", cursive', 'shelf', 'wet ink, quick', 'Ink Free', SMALL_FACE),
  hand('Gabriola', 'a flourished hand', 'system',
    'Gabriola, "Caveat Variable", cursive', 'niche', 'calligraphic, with tails', 'Gabriola',
    CAVEAT_FLOOR),
  hand('Lucida Handwriting', 'copperplate', 'system',
    '"Lucida Handwriting", "Caveat Variable", cursive', 'niche', 'engraved and formal',
    'Lucida Handwriting', SMALL_FACE),
  hand('Comic Sans MS', 'the friendly one', 'system',
    '"Comic Sans MS", "Patrick Hand", cursive', 'oddity', 'yes, that one — it is a legible hand', 'Comic Sans MS'),
  hand('Georgia', 'newspaper serif', 'system',
    'Georgia, "Lora", serif', 'shelf', 'sturdy on screen, made for reading', 'Georgia'),
  hand('Palatino Linotype', 'old-style serif', 'system',
    '"Palatino Linotype", "Crimson Pro", serif', 'shelf', 'a calligrapher’s roman', 'Palatino Linotype'),
  hand('Cambria', 'a printing serif', 'system',
    'Cambria, "Lora", serif', 'niche', 'even colour down a long page', 'Cambria'),
  hand('Constantia', 'a book serif', 'system',
    'Constantia, "Crimson Pro", serif', 'niche', 'warm and bookish', 'Constantia'),
  hand('Sitka Text', 'a reading serif', 'system',
    '"Sitka Text", "Lora", serif', 'niche', 'drawn for text sizes', 'Sitka Text'),
  hand('Bookman Old Style', 'a heavy serif', 'system',
    '"Bookman Old Style", "Crimson Pro", serif', 'oddity', 'thick, old, unmistakable', 'Bookman Old Style'),
  hand('Candara', 'a soft sans', 'system',
    'Candara, "Nunito Sans", sans-serif', 'shelf', 'humanist, gently drawn', 'Candara'),
  hand('Corbel', 'a plain sans', 'system',
    'Corbel, "Nunito Sans", sans-serif', 'niche', 'quiet and modern', 'Corbel'),
  hand('Trebuchet MS', 'a friendly sans', 'system',
    '"Trebuchet MS", "Nunito Sans", sans-serif', 'niche', 'round and open', 'Trebuchet MS'),
  hand('Verdana', 'a wide sans', 'system',
    'Verdana, "Nunito Sans", sans-serif', 'niche', 'the most legible thing here, and it knows it', 'Verdana'),
  hand('Consolas', 'a typewriter', 'system',
    'Consolas, "Courier New", monospace', 'niche', 'every letter the same width', 'Consolas'),
  hand('Courier New', 'a ribbon typewriter', 'system',
    '"Courier New", Consolas, monospace', 'oddity', 'thin, mechanical, carbon-copy', 'Courier New'),
];

/* ========================= order, lookup, resolution ====================== */

const TIER_RANK = new Map(APPEARANCE_TIERS.map((tier, i) => [tier, i] as const));

/**
 * Family run first, then tier inside it — DERIVED, never typed out.
 *
 * The carpentry learned this the hard way: a hand-sorted array agrees with its
 * tiers on the day it is written and quietly stops agreeing on the day an
 * entry is added in the middle. `tests/plugged-in.test.ts` holds the property.
 */
function ordered<T extends Entry & { family: string }>(
  table: readonly T[],
  families: readonly string[],
): readonly T[] {
  return [...table].sort((a, b) => {
    const fam = families.indexOf(a.family) - families.indexOf(b.family);
    if (fam !== 0) return fam;
    return (TIER_RANK.get(a.tier) ?? 0) - (TIER_RANK.get(b.tier) ?? 0);
  });
}

export const APP_THEMES = ordered(THEME_TABLE, APP_THEME_FAMILIES);
export const INKS = ordered(INK_TABLE, INK_FAMILIES);
export const PAPERS = ordered(PAPER_TABLE, PAPER_FAMILIES);
export const HANDS = ordered(HAND_TABLE, HAND_FAMILIES);

/** Ids only, in the same order — what `data/settings.ts` validates against. */
export const APP_THEME_IDS: readonly string[] = APP_THEMES.map((s) => s.id);

const THEME_BY_ID = new Map(APP_THEMES.map((s) => [s.id, s] as const));
const INK_BY_ID = new Map(INKS.map((s) => [s.id, s] as const));
const PAPER_BY_ID = new Map(PAPERS.map((s) => [s.id, s] as const));
const HAND_BY_ID = new Map(HANDS.map((s) => [s.id, s] as const));

/**
 * The room a NEW install opens on, and the room an unknown id resolves to.
 *
 * TWO constants, not one — the carpentry's note applies word for word: merging
 * them means the handsome default is also what a corrupt row paints, and a
 * reader can no longer tell a fault from their own choice. The fallback is the
 * plainest room in the app on purpose.
 */
export const DEFAULT_APP_THEME_ID = 'parchment';
export const FALLBACK_APP_THEME_ID = 'parchment';

/** Total: junk out of SQLite gives the house room, never a throw. */
export function resolveTheme(id: string | null | undefined): AppThemeSpec {
  return (
    THEME_BY_ID.get(id ?? '') ??
    THEME_BY_ID.get(FALLBACK_APP_THEME_ID) ??
    (APP_THEMES[0] as AppThemeSpec)
  );
}

/** Total, same contract. Unknown inks fall back to the house sepia. */
export function resolveInk(id: string | null | undefined): InkSpec {
  return INK_BY_ID.get(id ?? '') ?? (INK_BY_ID.get('sepia') as InkSpec);
}

/** `null` means "as the theme" — the caller uses the room's own paper. */
export function resolvePaper(id: string | null | undefined): PaperSpec | null {
  return PAPER_BY_ID.get(id ?? '') ?? null;
}

/** Total. Unknown hands fall back to the house hand. */
export function resolveHand(id: string | null | undefined): HandSpec {
  return HAND_BY_ID.get(id ?? '') ?? (HAND_BY_ID.get('Patrick Hand') as HandSpec);
}

/** The stylesheet room an id is dressed over — what `data-theme` is set to. */
export function themeBase(id: string | null | undefined): ThemeBase {
  return resolveTheme(id).base;
}

/* ------------------------------- shortlists ------------------------------- */

/**
 * What a row shows before the reader asks for the rest.
 *
 * The house rule is ~20 with an "N more" control, and these come in well
 * under it: a settings sheet is a focus-trapped dialog whose Tab cycle walks
 * every chip in it, so forty extra stops between the theme and the body-size
 * slider is a real cost to anyone on a keyboard.
 */
const signatures = <T extends Entry>(table: readonly T[]): readonly T[] =>
  table.filter((entry) => entry.tier === 'signature');

export const THEME_SHORTLIST = signatures(APP_THEMES);
export const INK_SHORTLIST = signatures(INKS);
export const PAPER_SHORTLIST = signatures(PAPERS);
export const HAND_SHORTLIST = signatures(HANDS);

/* --------------------------------- the dice ------------------------------- */

/**
 * The pools "surprise me" rolls. Demoted entries stay in the pickers and stay
 * out of here — *"you dont have to be too cruel"*.
 */
const rollable = <T extends Entry>(table: readonly T[]): readonly T[] =>
  table.filter((entry) => entry.tier !== 'oddity');

export const THEME_ROLL = rollable(APP_THEMES);
export const INK_ROLL = rollable(INKS);
export const PAPER_ROLL = rollable(PAPERS);
export const HAND_ROLL = rollable(HANDS);

/* ============================ the derivation ============================== */

/** `#rgb` / `#rrggbb` → three 0–255 channels. Junk parses as mid grey. */
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

function toLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance — NOT `palette.lum`, which is a different weighting. */
function relLum(hex: string): number {
  const [r, g, b] = channels(hex).map(toLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast ratio between two opaque colours.
 *
 * Exported because the gate on the derivation is worth measuring rather than
 * asserting: `tests/plugged-in.test.ts` walks every ink against every paper in
 * every room and holds the ratios in `styles/tokens.css`'s contrast contract.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relLum(a);
  const lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `hex` re-solved to `target` perceived brightness, keeping hue and chroma. */
function atLum(hex: string, target: number): string {
  const seed = toOklch(hex);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (lum(toHex({ ...seed, L: mid })) < target) lo = mid;
    else hi = mid;
  }
  return toHex({ ...seed, L: hi });
}

/**
 * `pigment`, taken exactly as far from `paper` as `target` demands and no
 * further.
 *
 * The hue and chroma the reader picked are kept; only lightness moves, and it
 * moves the least it can — a burgundy asked for 7:1 on cream comes back a
 * burgundy, not a black. On dark paper the search runs the other way, which is
 * how one table of pigments serves both a lit room and a dark one.
 */
function inkFor(pigment: string, paper: string, target: number): string {
  const seed = toOklch(pigment);
  if (contrastRatio(toHex(seed), paper) >= target) return toHex(seed);
  const onLight = relLum(paper) > 0.18;
  let lo = onLight ? 0 : seed.L;
  let hi = onLight ? seed.L : 1;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    const clears = contrastRatio(toHex({ ...seed, L: mid }), paper) >= target;
    if (onLight === clears) lo = mid;
    else hi = mid;
  }
  return toHex({ ...seed, L: onLight ? lo : hi });
}

/** The four paper rungs, folded by the steps the shipped rooms are folded by. */
function paperRungs(ground: string, dark: boolean): readonly [string, string, string, string] {
  const base = lum(ground);
  // Measured off styles/settings.css: parchment runs 240 → 226 → 208 → 176,
  // night runs 35 → 44 → 56 → 88. Same folds, opposite directions.
  const steps = dark ? [9, 21, 53] : [-14, -32, -64];
  const [aged, deep, edge] = steps.map((d) =>
    atLum(ground, Math.max(10, Math.min(250, base + d))),
  ) as [string, string, string];
  return [ground, aged, deep, edge];
}

/** The reading ink is only offered here in a colour it can be read in. */
const BODY_INK_RATIO = 7;
const SOFT_INK_RATIO = 4.5;
/**
 * The floor the reading ink also has to clear on `--paper-deep`.
 *
 * `--paper-deep` is a GROUND (tokens.css: "the third face: wells, tracks,
 * thumbnails") and things are written on it — the settings sheet's close
 * button hover, a transfer chip, a diagram's kind label. Solving the ink
 * against `aged` alone left those at 3.57:1 on the darker stocks, because
 * `paperRungs` folds by luminance and a darker sheet compresses the fold.
 * 4.6 rather than 4.5 so the gate has a hair of room in it.
 */
const DEEP_INK_RATIO = 4.6;
/**
 * What every derived ink is actually solved TO.
 *
 * A hair over `SOFT_INK_RATIO`, because solving to exactly the gate is how a
 * pigment lands at 4.48:1 — inside the binary search's own resolution, and
 * outside WCAG AA. The gate stays 4.5; the solve aims past it.
 */
const AA_FLOOR = SOFT_INK_RATIO + 0.1;

/**
 * The reading ink, solved against BOTH paper rungs it lands on.
 *
 * `inkFor` moves lightness one way only, so taking whichever of the two solves
 * is further from the paper satisfies both at once: an ink dark enough for
 * `deep` is more than dark enough for the lighter `aged`.
 */
function bodyInkFor(pigment: string, aged: string, deep: string): string {
  const onAged = inkFor(pigment, aged, BODY_INK_RATIO);
  if (contrastRatio(onAged, deep) >= DEEP_INK_RATIO) return onAged;
  return inkFor(pigment, deep, DEEP_INK_RATIO);
}

/**
 * The alpha a selection wash may carry before it stops being see-through.
 *
 * A selection is a translucent band UNDER the text (tokens.css: "translucent
 * so ink reads through"), which means the ink has to survive the ground the
 * band makes of the paper. A fixed alpha cannot promise that across thirty
 * accents: at the shipped 0.45 / 0.32 the wash took the reading ink down to
 * 2.59:1. So the alpha is solved, not typed — the LARGEST one that still
 * leaves `ink` readable on the band, so the selection stays as visible as it
 * is allowed to be.
 */
function selectionAlpha(pigment: string, ink: string, grounds: readonly string[]): number {
  const [pr, pg, pb] = channels(pigment);
  const clears = (alpha: number): boolean =>
    grounds.every((ground) => {
      const [gr, gg, gb] = channels(ground);
      const mix = (p: number, g: number): number => Math.round(p * alpha + g * (1 - alpha));
      const band = `#${[mix(pr, gr), mix(pg, gg), mix(pb, gb)]
        .map((c) => c.toString(16).padStart(2, '0'))
        .join('')}`;
      return contrastRatio(ink, band) >= AA_FLOOR;
    });
  let lo = 0.1;
  let hi = 0.5;
  if (!clears(lo)) return lo;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (clears(mid)) lo = mid;
    else hi = mid;
  }
  return Math.round(lo * 100) / 100;
}

/**
 * Every custom property the appearance settings write, for one combination.
 *
 * Total and pure: unknown ids resolve, so this can be handed straight out of
 * SQLite. Keys whose value is `''` are written anyway — setting a custom
 * property to the empty string REMOVES the inline declaration, which is how
 * switching back to a shipped room gets its stylesheet values back rather than
 * keeping the last theme's inline overrides forever.
 */
export function appearanceTokens(
  themeId: string,
  inkId: string,
  paperId: string | null,
): Readonly<Record<string, string>> {
  const theme = resolveTheme(themeId);
  const stock = resolvePaper(paperId);
  const onBaseRoom = theme.id === theme.base;

  /* ------------------------------- the paper ------------------------------ */
  // A shipped room on its own paper writes nothing: those four grounds are
  // hand-tuned and contrast-gated in styles/settings.css, and re-deriving them
  // here would move somebody's page by a hair for no reason at all.
  const ground =
    stock !== null
      ? theme.dark
        ? atLum(stock.ground, lum(theme.paper))
        : stock.ground
      : theme.paper;
  const writePaper = stock !== null || !onBaseRoom;
  const [cream, aged, deep, edge] = paperRungs(ground, theme.dark);

  /* -------------------------------- the ink ------------------------------- */
  const ink = resolveInk(inkId);
  /*
   * The three inks styles/settings.css remaps by hand keep their hand-tuned,
   * contrast-tested values — but only in the room they were tuned FOR.
   *
   * That used to read `ink.stylesheet !== true` alone, which meant a reader who
   * chose sepia and then chose kraft board kept the sepia that was measured
   * against cartridge: 3.90:1 at worst, and nothing in the app noticed, because
   * the ink and the paper are two different settings and neither one was ever
   * asked about the other. A shipped room on its own paper still writes
   * nothing, so the promise that "a reader who has been on sepia since install
   * sees the pixel they have always seen" holds exactly where it was made.
   */
  const shippedRoom = onBaseRoom && stock === null;
  const writeInk = ink.stylesheet !== true || !shippedRoom;
  const body = writeInk ? bodyInkFor(ink.pigment, aged, deep) : '';
  // AA_FLOOR rather than SOFT_INK_RATIO: solving to exactly the gate landed
  // some pigments at 4.48:1 — inside the binary search's own resolution, and
  // outside WCAG AA.
  const soft = writeInk
    ? inkFor(mixOklab(ink.pigment, aged, 0.3), aged, AA_FLOOR)
    : '';

  /*
   * The other two named ink rungs, re-solved on the same paper.
   *
   * `--ink-graphite`, `--ink-blue` and their soft rungs are not only what
   * `[data-ink=…]` aliases: a dozen rules name them directly (a run count, a
   * maths source line, a card blurb) because they want THAT voice rather than
   * the reader's. Those rules follow the paper stock or they do not follow
   * anything, and on the darker stocks they were the ones left behind.
   */
  const rung = (id: string): readonly [string, string] => {
    const spec = resolveInk(id);
    return [
      bodyInkFor(spec.pigment, aged, deep),
      inkFor(mixOklab(spec.pigment, aged, 0.3), aged, AA_FLOOR),
    ];
  };
  const [graphite, graphiteSoft] = shippedRoom ? ['', ''] : rung('graphite');
  const [blue, blueSoft] = shippedRoom ? ['', ''] : rung('ink-blue');

  /* ------------------------------ the accent ------------------------------ */
  const faces = washFaces(theme.accent);
  const base = intoWashBand(theme.accent);
  // After dark the ramp inverts: `-light` becomes the deep tint a callout is
  // filled with and `-deep` becomes the bright face (styles/settings.css says
  // this in words for the night room; this restates it in arithmetic).
  const accentLight = theme.dark ? mixOklab(base, cream, 0.72) : faces.light;
  const accentDeep = theme.dark ? inkFor(base, cream, AA_FLOOR) : faces.deep;
  /*
   * Solved against every ground it actually lands on, not just `aged`.
   *
   * The accent ink is a LABEL on the pale accent face as often as it is type on
   * paper — the shelf dock's primary button, the pack panel's forget control —
   * and it is set on `--paper-deep` too. Neither is `--paper-aged`, so an ink
   * solved only against that sat on them at 3.32:1. Take whichever ground is
   * HARDEST for this room and the rest come free, because `inkFor` only ever
   * moves lightness one way: the darkest ground under a window, the lightest
   * under a lamp.
   */
  const harder = (a: string, b: string): string =>
    (theme.dark ? relLum(b) > relLum(a) : relLum(b) < relLum(a)) ? b : a;
  const accentInk = inkFor(base, [aged, deep, accentLight].reduce(harder), AA_FLOOR);
  // The label a FILLED accent control wears has to clear its own fill.
  const onAccent =
    contrastRatio('#fdf9f0', accentDeep) >= contrastRatio('#2b1a10', accentDeep)
      ? '#fdf9f0'
      : '#2b1a10';
  const [ar, ag, ab] = channels(base);
  // The selection band is solved against the ink that will really be on it —
  // which is why this sits below the ink block rather than beside the accent.
  const selectionInk = body !== '' ? body : ink.pigment;
  const alpha = selectionAlpha(base, selectionInk, [cream, aged]);

  return {
    '--paper-cream': writePaper ? cream : '',
    '--paper-aged': writePaper ? aged : '',
    '--paper-deep': writePaper ? deep : '',
    '--paper-edge': writePaper ? edge : '',
    '--ink-sepia': body,
    '--ink-sepia-soft': soft,
    '--ink-graphite': graphite,
    '--ink-graphite-soft': graphiteSoft,
    '--ink-blue': blue,
    '--ink-blue-soft': blueSoft,
    '--accent-light': onBaseRoom ? '' : accentLight,
    '--accent': onBaseRoom ? '' : base,
    '--accent-deep': onBaseRoom ? '' : accentDeep,
    // These two are the accent AS TYPE, so they follow the paper, not just the
    // room: a shipped room on kraft board kept the accent ink that was solved
    // against cartridge (4.07:1). `--ink-accent` is written alongside
    // `--accent-ink` because tokens.css declares both, gives them the same
    // value, and the app uses both — deriving one of the twins is how a rail
    // button ends up on a colour the theme abandoned.
    '--accent-ink': shippedRoom ? '' : accentInk,
    '--ink-accent': shippedRoom ? '' : accentInk,
    '--on-accent': onBaseRoom ? '' : onAccent,
    '--selection-wash': onBaseRoom ? '' : `rgba(${ar}, ${ag}, ${ab}, ${alpha})`,
  };
}

/**
 * The swatch a picker chip paints itself with — the same arithmetic the real
 * page gets, so a chip cannot advertise a colour the page will not use.
 */
export interface AppearanceSwatch {
  readonly paper: string;
  readonly ink: string;
  readonly accent: string;
}

export function swatchFor(
  themeId: string,
  inkId: string,
  paperId: string | null,
): AppearanceSwatch {
  const theme = resolveTheme(themeId);
  const tokens = appearanceTokens(themeId, inkId, paperId);
  const stock = resolvePaper(paperId);
  const paper =
    tokens['--paper-cream'] !== '' ? tokens['--paper-cream'] : theme.paper;
  const aged =
    tokens['--paper-aged'] !== '' ? tokens['--paper-aged'] : paperRungs(paper, theme.dark)[1];
  const ink =
    tokens['--ink-sepia'] !== ''
      ? tokens['--ink-sepia']
      : inkFor(resolveInk(inkId).pigment, aged, BODY_INK_RATIO);
  return {
    paper: stock === null && theme.id === theme.base ? theme.paper : paper,
    ink,
    accent: intoWashBand(theme.accent),
  };
}

/* ========================= the vocabularies agree ========================= */

/**
 * The ink and paper ids this module offers are drawn from the BLOCK
 * vocabulary's own lists, not invented beside them.
 *
 * A reader who sets a page's ink to "burgundy" from the block menu and the
 * whole app's ink to "burgundy" from settings must be choosing the same
 * pigment by the same name. These two exports are what
 * `tests/plugged-in.test.ts` checks that against — if an id here ever stops
 * naming a value the editor knows, the test says so rather than the reader
 * discovering it as two different burgundies.
 *
 * `INK_ALL` and `PAPER_ALL` are two of the eleven per-axis lists that
 * `effects/vocabulary.ts` exports and that nothing in `src/` read until this
 * module did — the sixth thing the alarm found, and it found it on itself.
 */
export const BLOCK_INK_IDS: readonly string[] = INK_ALL;
export const BLOCK_PAPER_IDS: readonly string[] = PAPER_ALL;
