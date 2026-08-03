<p align="center">
  <img src="docs/readme/img/hero.png" alt="Alcove — a notebook that lives on a bookshelf. A cream card taped to a papered wall, with the app's book icon, the wordmark in a handwriting face, and six coloured book spines standing on a timber plank below." width="880">
</p>

<!--
  Badges below are static because both live sources are currently unavailable:
  the repository is private (shields cannot read it) and no version tag has ever
  been pushed, so a release badge would render "inaccessible" rather than a fact.
  When the repo goes public and `v0.2.0` is tagged, replace the first two with:

  [![release](https://img.shields.io/github/v/release/AkshitIreddy/alcove?style=flat-square&labelColor=4f3120&color=c96f4a)](https://github.com/AkshitIreddy/alcove/releases/latest)
  [![build](https://img.shields.io/github/actions/workflow/status/AkshitIreddy/alcove/release.yml?style=flat-square&labelColor=4f3120&color=7d915c)](.github/workflows/release.yml)
-->

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-c96f4a?style=flat-square&labelColor=4f3120" alt="Version 0.1.0">
  <img src="https://img.shields.io/badge/release-none%20published%20yet-9d6b3c?style=flat-square&labelColor=4f3120" alt="No release published yet">
  <img src="https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-7d915c?style=flat-square&labelColor=4f3120" alt="Platform: Windows 10 and 11">
  <img src="https://img.shields.io/badge/storage-local%20SQLite%20%C2%B7%20no%20account-5f7d8c?style=flat-square&labelColor=4f3120" alt="Storage: local SQLite, no account">
  <img src="https://img.shields.io/badge/licence-MIT-6f6a86?style=flat-square&labelColor=4f3120" alt="Licence: MIT">
</p>

<h1 align="center">Alcove</h1>

<p align="center">
  <b>A Windows notes app that puts your notes on a bookshelf you can walk around in.</b>
</p>

<p align="center">
  <a href="docs/readme/part-1-users.md"><b>▸ Part 1 — Using Alcove</b></a>
  &nbsp;·&nbsp;
  <a href="docs/readme/part-2-developers.md"><b>▸ Part 2 — Building Alcove</b></a>
</p>

---

Alcove keeps what you write in books standing on shelves in a hand-drawn room,
instead of in a list of filenames. You pan and zoom around that room, pull a
book off its floor, and it opens as a two-page spread you write in with a block
editor of the kind you already know — slash menu, drag handles, right-click
menu, tables, callouts, code, diagrams.

Everything is one SQLite file on your own disk: no account to make, nothing to
sign into, and no network call unless you ask for one. It is built with
[Tauri 2](https://tauri.app/) (Rust) and [SolidJS](https://www.solidjs.com/),
draws its shelf on [PixiJS](https://pixijs.com/) and its pages with
[TipTap](https://tiptap.dev/), and ships as a Windows installer that borrows the
system webview instead of bundling a browser — so the download is small, and
nothing runs in the background once you close the window unless you switch on
tray quick capture.

<p align="center">
  <img src="docs/readme/img/shelf.png" alt="The Alcove shelf: a green bookcase with a fluted cornice against pale striped wallpaper, two floors of individually drawn book spines, and a cream tool dock on the left." width="47%">
  <img src="docs/readme/img/spread.png" alt="A book open on its first spread: two ruled pages carrying a handwritten title, a green callout, checkboxes, highlights and a strip of pink washi tape, with a vertical rail of hand-drawn tool icons down the left edge." width="47%">
</p>

## What is actually in the box

- **A bookshelf world.** A WebGL room you pan and zoom through, with as many
  bookcases as you care to build and <!--f:defaultFloors-->10<!--/f--> floors
  per case to start with. Books are drawn objects, not rows in a list — you
  recognise yours by its binding.
- **Pages that never scroll.** A page is a fixed leaf of paper. When you fill
  it, the trailing blocks flow onto the next page, and a new page is made if
  there isn't one. Turning a page is a page turn, not a scroll.
- **Notebook Script.** A small Markdown dialect you can hand to any chatbot.
  Ask it for a note, paste the reply into *Insert script*, and it becomes
  formatted pages — including trees, graphs and timelines drawn as hand-drawn
  diagrams.
- **Customisation that goes further than a colour picker.**
  <!--f:roomPresets-->69<!--/f--> named rooms,
  <!--f:shelfPresets-->113<!--/f--> named bookcase designs,
  <!--f:wallpaperPapers-->126<!--/f--> wallpapers,
  <!--f:bookPresets-->189<!--/f--> book bindings,
  <!--f:stickers-->50<!--/f--> stickers,
  <!--f:effectAxes-->11<!--/f--> axes of block decoration.
- **The quiet infrastructure.** Full-text search, a `Ctrl+K` switcher, scheduled
  backups, an export bundle that another copy of the app can import, a tray icon
  for capturing a thought without opening the window, and a sound for everything
  you touch.

Every number on these three pages was read out of the module that defines it and
wrapped in a marker `npx vitest run` recomputes — see
[How this page stays honest](#how-this-page-stays-honest).

> [!NOTE]
> **Where this stands, so you can judge it before installing.**
> - **Windows only.** Windows 10 or 11. There is no macOS or Linux build, and no
>   mobile app.
> - **Pre-1.0, and no release has been published yet.** The version in
>   [`package.json`](package.json) and
>   [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json) is `0.1.0`; the
>   repository has no version tags, so the Releases page is empty. You can build
>   the installer yourself today — see [Getting started](#getting-started).
> - **Your library is one local SQLite file.** No account, no sync, no cloud, no
>   telemetry — `telemetry` is typed as the literal `false` in
>   [`src/data/types.ts`](src/data/types.ts), so it is not a setting that can be
>   turned on. That is a deliberate design, not a missing feature, and it means
>   the scheduled backups are your only copies.
> - **Two things touch the network, and both because you asked.** Searching for
>   a picture (`::fetch` in Notebook Script) and previewing a link you pasted.
>   Both are https-only, refuse private and loopback addresses, time out fast
>   and cap what they will download. Nothing else leaves the machine.

## The two halves

The documentation is deliberately split by who is reading it, and each half is
the whole story for its reader. The tables below are navigation rather than
summary — this page exists to hand you to the right one and then get out of the
way.

### [Part 1 — Using Alcove](docs/readme/part-1-users.md)

What it is, how to install it, and how to use every part of it. Illustrated with
the <!--f:readmeShots-->13<!--/f--> images in
[`docs/readme/img/`](docs/readme/img/): the banner at the top of this page, and
captures taken by [`shots-now/readme-shots.mjs`](shots-now/readme-shots.mjs)
after driving the running app into the state each sentence claims — no mock-ups
and no compositing.

| Section | What you get |
| --- | --- |
| [Installing](docs/readme/part-1-users.md#installing) | What the download will be, what the installer does, where your library lives, and how to uninstall without losing it |
| [The first ten minutes](docs/readme/part-1-users.md#the-first-ten-minutes) | Seven steps from arriving at the shelf to making a second book, plus the in-app guided tour |
| [A tour](docs/readme/part-1-users.md#a-tour) | The shelf, the spread, the page turn, the slash menu, the catalogue, the two studios, the switcher |
| [Writing in a book](docs/readme/part-1-users.md#writing-in-a-book) | Every block a page can hold, the right-click menu, why pages never scroll, maths, diagrams, pictures, the rail end to end |
| [Notebook Script](docs/readme/part-1-users.md#notebook-script) | The chatbot workflow, a whole worked script and the page it makes, and what the language has |
| [Making it yours](docs/readme/part-1-users.md#making-it-yours) | The two studios, every vocabulary counted, custom colours, stars and hiding, more bookcases, your own packs |
| [Sound](docs/readme/part-1-users.md#sound) | Sound sets, ambience beds, the volume model, and the in-app credits |
| [The keyboard](docs/readme/part-1-users.md#the-keyboard) | Every shortcut, grouped by where you are standing, and which ones you can rebind |
| [Backups, export and import](docs/readme/part-1-users.md#backups-export-and-import) | Scheduled backups, `.nbk` bundles, Markdown in and out, PDF and PNG, tray capture |
| [Questions](docs/readme/part-1-users.md#questions) | Where the data is, whether it is offline, moving machines, and the failure modes worth naming |

### [Part 2 — Building Alcove](docs/readme/part-2-developers.md)

How the app is put together, why each dependency earned its place, and what you
have to touch to add a wallpaper motif or a new kind of block without leaving it
unreachable. Written for whoever has to change something — so it is organised
around the failures this repo has actually had rather than around the tree.

| Section | What you get |
| --- | --- |
| [How it's built](docs/readme/part-2-developers.md#how-its-built) | The three ways the app draws itself, what runs in which execution context, and the stack table with a reason per row |
| [Getting it running](docs/readme/part-2-developers.md#getting-it-running) | `npm run tauri dev`, the browser-only dev path, and the four checks |
| [The map of the app](docs/readme/part-2-developers.md#the-map-of-the-app) | Directory by directory, plus the module-docstring convention this README points at instead of copying |
| [The art pipeline](docs/readme/part-2-developers.md#the-art-pipeline) | Bake once, draw forever: atlas packing, LOD tiers, and the cache-key rule |
| [The design vocabularies](docs/readme/part-2-developers.md#the-design-vocabularies) | Colour, carpentry, wall and binding as four orthogonal axes — and adding a value end to end |
| [The editor](docs/readme/part-2-developers.md#the-editor) | The vendored Solid bindings, the pagination contract, block effects, and adding a block type step by step |
| [The flip](docs/readme/part-2-developers.md#the-flip) | The cylinder curl, the snapshot cache, and the library bug worked around at length |
| [Notebook Script](docs/readme/part-2-developers.md#notebook-script) | Why `parse()` is total, the round-trip invariant, and the generated spec |
| [The data layer](docs/readme/part-2-developers.md#the-data-layer) | The schema, the bookcase model, and why every read is validated |
| [The failure modes this codebase has actually shipped](docs/readme/part-2-developers.md#the-failure-modes-this-codebase-has-actually-shipped) | The three ways work here has looked finished and been unreachable, unreadable or wrong, with the real instances named |
| [The gates](docs/readme/part-2-developers.md#the-gates) | Every unit-test file and the specific class of bug it exists to stop |
| [Driving the running app](docs/readme/part-2-developers.md#driving-the-running-app) | Specimen boards, probes, end-to-end, and why a board proves less than it looks like it does |
| [Things that were harder than they look](docs/readme/part-2-developers.md#things-that-were-harder-than-they-look) | Five places the obvious implementation is wrong |
| [The design record](docs/readme/part-2-developers.md#the-design-record) | The ADR set in [`docs/design/`](docs/design/), including which documents are superseded and why they are kept |
| [Building and releasing](docs/readme/part-2-developers.md#building-and-releasing) | The bundle artefacts, the icon pipeline, and the tag-driven release workflow |
| [Non-goals](docs/readme/part-2-developers.md#non-goals) | No sync, no cloud, no mobile, no plugin API, no second visual language, no light model |

## The repo at a glance

Each of these is a marker recomputed from the tree, and each is explained in
Part 2 rather than here.

| | | Where it is explained |
| --- | --- | --- |
| Frontend source | <!--f:srcFiles-->278<!--/f--> TypeScript files, <!--f:srcDocstrings-->270<!--/f--> of which open with a module docstring — <!--f:docstringLines-->5834<!--/f--> lines of prose | [What the source files document about themselves](docs/readme/part-2-developers.md#what-the-source-files-document-about-themselves) |
| Rust host | <!--f:rustFiles-->8<!--/f--> files, <!--f:rustLines-->2292<!--/f--> lines, <!--f:rustCommands-->13<!--/f--> commands, <!--f:dbMigrations-->2<!--/f--> migrations | [How it's built](docs/readme/part-2-developers.md#how-its-built) |
| Tests | <!--f:unitTests-->71<!--/f--> Vitest files and <!--f:e2eSpecs-->15<!--/f--> Playwright specs | [The gates](docs/readme/part-2-developers.md#the-gates) |
| QA against the running app | <!--f:probeScripts-->31<!--/f--> `probe-*.mjs` scripts | [Driving the running app](docs/readme/part-2-developers.md#driving-the-running-app) |
| Generated and checked in | <!--f:generatorScripts-->6<!--/f--> `gen-*` scripts, one of which is gated on regeneration | [The generated artefacts](docs/readme/part-2-developers.md#the-generated-artefacts) |
| Design record | <!--f:designDocs-->15<!--/f--> documents in [`docs/design/`](docs/design/), <!--f:supersededDesignDocs-->5<!--/f--> of them explicitly superseded and kept on purpose | [The design record](docs/readme/part-2-developers.md#the-design-record) |

## Getting started

**If you want to use it.** There is no published release yet, so there is
nothing to download today; [Installing](docs/readme/part-1-users.md#installing)
describes exactly what the download will be when the first tag lands, and where
everything ends up on disk. You do not have to wait for it — `npm install` then
`npm run tauri build` produces the same installer.

**If you want to build or change it.** Node and a stable Rust toolchain, and
nothing else:

```bash
npm install
npm run tauri dev      # the real app
npm run dev            # frontend only, in a browser, on :1420
npm run tauri build    # the installer, into src-tauri/target/release/bundle/
```

The four checks, cheapest first:

```bash
npx tsc --noEmit
npx vitest run
cargo check --manifest-path src-tauri/Cargo.toml
npm run e2e
```

[Getting it running](docs/readme/part-2-developers.md#getting-it-running) says
what each one covers and what the headless environment does to the shelf.
[`CLAUDE.md`](CLAUDE.md) is the binding rules file for agents working in this
repo; it states the constraints and deliberately does not restate this README.

## How this page stays honest

A README that quotes numbers goes stale silently, so none of the numbers on
these three pages are typed as prose. Each is written inside an invisible
marker — `<!--f:wallpaperPapers-->126<!--/f-->`, which GitHub renders as `126`
and nothing else — and recomputed from the tree:

```bash
npm run readme:check   # recompute every marker, resolve every relative link
npm run readme:facts   # print the true values
```

[`tests/readme.test.ts`](tests/readme.test.ts) is the real gate: it supplies the
counts that need the TypeScript modules loaded, so a vocabulary that grows while
a page says otherwise is a failing test rather than a stale sentence. Relative
links are resolved the way a reader's browser would follow them, so a moved file
is a red test too.

The same discipline runs elsewhere in the repo: `npm run spec:check` regenerates
the AI-facing Notebook Script spec from the parser's own vocabulary and fails if
the checked-in copy differs. [How this document stays
true](docs/readme/part-2-developers.md#how-this-document-stays-true) is the long
version of both, and the place the procedure for adding a marker of your own is
written out.

## Licence

MIT — see [`LICENSE`](LICENSE). Font, sound, art and upstream credits are in
[Licence and credits](docs/readme/part-2-developers.md#licence-and-credits) at
the end of Part 2.
