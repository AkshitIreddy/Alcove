# Book artwork remaster — accepted direction and expansion

The sparse whole-book redesign was rejected: it muted the palette, made spines too plain, replaced Welcome's open ornament with a dense border, and gave the front artwork an inset-panel appearance. The working tree now starts from the earlier binding construction again. This supersedes the previous whole-edition implementation and its visual acceptance claims.

On September 8 the owner approved the corrected right-hand comparison, then requested substantially more assets. Original IDs, names and order remain stable; quantities are now deliberately expanded. The current collection has 42 title treatments, 42 cover borders and 61 emblems, adding 72 native vector drawings. The other binding, material, shape and finishing catalogues retain their existing choices.

## Current drawing

- Original spine material, shape, raised-cord, endband and decoration construction is restored. The narrow automatic `bookComposedSpine` painter is no longer used.
- Saved experimental composition fields resolve to null. Reader colours, selected materials, frames, bands and other explicit settings are preserved; no library data is rewritten.
- Welcome's existing frame 48 uses its original open fillets and Renaissance corner tooling. Other ordinary frames keep their native construction too. Dense generated masters are reserved for Banded Fleurons, Open Dentelle, Renaissance Open Panel and Blind Acanthus Panel (43/51/54/55).
- Front borders sit at 2.3% horizontally and 1.7% vertically within the front board, rather than the rejected 8.5%/5.5% inset. A frame uses its real open aperture for lettering.
- Direct titles use the available board height rather than being capped to the aspect ratio of a short physical ticket. Welcome is again a readable two-line title.
- Generated centre artwork sits inside the original binder's ornament setting instead of replacing the complete setting with an isolated icon. The narrow geometric lozenge retains its original broad struck-line spine drawing.
- The crown now uses its remastered centre artwork too; its former special case bypassed that master. Half- and three-quarter-bound fronts now use a narrow joint with matching leather corner pieces, replacing the broad colour block through the title field.
- Generated title-treatment masters and their individual physical layouts remain available. Original names, IDs and ordering are frozen as a prefix by `tests/fixtures/book-customisation-catalogue.json`. New choices append after the original 26 titles, 18 frames and 29 emblems; no existing choice is removed. The 18 materials, 59 decorations, 3 shapes, 67 bindings, 6 edges, 3 endbands, 10 lettering styles and 5 formats are unchanged.

## Surprise

The fixed 27-edition overlay is retired. Existing direction palettes, binding diversity, material compatibility, curation, locks and coherent focal selection remain. Automatic cloth and accent swatches receive a bounded OKLCh chroma increase while retaining their hue and lightness relationships; reader-entered colours and locks bypass that adjustment. Quiet remains lower-chroma than Storybook or Grand. Grand may combine an ornamental perimeter with one focal programme; the other directions keep the single-programme budget. Restored original diversity and adversarial-seed tests guard against collapsing the catalogue into a few repeated combinations.

`bookArtworkExpansion.ts` assigns additions by mood and ornament level. New IDs do not imply heavier tooling: frame selection, density scoring and paper compatibility use the actual visual role. All 61 emblems can enter the appropriate automatic direction pool. Directions include title-led, perimeter-led and paired-emblem treatments, with Quiet weighted toward title-led books. This keeps new title artwork reachable without combining competing focal elements. Existing colour and customization locks continue to win.

The four dense raster perimeters (43, 51, 54, 55) are now Grand-only in the automatic direction pools. Manual choices remain available. Quiet permits an occasional small paired tool while keeping elaborate perimeters out.

## Evidence

`shots-now/book-baseline-comparison.mjs` compares exact pre-remaster commit b9bf6d1 art with the current production modules. It includes the live Welcome seed/style and four direction examples, makes no database writes, and captures both versions side by side. Its paired image was inspected: old Welcome clearly outperformed the first dense replacement; the corrected version restores its structure and fits the title at a larger readable size.

`book-surprise-board.mjs` covers 32 paired recipes across all eight directions. `book-surprise-live-qa.mjs` drives the Studio, verifies the saved binding/frame and retired-layout state, waits for the shelf return animation, and restores the original test appearance. The generated source masters and exact ImageGen prompts remain under `assets/book-art/imagegen/` as working artwork; retaining a master does not imply it is the best production drawing for every context.

The owner approved this direction and authorized publication in 0.7.15. The release includes refreshed README stills and a rerendered demo; visual review covers the source-rendered books and app workflows.
