# Library Themes & the Book Studio

> ## What this doc used to say
>
> It defined eight complete library *worlds* — a wood spec with grain frequency
> and ring gamma, a joinery vocabulary, a cornice profile, a rail inlay, a floor
> plate material, a wallpaper pattern crossed with a colourway, a light rig,
> flora, props, dust motes. Fourteen ids, twelve wallpapers, eighteen colourways.
>
> None of it drew anything. The flat restyle (`src/art/flat.ts`) bakes ONE case
> out of a fixed set of shapes, so every "world" came out identical and the
> picker only changed a seed. Data that describes art nobody renders is worse
> than no data: it reads like a promise, and every reader has to discover the
> hard way that it is not kept.
>
> The sections below describe what is actually in the tree. The retired
> vocabulary is in git history and in `RESET-render-architecture.md`.

---

## 1. A theme is a colour scheme

The shelf is one drawing — the app icon's drawing. Same shapes, same ink, same
ornament in every room. What a room may change is the palette on them, and
`src/art/themes.ts` is the whole of it:

```ts
interface LibraryTheme {
  id: ThemeId;                  // one of sixty, grouped by family in THEME_IDS
  name: string;                 // display name
  blurb: string;                // one line on the studio card
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
**there is no midnight room**. A test enforces a luminance floor on every hex, and
the `wall > timber > timberDark > recess` ordering that makes the case read as a
box with a hollow in it.

**Exactly six cloths, in every scheme** — and a spine no longer reads them.

This is the pair most easily confused, so: `ColourScheme.cloths` is the ROOM's
six, and `flat.CLOTHS` is the HOUSE palette, which is **fifty**. A book's spine
takes its colour from the house fifty (`flatShelf.drawSpine`, and `drawBookSpine`
after it), *never* from `flatScheme()`. A book keeps its own colours in every
room, because recognising a spine is how a reader finds a book, and a shelf whose
colours all move together is a shelf you have to re-learn. There is a regression
test on exactly this.

`flat.HOUSE_CLOTHS` is the first six of the fifty — the icon's own — and is what
the room's six are pinned against.

The house palette went from six to fifty for a specific reason:
`spines.clothForPalette` folds twenty pigment NAMES onto the cloths, and at six
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
its draw. `textures.ts` (the case bake) and `LibraryStudio.tsx` (the preview
cards) both set-draw-restore with no `await` in between; the art worker gets the
scheme on the job payload, because a worker is its own module instance and the
main thread's swap does not reach it.

### The rooms

**There are sixty**, across five families, and the ceiling this section used to
describe is gone.

Four was a deliberate ceiling *while a room was only a palette*: four palettes of
one drawing was the whole of the variety, and a fifth would have been a fifth
name for the same picture. Three vocabularies have landed since — carpentry
(`art/shelfDesign.ts`), wallpaper (`art/wallpaperDesign.ts`) and binding
(`art/bookDesign.ts`) — so a room is now one axis of several rather than the only
one, and sixty colourways over 52 builds and 50 papers is variety a reader can
actually see.

Each is authored as ONE timber with its turned faces DERIVED in OKLCh — same
hue, a measured lightness step, a measured chroma loss — with the steps taken
from the app icon, so every room folds the way the icon does. `THEME_IDS` is
grouped by family so the picker reads as a palette; `FEATURED_THEME_IDS` is the
eight the studio shows before you ask for the rest.

| id | name | the idea |
|---|---|---|
| `athenaeum` | **Old Athenaeum** | Warm oak, parchment plaster, terracotta cloth — the house style, and exactly the palette `art/flat.ts` hard-codes. A test pins the two together hex-for-hex, so it cannot drift away from the vocabulary. First in the picker |
| `verdigris` | **Verdigris Library** | The default: a blue-green painted case on warm plaster, in copper, saffron and ink |

The other fifty-eight are in `art/themes.ts`; listing them here would be a second
copy to go stale, which is what happened to this table.

`getTheme` falls back to the default for any id it does not know — a library
saved in the retired Sakura Pavilion opens in the Old Athenaeum rather than
failing.

### The wall a new library opens on

Two constants, deliberately, in `art/wallpaperDesign.ts`:

- `DEFAULT_WALLPAPER_ID` — the paper a NEW library starts with (Quiet
  Pinstripe). It has to show *something* of the fifty, or a reader never learns
  the wall is theirs to choose.
- `FALLBACK_WALLPAPER_ID` — what an unknown id resolves to (Plain Parchment,
  the bare wall). A corrupted setting should give a visible nothing you can fix,
  never a paper you did not pick.

They were one constant, and the second silently vetoed the first.

## 3. ~~Flora, props, lighting~~ — deleted. Wallpaper — rebuilt.

`art/flora.ts`, `art/leaves.ts`, `art/wood.ts`, `art/props.ts`, `floraPlan.ts`,
`floraTextures.ts` and the deferred lighting pass are all gone, along with the
density slider, the wall-finish row and the "surface depth" slider that drove
them. The flora never once looked good: thin vines, tiny leaves, specimens
popping in one at a time. *"Forget about the flower floral."*

The wall went with them, and then came back.

For a while it was one flat tint on a white pixel — `scheme.wall`, no tile and
therefore no seam, which was the whole argument for it: the pale corner banding
reported at every zoom was a seam, in every version that had one, procedural
strip and generated panel alike.

It is a tile again, and what earned it back is that `art/wallpaperDesign.ts` is
seamless **by construction** rather than by care: the mark emitter is
torus-aware and the lattice is fitted to the tile, so a pattern cannot be
*nearly* seamless. 50 patterns × 5 scales × 4 reliefs × 6 ink slots × 8 tones ×
4 edges, over 126 named papers.

Two things `world.ts` must keep doing when it bakes that tile onto the backdrop
TilingSprite, both of which bring the seam straight back if dropped: tint
`0xffffff` with `addressMode: 'repeat'`, and **`autoGenerateMipmaps: false`** —
a mip sampled on a wrapped NPOT texture bleeds across the wrap.

## 4. Book Studio — per-book customization

Extends the existing `cover_meta` overrides. A book's look is
`theme defaults → book overrides`, so every field is optional and unset fields
follow the room.

**Spine:** binding material · pigment + hue jitter · raised bands · head/tail bands ·
ornament stamp · title plate · title font · wear · edge treatment · height &
thickness. The pigment folds onto one of the six cloths through
`spines.clothForPalette`, which is also what `covers.ts` uses — two different
foldings meant a book that changed colour when you picked it up (amber was ochre
on the shelf and terracotta in the hand).

**Charms:** ribbon marker · tassel · pressed flower · brass clasp · wax seal ·
dangling tag. Carried into the pull-out and the open book, so a book is
recognisably itself everywhere.

**Cover:** palette/texture/frame/medallion/gilt, corner protectors, inset title
plate, matching charm.

**UI:** the rail's studio is two tabs — *This book* (spine + cover with a live
preview) and *This library* (`LibraryStudio.tsx`: the room picker, a read-only
palette legend, and "surprise me"). The cards are painted by `drawCaseCard` —
the same routine the shelf bakes its case from, run under the card's own scheme —
so a card cannot preview a room you cannot get. It did, for a while: the cards
kept painting a wood-grained, wallpapered, watercolour room after the shelf had
gone flat.

## 5. Acceptance

- The rooms read as palettes of ONE drawing — that is the goal, not sixty distinguishable worlds. Shape variety is the job of the three design vocabularies (carpentry, wallpaper, binding), not of the colour axis.
- Every control in the studio changes something on screen. A picker whose buttons do nothing teaches readers to distrust the whole panel.
- A theme switch re-bakes and crossfades without a visible hitch; the bake keys carry the scheme's hexes, so a revisited room hits the disk cache and a colour edited in `themes.ts` invalidates it.
- Picking a room repaints the case, the wall, the books on the shelf **and** the cover in the pull-out. Every cache that stores drawn pixels carries `flatSchemeTag()` for exactly this reason.
- A customized book keeps its identity on the shelf, mid-pull-out, and open.
- 60fps maintained: everything baked, sprite-drawn, LOD-aware.
