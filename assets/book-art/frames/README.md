# Remastered cover frames

These forty-two SVGs are the editable masters for the reader-facing cover-frame catalogue. Their filenames follow the saved-data identities in `covers.ts`; renaming, reordering or replacing an identity with another drawing would redress existing books.

The append-only expansion at indices 56–79 adds three genuinely authored frames
for each automatic direction. Their order is deliberate: Formal 56–58, Grand
59–61, Antique 62–64, Storybook 65–67, Botanical 68–70, Cosy 71–73, Rustic
74–76, and Quiet 77–79. These groups vary the silhouette and the construction,
not just the corner stamp: measured mitres, fanfare scrollwork, blind rolls,
storybook gates, whole botanical boughs, cloth ribbons, joined straps and open
hairlines respectively.

## Drawing rules

- Build the frame as a whole composition. Corner and side tools belong to continuous fillets, open returns or a clearly authored panel silhouette; they are never loose decoration around an ordinary rectangle.
- Use one dominant structure and one supporting structure. A plain rule stays quiet, a double rule gets unequal weights, a mitre shows its diagonal construction, and an onlaid band has distinct inner and outer edges.
- Give every line a slight bow and make opposite edges differ by a few units. Keep every mark within the 200×280 view box, including half the stroke width.
- Preserve a calm central title aperture. `bookFrameArtwork.ts` records the safe normalized aperture for each master; a title plate or emblem must fit inside it.
- Scale decorative tools as recognizable leaf, fleuron, bracket or strapwork assemblies. Do not make rows of tiny dots, studs, identical curls or wallpaper-like filler.
- `#f2e6ce` is the broad fillet/onlay ground, `#432934` is blind tooling, and `#c5a465` is foil tooling. The runtime substitutes the resolved book colours.
- Keep paths absolute and use only `M`, `L`, `Q`, `C` and `Z`. Put `data-detail="fine"` only on hairline cuts that can disappear in small picker previews without changing the frame identity.
- No texture, lighting, blur, shadow, filter, blend mode, transform or raster image belongs in a frame master.

## Reference ledger

The remaster takes its structural vocabulary from museum objects, collection catalogues and binding-practice sources. The points that converge across them are continuous rolled fillets, unequal multi-line programmes, corner tools tied into the border, broad leather onlays, Grolier strapwork, dentelle assembled from larger floral tools, and the distinction between gold and blind tooling.

- [V&A: Sarah Prideaux binding tools](https://www.vam.ac.uk/blog/museum-life/sarah-prideaux-1853-1933-bound-for-success) — floral and leaf tools struck as composed ornaments.
- [V&A: tradition and transformation](https://www.vam.ac.uk/blog/museum-life/tradition-and-transformation-in-19th-century-bookbinding) — cloth, leather, gold tooling and coloured stamps.
- [Met: Egyptian or Syrian leather-and-gold binding](https://www.metmuseum.org/art/collection/search/448957) — large geometric structure and differentiated tooling.
- [Met: fourteenth-century Egyptian binding](https://www.metmuseum.org/art/collection/search/451735) — stamped and gilded panel work.
- [Met: Ottoman binding](https://www.metmuseum.org/art/collection/search/452759) — painted, punched and gilded leather.
- [Met: 1478 German Bible binding](https://www.metmuseum.org/art/collection/search/466569) — tool hierarchy with metal furniture.
- [Met: arts of the book in the Islamic world](https://www.metmuseum.org/de/essays/the-arts-of-the-book-in-the-islamic-world-1600-1800) — geometric and vegetal layouts, medallions and corner pieces.
- [Columbia: gold-stamped publishers' bindings](https://exhibitions.library.columbia.edu/exhibits/show/bindings) — hand-finished vocabulary translated to stamped cloth.
- [Marsh's Library: Exquisite & Rare](https://web.marshlibrary.ie/digi/exhibits/show/bookbindings) — fillets, gouges, lozenges, acanthus, floral rolls and inlaid borders.
- [Canadian Bookbinders and Book Artists Guild: finishing](https://cbbag.ca/learn/homestudy/independentstream/finishing) — line tools, decorative tools, blind tooling, gold tooling and onlays.
- [Folger: Under Cover](https://www.folger.edu/blogs/collation/forged-bindings/) — fanfare curves, Grolieresque strapwork and restraint.
- [University of Chicago: Victorian bookbindings](https://www.lib.uchicago.edu/collex/exhibits/exvb/) — period shifts in embossing, stamping, florals and Art Nouveau.
- [Gulbenkian: Venetian sunk-panel bindings](https://gulbenkian.pt/museu/en/read-watch-listen/three-venetian-sunk-panel-bindings-in-the-calouste-gulbenkian-museum/) — continuous border onlays, centre-and-corner layouts and fine painted detail.
- [Hasluck: Bookbinding, with engravings and diagrams](https://upload.wikimedia.org/wikipedia/commons/e/ec/Bookbinding%2C_with_numerous_engravings_and_diagrams_%28IA_bookbindingwithn00hasl%29.pdf) — thin, thick, double and triple fillets; rolls, pallets and gouges.
- [SLUB Dresden: Jakob Krause volumes](https://www.slub-dresden.de/en/explore/rare-and-precious-prints/jakob-krause-baende) — Renaissance binding corpus and chronological variation.
- [Yale: Legally Binding](https://library.law.yale.edu/news/legally-binding-exhibition-goes-online) — herringbone bindings and large historical-image catalogues.
- [Oxford History of Science Museum: bindings](https://www.hsm.ox.ac.uk/bindings) — relief decoration and Renaissance covers.
- [Sotheby's: Bibliotheca Brookeriana](https://www.sothebys.com/en/series/bibliotheca-brookeriana-the-t-kimball-brooker-library-of-renaissance-books-and-bindings) — Renaissance bindings as architecture and graphic design.
- [Harvard: William King Richardson Collection](https://library.harvard.edu/collections/william-king-richardson-collection) — Badier, Padeloup and Payne bindings, stamping and inlay.
- [Walters: W.649 binding](https://art.thewalters.org/object/W.649.binding/) — black leather and separately preserved gold-tooled frame work.
- [NGA: Seneca, 1615](https://www.nga.gov/artworks/151039-l-annaei-senecae-philosophi-opera-quae-extant-omnia-iusto-lipsio-emendata-et-scholiis-illustrata) — embossed floral and geometric borders around a focal centre.
- [NGA: Le vite, 1674](https://www.nga.gov/artworks/204078-le-vite-de-pittori-scoltori-et-architetti-genovesi) — two quiet gold fillets with corner fleurons.
- [NGA: Kupfer-Bibel, 1731](https://www.nga.gov/artworks/69970-kupfer-bibel-volume-ii) — large diamond panel with corner floral tools.
- [Fitzwilliam: Sybil Pye binding](https://data.fitzmuseum.cam.ac.uk/id/image/media-13313590) — geometric gold tooling and restrained leather inlay.
- [Fitzwilliam conservation: challenges of use and display](https://conservation.fitzmuseum.cam.ac.uk/the-challenges-of-use-and-display/) — gold-tooled lines as structural visual boundaries on leather.
