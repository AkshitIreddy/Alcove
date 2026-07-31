# Painted rendering — why the old approach failed and what replaces it

> ## ⚠️ Superseded
>
> This document describes the **runtime painting era**, which has been deleted.
> The app's visual language is now `assets/brand/icon.svg` as implemented in
> `src/art/flat.ts`: flat colour, one dark outline colour on everything, rounded
> corners, edges that bow slightly, a tiny palette. No gradients, no texture, no
> lighting, no glow, no bloom, no drop shadows. Depth is a darker flat face
> beside a lighter one, plus `contactShadow()` where an object meets a surface.
>
> Kept for the reasoning, not as a blueprint. `docs/design/ART-BIBLE.md` and
> `art-pipeline.md` are the live ones.

> **"Painted" does not mean muted.** The user's words: *"when I say painted I mean it should still be pretty and beautiful vivid"*. Painterly technique — soft varied edges, brush texture, colour drift within a shape, one coherent light — is about **craft**, not about restraint. The output must be *vivid*: saturated pigment, luminous highlights, rich darks, colour that sings. A painting is not a desaturated photograph; the great ones are more colourful than life, not less.
>
> Any time a choice trades away colour for "tastefulness", it is the wrong choice here. Get depth from **value structure and light**, never by draining chroma.

## Why it looks cheap (root causes, not symptoms)

Four sessions of "make the vines thicker, add more contrast tokens" failed because the problem is not parameters — it is **the drawing primitive itself**.

1. **We fill paths; painters lay strokes.** `ctx.fill()` produces a hard, mathematically perfect edge with one flat colour inside. Every painted image has soft, broken, varied edges and colour that shifts *within* a single shape. Perfect edges everywhere is the single loudest "made by a computer" signal.
2. **Light is baked per element, so there is no light.** Each book, plank and leaf computes its own shading in isolation. A painting has **one** light source that unifies everything — the same rake across every surface, one shadow direction, one warm/cool axis. Ours has a thousand tiny independent lightings that average out to flat.
3. **No value structure.** Our art lives in the middle of the value range. Real paintings commit: large areas of genuine dark, small areas of near-white, and a deliberate ratio between them. Mid-tone everywhere reads as murky regardless of hue.
4. **Uniform detail.** Everything is rendered at the same crispness. Paintings have a focal area with sharp detail and periphery that dissolves.

Adding more procedural detail *worsens* 1 and 4 — that is why the last rounds produced "lettuce everywhere" instead of beauty.

## What replaces it

### Pillar 1 — a brush engine, not a fill engine

`src/art/brush.ts`: paint with **stamps**, the way a digital artist does.

A stamp is a small soft sprite (radial falloff, optional bristle texture). A stroke lays many stamps along a path with per-stamp jitter in size, opacity, rotation and hue. Build up a shape from many low-opacity passes rather than one fill.

Core operations, mirroring a real painter's toolkit:
- `stroke(path, brush)` — tapered, pressure-varying line
- `scumble(region, brush)` — broken, textured coverage that lets the layer beneath show through
- `glaze(region, colour, alpha)` — thin transparent colour pass to unify or shift temperature
- `blockIn(shape, value)` — fast coarse mass, edges deliberately rough
- `edgeVary(path)` — some edges crisp, some lost entirely

Everything is bake-time, so cost is paid once into a texture.

### Pillar 2 — deferred scene lighting (one shader, not a thousand bakes)

The decisive change. Instead of every element shading itself on the CPU:

1. Elements render **albedo only** (flat local colour + texture) into the scene.
2. Each element also writes a cheap **height/normal** contribution into a second buffer (a book spine is a rounded box; a plank is a bevel; a leaf is a soft dome — all derivable from the silhouette, no hand-authored maps needed).
3. **One fullscreen fragment shader** then lights the whole composed scene: key direction and colour, rim, ambient occlusion from the height buffer, contact shadows, volumetric shafts, warm→cool temperature shift across the light gradient, bloom on hot spots, vignette, and a final colour grade.

Why this is right:
- **Coherence** — one light, one direction, one grade across every object. This alone is most of the "painted" feeling.
- **Performance** — replaces thousands of CPU shading passes with a single GPU pass. This is also the fix for the 118-second startup bake.
- **Live** — light can shift (time of day, theme change, a passing cloud) with zero re-baking.

PixiJS v8 supports custom filters and render textures, which is all this needs.

### Pillar 3 — value-first themes

A theme declares its **value structure before its hues**: a shadow anchor, a midtone, a highlight anchor, the proportion of canvas in each, and a temperature axis. Hue is chosen inside that structure. A validation test rejects any theme whose rendered histogram is mid-tone mush — the failure mode we keep shipping.

This is how a theme stays vivid *and* deep: saturated colour placed inside a real value range, rather than bright flat fills.

## Framework question, answered

Staying on **PixiJS v8**. The ceiling we hit was not the renderer — we were using it as a canvas blitter and doing all art work on the CPU. Pixi already gives custom shaders, render textures and multi-pass filters, which is exactly what deferred lighting needs. Three.js would add a 3D scene graph we do not want and a rewrite we cannot justify; a bespoke WebGL layer would mean re-implementing what Pixi already does well.

The change is *how we use it*: GPU lighting over composed albedo, instead of CPU shading per sprite.

## How we will know it worked

- Place a render beside `docs/design/reference/bookshelf-reference.png`: the difference should read as *style*, not *skill*.
- The value histogram spans the full range with committed darks — not a mid-tone hump.
- Zooming in shows brush texture and varied edges, not vector-perfect outlines.
- One consistent light direction is legible across books, wood and foliage.
- First paint is immediate; no frozen window.

## Method

Prototype in a standalone harness first (`prototypes/painted/`) so variations render in seconds without the app. Follow `build-and-look`: generate contact sheets of 4–8 variants (light angles, value structures, brush characters, foliage compositions), look at them side by side, pick, then port the winner into the app.
