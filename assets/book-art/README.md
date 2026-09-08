# Book customisation artwork masters

The live catalogue preserves every original name, persisted ID and ordering, and now appends 72 commissioned vector assets: 16 title treatments, 24 borders and 32 emblems. Titles remain live text. See `docs/design/book-art-remaster.md` for the current direction and baseline comparison.

## Current production choices

- `imagegen/titles/`: 25 visible generated title treatments and exact prompts. None remains empty. `titles/` keeps vector fallback masters and layout contracts.
- `imagegen/emblems/`: 29 generated centre masters. Cover painters combine these with the established binder settings; the narrow geometric lozenge keeps its original broad struck-line drawing.
- `imagegen/frames/`: 18 generated frame studies. Production uses the dense masters for indices 43, 51, 54 and 55; other frames retain native open fillets and corner tooling. A generated study being retained does not imply it is the best production treatment.
- `titles/`, `frames/`, `emblems/`: the expanded 42-title, 42-frame and 61-emblem catalogues. The additions use native vector paths for crisp colour-adaptive drawing on covers and worker-rendered spines. All 72 original ImageGen masters are retained.
- The established material, spine shape, cord, endband and decoration construction in `bookDesign.ts` is restored. `bookBindingArtwork.ts` and the sparse `bookComposedSpine.ts` are retained as rejected studies rather than the production binding path.
- `finishing/` and `bookFinishingArtwork.ts` provide the cover edge masters. The spine endbands use their original construction.

The 16 SVGs at this directory's root are earlier comparison studies. Original ImageGen PNGs are unmodified; the runtime crops transparent margins and maps pigments to book colours. No lighting or texture pass is introduced.

## Creation rules

Improve the existing drawing's craft without replacing its character. Keep a single outline ink and a small, lively palette. Ordinary borders belong near the cover edge; do not turn every frame into a dense inset panel. Direct text uses the board's available height and real frame aperture. Keep complete readable titles. Physical labels retain their own silhouettes and live-text bounds.

Keep the original ornament setting when replacing its centre artwork. Preserve a book's paired identity. Judge spines at 24–40 pixels, not only enlarged. Grand can be richer; Quiet can be restrained without reducing every spine to an empty flat strip.

Surprise uses the existing binding pools, direction-specific palettes, compatibility, curation and exact locks. Automatic pigment adjustments never rewrite reader-entered colours. The rejected fixed-edition override is retired; its stored layout fields are ignored without changing explicit colours or furniture.

## Review

`shots-now/book-baseline-comparison.mjs` compares pre-remaster commit b9bf6d1 with the current production art, including the live Welcome book, with no database writes. `book-surprise-board.mjs` captures 32 paired direction samples. `book-surprise-live-qa.mjs` verifies Studio saving and the settled shelf, then restores the test appearance.

`tests/fixtures/book-customisation-catalogue.json` freezes the original catalogue prefix; the expansion tests verify the appended choices survive style resolution and actually appear in Surprise. `shots-now/book-expansion-board.mjs` captures all 72 additions on production-rendered books. Asset counts and passing code tests are not visual acceptance.
