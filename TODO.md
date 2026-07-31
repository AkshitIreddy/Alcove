# Bellanote — running TODO

Nothing gets forgotten here. Tick items when *verified in the running app*, not
when written — and where two colours or two frames are hard to tell apart, use
`shots-now/sample.py` rather than an opinion.

---

## 🔴 Reported 2026-08-01 (second pass) — WORK THIS LIST

### Design quality — the biggest item

- [x] ~~**Where parts JOIN looks unnatural** across many builds~~ — rebuilt
      around one rule: an edge is either a SILHOUETTE or a JOIN. A join squares
      both corners, strokes no ink, and over-draws by `jointBleed` so abutting
      bitmaps overlap; a silhouette flush against its own bitmap's edge is
      pushed out so its ink lands on the canvas instead of half off it
      (`shelfDesign.tracePart/strokePart/partPanel`). The face-frame connector
      specifically: cornice profiles are now full width and band only
      vertically, which makes the corner hole structurally impossible. Machine
      gate: **312 cases (52 builds × 6 patterns × 4 rooms, 3 floors each) over
      magenta, zero holes inside the case**, and zero recess colour on any
      outer face.
- [x] ~~Shading generally is poor~~ — `caseTimber()` derives five values from
      the room's three (`face/arris/edge/deep/recess`); the old
      timber→timberDark step was about a twelfth of a luminance step, which is
      why a board's front edge did not read as a face turning away. Every face
      boundary now gets an arris chamfer plus its ink line, at every boundary
      rather than only where a lamp would be, so it stays carpentry and not a
      light model. `EDGE_FRACTION` is shared by board, post and cornice so the
      case has ONE depth. The patterns carry the same idea: five flat values
      (`pale/face/mid/deep/through`), a cut is a darker face, a proud member is
      read from the sunk ground around it.
- [x] ~~Then take builds to **50**~~ — 52, each with a crest (9 cut
      silhouettes) beside its crown (7 cornice profiles), 13 plank trims, 11
      post trims, 17 openings. Every crest chosen to survive being turned
      upside down, because the plinth is the same bitmap mirrored.
- [x] ~~**Timber patterns do not look like real furniture**~~ — 50, and the
      structural cause is fixed: the old painters sized every motif as
      `face.thick`, so one bookcase carried the same bead at 48/27/22px and
      nothing looked run off the same spindle. `SECTION = 12` world px is now
      constant and a wider member carries the moulding twice with plain frieze
      between, which is what a cornice actually is.
- [x] ~~**Shelf colours: at least 50**~~ — 60, across five families, each
      authored as ONE timber with the turned faces DERIVED in OKLCh (same hue,
      a measured lightness step, a measured chroma loss). The steps are
      measured off the app icon, so every room folds the way the icon does.
- [x] ~~Wallpaper: trim to **50**, even spread, colour the ELEMENTS, control
      sharpness~~ — 50 across 7 families, plus a `tone` axis (8 values,
      resolved from the room's cloth slots so it repaints per theme) and an
      `edge` axis (etched/crisp/soft/blotted, implemented as line weight ×
      contrast × corner radius × wobble — not a blur, which would have to be
      clipped at the tile edge).
- [x] ~~**Tag every design**~~ — builds 16 words, patterns 13, rooms 19,
      papers 12; all four vocabularies fully tagged (`tests/studio-moods.test.ts`
      asserts every id on every axis carries at least one).
- [x] ~~"Surprise me" gains **controllable randomisation**~~ — the studio's
      "in the mood for" row reads `moodTags()` structurally and steers all four
      axes through `withMood`, degrading to the whole vocabulary when a word
      does not reach an axis. The row renders under
      `<Show when={moods().length > 0}>`, so it was invisible until the tags
      landed; the same test now pins that it narrows something.
- [x] ~~Defaults for shelf and wallpaper are **bland**~~ — the default room is
      **Verdigris Library**, a blue-green painted case on warm plaster in
      copper/saffron/ink. Old Athenaeum is kept hex-for-hex (it is what
      `art/flat.ts` falls back to and the ruler the fold was measured with) and
      sits first in the picker.
- [x] ~~The welcome BOOK's default binding is still the bland one~~ — it is
      authored now (`seed.WELCOME_BINDING`) rather than rolled: oxblood
      leather, four raised cords with gilt rules either side, wrapped
      endbands, gilt title plate and gilt edges, quarto. Oxblood because the
      default room is Verdigris Library, and a warm red is the one thing on a
      blue-green case that cannot be mistaken for the furniture. Wear 0.1, not
      0 — pristine reads as a render. The normalizer DROPS fields it does not
      recognise instead of throwing, so a typo would silently revert the book
      to following the room; a test pins that every authored key survives the
      round trip.
- [ ] Design brief throughout: **creative and vivid**

### Shelf rendering

- [x] ~~The shelf is **not centred**~~ — surplus width beyond
      `INTER_CLUSTER_GAP_MAX` goes to the two ends rather than being spent on
      the gaps, which centres the packed row in the case
      (`bookshelf/layout.ts:149`). Left-packing was why it sat off to one side.
- [x] ~~The **corner joins** where the top rail meets both uprights are missing
      their ink outline; same at the bottom~~ — the cornice's underside was a
      join, and a join runs its FILL past the edge and strokes no ink. Under
      the case body that is right; under the two `CROWN_LIP` overhangs it is
      the only stretch with wall behind it rather than case, so all four
      corners ended in a bare colour step while every other edge carried a
      line. The bake was also handing `drawCrown` a box whose bottom sat ~4px
      BELOW the bitmap, so there was nowhere to put the line even if it were
      drawn. Both fixed: `bakeFlatCrown` ends the box on the canvas and lets
      the bleed carry the fill past, and `drawCrown` draws the underside line
      afterwards exactly as `drawPlank` already did. Verified at 12x over
      magenta, top and bottom, on four builds.
- [x] ~~Every new axis must reach the bake cache keys~~ — the invisible half of
      the five vocabularies, and there were **four** hand-spelled copies of
      "what makes this art different" downstream of `WallpaperSpec`, every one
      of them two axes behind since `tone` and `edge` landed:
      `world.wallpaperKeyOf` (would have left the old wall on screen),
      `designPrefs.mergeWallpaperSpec` (rebuilt the spec field by field, so a
      chosen tone survived the session and not the night),
      `designOptions.wallpaperKey` (the picker's tile cache — two papers
      previewing as one card) and `LibraryStudio.sameSpec` (the panel naming a
      preset the reader had already moved away from). All four now call the
      exported `wallpaperAxisKey`. `FLAT_ART_VERSION` → `flat3`, because the
      disk cache validates nothing about a hit and this session changed the
      cornice bake. `tests/design-cache-keys.test.ts` grew suites for the two
      new axes, for the applied-room key and for the picker's card keys.

### Studio / panels

- [x] ~~Settings gear must **travel** with pushed content, not hide~~ — panels
      PUSH now instead of covering. `views/rail/panelPush.ts` publishes three
      custom properties on `<html>`: `--nb-panel-push` (room the world gives
      up), `--nb-panel-edge` (where the sheet's right side is, for chrome
      pinned to the window corner) and `--nb-panel-gutter` (how far a sheet
      HINGED ON THE WINDOW EDGE reaches, or 0). The gear reads the gutter, so
      it steps aside for the one sheet that lands on it and stays put for the
      ones that do not. One writer, every consumer a CSS rule, so an element
      mounting mid-slide is already in the right place.
- [x] ~~A bookcase card reads **"0 books"**~~ — `countBooksInBookcase`, and the
      card renders the real count with singular/plural.
- [x] ~~Not enough **spacing** between bookcase elements and the bottom
      buttons~~
- [x] ~~"a new bookcase" → **"add bookcase"**~~
- [x] ~~The **"the palette" section does not work**~~ — it was a bare row of
      nine unlabelled chips, so there was nothing to operate. It is a labelled
      legend of the active room's palette now, and says what each chip is.
- [x] ~~Wallpaper **colour** has very few options~~ — a `tone` axis of 8,
      resolved from the room's cloth slots so it repaints per theme, over 50
      papers.
- [x] ~~Can a reader **clone a shelf** (the shelf only, not its books)?~~ — a
      `clone` chip on each bookcase card copies the three stores that make a
      case look like itself (the validated room blob, the `designPrefs`
      carpentry and paper, the floor count) and no books. It deliberately does
      not switch to the copy: landing in an identical-looking case with every
      book gone reads as a catastrophe. Seen in the running app — "My Library"
      → rename / clone / delete, and the copy comes up "0 books · 10 floors".
- [ ] Book options on right-clicking a shelf inside the library tab — the other
      half of that line, not started
- [x] ~~Rooms may be redundant now that they only change colour~~ — **keep
      them.** They stopped being only colour: a room is a colour scheme *and*
      the default carpentry and paper a new bookcase is dressed in, and there
      are 60 of them behind a searchable picker. The concept is now the only
      thing standing between the reader and four orthogonal vocabularies.

### Book interaction

- [x] ~~**Do not auto-open a book** on click or drag~~ — pulling a spine used
      to run straight into the book view, with no way to say "wrong one" but
      to open it and close it again. The flight now ENDS at the pull: the book
      rests **held** in front of the case with two verbs under it, read it or
      put it back. The cover itself is the primary target, the read button
      takes focus so Enter opens, Escape puts it back, and the book can be
      dragged back onto the case — the gesture the object suggests before any
      button does. Two clicks to read, both of them on the book.

### Book studio

- [x] ~~Remove the new-book **wear** setting~~ — gone; every element of a new
      book is randomised instead.
- [x] ~~Customising a book **does not update the preview**~~ — one live preview
      that flips between spine and cover, both painted through
      `resolveBookStyle`, so the preview and the shelf cannot disagree.
- [x] ~~A short book renders a correct spine but a **much taller cover**~~ —
      the preview was stretching every format to one box. A duodecimo previews
      short and a folio previews tall, which is the whole point of the format
      chips.

### Tutorial / onboarding

Rebuilt. Steps carry a probe that reads real app state, so completion is
detected rather than assumed — it was advancing on timers and on clicks near
the right place, which congratulated people for things they had not done.

- [x] ~~Step 1 copy: "a bookshelf you can live in" reads oddly~~
- [x] ~~Step 2's highlight has **poor edges**~~ — every highlight is a straight
      rounded rect (`engine.roundedRectPath`), not a traced outline.
- [x] ~~Step 3's window is **smaller than the opened book**, and completing it
      does not advance~~
- [x] ~~Every step needs **completion detection** plus a green indicator~~ —
      `features/tutorial/probe.ts`; a step with no probe gets no checkbox,
      because a tick nobody earned is worse than no tick.
- [x] ~~**Space advances the tutorial**~~
- [x] ~~Step 6: highlight does not cover the whole block, six dots sit outside
      it, instruction should say right-click then drag~~
- [x] ~~Step 8 does not move the note aside so the panel can be used~~
- [x] ~~Step 9 (the AI feature) needs elaborating~~

### Editor / pages

- [ ] Large text sits **too high above its baseline** — visible in the Welcome
      book on "Make it yours" and the Diagrams heading
- [x] ~~Turning a page **selects all the text**~~ — `PageFlipController`
      clears the selection at every reparenting point, and the flip surface is
      `user-select: none`.
- [x] ~~**Page flicker after a turn**~~

### Sound

Every cue was synthesized from scratch, which is why the set kept reading as
cheap however much it was tuned. They are CC0 / public-domain recordings now,
processed by `gen-sounds.mjs` from one table that also writes the manifest.

- [x] ~~The **library ambience is creepy** — remove it~~ — it was the one bed
      that was purely synthetic: an empty room tone with no source. Gone.
- [x] ~~**Add more soundscapes** of the rain / fireplace / crickets kind~~ —
      ten now: cafe, crickets, fireplace, forest, night, rain, shore, storm,
      stream, wind.
- [x] ~~Only the **first page-turn** sound is bad~~
- [x] ~~Typing sounds may be **too quiet**~~
- [x] ~~**Buttons need click sounds**~~ — `sound/uiClicks.ts`. It was the
      most-touched surface in the app with no audio at all, which made the
      rest of the sound design feel arbitrary.

### Process

- [x] ~~Drive the app with Playwright as a matter of course: act, screenshot,
      check. Make it a skill.~~ — `~/.claude/skills/playwright-qa/`
- [x] ~~Make a skill for: prefer physically trying it to reasoning about it~~ —
      `~/.claude/skills/try-it-first/`

## 🔴 Found by looking, 2026-08-01 (after the variety waves)

- [x] ~~**The settings gear is HIDDEN while a panel is open, not moved.**~~ —
      fixed via `--nb-panel-gutter`; see the Studio / panels section above.
- [x] ~~**A bookcase card reads "0 books" while books are visibly on its
      shelves.**~~ — `countBooksInBookcase`. Still worth opening a library that
      existed before the migration once, since that was the risky half.
- [ ] Wallpaper defaults to `plain-parchment`, so none of the 50 papers show
      until one is picked. Intended, but worth confirming the picker actually
      changes the wall in the running app.
- [ ] The room axis now has 60 entries and `LibraryStudio`'s two `ColourRow`s
      still render `<For each={THEME_IDS}>` — 60 swatch dots each, twice, in a
      376px panel. Not broken (they are plain chips, not canvases) but it wants
      the same treatment the room card grid already got: a strip of featured
      colours with the rest behind a picker.
- [ ] `data/bookcases.ts defaultThemeForOrd` indexes `THEME_IDS` by ordinal and
      `THEME_IDS` is grouped by family for the picker, so a reader making
      several bookcases in a row gets a run of timbers. Documented as a
      deliberate trade at the declaration; stride or hash if it matters.
- [ ] `docs/design/library-themes.md` still describes four rooms.

## 🔴 Reported 2026-08-01

### Sound — LICENCE OBLIGATION, do not ship without this

- [x] ~~**One shipped cue is CC BY 4.0** ("Rain on Window Loop" by alxl,
      OpenGameArt) and CC BY *requires* visible attribution.~~ — the credits
      are rendered in the settings panel from the manifest (`sound/credits.ts`
      + `SoundCredits.tsx`, mounted at `SettingsPanel.tsx:806`). Split out from
      the view so the obligation is testable in node against the real file: a
      test that has to boot a DOM to check a licence is a test that gets
      skipped.
- [ ] A human still needs to **listen**. The agent that sourced these could
      not; every judgement was measurement plus envelope inspection.
- [ ] `npm run sounds` needs ffmpeg on PATH and is Windows-only (PowerShell
      unzip) — fine for a Tauri/Windows app, breaks if CI ever runs Linux.

### Sound — needs a real redesign, not another synthesis pass

Synthesising every cue from scratch has now been tried twice and is still
reported bad. Stop synthesising. Find a **permissively licensed** effects
library (CC0 / CC-BY with attribution we can actually ship) and curate real
recordings.

- [x] ~~Replace `scripts/gen-sounds.mjs` output with curated, licensed sounds~~
      — all 56 shipped WAVs are now sliced from real field recordings; no cue
      needed a synth fallback. The script is a source-to-cue pipeline now
      (fetch → decode → slice → condition → emit). Payload unchanged at 6.6 MB
- [x] ~~Page turn, confetti and checkbox are called out as the worst~~ — page
      turns come from three different books so the rotation varies, checkbox is
      a real bell allowed to ring out, confetti is one real strike sounded 3–4×
- [x] ~~Record the licence + attribution for every file we ship~~ —
      `public/sounds/CREDITS.json`, one entry per cue. **Verified split: 34
      public domain, 21 CC0, 1 CC BY 4.0** (counted from the manifest, not from
      the report)
- [ ] **Nobody has listened to any of it.** Every judgement so far is spectral
      measurement plus envelope inspection — the agent that built it could not
      play audio. A human listening pass is the remaining acceptance gate, and
      until it happens this section is sourced, not approved
- [x] ~~**The one CC BY 4.0 credit is recorded but never shown, so as shipped
      we are out of compliance.**~~ — done, read from the manifest rather than
      hard-coded. Duplicate of the licence-obligation item above.
- [ ] `pop-soft` (5 variants) is the one family sourced from an interface pack
      rather than foley, so it is the least papery thing in the set. Kept
      because the alternatives in that duration window were worse; the obvious
      candidate for a second pass

Sources that were **rejected, and why** — worth keeping so the next pass does
not re-tread them: freesound.org is the best CC0 catalogue for this brief but
its robots.txt disallows our agent, so it went unused; archive.org carries
commercial libraries and outright console-game rips re-uploaded with CC0/PD
tags by people who plainly do not own them, so none of it was trusted; pixabay
sits behind a bot challenge; zapsplat needs an account; Sonniss is multi-GB.
One licence ambiguity was resolved conservatively: alxl's file shows a CC0
badge but its structured licence field says CC BY 4.0, so we honour the
stricter reading and ship the credit, which satisfies either.

### Editor — block dragging is finicky

- [x] ~~Hovering text makes the six-dot drag handle **flicker**~~ — the handle
      parented itself *inside* the page, so its own hover repositioning read as
      an edit to FlipSurface's mutation observer → snapshot → `.snapshotting`
      hid the handle → re-anchor → forever. Measured: **21 full page
      rasterizations during 2.5 s of holding the pointer still**. Fix is
      placement, not damping — `hoistHandleLayer()` moves the wrapper to
      `<body>`, and the entry keyframe (which literally animated the box) is
      gone. After: **1 distinct state across 30 frames, 1 rasterization**
- [x] ~~After a failed move the handle **jumps to the centre**~~ — the
      extension never cleared its cached node/pos on an abandoned drag, and
      `dragHandler` left a stale `NodeRangeSelection` that the *next* grab
      dragged instead of the block under the handle
- [x] ~~Moving sections generally: not smooth, not error-free~~ — grab lane
      widened to the full 40px gutter, a real inked drop indicator (the
      dropcursor had no class at all, so it could not be styled), edge
      auto-scroll on one rAF loop, drop-outside is a clean no-op
- [x] ~~Checkbox click effect and the confetti animation are **laggy**~~ —
      ~85% of an edit window was inside html-to-image, driven by the hover loop
      above. Synchronous cost of a real tick is now **13.4 ms**
- [x] ~~Confetti colours are bland~~ — four silhouettes over 14 real tokens
      spanning hue *and* value, independent spin/sway/flip rates, and one
      canvas sized to the burst footprint (**28% of the viewport, not 100%**)

### Page turn

- [x] ~~Drop the **yellow corner tint** on the turn hotspot~~ — `spread.css`
      was filling the hotspot with `--wash-amber-light`; neutralised
- [x] ~~A **straight line near the bottom-right corner**~~ — `.nb-page-curl`
      carried a stray 1px left border standing beside the dog-ear wedge
- [x] ~~**Click** (not drag) to turn forward is not smooth~~ — the first GL
      draw was queued for the *next* rAF, so every flip began with one frame of
      empty canvas over a hidden leaf; plus the snapshot loop below
- [x] ~~The page reads as **disconnected from the spine**~~ — the fold line
      swept past the gutter to x=−W, putting the leaf's inner edge on the
      cylinder (**measured 101px off the gutter at p=0.85**). The fold is now a
      distance from the spine that sweeps to 0 and never goes negative, with
      the radius going to 0 at both ends so the landing is an exact mirror
- [x] ~~Pages holding a **tree/timeline diagram go dark**~~ — html-to-image
      deep-clones `<svg>` without copying computed styles, so class-styled
      shapes lose their paint and SVG's initial fill is *opaque black*. New
      `svgSnapshot.ts` inlines the resolved paint for the capture. Measured on
      the real Diagrams page: **58,765 dark pixels before, 1,635 after**
- [x] ~~After a drag turn completes, a **half-second flicker**~~ — the p=1
      raster covered the freshly committed spread for two frames, and those
      frames were ~300 ms each because of the snapshot loop. The end-state draw
      and the navigate now happen in one task; clear and reveal in one callback

### Focus mode — NOT STARTED this round

- [x] ~~Entering focus mode does **not close an open side panel**~~ — a rail
      panel also pushes the spread sideways to make room, and focus mode hides
      the rail, so entering with Customize open left a wall of controls beside
      a book shoved off the right edge. `setFocus(true)` clears the panel.
- [x] ~~**No obvious way out.**~~ — a "leave focus · Esc" chip
      (`BookView.tsx:879`). Escape is also checked BEFORE the defaultPrevented
      guard, because the caret normally sits in a page and ProseMirror eats
      its own Escape.

### The "what can I add" catalogue

- [x] ~~"Stickers and effects" is where every insertable thing lives, but the
      name hides it~~ — it is the **catalogue** now
      (`views/rail/CataloguePanel.tsx`), a browsable index of everything that
      can be dropped into a page. "Stickers" was naming the whole drawer after
      a fraction of what was in it.
- [x] ~~Add a **fonts** category alongside it~~
- [ ] Many more effects, and more custom element types worth inserting

### Spec automation

- [x] ~~The AI-facing Notebook Script spec should **rebuild itself**~~ — it is
      generated from the parser's own vocabulary now, not maintained by hand.
      `src/script/vocab.ts` carries `*_DOCS` records typed over the `as const`
      arrays they describe, so **adding a name without prose is a compile
      error** — `tsc` enforces documentation, not a reviewer's memory.
      `scripts/gen-spec.mjs` renders 12 generated regions into
      `scripts/spec-template.md` and writes both shipped artifacts.
      `npm run spec` writes, `npm run spec:check` verifies (**passes**), and
      `tests/script/spec-generated.test.ts` fails with the stale lines if the
      checked-in copies drift. It also checks the other direction: every
      container, sticker, attr key, fence, page-style key and leaf directive
      must literally appear in the shipped text, so a name no region happens to
      print is caught too. Gate was proved by adding a fake sticker and
      watching it go red

---

## 🎨 Flat restyle

The app icon's style is the whole visual language: flat colour, one dark
outline, rounded corners, wobbling edges, no lighting. See `src/art/flat.ts`.

- [x] ~~Purge the AI art pipeline~~ — every gen/pack/cut script, all generated
      assets, and the 30 GB ComfyUI install with its models
- [x] ~~`flat.ts` + `flatShelf.ts`~~ — palette, primitives, case parts, spines
- [x] ~~Wall is one flat tint~~ — nothing tiles, so nothing can seam.
      **Superseded**: the wall is a tiled `WallpaperSpec` again (see the
      vocabularies section), but only because `art/wallpaperDesign.ts` is
      seamless *by construction* — every mark is emitted through a torus-aware
      emitter and there is a test that abuts two copies and measures the seam
- [x] ~~`specimen.html`~~ — judge the drawing on its own
- [x] ~~Point the shelf at it~~ — case, spines and covers all draw through it
- [x] ~~Delete the painting stack~~ — brush, materials, flora, leaves, props,
      paper, filters, caseArt, wood, the wallpaper renderers
- [x] ~~Delete the lighting stack~~ — sceneLight, lightRig, art/lighting,
      src/render/*, per-theme light rigs, dust motes
- [x] ~~Restyle rails, chrome and studio~~ — tokens.css on the FLAT palette
- [x] ~~Themes → simple colour schemes~~ — four rooms; **verified by pixel
      sample**: recess, wall, plank, crown and post all repaint on a swap
- [x] ~~Restyle the covers and the pulled-book overlay~~ — the cover is the
      icon's own construction; the overlay hinges about the spine

## 🏛️ Three design vocabularies, and the wiring that makes them real

A room used to be a colour scheme and nothing else, so every library was the
same plank bookcase in new hexes. It now has three orthogonal vocabularies,
each with its own module, and — the part that took a second pass — each one
actually reaches the screen.

- [x] ~~Carpentry: `art/shelfDesign.ts`~~ — 12 builds × 12 timber patterns, 60
      named presets. A build is a coherent set of choices across all four baked
      parts (board trim, upright shaft, what fills the opening, cornice
      silhouette), not a recolour
- [x] ~~Wallpaper: `art/wallpaperDesign.ts`~~ — 19 patterns × 5 scales × 4
      reliefs × 6 ink slots, 55 presets, seamless by construction
- [x] ~~Bindings: `art/bookDesign.ts`~~ — 10 spine shapes × 10 materials × 12
      decorations, 62 presets picked deterministically from the book's seed.
      Reads no `flatScheme()`: **a book keeps its own colours in every room**
- [x] ~~The pickers stored and previewed truthfully, and the Pixi world drew a
      plain plank case against a bare wall anyway~~ — the gap is closed:
      `textures.ts` takes `ThemeRequest.design` into all four part bakes,
      `world.ts` bakes the wallpaper tile onto the backdrop, `spines.ts` draws
      through `drawBookSpine`. Verified in the running app, not by unit test:
      `scripts/probe-vocabularies.mjs`, `probe-bindings.mjs` and
      `probe-studio-wiring.mjs`, screenshots in `qa/ui/vocab-*`, `binding-*`,
      `studio-*`
- [x] ~~`wallTileScale` forced one copy of the texture to cover the viewport~~ —
      correct for an authored panel that could not tile, ruinous for a real
      tile: it blew the motif up ~4× so `petite` and `grand` landed on screen
      the same size and the whole scale axis was invisible. Back to
      `max(zoom, 0.35)`
- [x] ~~Mipmaps on the wallpaper tile~~ — off. A wrapped non-power-of-two
      texture bleeds across the wrap when a mip is sampled, and `tileScale < 1`
      is exactly when one is — a soft seam at the zooms that show the most wall
- [x] ~~Every new axis is in every key that stores drawn pixels~~ —
      `shelfDesignTag` in the four case bakes and in `themeKeyOf`, all four
      wallpaper axes in `wallpaperTileKey`, the binding in the spine factory's
      params key. `tests/design-cache-keys.test.ts` pins all three, because a
      missing axis is invisible: the disk cache validates nothing about a hit,
      so it serves the wrong art forever on any machine that drew it once
- [x] ~~`themeKeyOf` sat in `textures.ts`, which imports Pixi~~ — moved to
      `libraryKey.ts`, whose whole reason to exist is being loadable in node.
      The key test could not otherwise run
- [x] ~~A binding pinned in the studio repainted the panel preview and nothing
      else~~ — a binding is persisted outside `cover_meta`, so it never
      travelled the `persistBookStyle` → `invalidate` path the other style
      knobs use. `subscribeBookBindings` now drops the affected books' textures
- [x] ~~`data/designPrefs.ts` lived in `views/rail/`~~ — a persistence store
      keyed by bookcase id and book id, imported by the Pixi world. Moved
      beside `data/bookcases.ts`; `art/spines.ts` never imports it at all, the
      pin arrives as `SpineParams.binding`
- [x] ~~Settings offered a 4-way "wood stain" and a 4-way "wallpaper pattern",
      neither of which had reached the screen since the case went flat~~ —
      both rows removed, both fields dropped from `Settings`, and
      `EnvTextures.setStain`/`setWallpaper` deleted. The axes they gestured at
      are real now, far larger, and belong to the **bookcase** rather than to
      the app. The e2e test that asserted they live-applied is deleted, named
      in place — its own claim ("cherry reddens every wood pixel") had not been
      true for a long time
- [x] ~~The shelf's document-level key handler ate arrows/Home/Enter for every
      open panel~~ — the two studio roots guarded themselves, so the trash, the
      TOC and the sticker tray were still driving the shelf behind them. Now
      keyed off `data-nb-panel="open"`, which covers panels added later
- [x] ~~`CustomizePanel` had the book id and did not forward it~~ — the binding
      key fell back to `seed:<spineSeed>`, stable but a *different* key from
      the one the spine factory reads

### Known, deliberate, and not worth chasing

- The recess sprite sits behind the books, so `barrister`'s sash muntins and
  `apothecary`/`pigeonhole`'s dividers are partly occluded. There is no layer
  between reader and shelf to hang a door on; every build puts its signature
  high in the opening, which is what survives
- A board is 40 world px tall and the next floor starts at its bottom edge, so
  a build cannot change the board's silhouette. Fretwork that really hangs
  lives in the opening as the valance
- `toile` and `bird` are only used at `grand`/`large` in the presets; at
  `petite` they turn to mush. Nothing enforces it — preset curation
- `covers.ts` does **not** need `bookDesignTag` in its memo key. Covers draw
  their own front board and never call `renderSpine`, so the binding is not an
  axis there. Recorded so nobody "fixes" it
- The plinth is the crown bake mirrored. If a dedicated base board is ever
  authored in `art/flatShelf.ts`, swap it in `syncCrown` and drop `scale.y=-1`

## 🐛 Reported bugs

- [x] ~~Page content **blackens** during the turn~~ — the shader sampled `.rgb`
      of a possibly-transparent snapshot and forced alpha to 1
- [x] ~~Turning **backwards inverts the pages**~~ — a 'prev' leaf's spine is its
      RIGHT edge, so every face needed its UVs mirrored
- [x] ~~Stray page-turn effect after the flip~~ — the canvas was hidden before
      `renderer.clear()` presented
- [x] ~~Pull-out animation looks cheap~~ — the ghost never inherited the book's
      lean, so it snapped upright one frame before moving; now four beats
- [x] ~~"waste paper" drawer inside the bookcase~~ — now a left-rail item
- [x] ~~Chrome card overlaps the bookcase top~~
- [x] ~~App logo too small in-app~~
- [x] ~~Sound effects rough~~ — every cue resynthesised: attack ramps, no
      clicks, low-passed partials, tails faded to true zero
- [x] ~~Settings changes are slow~~ — the case re-bake went with the painting
      stack
- [x] ~~Dragging empty shelf space pulls a book~~ — **not a bug.** `classifyDrag`
      routes pull vs pan off a hit test; the test drag had landed on the book.

## 🧹 Last inconsistencies with the flat rule

- [x] ~~Move-mode's drop-target hint still draws an additive blurred glow~~ —
      `updateMove()` now spawns the same nine-sliced flat gilt+ink frame the
      hover state uses, sized a hair proud of the incoming book
- [x] ~~`.pulled-book` carries a blurred `box-shadow: var(--shadow-lg)`~~ —
      the token itself is `0 5px 0` now, a zero-blur offset plate, which fixed
      all ~80 call sites at once
- [x] ~~Spoiler bodies hid behind `filter: blur(5px)`~~ — a live CSS filter in
      an interactive path, *and* a readable spoiler (the glyphs survive a
      squint). Now a flat taped-over strip: `--paper-edge` plate, one ink
      outline, `visibility: hidden` under it so revealing costs no reflow
- [x] ~~Sticky-note corner fold had the last soft `box-shadow` in `src/`~~ —
      `-2px -2px 3px` → zero blur
- [x] ~~Seven `createRadialGradient`/`createLinearGradient` calls in
      `art/charms.ts`~~ — specular highlights, i.e. a light source. All of it
      was dead code from before the restyle (`spines.drawSpineRibbon` and
      `covers.paintCharm` draw charms flat now); `charms.ts` is the charm
      vocabulary and nothing else
- [x] ~~The flat rule was enforced by hand-auditing the tree~~ —
      `tests/styles.test.ts` now gates every file in `src/styles/`: no
      `blur()`, no `backdrop-filter`, no non-zero box-shadow blur radius, no
      blend modes, and the handwriting font floors (13px, 20px for Caveat)
- [x] ~~Smooth two-stop CSS gradients~~ — **not a violation, and the rule was
      wrong.** `flat.ts` said "no gradients"; the icon it was derived from
      carries three `linearGradient`s of its own. A soft wash reading as
      pigment or tinted paper is inside the style — what is banned is a light
      MODEL (a highlight placed to imply a lamp). Rule corrected in `flat.ts`,
      the sweep that had started was reverted, and `tests/styles.test.ts`
      deliberately does not gate gradients

## 🧩 Features still missing

- [x] ~~Import/export only reachable via `Ctrl+Shift+E` / `Ctrl+Shift+I`~~ —
      a "Library files" section in settings, rows calling the same
      `openTransferPanel()` the shortcuts do, each showing its combo
- [x] ~~Settings row to replay the guided tutorial~~ — "Help → replay the
      tour" clears `appState:tutorialCompleted` and restarts it
- [x] ~~Exportable diagnostics log users can hand to their AI~~ — plain-text
      report (build, GPU, library counts, resolved settings, last 30 errors).
      No page content, no titles, no paths outside the app; stacks are never
      collected and error text goes through `redactPaths`
- [x] ~~Motion design system: unified easing, transitions, spring physics~~ —
      `src/styles/motion.ts` mirrors the `--dur-*`/`--ease-*` tokens for GSAP
      (four durations, four easing roles, unscaled `LINGER_MS` reading times).
      One `motionScale()` decides reduced motion for the whole app
- [x] ~~Notebook Script v2 — variables, reusable styles, strict validation~~ —
      `::let` / `{{name}}`, `::style` + `{use=name}`, and ~55 diagnostic codes
      carrying 1-based line/column and an `expected`. `parse()` stays total
- [x] ~~A library is one endless bookcase~~ — it is a collection of them, each
      with its own id, name, room and books, ten floors unless the reader grows
      it. Rust migration v2 + `ensureBookcases()`, three overlapping guards so
      no library can be lost, and the case now ends with a visible plinth
- [ ] Notion-depth writing: nested toggles, columns, math, footnotes,
      backlinks, sortable tables, selection toolbar
- [ ] Rebuild and verify the NSIS installer

### Bookcases — the edges nobody owns yet

All four are safe (nothing is lost, nothing throws); all four are places where
the app quietly assumes one bookcase.

- [ ] **`features/transfer` does not know about bookcases.** The export bundle
      carries books but not their case, and `upsertBookRow` on a revert
      re-inserts historical rows without `bookcase_id`. The start-up orphan
      sweep adopts them into the first case — there is a test — so an imported
      library lands entirely in the default case rather than being lost
- [ ] **Quick switch and full-text search are library-wide**, deliberately, so
      books never vanish from search. But opening a hit that lives in another
      bookcase does not switch to it, so the reader lands on a shelf that does
      not contain the book they just picked. Wants `switchBookcase` before
      `appState.openBook`
- [ ] **The trash is one drawer for the whole library.** `listTrashedBooksIn`
      exists if it should be per-case; the panel passes the parameterless
      version straight to `createResource`
- [ ] **Moving a book between cases repaints it** when it has no studio style
      override, because un-overridden spines follow the room. Inherent to the
      existing design rather than new — but a book dragged into a
      differently-themed case changes colour, which is the one thing that stops
      you recognising it

## 🔩 Found while making the tree green

- [x] ~~`export-script` and `insert-script` advertised `mod+shift+e/i` — the
      exact combos App.tsx used for the library export/import~~ — the settings
      sheet was naming a shortcut that opened something else. Script pair moved
      to `mod+alt+e/i`; `export-library`/`import-library` are now real entries;
      every handler matches through `data/keybindings.matchesBinding` against
      `settings.keybindings`, so the advertised list *is* the binding
- [x] ~~Settings wrote `--motion-scale` as an inline style, which outranks the
      `prefers-reduced-motion` block in global.css~~ — the OS preference was
      silently overwritten for everyone the moment settings applied (i.e.
      always). `effectiveMotionScale()` folds the two, OS wins, and the
      diagnostics report says so on its own line
- [x] ~~Three private copies of `motionScale()`~~ (RailPanel, PageEditor,
      confetti — plus SettingsPanel and TutorialOverlay, which the motion pass
      did not own) — all now read the shared one
- [x] ~~`parseDiagramSource` returned diagnostics at line 0~~ — it calls the
      mini-language parsers directly, bypassing the `parseDoc` pass that
      locates and sorts, so the diagram popover showed unlocated warnings.
      Both diagnostic surfaces now render `line N:C` plus `expected`
- [x] ~~The drop cursor had no class at all~~ — prosemirror-dropcursor only
      names its element when the `class` option is set, and it wasn't. That
      made `flip.css`'s `.snapshotting .ProseMirror-dropcursor` rule dead, so
      the indicator could bake into a page snapshot. Now passes
      `class: 'ProseMirror-dropcursor nb-dropcursor'`, keeping the ProseMirror
      name so the flip rule works again
- [x] ~~`onTaskToggle` was attached to the page root with no matching
      `removeEventListener`~~ — now cleaned up
- [ ] Shortcuts are display-only in settings ("rebinding is on its way").
      The map is now honest and centrally matched, so rebinding is a UI job
- [ ] The task list in the harness is stale — several entries describe the
      deleted painting/lighting stack
- [ ] **Rasterizing a page is still the largest cost in the editor** — each one
      is a 300–400 ms long task under headless SwiftShader, nearly all of it
      html-to-image's `cloneCSSStyle` copying every computed property of every
      node. It is now correctly triggered only by *actual* edits (it used to
      run forever on an idle book), so this is a cost problem, not a loop

## 🔍 Found by audit

A read-only hunt for bugs nobody had reported, ranked by severity. **Captured,
not fixed** — deliberately, so each one gets its own change with its own
verification. Every line number below was re-checked against the working tree
while writing this list; where the hunt's note disagreed with the file, the
file won (two paths and three line numbers were corrected).

The hunt's original #1 — the page-snapshot cache feeding itself forever on an
idle open book — **is already fixed** and is not listed here; it turned out to
be the shared root cause of the drag-handle flicker, the checkbox lag and the
post-flip flicker above.

### High

1. **Page history from previous sessions is destroyed by the first edit.**
   `src/editor/history/pageHistory.ts:117` reads `rings.get(pageId) ?? []` and
   `:128` persists that with `INSERT OR REPLACE`. Hydration from the DB happens
   *only* in `listSnapshots` (`:150`), and the only caller is
   `src/views/rail/HistoryPanel.tsx:45` — i.e. nothing hydrates unless the user
   has already opened the History panel. **Trigger:** restart the app, open a
   book, type, wait for a save flush (`PageEditor.tsx:181`). Up to 10 restore
   points from earlier sessions are replaced by an array of one. The module
   header explicitly promises the persisted tail "survives restarts". This is
   silent user data loss on the happy path — fix it first.
   *Weaker sibling, same file:* `:151` marks `hydrated` **before** the await, so
   one transient DB read failure permanently disables hydration for that page.

2. **The entire Playwright suite is red before any test body runs**, both
   failures inside `tests/e2e/helpers.ts::openBookView` (`:190`).
   (a) `:193` waits on `.nb-book-view`, which **no component applies any more**
   — verified: the class survives only in `src/styles/editor.css` and
   `src/styles/rail.css`. The book view root is `.nb-spread` now.
   (b) The first-run tutorial auto-starts and its `.nbt-scrim` intercepts
   pointer events, so the book click times out.
   **Trigger:** `npx playwright test`, any spec. Until this is fixed we have no
   end-to-end verification at all, which is why so much of this round had to be
   measured with bespoke harnesses instead.

### Medium-high

3. **Every re-capture leaks an ImageBitmap.** `src/flip/math.ts:337` — `set()`
   drops a replaced value without calling `onEvict`, and `onEvict` is the only
   thing that closes bitmaps (`src/flip/rasterCache.ts` LRU wiring). The
   contract at `rasterCache.ts:25` says "evicted/**replaced** bitmaps are
   `close()`d"; only evicted ones are. `delete()` and `clear()` do fire it —
   `set()`-over-existing is the single hole. **Trigger:** any re-capture of an
   already-cached page, i.e. every real edit. At pixelRatio 2 a ~620×875 sheet
   is ≈8.7 MB of native memory per leak. Note `tests/flip.test.ts:610`
   currently *enshrines* the leak (`expect(evicted).toEqual([])`), so that
   assertion has to be inverted as part of the fix.

4. **A cancelled theme swap can pin a frozen full-viewport snapshot over the
   shelf forever.** `src/features/bookshelf/world.ts:1309` — `applyLibrary`
   calls `beginThemeFade()` (grabs the viewport into a sprite at alpha 1),
   awaits the case bakes, then bails on the generation guard **before**
   `endThemeFade()`. **Trigger:** with room A on screen pick room B, then pick
   A again before B's four bakes land (cold disk cache). The second call sees
   `roomChanged === false` and returns early; the first returns at the guard.
   Nothing ever fades or destroys the snapshot, so the shelf is a still image
   until an actual room *change* replaces it. Clicks still land, which makes it
   read as a render freeze. Reduced-motion users are immune.
   ⚠️ `world.ts` is being edited by another workflow — **re-confirm the control
   flow survives their change before acting.** The bug is in the guard's
   placement, not in the scheme composition they are reworking.

### Medium

5. **Diagrams bake as an empty skeleton into adjacent-page snapshots and into
   whole-book exports.** `src/editor/nodes/diagram.tsx:96` lazy-mounts each
   diagram behind an `IntersectionObserver`; the offscreen staging host sits at
   `left:-12000px`, so it never intersects and the dashed
   `.nb-diagram-skeleton` (`:146`) is what gets captured. **Trigger:** turn to a
   page whose neighbour holds a diagram; also every PDF/PNG whole-book export.
   Distinct from the "diagrams go dark" defect fixed above — empty frame, not
   black. Fix is to treat a node inside `.nb-export-sheet` as immediately
   visible.

6. **Script/PDF export still has the black-SVG bug** that the page flip just
   fixed. `src/editor/script/exporters/capture.ts:93` uses the same
   html-to-image `toCanvas` recipe and does **not** import `inlineSvgStyles`
   (verified). **Trigger:** export any page containing a diagram. One import
   from `src/flip/svgSnapshot.ts` and the same wrap.

7. **Pasting an image that fails to store does nothing at all, silently.**
   `src/editor/media/pastePlugin.ts:89` returns on an empty source list; the
   per-file `catch` at `:81` maps every failure to `null`, and `handlePaste`
   has already called `preventDefault()` and returned `true`, so ProseMirror's
   default paste is suppressed too. **Trigger:** paste an image when
   `save_image_asset` rejects (unwritable app-data dir, disk full, refused
   format) or the asset-row DB write fails. Clipboard consumed, no block, no
   toast, no console line. A `notify()` helper already exists in
   `src/editor/script/exporters/toast.ts`.

8. **Modal dialogs with no focus management.** Four carry `aria-modal="true"` —
   `src/features/templates/ExportPdfDialog.tsx:53`,
   `src/features/templates/TemplatesGallery.tsx:149`,
   `src/features/transfer/TransferPanel.tsx:990`,
   `src/features/tutorial/TutorialOverlay.tsx:513` — and none moves focus in on
   open, traps Tab, or restores focus on close (0 `focus()` calls in each).
   `src/views/CheatSheet.tsx:55` is the milder case: `role="dialog"` without
   `aria-modal`, same absence of focus handling. **Trigger:** open Export PDF
   from the rail with the keyboard — focus stays on the rail button behind
   while `aria-modal` tells assistive tech the rest of the page is inert, so a
   screen-reader user is focused on something their AT has been told does not
   exist. `src/features/settings/SettingsPanel.tsx:519` already does this
   properly and is the pattern to copy.

### Low

9. **A timed-out art job leaks its transferred ImageBitmap.**
   `src/features/bookshelf/artOffload.ts:251` returns when the pending entry is
   already gone, dropping the transferred bitmap without `close()`. `inFlight`
   accounting is fine. **Trigger:** a spine taking >30 s (6 s has been measured
   on a software renderer, so reachable but rare).

10. **dpr is a parameter of two texture caches but not of their keys.**
    `src/features/bookshelf/textures.ts:555` (`getPlaque` keys on `label` only)
    and `:525` (`getSelectCaret` keys on nothing). **Trigger:** move the window
    between monitors of different DPI — the first scale is kept forever.
    Colours are fixed, so there is no room-tag hole here.

11. **Dead protocol plumbing in the art worker bridge.**
    `artOffload.ts:245` writes `slot.ready = true`, which `pickSlot()` (`:236`)
    never reads. `ART_PROTOCOL_VERSION` (`artJobs.ts:23`, documented as "bump
    when a job's meaning changes so a stale worker bundle is obvious") is
    posted by the worker and **never compared by the host** — bumping it does
    nothing. Harmless today, actively misleading the day someone relies on it.

12. **Purge leftovers that still allocate.** `floorView.ts:317`, `:323`, `:813`
    build sprites from `getStarCharm`/`getRibbon`/`getEmptyDoodle`, all of which
    now return the shared 1×1 transparent texture. Dead work, not a failure —
    destroy paths were checked and the shared texture is not at risk.

13. **Dead rules and doc drift left by this round's fixes** (each is a deletion
    someone with ownership should make): the two `spread.css` declarations that
    caused the yellow tint and the stray hairline are now overridden from
    `flip.css` and can go at source; `src/styles/flip.css:135`'s
    `.snapshotting .nb-drag-handle { display: none }` is the rule that *caused*
    the handle flicker and is now unreachable; `.nb-drag-handle` still appears
    in the exclude lists of `rasterCache.ts`, `offscreenPages.ts` and
    `exporters/capture.ts` as no-ops; and `docs/design/page-flip.md:26` still
    documents the fold sweeping to x=−W, which is precisely the geometry that
    detached the page from the spine.

14. **`{color=plum}` on a diagram node is unreachable from script** —
    `DIAGRAM_WASHES` includes `plum`, `WASH_COLORS` does not. Either wire it up
    or drop it.

### Chased and cleared — do not re-investigate

`bakeFlatPart` (`textures.ts:230`) looks like the classic set-scheme-then-await
race, but the `setFlatScheme`/draw/restore sits inside the producer closure,
which `bakeCached` runs synchronously. Every `bakeCached` key traced does carry
the scheme axis, so the stale-art-forever class is genuinely closed.
`PageRasterCache.dispose()`/`capture()` re-check `disposed` after every await.
`PageFlipController.land()`'s `landToken` guard and the context-lost
`committed` check are both correct. `ThumbStrip.tsx:34` never prunes its
canvases, but they are bounded by page count and hold detached 104×132
canvases — too small to call a bug.

## 📈 Measured

| | at the reset | now |
|---|---|---|
| first paint | 4,977 ms | **2,180 ms** |
| max main-thread block | 15,314 ms | not reproduced since |
| idle | 0.1 fps | settles to 1 fps (render-on-demand) |

---

## ✅ Done

- Tauri 2 + SolidJS scaffold, SQLite data layer, design system
- Infinite bookshelf world: virtualised floors, semantic zoom, drag-to-pull
- Block editor: slash menu, drag handles, right-click menu, tables, callouts,
  toggles, stickers, effects, pagination without scrollbars
- Two-page spread with WebGL page-curl flip
- Deliberate blank pages, bounded at four trailing
- Notebook Script: tolerant parser, canonical printer, AI-facing spec dialog
- Hand-drawn diagram renderers (tree, mindmap, flowchart, timeline)
- Media: image paste/drop, link-preview cards, Openverse fetch
- Full-text search + Ctrl+K quick switcher
- Settings panel, guided tutorial, export/import bundles, backups, tray
- Custom icon + NSIS installer; GitHub Actions release on version tags
- README that describes the actual app
