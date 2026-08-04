/**
 * src/editor/rulings.ts — what each ruling is CALLED, which family it belongs
 * to, and how good it is. The ids themselves live in `data/types.ts`.
 *
 * The reader's complaint was "page style only shows four options… at least 20
 * here", and four was never a vocabulary — it was a placeholder that outlived
 * the placeholder stage. There are twenty-seven now, and the shape of this file
 * is the one `art/bookDesign.ts` settled on for the same problem:
 *
 *  - **`Record<PageStyle, Ruling>`.** Not an array. A twenty-eighth id added to
 *    `PAGE_STYLES` is a compile error here until somebody has given it a name
 *    and a tier — which is the whole reason the ids and the names live in two
 *    files instead of one list nobody has to finish.
 *  - **Every entry declares a `tier`**, and the order every picker shows is
 *    DERIVED from it. Nothing is hand-sorted, so adding a ruling in the middle
 *    of the table cannot silently re-sort the panel.
 *  - **The head of the derived order IS the shortlist** the rail panel shows
 *    before its "more" control. That is why the sort is tier-first and family-
 *    second, the opposite of `bookDesign.ts`: sorted family-first, all six
 *    visible cells would go to horizontal rules and a reader would have to
 *    expand the panel to find grid paper, which is one of the four they already
 *    had. Tier-first spends those cells on the best of each family.
 *
 * The settings sheet reached the same three conclusions for its papers, inks
 * and hands (`features/settings/appearance.ts` — `ordered()`, `signatures()`,
 * `rollable()`), and this file deliberately does NOT import them: those are
 * private helpers typed against that module's own `Entry`, and exporting them
 * into the editor layer to save nine lines would tie a page's ruling to the
 * appearance sheet's tier union forever. Two small derivations, one shape.
 *
 * There is no roll pool here and `isRollable` has no caller yet: nothing in the
 * app deals a reader a random ruling. When something does, it walks the tiers —
 * `oddity` is paper that is not for prose (guitar tab, storyboard frames, log
 * paper), and handing one of those to somebody who pressed "surprise me" would
 * read as a bug rather than as a surprise.
 *
 * The paint is `src/styles/rulings.css`, which is keyed off the same ids and is
 * consumed by BOTH the page and the panel's thumbnail — see the header there.
 */
import type { PageStyle } from '../data/types';
import { PAGE_STYLES } from '../data/types';

/**
 * How good a ruling is, best first. Same four words as `BookTier`, and
 * deliberately not imported from it: that union is about a book's binding, and
 * one enum shared by two vocabularies is one enum that grows a word only one of
 * them wants.
 */
export type RulingTier =
  /** Paper most people want most days. The panel opens on these. */
  | 'signature'
  /** Sound and everyday, a step off the front page. */
  | 'shelf'
  /** Real paper for a real job, but a specialised one. */
  | 'niche'
  /** Not for prose at all — frames, staves, decades. Pickable, never rolled. */
  | 'oddity';

const TIER_RANK: Readonly<Record<RulingTier, number>> = {
  signature: 0,
  shelf: 1,
  niche: 2,
  oddity: 3,
};

/**
 * May a roll of the dice land here? A function of the tier alone, never a
 * second boolean on the row: two fields that must agree is two fields that
 * will one day disagree, and the one that would be wrong is the one nothing
 * checks.
 */
export function isRollable(tier: RulingTier): boolean {
  return tier !== 'oddity';
}

/** The families, strongest first. Ties inside a tier break on this order. */
export type RulingGroup = 'rule' | 'square' | 'dot' | 'guide' | 'staff' | 'plain';

const GROUPS: readonly RulingGroup[] = [
  'rule',
  'square',
  'dot',
  'guide',
  'staff',
  'plain',
];

/**
 * What a family is called when it is SAID rather than sorted by.
 *
 * The curation menu offers "first in <family>" over whatever a row calls its
 * group, and a menu reading "first in square" is a machine word leaking into a
 * sentence a reader is meant to understand.
 */
export const RULING_FAMILY: Readonly<Record<RulingGroup, string>> = {
  rule: 'the ruled papers',
  square: 'the grids',
  dot: 'the dotted papers',
  guide: 'the writing guides',
  staff: 'the staves',
  plain: 'the plain papers',
};

export interface Ruling {
  /** What the card says. Sentence case, because it is a name and not a label. */
  readonly name: string;
  /** One line, in the reader's words. Tooltip and screen-reader description. */
  readonly blurb: string;
  readonly group: RulingGroup;
  readonly tier: RulingTier;
}

/**
 * Every ruling, written in family order because that is the order they were
 * DESIGNED in and the order a diff is readable in. Nothing reads this order —
 * see `RULING_ORDER` below.
 */
export const RULINGS: Readonly<Record<PageStyle, Ruling>> = {
  /* --- horizontal rules: paper you write prose on ----------------------- */
  ruled: {
    name: 'Ruled lines',
    blurb: 'One line to write on, every line.',
    group: 'rule',
    tier: 'signature',
  },
  college: {
    name: 'College rule',
    blurb: 'Ruled, with a red margin down the left.',
    group: 'rule',
    tier: 'signature',
  },
  narrow: {
    name: 'Narrow rule',
    blurb: 'Twice as many lines, for a small hand.',
    group: 'rule',
    tier: 'shelf',
  },
  wide: {
    name: 'Wide rule',
    blurb: 'A line every other line — room for a big hand.',
    group: 'rule',
    tier: 'shelf',
  },
  dashed: {
    name: 'Dashed rule',
    blurb: 'Pencil dashes instead of a solid line.',
    group: 'rule',
    tier: 'shelf',
  },
  double: {
    name: 'Double rule',
    blurb: 'A ledger line with a hairline beneath it.',
    group: 'rule',
    tier: 'niche',
  },
  legal: {
    name: 'Legal pad',
    blurb: 'Ruled, with the double red margin of a legal pad.',
    group: 'rule',
    tier: 'niche',
  },

  /* --- squares and lattices --------------------------------------------- */
  grid: {
    name: 'Grid squares',
    blurb: 'Even squares, half a line apart.',
    group: 'square',
    tier: 'signature',
  },
  graph: {
    name: 'Graph paper',
    blurb: 'Fine squares with a heavy line every fifth.',
    group: 'square',
    tier: 'signature',
  },
  quadrille: {
    name: 'Fine quadrille',
    blurb: 'Small squares, faint — maths and margins.',
    group: 'square',
    tier: 'shelf',
  },
  'quadrille-wide': {
    name: 'Wide quadrille',
    blurb: 'One big square per line of writing.',
    group: 'square',
    tier: 'shelf',
  },
  iso: {
    name: 'Isometric',
    blurb: 'Thirty-degree lattice, for drawing in three-quarters.',
    group: 'square',
    tier: 'shelf',
  },
  engineering: {
    name: 'Engineering',
    blurb: 'A ghost grid, a red margin and a title band.',
    group: 'square',
    tier: 'niche',
  },

  /* --- dots -------------------------------------------------------------- */
  dotted: {
    name: 'Dot grid',
    blurb: 'Dots where a grid would cross. Bullet journals.',
    group: 'dot',
    tier: 'signature',
  },
  'dot-fine': {
    name: 'Fine dots',
    blurb: 'The dot grid, tightened up.',
    group: 'dot',
    tier: 'shelf',
  },
  'dot-wide': {
    name: 'Wide dots',
    blurb: 'One dot per line of writing. Very quiet paper.',
    group: 'dot',
    tier: 'shelf',
  },
  cross: {
    name: 'Cross ticks',
    blurb: 'A tiny plus where a grid would cross.',
    group: 'dot',
    tier: 'niche',
  },
  hex: {
    name: 'Hex dots',
    blurb: 'Dots on a hexagonal lattice, for isometric sketching.',
    group: 'dot',
    tier: 'niche',
  },

  /* --- guides a hand is trained against ---------------------------------- */
  manuscript: {
    name: 'Handwriting guide',
    blurb: 'Baseline, dashed x-height and an ascender line.',
    group: 'guide',
    tier: 'shelf',
  },
  cornell: {
    name: 'Cornell notes',
    blurb: 'Ruled, with a cue column down the left third.',
    group: 'guide',
    tier: 'shelf',
  },
  calligraphy: {
    name: 'Calligraphy slant',
    blurb: 'Baselines with slant guides for a broad nib.',
    group: 'guide',
    tier: 'niche',
  },
  margin: {
    name: 'Margin only',
    blurb: 'Blank paper with one red margin rule.',
    group: 'guide',
    tier: 'niche',
  },

  /* --- staves and frames -------------------------------------------------- */
  staves: {
    name: 'Music staves',
    blurb: 'Five-line staves with room to write between.',
    group: 'staff',
    tier: 'niche',
  },
  tab: {
    name: 'Guitar tab',
    blurb: 'Six strings to a system.',
    group: 'staff',
    tier: 'oddity',
  },

  /* --- and the paper with nothing printed on it --------------------------- */
  blank: {
    name: 'Blank paper',
    blurb: 'Nothing at all. The page is yours.',
    group: 'plain',
    tier: 'signature',
  },
  storyboard: {
    name: 'Storyboard',
    blurb: 'Frames with a caption strip under each.',
    group: 'plain',
    tier: 'oddity',
  },
  log: {
    name: 'Log paper',
    blurb: 'Decades across, plain rules down. Semi-log.',
    group: 'plain',
    tier: 'oddity',
  },
};

/** One row of the picker: the id, plus everything `RULINGS` knows about it. */
export interface RulingRow extends Ruling {
  readonly id: PageStyle;
}

/**
 * Picker order: tier, then family, then the order it was written in.
 *
 * Derived, never hand-sorted — see the header. The tie-break on written order
 * is what keeps `ruled` ahead of `college`: both are signature rules, and the
 * one this app has always opened on should stay the first card.
 */
export const RULING_ORDER: readonly RulingRow[] = PAGE_STYLES.map((id, i) => ({
  id,
  i,
  ...RULINGS[id],
}))
  .sort(
    (a, b) =>
      TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
      GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) ||
      a.i - b.i,
  )
  .map(({ i: _i, ...row }) => row);

/**
 * How many cards the rail panel shows before its "more" control.
 *
 * Six, which is exactly the `signature` tier — so the shortlist is a fact about
 * the vocabulary rather than a number somebody picked, and promoting a ruling
 * to `signature` is how it gets onto the front page. Asserted in
 * tests/rulings.test.ts, because a seventh signature would silently push the
 * sixth behind the control.
 */
export const RULING_SHORTLIST = RULING_ORDER.filter(
  (row) => row.tier === 'signature',
).length;
