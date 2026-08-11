/**
 * src/editor/effects/vocabulary.ts — the PAGE side of the design vocabulary.
 *
 * `src/art/` carries three vocabularies for the room a book sits in (carpentry,
 * wallpaper, binding). This is the fourth, and it lives in the editor because
 * it is about the page rather than the shelf: what you can do to a block once
 * you have written it.
 *
 * Eleven axes, each a list of NAMED values with a label and a mood tag list,
 * in three shelves:
 *
 *   trim       tape · washi · lift · frame · paper · underline    300 entries
 *   lettering  hand · ink · size · ranging                        122 entries
 *   colour     tint                                                50 entries
 *
 * Eight of the eleven carry fifty. The three that do not are honest about it:
 * `size` and `align` are *scales*, not designs — a page has one axis of
 * lettering size and four of ranging, and a fiftieth entry on either could
 * only be a number nobody would recognise in a picker. `tint` is the one axis
 * that is pure colour, so it gets fifty pigments rather than fifty shapes.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists next to `src/script/vocab.ts`
 * ---------------------------------------------------------------------------
 * `script/vocab.ts` is the *writing language's* domain: the set the tolerant
 * attr parser fuzzy-matches against, and the set `scripts/gen-spec.mjs` prints
 * into the AI-facing spec. It is deliberately smaller and slower-moving — a
 * name there is a promise to a chatbot.
 *
 * This file is the *editor's* domain: what a reader can actually apply from a
 * menu, and what `BlockEffects` will therefore accept as an attribute value.
 * It READS the script's whole key→domain table rather than restating any part
 * of it, and extends it. Everything the script offers, the editor offers.
 *
 * The one rule that keeps the two safe together: **a new value must be more
 * than two edits away from every value in the script's own list for that key.**
 * The attr parser fuzzy-matches with Levenshtein ≤ 2 within a domain, so a new
 * `tape=tops` would be silently rewritten to `tape=top` on the way in from
 * script. Every name below was picked with that clearance. `nearestScriptEdit`
 * at the bottom is the check, `fuzzyCollisions()` prints the offenders, and
 * both are exported so a test can hold the line.
 *
 * Rendering is `src/styles/effects.css`, keyed off the same `data-<key>`
 * attributes — pure CSS, no per-block JS, nothing that rasterizes. That matters
 * more here than anywhere else in the app: a previous round found ~85% of an
 * edit window inside html-to-image driven by a hover loop, so an effect that
 * costs a repaint on hover is not an effect, it is a regression. Every value
 * below is a background, a border, a clip-path, a pseudo-element or a font
 * property; none is a filter, an animation or a blur.
 */
// The parser's key→domain table, whole. The eleven lists used to be imported
// one by one and re-assembled into a mapping down at SCRIPT_DOMAINS, which is
// the same table typed a second time — see the note there.
import {
  ATTR_ENUM_DOMAINS,
  registerScriptAttrValues,
} from '../../script/vocab';

export type EffectShelf = 'trim' | 'lettering' | 'colour';

export interface EffectValue {
  /** Stored verbatim as `data-<key>`. */
  readonly value: string;
  /** What the picker calls it. Lowercase, a stationer's words. */
  readonly label: string;
  /** The "in the mood for" row — search keywords, not a description. */
  readonly tags: readonly string[];
}

export interface EffectAxis {
  readonly key: string;
  /** Heading for the axis inside its shelf. */
  readonly label: string;
  readonly shelf: EffectShelf;
  /** One line saying what the axis is for. */
  readonly blurb: string;
  readonly values: readonly EffectValue[];
}

/** Terse constructor — the tables below are read far more often than written. */
function v(value: string, label: string, ...tags: string[]): EffectValue {
  return { value, label, tags };
}

/* ========================================================================== *
 *                                  1. trim                                   *
 * ========================================================================== */

/**
 * TAPE — how the block is FIXED to the page.
 *
 * Three kinds of answer, which is what keeps fifty of them apart: where the
 * strip lands (nine placements plus seven arrangements), what the strip is
 * made of (fourteen stocks, each a different translucency and colour of
 * adhesive), and what is holding it down INSTEAD of tape (fifteen fasteners —
 * a staple reads nothing like a wax seal). The last three are tape that has
 * been on the page a while.
 */
const TAPE: readonly EffectValue[] = [
  /* placements — plain scotch, moved about */
  v('top', 'tape, top', 'classic', 'centred', 'scrapbook'),
  v('corner', 'tape, corner', 'casual', 'one strip', 'angled'),
  v('both', 'tape, both ends', 'pinned down', 'symmetrical', 'scrapbook'),
  v('left', 'tape, left edge', 'hinged', 'side', 'album'),
  v('right', 'tape, right edge', 'hinged', 'side', 'album'),
  v('bottom', 'tape, foot', 'held down', 'under', 'stable'),
  v('cross', 'crossed strips', 'x marks it', 'urgent', 'sealed'),
  v('quad', 'all four corners', 'photo album', 'mounted', 'formal'),
  v('band', 'a band behind', 'wide', 'label', 'shelf edge'),
  /* arrangements — more than one strip */
  v('sliver', 'a sliver', 'barely there', 'narrow', 'quiet'),
  v('twin', 'two parallel', 'tidy', 'doubled', 'neat'),
  v('triple', 'three strips', 'over-taped', 'busy', 'emphatic'),
  v('ladder', 'rungs down both sides', 'ladder', 'bound', 'repeating'),
  v('seam', 'a seam down the middle', 'joined', 'split', 'repaired'),
  v('splice', 'spliced across', 'diagonal', 'cut and joined', 'film'),
  v('vee', 'a vee of tape', 'chevron', 'angled pair', 'playful'),
  /* stocks — what the tape is made of */
  v('masking', 'masking tape', 'matte', 'painter', 'cream'),
  v('parcel', 'parcel tape', 'brown', 'shipping', 'kraft'),
  v('duct', 'duct tape', 'grey', 'heavy', 'utility'),
  v('gaffer', 'gaffer tape', 'matte black', 'stage', 'strong'),
  v('electric', 'insulating tape', 'glossy', 'dark', 'technical'),
  v('surgical', 'surgical tape', 'white', 'perforated', 'clean'),
  v('frosted', 'invisible tape', 'matte', 'nearly gone', 'discreet'),
  v('glassy', 'cellophane', 'shiny', 'crisp', 'clear'),
  v('crepe', 'crepe tape', 'crinkled', 'paper', 'soft'),
  v('gummed', 'gummed paper', 'licked', 'archival', 'brown'),
  v('strapping', 'strapping tape', 'filament', 'reinforced', 'industrial'),
  v('bookcloth', 'book cloth', 'binding', 'library', 'rich'),
  v('kraft', 'kraft strip', 'parcel', 'rustic', 'plain'),
  v('foilstrip', 'foil tape', 'gilt', 'special', 'bright'),
  /* fasteners — no tape at all */
  v('staple', 'stapled', 'office', 'quick', 'metal'),
  v('clip', 'a paperclip', 'filed', 'temporary', 'metal'),
  v('bulldog', 'a bulldog clip', 'chunky', 'held firm', 'desk'),
  v('pushpin', 'a push-pin', 'noticeboard', 'pinned', 'bright'),
  v('tack', 'a brass tack', 'small', 'pinned', 'metal'),
  v('eyelet', 'punched eyelets', 'laced', 'archival', 'metal'),
  v('studded', 'studded', 'workshop', 'permanent', 'metal'),
  v('brad', 'split-pin brads', 'fastened', 'craft', 'brass'),
  v('grommet', 'grommets', 'canvas', 'heavy', 'workshop'),
  v('wax', 'a wax seal', 'letter', 'ceremony', 'red'),
  v('ribbon', 'a ribbon tie', 'gift', 'pretty', 'soft'),
  v('string', 'string and button', 'envelope', 'craft', 'old'),
  v('mounts', 'photo corners', 'album', 'archival', 'neat'),
  v('pouch', 'slid into a pocket', 'library card', 'filed', 'tucked'),
  v('dogear', 'folded corner', 'read already', 'turned down', 'quiet'),
  v('hinge', 'two hinges', 'photo mount', 'archival', 'neat'),
  v('patch', 'a patch of tape', 'repaired', 'rough', 'mended'),
  /* tape that has been there a while */
  v('ripped', 'a ripped end', 'torn off', 'hurried', 'rough'),
  v('curled', 'curling up', 'old', 'lifting', 'worn'),
  v('yellowed', 'yellowed with age', 'archive', 'amber', 'old'),
];

/**
 * WASHI — patterned paper tape.
 *
 * Where `tape` varies by placement and adhesive, washi varies by PRINT: that
 * is the whole point of the stuff. Seven placements for a plain strip, then
 * forty-three prints, each a different repeating gradient across the top edge.
 * Nothing here is a photograph of a pattern — every one is drawn by
 * repeating-linear-gradient or tiled radial dots, which is why fifty of them
 * cost nothing to keep in the stylesheet.
 */
const WASHI: readonly EffectValue[] = [
  /* placements */
  v('top', 'washi, top', 'pretty', 'craft', 'classic'),
  v('left', 'washi, left', 'spine', 'bound', 'craft'),
  v('corner', 'washi, corner', 'angled', 'casual', 'pretty'),
  v('bottom', 'washi, foot', 'grounded', 'craft', 'ledge'),
  v('right', 'washi, right', 'spine', 'flipped', 'craft'),
  v('cross', 'crossed washi', 'busy', 'layered', 'craft'),
  v('edge', 'washi all round', 'framed', 'contained', 'rich'),
  /* prints — stripes and geometry */
  v('stripe', 'candy stripe', 'classic', 'diagonal', 'cheerful'),
  v('pinstripe', 'pinstripe', 'fine', 'tailored', 'quiet'),
  v('gingham', 'gingham', 'picnic', 'checked', 'sweet'),
  v('check', 'window check', 'squared', 'tidy', 'plain'),
  v('tartan', 'tartan', 'wool', 'winter', 'rich'),
  v('plaid', 'plaid', 'blanket', 'cosy', 'warm'),
  v('chevron', 'chevron', 'arrows', 'graphic', 'lively'),
  v('herringbone', 'herringbone', 'tweed', 'woven', 'smart'),
  v('zigzag', 'pinked zigzag', 'lively', 'craft', 'sharp'),
  v('wavy', 'wave print', 'sea', 'flowing', 'gentle'),
  v('scalloped', 'scallop print', 'doily', 'sweet', 'craft'),
  v('diamond', 'diamonds', 'harlequin', 'graphic', 'bold'),
  v('argyle', 'argyle', 'knitwear', 'preppy', 'warm'),
  v('lattice', 'lattice', 'trellis', 'garden', 'airy'),
  v('honeycomb', 'honeycomb', 'hexagons', 'bees', 'warm'),
  v('brickwork', 'brick bond', 'wall', 'earthy', 'sturdy'),
  v('mosaic', 'mosaic', 'tiles', 'rich', 'ancient'),
  v('ticking', 'mattress ticking', 'french', 'linen', 'calm'),
  v('seersucker', 'seersucker', 'summer', 'puckered', 'cool'),
  /* prints — spots and confetti */
  v('spots', 'spotted', 'playful', 'cheerful', 'craft'),
  v('polka', 'polka dots', 'big spots', 'retro', 'bold'),
  v('confetti', 'confetti', 'party', 'scattered', 'joyful'),
  v('beads', 'strung beads', 'delicate', 'row', 'pretty'),
  v('speckle', 'speckled', 'granite', 'flecked', 'quiet'),
  v('ricrac', 'ric-rac', 'haberdashery', 'zigzag braid', 'sweet'),
  /* prints — nature */
  v('floral', 'ditsy floral', 'garden', 'spring', 'pretty'),
  v('ivy', 'trailing ivy', 'leaves', 'green', 'garden'),
  v('vine', 'vine', 'growing', 'botanical', 'calm'),
  v('fern', 'fern frond', 'woodland', 'green', 'delicate'),
  v('bamboo', 'bamboo', 'segments', 'calm', 'eastern'),
  v('clouds', 'little clouds', 'sky', 'dreamy', 'soft'),
  v('rainbow', 'rainbow bands', 'joyful', 'bright', 'children'),
  v('moons', 'phases of the moon', 'night', 'quiet', 'magic'),
  v('sunbeam', 'sunbeams', 'rays', 'morning', 'warm'),
  /* prints — marks and symbols */
  v('stars', 'little stars', 'night', 'magic', 'cheerful'),
  v('hearts', 'hearts', 'sweet', 'loved', 'valentine'),
  v('arrows', 'arrows', 'directional', 'graphic', 'busy'),
  v('ticks', 'ticks', 'done', 'checklist', 'satisfying'),
  v('grid', 'graph print', 'maths', 'precise', 'cool'),
  /* prints — pigment */
  v('ombre', 'ombré', 'faded', 'graduated', 'soft'),
  v('marble', 'marbled', 'endpapers', 'bookbinding', 'rich'),
  v('lace', 'paper lace', 'delicate', 'doily', 'vintage'),
  v('gilt', 'gilt foil', 'gold', 'special', 'bright'),
];

/**
 * LIFT — how the block sits on the page (`shadow` in the script language).
 *
 * The flat rule shapes this whole axis: depth is a darker flat face beside a
 * lighter one, so every entry here is an offset PLATE, a ring, an inset face
 * or a cut edge, and not one of them carries a blur radius. That constraint is
 * why fifty are distinguishable — a blurred drop shadow only varies by how
 * much blur, while a plate varies by direction, count, colour, and whether the
 * block rises out of the page or is sunk into it.
 */
const SHADOW: readonly EffectValue[] = [
  v('soft', 'a soft plate', 'gentle', 'raised', 'quiet'),
  v('lifted', 'lifted', 'off the page', 'card', 'crisp'),
  v('stacked', 'stacked', 'layered', 'a pile', 'depth'),
  v('plate', 'flat plate', 'graphic', 'poster', 'bold'),
  v('deep', 'deep offset', 'dramatic', 'far', 'bold'),
  v('riser', 'on a riser', 'display', 'plinth', 'formal'),
  v('sunken', 'set into the page', 'recessed', 'well', 'inset'),
  v('ledge', 'on a ledge', 'shelf', 'under-shadow', 'grounded'),
  v('card', 'a card back', 'mounted', 'stationery', 'neat'),
  v('float', 'floating', 'weightless', 'high', 'airy'),
  v('hover', 'hovering', 'just above', 'light', 'delicate'),
  v('drop', 'dropped right', 'classic', 'offset', 'plain'),
  v('longcast', 'a long cast', 'late afternoon', 'dramatic', 'stretched'),
  v('hard', 'a hard edge', 'graphic', 'sharp', 'bold'),
  v('halo', 'a pale halo', 'ringed', 'gentle', 'soft'),
  v('ring', 'a drawn ring', 'outlined', 'crisp', 'graphic'),
  v('mat', 'on a mount board', 'gallery', 'framed', 'formal'),
  v('mount', 'dry-mounted', 'archival', 'flush', 'neat'),
  v('tray', 'in a tray', 'contained', 'desk', 'tidy'),
  v('pouched', 'in a paper pocket', 'filed', 'tucked', 'library'),
  v('letterbox', 'through a slot', 'posted', 'narrow', 'cut'),
  v('emboss', 'embossed', 'raised', 'stationery', 'quiet'),
  v('deboss', 'debossed', 'pressed in', 'stationery', 'quiet'),
  v('press', 'letterpress bite', 'printed', 'craft', 'tactile'),
  v('cutout', 'cut out', 'collage', 'scissors', 'craft'),
  v('shingle', 'shingled', 'overlapping', 'roof', 'repeating'),
  v('fan', 'fanned out', 'a hand of cards', 'playful', 'layered'),
  v('step', 'stepped', 'staircase', 'graphic', 'ordered'),
  v('terrace', 'terraced', 'landscape', 'wide steps', 'calm'),
  v('cliff', 'a cliff edge', 'tall', 'dramatic', 'bold'),
  v('well', 'in a well', 'sunk', 'deep', 'inset'),
  v('groove', 'in a groove', 'channel', 'shallow', 'inset'),
  v('relief', 'in relief', 'carved', 'stone', 'classical'),
  v('cameo', 'a cameo', 'oval', 'raised', 'antique'),
  v('inlay', 'inlaid', 'marquetry', 'flush', 'rich'),
  v('plinth', 'on a plinth', 'museum', 'formal', 'important'),
  v('pedestal', 'on a pedestal', 'display', 'tall', 'formal'),
  v('slab', 'a stone slab', 'weighty', 'thick', 'solid'),
  v('tile', 'a glazed tile', 'ceramic', 'crisp', 'clean'),
  v('coaster', 'a beermat', 'thick board', 'casual', 'chunky'),
  v('pad', 'a felt pad', 'quiet', 'soft edge', 'gentle'),
  v('board', 'on grey board', 'backing', 'archival', 'plain'),
  v('cork', 'on cork', 'noticeboard', 'warm', 'homely'),
  v('felt', 'on felt', 'baize', 'quiet', 'soft'),
  v('passepartout', 'passe-partout', 'gallery', 'bevelled', 'formal'),
  v('gallery', 'a gallery hang', 'exhibition', 'clean', 'formal'),
  v('vitrine', 'under glass', 'museum', 'precious', 'contained'),
  v('drawer', 'pulled from a drawer', 'filed', 'archive', 'tucked'),
  v('shelfline', 'sat on a shelf line', 'library', 'grounded', 'quiet'),
  v('buttress', 'braced', 'architectural', 'sturdy', 'heavy'),
];

/**
 * FRAME — a border round the block.
 *
 * Fifty borders is the easiest fifty in the app to get wrong, because every
 * one of them is "a rectangle with something on the edge". They are kept apart
 * by pulling on four different traditions: sewing and haberdashery (stitch,
 * pinked, lacing, bobble), architecture and classical ornament (meander,
 * dentil, egg-and-dart, laurel), print and ticketing (sprocket, coupon,
 * postmark, die-cut) and paper itself (deckle, jagged, scorched).
 */
const FRAME: readonly EffectValue[] = [
  v('scallop', 'scallop frame', 'sweet', 'doily', 'craft'),
  v('stitch', 'stitched frame', 'sewn', 'homely', 'craft'),
  v('double', 'double rule', 'formal', 'certificate', 'classic'),
  v('rope', 'rope border', 'beaded', 'nautical', 'chunky'),
  v('ticket', 'torn ticket', 'admit one', 'event', 'playful'),
  v('pinked', 'pinking shears', 'zigzag', 'fabric', 'craft'),
  v('chain', 'chain link', 'ornate', 'gilt', 'rich'),
  v('wave', 'wavy rule', 'soft', 'flowing', 'gentle'),
  v('notch', 'notched corners', 'technical', 'cut', 'modern'),
  v('ruled', 'a ruled box', 'plain', 'ledger', 'quiet'),
  v('tabs', 'corner tabs', 'photo corners', 'album', 'archival'),
  v('deckle', 'deckle edge', 'handmade', 'torn', 'artisan'),
  v('bead', 'beaded moulding', 'joinery', 'fine', 'classical'),
  v('braid', 'braided cord', 'passementerie', 'rich', 'woven'),
  v('meander', 'greek key', 'classical', 'ancient', 'formal'),
  v('laurel', 'laurel wreath', 'award', 'classical', 'honour'),
  v('ivyframe', 'ivy border', 'garden', 'green', 'trailing'),
  v('dogtooth', 'dogtooth', 'houndstooth', 'tweed', 'smart'),
  v('dentil', 'dentil course', 'cornice', 'architectural', 'formal'),
  v('eggdart', 'egg and dart', 'classical', 'carved', 'rich'),
  v('fret', 'fretwork', 'joinery', 'geometric', 'ornate'),
  v('guilloche', 'guilloché', 'banknote', 'engraved', 'precise'),
  v('filigree', 'filigree', 'delicate', 'silverwork', 'ornate'),
  v('rosette', 'corner rosettes', 'ornament', 'carved', 'formal'),
  v('fleur', 'fleur-de-lys corners', 'heraldic', 'formal', 'rich'),
  v('scorch', 'scorched edge', 'burnt', 'treasure map', 'aged'),
  v('perfed', 'perforated', 'tear here', 'stamp', 'postal'),
  v('punch', 'punch card', 'holes', 'machine', 'archive'),
  v('coupon', 'a coupon', 'cut out', 'offer', 'playful'),
  v('sprocket', 'film sprockets', 'cinema', 'strip', 'graphic'),
  v('postmark', 'postmarked', 'franked', 'postal', 'travelled'),
  v('diecut', 'die-cut sticker', 'white keyline', 'modern', 'crisp'),
  v('badge', 'a badge', 'enamel', 'rounded', 'bold'),
  v('shield', 'a shield', 'heraldic', 'crest', 'formal'),
  v('cartouche', 'a cartouche', 'engraved panel', 'ancient', 'formal'),
  v('oval', 'an oval', 'portrait', 'antique', 'soft'),
  v('arch', 'an arch', 'window', 'architectural', 'calm'),
  v('gable', 'a gable', 'house', 'pointed', 'homely'),
  v('bracket', 'bracketed corners', 'technical', 'crop marks', 'modern'),
  v('cumulus', 'cloud border', 'dreamy', 'soft', 'children'),
  v('pompom', 'bobble trim', 'pompoms', 'playful', 'craft'),
  v('jagged', 'jagged edge', 'torn hard', 'urgent', 'rough'),
  v('sawedge', 'saw tooth', 'sharp', 'graphic', 'bold'),
  v('dashes', 'dashed rule', 'cut here', 'provisional', 'light'),
  v('pips', 'pipped border', 'dotted beads', 'delicate', 'quiet'),
  v('hatched', 'hatched border', 'pencil', 'drawn', 'sketchy'),
  v('rivets', 'riveted plate', 'workshop', 'metal', 'heavy'),
  v('eyelets', 'eyeleted', 'canvas', 'laced', 'workshop'),
  v('lacing', 'laced up', 'shoelace', 'craft', 'homely'),
  v('seamed', 'a seamed edge', 'sewn', 'garment', 'quiet'),
];

/**
 * PAPER — what this block is written on.
 *
 * Split three ways, which is how a paper merchant's catalogue is split:
 * STOCKS (what the sheet is made of — laid, wove, cotton, papyrus), RULINGS
 * (what is printed on it — cornell, isometric, millimetre, tablature) and
 * FORMS (what it was cut into — a receipt, an airmail sheet, a punch card).
 */
const PAPER: readonly EffectValue[] = [
  /* stocks */
  v('torn', 'torn paper', 'rough', 'scrap', 'collage'),
  v('aged', 'aged stock', 'old', 'warm', 'archive'),
  v('kraft', 'kraft board', 'brown paper', 'parcel', 'rustic'),
  v('vellum', 'vellum', 'translucent', 'delicate', 'overlay'),
  v('parchment', 'parchment', 'ancient', 'scroll', 'warm'),
  v('papyrus', 'papyrus', 'woven reed', 'ancient', 'rough'),
  v('newsprint', 'newsprint', 'grey', 'cheap', 'daily'),
  v('tracing', 'tracing paper', 'see-through', 'drafting', 'cool'),
  v('onion', 'onionskin', 'airmail thin', 'crisp', 'delicate'),
  v('cartridge', 'cartridge paper', 'drawing', 'toothy', 'sturdy'),
  v('coldpress', 'cold-pressed', 'watercolour', 'textured', 'artisan'),
  v('hotpress', 'hot-pressed', 'smooth', 'watercolour', 'clean'),
  v('handmade', 'handmade sheet', 'deckled', 'artisan', 'irregular'),
  v('marbled', 'marbled paper', 'endpapers', 'bookbinding', 'rich'),
  v('mulberry', 'mulberry paper', 'fibrous', 'eastern', 'delicate'),
  v('linenstock', 'linen stock', 'woven', 'formal', 'stationery'),
  v('laid', 'laid paper', 'chain lines', 'traditional', 'fine'),
  v('cotton', 'cotton rag', 'soft', 'luxury', 'thick'),
  v('foilpaper', 'foiled paper', 'gilt', 'special', 'bright'),
  v('carbon', 'carbon copy', 'purple', 'duplicate', 'office'),
  v('thermal', 'thermal roll', 'shiny', 'till', 'modern'),
  /* rulings */
  v('lined', 'lined paper', 'exercise book', 'school', 'plain'),
  v('graph', 'graph paper', 'maths', 'engineering', 'precise'),
  v('index', 'index stock', 'filed', 'recipe', 'library'),
  v('dotgrid', 'dot grid', 'bullet journal', 'modern', 'light'),
  v('stave', 'music stave', 'five lines', 'song', 'practice'),
  v('ledger', 'ledger paper', 'accounts', 'columns', 'formal'),
  v('blueprint', 'blueprint', 'drafting', 'technical', 'cool'),
  v('cornell', 'cornell notes', 'study', 'divided', 'method'),
  v('isometric', 'isometric grid', 'three-quarter', 'drafting', 'precise'),
  v('hexes', 'hex grid', 'games', 'maps', 'playful'),
  v('millimetre', 'millimetre paper', 'orange grid', 'laboratory', 'exact'),
  v('logarithmic', 'log paper', 'science', 'curved grid', 'exact'),
  v('polar', 'polar grid', 'radial', 'navigation', 'precise'),
  v('engineer', 'engineering pad', 'green tint', 'faint grid', 'technical'),
  v('accounts', 'analysis paper', 'ruled columns', 'ledger', 'formal'),
  v('legal', 'legal pad', 'yellow', 'wide rule', 'american'),
  v('copybook', 'copybook rules', 'handwriting', 'school', 'guides'),
  v('tablature', 'guitar tab', 'six lines', 'music', 'practice'),
  v('crossword', 'crossword grid', 'puzzle', 'black and white', 'playful'),
  v('calendar', 'a month grid', 'planner', 'dates', 'ordered'),
  /* forms */
  v('notepad', 'a torn-off pad', 'perforated', 'memo', 'quick'),
  v('receipt', 'a till receipt', 'narrow', 'shop', 'everyday'),
  v('airmail', 'airmail paper', 'red and blue border', 'travel', 'letter'),
  v('telegram', 'a telegram', 'urgent', 'typed', 'historic'),
  v('punchcard', 'a punch card', 'computing', 'archive', 'machine'),
  v('manuscript', 'manuscript paper', 'margins ruled', 'literary', 'formal'),
  v('foxed', 'foxed paper', 'spotted', 'antiquarian', 'old'),
  v('stained', 'a tea ring', 'used', 'homely', 'warm'),
  v('scorched', 'scorched', 'burnt edges', 'treasure map', 'dramatic'),
];

/**
 * UNDERLINE — a mark under (or through, or around) the words.
 *
 * The tail of this list is the interesting half: an underline is not only a
 * rule, it is whatever a reader draws when they want a word back. So brackets,
 * a caret, a strike-through and a loop all live here, because they are all
 * "the mark I made on this line".
 */
const UNDERLINE: readonly EffectValue[] = [
  v('squiggle', 'squiggle', 'hand-drawn', 'emphatic', 'classic'),
  v('marker', 'marker sweep', 'highlighted', 'bold', 'study'),
  v('dotted', 'dotted rule', 'light', 'quiet', 'note'),
  v('double', 'double rule', 'formal', 'total', 'final'),
  v('circled', 'ringed round', 'come back to this', 'loop', 'urgent'),
  v('dashed', 'dashed rule', 'provisional', 'cut here', 'light'),
  v('scribble', 'scribbled through', 'crossed out', 'rough', 'edit'),
  v('ruled', 'a single rule', 'plain', 'clean', 'quiet'),
  v('boxed', 'boxed word', 'labelled', 'contained', 'crisp'),
  v('brush', 'brush stroke', 'painted', 'thick', 'confident'),
  v('arrow', 'underlined arrow', 'points on', 'leads', 'directional'),
  v('zigzag', 'zigzag rule', 'lively', 'sharp', 'busy'),
  v('dotdash', 'dot-dash rule', 'technical', 'drawing', 'precise'),
  v('triple', 'triple rule', 'shouting', 'final', 'emphatic'),
  v('thick', 'a thick rule', 'heavy', 'bold', 'solid'),
  v('hairline', 'a hairline', 'barely there', 'fine', 'quiet'),
  v('tapered', 'a tapered stroke', 'calligraphic', 'brushed', 'elegant'),
  v('chalked', 'chalked under', 'blackboard', 'dusty', 'school'),
  v('pencilled', 'pencilled', 'soft', 'grey', 'draft'),
  v('crayoned', 'crayoned', 'waxy', 'children', 'bold'),
  v('gel', 'gel pen', 'glossy', 'bright', 'modern'),
  v('fineliner', 'fineliner', 'technical', 'even', 'crisp'),
  v('sweep', 'a full sweep', 'highlighter', 'study', 'bold'),
  v('halfsweep', 'a half sweep', 'partial', 'casual', 'quick'),
  v('fade', 'a fading sweep', 'graduated', 'soft', 'gentle'),
  v('bracketed', 'bracketed', 'aside', 'contained', 'editorial'),
  v('parens', 'in parentheses', 'aside', 'quiet', 'editorial'),
  v('pill', 'a pill', 'chip', 'rounded', 'modern'),
  v('struck', 'struck through', 'deleted', 'done', 'edit'),
  v('redline', 'red-lined', 'correction', 'urgent', 'marked'),
  v('caret', 'a caret below', 'insert here', 'editorial', 'small'),
  v('tickmark', 'a tick after', 'done', 'satisfying', 'checked'),
  v('chevrons', 'chevrons under', 'directional', 'graphic', 'lively'),
  v('wavy', 'a wave', 'soft', 'flowing', 'gentle'),
  v('loops', 'looped', 'cursive', 'playful', 'flowing'),
  v('coil', 'a coil', 'spring', 'busy', 'playful'),
  v('rungs', 'rungs', 'ladder', 'repeating', 'graphic'),
  v('rail', 'a rail', 'track', 'industrial', 'firm'),
  v('comb', 'a comb rule', 'teeth', 'repeating', 'graphic'),
  v('sawtooth', 'saw tooth', 'sharp', 'bold', 'jagged'),
  v('beaded', 'beaded rule', 'delicate', 'pearls', 'pretty'),
  v('starred', 'starred', 'favourite', 'noted', 'cheerful'),
  v('macron', 'a bar above', 'notation', 'exact', 'technical'),
  v('ogee', 'an ogee', 'architectural', 'curved', 'elegant'),
  v('swash', 'a swash', 'calligraphic', 'flourish', 'pretty'),
  v('flourish', 'a flourish', 'signature', 'ornate', 'confident'),
  v('tail', 'a tail', 'trailing off', 'quiet', 'soft'),
  v('hook', 'a hook', 'catches', 'playful', 'small'),
  v('curl', 'a curl', 'soft', 'pretty', 'small'),
  v('kick', 'a kick up', 'lively', 'quick', 'casual'),
];

/* ========================================================================== *
 *                               2. lettering                                 *
 * ========================================================================== */

/**
 * A `font` names a HAND, not a family: "casual" is a choice a writer can make,
 * "Kalam 400" is one only a typographer can. Fifty hands out of the nine faces
 * the app bundles — the other forty-one are the same faces SET differently
 * (tracking, case, weight, slant, optical size, line feed), which is exactly
 * how a stationer distinguishes one hand from another. Nothing here names a
 * face nobody shipped: a name with no font behind it silently renders as the
 * body face, which is worse than not offering it at all.
 *
 * Two floors are baked into every rule in the stylesheet rather than trusted
 * to the caller: no handwriting face below 13px, and Caveat never below 20px.
 */
const FONT: readonly EffectValue[] = [
  /* the faces, plainly set */
  v('hand', 'everyday hand', 'default', 'plain', 'legible'),
  v('casual', 'casual', 'relaxed', 'friendly', 'quick'),
  v('marker', 'marker pen', 'bold', 'poster', 'loud'),
  v('script', 'flowing script', 'pretty', 'title', 'formal'),
  v('chalk', 'chalk', 'blackboard', 'airy', 'school'),
  v('note', 'field note', 'technical', 'small', 'label'),
  v('serif', 'serif', 'printed', 'reading', 'classic'),
  v('book', 'book type', 'literary', 'typeset', 'calm'),
  v('mono', 'typewriter', 'code', 'exact', 'machine'),
  /* the same faces, set as a stationer would */
  v('display', 'display hand', 'huge', 'chapter', 'title'),
  v('smallcaps', 'small caps', 'formal', 'heading', 'engraved'),
  v('wide', 'widely spaced', 'airy', 'poster', 'calm'),
  v('tight', 'tightly set', 'dense', 'economical', 'compact'),
  v('shout', 'shouting', 'uppercase', 'urgent', 'loud'),
  v('quiet', 'quiet aside', 'small', 'footnote', 'shy'),
  v('typed', 'typed out', 'ribbon', 'memo', 'machine'),
  v('ledger', 'ledger hand', 'accounts', 'tabular', 'formal'),
  v('italic', 'italic', 'leaning', 'quoted', 'literary'),
  v('heavy', 'a heavy hand', 'pressed hard', 'bold', 'emphatic'),
  v('light', 'a light hand', 'pencil', 'faint', 'gentle'),
  v('label', 'stencil label', 'filing', 'archive', 'crisp'),
  v('copperplate', 'copperplate', 'engraved', 'wedding', 'formal'),
  v('engrave', 'engraved caps', 'certificate', 'formal', 'classical'),
  v('titling', 'a title hand', 'chapter', 'grand', 'heading'),
  v('byline', 'a byline', 'credit', 'small', 'quiet'),
  v('stencil', 'stencilled', 'crate', 'industrial', 'bold'),
  v('telegram', 'telegram', 'urgent', 'clipped', 'historic'),
  v('receipt', 'till roll', 'narrow', 'machine', 'everyday'),
  v('blackboard', 'blackboard caps', 'lesson', 'school', 'wide'),
  v('lecture', 'lecture hand', 'chalk', 'large', 'clear'),
  v('signature', 'a signature', 'signed off', 'flowing', 'personal'),
  v('flyleaf', 'flyleaf italic', 'dedication', 'literary', 'soft'),
  v('colophon', 'colophon', 'printer', 'small caps', 'bookish'),
  v('footnote', 'footnote', 'reference', 'small', 'quiet'),
  v('epigraph', 'epigraph', 'quoted', 'literary', 'italic'),
  v('pullquote', 'pull quote', 'magazine', 'large', 'emphatic'),
  v('headline', 'headline', 'news', 'shouty', 'bold'),
  v('poster', 'poster hand', 'huge', 'loud', 'flyer'),
  v('graffiti', 'graffiti', 'street', 'leaning', 'loud'),
  v('sharpie', 'sharpie', 'thick', 'permanent', 'bold'),
  v('crayon', 'crayon', 'children', 'waxy', 'playful'),
  v('pencilled', 'pencilled', 'draft', 'soft', 'faint'),
  v('biro', 'biro', 'everyday', 'blue', 'quick'),
  v('fountain', 'fountain pen', 'letter', 'formal', 'flowing'),
  v('copybook', 'copybook', 'practice', 'even', 'school'),
  v('primer', 'a primer hand', 'first reader', 'large', 'clear'),
  v('scrawl', 'a scrawl', 'hurried', 'leaning', 'rough'),
  v('neat', 'a neat hand', 'careful', 'tidy', 'legible'),
  v('draft', 'draft hand', 'provisional', 'light', 'italic'),
  v('archive', 'archive label', 'filed', 'uppercase', 'crisp'),
];

/**
 * INK — what the block is written with.
 *
 * Fifty pigments, every one mixed in OKLab from the tokens in tokens.css
 * rather than typed as a hex here, so a theme change carries them all. They
 * are ordered as an ink cabinet is: the everyday inks, then warm, then red,
 * then green, then blue, then purple, then the earths.
 */
const INK: readonly EffectValue[] = [
  v('sepia', 'sepia', 'default', 'warm', 'classic'),
  v('graphite', 'graphite', 'pencil', 'cool', 'plain'),
  v('ink-blue', 'fountain blue', 'formal', 'letter', 'classic'),
  v('charcoal', 'charcoal', 'soft black', 'drawing', 'dark'),
  v('irongall', 'iron gall', 'antique', 'brown-black', 'historic'),
  v('slate', 'slate', 'grey', 'sober', 'quiet'),
  /* warm */
  v('amber', 'amber', 'honeyed', 'warm', 'bright'),
  v('gold', 'gilt', 'special', 'ornament', 'warm'),
  v('ochre', 'ochre', 'earth', 'yellow', 'ancient'),
  v('mustard', 'mustard', 'sharp', 'yellow', 'retro'),
  v('sand', 'sand', 'pale', 'desert', 'quiet'),
  v('bronze', 'bronze', 'metal', 'antique', 'warm'),
  v('copper', 'copper', 'metal', 'bright', 'warm'),
  /* red */
  v('crimson', 'crimson', 'marked', 'correction', 'urgent'),
  v('terracotta', 'terracotta', 'clay', 'warm', 'earthy'),
  v('coral', 'coral', 'bright', 'sea', 'cheerful'),
  v('brick', 'brick', 'deep red', 'sturdy', 'earthy'),
  v('rust', 'rust', 'autumn', 'earthy', 'warm'),
  v('wine', 'wine', 'deep', 'evening', 'rich'),
  v('burgundy', 'burgundy', 'library', 'formal', 'rich'),
  v('madder', 'rose madder', 'soft red', 'pretty', 'gentle'),
  v('oxblood', 'oxblood', 'leather', 'deep red', 'library'),
  v('blossom', 'blossom', 'soft', 'pink', 'gentle'),
  v('peach', 'peach', 'pale', 'warm', 'sweet'),
  /* green */
  v('moss', 'moss', 'nature', 'calm', 'green'),
  v('olive', 'olive', 'muted', 'field', 'green'),
  v('forest', 'forest', 'deep green', 'woodland', 'calm'),
  v('pine', 'pine', 'dark green', 'winter', 'cool'),
  v('sage', 'sage', 'pale green', 'herb', 'quiet'),
  v('lime', 'lime', 'sharp green', 'bright', 'lively'),
  v('fern', 'fern', 'fresh', 'woodland', 'green'),
  /* blue-green */
  v('teal', 'teal', 'cool', 'fresh', 'sea'),
  v('turquoise', 'turquoise', 'bright', 'sea', 'cool'),
  v('jade', 'jade', 'stone', 'eastern', 'cool'),
  v('mint', 'mint', 'pale', 'fresh', 'light'),
  v('seafoam', 'seafoam', 'pale sea', 'airy', 'cool'),
  /* blue */
  v('skyink', 'sky', 'daylight', 'calm', 'cool'),
  v('denim', 'denim', 'workwear', 'faded', 'cool'),
  v('cobalt', 'cobalt', 'vivid', 'bright', 'cool'),
  v('navy', 'navy', 'deep', 'formal', 'cool'),
  v('indigo', 'indigo', 'deep', 'night', 'cool'),
  /* purple */
  v('violet', 'violet', 'soft', 'dreamy', 'cool'),
  v('plum', 'plum', 'rich', 'evening', 'quiet'),
  v('mulberry', 'mulberry', 'stained', 'fruit', 'rich'),
  v('orchid', 'orchid', 'bright', 'exotic', 'pretty'),
  v('lilac', 'lilac', 'pale purple', 'spring', 'gentle'),
  v('lavender', 'lavender', 'calm', 'herb', 'soft'),
  /* earth */
  v('umber', 'burnt umber', 'painter', 'dark earth', 'warm'),
  v('walnut', 'walnut', 'furniture', 'brown', 'warm'),
  v('clay', 'clay', 'pale earth', 'quiet', 'warm'),
];

/**
 * SIZE — how big the lettering is.
 *
 * Twelve, and deliberately not fifty. This is a SCALE, not a design: a reader
 * choosing between a fiftieth and a fifty-first step is choosing between two
 * numbers, and the picker would say so. Twelve steps from a caption to a
 * one-word cover is as many as the eye can tell apart on a page this size.
 */
const SIZE: readonly EffectValue[] = [
  v('caption', 'caption', 'tiny', 'under a picture', 'quiet'),
  v('xs', 'very small', 'aside', 'footnote', 'quiet'),
  v('sm', 'small', 'note', 'compact', 'quiet'),
  v('compact', 'a shade small', 'dense', 'more on the page', 'tidy'),
  v('md', 'normal', 'body', 'default', 'plain'),
  v('roomy', 'a shade large', 'generous', 'easy', 'calm'),
  v('lg', 'large', 'emphatic', 'lead', 'clear'),
  v('xl', 'huge', 'headline', 'loud', 'title'),
  v('jumbo', 'jumbo', 'poster', 'shout', 'title'),
  v('giant', 'giant', 'cover', 'one word', 'title'),
  v('colossal', 'colossal', 'billboard', 'enormous', 'title'),
  v('marquee', 'marquee', 'the whole page', 'spectacle', 'title'),
];

/**
 * RANGING — which way the lines are ranged.
 *
 * Ten, and also deliberately not fifty: text ranges left, right, centred or
 * justified, and everything beyond that is what happens to the FIRST or LAST
 * line. Ten covers the typographic set completely; an eleventh would have to
 * be invented.
 */
const ALIGN: readonly EffectValue[] = [
  v('left', 'ranged left', 'default', 'plain', 'ragged right'),
  v('center', 'centred', 'title', 'formal', 'symmetrical'),
  v('right', 'ranged right', 'signed off', 'date', 'aside'),
  v('justify', 'justified', 'typeset', 'block', 'formal'),
  v('indent', 'first line in', 'literary', 'paragraph', 'book'),
  v('hanging', 'hanging indent', 'bibliography', 'list', 'reference'),
  v('outdent', 'first line out', 'dictionary', 'entry', 'reference'),
  v('balance', 'balanced lines', 'even', 'headline', 'tidy'),
  v('tidy', 'no widows', 'careful', 'typeset', 'quiet'),
  v('narrow', 'a narrow measure', 'column', 'poetry', 'calm'),
];

/* ========================================================================== *
 *                                 3. colour                                  *
 * ========================================================================== */

/**
 * TINT — the watercolour a block is washed in.
 *
 * The script language calls this `color` and documents it as universal, but
 * until now only the container nodes implemented it, so `# Heading {color=sky}`
 * quietly did nothing. `BlockEffects` now carries it on every block, and this
 * is the domain.
 *
 * Fifty pigments, all mixed from the eleven wash families in tokens.css. Each
 * entry retargets `--fx-light / --fx-base / --fx-deep`, which is the same
 * three-slot contract the sticky note, the callout, the banner, the quote card
 * and the envelope already read — so one new pigment here is a new look on
 * every piece of stationery at once, not on one.
 */
const TINT: readonly EffectValue[] = [
  /* the seven the writing language knows */
  v('amber', 'amber', 'honey', 'warm', 'default'),
  v('terracotta', 'terracotta', 'clay', 'warm', 'earthy'),
  v('moss', 'moss', 'green', 'calm', 'nature'),
  v('lemon', 'lemon', 'bright', 'yellow', 'cheerful'),
  v('sky', 'sky', 'blue', 'calm', 'cool'),
  v('blush', 'blush', 'pink', 'soft', 'gentle'),
  v('graphite', 'graphite', 'grey', 'sober', 'quiet'),
  /* warm */
  v('honey', 'honey', 'golden', 'sweet', 'warm'),
  v('apricot', 'apricot', 'soft orange', 'summer', 'warm'),
  v('peach', 'peach', 'pale', 'sweet', 'gentle'),
  v('straw', 'straw', 'pale gold', 'harvest', 'quiet'),
  v('mustard', 'mustard', 'sharp yellow', 'retro', 'bold'),
  v('ochre', 'ochre', 'earth yellow', 'ancient', 'warm'),
  v('sand', 'sand', 'pale', 'desert', 'neutral'),
  /* red */
  v('coral', 'coral', 'bright', 'sea', 'cheerful'),
  v('cherry', 'cherry', 'bright red', 'sweet', 'bold'),
  v('brick', 'brick', 'deep red', 'sturdy', 'earthy'),
  v('rust', 'rust', 'autumn', 'earthy', 'warm'),
  v('wine', 'wine', 'deep', 'evening', 'rich'),
  v('petal', 'petal', 'soft red', 'pretty', 'gentle'),
  v('mulberry', 'mulberry', 'fruit', 'stained', 'rich'),
  /* purple */
  v('plum', 'plum', 'evening', 'rich', 'quiet'),
  v('violet', 'violet', 'dreamy', 'soft', 'cool'),
  v('orchid', 'orchid', 'exotic', 'bright', 'pretty'),
  v('lilac', 'lilac', 'spring', 'pale', 'gentle'),
  v('lavender', 'lavender', 'herb', 'calm', 'soft'),
  v('periwinkle', 'periwinkle', 'pale blue-violet', 'dreamy', 'cool'),
  /* blue */
  v('cornflower', 'cornflower', 'field', 'bright blue', 'cheerful'),
  v('denim', 'denim', 'workwear', 'faded', 'cool'),
  v('navy', 'navy', 'deep', 'formal', 'cool'),
  v('indigo', 'indigo', 'night', 'deep', 'cool'),
  v('teal', 'teal', 'sea', 'cool', 'fresh'),
  v('turquoise', 'turquoise', 'bright', 'sea', 'cool'),
  v('seafoam', 'seafoam', 'pale sea', 'airy', 'cool'),
  /* green */
  v('mint', 'mint', 'fresh', 'pale', 'light'),
  v('jade', 'jade', 'stone', 'eastern', 'cool'),
  v('fernwash', 'fern', 'woodland', 'fresh', 'green'),
  v('olive', 'olive', 'muted', 'field', 'green'),
  v('sage', 'sage', 'herb', 'pale green', 'quiet'),
  v('lime', 'lime', 'sharp', 'bright', 'lively'),
  v('forest', 'forest', 'deep green', 'woodland', 'calm'),
  /* earth and stone */
  v('clay', 'clay', 'pale earth', 'warm', 'quiet'),
  v('copper', 'copper', 'metal', 'bright', 'warm'),
  v('bronze', 'bronze', 'metal', 'antique', 'warm'),
  v('cocoa', 'cocoa', 'brown', 'warm', 'rich'),
  v('walnut', 'walnut', 'furniture', 'brown', 'warm'),
  v('ash', 'ash', 'pale grey', 'neutral', 'quiet'),
  v('stone', 'stone', 'grey', 'sober', 'calm'),
  v('pebble', 'pebble', 'warm grey', 'neutral', 'quiet'),
  v('slate', 'slate', 'dark grey', 'cool', 'sober'),
];

/* ========================================================================== *
 *                              the eleven axes                               *
 * ========================================================================== */

export const EFFECT_AXES: readonly EffectAxis[] = [
  { key: 'tape', label: 'tape', shelf: 'trim', blurb: 'what is holding it to the page', values: TAPE },
  { key: 'washi', label: 'washi', shelf: 'trim', blurb: 'patterned paper tape', values: WASHI },
  { key: 'shadow', label: 'lift', shelf: 'trim', blurb: 'how it sits on the page', values: SHADOW },
  { key: 'frame', label: 'frames', shelf: 'trim', blurb: 'a border round the block', values: FRAME },
  { key: 'paper', label: 'paper', shelf: 'trim', blurb: 'what this block is written on', values: PAPER },
  { key: 'underline', label: 'underlines', shelf: 'trim', blurb: 'a mark under the words', values: UNDERLINE },
  { key: 'font', label: 'hand', shelf: 'lettering', blurb: 'which hand it is written in', values: FONT },
  { key: 'ink', label: 'ink', shelf: 'lettering', blurb: 'what it is written with', values: INK },
  { key: 'size', label: 'size', shelf: 'lettering', blurb: 'how big the lettering is', values: SIZE },
  { key: 'align', label: 'ranging', shelf: 'lettering', blurb: 'which way the lines are ranged', values: ALIGN },
  { key: 'color', label: 'tint', shelf: 'colour', blurb: 'the watercolour it is washed in', values: TINT },
];

// Notebook Script is an alternate door into this same editor. Teach its live
// parser the complete stationer's catalogue before any pasted note is parsed,
// so an AI may use the values the reader sees in the Catalogue without being
// warned that a real Alcove option is unknown. The spec generator loads this
// module too, making the printed guide and the runtime domain the same list.
for (const axis of EFFECT_AXES) {
  registerScriptAttrValues(
    axis.key,
    axis.values.map((entry) => entry.value),
  );
}

const AXIS_BY_KEY = new Map(EFFECT_AXES.map((axis) => [axis.key, axis]));

/** Every accepted value for an axis, in picker order. Empty for unknown keys. */
export function effectValues(key: string): readonly string[] {
  return AXIS_BY_KEY.get(key)?.values.map((entry) => entry.value) ?? [];
}

/** Every key the "start this block again" button clears. */
export const EFFECT_KEYS: readonly string[] = [
  'rotate',
  ...EFFECT_AXES.map((axis) => axis.key),
];

/** Per-key value lists, for the places that want one axis by name. */
export const TAPE_ALL = effectValues('tape');
export const WASHI_ALL = effectValues('washi');
export const SHADOW_ALL = effectValues('shadow');
export const FRAME_ALL = effectValues('frame');
export const PAPER_ALL = effectValues('paper');
export const UNDERLINE_ALL = effectValues('underline');
export const FONT_ALL = effectValues('font');
export const INK_ALL = effectValues('ink');
export const SIZE_ALL = effectValues('size');
export const ALIGN_ALL = effectValues('align');
export const TINT_ALL = effectValues('color');

/* ========================================================================== *
 *                        the guard on the two vocabularies                   *
 * ========================================================================== */

/**
 * The writing language's own list per key — what a script value is matched on.
 *
 * READ OUT OF THE PARSER, not restated. This table used to name all eleven
 * key→list pairs by hand, which made it a second copy of `ATTR_ENUM_DOMAINS`
 * in `script/vocab.ts` — and a second copy inside the very guard whose job is
 * to notice when the two vocabularies come apart. The value lists were always
 * imported (the header says so); the MAPPING was not, and the mapping is the
 * half that moves: re-point `paper` at a different domain in the parser and
 * the clearance check below would have gone on measuring against the old one,
 * passing, and letting a fuzzy rewrite through.
 *
 * Narrowed to the eleven axes on purpose. `ATTR_ENUM_DOMAINS` also carries
 * `sticker`, `variant`, `gap` and `style`, which are not effect axes and have
 * no editor-side vocabulary to keep clear of — `sticker` is a LIVE domain that
 * grows with the reader's own packs, and folding it in would have this guard
 * measure editor names against a set that changes at runtime.
 */
export const SCRIPT_DOMAINS: Readonly<Record<string, readonly string[]>> =
  Object.fromEntries(
    EFFECT_AXES.flatMap((axis) => {
      const domain = ATTR_ENUM_DOMAINS[axis.key];
      return domain === undefined ? [] : [[axis.key, domain] as const];
    }),
  );

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * Smallest edit distance from `value` to a DIFFERENT name in the script's own
 * domain for `key`. `Infinity` when the key has no script domain.
 *
 * The parser corrects an unknown value to a script name at distance ≤ 2, so
 * any editor-only value scoring ≤ 2 here would be silently rewritten on the
 * way in from a `.note` file — a `paper=kraft` block coming back as
 * `paper=graph`, with a warning nobody reads. Every editor-only value must
 * score 3 or more.
 */
export function nearestScriptEdit(key: string, value: string): number {
  const domain = SCRIPT_DOMAINS[key];
  if (domain === undefined) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (const name of domain) {
    if (name === value) continue;
    best = Math.min(best, editDistance(value, name));
  }
  return best;
}

/**
 * Every editor-only value that the script parser would corrupt. Empty is the
 * only acceptable answer; it is exported rather than asserted so a test can
 * print the offenders rather than just fail.
 */
export function fuzzyCollisions(): Array<{ key: string; value: string; distance: number }> {
  const out: Array<{ key: string; value: string; distance: number }> = [];
  for (const axis of EFFECT_AXES) {
    const script = SCRIPT_DOMAINS[axis.key] ?? [];
    for (const entry of axis.values) {
      if (script.includes(entry.value)) continue;
      const distance = nearestScriptEdit(axis.key, entry.value);
      if (distance <= 2) out.push({ key: axis.key, value: entry.value, distance });
    }
  }
  return out;
}

/**
 * Duplicate values inside one axis — the other way a hand-written table of
 * five hundred names goes wrong, and the one the type checker cannot see.
 */
export function duplicateValues(): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const axis of EFFECT_AXES) {
    const seen = new Set<string>();
    for (const entry of axis.values) {
      if (seen.has(entry.value)) out.push({ key: axis.key, value: entry.value });
      seen.add(entry.value);
    }
  }
  return out;
}
