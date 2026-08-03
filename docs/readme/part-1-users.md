<p align="center">
  <img src="docs/readme/img/hero.png" alt="Bellanote — a notebook that lives on a bookshelf. A cream card taped to a papered wall, with the app's book icon, the wordmark in a handwriting face, and six coloured book spines standing on a timber plank below." width="880">
</p>

<!--
  Badges below are static because both live sources are currently unavailable:
  the repository is private (shields cannot read it) and no version tag has ever
  been pushed, so a release badge would render "inaccessible" rather than a fact.
  When the repo goes public and `v0.2.0` is tagged, replace the first two with:

  [![release](https://img.shields.io/github/v/release/AkshitIreddy/bellanote?style=flat-square&labelColor=4f3120&color=c96f4a)](https://github.com/AkshitIreddy/bellanote/releases/latest)
  [![build](https://img.shields.io/github/actions/workflow/status/AkshitIreddy/bellanote/release.yml?style=flat-square&labelColor=4f3120&color=7d915c)](.github/workflows/release.yml)
-->

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-c96f4a?style=flat-square&labelColor=4f3120" alt="Version 0.1.0">
  <img src="https://img.shields.io/badge/release-none%20published%20yet-9d6b3c?style=flat-square&labelColor=4f3120" alt="No release published yet">
  <img src="https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-7d915c?style=flat-square&labelColor=4f3120" alt="Platform: Windows 10 and 11">
  <img src="https://img.shields.io/badge/storage-local%20SQLite%20%C2%B7%20no%20account-5f7d8c?style=flat-square&labelColor=4f3120" alt="Storage: local SQLite, no account">
</p>

# Bellanote

**A Windows notes app that puts your notes on a bookshelf you can walk around in.**

Books stand on shelves in a hand-drawn room. You pull one off, it opens as a
two-page spread, and you write in it with a block editor of the kind you already
know — slash menu, drag handles, right-click menu, tables, callouts, code,
diagrams. Every word lives in a SQLite file on your own disk; there is no
account to make, nothing to sign into, and no network call unless you ask for a
picture.

Five things that are actually in the box:

- **A bookshelf world.** A WebGL room you pan and zoom through, with as many
  bookcases as you care to build and ten floors per case to start with. Books
  are drawn objects, not rows in a list — you recognise yours by its binding.
- **Pages that never scroll.** A page is a fixed leaf of paper. When you fill
  it, the trailing blocks flow onto the next page, and a new page is made if
  there isn't one. Turning a page is a page turn, not a scroll.
- **Notebook Script.** A small Markdown dialect you can hand to any chatbot.
  Ask it for a note, paste the reply into *Insert script*, and it becomes
  formatted pages — including trees, graphs and timelines drawn as hand-drawn
  diagrams.
- **Customisation that goes further than a colour picker.** 55 named rooms,
  <!--f:shelfPresets-->113<!--/f--> named bookcase designs,
  <!--f:wallpaperPapers-->126<!--/f--> wallpapers,
  <!--f:bookPresets-->189<!--/f--> book bindings, 50 stickers, 11 axes of block
  decoration. Every count here was read out of the module that defines it, and
  most of them are wrapped in a marker that `npx vitest run` recomputes — so if
  a vocabulary grows and this page does not, the test suite says so.
- **The quiet infrastructure.** Full-text search, a `Ctrl+K` switcher, scheduled
  backups, an export bundle that another copy of the app can import, a tray icon
  for capturing a thought without opening the window, and a sound for everything
  you touch.

> [!NOTE]
> **Where this actually stands, so you can judge it before installing.**
> - **Windows only.** Windows 10 or 11. There is no macOS or Linux build, and no
>   mobile app.
> - **Pre-1.0, and no release has been published yet.** The version in
>   [`package.json`](package.json) and
>   [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json) is `0.1.0`; the
>   repository has no version tags, so the Releases page is empty. See
>   [Installing](#installing).
> - **Your library is one local SQLite file.** No account, no sync, no cloud, no
>   telemetry. That is a deliberate design, not a missing feature — and it means
>   the backups below are your only copies.
> - **The one thing that touches the network** is the optional `fetch:` line in
>   Notebook Script, which downloads an image for you. Nothing else leaves the
>   machine.

## Installing

There is **no published release yet**, so there is nothing to download today.
This section describes what the download will be when the first tag lands, so
you can tell whether it is the kind of thing you want.

When a maintainer pushes a version tag, [the release
workflow](.github/workflows/release.yml) typechecks, runs the unit tests, builds
on `windows-latest`, and publishes to
[Releases](https://github.com/AkshitIreddy/bellanote/releases):

| File | What it is |
| --- | --- |
| `Bellanote_<version>_x64-setup.exe` | NSIS installer. Installs for the **current user**, so Windows will not ask for an administrator. This is the one to take. |
| `Bellanote_<version>_x64_en-US.msi` | MSI, for anyone who deploys software with a policy rather than a double-click. |

The one requirement is the Microsoft Edge **WebView2** runtime — already present
on Windows 11 and on any up-to-date Windows 10, and fetched by the installer if
it is missing. Bellanote is a [Tauri](https://tauri.app/) app, so it uses that
system webview instead of shipping a browser of its own: the download is small,
and nothing runs in the background when the window is closed unless you turn on
tray quick capture.

Your library is created on first launch at
`%APPDATA%\com.bellanote.app\notebook.db`. To move to another machine, copy that
file, or use *Settings → Library files → Export* to make a `.nbk` bundle the
other copy can import.

Building from source is covered further down under **Developing**.

## A tour

Each picture below is a real capture of the running app, taken by the harness in
[`shots-now/`](shots-now/) — no mock-ups, no compositing. Each one is there to
prove the sentence above it.

### The shelf is the file browser

Books stand on floors of a bookcase. Drag one off the shelf to open it — a
single click works too, as a quick pull. The plain mouse wheel **zooms** and
shift+wheel pans (swap the two in *Settings → Library & shelf* if you would
rather scroll); `Escape` from anywhere throws the camera back to the shelf. The
left dock makes a new book, opens the studio, adds a floor, or shows the trash.

![The Bellanote shelf: a green bookcase with a fluted cornice against pale striped wallpaper. Two floors carry about eighteen books with individually drawn spines — cream label plates, gilt bands, raised cords — and a dashed outline marks the next free slot. A cream dock on the left offers new book, studio, add floor and trash; a zoom control reading 80% sits at the bottom.](docs/readme/img/shelf.png)

Nothing here is a rectangle with a gradient on it: every spine is drawn from the
book's own seed through [`src/art/bookDesign.ts`](src/art/bookDesign.ts), baked
once to a texture and packed into an atlas. Floors you cannot see are not drawn,
so a case with three hundred books costs about what a case with three costs. The
camera, the virtualisation and the level-of-detail rules live in
[`src/features/bookshelf/`](src/features/bookshelf/) and are specified in
[`docs/design/bookshelf-rendering.md`](docs/design/bookshelf-rendering.md).

Pull back and the whole case is one object — ten floors as standard, more when
you press *add floor*, and as many separate bookcases as you want to build.

![The same bookcase seen at 38% zoom: the full ten-floor case, top to plinth, standing on the papered wall. The top three floors hold books; the rest are empty arched openings waiting to be filled.](docs/readme/img/shelf-zoomout.png)

### A book opens as a spread, and turns like a book

Two pages side by side, ruled paper, a tool rail down the left edge, and a word
count at its foot. Arrow keys turn pages; so does dragging the outer edge or a
corner of a leaf, which lets you take the turn at your own speed and change your
mind halfway.

![The Welcome book open on its first spread. The left page carries the title in a large handwriting face, a green callout, a bulleted list and a strip of pink washi tape; the right page shows the Writing section with checkboxes, inline bold, italic, code, strikethrough, a yellow highlight and a blue colour wash. A vertical rail of hand-drawn tool icons runs down the left edge.](docs/readme/img/spread.png)

Mid-turn, the leaf lifts off the spread and you can see the next page under it:

![The same spread mid page-turn. The right leaf has lifted and swung partway across, revealing the following page underneath with its own headings and a sticky note, while the left page stays put.](docs/readme/img/page-turn.png)

At rest the pages are live DOM, so text stays selectable and crisp. The moment
you start a turn, the app swaps to a WebGL cylinder-curl shader fed by
pre-rasterised snapshots of the two pages, then swaps back. That trade — and the
CSS fallback used when WebGL is unavailable — is written up in
[`docs/design/page-flip.md`](docs/design/page-flip.md) and implemented in
[`src/flip/`](src/flip/).

**Pages never scroll.** This is the rule the whole editor is built around. A
page is a fixed height; when the blocks you have written exceed it, the editor
peels the trailing blocks off and hands them to the next page, creating one if
needed. You can also leave a page deliberately blank. The contract lives in
[`src/editor/pagination.ts`](src/editor/pagination.ts).

### Writing: a slash menu, and a catalogue of everything

Press `/` on an empty line for the menu. There are **87 commands** in it —
31 blocks, 50 stickers and 6 turn-into conversions — defined in
[`src/editor/slash/registry.ts`](src/editor/slash/registry.ts).

![The slash menu open on the right-hand page of the Welcome book: a cream panel headed BLOCKS listing Text, Heading 1, Heading 2, Heading 3, Bullet list and Numbered list, each with a hand-lettered icon and a one-line description, with Text highlighted.](docs/readme/img/slash.png)

If you would rather browse than type, the rail's **Catalogue** shows everything
the pages can hold, filtered by kind — paper and cards, text blocks, callouts,
diagrams, tape and trim, lettering, stickers.

![The Catalogue panel open beside the spread. A search box and filter chips run across the top; below them, a grid of labelled tiles under 'paper & cards' — Sticky note, Polaroid, Washi box, Card, Quote card, Banner, Spoiler, Index card, Envelope, Stamp, Tag, Margin note, Columns — and a second grid under 'text blocks' with Text, Heading 1–3, lists, To-do list, Toggle, Quote, Code block, Table and Divider.](docs/readme/img/catalogue.png)

Right-click any block for the Notion-style context menu; click on empty ruled
space and you start typing there. Blocks can be dragged by their handle. On top
of that, every block can be decorated along **11 axes** — tape, washi, lift,
frames, paper, underlines, hand, ink, size, ranging and tint — carrying **472
choices** between them, from
[`src/editor/effects/vocabulary.ts`](src/editor/effects/vocabulary.ts).

### The studios: this is how deep the customisation goes

The **library studio** dresses the room. A room preset sets the colours, the
carpentry and the paper together, and every one of those stays yours to change
afterwards.

![The library studio open, pushing the shelf to the right rather than covering it. The panel shows the current bookcase card ('My Library — 19 books · 10 floors') with rename, clone and delete, then buttons to add a bookcase or a floor, then a grid of room preset thumbnails — The Reading Room, Chambers, Old Athenaeum, Card Room, The House Room — each a tiny drawing of that room, with a '50 more…' tile. Caption text reads '55 rooms, sorted by the kind of room they are.'](docs/readme/img/studio.png)

The **book studio** dresses one book, and only that book: a binding follows its
book into every room, which is what lets you recognise it after you have
repainted the walls.

![The 'Customize this book' panel open beside the spread, with tabs for 'this book' and 'this library'. A large preview shows the Welcome book's plum leather spine with raised cords and a gilt label plate, with spine and cover toggles beneath it, the binding named 'read to death', and a grid of alternative bindings ending in a tile reading '182 more…'.](docs/readme/img/book-studio.png)

Counted from the modules themselves, not estimated:

| What you choose | How many | Where it is defined |
| --- | --- | --- |
| Rooms (colours + carpentry + paper, as one pick) | **55** in 9 families | [`src/views/rail/designOptions.ts`](src/views/rail/designOptions.ts) |
| Colour schemes on their own | **<!--f:roomThemes-->60<!--/f-->** in 5 families | [`src/art/themes.ts`](src/art/themes.ts) |
| Bookcase carpentry | **<!--f:shelfBuilds-->52<!--/f-->** builds × **<!--f:shelfPatterns-->50<!--/f-->** timber patterns, **<!--f:shelfPresets-->113<!--/f-->** named | [`src/art/shelfDesign.ts`](src/art/shelfDesign.ts) |
| Wallpaper | **<!--f:wallpaperMotifs-->50<!--/f-->** patterns × 5 scales × 4 reliefs × 6 ink slots, **<!--f:wallpaperPapers-->126<!--/f-->** named across 12 moods | [`src/art/wallpaperDesign.ts`](src/art/wallpaperDesign.ts) |
| Book bindings | **<!--f:bookShapes-->50<!--/f-->** spine shapes × **<!--f:bookMaterials-->50<!--/f-->** materials × **<!--f:bookDecorations-->50<!--/f-->** decorations, **<!--f:bookPresets-->189<!--/f-->** named | [`src/art/bookDesign.ts`](src/art/bookDesign.ts) |
| Book covers | **50** pigments, **50** frames, **50** medallions | [`src/art/covers.ts`](src/art/covers.ts) |
| Bookmark ribbons | 25 cloths × 5 weights × 10 tails × 8 materials × 13 charms, **40** named | [`src/views/bookmarks.ts`](src/views/bookmarks.ts) |
| Block decoration | **11** axes, **472** values | [`src/editor/effects/vocabulary.ts`](src/editor/effects/vocabulary.ts) |
| Stickers | **50** in 7 families | [`src/editor/nodes/stickers.ts`](src/editor/nodes/stickers.ts) |
| Sound sets | **<!--f:soundSets-->28<!--/f-->** in 7 groups, voicing **<!--f:soundCues-->66<!--/f-->** cues, over 10 ambient beds | [`src/sound/soundSets.ts`](src/sound/soundSets.ts) |
| Settings | **38**, across 8 sections | [`src/data/types.ts`](src/data/types.ts) |

The three shape vocabularies are deliberately independent of colour: repainting
a room does not straighten its arches, and rebuilding a case does not repaint it.

### Finding things, and the rest of the furniture

`Ctrl+K` opens the switcher. It jumps to books and headings by fuzzy match, and
`>` flips it into full-text search across every page in every bookcase.

![The quick switcher open over a dimmed spread: a cream sheet with 'go to' and 'search text' tabs, the prompt 'jump to a book or heading… (> to search text)', and a list of matching books — Tax 2026, Piano Scales, Icelandic, Weekly Review, Short Stories, Astronomy, Bird Counts, Sourdough, Letters Home, Chess Openings — with a footer reading '↑↓ move · enter open · tab mode · esc close'.](docs/readme/img/quickswitch.png)

Everything else you would look for, and where it is:

| | |
| --- | --- |
| **Backups** | Scheduled by the day, to a folder you choose, with restore — [`src/features/system/backup.ts`](src/features/system/backup.ts) |
| **Transfer bundles** | Export part or all of the library as a `.nbk` archive (or as plain Markdown); import is additive, with a conflict matrix and long-lived restore points — [`src/features/transfer/`](src/features/transfer/) |
| **Export a page** | Notebook Script, plain Markdown, or PDF built from 2× page snapshots — [`src/editor/script/exporters/`](src/editor/script/exporters/) |
| **Tray quick capture** | A tray icon that opens an `Inbox` book for one thought without hunting for the window — [`src/features/system/tray.ts`](src/features/system/tray.ts) |
| **Daily journal** | `/today` finds or creates today's dated page in your Journal book — [`src/editor/journal.ts`](src/editor/journal.ts) |
| **Templates** | Cornell notes, Lecture notes, Flashcard deck, Weekly planner, Reading log — [`src/features/templates/templates.ts`](src/features/templates/templates.ts) |
| **Trash** | Deleted books are recoverable, not gone — [`src/features/bookshelf/TrashPanel.tsx`](src/features/bookshelf/TrashPanel.tsx) |
| **Sound** | <!--f:soundCues-->66<!--/f--> cues, every one a real recording under CC0 or a public-domain dedication (one bed is CC BY, credited in-app); the credits panel is generated from the same manifest that drives the audio — [`docs/design/sound.md`](docs/design/sound.md) |
| **Shortcuts** | Eight rebindable actions, `mod+k` for the switcher down to `escape` for the shelf — [`src/data/defaults.ts`](src/data/defaults.ts) |

## Notebook Script

Notebook Script is the reason the app has an "AI spec" button. It is a
Markdown dialect small enough that any chatbot can write it correctly on the
first try, and expressive enough to produce a decorated page rather than a wall
of paragraphs. The rail's **Copy spec for your AI** button puts the entire
grammar — [`src-tauri/resources/notebook-script-spec.md`](src-tauri/resources/notebook-script-spec.md),
706 lines, generated from the parser's own vocabulary — on your clipboard. Paste
that into a chatbot, ask for a note, paste the answer back.

Here is a complete script and the page it makes.

````text
---
title: Field Notes — Week 3
paper: grid
wash: moss
---

# Photosynthesis {sticker=leaf}

Sunlight in, sugar out. The ==light-dependent=={color=amber} half runs in the thylakoid.

::: sticky-note {color=lemon, rotate=-2, tape=corner}
Exam **Friday** — learn both stages.
:::

```graph
Sun -> Leaf: light
Water -> Leaf
Leaf -> Glucose, Oxygen
Glucose {color=amber}
```

```timeline
1771: Priestley — air is "restored"
1779: Ingenhousz — only in the light
1845: Mayer — sunlight becomes chemical energy
```
````

*Insert script* previews as you paste, naming each piece it recognised — one
sticky note, a graph of four edges, a timeline of three entries — so you can see
the shape of the result before you commit it:

![The Insert script dialog: the pasted script on the left in a monospace box, and on the right a live preview headed FIELD NOTES — WEEK 3 showing the Photosynthesis heading, the paragraph with its amber highlight, a yellow sticky-note block, and two placeholder cards labelled 'graph — 4 edges' and 'timeline — 3 entries'.](docs/readme/img/script-dialog.png)

Insert, and it lands on the page as real editable blocks — the diagrams drawn,
not embedded as images:

![The right-hand page after inserting: 'Photosynthesis' in large handwriting on grid paper, the paragraph with its amber highlight, then a hand-drawn node graph with Sun and Water flowing into Leaf and out to Glucose and Oxygen, then a timeline with three dated cards along a vertical spine.](docs/readme/img/script-page.png)

What you get for those few lines:

- **Frontmatter** sets the page's paper, ink and edge wash.
- **16 containers** — sticky notes, polaroids, callouts, columns, index cards,
  envelopes, stamps, luggage tags, marginalia — plus 52 aliases, so `::: note`,
  `::: postit` and `::: Sticky Note` are all the same thing.
- **27 attribute keys** for decorating any block or span: `color`, `sticker`,
  `tape`, `washi`, `rotate`, `paper`, `shadow`, `underline`, `frame`, `font`,
  `ink`, `size`, `align` and more.
- **5 diagram fences** — `tree`, `mindmap`, `graph`, `flowchart`, `timeline` —
  each with a grammar you could teach someone in a sentence. A ` ```mermaid `
  fence is accepted as a compatibility ramp and warned.
- **`::let` variables and `::style` reusable decoration**, for notes that repeat
  themselves.
- **`fetch:` lines** that ask the app to find and cache an image for a query.

The parser is **total**: `parse()` never throws. A malformed line produces a
diagnostic naming the line, the column and what was expected, and the app renders
your intent anyway — near-miss spellings like `papper` and `microscop` are
corrected with a warning rather than dropped. That promise, and the grammar it
guards, are specified in
[`docs/design/script-language.md`](docs/design/script-language.md) and
implemented in [`src/script/`](src/script/).

The script is kept alongside the page, so a note written this way can be edited
as script and re-run, or exported back out with **Export script**.

Diagrams are first-class outside script too — this is a page of the Welcome book,
showing a `tree` and a `timeline` as the app draws them:

![The Welcome book's third spread. The left page, 'Make it yours', lists decorated example blocks — a taped card, a quote, a banner, a click-to-reveal spoiler, and seven named highlight washes. The right page, 'Diagrams', shows a hand-drawn tree with Bellanote branching to Shelf and Pages and on to Floors, Books, Blocks and Diagrams, and below it a three-step timeline.](docs/readme/img/diagrams.png)
