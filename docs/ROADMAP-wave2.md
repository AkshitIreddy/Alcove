# Wave 2 — 33 customization & quality-of-life features

**Status: all 33 are in the tree.** Two shipped as something else entirely and
five shipped by a different mechanism than the one proposed below; every one of
those is marked and explained, because a roadmap that quietly ticks a box it did
not actually fill is how a plan stops being worth reading.

This was written as a *plan*, grouped for parallel agent ownership, and the file
territory each group claims is recorded so waves could run concurrently. It is
now a **record**, and the notes under each item say what is actually in the tree.
Legend:

- **✅ shipped** — as specified.
- **◑ shipped, differently** — the feature is there; the mechanism, the location
  or the vocabulary is not what this file proposed. The note says what changed.
- **⤳ superseded** — the item as written no longer describes anything the app
  has, because something larger replaced it. The note says what.

Where a group's territory line was wrong, it is corrected in place.

---

## Group A — Shelf & library life
*(`src/features/bookshelf/`, `src/data/books.ts`, `src/data/bookcases.ts`)*

1. **✅ Book management on shelf**: right-click a book → rename / duplicate /
   delete (crumple sound + hand-drawn confirm) / pin ⭐ / move (drag between
   slots & floors with drop preview).
   → `ShelfMenu.tsx` (`open · rename · customize · pin · duplicate · move ·
   delete`, three modes: action menu, inline rename card, crumple-confirm);
   the move drag lands in `world.ts` → `moveBook`.
2. **✅ Floor name plates**: editable brass-plaque labels per floor (double-click
   to edit, stored per floor index).
   → `features/bookshelf/floorNames.ts` (one `settings`-table blob under
   `floorNames`, trimmed, capped at 40 chars, empty deletes) + `floorStamps.ts`.
3. **✅ Favorites**: pinned books get a tiny star charm on the spine; optional
   "favorites first" floor sort.
   → `books.ts` shelf-meta `pinned` + `setBookPinned`; `settings.shelfSort`
   accepts `'favorites'`.
4. **✅ Recent & continue-reading**: last-opened book shows a ribbon peeking from
   its pages; shelf "sort by recent" toggle.
   → `data.ts` sorts on `lastOpenedAt`, `floorView.ts` hangs the ribbon sprite on
   the most-recently-opened visible book, `settings.shelfSort = 'recent'`.
   `src/search/recents.ts` is the separate MRU the switcher writes.
5. **✅ Auto book thickness**: spine width scales with page count (re-derive on
   page add/delete).
   → `art/bookStyle.ts` `thicknessFromPageCount` blended against the seeded
   width; `spineFactory.ts` passes the book's stored `pageCount`.
6. **⤳ Shelf wood stains**: ~~oak / walnut / cherry / painted-cream case themes
   (bake variants, global setting).~~
   **Superseded, and the setting is gone.** A four-way stain never reached the
   screen after the case went flat, so the row, the `Settings` field and
   `EnvTextures.setStain` were all deleted — together with the e2e test that
   claimed "cherry reddens every wood pixel", which had not been true for a long
   time. What exists instead is far larger and belongs to the **bookcase**, not
   to the app: `art/shelfDesign.ts` (52 builds × 50 timber patterns, 113 named
   presets) crossed with `art/themes.ts` (60 colour schemes), chosen in the
   library studio. See `docs/design/library-themes.md` §0 and §3.1.
7. **⤳ Wallpaper picker**: ~~4 wall patterns (damask, stars, botanical, plain) in
   settings.~~
   **Superseded the same way.** `art/wallpaperDesign.ts` is 50 motifs × 5 scales
   × 4 reliefs × 6 ink slots × 50 tones × 4 edges over 126 named papers, seamless
   by construction, picked per bookcase in the library studio. The settings row is
   deleted. See `library-themes.md` §3.2.
8. **✅ Keyboard shelf nav**: arrows move a selection halo between books, Enter
   pulls out, Home jumps to floor 0.
   → `world.ts` (arrow/Home handler, guarded so an open rail panel keeps its own
   keys — `data-nb-panel="open"`).

## Group B — Editor & pages
*(`src/editor/`, `src/flip/`, `src/views/`)*

9. **✅ Table of contents panel**: rail icon → headings tree of the whole book,
   click jumps (flip animation) to that page/heading.
   → `views/toc.ts` + `views/rail/TocPanel.tsx`.
10. **✅ Page thumbnails strip**: toggleable bottom filmstrip of mini page
    renders (reuse flip snapshot cache), click to jump.
    → `views/ThumbStrip.tsx`, reading `FlipSurfaceApi.getSnapshot` as an LRU
    *peek* so it never disturbs flip textures; unseen pages fall back to a
    hand-drawn paper chip.
11. **✅ Word/character count**: per page + book total, quiet display in the rail
    footer. → `editor/wordcount.ts`, `BookRail.tsx` footer.
12. **✅ Focus mode**: rail icon or F9 — hides rail/chrome, dims wall, centers a
    single page.
    Two amendments since: entering focus mode **closes an open rail panel**
    (a panel also pushes the spread sideways, so entering with Customize open
    shoved the book off the right edge), and the way out is a **top-left**
    "leave focus · Esc" chip, gated by `tests/top-left-exits.test.ts`.
13. **✅ Page history**: periodic snapshots with a restore picker (hand-drawn
    "time-turner" panel).
    → `editor/history/pageHistory.ts` — an in-memory ring of `MEMORY_CAP` (20)
    per page with a `MIN_SNAPSHOT_GAP_MS` (20 s) floor so a typing burst cannot
    shred it, plus a persisted tail of `PERSIST_CAP` (10). `HistoryPanel.tsx`.
14. **✅ Keyboard cheat-sheet**: `?` overlay listing all shortcuts, hand-drawn
    two-column card. → `views/CheatSheet.tsx`, now with a visible top-left close
    (Escape and the scrim used to be the only way out).
15. **◑ Highlighter styles**: marker sweep / squiggle underline / circle scribble
    on the highlight menu + context menu.
    → `editor/highlightStyles.ts` + `editor/menu/registry.ts`. It also grew past
    the highlight mark into the block-effects `underline` axis
    (squiggle / marker / dotted / double / circled), where the squiggle carries a
    wobble-generated SVG mask. All 50 underline values are now reachable *and*
    styled — `tests/catalogue-reach.test.ts` gates that every value of every axis
    is named by a selector, which is the check that was missing when they were
    inert.
16. **✅ Cursor styles**: pencil / quill / standard pointer for the editor.
    → `settings.cursorStyle` → `BookView` writes `data-cursor`, `editor.css`
    reads it.
17. **✅ Autosave indicator**: tiny pencil that scribbles in the rail when a save
    flushes. → `editor/saveIndicator.ts` + `BookRail.tsx`.
18. **✅ Daily journal**: `/today` creates-or-jumps to a dated page in a
    designated Journal book. → `editor/journal.ts`, `settings.journalBookId`.
19. **✅ Ribbon bookmarks**: per-book colored ribbons; "bookmark this page" in
    the rail; ribbons visible on the closed book and jump on click.
    → `views/bookmarks.ts`, stored inside the book's `cover_meta`
    (`bookmarks[]` + a `ribbon` style blob).

## Group C — Search & navigation
*(`src/search/`, `src/features/quickswitch/`, `src/data/search.ts`)*

20. **✅ Quick switcher**: Ctrl+K fuzzy palette over books + page headings
    (hand-drawn command bar), Enter opens with animation.
    → `features/quickswitch/QuickSwitcher.tsx` + `search/fuzzy.ts`,
    `search/recents.ts`. Has a top-left close now as well as Escape.
21. **◑ Full-text search** — **and it is not FTS5.**
    The search panel, the match snippets and the click-to-jump-with-highlight-
    pulse are all real (`data/search.ts`, `search/extract.ts`, `search/rank.ts`,
    `search/jump.ts`). What is underneath is a plain `search_index` table (one
    row per page: plain text + headings JSON) maintained from JS — `savePageDoc`
    calls `indexPage`, `ensureIndexFresh()` sweeps for anything written outside
    that hook and drops orphans — with **ranking in JS over the in-memory
    index**, which is fine for a personal library of hundreds of pages.
    The table is created with `CREATE TABLE IF NOT EXISTS` because the wave that
    built it could not register Rust-side migrations. The FTS5 upgrade is
    written out step by step in the header of `src/data/search.ts` (external-
    content virtual table + sync triggers, `snippet()`, `bm25()`, JS kept as the
    browser-dev fallback) and nothing else has to change to take it.
22. **✅ Trash & restore**: soft-delete books to the trash (floor -1); restore or
    empty (permanent delete asks confirmation).
    → `TRASH_FLOOR = -1` in `data/books.ts`; a trashed book keeps its
    `bookcase_id`, so **every bookcase has its own floor -1**. Opened from the
    shelf's left dock rail — the in-case drawer front it originally shipped as is
    gone.

## Group D — Import/export & templates
*(`src/features/templates/`, `src/editor/script/exporters/`, `src-tauri/src/export.rs`, `import.rs`)*

> **23–26 were "✅" for a wave while being unreachable.** All four were finished,
> unit- and e2e-tested, and had no button anywhere in the app: the only way in
> was `window.__nbGroupD`, the dev bridge group D put up *"before the rail
> buttons are wired"*. The buttons were never wired, and the e2e specs drove the
> bridge, so nothing failed. They have homes now — the shelf dock, the
> bare-plank right-click card and the book rail for the gallery; the rail's
> "Take it out" sheet (`views/rail/SharePanel.tsx`) and the settings sheet's
> "Library files" section for the exports and the import — plus four rebindable
> shortcuts in `data/keybindings.ts` and `scripts/probe-groupd.mjs`, which
> deletes the bridge before it clicks anything. `tests/plugged-in.test.ts` part
> three is the standing alarm for the next one.

23. **◑ Export book/page to PDF** — shipped, but **not** "Tauri print-to-PDF via
    a hidden window".
    The frontend rasterizes every page at 2× through the flip snapshot pipeline
    (`exporters/capture.ts`, offscreen so no caret or selection chrome appears)
    and hands the JPEG bytes to `export_pdf` in `src-tauri/src/export.rs`, which
    assembles the PDF by embedding the raw JPEG streams verbatim through the
    DCTDecode filter — **no imaging or PDF crate**. `exporters/pdf.ts` is the
    TypeScript twin used in browser dev and as the fallback; keep the object
    layout in sync. Book *and* page scope, chosen in `ExportPdfDialog.tsx`
    (top-left close; the duplicate bottom-right "Cancel" was dropped).
24. **✅ Export page as PNG**: reuse snapshot pipeline at 2×, saved via dialog.
    → `exporters/exportPage.ts` `exportActivePagePng`, with an offscreen render
    when the mounted leaf has no layout, so the export cannot fail just because
    the book view is mid-mount.
25. **✅ Import Markdown**: open .md file(s) → tolerant-parse as Notebook Script
    → new book (one page per H1 or size split).
    → `features/templates/importMarkdown.ts` + `split.ts`; bytes read by
    `read_markdown_file` in `src-tauri/src/import.rs` (BOM/UTF-16-aware, for
    Notepad-saved files), with a hidden `<input type=file>` in browser dev.
26. **✅ Templates gallery**: Cornell notes, lecture notes, flashcard deck,
    weekly planner, reading log; authored as Notebook Script, preview cards.
    → `features/templates/templates.ts` (`cornell`, `lecture`, `flashcards`,
    `planner`, `reading-log`) + `TemplatesGallery.tsx`.
27. **✅ Custom stickers**: import PNG/SVG → user sticker library, in the sticker
    palette + script vocab (`{sticker=user:name}`).
    → `features/templates/userStickers.ts` (assets table + `save_image_asset`,
    `meta.customSticker`), `UserStickersSection.tsx` — the one grid whose length
    the *reader* decides, and the last one to get the ~20-item cap.

## Group E — Ambience & sound
*(`src/sound/`, `scripts/gen-sounds.mjs`, `public/sounds/`)*

28. **◑ Soundscape picker** — shipped, and the premise is obsolete.
    The item says "synthesize 3 more ambient loops". **Nothing is synthesized any
    more.** Synthesising every cue was tried twice and reported bad twice; every
    shipped WAV is now sliced from a real CC0 / public-domain field recording
    and `gen-sounds.mjs` is a source-to-cue pipeline (fetch → decode → slice →
    condition → emit) that also writes the credits manifest. There are **ten**
    soundscapes, not four — rain, storm, fireplace, crickets, night, wind,
    stream, forest, shore, cafe — with a crossfade on switch. The old synthetic
    "library ambience" bed was deleted outright: it was an empty room tone with
    no source, and it read as creepy.
    Two obligations attached to this item: the one CC BY 4.0 source is credited
    in-app from the manifest (`sound/credits.ts` + `SoundCredits.tsx`), and
    **a human still has to listen** — every judgement so far is spectral
    measurement by an agent that could not play audio.
29. **✅ Typing sounds**: optional soft pencil-scratch keystrokes
    (velocity-varied, rate-limited, off by default).
    → `sound/engine.ts`; `defaults.ts` `typingSounds: false`.
30. **✅ Hourly chime**: optional very soft chime.
    → `chime-hour` ×3 variants; `defaults.ts` `hourlyChime: false`.

**Landed in this territory but not on the list:** a sound *set* the reader picks
the way they pick a binding or a room (`sound/soundSets.ts` +
`soundSetPrefs.ts`), and UI click sounds (`sound/uiClicks.ts`) — the
most-touched surface in the app had no audio at all, which made the rest of the
sound design feel arbitrary. Still open: importing your OWN set.

## Group F — System polish
*(`src-tauri/src/backup.rs`, `tray.rs`, `src/features/system/`)*

31. **✅ Backups**: the settings toggle is real — zip the SQLite + assets to a
    chosen folder on the configured cadence; restore flow.
    → `features/system/backup.ts` (scheduler; last run stamped under its own
    `backup:lastRun` key, deliberately outside the `app` blob so scheduler state
    never churns preferences) + `src-tauri/src/backup.rs`, which writes a
    `prerestore-*.zip` safety copy before it swaps anything and includes the
    SQLite sidecars so a WAL-mode db restores intact.
32. **✅ Window niceties**: remember maximized state; optional launch-into-last-
    book; tray with quick-capture note.
    → `features/system/launch.ts` (`appState:openBookId` in the settings TABLE,
    not the preferences blob) and `tray.ts` (`ensureInboxBook` → an "Inbox" book
    created on demand on floor 0). Maximized state comes free from
    `tauri-plugin-window-state`, registered in `lib.rs`.
33. **✅ Performance HUD (dev)**: FPS + texture memory overlay behind a setting.
    → `features/system/PerfHud.tsx`, gated by `settings.perfHud`; when the
    setting is off nothing renders and no rAF loop runs.

---

## Acceptance discipline — what was promised, and what actually gates it

The original text promised "an E2E spec per feature". **That is not what
shipped**, and pretending otherwise would make the suite look like a coverage
guarantee it is not. What is true:

- **tsc + vitest green.** 51 unit-test files; new pure logic is unit-tested
  (the pagination, ring-buffer, split, rank and normalizer logic all is).
- **15 e2e specs**, grouped by *surface* rather than by feature — `shelf`,
  `shelf-life`, `add-book`, `pull-out`, `pages`, `editor`, `search`, `script`,
  `import-export`, `library-studio`, `settings`, `ambience`, `transfer`,
  `tutorial`, `visual-audit`. Most features are exercised inside one of these;
  some are covered only by unit tests plus a screenshot.
- **Visual features: screenshots, looked at.** Unchanged, and it is the rule
  most often skipped.
- **Seam QA.** Added after this file was written, and the reason it exists: a
  specimen board proves a module draws well in isolation and says nothing about
  whether the app can reach it. Anything that travels store → world is driven in
  the running app (`scripts/probe-*.mjs`, 22 of them) and asserts on the
  **applied** state through the `?fx=force` bridges, never on what was merely
  saved.
- **Mechanical gates that did not exist when this was planned**, and that most of
  the wave-2 surfaces are now subject to:
  `tests/top-left-exits.test.ts` (every back / close / leave control is
  top-left), `tests/tooltips.test.ts` (no native `title=` on a DOM element),
  `tests/design-cache-keys.test.ts` (every axis that varies baked pixels is in
  the cache key), `tests/catalogue-reach.test.ts` (every value of every
  vocabulary axis is named by a selector), `tests/styles.test.ts` (no light
  model), `tests/readme.test.ts` (the counted claims in the README).
- All UI hand-drawn warm-parchment styled; left-rail placement over top bars; no
  scrollbars inside pages. Long option lists cap at ~20 with an "N more" control
  — added later, app-wide, and a performance fix as much as a layout one.

**Deferred deliberately, with the reasoning written down:** FTS5 (item 21 —
the JS index is adequate at personal-library scale and the migration is
specified), and importing your own sound set (item 28 — Howler exposes rate and
volume per play, not a filter node, so a set's levers cannot be applied at
runtime).

Live work carries on in `TODO.md`; this file is closed as a plan.
