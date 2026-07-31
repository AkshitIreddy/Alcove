# Photoreal asset direction

> ## ⚠️ Superseded
>
> This describes the **generated-photoreal-material era**, which is deleted. No
> model output ships in the app, `art/wood.ts` and `art/props.ts` are gone, and
> there is no deferred lighting pass to sit generated and procedural pieces in
> one world.
>
> The visual language is now `assets/brand/icon.svg` as implemented in
> `src/art/flat.ts`: flat colour, one dark outline colour on everything, rounded
> corners, edges that bow slightly, a tiny palette. No gradients, no texture, no
> lighting, no glow, no bloom, no blurred shadows.
>
> Kept for the reasoning — the diagnosis of *why* half-simulated surfaces read as
> cheap is what led to the flat language. `RESET-render-architecture.md` is the
> live decision; `ART-BIBLE.md` and `art-pipeline.md` are the live blueprints.

## The reframe

The user, looking at their reference image next to our output: *"on the assets try finding a set of good models and then prompt strategies, lora, etc… in fact photoreal is the way to get it then lets do that, basically analyse the reference image — that is the level of quality we are looking for."*

They are right, and this corrects an assumption I carried for too long. I read "hand-drawn app" and pushed every generated asset toward *illustration*. But look at the reference: the **wood is photographic** — real grain, real sheen, real depth. The **leather is photographic**. The **leaves are photographic**. What makes it read as art is not that the materials are drawn; it is the **light, composition and colour grade** sitting on top of photographic materials.

So the division of labour changes:

| Layer | Source | Why |
|---|---|---|
| **Material surface** | photoreal generation | grain, weave, sheen and micro-detail that no procedural noise or brush stack reproduces |
| **Composition** | procedural | book sizes, placement, foliage arrangement — must stay interactive and data-driven |
| **Light + grade** | deferred shader | this is what makes photographic material read as *painting* rather than photograph |

"Painterly" is achieved in the **lighting and grading pass**, not by making the source textures look drawn.

## Reading the reference properly

`docs/design/reference/bookshelf-reference.png`. Two things carry it, and neither is "nice textures".

### 1. The enchantment is LIGHTING, not surface

- A hard **warm key from the upper right**, with **visible god rays** crossing the frame.
- Foliage on the right is **backlit and translucent** — light passes *through* the leaves so they glow yellow-green. This subsurface glow is most of the "mythical" feeling.
- **Bloom** haloes every hot spot, bleeding light into neighbouring dark.
- Genuinely **near-black occlusion** inside the case. The glow only sings because it has darkness to sing against.
- A **warm-to-cool gradient** across the frame: hot amber upper right, cool blue-green shadow lower left.
- The pink flowers read as *luminous* because they sit lit against shadow — not because their hue is cranked.

Implication: chasing this with texture work alone can never succeed. It is the deferred lighting pass — key, rim, translucency, bloom, AO, grade — that has to deliver it.

### 2. Everything carries wear and imperfection

The user's words: *"look how closely detailed the vines, the books, the shelf — literally even has scuffs and imperfections"*.

- Shelf edges are **nicked, scuffed and dented**, with the finish worn thin where things have rubbed.
- Book spines are **bumped at the corners**, sun-faded unevenly, some cocked or leaning, foil rubbed half away.
- Leaves are **not identical**: some curled, some yellowing, some with holes or brown edges.
- Dust, tiny debris, uneven varnish, slight warping in the boards.

Uniformity is the tell of computer-generated art. **Every generated material and every procedural element must carry wear**, and it must vary per instance. Prompts should ask for it explicitly — *worn, scuffed, nicked, aged, dusty, uneven, imperfect, weathered* — and procedural placement should jitter scale, rotation, tone and condition per instance.

## Model and settings

**Juggernaut XL v9** (`juggernautXL.safetensors`) — the community standard for photorealistic SDXL-class work. Keep DreamShaper for anything genuinely illustrative (stickers, doodles, UI ornament); use Juggernaut for every material and natural element.

Settings that differ from the illustration pipeline:
- Sampler **DPM++ 2M Karras**, **25–35 steps** (SDE variants improve fine detail at higher steps).
- **CFG 6–7**; drop to **5–6** when a LoRA is stacked, to leave the LoRA room.
- **Start with NO negative prompt.** Juggernaut is tuned for clean photoreal output and heavy negatives measurably *reduce* quality on this checkpoint — the opposite of the base-SDXL habit.

## Prompt strategy

Photoreal models respond to **photography language**, not art language. Name the camera, lens, lighting and surface condition:

> *seamless tileable texture of quartersawn white oak, visible ray fleck and open grain, satin varnish, shot on Canon EOS R5, 100mm macro, soft diffuse studio lighting, flat even illumination, top-down, ultra detailed, 8k*

Rules that carry over unchanged:
- **Flat even lighting is still mandatory.** The deferred pass owns the light; any baked highlight fights it. Say "flat even illumination, no directional shadows" even while asking for photoreal.
- **Seamless still requires circular padding** (`SeamlessTile` + `CircularVAEDecode`), verified by `qa/review.py`, never by eye.

## Defaults, per user instruction

- The **default wallpaper is NOT a floral pattern.** It should be a plain painted wall, plaster, or a wood/panel that matches the case — quiet, so the books are the subject. Patterns become an explicit choice.
- Wallpaper must **suit its theme**; a single flowery tile behind every world is wrong.
- The studio splits into **Shelf** and **Wallpaper** as separate sections.

## Quality bar

Put a generated material beside the corresponding surface in `docs/design/reference/bookshelf-reference.png` at the same scale. It should be indistinguishable in *material character* — grain direction, sheen, micro-contrast, colour depth. If ours reads flatter or plasticky, re-roll or re-prompt; do not accept it because it is "good enough for a texture".
