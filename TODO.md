# Notebook — running TODO

Nothing gets forgotten here. Tick items when *verified in the running app*, not when written.

---

## 🔴 Architecture reset (blocks everything visual)

See `docs/design/RESET-render-architecture.md`. Measured on the live app: **4,977 ms** to first paint, **15,314 ms** max main-thread block, **0.1 fps** idle.

- [x] ~~Spine sprite library~~ — ControlNet Union over authored layouts; composition is dictated, not prompted (`gen-spinewall-cn.mjs` → `cut-spines.py` → `pack-spines.py`)
- [x] ~~Spine blits replace spine painting~~ — `spineAtlas.ts`; `request()` returns without scheduling work
- [ ] Case elevation per theme (same ControlNet approach — depth hint rather than canny)
- [ ] Wall panels at 2048px+, one authored image rather than a repeating tile
- [ ] Foliage sprite sheet placed compositionally (reuse `assets/atoms`)
- [ ] Re-measure and hold the line: **first paint < 500 ms · no block > 100 ms · 60 fps · no tiling · no pop-in**

## 🐛 Reported bugs

**Shelf**
- [ ] Wallpaper tiling repeat visible at top and bottom when zoomed out
- [ ] Flora pops in one specimen at a time on load
- [x] ~~Books far too small relative to shelf height~~ — `artHeight` maps the sprite's own proportion onto the book zone (0.97 fill)
- [ ] Tiny low-quality sprig stamps repeating along plank fronts at identical spacing
- [x] ~~Weird vine painted on the wood (rail inlay + crown garland)~~ — replaced with brass bead + carved relief
- [x] ~~Floral wallpaper behind every theme~~ — quiet wall + timber case backing now default
- [ ] Chrome card ("new book / studio / add floor") overlaps the top of the bookcase
- [ ] Unexplained dark band across the top of the shelf view
- [ ] Trash drawer sits inside the bookcase as "waste paper" — should be a side option

**Book / pages**
- [ ] Page content **blackens** during the turn
- [ ] Turning **backwards inverts the pages** for a second
- [x] ~~**Cannot advance to a fresh blank page**~~ — blanks allowed, bounded at 4 trailing (`MAX_TRAILING_BLANK_PAGES`)
- [ ] Stray page-turn effect persists after the flip completes
- [ ] Pull-out animation looks cheap
- [ ] Book cover material looks cheap

**Quality (whole app)**
- [ ] Muddy, low texture resolution, pixelated, jittery lines
- [ ] Massive lag and load time
- [ ] Sound effects still low quality — want smoother, calmer, warmer

**Branding**
- [ ] App logo/icon too small — book should fill the canvas and read at 16–32px

## ✂️ Pruning (user-approved)

- [x] ~~Cut the theme roster hard~~ — `SHIPPED_THEME_IDS` = blossom + athenaeum; the rest stay as data so saved libraries still load
- [ ] Remove or retool studio / wallpaper / book-studio options that exist only to fill a list

## 🧩 Features still missing

- [ ] Split studio into **Shelf** and **Wallpaper** sections
- [ ] Book Studio randomise ("surprise me" + per-field re-roll + undo)
- [ ] Import/export only reachable via `Ctrl+Shift+E` / `Ctrl+Shift+I` — needs real rail/settings entries
- [ ] Settings row to replay the guided tutorial
- [ ] Living motion: wind sway, drifting petals, per-theme events (butterfly, etc.)
- [ ] Structurally distinct shelves per theme (not just a recolour) — only if themes survive the prune

## 🏗 Systems / polish

- [ ] Motion design system: unified easing, page transitions, micro-interactions, spring physics
- [ ] Notion-depth writing: nested toggles, columns, math, footnotes, backlinks, sortable tables, selection toolbar
- [ ] Notebook Script v2 — tighter mini-language (variables, reusable styles, strict validation)
- [ ] Exportable diagnostics log users can hand to their AI when something breaks
- [ ] Apply unaddressed findings in `docs/design/ui-audit.md`
- [ ] Rebuild and verify the NSIS installer once the above lands

---

## ✅ Done

- Tauri 2 + SolidJS scaffold, SQLite data layer, warm design system
- Infinite bookshelf world: virtualized floors, semantic zoom, drag-to-pull books
- Block editor: slash menu, drag handles, right-click menu, tables, callouts, toggles, stickers, effects, pagination without scrollbars
- Two-page spread with WebGL page-curl flip
- Notebook Script: tolerant parser, canonical printer, AI-facing spec, Insert Script dialog
- Hand-drawn diagram renderers (tree, mindmap, flowchart, timeline)
- Media: image paste/drop, link-preview cards, Openverse fetch
- Full-text search + Ctrl+K quick switcher
- Settings panel (~25 options, 4 UI themes); guided tutorial; export/import bundles with restore points; backups, tray, perf HUD
- Custom icon + NSIS installer; GitHub Actions release on version tags
- Local generation stack: ComfyUI + Juggernaut XL + Detail Tweaker + LayerDiffuse, seam verification, photoreal material library
- `ART-BIBLE.md` — canonical art direction derived from the user's analysis of the reference
