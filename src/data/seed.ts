/**
 * First-run seeding + seed migrations.
 *
 * Seeds ONE "Welcome to Alcove ✎" book whose pages are authored in Notebook
 * Script (parsed + mapped to editor JSON at seed time, with the verbatim
 * source stored per page so "Export Script" shows it).
 *
 * Two migrations have accumulated, and both are written to touch as little as
 * possible, because everything here runs against a library someone may have
 * spent months in:
 *
 *   v1 → v2  installs that ran the old 24-demo-book seed. Any book whose title
 *            is in the old demo list AND whose pages are all empty is deleted;
 *            a demo book the user actually wrote in is never touched.
 *   v2 → v3  Notebook → Bellanote. The welcome book is RETITLED in place rather
 *            than reseeded. See renameLegacyWelcomeBook.
 *   v3 → v4  Bellanote → Alcove, the same way — and the reason the old title is
 *            now a LIST. A library that skipped v3 is still sitting on
 *            "Welcome to Notebook ✎", so the migration has to sweep every past
 *            name, not just the most recent one.
 *   v4 → v5  the welcome book was rewritten (five pages to sixteen). The BOOK
 *            is kept — same row, same id, same spine, same slot on the shelf —
 *            and only its PAGES are replaced, and only when every one of them
 *            is still exactly as it was seeded. See refreshWelcomeBook.
 *
 * The current seed version lives in the `settings` table under 'seedVersion'.
 */

import { parse } from '../script';
import { scriptDocToTiptap } from '../editor/script/toTiptap';
import { createBook, deleteBook } from './books';
import { getDb, type Db } from './db';
import { removePageIndex } from './search';
import { createPage, listPages, savePageDoc, setPageScript } from './pages';
import type { PageDoc } from './types';

/**
 * Bump when the seed contents change in a way that needs a migration.
 *
 * v5: the welcome book was rewritten from five pages to sixteen, to show the
 * things the app grew after the first version was written — maths, footnotes,
 * page references, toggles, columns, the stationery and keepsake drawers, and
 * some pictures. See refreshWelcomeBook for what that does to a library that
 * already has one.
 */
export const SEED_VERSION = 5;

/** `settings` table key holding the last-applied seed version. */
export const SEED_VERSION_KEY = 'seedVersion';

export const WELCOME_BOOK_TITLE = 'Welcome to Alcove ✎';

/**
 * Every title the welcome book has ever had, oldest first.
 *
 * This is not history for its own sake: the title is ALSO the identity check
 * that stops a second welcome book being seeded. A library still holding an old
 * title has to be recognised, or it fails its own existence test and grows a
 * duplicate beside the book its owner has been writing in.
 *
 * A LIST, because it was a single constant for one rename and that shape does
 * not survive the second: Notebook → Bellanote → Alcove means two old titles,
 * and a library that skipped a version holds the older of them. Append here,
 * never replace, and `brand.json` carries the same list so
 * `tests/brand-consistency.test.ts` can check the two agree.
 */
export const LEGACY_WELCOME_BOOK_TITLES: readonly string[] = [
  'Welcome to Notebook ✎',
  'Welcome to Bellanote ✎',
];

/**
 * The most recent old title.
 *
 * Kept because callers and tests read it by name; everything that has to be
 * CORRECT across more than one rename uses the list above.
 */
export const LEGACY_WELCOME_BOOK_TITLE =
  LEGACY_WELCOME_BOOK_TITLES[LEGACY_WELCOME_BOOK_TITLES.length - 1]!;

/**
 * FNV-1a 32-bit hash (inlined on purpose — the data layer must not depend on
 * src/art). Same recipe the spine baker uses, so seeds are deterministic and
 * stable across reinstalls: identical titles always grow identical spines.
 */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Spine seed for the welcome book. Deterministic from the title, so reinstalls
 * grow an identical spine.
 *
 * It used to carry a +3 nudge chosen to land the seed on palette 0 (warm
 * amber). That is gone: the binding below is authored outright, and an
 * explicit per-book style always beats anything derived from the seed, so
 * tuning the hash to hit a colour would have been a decoration that decided
 * nothing. The seed still drives the details the style does not name.
 */
export const WELCOME_SPINE_SEED = fnv1a(WELCOME_BOOK_TITLE) >>> 0;

/**
 * The welcome book's binding, authored rather than rolled.
 *
 * This is the first object a reader ever sees on the shelf, and it was warm
 * amber cloth with whatever the seed happened to give it — which read as the
 * default it was. It is the app's calling card, so it is dressed like one:
 * claret leather, four raised cords with gilt rules either side, wrapped
 * endbands, a gilt title plate and gilt edges, quarto and stout so it has some
 * presence beside a pocket paperback.
 *
 * ## `pigment` is not the colour its name says
 *
 * Choosing one by name is a trap. `PIGMENT_LABELS` and `flat.CLOTH_SPECS` are
 * two independently ordered tables and `spines.clothForPalette` folds one onto
 * the other; twenty-six of the fifty pigments now land on a cloth of the same
 * name and the other twenty-four land on the nearest one there is. This
 * binding was authored as *oxblood* when the fold still sent oxblood, rust and
 * clay all to terracotta, and it shipped terracotta. Neither the compiler nor
 * a test caught it; a screenshot did. So every candidate below was rendered on
 * the real shelf before it was written down (`shots-now/welcome-binding.mjs`,
 * `shots-now/defaults/board-pigment3.png`).
 *
 * ## Why claret
 *
 * Pigment 20 is captioned *Burgundy* and paints cloth **Claret** `#a44c60` —
 * verified, not assumed. Five deep candidates were photographed against the
 * default room, and claret won for reasons the names would not have given:
 *
 *  - the room was Verdigris Library then, a blue-green case, so a red was the
 *    complement and the book separated from the case at any zoom. `forest`
 *    disappeared into the timber, `navy` went quiet against it;
 *  - **oxblood now folds correctly, and that is exactly why it is wrong here**
 *    — `#ae4e40` is one hop from the `oxblood` cloth in Verdigris's own six,
 *    so the calling card would have worn what a random new book wears. This is
 *    the same trap as before, arriving from the opposite direction;
 *  - `plum` (what this shipped previously) survives the fold as itself but is
 *    a muted mauve: beside gilt bands and a gilt plate it reads dusty rather
 *    than bound. Claret is the same family with the value a fine binding has.
 *
 * ## Re-checked when the opening room went to English Walnut, and kept
 *
 * The complement argument above died with verdigris: against a dark warm brown
 * a red is no longer the opposite colour, it is a near neighbour, and the room's
 * own six cloths open with `oxblood` — so on the face of it claret walked into
 * the trap the second bullet describes. Re-photographed rather than reasoned
 * about (`shots-now/welcome-binding.mjs --tag=hero`, and the calling card beside
 * seven newly made books in `shots-now/hero/crop-shelf-books.png`), it holds,
 * for a reason the verdigris pass never had to lean on: what separates this book
 * on a shelf of new ones is not its hue but its DRESSING — four raised cords
 * with gilt rules, wrapped endbands, a gilt plate and gilt edges, at quarto and
 * stout. Against walnut it stops being a red object on a blue case and becomes
 * the obvious thing it always should have been, a wine-coloured leather binding
 * on dark oak, which no new book is dressed to imitate.
 *
 * So: unchanged, and now deliberately unchanged. `forest`, `navy`, `aubergine`
 * and `chestnut` were re-shot in the new room and all four cost more than they
 * bought — each is a cool object in a room with nothing else cool in it, which
 * makes the calling card look like it was dropped in from another library.
 *
 * `thickness` is pinned, which the seed did not do before. It defaults from
 * page count, and five pages gave a sliver whose raised bands and title plate
 * had no room to be anything; 44 world px is the `stout` class, and it is what
 * makes the object read as a bound volume rather than a coloured stripe
 * (`shots-now/defaults/board-thickness.png`). `format` stays quarto — folio
 * measurably changed nothing on screen.
 *
 * Wear is low but not zero. A pristine 0 makes an object look like a render;
 * a little softening at the corners is what makes it look like a book.
 *
 * Stored under `cover_meta.style`, which is the Book Studio's own format
 * (library-themes.md §4) — so a reader can open the studio and change any of
 * it, and the room may never repaint it behind their back.
 */
export const WELCOME_BINDING: Readonly<Record<string, unknown>> = {
  material: 'leather',
  // Captioned "Burgundy"; paints cloth Claret #a44c60. See the note above —
  // the caption and the cloth are two tables, and only a render settles it.
  pigment: 20,
  hueJitter: 0,
  raisedBands: 4,
  bandGilt: true,
  headTail: true,
  headTailStyle: 2, // wrapped cord
  ornament: 9, // Quill
  titlePlate: 'gilt',
  titleFont: 0,
  wear: 0.1,
  edge: 'gilt',
  format: 'quarto',
  thickness: 44, // 'stout' — a five-page book would otherwise be a sliver
};

/**
 * Titles created by the retired v1 seed (24 demo books). Used only by the
 * v1 → v2 cleanup; never re-created.
 */
export const OLD_DEMO_TITLES: readonly string[] = [
  'Cell Biology',
  'Organic Chemistry (send help)',
  'Physics: Waves & Wobbles',
  'Lab Notebook, Semester 3',
  'Astronomy Log',
  'Linear Algebra',
  'Calculus II: The Redemption',
  'Huffman Coding (with kittens)',
  'Rust Borrow Checker Diary',
  'SQL Spellbook',
  'Kanji Practice',
  'French Verbs I Keep Forgetting',
  'Latin Roots & Word Nerdery',
  'Sign Language Notes',
  'Haiku Attempts (be nice)',
  'Watercolor Basics',
  'Figure Drawing Warmups',
  'Music Theory Scraps',
  'Typography Crushes',
  'Bookbinding Experiments',
  'Birdwatching Field Notes',
  'Tea Tasting Journal',
  'Recipes That Actually Worked',
  'Dream Journal (do not read)',
];

// ---------------------------------------------------------------------------
// Welcome book content (authored as Notebook Script)
// ---------------------------------------------------------------------------

/**
 * The kittens.
 *
 * They are asked for by name in the reader's own report, and they are drawn
 * rather than fetched. The app HAS an image search (`fetch_images` in
 * src-tauri/src/media.rs, Openverse) and the language HAS a directive for it
 * (`::fetch{query="a kitten"}`), but nothing in the app calls the one from the
 * other yet — so a `fetch:` line in a seeded page renders as the words
 * "fetch: a kitten" and no picture. A welcome book may not promise a feature
 * by failing at it.
 *
 * These ship in `public/kittens/`, which means they are on disk before the
 * first run and need no network, no cache and no asset row. They are also
 * drawn in the app's own flat language, so the pictures on page six look like
 * they belong to the same world as the bookcase behind them.
 */
const KITTENS = {
  ginger: '/kittens/ginger.svg',
  asleep: '/kittens/asleep.svg',
  box: '/kittens/in-a-box.svg',
} as const;

/**
 * The welcome/guide pages, one Notebook Script source per page.
 *
 * ## What this book is for
 *
 * It is the only page of documentation anybody reads, so it is written as a
 * TOUR rather than a reference: twelve short leaves, each one showing a real
 * thing the app does, in the app's own voice. Everything here is parsed by
 * `parse()` and mapped by `scriptDocToTiptap()` at seed time, and the verbatim
 * source is stored on the page — so "Export script" hands the reader back
 * exactly this, and the book doubles as a worked example of the language.
 *
 * ## Rules this content has to keep, because a test enforces each one
 *
 *  - **Every page parses without a single diagnostic.** The book that teaches
 *    the language may not be written in slop. That is also why it is a real
 *    test of the parser: maths, footnotes, page references, toggles, columns
 *    and every drawer of stationery go through it here at full size.
 *  - **Multi-word attribute values are quoted** (`{title="Buttermilk scones"}`)
 *    — unquoted, the attr parser reads the second word as a bare flag, which
 *    is a warning and a wrong title.
 *  - **Pages stay short.** Leaves are fixed height and overflow FLOWS to the
 *    next page, so a page written past its capacity would rearrange the tour
 *    the first time it was opened. `tests/data-seed.test.ts` costs every page
 *    with the pagination estimator and refuses one that is over budget.
 *  - **`[[Page name]]` references name pages of this book**, and the seeder
 *    resolves them against the pages it has just created (see
 *    `createWelcomeBook`). A reference that matches no page would still
 *    render — as its own words — but the backlinks page would then be
 *    teaching something the reader cannot see happening.
 */
export const WELCOME_PAGE_SOURCES: readonly string[] = [
  // Page 1 — what this is, and how to move around
  `---
paper: cream
wash: amber
---

# Welcome to Alcove ✎ {sticker=star}

This is your **library**. Every book on that shelf opens into pages like this one — ==real paper you can write on=={color=amber}, not a picture of some.

::: callout {variant=tip}
Click anywhere on the ruled lines and start typing. Everything saves itself as you go.
:::

- The **shelf** goes on and on — drag to pan, scroll to zoom
- **Click a book** and it comes forward; click it again to open. \`Esc\` puts it back
- **Arrow keys** turn the pages, or drag a corner and watch it curl
- The **rail on the left** holds everything else

::: banner {color=moss}
The rest of this book is a tour of what the paper can do. {sticker=arrow}
:::
`,

  // Page 2 — the writing surface itself
  `# Writing {sticker=book}

Write the way you would anywhere else. Then press \`/\` on an empty line for the **slash menu** — headings, lists, tables, callouts, diagrams, equations, stickers, the lot.

**Bold**, *italic*, \`code\`, ~~struck out~~, ==highlighted=={color=lemon}, or ==washed in another colour=={color=sky}.

- [ ] Press \`/\` and put a callout on this page
- [ ] Drag a block somewhere else by its **handle**
- [x] Read this far

::: sticky-note {color=lemon, rotate=-2}
Sticky notes are blocks too. Pick me up and move me.
:::

> A page that fills up simply flows onto the next one. Nothing here ever scrolls. {washi=top}
`,

  // Page 3 — maths, both kinds
  `# Maths, in a notebook hand {sticker=sparkle}

A dollar either side puts maths inside a sentence: a circle is $\\pi r^2$, the golden ratio is $\\frac{1+\\sqrt{5}}{2}$, and $\\sigma$ is one standard deviation.

Two dollars on a line of their own make an equation:

$$
e^{i\\pi} + 1 = 0
$$

$$
\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}
$$

::: callout {variant=info}
Click any formula to see the TeX behind it. Enter puts the drawing back.
:::
`,

  // Page 4 — the stationery drawer
  `# The stationery drawer {sticker=pin}

::: card {title="What a card is for"}
Definitions, rules, anything worth fencing off from the prose around it.
:::

::: index-card {title="Buttermilk scones"}
Rub 60g of butter into 250g of flour. Milk to bind. Hot oven, eight minutes.
:::

::: quote-card {color=blush}
"A room without books is like a body without a soul."
:::

::: envelope {color=amber}
Something folded away for later, with the flap still open.
:::

::: tag {color=moss}
a luggage tag, for labelling whatever comes next
:::
`,

  // Page 5 — the keepsake drawer
  `# Things stuck in {sticker=flower}

::: pressed-flower {title="Meadow cranesbill — the lane, June"}
Flat between the pages for a fortnight, and still blue.
:::

::: ticket-stub {title="ADMIT ONE"}
Row H, seat 12. It rained the whole way home.
:::

::: postcard {title="WISH YOU WERE HERE"}
Ran out of room on the front, as usual.
:::

::: map-pin {title="The blue door"}
Second on the left, past the bakery.
:::

::: wax-seal {title=A}
Not to be opened before Sunday.
:::
`,

  // Page 6 — pictures (the kittens the reader asked for)
  `# Pictures {sticker=cat}

Paste one in, drop one on the page, or write it out: \`![a caption](path/to/picture.png)\`.

::: image-row {style=polaroid, cols=3}
![A ginger kitten](${KITTENS.ginger}){caption="Has plans"}
![A grey kitten asleep](${KITTENS.asleep}){caption="On the good chair"}
![A cream kitten in a box](${KITTENS.box}){caption="His box now"}
:::

::: marginalia
Up to four pictures will stand in a row together.
:::
`,

  // Page 7 — one picture, properly
  `# One picture, properly {sticker=sun}

::: polaroid {rotate=-2}
![The ginger kitten again](${KITTENS.ginger})
A polaroid is one picture in a white frame, captioned underneath in pencil.
:::

Drag a corner to resize a picture, or write \`{width=320}\`. Give it \`{align=left}\`, \`{align=center}\` or \`{align=right}\` to slide it across the page. For words beside a picture, put the two in \`:::columns\`.
`,

  // Page 8 — columns, and the two kinds of fold
  `# Two up, and things that fold {sticker=leaf}

::: columns {gap=lg}
::: col
**On the left.** Columns hold two to four of these, side by side.
:::
::: col
**On the right.** Anything goes in one — a list, a picture, another fold.
:::
:::

::: toggle {title="A fold. Click it."}
Toggles put a long aside out of the way until it is wanted.

::: toggle {title="And they nest"}
All the way down, as deep as the thought goes.
:::
:::

::: spoiler
A spoiler is the other kind of fold: one answer, hidden until you look.
:::
`,

  // Page 9 — diagrams: things that nest
  `# Diagrams, drawn by hand {sticker=microscope}

Fenced mini-languages come out as hand-drawn diagrams. Indentation alone makes a \`tree\`:

\`\`\`tree {style=watercolor}
Alcove
  A library
    Bookcases
    Floors
  A book
    Pages | this thing you are reading
\`\`\`
`,

  // Page 10 — diagrams: arrows
  `# Arrows {sticker=arrow}

One edge to a line makes a \`graph\` — or a \`flowchart\`, which is the same grammar under a name that suits a process better:

\`\`\`graph
Write -> Decorate: whenever
Decorate -> Turn: eventually
Turn -> Write: forever
\`\`\`

::: callout {variant=tip}
None of these is Mermaid, and none of them needs to be.
:::
`,

  // Page 11 — diagrams: things in order
  `# In order {sticker=moon}

\`label: text\` on each line makes a \`timeline\`:

\`\`\`timeline
1: Pull a book off the shelf
2: Write, decorate, wander
3: Turn to a fresh page | color=amber
\`\`\`

::: card {title="The four fences"}
\`tree\` for things that nest, \`mindmap\` for the same laid out radially, \`graph\` for arrows, \`timeline\` for anything with an order.
:::
`,

  // Page 12 — tables and footnotes
  `# Tables, and notes at the foot {sticker=coffee}

| Key | What it does |
| --- | --- |
| \`/\` | opens the slash menu |
| \`Esc\` | puts the book back on the shelf |
| \`Ctrl K\` | jumps to any page in the library |
| \`Ctrl /\` | every other shortcut there is |

Click a column heading to sort by it.

A footnote is a marker in the prose[^ Bracket, caret, the note, close bracket. ] and the note is printed at the foot of whichever page the marker lands on[^flow].

The Markdown spelling works too[^why].

[^flow]: So when a paragraph flows to the next page, its notes go with it.
[^why]: Because an assistant writing you a page will reach for it.
`,

  // Page 13 — one page pointing at another
  `# One page pointing at another {sticker=heart}

Type \`[[\` and pick a page, or write its name between double brackets.

The equations are back on [[Maths, in a notebook hand]], the fences are on [[Diagrams, drawn by hand]], and the kittens are on [[Pictures]].

::: callout {variant=star}
References work both ways. Open a page that is being pointed at and it tells you what mentions it — a table of contents nobody had to keep.
:::

Links to the outside work too: \`[a link](https://example.com)\`.
`,

  // Page 14 — the decorations
  `# Decorations {sticker=star}

Any block will wear them. {underline=marker}

A little tilt, and a piece of tape. {rotate=-2, tape=top}

Torn paper, inside a scalloped frame. {paper=torn, frame=scallop}

A different hand, in a different ink. {font=marker, ink=crimson}

Ranged right, and written larger. {align=right, size=lg}

::: washi-box {color=sky}
Held to the page with washi tape.
:::

All of them live in the rail on the left, under the paintbrush.
`,

  // Page 15 — finding your way back to something
  `# Finding it again {sticker=book}

::: card {title="Three ways back"}
\`Ctrl K\` jumps to any page by name. \`Ctrl Shift F\` searches the words inside every book you own. And the contents panel in the rail lists this book's pages in order.
:::

Drop a **bookmark** on a page and a ribbon appears at the edge of the book, so the page you keep coming back to is one click away.

::: callout {variant=tip}
Every new book lands on the shelf behind this one, and the shelf has a rail of its own: a new book, the studio, another floor, and the trash.
:::
`,

  // Page 16 — the language, and the way out
  `# Write it with your AI {sticker=sparkle}

Every page in this book is written in **Notebook Script** — a forgiving Markdown dialect, which the app also reads back out again.

1. Open the left rail and choose **Insert script**
2. Click **Copy AI spec** and paste that into your assistant
3. Ask it for a page, then paste back what it writes

::: callout {variant=info}
The parser never fails. A small slip renders anyway, with a gentle note saying what it did instead.
:::

::: quote-card {color=amber}
Now go and write something of your own.
:::
`,
];

/**
 * The five pages this book USED to be, kept verbatim.
 *
 * They are here for one job: telling a welcome book nobody has touched from a
 * welcome book somebody has been writing in. The v4 -> v5 migration replaces
 * the first and never goes near the second, and the only way to know which is
 * which is to still have the old text to compare against.
 *
 * Append the outgoing generation here whenever this book is rewritten; never
 * edit an entry. A character out of place makes an untouched book look
 * written-in, which is the safe direction to be wrong in (the reader keeps the
 * old tour) but it is still wrong.
 */
export const LEGACY_WELCOME_PAGE_SOURCES: readonly string[] = [
  // Page 1 — what Alcove is + how to get around
  `---
paper: cream
wash: amber
---

# Welcome to Alcove ✎ {sticker=star}

This is your **library**. Every book on the shelf opens into pages like this one — ==real, editable pages=={color=amber}, not a demo.

::: callout {variant=tip}
Click anywhere below the ink and just start typing. Everything autosaves as you write.
:::

- The **shelf** goes on forever — drag to pan, scroll to zoom
- **Click a spine** and the book comes off the shelf and opens. Wrong one? Press \`Esc\` and it goes back
- Use the **arrow keys** to flip through a book's pages

> Flip to the next page to meet the editor → {washi=top}
`,

  // Page 2 — writing + slash commands
  `# Writing {sticker=book}

Write like in any notes app — then press \`/\` on an empty line to open the **slash menu**: headings, lists, tables, callouts, stickers, diagrams…

## Try it

- [ ] Press \`/\` and insert a callout
- [ ] Grab a block's **drag handle** to reorder it
- [ ] Right-click a block for quick actions

Inline styles: **bold**, *italic*, \`code\`, ~~strikethrough~~, ==highlight=={color=lemon}, and ==colored washes=={color=sky}.

::: sticky-note {color=lemon, rotate=-2}
Sticky notes are blocks too — pick me up and move me anywhere!
:::
`,

  // Page 3 — stickers & effects showcase
  `# Make it yours {sticker=flower}

Blocks can wear decorations — stickers, tape, washi strips, a little tilt…

::: columns {gap=lg}
::: col
::: card {color=sky, tape=top}
A **card** held down with tape.
:::
:::
::: col
::: quote-card {color=blush}
"A quote worth keeping."
:::
:::
:::

::: banner {color=moss}
Banners announce things loudly.
:::

::: spoiler
Hidden until you peek — great for quiz answers.
:::

Highlights come in seven washes: ==amber=={color=amber}, ==moss=={color=moss}, ==sky=={color=sky}, ==blush=={color=blush}, ==terracotta=={color=terracotta}.
`,

  // Page 4 — diagram example
  `# Diagrams {sticker=microscope}

Fenced mini-languages render as hand-drawn diagrams. A \`tree\`:

\`\`\`tree {style=watercolor}
Alcove
  Shelf
    Floors | endless
    Books
  Pages
    Blocks
    Diagrams | like this one
\`\`\`

And a \`timeline\`:

\`\`\`timeline
1: Pull a book off the shelf
2: Write and decorate | color=amber
3: Flip to a fresh page
\`\`\`
`,

  // Page 5 — the AI-script workflow + closing hint
  `# Your AI can write pages {sticker=sparkle}

Every page in this book was written in **Notebook Script** — a forgiving Markdown dialect any AI assistant can produce.

1. Open any page and click **Insert script** in the toolbar
2. Click **Copy AI spec** and paste the spec into your AI chat
3. Ask it to write a page — paste its reply into the dialog and insert

::: callout {variant=info}
The parser is tolerant: small syntax slips still render, with gentle warnings instead of errors.
:::

::: callout {variant=star}
This very page has script source attached — try **Export script** to read it.
:::

Happy writing! {sticker=heart}
`,
];

/**
 * Node types registered in the real editor schema (src/editor/nodes/index.ts
 * registry + extensions.ts). Passed as `hasNode` so seeding emits real
 * sticker/diagram/container/maths nodes instead of fallback placeholders.
 * Keep in sync with the registry — names match vocab.ts canonical names.
 */
const EDITOR_NODE_NAMES: ReadonlySet<string> = new Set([
  'callout',
  'imageRow',
  'sticker',
  'diagram',
  'linkCard',
  'sticky-note',
  'polaroid',
  'washi-box',
  'card',
  'quote-card',
  'banner',
  'spoiler',
  'columns',
  'col',
  'index-card',
  'envelope',
  'stamp',
  'tag',
  'marginalia',
  'pressed-flower',
  'ticket-stub',
  'postcard',
  'ledger',
  'photo-corner',
  'wax-seal',
  'map-pin',
  // The four that landed after the first version of this book was written,
  // and the reason it is being rewritten: an equation, a note at the foot of
  // the page, a reference to another page, and a fold. A name missing here is
  // not an error — it is a silent downgrade to a paragraph, which is exactly
  // how the first version of this list quietly shipped callouts where the
  // stationery should have been.
  'math',
  'mathInline',
  'footnote',
  'pageLink',
  'details',
  'detailsSummary',
  'detailsContent',
]);

/**
 * Each page's own title — its first heading, read out of the parsed page
 * rather than listed a second time here.
 *
 * A second list would be a second thing to keep in step, and the one place it
 * matters is exactly where a mistake would be invisible: `[[Maths, in a
 * notebook hand]]` on page ten has to match page three's heading CHARACTER FOR
 * CHARACTER or the reference silently degrades to plain words, which is what
 * it is supposed to do when there is no such page.
 */
export function welcomePageTitles(): string[] {
  return WELCOME_PAGE_SOURCES.map((source) => {
    for (const block of parse(source).blocks) {
      if (block.kind !== 'heading') continue;
      let text = '';
      const walk = (nodes: readonly { kind: string }[]): void => {
        for (const n of nodes) {
          const node = n as { kind: string; text?: string; children?: unknown };
          if (typeof node.text === 'string') text += node.text;
          else if (Array.isArray(node.children)) {
            walk(node.children as { kind: string }[]);
          }
        }
      };
      walk(block.content);
      return text.trim();
    }
    return '';
  });
}

/** Where a `[[…]]` reference points, once the pages actually exist. */
export interface WelcomePageIds {
  bookId: string;
  /** Page ids in page order — index-aligned with WELCOME_PAGE_SOURCES. */
  pageIds: readonly string[];
}

/**
 * Build the welcome book's page documents from the script sources.
 *
 * `ids` is optional and only page ten needs it: without it the two `[[…]]`
 * references on that page still render, as the titles they name. That is the
 * honest degradation — a chip pointing at no page would be worse than a
 * sentence — but the seeder does have the ids, so it passes them.
 */
export function buildWelcomePageDocs(ids?: WelcomePageIds): Array<{
  doc: PageDoc;
  source: string;
}> {
  const titles = welcomePageTitles();
  const resolve = (label: string): { pageId: string; bookId: string } | null => {
    if (ids === undefined) return null;
    const index = titles.indexOf(label.trim());
    const pageId = index === -1 ? undefined : ids.pageIds[index];
    return pageId === undefined ? null : { pageId, bookId: ids.bookId };
  };
  return WELCOME_PAGE_SOURCES.map((source) => ({
    doc: scriptDocToTiptap(parse(source), {
      hasNode: (name) => EDITOR_NODE_NAMES.has(name),
      resolvePageLink: resolve,
    }),
    source,
  }));
}

// ---------------------------------------------------------------------------
// Migration decision logic (pure — unit tested)
// ---------------------------------------------------------------------------

/**
 * True when a page document holds no user content: no blocks at all, or
 * nothing but paragraphs with no inline content. Anything else (any text,
 * any non-paragraph block) counts as content — deletion must be safe.
 */
export function isEmptyPageDoc(doc: PageDoc): boolean {
  const content = doc.content;
  if (content === undefined || content.length === 0) return true;
  return content.every((node) => {
    if (node === null || typeof node !== 'object') return false;
    const block = node as { type?: unknown; content?: unknown };
    if (block.type !== 'paragraph') return false;
    const inner = block.content;
    return inner === undefined || (Array.isArray(inner) && inner.length === 0);
  });
}

/**
 * v1 → v2 cleanup decision: delete only books that (a) carry an old demo
 * title, and (b) have no user content on any page. A demo book with even a
 * single non-empty page is kept; user-created books are never candidates.
 */
export function isDeletableDemoBook(
  title: string,
  pageDocs: readonly PageDoc[],
): boolean {
  // Under ANY name it has ever had — a welcome book is never a stale demo.
  if (ALL_WELCOME_TITLES.includes(title)) return false;
  if (!OLD_DEMO_TITLES.includes(title)) return false;
  return pageDocs.every(isEmptyPageDoc);
}

// ---------------------------------------------------------------------------
// v4 → v5: the welcome book was rewritten, and the old one is replaced ONLY
// where nobody has written in it
// ---------------------------------------------------------------------------

/**
 * Every welcome page this app has ever seeded — the old five and the new
 * twelve. Membership is the first half of "we put this here".
 */
const SHIPPED_WELCOME_SOURCES: readonly string[] = [
  ...LEGACY_WELCOME_PAGE_SOURCES,
  ...WELCOME_PAGE_SOURCES,
];

/**
 * A page's document with every `id` attribute removed, as canonical JSON.
 *
 * The ids are why this comparison cannot be a plain deep-equal: seeded pages
 * are stored WITHOUT block ids, and TipTap's UniqueID extension mints one for
 * every block the first time a page is opened, saving as it goes. So a book
 * the reader merely LOOKED at has a different document from the one that was
 * written to disk — different in the one way that means nothing.
 */
function docFingerprint(doc: PageDoc): string {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value === null || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'id') continue;
      if (key === 'attrs' && inner !== null && typeof inner === 'object') {
        const attrs: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(inner as Record<string, unknown>)) {
          if (k !== 'id' && v !== null) attrs[k] = v;
        }
        if (Object.keys(attrs).length > 0) out.attrs = attrs;
        continue;
      }
      out[key] = strip(inner);
    }
    return out;
  };
  return JSON.stringify(strip(doc));
}

/**
 * Rebuild the document a stored script source would have produced.
 *
 * Exported because the migration test has to be able to build a v4 library
 * exactly as the v4 seeder left it — writing the old documents by hand would
 * be testing the test.
 */
export function docFromSeededSource(source: string): PageDoc {
  return scriptDocToTiptap(parse(source), {
    hasNode: (name) => EDITOR_NODE_NAMES.has(name),
  });
}

/**
 * True when this page is still exactly what the seeder put there.
 *
 * Two things have to hold, and neither is enough alone. The stored source has
 * to be one WE shipped — otherwise it is a page the reader inserted, which is
 * theirs. And the document has to still be what that source builds —
 * otherwise they have written in it since, and the source is only the thing it
 * started as.
 *
 * The `source_dirty` flag is deliberately not consulted. It is set by any save
 * at all, and simply OPENING a page saves it once (see docFingerprint), so a
 * book that has been read once would look written-in for the rest of its life.
 */
export function isUnchangedSeededPage(page: {
  scriptSource: string | null;
  doc: PageDoc;
}): boolean {
  if (page.scriptSource === null) return false;
  if (!SHIPPED_WELCOME_SOURCES.includes(page.scriptSource)) return false;
  return docFingerprint(page.doc) === docFingerprint(docFromSeededSource(page.scriptSource));
}

/**
 * v4 → v5 decision: may this welcome book's pages be replaced wholesale?
 *
 * Only if every page in it is either one of ours, untouched, or a blank leaf
 * somebody added and never filled. One written page — a shopping list on page
 * four, a paragraph appended to page one — and the whole book is left exactly
 * as it is. The reader keeps the old tour, which is a small loss; the
 * alternative is deleting somebody's writing to install a nicer brochure.
 */
export function isReplaceableWelcomeBook(
  pages: readonly { scriptSource: string | null; doc: PageDoc }[],
): boolean {
  if (pages.length === 0) return false;
  let ours = 0;
  for (const page of pages) {
    if (isUnchangedSeededPage(page)) {
      ours += 1;
      continue;
    }
    // A blank leaf carries nothing to lose. Anything else is theirs.
    if (page.scriptSource === null && isEmptyPageDoc(page.doc)) continue;
    return false;
  }
  return ours > 0;
}

// ---------------------------------------------------------------------------
// Seed version bookkeeping
// ---------------------------------------------------------------------------

async function readSeedVersion(db: Db): Promise<number> {
  const rows = await db.select<Array<{ value: string }>>(
    'SELECT value FROM settings WHERE key = $1 LIMIT 1',
    [SEED_VERSION_KEY],
  );
  if (rows.length === 0) return 0;
  const parsed = Number.parseInt(rows[0].value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function writeSeedVersion(db: Db, version: number): Promise<void> {
  await db.execute(
    'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
    [SEED_VERSION_KEY, String(version)],
  );
}

// ---------------------------------------------------------------------------
// Seeding + migration entry point
// ---------------------------------------------------------------------------

async function cleanupOldDemoBooks(db: Db): Promise<void> {
  const rows = await db.select<Array<{ id: string; title: string }>>(
    'SELECT id, title FROM books',
  );
  for (const row of rows) {
    if (!OLD_DEMO_TITLES.includes(row.title)) continue;
    const pages = await listPages(row.id);
    if (isDeletableDemoBook(row.title, pages.map((p) => p.doc))) {
      await deleteBook(row.id);
    }
  }
}

/** Every title the book may currently be under: the live one and all the old. */
const ALL_WELCOME_TITLES: readonly string[] = [
  WELCOME_BOOK_TITLE,
  ...LEGACY_WELCOME_BOOK_TITLES,
];

/**
 * EVERY title counts, not just the current one.
 *
 * A library seeded before a rename still holds an old title, and asking only
 * about the live one would report the welcome book missing and seed a second
 * copy beside it. Built from the list so a third rename needs no edit here.
 */
async function welcomeBookExists(db: Db): Promise<boolean> {
  const placeholders = ALL_WELCOME_TITLES.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await db.select<Array<{ id: string }>>(
    `SELECT id FROM books WHERE title IN (${placeholders}) LIMIT 1`,
    [...ALL_WELCOME_TITLES],
  );
  return rows.length > 0;
}

/**
 * The app was renamed, so the book that welcomes you to it is renamed in place.
 * Retitling rather than reseeding is the whole point — the reader may have
 * written in it, and it is still their book.
 *
 * Sweeps ALL the old titles, not the most recent one: a library that skipped a
 * version is sitting on an older name, and migrating only the newest would
 * leave it unrecognised — which is precisely the case that seeds a duplicate.
 *
 * The spine is deliberately left alone. Its seed is derived from the title, so
 * regenerating it would change the object on the shelf under someone who had
 * come to recognise it, to no benefit.
 */
async function renameLegacyWelcomeBook(db: Db): Promise<void> {
  for (const old of LEGACY_WELCOME_BOOK_TITLES) {
    await db.execute('UPDATE books SET title = $1 WHERE title = $2', [
      WELCOME_BOOK_TITLE,
      old,
    ]);
  }
}

/**
 * Write the welcome pages into a book, in two passes.
 *
 * The second pass exists because page ten links to pages three and eight, and
 * a link needs the id of a row that does not exist until it has been
 * inserted. So: create every page empty to mint the ids, build the documents
 * with those ids in hand, then fill the pages in. One extra write per page,
 * once, on a path that runs at most once per install.
 *
 * `savePageDoc` before `setPageScript` and not the other way round:
 * `savePageDoc` marks a page's source dirty when it already has one, and the
 * source is not stale here — it is the thing the document was just built from.
 */
async function writeWelcomePages(bookId: string): Promise<void> {
  const pageIds: string[] = [];
  for (let i = 0; i < WELCOME_PAGE_SOURCES.length; i += 1) {
    const page = await createPage({ bookId, ord: i });
    pageIds.push(page.id);
  }
  const built = buildWelcomePageDocs({ bookId, pageIds });
  for (let i = 0; i < built.length; i += 1) {
    await savePageDoc(pageIds[i], built[i].doc);
    await setPageScript(pageIds[i], built[i].source);
  }
}

async function createWelcomeBook(): Promise<void> {
  const book = await createBook({
    title: WELCOME_BOOK_TITLE,
    floor: 0,
    slot: 3,
    spineSeed: WELCOME_SPINE_SEED,
    coverMeta: { style: { ...WELCOME_BINDING } },
  });
  await writeWelcomePages(book.id);
}

/**
 * v4 -> v5: swap the old five-page tour for the new one, in place.
 *
 * The BOOK is not touched — same row, same id, same spine, same position on
 * the shelf, so a reader who has come to recognise the object finds the same
 * object. Only its pages are replaced, and only when `isReplaceableWelcomeBook`
 * says every one of them is still ours.
 *
 * Search index rows go with the pages they described; leaving them would make
 * the quick switcher offer pages that no longer exist.
 */
async function refreshWelcomeBook(db: Db): Promise<boolean> {
  const rows = await db.select<Array<{ id: string }>>(
    `SELECT id FROM books WHERE title = $1`,
    [WELCOME_BOOK_TITLE],
  );
  let refreshed = false;
  for (const row of rows) {
    const pages = await listPages(row.id);
    if (!isReplaceableWelcomeBook(pages)) continue;
    for (const page of pages) {
      await removePageIndex(page.id);
      await db.execute('DELETE FROM pages WHERE id = $1', [page.id]);
    }
    await writeWelcomePages(row.id);
    refreshed = true;
  }
  return refreshed;
}

/**
 * Seed + migrate on app load (name kept for existing callers).
 *
 * Everything below SEED_VERSION runs, oldest step first:
 *
 *   v1 cleanup  delete the 24 demo books, but only ones nobody wrote in
 *   v2/v3/v4    retitle a welcome book sitting on any past app name
 *   v5          replace the welcome book's PAGES with the new tour, and only
 *               when every page in it is still exactly as it was seeded
 *   always      create the welcome book if the library has none
 *
 * The order matters twice. Renaming BEFORE the existence check is what stops
 * a pre-rename library growing a second welcome book (the check reads every
 * past title too, because a migration that is only correct in one order is a
 * trap). And refreshing AFTER the rename is what lets a library that skipped
 * a version get the new pages in the same pass that gives it the new name.
 *
 * Returns true when the welcome book was CREATED by this call — a refreshed
 * book is not a new one, and the caller uses this to decide whether to make a
 * fuss about a first run.
 */
export async function seedIfEmpty(): Promise<boolean> {
  const db = await getDb();
  if ((await readSeedVersion(db)) >= SEED_VERSION) return false;

  await cleanupOldDemoBooks(db);
  await renameLegacyWelcomeBook(db);
  await refreshWelcomeBook(db);
  const exists = await welcomeBookExists(db);
  if (!exists) await createWelcomeBook();
  await writeSeedVersion(db, SEED_VERSION);
  return !exists;
}
