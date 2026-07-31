# Render architecture reset

## The verdict

The user, after several rounds of art work:

> *"the recurring theme is everything looks like it is from cheap game, while having massive performance costs"*

Measured on the running app (SwiftShader, but the CPU numbers are renderer-independent):

| | measured | acceptable |
|---|---|---|
| first canvas paint | **4,977 ms** | < 500 ms |
| max main-thread block | **15,314 ms** | < 100 ms |
| idle framerate | **0.1 fps** | 60 fps |

Cheap-looking *and* slow is not a tuning problem. It means the architecture is wrong.

## Why we got here

Every quality problem was answered by **adding another runtime layer**: a CPU brush engine that paints thousands of stamps per element into Float32 surfaces, procedural wood, procedural flora, procedural ornament, a deferred lighting pass, atlases, workers, LOD tiers, bake caches. Each addition was individually defensible. Together they mean the app **paints an entire illustration from scratch, on the CPU, every time it starts** — and then downsamples and composites the result through several stages.

That pipeline produces exactly the symptoms reported:

- **Muddy / low resolution** — art is generated at one scale, downsampled into an atlas, upscaled to draw. Every resample loses detail. The reference is sharp because it is one image at one resolution.
- **Pixelated and jittery lines** — thin procedural strokes land on fractional pixels after several transforms and shimmer.
- **Tiling artefacts** — visible repeats because everything is a small tile stretched across a large area.
- **Pop-in** — work is chunked across frames to avoid the freeze, so elements appear one at a time.
- **Massive lag** — the freeze is that CPU painting; the 0.1 fps is the compositing cost per frame.

We are paying a very high price for a result that is worse than a static image would be.

## The correction

**Stop painting at runtime. Ship authored art.**

This is how 2D games actually produce beautiful backdrops: an artist (or a generation pipeline) authors high-resolution art *offline*, and the runtime does cheap sprite blits. Runtime procedural painting is reserved for things that genuinely must vary per frame — which, for a bookshelf, is almost nothing.

### What changes

| Element | Now | After |
|---|---|---|
| Case, rails, crown, backdrop | painted per session by CPU brush passes | **one high-resolution authored image per theme**, sliced for vertical repeat |
| Wallpaper | small procedural tile, visibly repeating | **large authored panel** (2048px+), low-contrast, with the repeat broken by scale |
| Books | per-book CPU painting of leather/cloth/bands/foil | **a set of ~40 pre-rendered spine sprites** at high resolution, tinted and combined per book |
| Flora | brush-painted per specimen at load | **pre-rendered sprite sheet**, placed compositionally |
| Lighting | deferred GPU pass over generated buffers | **baked into the authored art**, plus one cheap overlay for interactive glow |

### Why this is also *better looking*

- Assets are generated at **full resolution by an image model** and never resampled through a bake chain.
- The lighting can be *in* the art — a painting's light does not have to be computed.
- Detail, wear and irregularity come from the generator for free, rather than from procedural jitter that reads as noise.

### What we keep

- The **generation pipeline** (ComfyUI, Juggernaut XL, Detail Tweaker, seam verification) — it becomes the authoring tool rather than a source of tiles.
- The **brush engine** as an *offline* tool for producing sprite sheets, not a runtime renderer.
- All product logic: books, pages, editor, studio, themes. Only the drawing layer changes.

## Targets (non-negotiable)

- First meaningful paint **< 500 ms**.
- No main-thread block over **100 ms**, ever.
- **60 fps** at idle and while panning.
- No visible tiling repeat at any zoom.
- No pop-in: a floor appears complete or not at all.

If a feature cannot meet these, it does not ship.
