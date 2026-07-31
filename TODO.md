# Notebook — running TODO

Nothing gets forgotten here. Tick items when *verified in the running app*, not
when written.

---

## 🎨 Flat restyle (the current job)

The app icon's style is now the whole visual language: flat colour, one dark
outline, rounded corners, wobbling edges, no lighting. See `src/art/flat.ts`.

- [x] ~~Purge the AI art pipeline~~ — every gen/pack/cut script, all generated
      assets, and the 30 GB ComfyUI install with its models
- [x] ~~`flat.ts` + `flatShelf.ts`~~ — palette, primitives, case parts, spines
- [x] ~~Wall is one flat tint~~ — nothing tiles, so nothing can seam
- [x] ~~`specimen.html`~~ — judge the drawing on its own
- [x] ~~**Point the shelf at it.**~~ The case, the spines and the covers all
      render through `flat.ts` / `flatShelf.ts` now.
- [x] ~~Delete the painting stack~~ — `brush.ts`, `materials.ts`, `flora.ts`,
      `leaves.ts`, `props.ts`, `paper.ts`, `filters.ts`, `caseArt.ts`,
      `wood.ts`, the wallpaper renderers, and the granulation/material tables
      in `spines.ts`. `charms.ts` and `wobble.ts` stayed — both are live.
- [x] ~~Delete the lighting stack~~ — `sceneLight.ts`, `lightRig.ts`,
      `art/lighting.ts`, `src/render/*`, plus the per-theme light rigs and the
      dust motes that only existed to make the lamp pools visible.
- [x] ~~Restyle the rails, chrome and studio panel to match~~ — every token in
      `tokens.css` rebuilt on the FLAT palette, zero-blur flat shadows.
- [ ] Themes → a few simple colour schemes over the one flat case. The theme
      DATA is down to carpentry + wallpaper + spine bias, but every room still
      bakes the same flat case, so the picker currently only changes the seed.
- [ ] Restyle the book covers and the pulled-book overlay to match

## 🐛 Reported bugs

- [ ] Dragging empty shelf space pulls a book out instead of panning
- [x] ~~Page content **blackens** during the turn~~ — premultiplied alpha; page
      samples now composite over paper cream in the shader
- [x] ~~Turning **backwards inverts the pages** for a second~~ — a 'prev' leaf's
      spine is its RIGHT edge, so every face needed its UVs mirrored
- [x] ~~Stray page-turn effect persists after the flip completes~~ — the canvas
      was hidden before `renderer.clear()` presented
- [ ] Pull-out animation looks cheap
- [ ] "waste paper" drawer sits inside the bookcase — should be a side option
- [ ] Chrome card ("new book / studio / add floor") overlaps the bookcase top
- [ ] App logo/icon too small in-app — should read at 16–32px
- [ ] Sound effects still low quality — want smoother, calmer, warmer
- [x] ~~Settings changes are slow~~ — the full case re-bake went with the
      painting stack; a flat part is a few dozen path fills

## 🧩 Features still missing

- [ ] Import/export only reachable via `Ctrl+Shift+E` / `Ctrl+Shift+I`
- [ ] Settings row to replay the guided tutorial
- [ ] Motion design system: unified easing, transitions, spring physics
- [ ] Notion-depth writing: nested toggles, columns, math, footnotes,
      backlinks, sortable tables, selection toolbar
- [ ] Notebook Script v2 — variables, reusable styles, strict validation
- [ ] Exportable diagnostics log users can hand to their AI
- [ ] Rebuild and verify the NSIS installer once the restyle lands

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
- Studio cut to one wall with an optional pattern and a depth slider
- Custom icon + NSIS installer; GitHub Actions release on version tags
- README that describes the actual app
