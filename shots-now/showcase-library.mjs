/**
 * One authored library portrait shared by the README and the looping demo.
 *
 * These are presentation fixtures, not defaults for a reader's real library.
 * The product's fresh-book generator remains free to be quiet or pale; the two
 * public portraits deliberately show the breadth of the finished binding
 * system. Keeping the data in one module prevents the README still and demo
 * film from drifting into two visibly different libraries again.
 */

export const SHOWCASE_FLOORS = Object.freeze([
  Object.freeze([
    'Field Notes', 'Kanji Practice', 'Watercolour Basics', 'Cell Biology',
    'Recipes', 'Dream Journal', 'The Long Walk', 'Chess Openings', 'Garden Log',
    'Letters Home', 'Bird Counts', 'Rock Pools', 'Tea', 'First Aid', 'Allotment',
    'Sea Glass', 'Hedgerows', 'Night Sky', 'Bread', 'Cold Frames',
  ]),
  Object.freeze([
    'Sourdough', 'Astronomy', 'Icelandic', 'Weekly Review', 'Short Stories',
    'Tax 2026', 'Piano Scales', 'Sketchbook', 'Quotes', 'Marginalia',
    'Trail Notes', 'Moths', 'Orchards', 'Stone Walls', 'Cyanotype', 'Beekeeping',
    'Lichen', 'Seed Saving', 'Rivers', 'Paper Marbling',
  ]),
  Object.freeze([
    'Wine Notes', 'Knots', 'Latin', 'Reading Log', 'House Plants', 'Film Diary',
    'Mushrooms', 'Old Letters', 'Recipes II', 'Ferns', 'Tide Tables', 'Birds',
    'Rope Work', 'Fermenting', 'Woodcuts', 'Constellations', 'Frost Dates',
    'Bookbinding', 'Hill Walks', 'Winter Notes',
  ]),
]);

export const SHOWCASE_TITLES = Object.freeze(SHOWCASE_FLOORS.flat());

/**
 * Twenty bindings per floor, deliberately interleaved across cloth, calf,
 * Russia, roan, oilcloth and split constructions. Pale vellum, parchment and
 * wrapper families stay available in the product but are absent here: grouped
 * together at the foot of the case they made the public portrait look washed
 * out. Repeats are separated by floor and recoloured, never adjacent.
 */
export const SHOWCASE_BINDINGS = Object.freeze([
  // Floor 1 — formal cloth alternating with leather and split construction.
  'gilt-quarto', 'blind-calf', 'botanical-cloth', 'half-calf',
  'cambridge-cloth', 'russia-folio', 'linen-botanical', 'quarter-calf',
  'printers-cloth', 'royal-calf', 'buckram-oxford', 'half-laurel',
  'velvet-palmette', 'oilcloth-rules', 'folio-cloth',
  'three-quarter-morocco', 'prize-cloth', 'roan-fillet',
  'half-cloth-botanical', 'oxford-cloth',

  // Floor 2 — a different construction rhythm with no pale-material cluster.
  'calf-compartments', 'linen-printers', 'half-cloth', 'russia-blind',
  'botanical-cloth', 'buckram-cambridge', 'quarter-scholar', 'velvet-crown',
  'oilcloth-terminal', 'cambridge-calf', 'prize-cloth',
  'three-quarter-folio', 'library-fillet-cloth', 'russia-crown',
  'roan-botanical', 'half-oxford', 'linen-scholar', 'buckram-folio',
  'gilt-quarto', 'quarter-botanical',

  // Floor 3 — as colourful and authored as the upper floors, not a pale bin.
  'royal-calf', 'printers-cloth', 'half-cloth-prize', 'oxford-calf',
  'velvet-palmette', 'oilcloth-logbook', 'cambridge-cloth',
  'half-cloth-printers', 'russia-scholar', 'linen-commonplace', 'folio-cloth',
  'roan-terminal', 'buckram-library', 'plain-cloth', 'laurel-calf',
  'quarter-cloth', 'three-quarter-crown', 'roan-schoolbook',
  'oilcloth-rules', 'half-cloth',
]);

const JEWEL_AND_EARTH = Object.freeze([
  ['#24477c', '#19345e'], // midnight blue
  ['#245caa', '#194580'], // royal blue
  ['#166a8f', '#0f506f'], // peacock blue
  ['#0d7770', '#095b57'], // teal
  ['#177a57', '#0f5c42'], // emerald
  ['#2f6a39', '#214f2b'], // forest
  ['#4d721f', '#385619'], // leaf green
  ['#55358c', '#3f286c'], // violet
  ['#6c2f85', '#502365'], // imperial purple
  ['#822b6d', '#622052'], // magenta
  ['#922d52', '#6f213e'], // berry
  ['#aa2f46', '#822236'], // crimson
  ['#a73a2f', '#7f2b24'], // vermilion
  ['#b34a1e', '#893715'], // rust
  ['#c36116', '#96480f'], // burnt orange
  ['#b77d0a', '#8b5e08'], // ochre
  ['#4b2876', '#371d59'], // indigo
  ['#294f6a', '#1d3a50'], // blue slate
  ['#6b2748', '#501c36'], // burgundy
  ['#466424', '#334a1b'], // olive
]);

const TOOLING = Object.freeze(['#f1d16f', '#f3dc92', '#f0c7a4', '#d5e0a0']);

/**
 * Exact colour roles, rotated per floor so the same twenty-colour phrase does
 * not repeat vertically. The faces stay saturated while accents remain dark
 * enough to preserve the app's one-outline, flat binding language.
 */
export const SHOWCASE_STYLES = Object.freeze(
  SHOWCASE_TITLES.map((_, index) => {
    const floor = Math.floor(index / 20);
    const slot = index % 20;
    const paletteIndex = (slot + [0, 7, 13][floor]) % JEWEL_AND_EARTH.length;
    const [base, accent] = JEWEL_AND_EARTH[paletteIndex];
    const metal = TOOLING[(slot + floor) % TOOLING.length];
    return Object.freeze({
      pigment: (paletteIndex * 7 + floor * 3) % 50,
      hueJitter: 0,
      spineBaseHex: base,
      spineAccentHex: accent,
      coverBaseHex: base,
      coverAccentHex: accent,
      toolingHex: metal,
      emblemHex: metal,
    });
  }),
);

if (
  SHOWCASE_TITLES.length !== 60 ||
  SHOWCASE_BINDINGS.length !== SHOWCASE_TITLES.length ||
  SHOWCASE_STYLES.length !== SHOWCASE_TITLES.length
) {
  throw new Error('showcase-library: titles, bindings and colours must stay aligned');
}
