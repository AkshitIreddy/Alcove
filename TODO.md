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
- [ ] **Point the shelf at it.** The case and books still render through
      `caseArt.ts` / `wood.ts` / `spines.ts`. The specimen looks right; the app
      does not yet use it. This is the next piece and the biggest.
- [ ] Delete the painting stack once nothing imports it: `brush.ts`,
      `materials.ts`, `flora.ts`, `leaves.ts`, `props.ts`, `charms.ts`,
      `wallpaper.ts`, `caseArt.ts`, `wood.ts`, most of `spines.ts`
- [ ] Delete the lighting stack: `sceneLight.ts`, `lightRig.ts`,
      `art/lighting.ts`, `src/render/*`
- [ ] Themes → a few simple colour schemes over the one flat case
- [ ] Restyle the book covers and the pulled-book overlay to match
- [ ] Restyle the rails, chrome and studio panel to match

## 🐛 Reported bugs

- [ ] Dragging empty shelf space pulls a book out instead of panning
- [ ] Page content **blackens** during the turn
- [ ] Turning **backwards inverts the pages** for a second
- [ ] Stray page-turn effect persists after the flip completes
- [ ] Pull-out animation looks cheap
- [ ] "waste paper" drawer sits inside the bookcase — should be a side option
- [ ] Chrome card ("new book / studio / add floor") overlaps the bookcase top
- [ ] App logo/icon too small in-app — should read at 16–32px
- [ ] Sound effects still low quality — want smoother, calmer, warmer
- [ ] Settings changes are slow (they trigger a full case re-bake; goes away
      with the painting stack)

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
