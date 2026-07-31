# Notebook — running TODO

Nothing gets forgotten here. Tick items when *verified in the running app*, not
when written — and where two colours or two frames are hard to tell apart, use
`shots-now/sample.py` rather than an opinion.

---

## 🎨 Flat restyle

The app icon's style is the whole visual language: flat colour, one dark
outline, rounded corners, wobbling edges, no lighting. See `src/art/flat.ts`.

- [x] ~~Purge the AI art pipeline~~ — every gen/pack/cut script, all generated
      assets, and the 30 GB ComfyUI install with its models
- [x] ~~`flat.ts` + `flatShelf.ts`~~ — palette, primitives, case parts, spines
- [x] ~~Wall is one flat tint~~ — nothing tiles, so nothing can seam
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

- [ ] Move-mode's drop-target hint (`world.ts` ~2072) still draws an additive
      blurred glow — the last soft sprite in the shelf
- [ ] `.pulled-book` in `src/styles/shelf.css` still carries a blurred
      `box-shadow: var(--shadow-lg)`

## 🧩 Features still missing

- [ ] Import/export only reachable via `Ctrl+Shift+E` / `Ctrl+Shift+I`
- [ ] Settings row to replay the guided tutorial
- [ ] Exportable diagnostics log users can hand to their AI
- [ ] Motion design system: unified easing, transitions, spring physics
- [ ] Notion-depth writing: nested toggles, columns, math, footnotes,
      backlinks, sortable tables, selection toolbar
- [ ] Notebook Script v2 — variables, reusable styles, strict validation
- [ ] Rebuild and verify the NSIS installer

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
