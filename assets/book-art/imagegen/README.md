# Generated book artwork

Created with the built-in imagegen tool after the owner rejected the initial vector previews. The owner selected the Field Notes and Small Histories craftsmanship, adapted to Alcove's flat interior, with distinct ornament levels for Grand, Quiet and the other directions.

- `binding-study-v1.png`: three complete bindings with more accomplished botanical drawing and believable book construction; the generated surface texture does not match Alcove's flat interior.
- `binding-study-flat-v2.png`: the same study edited toward clean pigment planes, preserving drawing and proportions.

The `titles/`, `frames/` and `emblems/` folders hold individual, text-free production components with the existing stable IDs. Exact prompts are saved beside each master as `.txt` or `.prompt.txt`. Studios retain their original names, order and option counts; titles and colours remain live controls.

The runtime decodes true-alpha PNGs, trims their transparent margins at draw time, and recolours their pixels into flat book pigments. This preserves generated linework without introducing lighting or textures. Rule-only frame alternatives use precise vector fillets where generation added inappropriate ornament. Failed backgrounds and comparison images remain outside the production glob under `studies/`.

Render `shots-now/book-remaster-covers.mjs`, `book-imagegen-applied.mjs` and `book-surprise-board.mjs` to inspect actual composed books. The original three-book study is a direction reference, not a screenshot of the app.
