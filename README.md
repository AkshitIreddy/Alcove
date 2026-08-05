<p align="center">
  <img src="docs/readme/img/hero.png" alt="Alcove — a notebook that lives on a bookshelf. A cream card held to a papered wall by a strip of washi tape, carrying the app's red spiral-notebook icon, the wordmark in a handwriting face, the lines 'A notebook that lives on a bookshelf' and 'Windows, macOS and Linux · everything stays on your machine', and four pill labels: endless shelf, block editor, pages that flow, paste from any AI. Six coloured book spines stand on a timber plank below." width="880">
</p>

<!--
  The badge strip below is GENERATED — `npm run readme:build` composes it from
  the version in package.json, so a release bump moves the badge, the download
  filenames and the release table together. Edit scripts/gen-readme.mjs, not
  this block.

  Two badges are deliberately static images rather than live shields endpoints:
  the repository is private, so shields cannot read its releases or its actions
  and would render "inaccessible" instead of a fact. When it goes public, swap
  the first two in renderBadges() for:

  https://img.shields.io/github/v/release/AkshitIreddy/alcove
  https://img.shields.io/github/actions/workflow/status/AkshitIreddy/alcove/release.yml
-->

<!-- gen:badges -->
<p align="center">
  <a href="https://github.com/AkshitIreddy/alcove/releases/latest"><img src="https://img.shields.io/badge/download-Alcove%200.2.0-c96f4a?style=flat-square&labelColor=4f3120" alt="Download Alcove 0.2.0"></a>
  <img src="https://img.shields.io/badge/version-0.2.0-b8863b?style=flat-square&labelColor=4f3120" alt="Version 0.2.0">
  <img src="https://img.shields.io/badge/platform-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-7d915c?style=flat-square&labelColor=4f3120" alt="Platforms: Windows, macOS and Linux">
  <img src="https://img.shields.io/badge/offline-no%20account%20%C2%B7%20no%20cloud-5f7d8c?style=flat-square&labelColor=4f3120" alt="Offline: no account, no cloud">
  <img src="https://img.shields.io/badge/licence-MIT-6f6a86?style=flat-square&labelColor=4f3120" alt="Licence: MIT">
</p>
<!-- /gen -->

<h1 align="center">Alcove</h1>

<p align="center">
  <b>A notes app that keeps your writing in books, on a shelf you can walk around in.</b>
</p>

<p align="center">
  <a href="#download-and-install"><b>▸ Download</b></a>
  &nbsp;·&nbsp;
  <a href="#a-tour"><b>▸ See it</b></a>
  &nbsp;·&nbsp;
  <a href="#written-with-an-ai"><b>▸ Write it with an AI</b></a>
  &nbsp;·&nbsp;
  <a href="docs/readme/releases.md"><b>▸ What's new</b></a>
  &nbsp;·&nbsp;
  <a href="#how-its-built"><b>▸ For developers</b></a>
</p>

---

Alcove keeps what you write in books standing on shelves in a hand-drawn room,
instead of in a list of filenames. You pan and zoom around that room, pull a
book off its floor, and it opens as a two-page spread you write in with a block
editor of the kind you already know — slash menu, drag handles, right-click
menu, tables, callouts, code, diagrams.

Pages are real pages: a page is a fixed leaf that never scrolls, so filling one
flows your writing onto the next and turning it is a turn rather than a scroll.
The room is yours to dress, and much further than a colour picker goes. And
nothing you write leaves your machine — there is no account and nothing to sign
into.

**And a page does not have to be typed by you.** Alcove reads *Notebook Script*,
a small Markdown dialect any chatbot can write once it has been handed the
grammar — which is one button, *copy the format for your AI*. Ask ChatGPT or
Claude or whatever you already use for revision notes; paste the answer into
*paste a script in*; it lands as real editable pages, with the sticky notes, the
callouts, the highlights and the hand-drawn diagrams already made. No API key,
no model inside the app, nothing sent anywhere: you carry the text there and
back yourself, which is why it works with an assistant that has never heard of
Alcove. [The whole loop is a few inches down.](#written-with-an-ai)

<p align="center">
  <img src="docs/readme/img/shelf.png" alt="The Alcove shelf: a dark walnut bookcase with a plain slab cornice, a chain of gilt rings running along every board, and an ogee arch cut into the back of every recess, standing against cream wallpaper netted with a fine gold trellis, three floors of individually drawn book spines, and a cream tool dock on the left." width="47%">
  <img src="docs/readme/img/spread.png" alt="A book open on its first spread: two ruled pages carrying a handwritten title, a green callout, a green banner, checkboxes, highlights, a yellow sticky note and a strip of pink washi tape, with a vertical rail of hand-drawn tool icons down the left edge." width="47%">
</p>

> ### This page has two halves, and they are for different people
>
> **▸ [Part 1 — Using Alcove](#whats-in-the-box) · for the person writing in it**
> <br>The whole user manual: how to get it, what it does, and how to use every
> part of it. It starts immediately below, it assumes nothing about code, and it
> is the longer half.
>
> **▸ [Part 2 — Building Alcove](#how-its-built) · for a developer, or for an AI
> agent helping one**
> <br>The architecture, the stack, the gates, and how to add something without
> breaking the rest. If you are an assistant asked to contribute here, that half
> plus [`CLAUDE.md`](CLAUDE.md) is your brief.
>
> **Every technical fact lives in the second half** — including the ones a README
> usually opens with, like where the database is, what touches the network, and
> what runs in which process. None of it is needed to use the app, so none of it
> is above the line.
>
> Each half is also a page of its own under [`docs/readme/`](docs/readme/),
> carrying exactly the same words as the copy here.

**On this page**

<!-- gen:contents -->
**Part 1 — Using Alcove** — for the person writing in it. No code below this line.

- [What's in the box](#whats-in-the-box) — The five things that make this different from a folder of Markdown files
- [Written with an AI](#written-with-an-ai) — Notebook Script is a language a chatbot can write for you, the spec is one button, and the design packs generate their own prompt
- [Download and install](#download-and-install) — The installer, what it puts where, what the first launch looks like, and how to uninstall without losing your notes
- [A tour](#a-tour) — The shelf, the spread, the page turn, the slash menu, the catalogue, the two studios, the switcher
- [Writing in a book](#writing-in-a-book) — Every block a page can hold, the right-click menu, why pages never scroll, maths, diagrams, pictures, the rail end to end
- [Notebook Script](#notebook-script) — The language itself — a whole worked script, the page it makes, and everything it can say
- [Making it yours](#making-it-yours) — The two studios, every vocabulary counted, custom colours, stars and hiding, more bookcases, your own packs
- [Sound](#sound) — Sound sets, ambience beds, the volume model, and the in-app credits
- [The keyboard](#the-keyboard) — Every shortcut, grouped by where you are standing, and which ones you can rebind
- [Backups, export and import](#backups-export-and-import) — Scheduled backups, `.nbk` bundles, Markdown in and out, PDF and PNG, tray capture
- [Questions](#questions) — Where the data is, whether it is offline, moving machines, and the failure modes worth naming

**Part 2 — Building Alcove** — for a developer, or for an AI agent helping one. Nothing below is needed to use the app.

- [How it's built](#how-its-built) — The three ways the app draws itself, what runs in which execution context, and the stack table with a reason per row
- [Getting it running](#getting-it-running) — `npm run tauri dev`, the browser-only dev path, and the four checks
- [The map of the app](#the-map-of-the-app) — Directory by directory, plus the module-docstring convention this README points at instead of copying
- [Building and releasing](#building-and-releasing) — The bundle artefacts, the icon pipeline, and the tag-driven release workflow
- [Non-goals](#non-goals) — No sync, no cloud, no mobile, no plugin API, no second visual language, no light model
- [The repo at a glance](#the-repo-at-a-glance) — Six measurements of the tree, every one recomputed rather than typed
- [Deeper reading](#deeper-reading) — The two halves as pages of their own, and every section of them this page does not already carry
- [How this page stays honest](#how-this-page-stays-honest) — Why no number here is typed, why no paragraph is written twice, and what the check does and does not do
- [Licence and credits](#licence-and-credits) — MIT, the bundled fonts, where the sound came from, and the two brand images that are not interchangeable
<!-- /gen -->

# Part 1 — Using Alcove
<!--nav: for the person writing in it. No code below this line.-->

## What's in the box
<!--nav: The five things that make this different from a folder of Markdown files-->

- **A bookshelf world.** A room you pan and zoom through, with as many bookcases
  as you care to build and <!--f:defaultFloors-->10<!--/f--> floors per case to
  start with. Books are drawn objects, not rows in a list — you recognise yours
  by its binding.
- **A language an AI can write for you.** *Copy the format for your AI* puts
  <!--f:specLines-->821<!--/f--> lines of generated grammar on your clipboard;
  any chatbot then writes you a note in it, and *paste a script in* turns that
  answer into formatted pages — sticky notes, callouts, highlights, and trees,
  graphs and timelines drawn as real diagrams rather than pasted as pictures.
  Pages come back out in the same language, so one an assistant wrote can be
  handed back to it. [The whole story is below](#written-with-an-ai).
- **Pages that never scroll.** A page is a fixed leaf of paper. When you fill
  it, the trailing blocks flow onto the next page, and a new page is made if
  there isn't one. Turning a page is a page turn.
- **Customisation that goes much further than a colour picker.**
  <!--f:roomPresets-->69<!--/f--> named rooms,
  <!--f:shelfPresets-->113<!--/f--> named bookcase designs,
  <!--f:wallpaperPapers-->126<!--/f--> wallpapers,
  <!--f:bookPresets-->189<!--/f--> book bindings,
  <!--f:stickers-->50<!--/f--> stickers,
  <!--f:effectAxes-->11<!--/f--> axes of block decoration — and a hex box in
  every picker, for when none of them is the colour you meant.
- **The quiet infrastructure.** Full-text search, a `Ctrl+K` switcher, scheduled
  backups, an export bundle another copy of the app can import, a tray icon for
  capturing a thought without opening the window, and a sound for everything you
  touch.

Every number on this page was read out of the module that defines it and wrapped
in a marker `npx vitest run` recomputes — see
[How this page stays honest](#how-this-page-stays-honest).

<!-- gen:lift-ai -->
## Written with an AI
<!--nav: Notebook Script is a language a chatbot can write for you, the spec is one button, and the design packs generate their own prompt-->

Most notes apps let you paste text an assistant wrote. Alcove is built so an
assistant can write the **whole page** — the sticky notes, the callouts, the
highlights, the hand-drawn diagrams — and so you never have to teach it how.

**1. Take the grammar.** The rail's *In and out* sheet offers *copy the format
for your AI*: <!--f:specLines-->821<!--/f--> lines of specification onto your
clipboard, every container, every attribute, every diagram fence, with examples.
You did not write it and neither did anybody else — it is generated from the
parser's own tables
([`src-tauri/resources/notebook-script-spec.md`](src-tauri/resources/notebook-script-spec.md)),
so it cannot describe a language the app would refuse.

**2. Ask for a note.** Paste the spec into any chatbot, then ask for what you
want in your own words: *"revision notes on photosynthesis, sticky note for the
exam date, a timeline of the discoveries"*.

**3. Paste it back.** *Paste a script in*, on the same sheet, previews what it
recognised — one sticky note, a graph of four edges, a timeline of three entries
— before anything lands on the page. Then it becomes real editable blocks, with
the diagrams **drawn** rather than embedded as pictures.

The same idea runs through the customisation. The *your designs* dialog does not
just accept a JSON file — it hands you a prompt for making one, and that prompt
is generated from the importer's own schema
([`src/features/packs/prompt.ts`](src/features/packs/prompt.ts)), listing
the real motifs, the real materials and the real cue names. A hand-written
prompt describing a format the importer would reject is worse than no prompt at
all, so this one cannot be hand-written.

Three things worth knowing about how this works:

- **Nothing is sent anywhere.** There is no API key, no model in the app, no
  request to anybody's server. You carry the text to whichever assistant you
  already use and you carry the answer back, which is why this works with a
  chatbot that has no idea Alcove exists.
- **It cannot break the app.** The parser is total: a malformed line produces a
  diagnostic naming the line and the column, near-miss spellings are corrected
  with a warning, and your page still arrives. A chatbot's typo should not cost
  you a page.
- **It reads back out.** *Copy this page as script* takes a whole page back out
  in the same language, and the right-click menu takes a single block — so a
  page an assistant wrote can be handed back to it for revision.

[Notebook Script](#notebook-script) below is the language itself, with a whole
worked example and the page it makes.
<!-- /gen -->

<!-- gen:lift-download -->
## Download and install
<!--nav: The installer, what it puts where, what the first launch looks like, and how to uninstall without losing your notes-->

One file you double-click. It does not ask for an administrator, it does not
bring a browser along with it, and there is no account to make.

| Platform | What to download | First launch |
| --- | --- | --- |
| **Windows 10 / 11** · x64 | [`Alcove_0.2.0_x64-setup.exe`](https://github.com/AkshitIreddy/alcove/releases/latest) · about 16 MB | Double-click. It installs for **the current user**, so Windows never asks for an administrator. SmartScreen warns once — *More info* → *Run anyway*. |
| **macOS 11+** · Apple silicon and Intel | [`Alcove_0.2.0_universal.dmg`](https://github.com/AkshitIreddy/alcove/releases/latest) | One universal disk image for both chips, so there is nothing to choose between. Unsigned, so the first open is right-click → *Open* rather than a double-click. |
| **Linux** · x64 | [`.deb`, `.rpm` or `.AppImage`](https://github.com/AkshitIreddy/alcove/releases/latest) | Built on Ubuntu 22.04, so it runs on 22.04 and anything newer. The AppImage needs no install — mark it executable and run it. |

All three are built from the same tag by `.github/workflows/release.yml` and attached to the GitHub Release with a `SHA256SUMS.txt` beside them. Windows also gets `Alcove_0.2.0_x64_en-US.msi`, the same app as an MSI, for anyone who deploys software with a policy rather than a double-click.

There is a second Windows file, `Alcove_0.2.0_x64-setup-offline.exe`, and you almost certainly do not want it. Alcove draws itself in the Microsoft Edge WebView2 runtime, which is already on any current Windows — the normal installer fetches it in the rare case it is missing, and the offline one carries the whole runtime instead, which is why it is around 217 MB rather than 16. Take it only if the machine has no internet, or the normal installer failed while fetching.

**Nothing is signed on any platform yet**, which is why the first-launch column says what it says, and why the checksums are there: the line for your file in `SHA256SUMS.txt` is how you check the download yourself rather than taking anybody's word for it.

**[What is new in this version](docs/readme/releases.md)** — the release notes are their own
page rather than the first thing you have to scroll past.

Alcove borrows the webview the operating system already has instead of packing a
browser inside itself, which is why the download is measured in megabytes rather
than hundreds of them, and why nothing of it runs in the background once you
close the window (unless you switch on tray quick capture). On Windows that
means the Microsoft Edge **WebView2** runtime — present on Windows 11 and on any
up-to-date Windows 10, and fetched by the installer when it is missing. On macOS
and Linux the system webview is already there.

### Where your writing lives

Two roots, always: the **program** in one place and your **library** in another.
That separation is the useful part — uninstalling removes the first and leaves
the second exactly where it was.

| | Windows | macOS | Linux |
| --- | --- | --- | --- |
| **The program** | `%LOCALAPPDATA%\Alcove\` | `/Applications/Alcove.app` | wherever your package manager puts it |
| **Your library** | `%APPDATA%\com.alcove.app\` | `~/Library/Application Support/com.alcove.app/` | `~/.local/share/com.alcove.app/` |

Inside that library folder: `notebook.db` is everything you have written (plus
`notebook.db-wal` and `notebook.db-shm` while the app is running), `assets/`
holds every picture you pasted or fetched, and `backups/` holds the scheduled
ZIPs unless you point *Settings → System* somewhere else.

On Windows the installer is configured with `installMode: currentUser`
([`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json)), which is the
whole reason there is no administrator prompt: the program goes into your own
user profile rather than into `C:\Program Files`.

### The first time you open it

Nothing to configure, nothing to sign into, no splash screen. In order:

1. **A library is created** at the path above and seeded with exactly one book —
   *Welcome to Alcove ✎* ([`src/data/seed.ts`](src/data/seed.ts)) — which is a
   real book you can edit, rename or crumple like any other. It is also a worked
   example: every page of it is authored in Notebook Script.
2. **You are asked four questions about your taste** — how much colour you want,
   what kind of room, and so on — and the whole library is dressed from your
   answers, so what you see next is a room you chose rather than a demo.
3. **The guided tour runs**, <!--f:tourSteps-->21<!--/f--> steps in a long or a
   short version, each asking for one concrete action and turning green when it
   sees you do it. Skip it if you would rather poke at it yourself; *Settings →
   Help → replay the tour* starts it again later.
4. **The room is quiet until you touch it.** A fireplace bed is mixed low under
   everything by default, and the webview's autoplay policy holds it until your
   first click — so the app is never making noise at somebody who has not
   touched it yet. One switch turns it off for good.

What you land on is the shelf itself, which is where [A tour](#a-tour) picks up.

### Uninstalling

On Windows: Settings → Apps → Installed apps → Alcove → Uninstall, or run the
uninstaller in the install folder above. Elsewhere, remove the app the way you
installed it. Your library is not in that folder, so it survives either way. If
you want it gone as well, delete the library folder from the table above
afterwards — and take a `.nbk` bundle first if there is any chance you will want
it back.

### Building it yourself

Nothing is held back from the download — the installer above is the whole app.
But the source is here, and building your own copy is two commands on any of the
three platforms. They live in the developer half, under [Building and
releasing](#building-and-releasing), with the toolchain and
the artefact names.
<!-- /gen -->

<!-- gen:lift-tour -->
## A tour
<!--nav: The shelf, the spread, the page turn, the slash menu, the catalogue, the two studios, the switcher-->

Every picture below is a real capture of the running app, taken by the harness
in [`shots-now/`](shots-now/) — no mock-ups, no compositing. Each one is
there to prove the sentence above it.

| To do this | Do that |
| --- | --- |
| Move around the room | wheel **zooms**, shift+wheel pans, dragging bare wall moves the camera — and the two can be swapped in *Settings → Library & shelf* |
| Open a book | drag it out of its slot, or just click it for a quick pull |
| Go back | `Escape`, from anywhere in the app |
| Write | click any ruled line and type; clicking bare paper below your last line starts a line there |
| Reach for a block | `/` on an empty line, or right-click a block you have already written |
| Reach for a tool | the left rail inside a book, the left dock on the shelf. There is no top bar anywhere in the app |

If you would rather be shown than read, the guided tour does this walk inside
the app: <!--f:tourSteps-->21<!--/f--> steps in a long or a short version, each
asking for one concrete action and turning green when it sees you do it. It runs
on first launch, and *Settings → Help → replay the tour* starts it again
([`src/features/tutorial/steps.ts`](src/features/tutorial/steps.ts)).

### The shelf is the file browser

Books stand on floors of a bookcase, and the bookcase is the only file browser
there is: no tree, no list view, no "all notes". A floor is a shelf you can see
along, a slot is where a book stands, and the dashed outline at the end of a row
is the next free one.

![The Alcove shelf at 80% zoom: a dark walnut bookcase with a plain slab cornice, a chain of gilt rings running the length of every board and upright, and an ogee arch cut into the back of every recess, standing against cream wallpaper netted with a fine gold trellis. Three floors carry thirty-three books and no two spines are alike — cream label plates, gilt bands, raised cords, a green plate reading Field Notes, a leather one reading Sourdough, one book leaning against its neighbour — and a dashed outline with a plus in it marks the next free slot at the end of Floor 1. A fourth floor starts below them, empty. A cream dock on the left offers new book, template, studio, add floor and trash, its top button washed pale green; a zoom control reading 80% sits at the foot, and a moss-green settings seal in the bottom corner.](docs/readme/img/shelf.png)

Nothing here is a rectangle with a gradient on it: every spine is drawn from the
book's own seed through [`src/art/bookDesign.ts`](src/art/bookDesign.ts), baked
once to a texture and packed into an atlas. Floors you cannot see are not drawn,
so a case with three hundred books costs about what a case with three costs. The
camera, the virtualisation and the level-of-detail rules live in
[`src/features/bookshelf/`](src/features/bookshelf/) and are specified in
[`docs/design/bookshelf-rendering.md`](docs/design/bookshelf-rendering.md).

Right-clicking a spine gives you the book's own verbs — take it out, rename,
dress it, duplicate, move it along the shelf, send it to another bookcase, or
crumple it into the trash.

Pull back and the whole case is one object — <!--f:defaultFloors-->10<!--/f-->
floors as standard, up to <!--f:maxFloors-->60<!--/f--> when you keep pressing
*add floor*, and as many separate bookcases as you want to build.

![The same bookcase at 38% zoom, the whole width of it in frame now: the slab cornice, then seven complete floors and the top of an eighth running off the bottom of the window. Only the top three hold books; the rest are rows of empty ogee-arched recesses waiting to be filled, and the gold trellis wall runs away on both sides of the case, gone to a fine net at this size.](docs/readme/img/shelf-zoomout.png)

### A book opens as a spread, and turns like a book

Two pages side by side, ruled paper, a tool rail down the left edge, and a word
count at its foot. Arrow keys turn pages; so does dragging the outer edge or a
corner of a leaf, which lets you take the turn at your own speed and change your
mind halfway.

![The Welcome book open on its first spread, its title on a little tab above the covers. The left page carries "Welcome to Alcove" in a large handwriting face with a gold star beside it, a paragraph with an amber-highlighted phrase, a green callout, a four-item bulleted list, and a green banner reading "The rest of this book is a tour of what the paper can do." The right page is headed Writing and shows bold, italic, code, struck-out text, a yellow highlight and a blue-grey colour wash; three checkboxes, the last ticked and crossed through; a yellow sticky note with a curled corner; and a strip of pink striped washi tape. A vertical rail of hand-drawn tool icons runs down the left edge with a word count at its foot.](docs/readme/img/spread.png)

Mid-turn, the leaf lifts off the spread and you can see the next page under it:

![The same spread mid page-turn. The right leaf has peeled up along a diagonal and is curling back across itself, taking the Writing page and its yellow sticky note with it; through the gap the next page shows a ruled index card, a pink quote card with its closing quotation mark, and an amber envelope with the flap still open. The left page stays put.](docs/readme/img/page-turn.png)

At rest the pages are live DOM, so text stays selectable and crisp. The moment
you start a turn, the app swaps to a WebGL cylinder-curl shader fed by
pre-rasterised snapshots of the two pages, then swaps back. That trade — and the
CSS fallback used when WebGL is unavailable — is written up in
[`docs/design/page-flip.md`](docs/design/page-flip.md) and implemented in
[`src/flip/`](src/flip/).

### Writing: a slash menu, and a catalogue of everything

Press `/` on an empty line for the menu. There are
<!--f:slashCommands-->110<!--/f--> commands in it, in three sections — the blocks
(diagram starters among them), the stickers, and *turn into* for changing what
the current line already is. It is defined in
[`src/editor/slash/registry.ts`](src/editor/slash/registry.ts), and the fuzzy
filter ranks a title prefix above a word-start above a substring, so short
queries land where you expect.

![The slash menu open on the right-hand page of the Welcome book: a cream panel headed BLOCKS listing Text — plain handwritten paragraph, Heading 1 — big chapter title, Heading 2 — section heading, Heading 3 — small heading, Bullet list — simple dotted list, and Numbered list — 1, 2, 3…, each with a hand-lettered icon, Text highlighted at the top. The slash that opened it is still sitting on the ruled line below the panel.](docs/readme/img/slash.png)

If you would rather browse than type, the rail's **Catalogue** shows everything
the pages can hold, shelved by kind — paper and cards, text blocks, callouts,
diagrams, tape and trim, lettering, stickers — with a search box across the top
for when you already know the word.

![The Catalogue panel open down the left edge, pushing the spread to the right rather than covering it. A box reading "search the catalogue…" sits at the top, then eight filter chips — everything (selected), paper & cards, text blocks, callouts, diagrams, tape & trim, lettering, stickers. Below them, a three-column grid under "paper & cards — things stuck to the page" holds twenty labelled tiles: Sticky note, Polaroid, Washi box, Card, Quote card, Banner, Spoiler, Index card, Envelope, Stamp, Tag, Margin note, Pressed flower, Ticket stub, Postcard, Ledger, Photo corners, Wax seal, Map pin and Columns. A second grid, "text blocks — the ordinary furniture", gets as far as Text, Heading 1, Heading 2, Heading 3, Bullet list and Numbered list before running off the bottom of the panel.](docs/readme/img/catalogue.png)

The catalogue and the slash menu read the *same* registry, so a block that
exists in one is in the other. That was not always true, and the day it stopped
being true is the most instructive bug in the repo — see [Things that were
harder than they
look](docs/readme/part-2-developers.md#things-that-were-harder-than-they-look) in Part 2.

### The studios: this is how deep the customisation goes

The **library studio** dresses the room. A room preset sets the colours, the
carpentry and the paper together, and every one of those stays yours to change
afterwards.

![The library studio open down the left edge, pushing the shelf to the right rather than covering it. The panel is headed "Library studio" and has "this library" and "your own" tabs; under "bookcases" a card shows a little drawing of the current case, "My Library", "33 books · 10 floors" and rename, clone and delete buttons, then "add bookcase" and "add a floor" and a line reading "this bookcase has 10 floors. everything below is dressed here." Under "presets — the house room" is a grid of room thumbnails, each a tiny painting of that whole room — The House Room (selected, ringed amber), Gilt Salon, Card Room, Carnival and a teal one running off the bottom edge — beside a dashed tile reading "64 more…". To the right stands the dark walnut bookcase against its gold trellis wallpaper, with the new book / template / studio / add floor / trash dock between them, studio lit, and a zoom control reading 80% at the foot.](docs/readme/img/studio.png)

The **book studio** dresses one book, and only that book: a binding follows its
book into every room, which is what lets you recognise it after you have
repainted the walls.

![The "Customize this book" panel open down the left edge beside the spread, with three tabs — "this book" (selected), "this library" and "your own". A large preview shows the Welcome book's plum spine, divided into panels by raised cords, with gilt rules, striped headbands at head and tail, and a gold label plate carrying the title. Spine and cover toggles sit beneath it, then "binding — read to death", the current binding drawn standing on a walnut shelf tile, and a grid of seven alternative bindings ending in a dashed "182 more…" tile.](docs/readme/img/book-studio.png)

Both are covered properly under [Making it yours](#making-it-yours).

### Finding things

`Ctrl+K` opens the switcher. It jumps to books and headings by fuzzy match,
weighted by what you have opened recently, and `>` (or the Tab key, or the tab
at the top) flips it into full-text search across every page in every bookcase.
Activating a search result opens the book, turns to the page and pulses the
match so you can see where it was.

![The quick switcher open over a greyed-out spread: a cream sheet with "go to" (selected) and "search text" tabs, the prompt "jump to a book or heading… (> to search text)", and a list of books each tagged "book" down the right — Sea Glass lit at the top, then Recipes II, Old Letters, Mushrooms, House Plants, Film Diary, Knots, Latin, Reading Log, Wine Notes and Trail Notes running off the bottom — over a footer of key hints: ↑↓ move, enter open, tab mode, esc close.](docs/readme/img/quickswitch.png)

Search deliberately ignores which bookcase you are standing in front of. You
open it because something you wrote is somewhere, and the one thing you reliably
do not remember is which room it was in.

## Writing in a book
<!--nav: Every block a page can hold, the right-click menu, why pages never scroll, maths, diagrams, pictures, the rail end to end-->

### What a page can hold

Everything below is a real block type, reachable from the slash menu, the
catalogue or Notebook Script.

| | |
| --- | --- |
| **The ordinary furniture** | paragraphs, three heading levels, bullet and numbered lists, to-do lists with checkboxes, quotes, dividers, code blocks with syntax highlighting, tables |
| **Asides** | callouts (info, tip, warn, star), toggles that remember whether they were open, spoilers that hide an answer until clicked |
| **Paper and keepsakes** | sticky notes, polaroids, washi boxes, cards, quote cards, banners, index cards, envelopes, stamps, luggage tags, margin notes, postcards, ledgers, pressed flowers, ticket stubs, photo corners, wax seals, map pins |
| **Structure** | two or three columns, page links that list themselves back on the page they point at, footnotes |
| **Maths** | inline `$x^2$` and display equations |
| **Diagrams** | tree, mindmap, flowchart, graph, timeline |
| **Pictures** | paste or drop an image, image rows, link cards with a title and favicon |
| **Decoration** | <!--f:stickers-->50<!--/f--> stickers, and <!--f:effectAxes-->11<!--/f--> axes of block decoration carrying <!--f:effectValues-->472<!--/f--> values between them |

### The right-click menu

Right-click any block for the Notion-style context menu
([`src/editor/menu/registry.ts`](src/editor/menu/registry.ts)): **Turn into**,
**Color** for the ink, **Highlight** for the washes, **Columns**, **Effects**,
then insert above, insert below, duplicate, *copy block as script*, and delete.
Blocks can be dragged by the handle that appears in the margin, and dropping one
settles it into place rather than teleporting.

### Pages never scroll, and that is the point

A page is a fixed leaf of paper. When what you have written exceeds it, the
editor peels the trailing blocks off the end and hands them to the next page,
creating one if there isn't one — and it carries your caret across the break, so
you can keep typing straight through the join without noticing you crossed it.
Deleting from a full page pulls the blocks back.

It would be easier to put a scrollbar in a page. The reason there isn't one:

- **A page you can see all of is a page you can find things on.** A book of
  fifty short pages is navigable — thumbnails, a table of contents, a page
  number, a spread you can take in at a glance. One page of infinite length is a
  rope you have to pull.
- **The turn means something.** A page turn is a real boundary, and a
  page-curl animation over a scrolling div would be decoration. Here it moves
  you a real distance.
- **Footnotes can be at the foot of the page**, because there is a foot.
- **A blank page can be deliberate.** Leave one empty and it stays empty.

The contract lives in [`src/editor/pagination.ts`](src/editor/pagination.ts),
where the arithmetic is DOM-free and unit-tested, and it is the rule the rest of
the editor is built around: a footnote's text is stored *on the marker* rather
than in a table at the page level, precisely so that a footnote which flows to
the next page arrives with its note already attached
([`src/editor/nodes/footnote.ts`](src/editor/nodes/footnote.ts)).

Focus mode is a ladder rather than a switch
([`src/views/rail/focusLevels.ts`](src/views/rail/focusLevels.ts)): off, then
the chrome goes, then the book goes and leaves two bare leaves, then one leaf
alone edge to edge. There is a zoom on top of it, and it is a transform rather
than a bigger box — deliberately, because growing the leaf would change how much
fits on a page and repaginate your book behind your back.

### Maths, without a webfont

`$x^2$` inline, or an equation block on its own line. The renderer is a
documented TeX subset written for this app
([`src/editor/nodes/mathTex.ts`](src/editor/nodes/mathTex.ts)) — superscripts and
subscripts, `\frac`, `\sqrt`, big operators with limits, delimiters that grow,
the Greek alphabet and the usual relations and arrows, upright function names,
`\text{}` — rendered as plain HTML in the page's own serif face rather than
through KaTeX's Computer Modern.

It does not do matrices, alignment, cases or arrays, and says so: those are
documents rather than afterthoughts, and half a matrix renderer is worse than
none. Like the script parser, it never throws — an unknown macro renders as its
own name in a muted colour and you keep typing.

### Diagrams

<!--f:scriptDiagrams-->5<!--/f--> kinds, drawn rather than embedded: **tree**,
**mindmap**, **flowchart**, **graph** and **timeline**. Each arrives from the
slash menu with a small worked example already in it, and each is edited as a
few lines of text — the layout algorithms and the hand-drawn SVG renderers are
in [`src/diagrams/`](src/diagrams/).

![A later spread of the Welcome book. The left page runs from a note about resizing a picture into "Two up, and things that fold" — two columns of text side by side, a closed fold reading "A fold. Click it.", and a spoiler reading "psst… click to reveal" with its answer still hidden under a solid tan bar — and ends on the heading "Diagrams, drawn by hand". The right page carries a hand-drawn tree: Alcove branching to A library and A book, A library on to Bookcases and Floors, A book on to a wider Pages box captioned "this thing you are reading". Below it the heading "Arrows" and a three-step flowchart running downward — Write, edge labelled "wherever", Decorate, edge labelled "eventually", Turn.](docs/readme/img/diagrams.png)

### Pictures and links

Paste or drop an image and it is stored under your library's `assets/` folder
and inserted; several at once become an image row. Paste a bare URL on an
empty line and you get a link card, which fills itself in with the page's title,
description and favicon a moment later, and degrades to a plain link chip if the
site does not answer. Those two moments are the only times the app reaches the
internet at all, they only happen because you asked, and neither of them sends
anything you wrote.

Pages can also point at each other: type `[[` for the page picker, and the page
you pointed at lists yours back at the bottom
([`src/editor/backlinks/`](src/editor/backlinks/)).

### The rail, end to end

Ten hand-drawn icons, each with its own tooltip. The first six open a panel; a
divider, then the four that just do something.

| Tool | What it opens |
| --- | --- |
| Customize this book | the book studio — binding, cover, ribbon, paper |
| Page style | ruled, grid, dotted or blank, plus the line spacing |
| Catalogue | everything you can put on a page, browsable and searchable |
| Table of contents | every heading in the book, click to jump |
| Page history | the autosave snapshots of this page, with a one-line preview each |
| **In and out** | the one sheet where writing enters and leaves — see below |
| Ribbon this page | marks the page in one press, and opens the ribbon plate to choose which ribbon |
| Focus mode | the rungs of the ladder, and the zoom |
| Thumbnails | the strip of little pages along the bottom |
| Add a page | a new page after this one |

**In and out** is one sheet rather than four rail buttons, because "get this
page out of the app" and "get these files into it" are one errand and a reader
who has to look in three places for them concludes the app cannot do it
([`src/views/rail/SharePanel.tsx`](src/views/rail/SharePanel.tsx)):

| | |
| --- | --- |
| **Bring something in** | paste a script · bring Markdown in · start from a template |
| **Take this page, or this book, out** | export as PDF · this page as a picture · the parcel desk, for whole bundles |
| **For an assistant** | copy the format for your AI · copy this page as script |

Every row carries its own key cap, read from your own keymap rather than
printed, and calls exactly the same opener the keyboard calls — so a button and
its shortcut cannot drift apart.

Page history deserves a note: it is a ring of recent autosave snapshots merged
with the persisted tail, newest first, each labelled *3:41 pm · Jul 30* with a
line of its own ink for a preview
([`src/editor/history/pageHistory.ts`](src/editor/history/pageHistory.ts)). It is
not version control, and it is not a substitute for the backups below — it is
for the ten seconds after you realise you have just wrecked a page.

### The daily page, and templates

`/today` finds or creates today's dated page in your Journal book
([`src/editor/journal.ts`](src/editor/journal.ts)).

There are <!--f:templates-->5<!--/f--> built-in templates — Cornell notes,
Lecture notes, Flashcard deck, Weekly planner, Reading log — and each is authored
as Notebook Script ([`src/features/templates/templates.ts`](src/features/templates/templates.ts)),
so the gallery preview, the inserted pages and the script it copies back out
about what a template is. The gallery is the *template* button on the shelf's
left dock, and the same entry sits on the bare-plank right-click menu, because
a template is a way of starting a book rather than a thing you do to one.
<!-- /gen -->

<!-- gen:lift-manual -->
## Notebook Script
<!--nav: The language itself — a whole worked script, the page it makes, and everything it can say-->

The language behind [Written with an AI](#written-with-an-ai) above: a Markdown
dialect small enough that a chatbot writes it correctly on the first try, and
expressive enough to produce a decorated page rather than a wall of paragraphs.
Plain Markdown is a subset of it, so you can write it yourself and never learn a
directive.

### A whole script, and the page it makes

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

The paste box previews as you paste, naming each piece it recognised — one
sticky note, a graph of four edges, a timeline of three entries — so you can see
the shape of the result before you commit it:

![The Insert script dialog over a dimmed book called Field Notes, subtitled "paste Notebook Script — from your AI, or your own pen". On the left the pasted script in a monospace box, scrolled to the sticky-note directive and the graph and timeline fences. On the right a live preview headed FIELD NOTES — WEEK 3: the Photosynthesis heading, the paragraph with its amber highlight, a yellow sticky-note block tagged "sticky-note", and two hatched placeholder cards tagged "graph" and "timeline" reading "4 edges" and "3 entries". "Copy spec for your AI" sits at the bottom left, Cancel and Insert at the bottom right.](docs/readme/img/script-dialog.png)

Insert, and it lands on the page as real editable blocks — the diagrams drawn,
not embedded as images:

![The left-hand page after inserting, on grid paper: "Photosynthesis" in large handwriting with a leaf sticker, the paragraph with "light-dependent" in an amber highlight, a tilted yellow sticky note with a curled corner reading "Exam Friday — learn both stages.", then a hand-drawn node graph — Sun by an edge labelled "light" and Water both flowing into Leaf, Leaf out to an amber-filled Glucose and to Oxygen — and below it a timeline of three cards stepping down a vertical spine: 1771 Priestley, 1779 Ingenhousz, 1845 Mayer. The right-hand page is still blank.](docs/readme/img/script-page.png)

### What the language has

- **Frontmatter** — the page's paper, ink and edge wash, set once at the top.
- **<!--f:scriptContainers-->24<!--/f--> containers** — sticky notes, polaroids,
  callouts, columns, index cards, envelopes, stamps, luggage tags, marginalia,
  pressed flowers, ticket stubs, postcards, ledgers, photo corners, wax seals,
  map pins, toggles — reachable under
  <!--f:scriptContainerAliases-->87<!--/f--> spellings, so `::: note`,
  `::: postit` and `::: Sticky Note` are all the same thing and nobody has to
  learn which one is canonical.
- **<!--f:scriptAttrKeys-->28<!--/f--> attribute keys** for decorating any block
  or span: `color`, `sticker`, `tape`, `washi`, `rotate`, `paper`, `shadow`,
  `underline`, `frame`, `font`, `ink`, `size`, `align`, `title`, `caption` and
  the rest.
- **<!--f:scriptDiagrams-->5<!--/f--> diagram fences** — `tree`, `mindmap`,
  `graph`, `flowchart`, `timeline` — each with a grammar you could teach someone
  in a sentence. A ` ```mermaid ` fence is accepted as a compatibility ramp and
  warned about.
- **`::let` variables and `::style` reusable decoration**, for notes that repeat
  themselves.
- **`::fetch` and `fetch:` lines** that ask the app to find and cache a picture
  for a query. This is the one construct that goes to the network, and it is
  openly-licensed images only.

### It does not fail

`parse()` is **total**: it never throws. A malformed line produces a diagnostic
naming the line, the column and what was expected, and the app renders your
intent anyway — near-miss spellings like `papper` and `microscop` are corrected
with a warning rather than dropped. That promise, and the grammar it guards, are
specified in [`docs/design/script-language.md`](docs/design/script-language.md)
and implemented in [`src/script/`](src/script/).

The script is kept alongside the page, so a note written this way can be edited
as script and re-run, or copied back out with *copy this page as script*. A
single block comes out the same way from the right-click menu.

## Making it yours
<!--nav: The two studios, every vocabulary counted, custom colours, stars and hiding, more bookcases, your own packs-->

### Two studios, and what each one owns

The **library studio** dresses the room you are standing in: its colours, its
carpentry, its wallpaper, its floors, and the collection of bookcases. The
**book studio** dresses one book: its binding, its cover, its ribbon, its paper.

The split is deliberate and worth knowing, because it is what makes the
customisation survivable. A binding belongs to the book, so a book you bound in
oxblood leather is oxblood leather in every room — repaint the walls and you can
still find it. Repainting a room does not straighten its arches; rebuilding a
case does not repaint it.

A **room preset** is not the same thing as a colour theme. A preset bundles
colour *and* carpentry *and* paper into one named room; a theme is only the
colour half. Pick a preset to get somewhere good in one click, then change any
part of it without losing the rest.

### Counted from the modules themselves, not estimated

| What you choose | How many | Where it is defined |
| --- | --- | --- |
| Rooms (colours + carpentry + paper, as one pick) | **<!--f:roomPresets-->69<!--/f-->**, sorted by the kind of room they are | [`src/views/rail/designOptions.ts`](src/views/rail/designOptions.ts) |
| Colour schemes on their own | **<!--f:roomThemes-->60<!--/f-->** | [`src/art/themes.ts`](src/art/themes.ts) |
| Bookcase carpentry | **<!--f:shelfBuilds-->52<!--/f-->** builds × **<!--f:shelfPatterns-->50<!--/f-->** timber patterns, **<!--f:shelfPresets-->113<!--/f-->** named | [`src/art/shelfDesign.ts`](src/art/shelfDesign.ts) |
| Wallpaper | **<!--f:wallpaperMotifs-->50<!--/f-->** motifs, each with its own scale, relief, ink, tone and edge — **<!--f:wallpaperPapers-->126<!--/f-->** combinations named and hung | [`src/art/wallpaperDesign.ts`](src/art/wallpaperDesign.ts) |
| Book bindings | **<!--f:bookShapes-->50<!--/f-->** spine shapes × **<!--f:bookMaterials-->50<!--/f-->** materials × **<!--f:bookDecorations-->50<!--/f-->** decorations, **<!--f:bookPresets-->189<!--/f-->** named | [`src/art/bookDesign.ts`](src/art/bookDesign.ts) |
| Book cloths | **<!--f:bookCloths-->50<!--/f-->** pigments, each with a name that means something | [`src/art/flat.ts`](src/art/flat.ts) |
| Book covers | **<!--f:coverPigments-->50<!--/f-->** pigments, **<!--f:coverFrames-->50<!--/f-->** frames, **<!--f:coverMedallions-->50<!--/f-->** medallions | [`src/art/covers.ts`](src/art/covers.ts) |
| Bookmark ribbons | cloth × weight × tail × material × charm, **<!--f:ribbonPresets-->40<!--/f-->** named | [`src/views/bookmarks.ts`](src/views/bookmarks.ts) |
| Block decoration | **<!--f:effectAxes-->11<!--/f-->** axes, **<!--f:effectValues-->472<!--/f-->** values, applicable to **<!--f:blockEffectTypes-->35<!--/f-->** kinds of block | [`src/editor/effects/vocabulary.ts`](src/editor/effects/vocabulary.ts) |
| Stickers | **<!--f:stickers-->50<!--/f-->**, grouped by family, plus your own | [`src/editor/nodes/stickers.ts`](src/editor/nodes/stickers.ts) |
| Sound sets | **<!--f:soundSets-->28<!--/f-->**, voicing **<!--f:soundCues-->66<!--/f-->** cues | [`src/sound/soundSets.ts`](src/sound/soundSets.ts) |
| Ambience beds | **<!--f:ambienceBeds-->10<!--/f-->**, plus silence | [`src/sound/engine.ts`](src/sound/engine.ts) |
| Settings | **<!--f:settingsOptions-->40<!--/f-->**, across appearance, library & shelf, motion & feel, sound, writing, system, library files and help | [`src/data/defaults.ts`](src/data/defaults.ts) |

Two smaller choices sit in *Settings → Appearance* rather than in a studio: the
**pointer** — the app draws its own, in a set you pick, and hands the system one
back on its own under Windows High Contrast, where a drawn cursor is the wrong
answer — and the **nib** you write with.

### A colour of your own

Every colour chooser also takes a hex code. A vocabulary is the right shape for
browsing and the wrong shape for someone who already knows what they want, and
there is no number of curated colours that contains yours.

Committed colours are remembered and shared across every picker in the app
([`src/art/customColour.ts`](src/art/customColour.ts)), so a green you mixed for
a callout can bind a book. A half-typed hex is never overwritten with a default
while you are still typing it.

### Stars, and taking things off a list

Every long list in the studios — rooms, carpentries, papers, bindings, sound
sets — carries the same two gestures
([`src/data/shelfOfMine.ts`](src/data/shelfOfMine.ts)):

- **Stars.** One star pins an entry to the top of its own family; two lift it
  clear of the families to the top of the whole list.
- **Hide.** Take an entry off the list and the app stops offering it and stops
  rolling it at random. Nothing is destroyed: a restore drawer hands it back
  whenever you ask, with checkboxes.

A room you compose yourself can be saved, and a saved room is starrable and
hideable like any shipped one. Removing one is exactly as undoable as removing
anything else.

### More bookcases

A library is a collection of bookcases ([`src/data/bookcases.ts`](src/data/bookcases.ts)).
Each has its own name, its own room, its own floors and its own books, and each
is dressed independently — one case can be a green Athenaeum and the next a pale
card room. Books move between them from the spine's right-click menu. Search and
the `Ctrl+K` switcher deliberately span all of them.

### Bringing in your own work

The studios have a **your designs** section that takes packs you or a chatbot
made ([`src/features/packs/`](src/features/packs/)), in
<!--f:packCategories-->4<!--/f--> categories:

| Category | What you bring |
| --- | --- |
| Wallpaper | a recipe — motif, scale, relief, ink, tone and edge, out of the vocabulary the app already draws |
| Carpentry | a recipe — a build and a timber pattern |
| Stickers | actual SVG or PNG files |
| Sounds | actual audio files, mapped onto the cues you want to replace |

The dialog carries three things: an upload button, numbered instructions with no
model involved, and a **generated** AI prompt describing the exact format the
importer accepts. The prompt is derived from the schema rather than written by
hand, because a hand-written prompt describing a format the importer refuses is
worse than no prompt at all. There is a paste box beside the file button, since
JSON handed to you in a chat window is already on your clipboard. A refusal is a
list of problems with places and sentences, shown in the card where you can read
it twice — not a toast that is gone before you have finished reading it.

Wallpaper and carpentry are recipes rather than pictures for a stated reason:
the wall is one tile repeated across the widest surface on screen, seamless
because the app draws the tile, and an uploaded picture would show its join at
exactly the place you look at all day.

<!--f:packRefusals-->5<!--/f--> other categories are listed as **not** importable,
each with the reason ([`src/features/packs/categories.ts`](src/features/packs/categories.ts)) —
wall pictures, block effects, book bindings and fonts are drawing code or
bundled assets rather than data, and custom cursors are a "not yet" rather than a
"no". A list of what you cannot bring is worth more than silence about it.

Custom stickers and custom sound sets have their own routes as well:
[`userStickers.ts`](src/features/templates/userStickers.ts) imports PNG or SVG
files and registers them as `user:<name>`, usable from the palette *and* from
`{sticker=user:<name>}` in script; a sound set of your own
([`src/sound/userSoundSets.ts`](src/sound/userSoundSets.ts)) is a shipped set
plus your overrides, so a single recording gives you a working set instead of a
project — every role you did not fill is still voiced exactly as it was.

### The trash

Crumpled books go to one drawer for the whole library, not one per bookcase —
the same reasoning as [search](#finding-things), applied to the moment you
notice something is gone
([`src/features/bookshelf/TrashPanel.tsx`](src/features/bookshelf/TrashPanel.tsx)).
Every row is labelled with the bookcase it came from, restore puts the book back
where it stood, and *empty* counts what it is about to shred and names the scope
before it does. There is a scope toggle when you have more than one case.

### Favourites

Pin a book from its right-click menu and it gets a star charm on the spine, and
sorts first when *Settings → Library & shelf* is set to sort by favourites.

## Sound
<!--nav: Sound sets, ambience beds, the volume model, and the in-app credits-->

Every interaction has a sound, and the whole set can be re-voiced.

A **sound set** is a named character every cue in the app is heard through — the
button, the panel, the checkbox, the page turn, the book coming off the shelf,
the crumple, the keystroke, the bell. There are
<!--f:soundSets-->28<!--/f--> of them, grouped by character — the house voicing
and its near neighbours, then paper, library, chamber, studio, hush and
whimsy — between them voicing <!--f:soundCues-->66<!--/f--> cues.

A set adds no new recordings. It conditions the ones that ship — substituting
which family voices a role, changing playback rate, trimming gain, layering a
second quieter cue underneath, drawing from a different pool of takes, scaling
the per-play wobble, and on a few of them a real filter chain. That is why
"as if it were all happening in the next room" is a set rather than a promise.

Underneath the cues there is an **ambience bed**:
<!--f:ambienceBeds-->10<!--/f--> of them — rain, storm, fireplace, crickets,
night, wind, stream, forest, shore, café — plus silence. A new install opens on
the fireplace, mixed low under the master volume, and the webview's autoplay
policy holds it until your first click, so the app is never making noise at
somebody who has not touched it yet. One switch turns it off; reduced sound and
mute both win over it.

There are separate volume sliders for interface, pages, shelf and ambience, a
*reduced sound* mode that drops the hover ticks and the typing sounds, an
optional typing sound, and an optional hourly chime.

**Credits.** Nothing you hear is synthesised: every cue is a real recording,
almost all of them public domain or CC0, with one CC BY 4.0 source among them.
You do not have to take that on trust or go looking for a text file — *Settings
→ Sound → sound credits* lists every recording, its author and its licence, and
that list is rebuilt on every build from the same table the audio itself plays
from. The full provenance is in
[Licence and credits](#licence-and-credits) and in
[`docs/design/sound.md`](docs/design/sound.md).

## The keyboard
<!--nav: Every shortcut, grouped by where you are standing, and which ones you can rebind-->

Every shortcut in the app is in one registry
([`src/data/keybindings.ts`](src/data/keybindings.ts)), and that registry is what
draws the settings list, what draws the cheat sheet (`Ctrl+/`, or just `?` when
you are not typing) and what the one key handler matches on — so the list cannot
promise a key the app does not answer to.

**<!--f:rebindableKeys-->24<!--/f--> of them are rebindable**, from *Settings →
Input*. `Escape` deliberately is not: it is how you step back out of a book and
how every panel and dialog closes, and one key doing one thing everywhere is
worth more than that row being adjustable — the app says so in the row rather
than greying it out.

| Where you are | Keys |
| --- | --- |
| Anywhere | `Ctrl+K` jump to a book, heading or page · `Ctrl+Shift+F` search the words inside every page · `Ctrl+,` settings · `Ctrl+/` or `?` the cheat sheet · `Escape` back out |
| On the shelf | `Ctrl+Alt+N` new book · `Ctrl+Alt+S` the studio · `Ctrl+Alt+F` add a floor · `Ctrl+Alt+X` the trash · `+` `−` `0` zoom · arrows walk the shelf · `Enter` take the lit book · `Home` back to the first book |
| In a book | `Ctrl+N` add a page · `Ctrl+Alt+B` ribbon this page · `F9` focus mode · `Ctrl+Alt+T` contents · `Ctrl+Alt+A` catalogue · `Ctrl+Alt+L` page style · `Ctrl+Alt+D` dress this book · `Ctrl+Alt+M` thumbnails · `←` `→` turn the page · `[` `]` step focus · drag a page edge to curl it |
| While writing | `/` the block menu · `/today` today's journal page · `Ctrl+B` `Ctrl+I` bold and italic · right-click for the block menu · drag the dots to reorder · click bare paper to start a line there |
| In and out | `Ctrl+Alt+I` paste a script in · `Ctrl+Alt+E` copy this page out as script · `Ctrl+Alt+G` start from a template · `Ctrl+Alt+P` export as PDF · `Ctrl+Shift+Alt+P` this page as a picture · `Ctrl+Shift+Alt+M` bring Markdown in · `Ctrl+Shift+E` pack books into one file · `Ctrl+Shift+I` add a bundle to this shelf |

Everything the app added for itself sits on `Ctrl+Alt`, which is the one
modifier pair neither the editor nor the webview had already claimed. A key with
no live command is left completely alone — which is why the shelf's bare `+`,
`−` and `0` and the editor's letters still work with the global handler
installed.

## Backups, export and import
<!--nav: Scheduled backups, `.nbk` bundles, Markdown in and out, PDF and PNG, tray capture-->

Your library is a file on your disk and nothing is copying it anywhere. What
follows exists so that this is a design decision rather than a risk.

### Scheduled backups

On by default, weekly, into the `backups/` folder beside your library or a
folder you choose
([`src/features/system/backup.ts`](src/features/system/backup.ts)). A
backup is a timestamped ZIP of the database — including its write-ahead sidecars,
so a WAL-mode database restores intact — and the whole `assets/` tree.

Restoring takes a safety copy of the *current* state first, then extracts over
the live files, and validates every entry name on the way out of the archive so
a hand-edited ZIP cannot write outside the two places it is allowed to.

### Bundles you can move (`.nbk`)

The **parcel desk** — the rail's *In and out* sheet, *Settings → Library files*,
or `Ctrl+Shift+E` — packs books into a single
`.nbk` file ([`src/features/transfer/`](src/features/transfer/)). You choose the
scope — the whole library, one bookcase, one floor, or a hand-picked selection —
and whether to include pictures, cover styling, the library theme and the
lossless document JSON.

Inside, a bundle is a plain ZIP: a manifest with a checksum, one Notebook Script
file per page, the lossless JSON beside it, the assets, and a snapshot of the
bookcases the books stood in — their names, heights and rooms — so importing a
library rebuilds the furniture it came from rather than tipping every book onto
one shelf ([`format.ts`](src/features/transfer/format.ts)).

**Import is additive.** Nothing is overwritten. When a book in the bundle
matches one you already have, you get a row-by-row conflict decision rather than
a single scary prompt, and the whole import is undoable from a **restore
point**, kept under a retention window you choose — by age, by count, or forever
([`restore.ts`](src/features/transfer/restore.ts)).

### Plain Markdown, in and out

Export the same scope as Markdown instead of a bundle and you get ordinary `.md`
files with no directives in them, one per page or one per book. In the other
direction, `.md`, `.markdown` and `.txt` files are read as Notebook Script —
which plain Markdown is a subset of — and become one new book per file, one page
per H1, with long headingless walls of text split by capacity. The file reader
handles UTF-16 and BOMs, because Windows Notepad happily writes both
([`src-tauri/src/import.rs`](src-tauri/src/import.rs)).

### PDF and PNG

A page can be rasterised at double resolution and saved as a PNG, or wrapped as
a one-page PDF; a whole book renders every page offscreen — no caret, no
selection chrome — and assembles into one PDF
([`src/editor/script/exporters/`](src/editor/script/exporters/)).

Both live on the rail's **In and out** sheet, beside the Markdown import and the
parcel desk.

### Two more small things

**Tray quick capture** puts an icon in the notification area whose *Quick note*
action opens an `Inbox` book — created on demand — for one thought, without
hunting for the window ([`src/features/system/tray.ts`](src/features/system/tray.ts)).
Off by default; the app does not sit in your tray unless you ask it to.

**Launch into the last book** skips the shelf on startup and puts you back where
you were ([`src/features/system/launch.ts`](src/features/system/launch.ts)). Also
off by default.

## Questions
<!--nav: Where the data is, whether it is offline, moving machines, and the failure modes worth naming-->

**Where is my data?**
In the library folder from [the table above](#where-your-writing-lives) —
`%APPDATA%\com.alcove.app\` on Windows. Everything you have written is in
`notebook.db`, pictures are under `assets/` and backups under `backups/`. Copy
that folder and you have copied your library. And if you would rather hold your
writing as plain files, the parcel desk exports every page as ordinary Markdown,
which any editor on any machine can read without Alcove installed at all.

**Is it offline?**
Yes. No account, no sync, no cloud, and nothing anywhere reporting back on what
you write or how you use it. Two things go out to the internet and only in the
moment you ask for them: finding an openly-licensed picture, and filling in the
card for a link you pasted. Neither one sends anything off your page. How that
is enforced, rather than merely intended, is in [the developer
half](#how-its-built).

**How do I move my library to another machine?**
Two ways. Copy the whole library folder with the app closed — that is
everything, database and pictures and backups, and it moves between platforms
unchanged. Or take a `.nbk` bundle from the parcel desk and import it on the
other side, which is the better option when the other machine already has notes
on it, because import is additive and never overwrites.

**Does uninstalling delete my notes?**
No. The program and the library are two separate folders and the uninstaller
only removes the first. If you want the library gone too, delete it yourself —
it is the second row of [the table above](#where-your-writing-lives).

**Half my page just moved to the next page.**
That is the pagination contract working. A page is a fixed height and the
trailing blocks flow onward when it fills; deleting from a full page pulls them
back. See [Pages never scroll](#pages-never-scroll-and-that-is-the-point).

**The books look low-resolution and the shelf feels flat.**
The app probes for a software rasteriser at startup and drops into a reduced
mode when it finds one ([`src/features/bookshelf/env.ts`](src/features/bookshelf/env.ts)) —
usually a virtual machine, a remote desktop session, or a driver that has fallen
back to software rendering. Updating the graphics driver is the usual fix.

**It won't start.**
On Windows the most likely cause is a missing WebView2 runtime on an old
Windows 10 install. The installer fetches it, but a blocked download leaves you
with a window that never paints; installing the Microsoft Edge WebView2
Evergreen Runtime by hand fixes it. On Linux the equivalent is a missing
`webkit2gtk` — install it from your own package manager.

**The ambience does not play until I click.**
Browser autoplay policy, and the app leans on it rather than working around it —
see [Sound](#sound). One click anywhere releases the bed.

**Can I use it on my phone, or in a browser?**
No. The shelf assumes a pointer, a scroll wheel and a desktop-sized window.
There is a browser development build, but it is a harness for the test suite
rather than a product.

**Is there a plugin API?**
No. The design packs above are the extension route for art and sound; anything
else means editing the vocabularies, which [Adding a value, end to
end](docs/readme/part-2-developers.md#adding-a-value-end-to-end) walks through stop by stop.
<!-- /gen -->

# Part 2 — Building Alcove
<!--nav: for a developer, or for an AI agent helping one. Nothing below is needed to use the app.-->

**Nothing below this line is needed to use Alcove.** Everything from here down is
for somebody changing the code — a developer, or an AI agent working on their
behalf — and it is where the facts a README usually opens with have been put
instead: the storage model, the two outbound calls, what runs in which process.
It is the developer half's essentials: how the app draws itself three different
ways at once, what it is made of and why, how to get it running, where
everything lives, and how a release is cut.

The parts that only matter once you are editing a particular corner of it — the
art pipeline, the vocabularies, the editor, the flip, the parser, the data
layer, the gates, and the failure modes this codebase has actually shipped —
stay in [Part 2](docs/readme/part-2-developers.md) and are listed under
[Deeper reading](#deeper-reading).

<!-- gen:lift-build -->
## How it's built
<!--nav: The three ways the app draws itself, what runs in which execution context, and the stack table with a reason per row-->

Alcove is a [Tauri 2](https://tauri.app/) app: a Rust host process, a system
webview window, and a [SolidJS](https://www.solidjs.com/) frontend built by
Vite. Almost everything interesting happens in the frontend. The Rust side is
<!--f:rustCommands-->14<!--/f--> commands — image assets, link previews, backups,
tray, PDF export, markdown import, bundle read/write — plus the SQLite
migrations, in <!--f:rustFiles-->8<!--/f--> files and
<!--f:rustLines-->2302<!--/f--> lines.

### The shape of the thing, in four facts

These are the constraints every decision below is downstream of. They are stated
here rather than at the top of the front page on purpose: a reader deciding
whether to install a notes app does not need the storage model first, and the
one who does need it is you.

- **One SQLite file, on the reader's own disk.** `notebook.db` in the app data
  directory, opened through `tauri-plugin-sql`, with `assets/` beside it for
  pictures and `backups/` for the scheduled ZIPs. There is no server half of
  this app to write.
- **No account, no sync, no telemetry.** `telemetry` is typed as the literal
  `false` in [`src/data/types.ts`](src/data/types.ts), so it is not a
  setting somebody can flip — it is a type error to try. Adding a network
  dependency to a feature is therefore an architectural change, not a
  convenience.
- **Exactly two outbound calls, both reader-initiated.** Searching for an
  openly-licensed picture (`::fetch`) and previewing a pasted link. Both go
  through an SSRF guard that is written twice on purpose —
  [`src-tauri/src/media.rs`](src-tauri/src/media.rs) is the real one and
  [`src/editor/media/urlGuard.ts`](src/editor/media/urlGuard.ts) mirrors
  it — https only, private and loopback addresses refused, fast timeouts, capped
  body size.
- **The webview is the OS's, not ours.** That is what makes the installer about
  sixteen megabytes rather than ten times that, and it is also why the app
  inherits the platform's autoplay policy, its IME and its font stack rather
  than choosing them.

What makes the frontend unusual is that it draws itself three different ways at
once, and the three have to agree on what a page looks like.

```mermaid
flowchart TD
    S["Solid state — stores and signals<br/><i>src/state, src/data</i>"]
    DB[("SQLite<br/>tauri-plugin-sql")]
    DB --- S

    S --> W["<b>1. The shelf</b><br/>PixiJS v8, one WebGL canvas<br/><i>features/bookshelf/world.ts</i>"]
    S --> D["<b>2. The spread</b><br/>live DOM, one TipTap editor per page<br/><i>views/BookView.tsx</i>"]

    A["flat drawing vocabulary<br/><i>art/flat.ts + art/flatShelf.ts</i>"] --> B["memoised rasters<br/><i>art/bake.ts</i>"]
    B --> W

    D -. "html-to-image, during idle" .-> R["ImageBitmap snapshots<br/><i>flip/rasterCache.ts</i>"]
    R --> C["<b>3. The flip</b><br/>WebGL cylinder-curl shader<br/><i>flip/curl.ts</i>"]
    D -- "pointerdown on a page edge" --> C
    C -. "lands flat, hands back" .-> D
```

**1. The shelf is a single WebGL canvas.** Every bookcase, spine, plaque and wall
is a Pixi sprite whose texture was drawn once into an `OffscreenCanvas` and kept.
The camera works in log-zoom space, floors outside the viewport are pooled and
recycled, and there are three LOD tiers with hysteresis so the tier cannot flicker
at a threshold ([`lod.ts`](src/features/bookshelf/lod.ts): tier 0 above zoom 0.7,
tier 1 down to 0.22, and below that whole floors collapse into a cached
render-texture stamp). The loop is render-on-demand — a settled shelf issues no
draw calls at all. Solid never diffs Pixi: components talk to the world through a
small callback surface and the world mutates its own non-reactive objects.
Rationale and the eliminated alternatives are in
[`docs/design/bookshelf-rendering.md`](docs/design/bookshelf-rendering.md).

**2. The opened book is ordinary DOM.** A two-page spread, one TipTap editor per
page, real contenteditable with a real caret and real IME. This is the reason the
flip is *not* implemented by a page-flip library: every candidate wants the pages
to be its own content, and a Notion-grade block editor cannot live inside
something that forwards clicks to `<a>` and `<button>`.

**3. The flip is a shader that borrows the DOM's pixels.** During idle time,
[`rasterCache.ts`](src/flip/rasterCache.ts) captures each page to an `ImageBitmap`
with `html-to-image` (pixel ratio capped at 2, or 1.5 when `deviceMemory` is under
8 GB; LRU of six; font-embed CSS computed once because it is the dominant
per-capture cost). On pointerdown the GL overlay appears in the same frame,
because the texture already exists. When the page lands flat, live DOM comes back.
A page may knowingly flip with a snapshot up to 300 ms stale — text is unreadable
mid-curl, and the landing swaps to the real thing.
[`docs/design/page-flip.md`](docs/design/page-flip.md) has the model.

### What runs where

Four execution contexts, and knowing which one you are in answers most "why can't
I just…" questions.

```mermaid
flowchart LR
    subgraph rust["Rust host process"]
        LIB["lib.rs — commands + migrations"]
        SQL[("notebook.db")]
        MEDIA["media.rs · backup.rs · tray.rs<br/>export.rs · import.rs · transfer.rs"]
        LIB --- SQL
        LIB --- MEDIA
    end
    subgraph webview["WebView2 — the app"]
        MAIN["main thread<br/>Solid · Pixi · TipTap · GSAP"]
        WORKER["art worker pool<br/>features/bookshelf/artWorker.ts"]
        GPU["GPU<br/>shelf canvas + curl canvas"]
        MAIN -- "ArtJob — plain data" --> WORKER
        WORKER -. "ImageBitmap, transferred" .-> MAIN
        MAIN --> GPU
    end
    MAIN -- "invoke" --> LIB
    LIB -. "rows and bytes" .-> MAIN
```

| Context | What lives there | The constraint it imposes |
|---|---|---|
| **Rust host** | SQLite and its migrations, the filesystem, the tray, the SSRF-guarded image fetcher, the PDF writer's file half, bundle read/write. | Everything crosses `invoke` and is therefore async and structured-clone-shaped. A command is the *only* way to touch a path outside the asset scope. |
| **Main thread** | All Solid state, all Pixi objects, every TipTap editor, GSAP timelines, the curl renderer. | It also runs the compositor for a contenteditable. A long task here is a frozen window, which is the whole reason the next row exists. |
| **Art workers** | Spine painting only. A pool sized from `hardwareConcurrency − 1`, capped at three ([`artOffload.ts`](src/features/bookshelf/artOffload.ts)). | Jobs are plain data, results are transferred `ImageBitmap`s (zero-copy). **Failure is never fatal** — no `Worker`, no `OffscreenCanvas`, a dead bundle or a timed-out job all resolve to `null` and the main thread draws the spine itself. |
| **GPU** | The shelf's sprite batches; the curl mesh and its ground pass. | No live SVG filters, no blend modes, no post-processing. The curl context carries a depth buffer, which is not decoration — see *the turning page had a shadow that wasn't drawn* below. |

The worker boundary is worth one more paragraph, because it is the only place
this app is genuinely concurrent. A cold shelf once measured **42.6 s of long
tasks and a single 15.5 s frozen frame** on the main thread; slicing finer could
not fix it because the atom is one spine and one spine was seconds of brush work.
Flat art made a spine cheap, but the shape stayed: the main thread's whole share
of a spine is now one `drawImage` of a finished bitmap into an atlas page. The
wire format is its own module ([`artJobs.ts`](src/features/bookshelf/artJobs.ts))
so neither side drags the other's dependencies in, and it carries an
`ART_PROTOCOL_VERSION` so a stale worker bundle is obvious rather than subtly
wrong.

### The stack, and why each piece is here

| Piece | Version | Why this one |
|---|---|---|
| [Tauri 2](https://tauri.app/) | 2.x | Ships the OS webview instead of bundling Chromium: a 16 MB installer rather than ten times that, and one process tree. Rust gets the things a webview cannot do — filesystem, SQLite, tray, an SSRF-guarded image fetcher. |
| [SolidJS](https://www.solidjs.com/) | ^1.9.3 | Fine-grained reactivity with no virtual DOM. That is not a benchmark preference here: the app mounts dozens of TipTap node views, and a VDOM diff over a node view is exactly the thing that fights ProseMirror for ownership of the DOM. |
| TypeScript + Vite | ~5.6 / ^6.0 | `strict`, plus `noUnusedLocals`/`noUnusedParameters`/`noFallthroughCasesInSwitch`. Vite's dev server is also the QA harness — see *Driving the running app*. |
| [PixiJS v8](https://pixijs.com/) | ^8.19 | Continuous zoom is the hard requirement, and it is what DOM loses on: Chromium rasterises a layer at a fixed scale, so animating `transform: scale()` on a big container gives blurry pixels during the zoom and a re-raster hitch at the end. A single SVG loses harder — filter-based linework is CPU-bound. |
| [TipTap v3](https://tiptap.dev/) | ^3.29 | `@tiptap/core` is genuinely framework-agnostic (core + `@tiptap/pm` only), so it runs under Solid with a thin binding layer. ProseMirror underneath supplies IME/composition handling and transaction-based undo against a strict schema, which is not cheaply replicable. In June 2025 Tiptap MIT-licensed ten formerly-Pro extensions, including the exact set this app needs: DragHandle, NodeRange, UniqueID, Details, Mathematics, TableOfContents. |
| Vendored Solid bindings | in-repo | [`src/editor/solid/`](src/editor/solid/) rather than a dependency, because there is no Solid adapter upstream worth taking and an editor binding is not a thing to upgrade by lockfile bump. Three files; see [The vendored Solid bindings](docs/readme/part-2-developers.md#the-vendored-solid-bindings). |
| SQLite via `tauri-plugin-sql` | ^2.4 | Migrations are registered on the Rust side in [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs). No ORM; the repos in [`src/data/`](src/data/) speak SQL directly. |
| GSAP | ^3.15 | Every plugin is free as of 2024, including Flip, which is what makes a dragged block settle into its new position instead of teleporting. Transform/opacity only in hot paths. |
| Howler | ^2.2 | <!--f:soundCues-->66<!--/f--> cues and <!--f:ambienceBeds-->10<!--/f--> ambience beds, in four categories (`ui`, `pages`, `shelf`, `ambient`) each with its own volume under a master. Web Audio through one library rather than by hand, because the interesting part is the cue table, not the graph. Provenance and licensing are under [Licence and credits](#licence-and-credits); the design is [`docs/design/sound.md`](docs/design/sound.md). |
| `html-to-image` | ^1.11 | Page → `ImageBitmap` for the curl. The one library in the app with a bug worked around at length ([`svgSnapshot.ts`](src/flip/svgSnapshot.ts)). |
| `lowlight` | ^3.3 | Syntax highlighting inside code blocks, through `@tiptap/extension-code-block-lowlight`. |
| `simplex-noise`, `svg-path-properties` | ^4.0 / ^1.3 | Seeded noise for the drawing vocabulary; path resampling for the pre-distorted vector chrome in [`art/wobble.ts`](src/art/wobble.ts). |
| `@floating-ui/dom` | ^1.8 | Anchoring for the slash menu, the link suggestions, the block context menu, the drag handle and the selection toolbar. The app's *own* tooltip deliberately does not use it — see [`tests/tooltip.test.ts`](tests/tooltip.test.ts). |
| `roughjs` | ^4.6 | **Installed and unimported.** The hand-drawn diagram strokes are `art/wobble.ts`, not Rough. Left in `package.json` from an earlier approach; removing it is a safe cleanup nobody has done. |
| Vitest, Playwright, fast-check | ^4.1 / ^1.62 / ^4.9 | Unit, end-to-end, and property-based tests. fast-check drives the script parser's round-trip invariant and the ZIP codec. |

There is deliberately no state-management library, no CSS framework, no icon
package, no chart library and no markdown library. The parser, the ZIP codec, the
PDF writer, the fuzzy matcher and the diagram layouts are all in-repo — each is
under a few hundred lines and each has requirements a general-purpose dependency
would not meet (see [`src/features/transfer/zip.ts`](src/features/transfer/zip.ts)
for the reasoning in one concrete case).

## Getting it running
<!--nav: `npm run tauri dev`, the browser-only dev path, and the four checks-->

```bash
npm install
npm run tauri dev      # the real app
npm run dev            # frontend only, in a browser, on :1420
```

`npm run dev` works because [`src/data/db.ts`](src/data/db.ts) falls back to an
in-memory database stub outside Tauri — the same `select`/`execute` surface,
persisted to `localStorage`, degrading to empty results rather than throwing on
SQL it does not understand. A book created in the browser survives a reload. This
is not a toy path: it is what the entire Playwright harness runs against, and
[`tests/stub-persistence.test.ts`](tests/stub-persistence.test.ts) holds it to the
real thing's behaviour.

### The four checks

Cheapest first. Agents working in parallel should use `tsc` and `vitest` and
**not** run `npm run build` or `npm run tauri dev`.

| Command | Gates |
|---|---|
| `npx tsc --noEmit` | The frontend, in `strict` mode. Note it only covers `src/` — `tests/` is not in the `tsconfig` include, so a test file's type errors surface when Vitest transpiles it, not here. |
| `npx vitest run` | <!--f:unitTests-->86<!--/f--> unit-test files, node environment (jsdom is deliberately not installed; [`vitest.config.ts`](vitest.config.ts) pins the environment for exactly that reason). `tests/book-bindings.test.ts` takes ~110 s on its own; that is expected. |
| `cargo check --manifest-path src-tauri/Cargo.toml` | The Rust host. |
| `npm run e2e` | <!--f:e2eSpecs-->15<!--/f--> Playwright specs against a dev server on :1420. Running them, and reading a red run, is [`docs/e2e.md`](docs/e2e.md). |

Two generated artefacts have their own verify mode, and both are wired into the
test suite so a forgotten regeneration is a red test rather than a silent
divergence: `npm run spec:check` (the AI-facing Notebook Script spec) and
`npm run readme:check` (the front page and both halves of it). A third,
`python scripts/gen-icons.py --check`, exists and is honest about not being
wired in yet.

> [!WARNING]
> Headless Chromium runs on SwiftShader, so the app's software-renderer probe puts
> the shelf into degrade mode and you get lo-res untitled spines. **Append
> `?fx=force`** to override it. In the same environment `requestAnimationFrame` is
> throttled, so poll for state instead of waiting a fixed time — a `waitForTimeout`
> that passes on your machine will flake in CI. The override lives in
> [`features/bookshelf/env.ts`](src/features/bookshelf/env.ts) and is not to be
> removed; all visual QA depends on it.

The suite shares that dev server with everything else working in the repo, so a
red run is not automatically a product failure: a save in another window
full-reloads the page mid-test. The config allows one retry for exactly that and
keeps the trace of the attempt that failed, which is how you tell the two apart.
[`docs/e2e.md`](docs/e2e.md) is the whole story, including the honest determinism
check to run when the repo is quiet.

## The map of the app
<!--nav: Directory by directory, plus the module-docstring convention this README points at instead of copying-->

Start with the directory, then the file. Every module in the tree opens with a
docstring stating what it is responsible for and — where a decision needed
defending — why it is that way and what it replaced.

| Path | What lives there |
|---|---|
| [`src/art/`](src/art/) | The drawing vocabulary. [`flat.ts`](src/art/flat.ts) is the palette and primitives; [`flatShelf.ts`](src/art/flatShelf.ts) the case parts; [`bake.ts`](src/art/bake.ts) the memoised rasters; [`atlas.ts`](src/art/atlas.ts) the sprite pages; [`wobble.ts`](src/art/wobble.ts) the pre-distorted vector linework; [`spines.ts`](src/art/spines.ts) one book's spine. |
| ↳ the vocabularies | [`shelfDesign.ts`](src/art/shelfDesign.ts) (carpentry), [`wallpaperDesign.ts`](src/art/wallpaperDesign.ts) (the wall), [`bookDesign.ts`](src/art/bookDesign.ts) (a book's binding), [`themes.ts`](src/art/themes.ts) (colour), [`covers.ts`](src/art/covers.ts) and [`charms.ts`](src/art/charms.ts). Orthogonal to colour and to each other. |
| [`src/features/bookshelf/`](src/features/bookshelf/) | The Pixi world: [`world.ts`](src/features/bookshelf/world.ts) (controller), [`camera.ts`](src/features/bookshelf/camera.ts), [`gestures.ts`](src/features/bookshelf/gestures.ts) (a pure input decision matrix), [`lod.ts`](src/features/bookshelf/lod.ts), [`virtualizer.ts`](src/features/bookshelf/virtualizer.ts), [`floorStamps.ts`](src/features/bookshelf/floorStamps.ts), [`textures.ts`](src/features/bookshelf/textures.ts), [`spineFactory.ts`](src/features/bookshelf/spineFactory.ts), [`artOffload.ts`](src/features/bookshelf/artOffload.ts) (worker pool; failure is never fatal). |
| [`src/views/`](src/views/) | The spread and the left icon rails. [`BookView.tsx`](src/views/BookView.tsx), [`rail/`](src/views/rail/) (studios and pickers), [`spread.ts`](src/views/spread.ts), [`bookmarks.ts`](src/views/bookmarks.ts). |
| [`src/editor/`](src/editor/) | TipTap setup ([`extensions.ts`](src/editor/extensions.ts)), one editor per page ([`PageEditor.tsx`](src/editor/PageEditor.tsx)), custom nodes ([`nodes/`](src/editor/nodes/)), slash and right-click menus, [`pagination.ts`](src/editor/pagination.ts), [`effects/`](src/editor/effects/), media paste, exporters, the vendored [`solid/`](src/editor/solid/) bindings. |
| [`src/flip/`](src/flip/) | The page-curl engine: [`curl.ts`](src/flip/curl.ts) (shaders), [`math.ts`](src/flip/math.ts) (pure, node-testable), [`rasterCache.ts`](src/flip/rasterCache.ts), [`gl.ts`](src/flip/gl.ts), [`cssFallback.ts`](src/flip/cssFallback.ts). |
| [`src/script/`](src/script/) | The Notebook Script parser and printer. Total by construction: `parse()` never throws. |
| [`src/diagrams/`](src/diagrams/) | Layout algorithms (tidy tree, layered DAG, timeline) and hand-drawn SVG renderers. |
| [`src/data/`](src/data/) | SQLite access and the persisted stores: [`bookcases.ts`](src/data/bookcases.ts), [`designPrefs.ts`](src/data/designPrefs.ts), [`settings.ts`](src/data/settings.ts), [`search.ts`](src/data/search.ts), [`keybindings.ts`](src/data/keybindings.ts). |
| [`src/features/transfer/`](src/features/transfer/) | Export/import bundles (`.nbk`), conflict resolution, restore points. |
| [`src/features/system/`](src/features/system/) | Backups, tray quick capture, launch behaviour, diagnostics, perf HUD. |
| [`src/features/packs/`](src/features/packs/), [`src/features/templates/`](src/features/templates/), [`src/features/tutorial/`](src/features/tutorial/), [`src/features/quickswitch/`](src/features/quickswitch/) | The reader's own uploads, the page templates, the guided tour, the `Ctrl+K` switcher. |
| [`src/sound/`](src/sound/) | The Howler engine, the named sound sets, and the in-app credits panel. |
| [`src/search/`](src/search/) | The fuzzy matcher and the full-text index behind `Ctrl+K` and `Ctrl+Shift+F`. In-repo, because the ranking rules are the product. |
| [`src/state/`](src/state/) | Which scene the shell is showing, and which book is open. One file, deliberately: everything else that persists is a store under `src/data/`. |
| [`src/features/settings/`](src/features/settings/) | The settings sheet, the appearance rules it applies, and the drawn pointer sets. |
| [`src-tauri/src/`](src-tauri/src/) | `media.rs`, `backup.rs`, `tray.rs`, `export.rs`, `import.rs`, `transfer.rs`, all registered in `lib.rs`. |

### What the source files document about themselves

<!--f:srcDocstrings-->288<!--/f--> of <!--f:srcFiles-->296<!--/f--> source files
open with a module docstring — <!--f:docstringLines-->6801<!--/f--> lines of it.
That is the largest single body of prose in the repo and it is deliberately not
copied here; this README's job is to point at it. The numbers are not asserted
either: `npm run readme:check` recomputes them from the tree and
`tests/readme.test.ts` fails if this sentence has drifted.

The convention:

1. First line is `path/file.ts — one sentence.`
2. A paragraph on what the file is responsible for, and what it is *not*.
3. `## Why it is this way` — only when there is a decision worth defending.
4. `## What this replaced` — only when something was deleted.
5. `## The rules` — prohibitions stated as prohibitions.
6. The reader's verbatim words, when a report drove the design. Search the tree
   for `*"` to find them.

If you read only one, read [`src/art/bake.ts`](src/art/bake.ts): it is short, it
carries real measurements, and it is the clearest example of the house style of
writing down a decision *and* the thing it replaced.
<!-- /gen -->

<!-- gen:lift-releasing -->
## Building and releasing
<!--nav: The bundle artefacts, the icon pipeline, and the tag-driven release workflow-->

```bash
npm run build          # spec:check, then vite build → dist/
npm run tauri build    # the above, then the Rust bundle
```

`npm run tauri build` writes to `src-tauri/target/release/bundle/`:

| Artefact | Notes |
|---|---|
| `Alcove_<version>_x64-setup.exe` | NSIS, and the one a reader downloads. `installMode: currentUser`, so installing needs no administrator prompt. |
| `Alcove_<version>_x64_en-US.msi` | WiX. For policy deployment. |
| `alcove.exe` | The app itself, with the icon group compiled in by `tauri_winres`. |

`bundle.targets` is `"all"`, so the target list follows the host platform: on
Windows the two installers above, on macOS a `.app` and a `.dmg`, on Linux a
`.deb`, an `.rpm` and an `.AppImage`. CI builds all three — see
[Releases](#releases). The version in those filenames comes
from `package.json`, and `src-tauri/tauri.conf.json` has to carry the same one —
`scripts/gen-readme.mjs` refuses to compose the front page when the two
disagree, because the badge is written from the first and the filename from the
second.

### The icon pipeline

The master art is [`assets/brand/alcove-art.png`](assets/brand/alcove-art.png), a
rendered illustration supplied by the owner. It is **not** the drawing reference
for the app's interior — that is [`assets/brand/icon.svg`](assets/brand/icon.svg),
and confusing the two will send you the wrong way.

```bash
python scripts/gen-icons.py              # every PNG size, the .ico and the .icns
python scripts/gen-icons.py --ico-only   # repack just icon.ico
python scripts/gen-icons.py --icns-only  # repack just icon.icns
python scripts/gen-icons.py --check      # audit both containers, exit 1 if bad
```

[`scripts/gen-icons.py`](scripts/gen-icons.py) does two things a plain resize does
not. It **cuts the frame** — the artwork is painted inside a black rounded
rectangle, and an OS icon must not carry its own, so black is flooded in from the
corners (the surround is pure black and the darkest paint inside measures 11–19,
so the shape lifts exactly, with no radius fitting and no drift if the art is
replaced). And it **treats small sizes differently** — straight-downscaled to
32px the illustration is a dark square with one red speck, so every size at or
below `SMALL_AT` crops past the scene onto the book, lifts brightness and
contrast, and re-applies a rounded mask.

It also writes **both** OS containers by hand, `icon.ico` and `icon.icns`,
because the frame set is a decision and a library that takes one image and
downscales it cannot express it. For the `.ico` that is because Pillow's encoder
PNG-compresses every frame and always writes `wPlanes = 0`;
[`docs/packaging-icons.md`](docs/packaging-icons.md) is the long version, and it
is worth reading before touching any of this: `tauri_winres` quietly repairs
`wPlanes` for the app exe and **NSIS does not**, so the installer once shipped a
worse icon directory than the app did. That document also records, honestly, that
the defects it found were *not* the cause of the symptom that prompted the
investigation.

The `.icns` was added when CI grew a macOS build, and it was added because of
what that build would otherwise have shipped: the container had been generated
once by the Tauri CLI and never again, so it still carried the artwork from two
renames ago — 75/255 mean absolute difference from the master, a different
picture rather than a stale encode. `--check` now compares the largest `.icns`
frame against the master, so *old* fails as loudly as *malformed*.
[`docs/packaging-mac-linux.md`](docs/packaging-mac-linux.md) has the frame set, the
run-length encoding, and how the encoder was verified without a Mac to hand.

> [!NOTE]
> `npx @tauri-apps/cli icon` is no longer part of the pipeline — this one script
> writes every icon `bundle.icon` names. If you ever do run it, run it **before**
> `scripts/gen-icons.py`, never after: it regenerates the PNGs as plain
> downscales and clobbers the close-crops.

### Releases

Tag-driven, and now on all three platforms.
[`.github/workflows/release.yml`](.github/workflows/release.yml) fires when a
`v*` tag is pushed, or on manual dispatch against a tag that already exists. It
is three jobs rather than one matrix:

| Job | Runner | What it does |
|---|---|---|
| `gates` | `ubuntu-latest` | `tsc --noEmit`, `vitest run`, `spec:check`, `readme:check`, `gen-icons.py --check` |
| `build` ×3 | `windows-latest`, `macos-15`, `ubuntu-22.04` | the bundle, and nothing else |
| `release` | `ubuntu-latest` | notes, `SHA256SUMS.txt`, one GitHub Release |

**The gates run once.** None of them can fail differently on a different
operating system, so running them on all three runners would triple their cost
and buy three copies of the same red X — and putting them *before* the matrix
means a typo fails in two minutes rather than after three parallel Rust builds.
`build` is `fail-fast: false` so one broken platform still reports on the other
two; `release` needs all three, so a partial matrix never publishes with a
platform quietly missing.

macOS builds **one universal `.dmg`** carrying both arm64 and x86_64
(`--target universal-apple-darwin` on an Apple-silicon runner), rather than
making the reader choose. Linux builds on `ubuntu-22.04` deliberately: a `.deb`
and an AppImage link against the builder's glibc, so building on 24.04 would
produce packages that refuse to start on 22.04.
[`docs/packaging-mac-linux.md`](docs/packaging-mac-linux.md) is the operational
document — the system packages Linux needs and why each one, what a first run
should produce, and what to check when it does.

Notes come from [`scripts/release-notes.mjs`](scripts/release-notes.mjs) by
diffing against the previous tag. A tag containing `-` publishes as a prerelease.

Two honest edges. **Nothing is signed** on any platform, so Windows shows a
SmartScreen warning and macOS quarantines the first launch — which is why the
release carries checksums. And this is still the *only* workflow: it fires on
tags, so nothing runs `tsc` or `vitest` on an ordinary push, and the artefact
names in `docs/packaging-mac-linux.md` are read off the bundler's naming rules
rather than off a run that has already happened on every platform. Check them
against the Release before quoting one at a reader.

> [!NOTE]
> There is consequently no CI badge to display yet. The gates run locally, and
> again at the tag — not on every commit. Wiring a push-triggered workflow is the
> prerequisite for earning that badge, not the other way round.
<!-- /gen -->

<!-- gen:lift-nongoals -->
## Non-goals
<!--nav: No sync, no cloud, no mobile, no plugin API, no second visual language, no light model-->

- **No sync and no accounts.** The database is a file on your disk. There is no
  server to sign in to and nothing to be logged out of.
- **No cloud anything.** The only outbound network traffic is image fetch and link
  preview, both explicitly requested by you and both behind an SSRF guard
  ([`src/editor/media/urlGuard.ts`](src/editor/media/urlGuard.ts) mirrors the Rust
  one in [`src-tauri/src/media.rs`](src-tauri/src/media.rs)).
- **No mobile, no web build.** Touch, small viewports and a shelf you cannot
  hover are three separate redesigns, not a media query. The browser dev server
  is a test harness, not a product.
- **No plugin API.** The vocabularies are extended by editing them; see
  [Adding a value, end to end](docs/readme/part-2-developers.md#adding-a-value-end-to-end).
- **No collaborative editing.** ProseMirror could support it; the storage model,
  the pagination contract and the whole single-reader framing do not.
- **No second visual language.** One flat vocabulary, one ink colour, one small
  palette. New surfaces join it rather than bringing their own.
- **No light model.** Flat colour, one ink colour on everything, rounded corners,
  edges that bow, and `contactShadow()` where an object meets a surface. Gradients
  are fine; a highlight placed to imply a lamp is not.
<!-- /gen -->

## The repo at a glance
<!--nav: Six measurements of the tree, every one recomputed rather than typed-->

| | | Where it is explained |
| --- | --- | --- |
| Frontend source | <!--f:srcFiles-->296<!--/f--> TypeScript files, <!--f:srcDocstrings-->288<!--/f--> of which open with a module docstring — <!--f:docstringLines-->6801<!--/f--> lines of prose | [What the source files document about themselves](#what-the-source-files-document-about-themselves) |
| Rust host | <!--f:rustFiles-->8<!--/f--> files, <!--f:rustLines-->2302<!--/f--> lines, <!--f:rustCommands-->14<!--/f--> commands, <!--f:dbMigrations-->2<!--/f--> migrations | [How it's built](#how-its-built) |
| Tests | <!--f:unitTests-->86<!--/f--> Vitest files and <!--f:e2eSpecs-->15<!--/f--> Playwright specs | [The gates](docs/readme/part-2-developers.md#the-gates) |
| QA against the running app | <!--f:probeScripts-->65<!--/f--> `probe-*.mjs` scripts | [Driving the running app](docs/readme/part-2-developers.md#driving-the-running-app) |
| Generated and checked in | <!--f:generatorScripts-->7<!--/f--> `gen-*` scripts, two of which are gated on regeneration | [The generated artefacts](docs/readme/part-2-developers.md#the-generated-artefacts) |
| Design record | <!--f:designDocs-->15<!--/f--> documents in [`docs/design/`](docs/design/), <!--f:supersededDesignDocs-->5<!--/f--> of them explicitly superseded and kept on purpose | [The design record](docs/readme/part-2-developers.md#the-design-record) |

## Deeper reading
<!--nav: The two halves as pages of their own, and every section of them this page does not already carry-->

Nothing below is required to use or build the app — it is the long form of what
is already on this page, plus the corners this page does not go into.

<!-- gen:deeper-reading -->
**[Part 1 — Using Alcove](docs/readme/part-1-users.md)** — *for the person writing in it.* The whole user manual, as a page of its own — everything in Part 1 above.

**[Part 2 — Building Alcove](docs/readme/part-2-developers.md)** — *for a developer, or for an AI agent helping one.* The long form of Part 2 above, plus every corner this page does not go into.

| Section | What you get |
| --- | --- |
| [The art pipeline](docs/readme/part-2-developers.md#the-art-pipeline) | Bake once, draw forever: atlas packing, LOD tiers, and the cache-key rule |
| [The design vocabularies](docs/readme/part-2-developers.md#the-design-vocabularies) | Colour, carpentry, wall and binding as four orthogonal axes — and adding a value end to end |
| [The editor](docs/readme/part-2-developers.md#the-editor) | The vendored Solid bindings, the pagination contract, block effects, and adding a block type step by step |
| [The flip](docs/readme/part-2-developers.md#the-flip) | The cylinder curl, the snapshot cache, and the library bug worked around at length |
| [Notebook Script](docs/readme/part-2-developers.md#notebook-script) | Why `parse()` is total, the round-trip invariant, and the generated spec |
| [The data layer](docs/readme/part-2-developers.md#the-data-layer) | The schema, the bookcase model, and why every read is validated |
| [The failure modes this codebase has actually shipped](docs/readme/part-2-developers.md#the-failure-modes-this-codebase-has-actually-shipped) | The four ways work here has looked finished and been unreachable, unreadable, wrong or buttonless, with the real instances named |
| [The gates](docs/readme/part-2-developers.md#the-gates) | Every unit-test file and the specific class of bug it exists to stop |
| [Driving the running app](docs/readme/part-2-developers.md#driving-the-running-app) | Specimen boards, probes, end-to-end, and why a board proves less than it looks like it does |
| [Things that were harder than they look](docs/readme/part-2-developers.md#things-that-were-harder-than-they-look) | Five places the obvious implementation is wrong |
| [The design record](docs/readme/part-2-developers.md#the-design-record) | The ADR set in `docs/design/`, including which documents are superseded and why they are kept |
| [The generated artefacts](docs/readme/part-2-developers.md#the-generated-artefacts) | The `gen-*` scripts that write checked-in files, and which ones a forgotten regeneration actually fails |
| [How this document stays true](docs/readme/part-2-developers.md#how-this-document-stays-true) | The spec check and the README check: markers recomputed, links resolved, navigation composed rather than typed |
<!-- /gen -->

The five design records in [`docs/design/`](docs/design/) are the canonical
blueprints for the shelf renderer, the page flip, the block editor, the script
language and the art pipeline; several older documents there carry a superseded
banner and are kept on purpose. [`CLAUDE.md`](CLAUDE.md) is the binding rules
file for agents working in this repo — it states the constraints and
deliberately does not restate this page.

## How this page stays honest
<!--nav: Why no number here is typed, why no paragraph is written twice, and what the check does and does not do-->

A README that quotes numbers goes stale silently, so none of the numbers on this
page are typed as prose. Each is written inside an invisible marker —
`<!--f:wallpaperPapers-->126<!--/f-->`, which GitHub renders as `126` and
nothing else — and recomputed from the tree. So are the
<!--f:readmeShots-->13<!--/f--> screenshots: each one records the app it
photographed and the room it stood in, so a picture that has outlived what it
shows says so rather than quietly lying.

```bash
npm run readme:check   # report what has drifted, and what is missing
npm run readme:facts   # print the true values
npm run readme:build   # recompose this page from package.json and the halves
```

**The check reports; it does not block, and it never rewrites a sentence.** It
prints a grouped list — numbers that no longer match the tree, links that go
nowhere, pictures that no longer show this app, and things that are in the repo
but on no page at all — and then leaves the editing to whoever is doing it,
which may well be an agent. What a page *ought* to say is a judgement, and a
script should not be making it. The one thing that does still fail is
`npx vitest run`, on a stale count, because a count that has stopped being true
is a fact rather than an opinion.

**Nor is the prose typed twice.** The manual above is *lifted* out of
[`docs/readme/part-1-users.md`](docs/readme/part-1-users.md) and
[`docs/readme/part-2-developers.md`](docs/readme/part-2-developers.md) by
[`scripts/gen-readme.mjs`](scripts/gen-readme.mjs): a half wraps a run of
sections in `<!--lift: name-->`, this page places `<!-- gen:lift-name -->` where
it wants them, and the lift retargets every relative link from `docs/readme/` to
the repo root, leaves code alone, and resolves bare `#fragment` links against
this page's own headings — keeping the ones whose heading came with the text and
pointing the rest back at the half. Two headings that would slug the same way
stop the build and name both lines. The badge strip, the download table and
every contents list on every page are composed the same way, from the version in
[`package.json`](package.json), cross-checked against
[`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json).

So editing a generated region by hand is a red test, not a divergence somebody
notices months later. [`tests/readme.test.ts`](tests/readme.test.ts) is the real
gate: it supplies the counts that need the TypeScript modules loaded, and it
resolves every relative link the way a reader's browser would follow it.
[How this document stays true](docs/readme/part-2-developers.md#how-this-document-stays-true)
is the long version, and the place the procedure for adding a marker of your own
is written out.

<!-- gen:lift-credits -->
## Licence and credits
<!--nav: MIT, the bundled fonts, where the sound came from, and the two brand images that are not interchangeable-->

MIT — see [`LICENSE`](LICENSE).

**Fonts** are bundled through `@fontsource`, all under the SIL Open Font License:
Caveat (headings and book titles, 20px and up), Patrick Hand (body), Kalam
(accents), Architects Daughter (diagram labels), Nunito Sans (UI micro-copy below
13px), plus Crimson Pro, Lora, Gochi Hand and Shadows Into Light for the page-level
lettering vocabulary.

**Sound.** Every shipped cue is a real recording under a public-domain dedication
or CC0, sliced and conditioned by [`scripts/gen-sounds.mjs`](scripts/gen-sounds.mjs).
One source — the rain bed — is CC BY 4.0, and the attribution is discharged in the
UI rather than in a text file: *Settings → Sound → sound credits* reads
`public/sounds/CREDITS.json` at runtime and renders every recording, author and
licence. The manifest is rewritten from the same table that drives the audio on
every build, so a credit cannot drift from what actually shipped. Provenance for
all of it is in [`docs/design/sound.md`](docs/design/sound.md).

**Art.** [`assets/brand/icon.svg`](assets/brand/icon.svg) is the drawing reference
the whole app follows. [`assets/brand/alcove-art.png`](assets/brand/alcove-art.png)
is the shipped app and installer icon, supplied by the owner, and is deliberately a
different register from the app's interior — it is the source for
[`scripts/gen-icons.py`](scripts/gen-icons.py) and nothing else. Do not flatten the
mark to match the app, and do not add rendering to the app to match the mark.

**Upstream.** TipTap and ProseMirror (MIT), the Solid bindings in
[`src/editor/solid/`](src/editor/solid/) based on `@vrite/tiptap-solid` (MIT),
PixiJS (MIT), GSAP (standard licence, all plugins free), Howler (MIT), lowlight
and the `highlight.js` grammars (BSD-3-Clause / MIT), Tauri (MIT/Apache-2.0).
`roughjs` (MIT) is in `package.json` but nothing imports it — see
[the stack table](#the-stack-and-why-each-piece-is-here).
<!-- /gen -->
