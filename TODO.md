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
- [ ] Smooth two-stop CSS gradients that are lighting rather than pattern:
      `editor.css` 558/800, `effects.css` 42/241/262/387/431, `flip.css`
      95/107/177/192. **Not** the `repeating-linear-gradient` ruled lines or
      the scallop/stitch masks — those are flat by construction. Own sweep

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
- [ ] Notion-depth writing: nested toggles, columns, math, footnotes,
      backlinks, sortable tables, selection toolbar
- [ ] Rebuild and verify the NSIS installer

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
- [ ] Shortcuts are display-only in settings ("rebinding is on its way").
      The map is now honest and centrally matched, so rebinding is a UI job
- [ ] The task list in the harness is stale — several entries describe the
      deleted painting/lighting stack

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
