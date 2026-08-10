# Alcove

A Windows desktop app built like a storybook library: cozy shelves and patterned walls opening into hand-drawn, Notion-grade block-edited notebook pages. Built with Tauri 2 (Rust) + SolidJS + TypeScript + Vite.

**Two registers, and the words for them are not interchangeable.** The WORLD is flat — the bookcase, the wall, the dock, the studio's preview cards, the picture-block illustrations: flat fills, one ink outline, crisp repeated geometry. That is what `art/flat.ts`, `FLAT` and `flatShelf.ts` are named after. The PAGE is hand-drawn — every diagram runs real pen wobble through `art/wobble.ts`, the type is handwriting, the cards bow, the tape is torn, and the book rail's icons are pre-wobbled by hand. Use "flat" for the first, "hand-drawn" for the second, and "flat, hand-drawn" only for a sentence about the whole app. The owner's ruling, after being shown both side by side; "flaticon" was considered and rejected as a stock-icon brand that undersells the drawing.

## The visual language (binding, and the thing most often got wrong)

Everything drawn in this app follows `assets/brand/icon.svg`, implemented in `src/art/flat.ts`: **flat colour, ONE dark outline colour (`FLAT.ink`) on everything, rounded corners, edges that bow slightly, a tiny palette. No texture, no lighting, no glow, no bloom, no blurred shadows.** Depth is a darker flat face beside a lighter one, plus `contactShadow()` where an object meets a surface.

**Gentle gradients are allowed** — the icon itself uses three, and a soft wash reading as pigment or tinted paper is inside the style. What is banned is a light MODEL: a highlight placed to imply a lamp, a specular, a shading pass, a blur, a blend mode. `tests/styles.test.ts` gates the real rules and deliberately does not gate gradients. (An earlier version of this file said "no gradients" flatly; that was written too wide and cost a pointless sweep across the codebase.)

This replaced a runtime painting stack — brush engine, procedural wood and flora, deferred lighting, generated photoreal materials — that cost ~5s to first paint and still read as cheap. `docs/design/RESET-render-architecture.md` is the decision; several docs under `docs/design/` predate it and carry a superseded banner. Do not reintroduce a light model or a blur "just here".

### The app mark is NOT the drawing reference

There are two brand images and confusing them will send you the wrong way:

- `assets/brand/icon.svg` — flat, the reference above. Cited by `tokens.css`, `art/flat.ts`, `art/palette.ts`, `art/covers.ts` and `tests/styles.test.ts`. **This is the one in-app art follows.**
- `assets/brand/alcove-art.png` — the shipped app/installer icon, a rendered illustration supplied by the owner. Deliberately a different register from the app's interior. It is the source for `scripts/gen-icons.py` and nothing else.

Do not flatten the mark to match the app, and do not add rendering to the app to match the mark.

A library theme is a colour scheme (`FlatScheme` in `art/flat.ts`, `ColourScheme` in `art/themes.ts`): timber, timberDark, recess, wall and exactly six book cloths — 60 of them. `setFlatScheme()` swaps it; the swap must be synchronous around the draw, and every cache holding drawn pixels must key on `flatSchemeTag()`.

**Two cloth lists, and confusing them is the mistake to avoid.** A scheme's `cloths` are the ROOM's six. `flat.CLOTHS` is the HOUSE palette and there are **50** — that is what a spine reads (`flatShelf.drawSpine`, and `drawBookSpine` after it), never `flatScheme()`. `flat.HOUSE_CLOTHS` is the icon's original six, and is what the default room is pinned against. The house palette went to fifty because `spines.clothForPalette` folds the pigment NAMES onto it, and at six "oxblood", "rust" and "clay" all painted the same terracotta — a name that lies is worse than a name you do not have.

A **preset** (the studio's top axis) is not a theme: it bundles colour *and* carpentry *and* paper into one named room. A theme is only the colour half.

### The three design vocabularies (orthogonal to colour)

Colour is no longer the only axis. Three modules add shape, and each is deliberately independent of the scheme — repainting a room must not straighten its arches, and rebuilding a case must not repaint it.

- `art/shelfDesign.ts` — the bookcase's **carpentry**: 52 builds × 50 timber patterns, 113 named presets, `ShelfDesign = { build, pattern }`. Consumed by the four part drawers in `art/flatShelf.ts` and baked by `features/bookshelf/textures.ts`. `resolveShelfDesign` is total: junk out of SQLite gives the house plank case, never a throw. **Two constants, not one** — `DEFAULT_SHELF_DESIGN` is the case a NEW library opens on, `FALLBACK_SHELF_DESIGN` is what an unknown id resolves to. They were merged, and merging them meant choosing a handsome default also made corrupt rows paint it, so a reader could not tell a fallback from their own choice.
  **A build also declares its `headroom`**, required the way `tier` is: how much of the opening is left for a book to stand in. `openingHead` turns it into the depth of the head carpentry and every opening painter sizes its top member from that, so the declaration causes the drawing rather than describing it. `features/bookshelf/bookFit.ts` is the shelf's side — `clearHeightAt` varies ACROSS the bay (tall under an arch crown, a foot shorter at the pier), `floorView` notes where a book stands before asking how tall it is, and `SpineFactory.setBuild` drops any spine baked at the old clear height. A book that still will not fit is trimmed and the book studio says so, with `BookStyle.overlap` as the reader's way to refuse. Before this every book was sized against the flat plank-to-plank gap and the tall ones simply ran up through the arch heads.
- `art/wallpaperDesign.ts` — the **wall**: 50 patterns × 5 scales × 4 reliefs × 6 ink slots × 50 tones × 4 edges, 126 presets. Seamless *by construction* (torus-aware mark emitter, lattice fitted to the tile), which is what earned the wall a tile back after it had been reduced to one flat fill to kill a seam. `world.ts` bakes it onto the backdrop TilingSprite — tint `0xffffff`, `addressMode: 'repeat'`, and **`autoGenerateMipmaps: false`** (a mip sampled on a wrapped NPOT texture bleeds across the wrap and the seam comes back). Same split as the carpentry: `DEFAULT_WALLPAPER_ID` opens, `FALLBACK_WALLPAPER_ID` is the bare wall junk resolves to.
- `art/bookDesign.ts` — a book's **binding**: 3 straight spine shapes, 18 construction-led materials and 59 authored spine programmes assembled into 67 named presets. `drawBookSpine` replaces `flatShelf.drawSpine` inside `renderSpine`. **It reads no `flatScheme()` and must not start**: a book keeps its own colours in every room, which is what lets the reader recognise it. (`flatShelf.drawSpine` still exists for `drawCaseCard`/`drawBookRow` at card scale.) Retired ids normalize into this hard-reset vocabulary; do not restore rounded/capsule shapes, tiled surface fields, tiny spine text, empty title furniture or decorative hardware through a compatibility path.

Where the choices live: `data/designPrefs.ts`, one `settings` blob — `{ rooms: {[bookcaseId]: RoomDesign}, books: {[bookId]: BookPresetId} }`. The **case** owns its build, pattern and wallpaper; the **book** owns its binding. Non-Solid readers use `snapshotRoomDesign()` / `subscribeRoomDesign()` / `subscribeBookBindings()`. `art/spines.ts` never imports it — the pin arrives as `SpineParams.binding`.

**Every one of these axes is a new axis of variation in baked pixels**, so it must appear in the relevant cache key next to `flatSchemeTag()`: `shelfDesignTag()` in the four case bakes and in `themeKeyOf` (which lives in `libraryKey.ts`, not `textures.ts`, so a node test can load it), all four wallpaper axes in `wallpaperTileKey`, the binding in the spine factory's params key. `tests/design-cache-keys.test.ts` pins this. Getting it wrong is invisible: a cache validates nothing about a hit, so a key missing an axis serves the wrong art to everyone who already has the right art under that key — and it keeps doing it until the app is reloaded.

### A library is a collection of bookcases

`data/bookcases.ts` — each bookcase has its own id, name, `room` (a LibraryPrefs JSON blob), floors and books; every book carries `bookcase_id`. Ten floors unless the reader grows it, and the case has a visible bottom (a plinth). Rust migration v2 in `src-tauri/src/lib.rs` plus `ensureBookcases()`; `features/bookshelf/libraryPrefs.ts` keeps its exact public surface but now reads and writes **the open bookcase's** room. Book queries take `bookcaseId` as an optional *trailing* argument, and **omitting it means the whole library, not the open case** — that is deliberate, so search and the quick switcher keep working.

## Architecture decisions (binding)

The five design docs in `docs/design/` are the canonical blueprints — read the relevant one before working in its area:

- `bookshelf-rendering.md` — PixiJS v8 WebGL sprite world + DOM overlay for the focused book. No live SVG filters in any hot path. Camera in log-zoom space, floor virtualization, 3-tier LOD.
- `page-flip.md` — live DOM at rest; during flip gestures swap to a WebGL cylinder-curl shader fed by pre-rasterized page snapshots (html-to-image, idle-time cached). CSS 3D rigid fold is the fallback only.
- `block-editor.md` — TipTap v3 (@tiptap/core, framework-agnostic) with vendored SolidJS bindings in `src/editor/solid/`. One editor per page. Document JSON (editor.getJSON()) IS the storage format.
- `script-language.md` — "Notebook Script": Markdown subset + `:::name {attrs}` directives + fenced mini-languages (tree/graph/timeline). Handwritten tolerant parser in `src/script/` — parse() is total, never throws, returns diagnostics.
- `art-pipeline.md` — bake-once: flat case parts drawn by `art/flat.ts` + `art/flatShelf.ts` and memoized by `art/bake.ts` (keys carry the room's colours, so a hex edit invalidates them). **The cache is memory only — there is no disk cache**, and re-adding one has already been tried and reverted: for flat art the PNG encode costs more than redrawing (measured, `bake.ts` header), it was awaited on the critical path, and it was the app's only eager import of `plugin-fs`. Icons/chrome are pre-distorted vector SVG. Spines are seeded procedural canvas, atlas-packed, painted off-thread. The SVG filter recipes in that doc are historical — nothing consumes them.

`docs/ROADMAP-wave2.md` tracks the 33 customization / quality-of-life features and their group ownership.

## Product rules (from user review — non-negotiable)

- **No scrollbars inside pages.** Pages are fixed-height; overflow flows to the next page via the pagination contract (`PageEditor` peels trailing blocks → `onOverflow` → `BookView` prepends to the next page, creating it if needed).
- **Books drag out of the shelf** (click also works as a quick pull). Plain wheel zooms; shift+wheel pans.
- **Left icon rails, not top bars.** Book tools, page style, customization, stickers/effects all live in the left rail with hand-drawn tooltips. Freed space goes to the pages.
- Right-click opens a Notion-style block context menu; clicking empty ruled space starts typing there.
- Aesthetic bar is a convincingly bound book at shelf scale: straight titleless spines with restrained cords/rules and at most one legible emblem; complete cover titles with one continuous frame and the same focal emblem. Richness comes from authored hierarchy, not repeated wallpaper marks, studs, charms, empty plates or a lighting model.
- Seeding ships exactly one Welcome book; the migration removes old empty demo books without touching user content.

## Map of the app

- `src/art/` — the drawing vocabulary: `flat.ts` (palette + primitives), `flatShelf.ts` (case parts), and the three design vocabularies `shelfDesign.ts` / `wallpaperDesign.ts` / `bookDesign.ts`
- `src/features/bookshelf/` — Pixi world, gestures, spine/cover factories, shelf menu, left dock rail (new book / template / studio / add floor / trash), floor plates
- `src/views/` — `BookView` spread + `rail/` (icon rail and its panels, incl. the library and book studios and their pickers, and `SharePanel` — every way a page leaves the app), TOC/thumbnails/cheat-sheet
- `src/data/` — SQLite access and the persisted stores: `bookcases.ts`, `designPrefs.ts`, `settings.ts`
- `src/editor/` — TipTap setup, custom nodes, slash + context menus, effects, pagination, script bridge, exporters
- `src/flip/` — WebGL page-curl engine and snapshot cache
- `src/script/` — Notebook Script parser/printer (total, never throws)
- `src/diagrams/` — layout algorithms + hand-drawn SVG renderers
- `src/search/`, `src/features/quickswitch/` — fuzzy quick switcher + full-text index
- `src/features/system/` — backups, tray, perf HUD, launch behavior
- `src/sound/` — Howler engine; `scripts/gen-sounds.mjs` synthesizes every WAV from scratch
- `src-tauri/src/` — `media.rs`, `backup.rs`, `tray.rs`, `export.rs`, `import.rs` (all registered in `lib.rs`)

## Conventions

- Package manager: npm. Do not add dependencies without checking package.json first — most things are already installed.
- Fonts (bundled via @fontsource): Caveat Variable = headings/book titles (≥20px only), Patrick Hand = body, Kalam = accents, Architects Daughter = diagram labels, Nunito Sans = UI micro-copy below 13px. Never render handwriting fonts below 13px.
- Palette tokens live in `src/styles/tokens.css`. Warm parchment: cream paper, sepia/graphite ink, washes in amber/terracotta/moss/lemon/sky/blush.
- Animation: GSAP (all plugins free/registered). Transform/opacity only in hot paths; no layout-triggering animation.
- Solid owns all state; Pixi/GL objects are non-reactive mirrors mutated in createEffect. Never diff Pixi through JSX.
- Rust commands live in `src-tauri/src/lib.rs` (split into modules as they grow). SQLite via tauri-plugin-sql with migrations registered in the builder.

## Verify

The owner performs visual and audio acceptance. Do not run or recreate visual
matrices, browser E2E suites, frame-review probes, screenshot gates, audio metric
gates or sound waveform checks.

The repository keeps only a bare-bones code gate:

- `npx tsc --noEmit` for frontend type safety;
- `npm test` for the tiny parser, pagination and version smoke suite in
  `tests/smoke.test.ts`.

Do not install, uninstall or reinstall Alcove on this machine without saying so
first. The owner uses it. Do not push, tag or publish a release without explicit
permission.
