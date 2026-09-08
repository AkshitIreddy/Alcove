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
 * The public shelf is composed by subject, like a kept library rather than a
 * preset catalogue. Each row chooses one whole binding family and one broad
 * binder's tool. The first four books in every direction deliberately carry
 * that direction's four expanded emblems (86–117), so the shelf actually
 * exercises the artwork added for Surprise instead of showing sixty old seed
 * rolls. Later rows mix the same tools with a few authored focal bindings.
 *
 * `tone` selects one of four related cloth/leather pairs in the direction. It
 * is explicit here so adjacent subjects can change colour without breaking the
 * family language: Grand stays jewel-dark, Botanical stays leaf-led, Quiet
 * stays low contrast, and so on.
 */
const recipe = (binding, direction, emblem, tone, options = {}) =>
  Object.freeze({ binding, direction, emblem, tone, ...options });

const SHOWCASE_RECIPES = Object.freeze([
  // Floor 1
  recipe('oilcloth-rules', 'rustic', 110, 3),                 // Field Notes
  recipe('oxford-cloth', 'formal', 86, 0),                   // Kanji Practice
  recipe('linen-commonplace', 'botanical', 102, 1),          // Watercolour Basics
  recipe('cambridge-cloth', 'formal', 87, 2),                // Cell Biology
  recipe('half-cloth', 'cosy', 106, 0),                      // Recipes
  recipe('plain-cloth', 'storybook', 98, 2),                 // Dream Journal
  recipe('three-quarter-morocco', 'grand', 90, 0),           // The Long Walk
  recipe('folio-cloth', 'formal', 88, 1),                    // Chess Openings
  recipe('linen-scholar', 'botanical', 103, 0),              // Garden Log
  recipe('blind-calf', 'antique', 94, 1),                    // Letters Home
  recipe('quarter-cloth', 'botanical', 104, 2),              // Bird Counts
  recipe('oilcloth-logbook', 'rustic', 111, 3),              // Rock Pools
  recipe('linen-commonplace', 'cosy', 107, 1),               // Tea
  recipe('buckram-folio', 'formal', 89, 3),                  // First Aid
  recipe('plain-calf', 'botanical', 105, 3),                 // Allotment
  recipe('library-fillet-cloth', 'quiet', 114, 0),           // Sea Glass
  recipe('botanical-cloth', 'botanical', 102, 0),            // Hedgerows
  recipe('plain-cloth', 'storybook', 99, 3),                 // Night Sky
  recipe('roan-schoolbook', 'cosy', 108, 2),                 // Bread
  recipe('parchment-quarto', 'rustic', 112, 2),              // Cold Frames

  // Floor 2
  recipe('half-cloth', 'cosy', 109, 0),                      // Sourdough
  recipe('russia-crown', 'grand', 91, 3),                    // Astronomy
  recipe('russia-folio', 'formal', 86, 1),                   // Icelandic
  recipe('buckram-library', 'quiet', 115, 1),                // Weekly Review
  recipe('ruled-wrapper', 'storybook', 100, 1),              // Short Stories
  recipe('oxford-calf', 'formal', 87, 3),                    // Tax 2026
  recipe('plain-vellum', 'quiet', 116, 2),                   // Piano Scales
  recipe('archive-wrapper', 'quiet', 117, 0),                // Sketchbook
  recipe('plain-calf', 'antique', 95, 0),                    // Quotes
  recipe('cambridge-calf', 'antique', 96, 2),                // Marginalia
  recipe('linen-scholar', 'rustic', 113, 2),                 // Trail Notes
  recipe('quarter-cloth', 'storybook', 101, 2),              // Moths
  recipe('plain-vellum', 'botanical', 103, 0),               // Orchards
  recipe('russia-blind', 'antique', 97, 3),                  // Stone Walls
  recipe('quarter-cloth', 'quiet', 114, 0),                  // Cyanotype
  recipe('linen-botanical', 'botanical', 104, 2),            // Beekeeping
  recipe('plain-cloth', 'botanical', 105, 1),                // Lichen
  recipe('parchment-blind', 'rustic', 110, 0),               // Seed Saving
  recipe('oilcloth-rules', 'rustic', 111, 3),                // Rivers
  recipe('half-cloth-printers', 'storybook', 98, 1),         // Paper Marbling

  // Floor 3
  recipe('royal-calf', 'grand', 92, 1),                      // Wine Notes
  recipe('quarter-cloth', 'rustic', 112, 0),                 // Knots
  recipe('parchment-quarto', 'antique', 94, 0),              // Latin
  recipe('buckram-cambridge', 'quiet', 115, 1),              // Reading Log
  recipe('linen-commonplace', 'botanical', 102, 3),          // House Plants
  recipe('gilt-quarto', 'grand', 93, 2),                     // Film Diary
  recipe('botanical-wrapper', 'cosy', 106, 2),               // Mushrooms
  recipe('vellum-abbey', 'antique', 95, 1),                  // Old Letters
  recipe('half-cloth', 'cosy', 107, 0),                      // Recipes II
  recipe('linen-scholar', 'botanical', 103, 0),              // Ferns
  recipe('three-quarter-folio', 'formal', 88, 2),            // Tide Tables
  recipe('plain-cloth', 'storybook', 101, 3),                // Birds
  recipe('oilcloth-logbook', 'rustic', 113, 3),              // Rope Work
  recipe('linen-commonplace', 'cosy', 108, 1),               // Fermenting
  recipe('archive-wrapper', 'rustic', 110, 1),               // Woodcuts
  recipe('three-quarter-crown', 'grand', 90, 0),             // Constellations
  recipe('plain-vellum', 'quiet', 116, 2),                   // Frost Dates
  recipe('roan-terminal', 'grand', 91, 1),                   // Bookbinding
  recipe('buckram-cambridge', 'rustic', 111, 2),             // Hill Walks
  recipe('half-cloth-prize', 'cosy', 109, 1),                // Winter Notes
]);

const DIRECTION_ART = Object.freeze({
  formal: Object.freeze({
    palettes: [['#326db3', '#204c82'], ['#4f59a7', '#353f7d'], ['#247b8b', '#185866'], ['#a13f50', '#712c3a']],
    tooling: ['#f3cf70', '#f4dda4'], frames: [56, 57, 58],
    titles: ['navigator-compass-label', 'archivist-index-tab', 'cameo-wreath-label'],
    bands: [2, 3, 2, 3], gilt: true, headTail: true, edge: ['gilt', 'plain'], hands: [31, 43, 0],
  }),
  grand: Object.freeze({
    palettes: [['#1f5fa5', '#153f72'], ['#923047', '#642031'], ['#247556', '#174e39'], ['#75428f', '#502d63']],
    tooling: ['#f2c559', '#f6dc8a'], frames: [59, 60, 61],
    titles: ['gothic-pointed-panel', 'fanfare-pediment', 'crown-quatrefoil', 'imperial-fan-panel'],
    bands: [3, 3, 2, 3], gilt: true, headTail: true, edge: ['gilt', 'red-under-gold'], hands: [31, 43, 9],
  }),
  antique: Object.freeze({
    palettes: [['#aa6d38', '#744723'], ['#8e573d', '#603a2a'], ['#866641', '#59442c'], ['#7c7240', '#534d2b']],
    tooling: ['#edcb91', '#d9b67c'], frames: [62, 63, 64],
    titles: ['navigator-compass-label', 'archivist-index-tab', 'gothic-pointed-panel', 'cameo-wreath-label'],
    bands: [3, 2, 3, 2], gilt: false, headTail: true, edge: ['sepia-edge', 'deckle'], hands: [0, 9, 38],
  }),
  storybook: Object.freeze({
    palettes: [['#23819a', '#185c70'], ['#ad4268', '#7a2e49'], ['#784fa4', '#533673'], ['#4383b2', '#2d5d82']],
    tooling: ['#f6d77c', '#f1e0ac'], frames: [65, 66, 67],
    titles: ['storybook-scallop-cartouche', 'ribbon-tail-cartouche', 'celestial-orbit-roundel'],
    bands: [0, 1, 0, 1], gilt: true, headTail: false, edge: ['plain', 'stained-red'], hands: [0, 1, 9],
  }),
  botanical: Object.freeze({
    palettes: [['#418650', '#295e36'], ['#287f6d', '#19594c'], ['#758d3f', '#4e6127'], ['#3d815c', '#27583e']],
    tooling: ['#edd88a', '#e2c978'], frames: [68, 69, 70],
    titles: ['herbarium-caption', 'foliate-shoulder-field', 'cameo-wreath-label'],
    bands: [0, 1, 0, 1], gilt: false, headTail: false, edge: ['plain', 'deckle'], hands: [0, 2, 38],
  }),
  cosy: Object.freeze({
    palettes: [['#b65d49', '#803c31'], ['#ae607d', '#7b4159'], ['#b17e30', '#7b5620'], ['#748d6b', '#4e6248']],
    tooling: ['#f5d59b', '#f2e1b7'], frames: [71, 72, 73],
    titles: ['sewn-linen-label', 'field-note-corner-ticket', 'storybook-scallop-cartouche'],
    bands: [0, 0, 1, 0], gilt: false, headTail: false, edge: ['plain', 'stained-red'], hands: [0, 2, 1],
  }),
  rustic: Object.freeze({
    palettes: [['#af752f', '#79501f'], ['#b55b33', '#7d3c24'], ['#527442', '#354e2d'], ['#42778d', '#2b5364']],
    tooling: ['#edc27b', '#e5d2a0'], frames: [74, 75, 76],
    titles: ['artisan-notched-label', 'field-note-corner-ticket', 'sewn-linen-label'],
    bands: [0, 1, 2, 0], gilt: false, headTail: false, edge: ['deckle', 'sepia-edge'], hands: [2, 38, 0],
  }),
  quiet: Object.freeze({
    palettes: [['#6383a2', '#455d76'], ['#57847f', '#3a5f5a'], ['#826f96', '#5b4e6c'], ['#7d8766', '#565f46']],
    tooling: ['#e8dfc5', '#d9cfb1'], frames: [77, 78, 79],
    titles: ['whisper-rules', 'field-note-corner-ticket', 'herbarium-caption'],
    bands: [0, 0, 1, 0], gilt: false, headTail: false, edge: ['plain'], hands: [38, 0, 2],
  }),
});

/** Wider showcase backs give the real binder tools enough room to read while
 * retaining a visibly irregular shelf rhythm. Rotating the phrase per floor
 * prevents the same silhouettes from stacking vertically. */
const SPINE_WIDTHS = Object.freeze([
  33, 41, 30, 45, 36, 28, 43, 35, 31, 40,
  26, 42, 34, 40, 29, 37, 44, 30, 39, 35,
]);

export const SHOWCASE_BINDINGS = Object.freeze(SHOWCASE_RECIPES.map((entry) => entry.binding));

export const SHOWCASE_STYLES = Object.freeze(
  SHOWCASE_RECIPES.map((entry, index) => {
    const art = DIRECTION_ART[entry.direction];
    const floor = Math.floor(index / 20);
    const slot = index % 20;
    const tone = entry.tone % art.palettes.length;
    const [base, accent] = art.palettes[tone];
    const tooling = art.tooling[(tone + floor) % art.tooling.length];
    return Object.freeze({
      pigment: (index * 11 + tone * 3) % 50,
      hueJitter: 0,
      spineBaseHex: base,
      spineAccentHex: accent,
      coverBaseHex: base,
      coverAccentHex: accent,
      toolingHex: tooling,
      emblemHex: tooling,
      ornament: entry.emblem,
      coverMedallion: entry.emblem,
      coverFrame: art.frames[(slot + tone) % art.frames.length],
      titlePlate: art.titles[(slot + floor) % art.titles.length],
      titleFont: art.hands[(slot + tone) % art.hands.length],
      raisedBands: art.bands[(slot + floor) % art.bands.length],
      bandGilt: art.gilt,
      gilt: art.gilt,
      headTail: art.headTail,
      headTailStyle: 1 + ((slot + tone + floor) % 3),
      edge: art.edge[(slot + tone) % art.edge.length],
      wear: entry.direction === 'antique' || entry.direction === 'rustic' ? 0.12 : 0.03,
      thickness: SPINE_WIDTHS[(slot + floor * 7) % SPINE_WIDTHS.length],
    });
  }),
);

if (
  SHOWCASE_TITLES.length !== 60 ||
  SHOWCASE_BINDINGS.length !== SHOWCASE_TITLES.length ||
  SHOWCASE_STYLES.length !== SHOWCASE_TITLES.length
) {
  throw new Error('showcase-library: titles, bindings and authored styles must stay aligned');
}
