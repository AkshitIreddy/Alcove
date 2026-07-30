# Notebook

A Windows desktop notes app: an intricate hand-drawn bookshelf world (warm parchment aesthetic) where books open into Notion-grade block-edited pages. Built with Tauri 2 (Rust) + SolidJS + TypeScript + Vite.

## Architecture decisions (binding)

The five design docs in `docs/design/` are the canonical blueprints — read the relevant one before working in its area:

- `bookshelf-rendering.md` — PixiJS v8 WebGL sprite world + DOM overlay for the focused book. No live SVG filters in any hot path. Camera in log-zoom space, floor virtualization, 3-tier LOD.
- `page-flip.md` — live DOM at rest; during flip gestures swap to a WebGL cylinder-curl shader fed by pre-rasterized page snapshots (html-to-image, idle-time cached). CSS 3D rigid fold is the fallback only.
- `block-editor.md` — TipTap v3 (@tiptap/core, framework-agnostic) with vendored SolidJS bindings in `src/editor/solid/`. One editor per page. Document JSON (editor.getJSON()) IS the storage format.
- `script-language.md` — "Notebook Script": Markdown subset + `:::name {attrs}` directives + fenced mini-languages (tree/graph/timeline). Handwritten tolerant parser in `src/script/` — parse() is total, never throws, returns diagnostics.
- `art-pipeline.md` — bake-once: SVG filters (pencil/watercolor recipes are in the doc) run only inside `art/bake.ts`, results persisted to appCacheDir as PNG. Icons/chrome are pre-distorted vector SVG. Spines are seeded procedural canvas.

`docs/ROADMAP-wave2.md` tracks the 33 customization / quality-of-life features and their group ownership.

## Product rules (from user review — non-negotiable)

- **No scrollbars inside pages.** Pages are fixed-height; overflow flows to the next page via the pagination contract (`PageEditor` peels trailing blocks → `onOverflow` → `BookView` prepends to the next page, creating it if needed).
- **Books drag out of the shelf** (click also works as a quick pull). Plain wheel zooms; shift+wheel pans.
- **Left icon rails, not top bars.** Book tools, page style, customization, stickers/effects all live in the left rail with hand-drawn tooltips. Freed space goes to the pages.
- Right-click opens a Notion-style block context menu; clicking empty ruled space starts typing there.
- Aesthetic bar is "intricate, magical library" — baked art, ornamented spines and covers, never flat rectangles.
- Seeding ships exactly one Welcome book; the migration removes old empty demo books without touching user content.

## Map of the app

- `src/features/bookshelf/` — Pixi world, gestures, spine/cover factories, shelf menu, trash drawer, floor plates
- `src/views/` — `BookView` spread + `rail/` (icon rail and its panels), TOC/thumbnails/cheat-sheet
- `src/editor/` — TipTap setup, custom nodes, slash + context menus, effects, pagination, script bridge, exporters
- `src/flip/` — WebGL page-curl engine and snapshot cache
- `src/script/` — Notebook Script parser/printer (total, never throws)
- `src/diagrams/` — layout algorithms + hand-drawn SVG renderers
- `src/search/`, `src/features/quickswitch/` — fuzzy quick switcher + full-text index
- `src/features/system/` — backups, tray, perf HUD, launch behavior
- `src/sound/` — Howler engine; `scripts/gen-sounds.mjs` synthesizes every WAV from scratch
- `src-tauri/src/` — `media.rs`, `backup.rs`, `tray.rs`, `export.rs`, `import.rs` (all registered in `lib.rs`)

## Conventions

- Package manager: npm. Do not add dependencies without checking package.json first — most things are already installed.
- Fonts (bundled via @fontsource): Caveat Variable = headings/book titles (≥20px only), Patrick Hand = body, Kalam = accents, Architects Daughter = diagram labels, Nunito Sans = UI micro-copy below 13px. Never render handwriting fonts below 13px.
- Palette tokens live in `src/styles/tokens.css`. Warm parchment: cream paper, sepia/graphite ink, washes in amber/terracotta/moss/lemon/sky/blush.
- Animation: GSAP (all plugins free/registered). Transform/opacity only in hot paths; no layout-triggering animation.
- Solid owns all state; Pixi/GL objects are non-reactive mirrors mutated in createEffect. Never diff Pixi through JSX.
- Rust commands live in `src-tauri/src/lib.rs` (split into modules as they grow). SQLite via tauri-plugin-sql with migrations registered in the builder.

## Verify

- Frontend typecheck: `npx tsc --noEmit` (agents working in parallel: use this, do NOT run `npm run build` or `npm run tauri dev`)
- Rust: `cargo check --manifest-path src-tauri/Cargo.toml`
- Unit tests: `npx vitest run`
- End-to-end: `npm run e2e` (Playwright; reuses a dev server on :1420). Headless uses SwiftShader — append `?fx=force` for full shelf effects and poll for state instead of fixed waits, because rAF is throttled there.
- Visual QA: capture screenshots and *actually look at them* before calling a visual change done. Keep it proportionate — the surface you changed, batched into specimen boards where possible.
