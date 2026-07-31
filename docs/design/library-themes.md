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
  id: ThemeId;                  // 'athenaeum' | 'blossom' | 'reef' | 'apothecary'
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
`SPINE_DRESSING` across all four rooms. Dressing is not colour, and the flat spine
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
letting a room pick its own would turn four palettes into four unrelated
illustrations. That also puts a floor under how dark a scheme may go — every
colour above has to keep the one brown ink legible on top of it, which is why
**there is no midnight room**. A test enforces a luminance floor on every hex, and
the `wall > timber > timberDark > recess` ordering that makes the case read as a
box with a hollow in it.

**Exactly six cloths, in every scheme.** A book picks its cloth by `seed % 6`, so
the *index* is part of the book's identity and never moves; only the hexes it
lands on do. That is what makes a room change a recolour rather than a re-roll of
the whole shelf. A test enforces the count.

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

### The four rooms

| id | name | the idea |
|---|---|---|
| `athenaeum` | **Old Athenaeum** | Warm oak, parchment plaster, terracotta cloth — the house style, and exactly the palette `art/flat.ts` hard-codes. The default; a test pins the two together hex-for-hex, so the default room cannot drift away from the vocabulary |
| `blossom` | **Blossom Grove** | Pale birch against a soft leaf-green wall, in blossom and meadow cloth |
| `reef` | **Coral Reef** | A sea-green painted case against pale sand, in coral and kelp cloth |
| `apothecary` | **Amber Apothecary** | Cherry timber and a dusky rose wall, in amber and oxblood cloth |

Four is a deliberate ceiling. Ten further ids existed as data so old saves would
load; under a colour-only theme there is nothing to keep, and `getTheme` falls
back to the default for any id it does not know — a library saved in the retired
Sakura Pavilion opens in the Old Athenaeum rather than failing.

## 3. ~~Wallpaper, flora, props, lighting~~ — deleted

`src/art/wallpaper.ts`, `art/flora.ts`, `art/leaves.ts`, `art/wood.ts`,
`art/props.ts`, `floraPlan.ts`, `floraTextures.ts` and the deferred lighting pass
are all gone, along with the density slider, the wall-finish row, the eighteen-button
wallpaper row and the "surface depth" slider that drove them.

The wall is now one flat tint on a white pixel in `world.ts`, taken from
`scheme.wall`. A solid fill has no tile and therefore no seam — and the pale
corner banding reported at every zoom was a seam, in every version that had one,
procedural strip and generated panel alike.

The flora never once looked good: thin vines, tiny leaves, specimens popping in
one at a time. *"Forget about the flower floral."*

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

- The four rooms read as four palettes of one drawing — that is the goal, not eight distinguishable worlds.
- Every control in the studio changes something on screen. A picker whose buttons do nothing teaches readers to distrust the whole panel.
- A theme switch re-bakes and crossfades without a visible hitch; the bake keys carry the scheme's hexes, so a revisited room hits the disk cache and a colour edited in `themes.ts` invalidates it.
- Picking a room repaints the case, the wall, the books on the shelf **and** the cover in the pull-out. Every cache that stores drawn pixels carries `flatSchemeTag()` for exactly this reason.
- A customized book keeps its identity on the shelf, mid-pull-out, and open.
- 60fps maintained: everything baked, sprite-drawn, LOD-aware.
