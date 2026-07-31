# Library Themes & the Book Studio

The shelf should not feel like "a bookcase with a stain option". It should feel like *a place* — a room someone built, lives in, and keeps things growing in. This doc defines eight complete library worlds and a per-book customization studio.

Everything here is **procedural + baked once** (see `art-pipeline.md`): generated into ImageBitmaps/atlases at load, cached to disk by recipe version, drawn as sprites. No live filters, no per-frame path work.

---

## 1. Theme framework

A theme is a complete art package, not a colour swap. `src/art/themes.ts` exports:

```ts
interface LibraryTheme {
  id: ThemeId;                  // 'athenaeum' | 'conservatory' | …
  name: string;                 // display name
  blurb: string;                // one line shown in the picker
  wood: WoodSpec;               // palette ramp, grain character, finish
  joinery: JoinerySpec;         // pegs | iron straps | clean mitre | painted+chipped
  crown: CrownSpec;             // cornice profile + carving vocabulary
  rail: RailSpec;               // inlay (gold pinstripe | silver | none | painted line)
  plate: PlateSpec;             // floor label plate: brass | enamel | wood-burnt | paper tag
  wallpaper: WallpaperSpec;     // pattern id + colourway (see §2)
  spineDefaults: SpineTheming;  // material bias + pigment ramp for new books
}
```

> **Removed since:** `light: LightSpec`, `flora: FloraSpec`, `props: PropSpec[]`
> and `motes: MoteSpec`. The deferred lighting pass, the flora pipeline and the
> shelf props were all deleted with the runtime painting stack; the data came
> off `LibraryTheme` with them rather than sit there reading like a promise.

Themes only *bias* per-book art — an explicit per-book override (§4) always wins, so a user's favourite red leather book keeps its identity in every room.

### The eight worlds

**1. Old Athenaeum** — *the refined default.*
Quartersawn dark oak with ray-fleck figure, wax sheen. Brass label plates, hairline gold pinstripe on rails, dentil cornice. Deep tobacco damask wallpaper. Two warm lamp pools, slow drift. Spines: oxblood/forest/ochre leather, raised bands, gilt. Props: brass hourglass, globe, candlestick, inkwell. Flora: one restrained ivy trail from a brass pot on an upper floor. Motes: dust.

**2. Fern Conservatory** — *the greenhouse.*
Sage-painted case, paint chipped at edges to show pale wood beneath. Clean mitre joinery, no metal. Enamel plates. Botanical toile wallpaper in pale eucalyptus. Cool-from-above daylight with a warm floor bounce. Spines: pressed-flower paper, linen, muted botanical pigments. Props: terracotta pots, watering can, glass cloche, seed packets. **Flora: heavy** — ivy and pothos over rails and down the case sides, moss tufts in every joint, a fern spilling off one floor. Motes: pollen.

**3. Moonlit Observatory** — *night study.*
Near-black walnut, pewter/silver inlay, star-punch cornice. Slate plates. Navy constellation wallpaper: tiny gold stars, faint zodiac linework. Cool moon-glow from upper left plus a silver rim on every edge; low warm counter-light. Spines: midnight blue, plum, silver-leaf. Props: orrery, small telescope, moon-phase dial, rolled star chart. Flora: none. Motes: slow silver sparkle.

**4. Cottage Nook** — *warm and lived-in.*
Honey pine, visible knots, softly rounded edges. Painted-line rails. Paper tag plates in a looping hand. Gingham-and-ditsy-floral wallpaper, cream/rose. Late-afternoon sun, long soft pools. Spines: blush, butter, sage cloth with a hand-stitched edge. Props: jam jars of dried lavender, thimble, ball of yarn, knitted bunting strung between floors. Flora: potted geranium, string-of-hearts trailing two floors. Motes: dust.

**5. Scriptorium** — *the monastery.*
Blackened oak timbers, iron straps and rivets. Limewashed plaster wall (not wallpaper — trowel texture, a faint ghost of a fresco). Wood-burnt plates. Candle sconces: warm flicker pools with a subtle breathing cycle. Spines: vellum and parchment, oxblood, illuminated gold initials. Props: quill and inkwell, wax seal and stamp, bound scroll, bell. Flora: none — cobwebs in the upper corners instead. Motes: dust, heavy.

**6. Sakura Pavilion** — *quiet craft.*
Pale hinoki/ash, flawless joinery as the only ornament, no inlay. Small wooden plaques. Rice-paper wallpaper with faint bamboo shadow. Even, soft, high-key light. Spines: indigo, sakura pink, matcha, washi texture, cloth ties instead of bands. Props: tea bowl, ink stone, folded paper crane. Flora: a blossom branch arcing over the crown; moss at one joint. Motes: drifting petals.

**7. Attic Archive** — *found and forgotten.*
Weathered grey barn wood, mismatched planks, exposed nail heads. Lath-and-plaster wallpaper peeling to show slats. Tin plates. A zigzag string of warm bulbs across the case. Spines: kraft, cardboard, typed paper labels, faded cloth. Props: wooden crates, an old suitcase, a dusty jar, stacked newspapers. Flora: cobwebs and one stubborn dandelion in a crack. Motes: heavy dust in visible light shafts.

**8. Amber Apothecary** — *bottles and herbs.*
Warm cherry with brass fittings and tiny drawers below each shelf. Brass plates with etched numerals. Apothecary-label wallpaper: faint botanical prints on amber. Warm glow from the bottles themselves. Spines: amber, rust, copper, label plates. Props: mortar and pestle, brass scales, stoppered bottles with softly glowing contents. **Flora: hanging dried-herb bundles** from the underside of shelves, trailing thyme. Motes: dust with warm sparkle near bottles.

---

## 2. Wallpaper library

`src/art/wallpaper.ts` — twelve tileable patterns, each baked at DPR buckets and **recoloured per theme** (pattern and colourway are independent, so users can mix):

damask · botanical toile · constellation · ditsy floral · gingham-over-floral · rice-paper bamboo · lath-and-plaster · apothecary labels · art-nouveau vine · marbled endpaper · pin-dot · plain limewash.

Rules: contrast stays *very* low (the pattern must never fight the books), pencil-drawn linework at 1–1.5px, seamless at tile edges, one accent motif per tile at low frequency so repetition is hard to read. Each pattern exposes `render(ctx, size, colourway, seed)`.

---

## 3. ~~Flora & growth~~ — deleted

> `src/art/flora.ts`, `art/leaves.ts`, `floraPlan.ts` and `floraTextures.ts` are
> gone, and so is the density slider. It never once looked good: thin vines, tiny
> leaves, specimens popping in one at a time. "Forget about the flower floral."
> The placement logic below was sound and the failure was entirely in the art, so
> it stays written down in case authored foliage sprites ever meet the bar.

The thing that was meant to make a shelf feel alive. All deterministic per `(floorIndex, anchorId, themeSeed)`, all baked.

**Species:** ivy trail, pothos trail, moss tuft, fern frond, hanging herb bundle, blossom branch, trailing string-of-hearts, small potted plant, grass/dandelion tuft, cobweb.

**Growth model:** each trail is an L-system-ish recursive stem — a wobbled spine path with leaves alternating along it at jittered angles and sizes, tapering toward the tip, with 1–2 side branches. Leaves are seeded shape variants (heart, oval, lobed, needle) drawn as double-stroked pencil outlines with a soft wash fill, slight per-leaf hue jitter, and a few curled/darkened older leaves for realism.

**Anchors:** rail tops, shelf undersides, case corners, crown top, joint gaps, pot positions. The theme's `FloraSpec` picks species + density (`none | sparse | lush`) + which anchors are eligible; a global settings slider scales density so people who want a clean shelf get one.

**Occlusion rule:** flora renders *behind* books and never over a spine's title area — it grows around the collection, never on top of it.

---

## 4. Book Studio — per-book customization

Extends the existing `cover_meta` overrides. A book's look is `theme defaults → book overrides`, so every field is optional and unset fields follow the room.

**Spine:** binding material (leather · cloth · paper · vellum · linen · silk) · pigment (12) + hue jitter · raised bands (0–5, gilt on/off) · head/tail bands (striped variants) · ornament stamp (12 + none) · title plate (none · gilt · paper label · debossed) · title font (3) · wear (pristine → well-loved: scuffs, rounded corners, sun-faded panel) · edge treatment (plain · gilt · marbled · speckled) · height & thickness (thickness defaults from page count, overridable).

**Charms** (the delight layer): ribbon marker · tassel · pressed flower tucked in the pages · brass clasp · wax seal · dangling tag. Rendered on the shelf *and* carried into the pull-out animation and the open book, so a book is recognisably itself everywhere.

**Cover:** existing palette/texture/frame/medallion/gilt, plus corner protectors, an inset title plate, and a matching charm.

**UI:** the rail's Customize panel becomes a two-tab studio — *This book* (spine + cover with a live preview that spins between spine and cover view) and *This library* (theme picker with painted thumbnail cards, wallpaper pattern + colourway, flora density, light warmth). Randomise and "surprise me" buttons; every change previews instantly and persists.

---

## 5. Acceptance

- Eight themes visually distinct at a glance in a specimen board; no two read as the same room recoloured.
- A theme switch re-bakes and crossfades without a visible hitch; disk cache keyed by theme so the second switch is instant.
- Flora never occludes a title; density slider reaches genuinely clean.
- A customized book keeps its identity on the shelf, mid-pull-out, and open.
- 60fps maintained: everything baked, sprite-drawn, LOD-aware (flora and props drop out below LOD1; themes still read by colour and silhouette).
