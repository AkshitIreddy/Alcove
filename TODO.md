# Notebook — running TODO

The one place nothing gets forgotten. Add items as they come up; tick them when *verified*, not when written.
Ordered roughly by priority within each section.

---

## 🔥 Blocking / quality

- [ ] **Shelf art still reads cheap** — mid-tone mush, no deep darks or hot highlights, vector-crisp edges, flat even light. See `docs/design/painterly-art-direction.md` and the new `docs/design/painted-rendering.md`.
- [ ] **Corner shadow artifacts** — repeating transparent shadowy boxes at shelf corners (texture/atlas/9-slice reuse bug).
- [ ] **Startup bake blocks the main thread** (~118s measured at worst). Must be chunked/worker'd — the window must never freeze.
- [ ] Failing unit tests from the half-finished art/sound rebuild.

## 🎨 Art & themes

- [ ] Books: varied thickness/height/lean, visible page-block edges, real materials, foil that catches light, contact shadows.
- [ ] Flora: composed at edges and corners (not uniform cover), thick woody stems, large overlapping leaves, flower clusters, real depth tiers.
- [ ] Wallpapers: hand-painted feel, not flat printed repeats.
- [ ] Six colorful worlds — Blossom Grove (default), Robot Workshop, Dino Dig, Candy Shop, Coral Reef, Star Voyager — plus 2–3 backdrop variants each.
- [ ] Saturation pass on the original eight themes so none reads as drab.
- [ ] Saturated UI palette in `src/styles/tokens.css` — livelier accents and washes, contrast re-checked in all four UI themes.
- [ ] **App logo/icon is too small** — the book should fill more of the canvas and read clearly at 16–32px. *(Raised by the user and previously forgotten — do not lose again.)*
- [ ] Living motion: wind field swaying leaves, drifting petals, plus per-theme events (butterfly, robot head turn, pterodactyl, fish + caustics, comet).

## 🧩 Missing features

- [ ] **No way to create a book anywhere in the app** — needs a shelf affordance (empty slot with pencil outline + `+`), "add floor", and a right-click "New book here".
- [ ] Library/Book studios exist (`src/views/rail/`) but nothing opens them from the shelf.
- [ ] Book Studio randomise — "surprise me" plus per-field re-roll dice and undo.
- [ ] Import/export only reachable via `Ctrl+Shift+E` / `Ctrl+Shift+I` — needs real rail/settings entries.
- [ ] Settings row to replay the guided tutorial.

## 🐛 Bugs

- [ ] Page turn: content clips near the end of the flip; the turning page's back face shows no text (should show that leaf's reverse content).
- [ ] Chrome card ("new book / studio / add floor") overlaps the top of the bookcase.
- [ ] Unexplained dark band across the top of the shelf view.

## 🔊 Sound

- [ ] Effects are rough/thin — want smoother, calmer, warmer: layered elements, soft envelopes, heavy lowpass, short warm reverb, 4–6 variants each with pitch/level jitter.
- [ ] Sound-character presets (calm / rich / minimal).

## ✍️ Editor & script

- [ ] Notion-depth writing: nested toggles, columns, math, footnotes, sync blocks, backlinks, sortable tables, selection formatting toolbar, more markdown shortcuts.
- [ ] Notebook Script v2 — tighter mini-language (variables, reusable styles, strict validation).
- [ ] Diagnostics log users can export and hand to their AI when something goes wrong (logic *and* visual issues).

## 🏗 Systems

- [ ] Motion design system — unified easing/duration/choreography, page transitions, micro-interactions, spring physics, user-facing motion options.
- [ ] Apply the unaddressed findings in `docs/design/ui-audit.md`.
- [ ] Rebuild and verify the NSIS installer once the above lands.

---

## ✅ Done

- Tauri 2 + SolidJS scaffold, warm design system, SQLite data layer
- Infinite bookshelf world (PixiJS v8): virtualized floors, semantic zoom, drag-to-pull books
- Block editor: slash menu, drag handles, right-click block menu, tables, callouts, toggles, stickers, effects, pagination without scrollbars
- Two-page spread with WebGL page-curl flip
- Notebook Script: tolerant parser, canonical printer, AI-facing spec, Insert Script dialog
- Hand-drawn diagram renderers (tree, mindmap, flowchart, timeline)
- Media: image paste/drop, link-preview cards, Openverse fetch
- Full-text search + Ctrl+K quick switcher
- Procedural sound engine + settings panel (~25 options, 4 UI themes)
- Guided tutorial; export/import bundles with restore points; backups, tray, perf HUD
- Custom icon + NSIS installer; GitHub Actions release on version tags
