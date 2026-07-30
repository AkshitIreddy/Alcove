# Design: art-pipeline

## Recommendation
Bake-once hybrid pipeline: author art as SVG + procedural canvas, run SVG filters (pencil wobble, watercolor edge-darkening) exactly once at bake time into disk-persisted ImageBitmap/atlas rasters keyed by DPRÃ—zoom-bucket; pre-distort vector geometry (rough.js-style) for zoom-critical linework; render hundreds of seeded book spines from a canvas sprite atlas. Never leave a live feTurbulence filter attached to the DOM.

## Rationale
Live SVG filters are the one technique that nails the pencil/watercolor look but they are notoriously slow: feTurbulence+feDisplacementMap "can slow most modern browsers to a crawl" when applied to large or animated regions (GSAP forums, Smashing Magazine deep-dive on displacement filtering). The standard mitigation â€” and what this plan is built around â€” is to pay the filter cost once offline/at-runtime-once and cache the raster. Since the app is Tauri 2 on Windows, the renderer is always WebView2/Chromium: no Safari/Firefox compatibility tax, so we can rely on Chromium's full filter primitive set, ctx.filter, OffscreenCanvas and createImageBitmap. rough.js is the right tool for its actual strength â€” converting clean paths into believable multi-pass sketchy geometry (its algorithm perturbs and double-strokes paths) â€” but its docs and field reports show performance degrades with many shapes and its SVG backend is slower than canvas, so we use it as a *geometry generator at bake time*, not a per-frame renderer. Pure-vector pre-distorted paths (wobble baked into the path data, not into pixels) stay infinitely crisp under deep zoom at zero runtime filter cost, which raster baking alone cannot give for UI chrome and icons. For spines, seeded parametric generation (hash bookId â†’ PRNG â†’ param object) is the only approach that scales to hundreds of unique books deterministically with ~100 bytes of persisted state per book. Font evidence: Patrick Hand is consistently rated the most legible handwriting face for paragraph-length text at small sizes; Caveat holds up only for short display runs; Kalam fatigues in long passages â€” hence Caveat for headings, Patrick Hand for body, Kalam for accents. Sources: https://gsap.com/community/forums/topic/33075-gsap-and-feturbulence-mobile-performance/ , https://www.smashingmagazine.com/2021/09/deep-dive-wonderful-world-svg-displacement-filtering/ , https://roughjs.com/ , https://shihn.ca/posts/2020/roughjs-algorithms/ , https://tympanus.net/codrops/2019/02/19/svg-filter-effects-creating-texture-with-feturbulence/ , https://oreillymedia.github.io/Using_SVG/extras/ch16-feTurbulence.html , https://madegooddesigns.com/handwriting-fonts/

## Implementation plan
## Layer model (bottom â†’ top)

1. **L0 Paper ground** â€” tiled baked raster (CSS background-image from blob URL). 512Ã—512 tile per DPR bucket.
2. **L1 Environment art** (bookshelf wood, shelf shadows, wall) â€” procedural canvas, baked to large rasters per zoom bucket.
3. **L2 Book spines/covers** â€” seeded procedural canvas â†’ sprite atlas; whole shelf composited on ONE canvas via drawImage.
4. **L3 UI chrome & icons** â€” hand-authored SVG with wobble PRE-DISTORTED into path geometry (stays vector, crisp at any zoom). No runtime filters.
5. **L4 Live layer** â€” the currently hovered/opened book promoted to its own DOM element (image from atlas) so GSAP can transform it at 60fps; editor doodles via rough.js canvas.

Core rule: SVG filters exist ONLY inside a hidden `<svg width=0 height=0><defs>` and are consumed exclusively by the bake step.

## Bake step (module `art/bake.ts`)

WebView2 = Chromium, so the reliable universal recipe is: serialize a full SVG string (art + `<defs><filter>`), load as `Image` via blob URL, draw to canvas, `createImageBitmap`:

```ts
async function bakeSvg(svg: string, w: number, h: number, scale: number): Promise<ImageBitmap> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const img = new Image(); img.src = url; await img.decode();
  const c = new OffscreenCanvas(Math.ceil(w*scale), Math.ceil(h*scale));
  const ctx = c.getContext('2d')!; ctx.scale(scale, scale); ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(url);
  return c.transferToImageBitmap();
}
```

**Disk cache**: after baking, `canvas.convertToBlob({type:'image/png'})` â†’ write to `appCacheDir()/art/{sha1(recipeVersion+params+dpr+bucket)}.png` via @tauri-apps/plugin-fs. On startup, cache-hit path is just `fetch(convertFileSrc(path)) â†’ createImageBitmap(blob)` â€” cold start never pays filter cost twice. Bump `recipeVersion` const to invalidate.

## Exact SVG filter recipes

**Pencil line** (`#pencil`) â€” wobble + graphite grain eating into the stroke:
```xml
<filter id="pencil" x="-8%" y="-8%" width="116%" height="116%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.035 0.06" numOctaves="4" seed="7" result="wobble"/>
  <feDisplacementMap in="SourceGraphic" in2="wobble" scale="2.5"
                     xChannelSelector="R" yChannelSelector="G" result="disp"/>
  <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11" result="grain"/>
  <feColorMatrix in="grain" type="matrix"
    values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.4 -0.15" result="grainA"/>
  <feComposite in="disp" in2="grainA" operator="in"/>
</filter>
```
(scale 2.5 at 1x; when baking a bucket at scale S, multiply baseFrequency by 1/S and scale by S so wobble amplitude is resolution-independent.)

**Watercolor wash** (`#watercolor`) â€” wobbly blob edge + classic edge-darkening rim + granulation:
```xml
<filter id="watercolor" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.012 0.015" numOctaves="3" seed="4" result="big"/>
  <feDisplacementMap in="SourceGraphic" in2="big" scale="18" result="blob"/>
  <!-- edge darkening: blob minus eroded interior = rim -->
  <feMorphology in="blob" operator="erode" radius="4" result="inner"/>
  <feComposite in="blob" in2="inner" operator="out" result="rim"/>
  <feColorMatrix in="rim" type="matrix"
    values="0.62 0 0 0 0  0 0.62 0 0 0  0 0 0.62 0 0  0 0 0 0.85 0" result="rimDark"/>
  <feGaussianBlur in="rimDark" stdDeviation="1.4" result="rimSoft"/>
  <!-- pigment pooling: low-freq tonal unevenness multiplied into the fill -->
  <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="21" result="pool"/>
  <feColorMatrix in="pool" type="matrix"
    values="0 0 0 0 0.85  0 0 0 0 0.85  0 0 0 0 0.85  0 0 0 0 1" result="poolTone"/>
  <feBlend in="blob" in2="poolTone" mode="multiply" result="pooled"/>
  <feComposite in="pooled" in2="blob" operator="in" result="body"/>
  <feMerge><feMergeNode in="body"/><feMergeNode in="rimSoft"/></feMerge>
</filter>
```
Granulation is applied separately at composite time: a shared 256Ã—256 high-freq noise tile drawn with `globalCompositeOperation='overlay'` at alpha 0.06 (cheaper than another filter chain, reused everywhere).

**Paper tile** (`#paper`) â€” Codrops-style lit fibre:
```xml
<filter id="paper"><feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="5" result="n"/>
  <feDiffuseLighting in="n" lighting-color="#f7f1e3" surfaceScale="1.6">
    <feDistantLight azimuth="45" elevation="60"/></feDiffuseLighting></filter>
```
Bake once per DPR onto a flood rect; tint variants (cream #f7f1e3, aged #efe4cc) with `source-atop` fill.

## Pre-distorted vector chrome (module `art/wobble.ts`)

For icons, dividers, frames: at build/bake time sample each clean path with svg-path-properties every 3â€“5px, offset each sample by 1D simplex noise (amplitude 0.8â€“1.5px, frequency ~0.02/px, seeded per element), rebuild as Catmull-Rom â†’ cubic path, output 2 slightly different passes (rough.js's double-stroke trick, or call rough.js `generator.path()` directly and take its op sets). Result is plain crisp SVG: infinite zoom, zero filters. Pencil *texture* on these strokes = `stroke="url(#graphitePattern)"` where the pattern is a tiny 64Ã—64 baked graphite tile â€” Chromium renders patterned strokes fast. Ship the 20â€“30 core icons as pre-generated SVG committed to the repo (run the wobbler as a Vite build script, `scripts/gen-icons.ts`) so runtime does nothing.

## Procedural wood (module `art/wood.ts`)

Canvas 2D + simplex-noise: for each pixel row-band (work in 4px bands then smooth-scale, not per-pixel JS at full res): `g = n2d(x*0.008, y*0.09)` (anisotropic stretch = grain direction), `ring = fract(g*5.5)`, ease with `ring^1.8`, lerp plank palette #8a6a48â†’#6f5138; add 2â€“3 knots per plank: `ring += 0.5*exp(-dÂ²/rÂ²)*sin(d*0.35)` around seeded centers; multiply the shared granulation tile at 0.08; draw plank seams + front-edge outline via the wobble module strokes in graphite at 55% alpha; vignette with two radial gradients (multiply). Bake per zoom bucket, persist to disk. Shelf shadow under each row: pre-baked 9-slice blurred strip, drawn stretched.

## Seeded book spines (module `art/spines.ts`)

```ts
const seed = fnv1a(bookId);            // 32-bit
const rnd  = mulberry32(seed);         // deterministic per book, ~10 lines, no dep
interface SpineParams { w: number; hJitter: number; lean: number; palette: number;
  bands: {y: number; kind: 0|1|2}[]; ornament: number; texture: 0|1|2;
  font: 0|1|2; gilt: boolean; hueJitter: number; }
```
- w = 28â€“46 (weighted toward 32â€“38); hJitter Â±6px; lean Â±1.2Â°; palette = pick of 12 curated pigment duos (amber, terracotta, moss, dusty-blue, plum, ochre, sageâ€¦) + hueJitter Â±6Â° via HSL for extra uniqueness; 0â€“3 bands (double-rule/thick/gilt); ornament = 1 of 8 hand-drawn SVG stamps (diamond, laurel, star, blotâ€¦) pre-baked once as tintable white ImageBitmaps, tinted with `source-atop`; texture âˆˆ {cloth, leather, paper} = 3 noise presets; title in Caveat/Kalam/Patrick Hand vertically with per-glyph baseline wobble (`rnd()*1.2-0.6` px translate per char).
- Render one spine: base rect â†’ two layered watercolor gradients (multiply) â†’ inset dark edge (2px translucent stroke inside = pigment pooling at spine edges) â†’ bands â†’ stamp â†’ title â†’ shared granulation tile overlay. ~0.3ms each; NO SVG filters here â€” the watercolor look comes from the layered-gradient + edge-inset technique, so spines can be (re)baked en masse without filter cost.
- **Atlas**: pack into 2048Ã—2048 canvas pages (shelf-order packing, ~60 spines/page), LRU cap 4 pages/bucket (~64MB worst case). Persist only SpineParams (derivable anyway) â€” never pixels. The whole bookshelf is ONE canvas: per frame just drawImage atlas sub-rects; hundreds of books at 60fps trivially. Hovered book: copy its atlas rect to a small dedicated canvas absolutely positioned in DOM, animate pull-out/tilt with GSAP (transform-only, so compositor-thread).

## Zoom strategy

Buckets at 0.5Ã—, 1Ã—, 2Ã—, 4Ã— (Ã—DPR). During pinch/scroll-zoom gesture: GPU-scale existing rasters (CSS/canvas transform â€” momentarily soft, like Figma). On gesture end (120ms debounce): lazily re-bake visible content at the new bucket, fade-swap. L3 vector chrome never re-bakes â€” it's real SVG.

## Fonts (self-hosted woff2 via @fontsource, latin+latin-ext, `font-display: swap`, preloaded in index.html)

- **Headings/book titles**: Caveat Variable (wght 400â€“700) â€” expressive, but only â‰¥20px (small x-height).
- **Body/notes**: Patrick Hand, 17â€“18px, line-height 1.65, letter-spacing 0.01em â€” the most legible handwriting face for paragraphs; upright and consistent.
- **Accents/callouts/diagram labels**: Kalam (300/400/700 â€” real weights, useful for emphasis); Architects Daughter as diagram-label alternate.
- **UI micro-copy floor**: never render handwriting below 13px; below that switch to Nunito Sans (quiet, rounded, harmonizes). Skip Shadows Into Light and Gochi Hand for anything functional â€” too spindly/irregular; keep them available only as user-selectable "decorative title" options.

## File layout
`src/art/bake.ts` (SVGâ†’ImageBitmap + disk cache), `src/art/filters.ts` (filter-def SVG strings + resolution scaling), `src/art/wobble.ts` (path pre-distortion), `src/art/wood.ts`, `src/art/spines.ts` (+ atlas manager), `src/art/noise.ts` (simplex + mulberry32 + fnv1a), `scripts/gen-icons.ts` (build-time icon wobbler), `src/assets/fonts/` via @fontsource imports.

## Libraries
roughjs@^4.6.6 (bake-time sketchy geometry + editor doodles, canvas backend)
simplex-noise@^4.0.3 (wood grain, wobble displacement, granulation)
svg-path-properties@^1.3.0 (path sampling for pre-distortion; build-time)
@fontsource-variable/caveat@^5
@fontsource/patrick-hand@^5
@fontsource/kalam@^5
@fontsource/architects-daughter@^5
@fontsource/nunito-sans@^5
@tauri-apps/plugin-fs@^2 (persist baked PNG cache to appCacheDir)
gsap (already present â€” book pull-out/hover animation)
no seedrandom dep â€” inline mulberry32 + fnv1a (~15 lines)

## Risks
1) First-run bake cost could hurt cold start â€” mitigate: bake lazily (paper tile + visible shelf first, idle-callback the rest), persist PNGs to appCacheDir so it is one-time-ever per recipeVersionÃ—DPR; budget <300ms for the critical path. 2) Atlas/raster memory blowup at 4Ã— bucket on HiDPI â€” mitigate: LRU page cap, only bake buckets on demand, evict non-visible buckets, 2048Â² pages not 4096Â². 3) WebView2 Chromium-version drift changing feTurbulence output subtly between machines â€” harmless (it's per-machine cache) but include recipeVersion + a tiny golden-hash self-check; also never rely on cross-machine pixel identity. 4) Seeded spines looking same-y or accidentally garish â€” mitigate: curated 12-palette set with bounded hueJitter, weighted parameter distributions, and a debug page rendering 300 seeds side-by-side for tuning. 5) Baked-raster softness during zoom gestures â€” accepted (industry-standard Figma/Maps behavior), masked by 120ms debounced re-bake and keeping all linework/chrome as true vectors. 6) Handwriting fonts harming note-taking legibility â€” mitigate: 13px hard floor, Patrick Hand default body, offer a 'quiet mode' body font toggle (Nunito Sans) without changing the decorative shell. 7) Blob-URL SVG bake fails if art references external images â€” rule: bake inputs must be self-contained (inline data URIs only), enforced by a dev assertion.

