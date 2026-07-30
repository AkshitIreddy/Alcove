# Notebook

A Windows desktop notes app: an intricate hand-drawn bookshelf world (warm parchment aesthetic) where books open into Notion-grade block-edited pages. Built with Tauri 2 (Rust) + SolidJS + TypeScript + Vite.

## Architecture decisions (binding)

The five design docs in `docs/design/` are the canonical blueprints — read the relevant one before working in its area:

- `bookshelf-rendering.md` — PixiJS v8 WebGL sprite world + DOM overlay for the focused book. No live SVG filters in any hot path. Camera in log-zoom space, floor virtualization, 3-tier LOD.
- `page-flip.md` — live DOM at rest; during flip gestures swap to a WebGL cylinder-curl shader fed by pre-rasterized page snapshots (html-to-image, idle-time cached). CSS 3D rigid fold is the fallback only.
- `block-editor.md` — TipTap v3 (@tiptap/core, framework-agnostic) with vendored SolidJS bindings in `src/editor/solid/`. One editor per page. Document JSON (editor.getJSON()) IS the storage format.
- `script-language.md` — "Notebook Script": Markdown subset + `:::name {attrs}` directives + fenced mini-languages (tree/graph/timeline). Handwritten tolerant parser in `src/script/` — parse() is total, never throws, returns diagnostics.
- `art-pipeline.md` — bake-once: SVG filters (pencil/watercolor recipes are in the doc) run only inside `art/bake.ts`, results persisted to appCacheDir as PNG. Icons/chrome are pre-distorted vector SVG. Spines are seeded procedural canvas.

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
- Tests: `npx vitest run`
