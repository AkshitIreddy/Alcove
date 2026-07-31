# Wave 2 — 30+ customization & quality-of-life features

Grouped for parallel agent ownership; each group lists its file territory so waves can run concurrently. Build only after the wave-1 fixes land. Every feature ships with E2E coverage in tests/e2e/ and, where visual, a screenshot check.

## Group A — Shelf & library life (src/features/bookshelf, src/data/books)
1. **Book management on shelf**: right-click a book → rename / duplicate / delete (crumple sound + hand-drawn confirm) / pin ⭐ / move (drag between slots & floors with drop preview).
2. **Floor name plates**: editable brass-plaque labels per floor (double-click to edit, stored per floor index).
3. **Favorites**: pinned books get a tiny star charm on the spine; optional "favorites first" floor sort.
4. **Recent & continue-reading**: last-opened book shows a ribbon peeking from its pages; shelf "sort by recent" toggle.
5. **Auto book thickness**: spine width scales with page count (re-derive on page add/delete).
6. **Shelf wood stains**: oak / walnut / cherry / painted-cream case themes (bake variants, settings + per… global setting).
7. **Wallpaper picker**: 4 wall patterns (damask, stars, botanical, plain) in settings.
8. **Keyboard shelf nav**: arrows move a selection halo between books, Enter pulls out, Home jumps to floor 0.

## Group B — Editor & pages (src/editor, src/flip)
9. **Table of contents panel**: rail icon → headings tree of the whole book, click jumps (flip animation) to that page/heading.
10. **Page thumbnails strip**: toggleable bottom filmstrip of mini page renders (reuse flip snapshot cache), click to jump.
11. **Word/character count**: per page + book total, quiet display in the rail footer.
12. **Focus mode**: rail icon or F9 — hides rail/chrome, dims wall, centers a single page (paged scrolling stays).
13. **Page history**: periodic snapshots (autosave ring, last 20 per page) with a restore picker (hand-drawn "time-turner" panel).
14. **Keyboard cheat-sheet**: `?` overlay listing all shortcuts, hand-drawn two-column card.
15. **Highlighter styles**: marker sweep / squiggle underline / circle scribble as mark options on the highlight menu + context menu.
16. **Cursor styles**: pencil / quill / standard pointer for the editor (CSS cursors from baked art).
17. **Autosave indicator**: tiny pencil that scribbles in the rail when a save flushes.
18. **Daily journal**: `/today` slash command creates-or-jumps to a dated page in a designated Journal book (setting).
19. **Ribbon bookmarks**: per-book colored ribbons; "bookmark this page" in rail; ribbons visible in the closed-book cover art and jump on click.

## Group C — Search & navigation (new src/search, src/data)
20. **Quick switcher**: Ctrl+K fuzzy palette over books + page headings (hand-drawn command bar), Enter opens with animation.
21. **Full-text search**: SQLite FTS5 over page text (extract plain text on save); search panel with match snippets, click-to-jump with highlight pulse.
22. **Trash & restore**: soft-delete books to the trash (floor -1); restore or empty (permanent delete asks confirmation). Opened from the shelf's left dock rail — the in-case drawer front it originally shipped as is gone.

## Group D — Import/export & templates (src/editor/script, src-tauri)
23. **Export book/page to PDF**: print-quality paged render (Tauri print-to-PDF via hidden window or headless approach); "Export PDF" in rail.
24. **Export page as PNG**: reuse snapshot pipeline at 2x, saved via dialog.
25. **Import Markdown**: open .md file(s) → tolerant-parse as Notebook Script → new book (one page per H1 or size split).
26. **Templates gallery**: rail "+ from template" — Cornell notes, lecture notes, flashcard deck (toggle-based), weekly planner, reading log; authored as Notebook Script, preview cards.
27. **Custom stickers**: import PNG/SVG → user sticker library (asset-stored), appears in sticker palette + script vocab (`{sticker=user:name}`).

## Group E — Ambience & sound (src/sound, scripts/gen-sounds.mjs)
28. **Soundscape picker**: synthesize 3 more ambient loops (rain-on-window, fireplace crackle, night crickets) + picker in settings; crossfade on switch.
29. **Typing sounds**: optional soft pencil-scratch keystrokes (velocity-varied, rate-limited, off by default).
30. **Hourly chime**: optional very soft grandfather-clock chime (single note) — cozy library time awareness.

## Group F — System polish (src-tauri, src/data)
31. **Backups**: the settings toggle becomes real — zip the SQLite + assets to a chosen folder on the configured cadence; "restore from backup" flow.
32. **Window niceties**: remember maximized state; optional launch-into-last-book; system tray option with quick-capture note (writes to an Inbox book).
33. **Performance HUD (dev)**: FPS + texture memory overlay behind a setting, for ongoing perf review cycles.

## Acceptance discipline (every group)
- tsc + vitest green; new pure logic unit-tested.
- E2E spec per feature in tests/e2e (extend existing specs where natural).
- Visual features: before/after screenshots reviewed by the implementing agent AND the orchestrator.
- All UI hand-drawn warm-parchment styled; left-rail/sidebar placement over top bars; no scrollbars inside pages.
