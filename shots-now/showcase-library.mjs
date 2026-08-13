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

const LIBRARY_CLOTH = Object.freeze([
  ['#3c5774', '#2b415c'], // ink blue
  ['#46658b', '#334e70'], // library blue
  ['#3c6b7c', '#2c5362'], // faded peacock
  ['#3e726c', '#2d5955'], // oxidised teal
  ['#47715d', '#345847'], // moss green
  ['#4f6d4e', '#3a543b'], // forest cloth
  ['#657446', '#4d5935'], // lichen
  ['#665379', '#4d3d60'], // dusty violet
  ['#745170', '#593d57'], // plum cloth
  ['#805064', '#623d4e'], // mulberry
  ['#854d59', '#653a45'], // faded berry
  ['#905047', '#6e3b35'], // brick red
  ['#8d5845', '#6b4234'], // terracotta
  ['#956142', '#714932'], // russet
  ['#a06d43', '#7a5132'], // warm leather
  ['#9a7847', '#745a35'], // antique ochre
  ['#594c74', '#423857'], // quiet indigo
  ['#425d6b', '#314854'], // blue slate
  ['#76505b', '#593b45'], // burgundy cloth
  ['#5f7048', '#475536'], // olive
]);

const TOOLING = Object.freeze(['#d8bd72', '#dfc98b', '#d8b59b', '#bbc78d']);

/**
 * Exact colour roles, rotated per floor so the same twenty-colour phrase does
 * not repeat vertically. These are recognisably coloured cloths, not a rainbow:
 * every hue is folded toward library dust and ink while accents remain dark
 * enough to preserve the app's one-outline, flat binding language.
 */
export const SHOWCASE_STYLES = Object.freeze(
  SHOWCASE_TITLES.map((_, index) => {
    const floor = Math.floor(index / 20);
    const slot = index % 20;
    const paletteIndex = (slot + [0, 7, 13][floor]) % LIBRARY_CLOTH.length;
    const [base, accent] = LIBRARY_CLOTH[paletteIndex];
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
