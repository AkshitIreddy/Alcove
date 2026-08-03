# Packs — the reader's own work

> Status: **current**. Implemented in `src/features/packs/`, gated by
> `tests/packs.test.ts`, driven end to end by `scripts/probe-packs.mjs`.

The reader asked for this, in these words:

> "option for user to add their own customisation options like textures or
> effects or sound whatever, when uploading for category it will open a popup
> with upload button information on how to do it along with a custom ai prompt
> they give to an ai that will tell it the specifications of how to build and
> package it for the user to upload it here"

Three surfaces come out of that sentence — an **importer**, a page of **human
instructions**, and a **prompt** a model can be handed — and the whole design is
about the one way they go wrong together.

---

## 1. The property everything else is arranged around

**The prompt is generated from the schema the importer validates against.**

A prompt maintained beside a validator drifts, silently, and the failure lands
on the reader: they copy the prompt, a model obeys it exactly, they paste the
result, and the app that told them what to write tells them it is wrong.
Nothing throws. Nothing logs. The feature is worse than absent, because it
wasted an afternoon on the way to being absent.

So there is one description and three derivations:

```
        schema.ts  ← types: what a field is, what a category is
             │
     categories.ts ← the four categories, with every enum READ from the
             │        vocabulary module that owns it
             │
    ┌────────┼────────────────┬────────────────────┐
    │        │                │                    │
validate.ts  prompt.ts   PackDialog (parts 1-2)  PacksPanel
what the    what the AI   what the reader is     what they already
importer    is told to    told to do             brought in
accepts     produce
```

`tests/packs.test.ts` closes the loop from the far end: it lifts the example
back **out of the generated prompt text** and runs it through the **real**
importer. Four more checks hold the seam shut:

- every field key the importer reads appears in the prompt;
- every word an enum accepts is listed in the prompt;
- every word the prompt lists is accepted by the importer;
- every enum's values are `toEqual` the vocabulary module's own array, so a
  fifty-first wallpaper motif reaches the prompt on the commit that adds it.

The last one is the one that matters in a year. A copied list is a list that
goes stale, and nobody notices, because a prompt has no compiler.

---

## 2. What a pack is

One JSON file:

```json
{
  "alcovePack": 1,
  "category": "wallpaper",
  "name": "Ferns and Fog",
  "author": "optional",
  "items": [ … ]
}
```

`alcovePack` is how the app tells a pack from any other JSON on disk. The
number is bumped only when an older file would import **wrongly** rather than
merely incompletely — the validator already reports a missing field by name, so
adding an optional one is not a format change.

### The four categories

| id | intake | an item is | applied by |
|---|---|---|---|
| `wallpaper` | manifest | a `WallpaperSpec` — pattern, scale, depth, ink, and optionally tone and edge | `saveWallpaper` |
| `carpentry` | manifest | a `{build, pattern}` pair | `saveRoomDesign` |
| `sticker` | manifest | a name and inline SVG source | `addUserSticker` (existing) |
| `sound` | **files** | a folder of audio named after the cues | `addUserSoundSet` (existing) |

### Why sounds take files and everything else takes JSON

A model can write a wallpaper recipe and it can write an SVG. It cannot write a
WAV — asking for one gets either a refusal or a base64 blob that decodes to
noise. What a model *is* good at is the twenty lines of arithmetic that
synthesise a click, which is exactly how this repo's own cues are made
(`scripts/gen-sounds.mjs`). So the sound prompt asks for a **generator script**
and the intake stays the file picker `sound/userSoundSetStore.ts` already
built, already ships and already tests.

### Why a wallpaper is a recipe and not a picture

The wall is a `TilingSprite` whose tile is drawn by `renderWallpaperTile`,
seamless **by construction** — a torus-aware mark emitter and a lattice fitted
to the tile. That property is what earned the wall a pattern back after it had
once been reduced to a single flat fill to kill a seam. Hand an arbitrary PNG
to the same sprite and the seam returns immediately, across the widest flat
area on screen, which the reader looks past all day.

So a reader's wallpaper names six axes out of a vocabulary of fifty motifs ×
five scales × four reliefs × six ink slots × fifty tones × four edges. The
shipped book hangs 126 of roughly three hundred thousand combinations; naming
your own is not a consolation prize. **The dialog says this out loud** rather
than offering an upload button that would produce a visibly broken wall.

---

## 3. Validation

Two properties, both tested, both from the brief.

### All or nothing

One bad entry refuses the whole file. Importing eleven of twelve wallpapers
leaves the reader with no way to know which one is missing, or why, or how to
fix it — they would have to diff their own JSON against the app.

### Every problem has a place

`items[3].ink` and a sentence. `"Invalid pack"` with no location is the message
that makes somebody delete the file and give up. Where a value is nearly right,
the problem says what it was nearly (`nearestValue`, a capped edit distance) —
models write `herringbones` and `face-frame`, and "did you mean herringbone?"
turns a dead end into an edit. The threshold matters in the other direction
too: suggesting `bee` for `gradient` reads as though the app half-understood.

### An unknown key is an error, not a shrug

Ignoring `"colour": "moss"` because the field is called `tone` is a silent
half-import wearing a different hat: the pack lands, the wall is the wrong
colour, and nothing said why. Unknown keys are refused by name with the real
field list attached.

### Where tolerance IS right

The **wrapper**, because it cannot hide a mistake in the data. Models fence
their output in ` ```json ` and sometimes greet you first. Both are stripped,
and both are reported as a note — so a reader who wants a clean file knows
theirs is not one.

### Stickers: a drawing, not a program

Refused: `<script>`, `on…` handlers, `<foreignObject>`, `javascript:`, and any
`href`/`src`/`url()` that is not a local `#fragment` or a `data:image/` URI. A
sticker lives in the reader's notes; it does not phone out.

**Gradients are allowed.** CLAUDE.md is explicit that a gentle gradient is
pigment and only a light *model* is banned, so `url(#gradient)` passes. A
`feGaussianBlur` produces a **note**, not a refusal — the drawing is the
reader's and the rule here is their own: *you don't have to be too cruel*.

---

## 4. The read path is total, and the import path is not

Deliberately opposite, because the situations are opposite.

- **Import** is all-or-nothing: the reader is standing there and can fix the
  file.
- **Read** — `store.hydrate` — re-runs every stored entry through
  `validatePackItem`, drops the ones that no longer name anything the app
  draws, **counts them**, and the panel says so. A vocabulary can move
  underneath a pack that was fine when it went in; nobody is watching then.
  This is the same totality rule `resolveShelfDesign` follows. Dropping quietly
  would leave a tile painting the fallback while claiming to be the reader's
  own; throwing would take the studio down with it.

---

## 5. Cache keys

CLAUDE.md's standing trap: *any axis that varies baked pixels must be in the
relevant cache key, and a key missing an axis serves the wrong art to everyone
who already has the right art under that key.*

**Packs add no axis, and that is not luck — it is why they carry recipes rather
than pictures.** A reader's wallpaper is a `WallpaperSpec` built from the
shipped axes, so `wallpaperTileKey` already covers it to the last field; a
reader's bookcase is a `{build, pattern}` pair, so `shelfDesignTag()` already
covers that.

The preview tiles in `YourDesigns` are new drawn pixels, so they key on the
room's colour key **and** the design — through `wallpaperAxisKey` and
`shelfDesignTag`, never a local join that can fall an axis behind.
`tests/packs.test.ts` reads the source for both.

**If a pack ever carries bytes that get drawn, this section stops being true
and a cache key has to grow.**

---

## 6. Where it is reachable from

An importer nobody can reach is the exact failure this tree keeps finding —
`tests/roll-gates.test.ts` exists because a whole curation gate was authored,
exported, unit-tested and called by nothing. So there are three doors, and the
suite checks all three:

1. **`YourDesigns`** — a "yours" strip inside `LibraryStudio`'s wallpaper row
   and bookcase row, with a `+ add your own` control. This is the important
   one: papers belong where papers are chosen. Tiles are painted by
   `drawWallpaperCard` / `drawCaseCard`, the same routines that paint the real
   thing, and pressing one applies it through the studio's own save path.
2. **`PacksPanel`** — a "your own" tab, on `CustomizePanel` (inside a book) and
   on `ShelfStudio`'s room-only branch (from the shelf). The second was added
   because that branch does **not** go through `CustomizePanel`, so the hub was
   initially unreachable from the shelf — which is where a reader standing in a
   library they have not opened would look for it.
3. **`openPackDialog(categoryId)`** — self-mounting, one `onClick` from any
   host, per-category as the reader asked.

---

## 7. The popup, in the three parts asked for

1. **Bring it in.** `Choose a file`, plus `Choose images (png / svg)` on the
   sticker tab so somebody with drawings already on disk never touches JSON —
   and a **paste box**, because a reader who has just been handed JSON in a
   chat window has it on the clipboard, and telling them to save a file first
   is asking them to open a file manager to move data six inches. The paste box
   is also the only route an automated check can drive: a native file dialog
   cannot be answered by Playwright.
2. **How it works.** Numbered steps, the field table, and the category's
   `caveat` — the honest limitation, in the card rather than in a docstring.
3. **The prompt.** Shown whole, with `Copy the prompt`. Whole on purpose: it is
   long (a wallpaper prompt lists all fifty motifs), the reader is being asked
   to hand it to a model on trust, and a collapsed box saying "1,900 words"
   earns none.

Plus **what you cannot bring in yet**, with a reason each. The brief was
explicit: *if a category cannot be supported honestly yet, say so in the dialog
instead of accepting an upload you will drop.* A greyed row with a reason
beside it beats an upload button that swallows a file.

A refusal is a **panel, not a toast** — it has to survive being read twice and
compared against the file the reader has open in another window.

### Escape

Capture-phase on `document`, and it stops the event dead. `RailPanel` closes
the whole studio sheet on Escape from a bubble-phase listener on `window`, so a
plain listener closed **both** — the popup and the panel that opened it,
leaving the reader back on the shelf wondering where their wallpaper row went.
`ShelfMenu.MenuCard` had already solved this exactly once; this is the same
shape.

---

## 8. What was folded in rather than rewritten

Two importers already existed and both keep owning their bytes:

- `features/templates/userStickers.ts` — PNG/SVG through the asset store into
  the sticker registry the catalogue and Notebook Script already read.
- `sound/userSoundSetStore.ts` — audio through the same asset store into a
  reader's sound set (a base plus overrides, so one file makes a working set).

Packs own the **format**, the **instructions** and the **validation**. A third
copy of "bytes → asset store → registry" would be a third place for a `user:`
id to be minted slightly differently.

---

## 9. QA

- `tests/packs.test.ts` — 64 checks: the round trip, the vocabularies, the
  refusals, the SVG rules, the stale-entry drop, and a source-read wiring gate.
- `scripts/probe-packs.mjs` — the seam. Only ever clicks: opens the studio,
  presses `+ add your own`, pastes a broken pack and reads the refusal, pastes
  a good one, closes, presses a resulting tile, and checks the **wall** through
  `__shelfDesign()` — the applied state, never what was merely saved. Then the
  same for carpentry, then the stickers path, then a 900px window for overflow.
- `window.__nbPacks` — `list` / `load` / `install(categoryId, text)` /
  `apply(packId, index)` / `forget`, for a probe that cannot answer a file
  dialog.

## Limits

`MAX_PACKS` 24; 24 entries per wallpaper or carpentry pack, 30 stickers; 64 KB
per SVG; 512 KB per manifest; 8 MB per audio cue (from
`userSoundSetStore.MAX_CUE_BYTES`). Every list the reader can grow is behind
`Capped`, because the reader asked for that "in the whole app" and this is the
one place where the length is decided by them.
