# Library Themes, the Design Vocabularies & the Studio

> ## What this doc used to say
>
> **First**, it defined eight complete library *worlds* — a wood spec with grain
> frequency and ring gamma, a joinery vocabulary, a cornice profile, a rail
> inlay, a floor plate material, a wallpaper pattern crossed with a colourway, a
> light rig, flora, props, dust motes. Fourteen ids, twelve wallpapers, eighteen
> colourways.
>
> None of it drew anything. The flat restyle (`src/art/flat.ts`) baked ONE case
> out of a fixed set of shapes, so every "world" came out identical and the
> picker only changed a seed. Data that describes art nobody renders is worse
> than no data: it reads like a promise, and every reader has to discover the
> hard way that it is not kept.
>
> **Then** it swung the other way: a room is a colour scheme, there are **four**
> of them, and four is a deliberate ceiling. That was true for about a fortnight.
> Three shape vocabularies landed after it and the colour axis itself went to
> sixty, so the doc ended up describing four rooms for far longer than the app
> ever had four rooms. This revision is the correction.
>
> The retired painting vocabulary is in git history and in
> `RESET-render-architecture.md`.
>
> **Section numbers are load-bearing.** A dozen modules and two test files cite
> "library-themes §4" (the Book Studio) and "§5" (acceptance). Renumber only
> together with them.

---

## 0. A room is one axis of four

The most useful sentence in this file: **colour, carpentry, paper and binding are
four independent vocabularies**, and a "theme" is only the first of them.
Repainting a room must not straighten its arches; rebuilding a case must not
repaint it.

| axis | module | the vocabulary | who owns the choice |
|---|---|---|---|
| **colour** — the room | `art/themes.ts` | **60** schemes over 5 families | the bookcase (`libraryPrefs`) |
| **carpentry** — the case | `art/shelfDesign.ts` | 52 builds × 50 timber patterns, **113** presets | the bookcase (`designPrefs`) |
| **paper** — the wall | `art/wallpaperDesign.ts` | 50 motifs × 5 scales × 4 reliefs × 6 ink slots × 50 tones × 4 edges, **126** presets | the bookcase (`designPrefs`) |
| **binding** — a book | `art/bookDesign.ts` | 50 spine shapes × 50 materials × 50 decorations, **189** presets | the book (`designPrefs`) |

Above all four sits a fifth thing that is *not* an axis: a **room preset**
(`ROOM_PRESETS` in `views/rail/designOptions.ts`, **55** of them across nine
classifications) bundles a theme, a build, a timber pattern and a paper into one
named room, so a reader can dress a whole library in one press. A preset *writes*
four values; it does not couple them.

> The word "room" does double duty for historical reasons, and it is worth
> naming: in the DATA a room is the colour blob a bookcase carries
> (`LibraryPrefs`); in the STUDIO the top axis is labelled "room preset" and
> means the bundle. `art/themes.ts` is the data half, and §1–2 are about it.

## 1. A theme is a colour scheme

The shelf is one drawing — the app icon's drawing. Same ink, same ornament
grammar in every room *of a given build*. What the colour axis may change is the
palette on them, and `src/art/themes.ts` is the whole of it:

```ts
interface LibraryTheme {
  id: ThemeId;                  // one of sixty, grouped by family in THEME_IDS
  name: string;                 // display name
  blurb: string;                // one line on the studio card
  family: ThemeFamily;          // timber | painted | jewel | bright | far
  tags: readonly ThemeTag[];    // mood words the "in the mood for" row steers on
  scheme: ColourScheme;         // §2 — the only thing that reaches the screen
  spineDefaults: SpineTheming;  // material/gilt bias for NEW books, derived from the scheme
}
```

`themes.ts` imports nothing, deliberately: it is the type-and-data root, so every
other art module can depend on it without a cycle.

`spineDefaults` survived because it is consumed (`bookIdentity` → `resolveBookStyle`
→ `renderSpine`), but it is now *derived* rather than authored — `pigments` is the
scheme's own cloth faces, and materials/gilt/bands/wear are one shared
`SPINE_DRESSING` across every room. Dressing is not colour, and the flat spine
draws it identically wherever it stands.

Themes only *bias* per-book art — an explicit per-book override (§4) always wins,
so a favourite red leather book keeps its identity in every room.

## 2. The scheme

```ts
interface ColourScheme {
  timber: string;      // case timber, the face turned toward us
  timberDark: string;  // the same board turning away — always darker
  recess: string;      // inside the case behind the books — darker again
  wall: string;        // one flat colour, the lightest thing on screen
  cloths: readonly (readonly [string, string])[];  // exactly six [face, edge] pairs
}
```

**The ink is not in here, on purpose.** One dark outline colour on everything is
most of why the app reads as a single drawing rather than a pile of clip art;
letting a room pick its own would turn sixty palettes into sixty unrelated
illustrations. That also puts a floor under how dark a scheme may go — every
colour above has to keep the one brown ink legible on top of it, which is why
**there is no midnight room**. `tests/art-themes.test.ts` enforces a luminance
floor on every hex, and the `wall > timber > timberDark > recess` ordering that
makes the case read as a box with a hollow in it.

**Exactly six cloths, in every scheme** — and a spine no longer reads them.

This is the pair most easily confused, so: `ColourScheme.cloths` is the ROOM's
six, and `flat.CLOTHS` is the HOUSE palette, which is **fifty**. A book's spine
takes its colour from the house fifty (`flatShelf.drawSpine`, and `drawBookSpine`
after it), *never* from `flatScheme()`. A book keeps its own colours in every
room, because recognising a spine is how a reader finds a book, and a shelf whose
colours all move together is a shelf you have to re-learn. There is a regression
test on exactly this (`art-themes.test.ts`, "does NOT repaint a book when the
room changes").

`flat.HOUSE_CLOTHS` is the first six of the fifty — the icon's own — and is what
the room's six are pinned against.

The house palette went from six to fifty for a specific reason:
`spines.clothForPalette` folds fifty pigment NAMES onto the cloths, and at six
"oxblood", "rust" and "clay" all painted the same terracotta. A name that lies is
worse than a name you do not have.

The room's six still matter — they are what `wallpaperDesign`'s `tone` axis
resolves against, which is how a paper repaints per theme.

`src/art/flat.ts` mirrors this shape as `FlatScheme` — structurally identical,
deliberately not imported, so the two agree without either depending on the
other. `setFlatScheme()` swaps the live palette and every drawing function reads
`flatScheme()`. It is module state rather than a threaded parameter because the
shapes are the same in every room, so an argument would be carried through forty
call sites purely to be forwarded. The cost: a swap must be **synchronous** around
its draw. `features/bookshelf/textures.ts` (the case bake), `world.ts` (the
backdrop and the shelf) and `views/rail/designArt.tsx` (every studio preview
card) all set-draw-restore with no `await` in between; the art worker gets the
scheme on the job payload, because a worker is its own module instance and the
main thread's swap does not reach it.

### The rooms

**There are sixty**, across five families — `timber`, `painted`, `jewel`,
`bright`, `far`.

Four was a deliberate ceiling *while a room was only a palette*: four palettes of
one drawing was the whole of the variety, and a fifth would have been a fifth
name for the same picture. Three vocabularies have landed since (§3), so a room
is now one axis of several rather than the only one, and sixty colourways over 52
builds and 50 papers is variety a reader can actually see.

Each is authored as ONE timber with its turned faces DERIVED in OKLCh — same
hue, a measured lightness step, a measured chroma loss — with the steps taken
from the app icon, so every room folds the way the icon does. `THEME_IDS` is
grouped by family so the picker reads as a palette; `FEATURED_THEME_IDS` is the
**eight** the studio shows before you ask for the rest.

| id | name | the idea |
|---|---|---|
| `athenaeum` | **Old Athenaeum** | Warm oak, parchment plaster, terracotta cloth — the house style, and exactly the palette `art/flat.ts` hard-codes. A test pins the two together hex-for-hex, so it cannot drift away from the vocabulary. First in the picker |
| `verdigris` | **Verdigris Library** | `DEFAULT_THEME_ID`: a blue-green painted case on warm plaster, in copper, saffron and ink |

The other fifty-eight are in `art/themes.ts`; listing them here would be a second
copy to go stale, which is exactly what happened to this table.

`getTheme` falls back to `DEFAULT_THEME_ID` for any id it does not know — a
library saved in the retired Sakura Pavilion opens in the Verdigris Library
rather than failing.

### Two constants per axis, never one

Every axis with a default has **two**, and merging them is a mistake that has
already been made here twice:

| axis | what a NEW library opens on | what an unknown id resolves to |
|---|---|---|
| colour | `DEFAULT_THEME_ID` = `verdigris` | `DEFAULT_THEME_ID` — the room blob is validated field by field, so there is nothing else to fall to |
| carpentry | `DEFAULT_SHELF_DESIGN` = scriptorium / guilloche | `FALLBACK_SHELF_DESIGN` = plank / none |
| paper | `DEFAULT_WALLPAPER_ID` = `pin-quiet` | `FALLBACK_WALLPAPER_ID` = `plain-parchment` |

The opening value has to show *something* of the vocabulary, or a reader never
learns the axis is theirs to choose. The fallback has to be a visible nothing you
can fix — a corrupt row must never silently paint a handsome case the reader
cannot tell apart from a choice they made. One constant cannot be both, and while
each was one constant the second job silently vetoed the first.

## 3. The three design vocabularies

`art/flora.ts`, `art/leaves.ts`, `art/wood.ts`, `art/props.ts`, `floraPlan.ts`,
`floraTextures.ts` and the deferred lighting pass are all gone, along with the
density slider, the wall-finish row and the "surface depth" slider that drove
them. The flora never once looked good: thin vines, tiny leaves, specimens
popping in one at a time. *"Forget about the flower floral."*

What replaced them is not a light model with better numbers. It is shape: three
modules that vary the DRAWING rather than the shading, each independent of the
colour axis and of each other.

### 3.1 Carpentry — `art/shelfDesign.ts`

`ShelfDesign = { build, pattern }` — **52 builds × 50 timber patterns, 113 named
presets**. A build is a coherent set of choices across all four baked parts
(board trim, upright shaft, what fills the opening, cornice silhouette), not a
recolour; a pattern is what is worked into the timber.

Consumed by the four part drawers in `art/flatShelf.ts`, baked by
`features/bookshelf/textures.ts`. `resolveShelfDesign` is total: junk out of
SQLite gives the plank case, never a throw.

Two rules the drawing depends on, both learned from holes in the case:

- **An edge is either a SILHOUETTE or a JOIN.** A join squares both corners,
  strokes no ink, and over-draws by `jointBleed` so abutting bitmaps overlap; a
  silhouette flush against its own bitmap's edge is pushed out so its ink lands
  on the canvas rather than half off it. Cornice profiles are full width and band
  only vertically, which makes the face-frame corner hole structurally
  impossible. The gate is 312 cases (52 builds × 6 patterns × 4 rooms) drawn over
  magenta with zero holes inside the case.
- **`SECTION = 12` world px is constant.** The old painters sized every motif as
  `face.thick`, so one bookcase carried the same bead at 48/27/22px and nothing
  looked run off the same spindle. A wider member carries the moulding twice with
  plain frieze between, which is what a cornice actually is.

Depth is carpentry, not lighting: `caseTimber()` derives five flat values from the
room's three (`face/arris/edge/deep/recess`), and every face boundary gets an
arris chamfer plus its ink line — at *every* boundary rather than only where a
lamp would be.

### 3.2 Paper — `art/wallpaperDesign.ts`

**50 patterns × 5 scales × 4 reliefs × 6 ink slots × 50 tones × 4 edges, over 126
named papers.**

The wall was one flat tint on a white pixel for a while — `scheme.wall`, no tile
and therefore no seam, which was the whole argument for it: the pale corner
banding reported at every zoom was a seam, in every version that had one,
procedural strip and generated panel alike.

It is a tile again, and what earned it back is that the module is seamless **by
construction** rather than by care: the mark emitter is torus-aware and the
lattice is fitted to the tile, so a pattern cannot be *nearly* seamless. A test
abuts two copies and measures the join.

Two of the six axes are worth their own note:

- **`tone`** (50) names a CLOTH SLOT rather than a hue wherever it can — `ember`
  is terracotta in the athenaeum and coral in the reef — so a paper authored
  against one room does not look wrong in another. This is the axis that keeps
  the room's six cloths load-bearing now that a spine no longer reads them.
- **`edge`** (etched / crisp / soft / blotted) is line WEIGHT × contrast × corner
  radius × wobble. **Not a blur**: a blur would have to be clipped at the tile
  edge, and an antialiased clip edge is the pale band this whole module exists to
  avoid — and it is a light-model move besides.

Three things `world.ts` must keep doing when it bakes that tile onto the backdrop
TilingSprite, each of which brings the seam or the scale bug straight back if
dropped: tint `0xffffff` with `addressMode: 'repeat'`; **`autoGenerateMipmaps:
false`** (a mip sampled on a wrapped NPOT texture bleeds across the wrap, and
`tileScale < 1` is exactly when one is sampled); and `wallTileScale` =
`max(zoom, 0.35)`, never "one copy covers the viewport" — that blew the motif up
~4× and landed `petite` and `grand` on screen at the same size, making the whole
scale axis invisible.

### 3.3 Binding — `art/bookDesign.ts`

**50 spine shapes × 50 materials × 50 decorations, 189 presets**, picked
deterministically from the book's seed. `drawBookSpine` replaces
`flatShelf.drawSpine` inside `renderSpine`; `flatShelf.drawSpine` still exists for
`drawCaseCard`/`drawBookRow` at card scale.

**It reads no `flatScheme()` and must not start.** A book keeps its own colours in
every room, which is what lets the reader recognise it.

Every entry declares a `group` and a `tier` (signature / shelf / niche / oddity)
and TypeScript refuses one that does not. The exported order is DERIVED from
them, and `presetForSeed` rolls only `ROLLABLE_PRESETS` (**179** of the 189), so a
reader is never handed an oddity while the studio still offers all of them.

A reader can also compose one axis at a time. A composed binding is an id —
`own:shape/material/decoration/gilt` — so it rides the existing
`Record<bookId, BookPresetId>` with no migration and no new axis for a cache key
to forget. Gilt is its own segment because the preset table says it must be: only
134 of the 189 rows agree with "gilt iff the decoration is a gilt one", so it is a
choice, not a derivation.

### 3.4 Where the choices live, and the cache keys they must reach

`data/designPrefs.ts` — one `settings` blob:

```ts
{ rooms: { [bookcaseId]: RoomDesign },    // build, pattern, wallpaper
  books: { [bookId]:     BookPresetId } } // binding
```

The **case** owns its build, pattern and wallpaper; the **book** owns its
binding. The colour half lives elsewhere — `features/bookshelf/libraryPrefs.ts`
reads and writes the open bookcase's `room` blob in `data/bookcases.ts`. They are
separate because `libraryPrefs` validates its blob down to three fields and would
silently drop a build id smuggled through it.

Non-Solid readers use `snapshotRoomDesign()` / `subscribeRoomDesign()` /
`subscribeBookBindings()`. `art/spines.ts` never imports any of it — the pin
arrives as `SpineParams.binding`.

**Every one of these axes is a new axis of variation in baked pixels**, so it must
appear in the relevant cache key next to `flatSchemeTag()`:

| key | must carry |
|---|---|
| the four case bakes, and `themeKeyOf` in `libraryKey.ts` | `shelfDesignTag()` |
| `wallpaperTileKey`, `mergeWallpaperSpec`, `designOptions.wallpaperKey`, `LibraryStudio.sameSpec` | every wallpaper axis, via the exported `wallpaperAxisKey` |
| the spine factory's params key | the binding (`bookDesignTag`) |

`tests/design-cache-keys.test.ts` pins this. `themeKeyOf` lives in
`libraryKey.ts` rather than `textures.ts` precisely so a node test can load it
without pulling in Pixi.

Getting it wrong is invisible: a cache validates nothing about a hit, so a key
missing an axis serves the wrong art to everyone who already has the right art
under that key — and it keeps doing it until the app is reloaded. There were four
hand-spelled copies of "what makes this art different" downstream of
`WallpaperSpec` at one point, every one of them two axes behind; all four call
`wallpaperAxisKey` now.

## 4. The Studio — per-book and per-library customization

Two tabs behind the rail's Customize brush (`CustomizePanel.tsx`), and the same
sheet opens from the shelf chrome via `ShelfStudio.tsx` — with no book chosen it
is the library tab alone, and "Dress this book…" on a spine makes it the full
two-tab studio, still opening on the room.

### This book — `BookStudio.tsx`

Extends the existing `cover_meta` overrides. A book's look is
`theme defaults → book overrides`, so every field is optional and unset fields
follow the room.

- **Spine:** binding material · pigment + hue jitter · raised bands · head/tail
  bands · ornament stamp · title plate · title font · wear · edge treatment ·
  height & thickness. The pigment folds onto one of the **fifty** house cloths
  through `spines.clothForPalette`, which is also what `covers.ts` uses — two
  different foldings meant a book that changed colour when you picked it up
  (amber was ochre on the shelf and terracotta in the hand).
- **Bind it yourself:** shape, material, decoration and gilt, each pickable on its
  own with every other strip holding still (§3.3's `own:` ids).
- **Charms:** ribbon marker · tassel · pressed flower · brass clasp · wax seal ·
  dangling tag. Carried into the pull-out and the open book, so a book is
  recognisably itself everywhere.
- **Cover:** palette/texture/frame/medallion/gilt, corner protectors, inset title
  plate, matching charm.
- **Page defaults** (line spacing, page style, ink) live on this tab too, since
  they are also "about this book".

One live preview flips between spine and cover, both painted through
`resolveBookStyle`, so the preview and the shelf cannot disagree. Formats preview
at their real proportions — a duodecimo short, a folio tall — which is the whole
point of the format chips.

A binding is persisted OUTSIDE `cover_meta` (§3.4), so it does not travel the
`persistBookStyle` → `invalidate` path the other style knobs use;
`subscribeBookBindings` drops the affected books' textures instead. Getting that
wrong repaints the panel preview and nothing else.

### This library — `LibraryStudio.tsx`

Five things, in this order:

1. **which bookcase** you are standing in;
2. a **room preset** — the whole room in one press, classified (Formal, Grand,
   Antique, Quiet, Cosy, Botanical, Coastal, Storybook, Rustic) so it can be
   browsed;
3. the **colour scheme**, whole-room or one part at a time, with `OwnColour` for
   a hex the vocabulary does not own;
4. how the case is **built**, and what is worked into its timber;
5. what is on the **wall** — paper, scale, relief and ink slot, every one offered
   here rather than reachable only by finding a named paper that used it.

The preset axis is why that order changed. The top of the sheet used to be sixty
ROOMS, and a room is a colour scheme — so the one control that looked like "set
the look of this library" repainted the case and left its carpentry and its wall
exactly as they were, which is the opposite of what the word promises. The colour
row underneath now says out loud that it is colour and only colour.

Applying a preset is two independent store writes (colour to the bookcase's room
blob, design to the studio's settings key), which made the world react twice and
re-bake twice on one click. `queueApplyLibrary` folds every notification in a task
into one application — end of task, not a microtask, because each save awaits its
own store's `load()` and those resolve a different number of ticks apart.

The long axes do NOT live inline: 113 named cases and 126 papers dumped into a
376px sheet is a wall of tiles nobody reads, so each axis shows eight real
previews and a way through to the rest (`DesignStrip` → `DesignPicker`), and the
sheet SWAPS to the picker rather than floating it above — one sheet at a time
keeps Escape, the panel push and the tab ring simple. An "in the mood for" row
reads `moodTags()` structurally and steers all four axes through `withMood`,
degrading to the whole vocabulary when a word does not reach an axis.

Alongside the pickers: a labelled, read-only legend of the active room's palette
(it was a bare row of nine unlabelled chips, so there was nothing to operate),
"surprise me", and per-bookcase rename / clone / delete. Clone copies the three
stores that make a case look like itself and no books, and deliberately does not
switch to the copy — landing in an identical-looking case with every book gone
reads as a catastrophe.

Every tile is painted by the routine that paints the real thing — `drawCaseCard`
for the case, `drawWallpaperCard` for the wall — under the room's own scheme,
through `designArt.tsx`'s synchronous set-draw-restore. A picker that lies about
what you get is worse than no picker, and this one did for a while: the cards kept
painting a wood-grained, wallpapered, watercolour room after the shelf had gone
flat.

## 5. Acceptance

- The rooms read as palettes of ONE drawing — that is the goal, not sixty
  distinguishable worlds. Shape variety is the job of the three design
  vocabularies, not of the colour axis.
- Every control in the studio changes something on screen. A picker whose buttons
  do nothing teaches readers to distrust the whole panel.
- A theme switch re-bakes and crossfades without a visible hitch. The bake keys
  carry the scheme's hexes (plus §3.4's other axes), so a colour edited in
  `themes.ts` invalidates them. **There is no disk cache to hit** — `art/bake.ts`
  is memory-only, and its header carries the measurements for why the disk cache
  was removed rather than tuned (for flat art the PNG encode costs more than
  redrawing, and it was awaited on the critical path).
- Picking a room repaints the case, the wall, the books on the shelf **and** the
  cover in the pull-out. Every cache that stores drawn pixels carries
  `flatSchemeTag()` for exactly this reason.
- Picking a preset costs **one** bake, not two.
- A customized book keeps its identity on the shelf, mid-pull-out, and open.
- 60fps maintained: everything baked, sprite-drawn, LOD-aware.

Unit tests prove a module draws well in isolation and say nothing about whether
the app can reach it. Anything that travels store → world is proved by driving
the running app: `scripts/probe-vocabularies.mjs` (a design choice reaches the
case, the wall and a second bookcase), `probe-bindings.mjs` (bindings through the
whole spine bake path), `probe-studio-wiring.mjs` (the panel, driven only by
clicking), `probe-room-presets.mjs` (rolling and drawing preset candidates).
