# Generated asset pipeline — AI-assisted material and element library

## The idea

Procedural drawing is good at **variation and interactivity**; it is bad at **surface beauty**. Generative models are the reverse — gorgeous surfaces, but no notion of "this book must be 34px wide and draggable".

So we split the job:

- **Generated (once, offline):** the *materials and elements* — seamless surface textures, foliage cutouts, ornament stamps, wallpaper patterns. Painted quality, baked into the repo.
- **Procedural (at runtime):** the *composition* — which book goes where, how thick, what height, where the vine anchors, how the shelf is laid out. Retains every interactive property we have.
- **Deferred lighting (per frame, GPU):** unifies everything under one light so generated and procedural pieces sit in the same world.

This is how game art actually works: authored source assets, procedural placement, runtime lighting.

## Local setup

- **ComfyUI** at `C:\Users\akshi\ComfyUI` with its own venv.
- **SDXL** as the base model. Chosen over FLUX deliberately: on a 12GB RTX 4080 SDXL is ~5–10s/image versus ~60–80s for quantized FLUX, and we are generating and re-rolling *hundreds* of assets where iteration speed dominates. SDXL also has the deeper painterly LoRA ecosystem and the more mature ControlNet, and we want stylised illustration rather than photoreal.
- Seamlessness via **tiling** (circular/asymmetric padding in the sampler), not by post-hoc mirroring, which produces visible symmetry.
- Alpha cutouts via generation on flat backgrounds plus background removal.

## What to generate

### A. Seamless material tiles (512², tileable, ~20 assets)
Book bindings: cracked leather · fine morocco leather · ribbed book cloth · linen buckram · vellum · silk moiré.
Case: oak plank grain · walnut figure · painted-and-chipped wood · weathered barn wood.
Paper: laid writing paper · aged foxed paper · kraft board · marbled endpaper (2 variants).
Accent: brass with patina · limewashed plaster · dark slate.

Prompt skeleton — hold this constant so the library shares one hand:
> *seamless tileable texture of {material}, hand-painted illustration, gouache and coloured pencil, soft varied edges, subtle colour variation, muted warm palette, flat even lighting, no shadows, no highlights, no objects, top-down, high detail*

Flat even lighting is essential: **the deferred pass adds the light.** Any baked-in highlight fights the scene light and looks wrong.

### B. Foliage and nature cutouts (transparent PNG, ~40 assets)
Ivy leaf (5 shapes) · pothos leaf (4) · fern frond (3) · monstera-ish leaf (2) · cherry blossom cluster (4) · rose cluster (3) · small wildflower cluster (5) · trailing string-of-hearts (3) · moss clump (4) · dried herb bundle (2) · grass tuft (3) · coral frond (3, for the reef theme).

> *single {subject}, hand-painted botanical illustration, gouache, soft painterly edges, rich green with colour variation, flat even lighting, isolated on plain white background, centred, no shadow*

Each needs several rotations/variants so the composer can scatter without visible cloning.

### C. Ornament stamps (transparent PNG, ~24 assets)
Spine tooling: laurel wreath · fleuron · corner flourish · rule-and-dot band · monogram cartouche · star · crescent · quill · tree · keyhole · diamond lozenge · sunburst.
Rendered as **gold foil on transparent**, so they can be tinted and lit.

### D. Wallpaper patterns (1024², tileable, ~12 assets)
damask · botanical toile · constellation · ditsy floral · gingham-over-floral · rice-paper bamboo · lath-and-plaster · apothecary labels · art-nouveau vine · marbled · pin-dot · limewash.

> *seamless wallpaper pattern, {motif}, hand-painted, low contrast, subtle, vintage book endpaper feel, flat lighting*

Low contrast is a hard requirement — the wallpaper must never compete with the books.

## Quality gate

Nothing enters the repo until it passes:
1. **Tiles seamlessly** — render 3×3 and check for visible seams or repetition rhythm.
2. **Flat lighting** — no baked highlight or shadow that will fight the scene light.
3. **Style coherence** — sits beside the rest of the library without looking foreign.
4. **Weight** — 512² webp for materials, trimmed alpha for cutouts; the whole library should stay well under ~15MB.
5. **Value range** — materials must not arrive as mid-tone mush; they are the base the lighting sculpts.

## Licensing

SDXL outputs generated locally, on the user's hardware, from their own prompts. No third-party assets are redistributed. Keep the generation prompts and workflow JSON in `assets/generated/_workflows/` so any asset can be reproduced or re-rolled.

## Fallback

If generated quality does not beat the brush engine for a given category, that category stays procedural. This is a tool, not a religion — judged per asset class, on the screenshots.
