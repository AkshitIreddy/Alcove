# Title plates and binder's emblems

Status: **current**. This note refines the flat book vocabulary in
`src/art/spines.ts`, `src/art/covers.ts`, `src/art/bookDesign.ts` and
`src/art/bookSurprise.ts`. It does not supersede the rendering architecture.

## Evidence and ruling

The catalogue follows the physical grammar visible across library and museum
bindings: titles are normally lettered directly, set inside open blind/gilt
fillets, or carried on restrained rectangular leather, paper, or vellum
labels. Shaped medallions are focal emblems, not title badges.

Primary examples:

- [Yale Beinecke MS 700](https://pre1600ms.beinecke.library.yale.edu/docs/pre1600.ms700.htm) — red leather gilt lettering piece.
- [Yale Beinecke MS 641](https://pre1600ms.beinecke.library.yale.edu/docs/pre1600.ms641.htm) — green leather label on parchment.
- [Yale Beinecke MS 801](https://pre1600ms.beinecke.library.yale.edu/docs/MS801.pdf) — paper title label.
- [Morgan Cronecken binding](https://www.themorgan.org/incunables/134002) — gilt leather label.
- [Princeton Kelmscott bindings appendix](https://blogs.princeton.edu/rarebooks/wp-content/uploads/sites/19/mt/docs/Milevski_PUL_Kelmscott_Appendix.1.pdf) — paper labels and direct blind/gilt titles.
- [LACMA *Khamsa*, 1529](https://collections.lacma.org/object/52264) — ruled border and inscription cartouche.
- [LACMA Qur'an section](https://collections.lacma.org/object/114406) — a small paper label subordinate to a star medallion.
- [Met Mamluk star binding](https://www.metmuseum.org/art/collection/search/448957) and [Met geometric interlace binding](https://www.metmuseum.org/art/collection/search/448906) — medallion and interlace hierarchy.
- [Library of Congress Persian rebinding treatment](https://www.loc.gov/preservation/conservators/rumi/treatment.html) — blind-tooled line construction.
- [RBMS binding terms](https://rbms.info/vocabularies/binding/hierarchical_list.htm) — controlled binding vocabulary.
- [Folger on forged bindings](https://www.folger.edu/blogs/collation/forged-bindings/) — warning against overtooled pastiche.

## Title catalogue

The active catalogue is construction-led and append-only. Persisted retired
ids continue to normalize into a safe active treatment.

| Decision | Treatments |
| --- | --- |
| Keep | direct lettering, direct gilt, debossed title, paper label, single morocco label, open double fillet, twin rules, inlaid strip, ink field |
| Add/redraw | press imprint, vellum ticket, low rectangular presentation label, calf compartment, open Oxford blind compartment, dyed leather band |
| Retire/normalize | gilt warning band, floating onlay, closed gilt/ruled/blind boxes, curly cartouche, oval, roundel, shield, crest, scallop, rope, bead, faux metal/enamel, patterned ground, punched-ticket and novelty-scroll treatments |

The active catalogue is deliberately limited to fifteen treatments. Every
active id maps one-to-one to a `CoverTitleFurniture` construction. New
ids are appended to `TITLE_PLATES`; historical ids are never reordered.
Surprise Me additionally observes material eligibility: calf/morocco pieces
belong on leather or split bindings, dyed bands on cloth/leather/split
bindings, and vellum tickets on vellum/paper/split archive families.

## Emblem catalogue

An emblem must read as one distinct silhouette on both the native cover and a
resting shelf spine. The approved vocabulary favours broad stars, palmettes,
arabesques, rosettes, fleurs, leaves, formal sprays and a few unmistakable
heraldic tools. It uses one ink, an open construction, and at most two accents.

The late botanical tail keeps or redraws acanthus spear, carnation, iris,
poppy seedhead, olive and honeysuckle sprays, lotus palmette, rowan, primrose,
dog rose, reed bundle, moresque knot, and Tudor rose. The artichoke, strawberry,
grape, samara, willow, columbine and cedar-cone ids normalize to broader oak,
laurel or tulip tools because their identifying detail disappeared at shelf
size.

## Composition hierarchy

One book gets one leading decorative programme:

1. An authored material field owns the cover, or
2. an architectural frame owns it, or
3. one matched cover-and-spine emblem owns it, or
4. the title treatment owns it.

A shaped/architectural title field never competes with a large emblem and an
ornate frame. Emblem-led books receive a quiet direct, ticket, or band title
and a quiet frame. Frame-led books receive a quiet title and no emblem.
Title-led books receive no emblem. Patterned or already-figured materials are
quieter still.

## Verification contract

Curating names is not enough. Render:

- every active title at native 142 x 197 cover pixels and enlarged detail;
- every active emblem on the native cover and the resting shelf spine;
- an adversarial board combining the strongest title/frame/emblem inputs;
- a deterministic negative control that deliberately admits retired shaped
  plates or focal stacking and must make the gate fail.

Inspect the images. Unit tests additionally pin append-only normalization,
one-to-one furniture mappings, cache-key separation, and Surprise hierarchy.
