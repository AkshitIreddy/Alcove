# Design: bookshelf-rendering

## Recommendation
Hybrid: PixiJS v8 (WebGL) single-canvas world renderer with pre-baked hand-drawn sprite textures + a thin SolidJS DOM overlay for the pulled-out/opened book and HUD. No live SVG filters anywhere in the hot path.

## Rationale
Evidence-driven elimination. (b) Single big SVG dies immediately: feTurbulence-style filters (the natural way to get pencil/wobble in SVG) are CPU-bound and get slower with octaves; even Firefox's accelerated filter graphs routinely fall back to CPU, and hundreds of filtered elements at 60fps is a non-starter ([Mozilla bug 422371](https://bugzilla.mozilla.org/show_bug.cgi?id=422371), [SVG filter perf reports](https://finance.biggo.com/news/202507211315_SVG_Filter_Performance_Issues)). (a) DOM is what tldraw uses successfully â€” but tldraw's win condition is "arbitrary web content on canvas" (iframes, videos), which we don't need, and its cost is exactly our weakest spot: continuous zoom. Chromium rasterizes layers at a fixed scale, so animating `transform: scale()` on a large container gives blurry pixels during the zoom and a re-raster hitch at the end â€” a known unsolved CSS gap ([csswg #7848](https://github.com/w3c/csswg-drafts/issues/7848), [tldraw perf docs](https://tldraw.dev/sdk-features/performance)). Our view is a dense, uniform grid of hundreds of image-like spines with cinematic zoom â€” the Figma-shaped problem, and Figma's team documented that DOM/retained-browser rendering can't hit their bar, going GPU instead ([Figma: building a professional design tool](https://www.figma.com/blog/building-a-professional-design-tool-on-the-web/), [WebGPU rendering](https://www.figma.com/blog/figma-rendering-powered-by-webgpu/)). (c) Canvas2D with bitmap caching works (Excalidraw's model: rough shapes baked once, dual canvas, viewport culling â€” [Excalidraw rendering pipeline](https://deepwiki.com/excalidraw/excalidraw/5.1-canvas-rendering-pipeline)) but we'd hand-roll batching, mipmapping, render-texture LOD, and hit-testing that PixiJS v8 gives us for free, with far better headroom: v8 renders 100k static sprites at ~0.12ms CPU and has explicit `cullable`/`cullArea` support ([PixiJS v8 launch](https://pixijs.com/blog/pixi-v8-launches), [perf tips](https://pixijs.com/8.x/guides/concepts/performance-tips)). (d) alone fails on text/editing quality â€” the opened book must be a DOM editing surface anyway (Notion-grade editing is DOM), and crisp UI text belongs in DOM. Hence the hybrid: GPU sprites for the world (crisp at zoom via multi-res textures + mipmaps, no layer-raster blur), DOM only for the one focused book and chrome. The hand-drawn look is achieved Excalidraw-style â€” baked into bitmaps once (offscreen Canvas2D with seeded jitter + shared grain tile), never computed per frame. WebView2 on Windows runs Chromium's ANGLE/D3D11 WebGL path; reported perf gaps are low-end edge cases we mitigate with a software-rasterizer detector and degrade mode ([WebView2Feedback #1919](https://github.com/MicrosoftEdge/WebView2Feedback/issues/1919), [tauri #4891](https://github.com/tauri-apps/tauri/issues/4891)).

## Implementation plan
## Module layout (all under src/features/bookshelf/)

- `BookshelfWorld.tsx` â€” Solid component. Mounts one `<canvas>`, creates `Application` with `{ preference: 'webgl', antialias: true, resolution: devicePixelRatio, autoDensity: true, autoStart: false, backgroundAlpha: 0 }` (transparent canvas over a CSS cream-paper body background so idle frames cost nothing). Owns the render-on-demand loop.
- `camera.ts` â€” camera model (below).
- `input.ts` â€” pointer/wheel handling, momentum, click-vs-drag.
- `virtualizer.ts` â€” floor windowing + pooling.
- `floorView.ts` â€” Pixi container per floor (shelf frame + book sprites).
- `spineFactory.ts` â€” procedural spine texture generation + LRU cache.
- `lod.ts` â€” semantic-zoom tiers + floor render-texture baking.
- `PulledBookOverlay.tsx` â€” DOM overlay for the pulled-out book.
- Rust: `#[tauri::command] get_floors(start: i64, count: u32) -> Vec<FloorData>` paged from SQLite; cached client-side in a Solid store `Map<floorIndex, FloorData>`.

## World coordinates & scene graph

World units = CSS px at zoom 1. X: 0..SHELF_WIDTH (~1200). Y grows DOWNWARD, floor i occupies `y âˆˆ [i*FLOOR_H, (i+1)*FLOOR_H)`, FLOOR_H = 320 (shelf plank 40 + book zone 280). Endless downward: i âˆˆ [0, âˆž).

```
app.stage
 â”œâ”€ backdrop     (tiled wall/paper texture, parallaxFactor 0.85 â€” position = -cam.y*0.85*zoom)
 â””â”€ world        (x = -cam.x*zoom, y = -cam.y*zoom, scale = zoom)
     â”œâ”€ FloorView(i), FloorView(i+1) ...   (pooled)
     â””â”€ fxLayer   (pull-out ghost sprite, drop shadow)
```

## Camera model (`camera.ts`)

State: `{ x, y, zoom, logZoomTarget, vy, vx }`. All motion integrated in one `update(dt)` called from the ticker.

- **screenâ†”world**: `screen = (world - cam) * zoom`; `world = screen / zoom + cam` (screen in CSS px; Pixi handles DPR via resolution/autoDensity).
- **Zoom**: keep zoom in log space for uniform feel. Wheel: `logZoomTarget = clamp(logZoomTarget - e.deltaY * 0.0015, ln(0.06), ln(2.5))`. Per frame smooth: `zoom = exp(lerpExp(ln(zoom), logZoomTarget, dt, 12))` where `lerpExp(a,b,dt,k) = b + (a-b)*exp(-k*dt)` (frame-rate independent). **Anchor preservation**: capture `anchorWorld = screenToWorld(cursor)` when wheel starts; after each zoom step set `cam.x = anchorWorld.x - cursor.x/zoom; cam.y = anchorWorld.y - cursor.y/zoom`.
- **Zoom-to-floor (semantic zoom-in click at far zoom)**: GSAP tween of `{ln(zoom), camX, camY}` to center target floor at zoom 1, `duration 0.6, ease: 'power3.inOut'` â€” animate in log-zoom space so the zoom feels linear.
- **Momentum pan**: during drag `cam.y -= dyScreen/zoom` (and x). Sample velocity as weighted average of last 4 pointer deltas (weights 0.4/0.3/0.2/0.1) over their timestamps. On release: each frame `cam.y += vy*dt; vy *= exp(-3.5*dt)`; kill when `|v| < 8/zoom` px/s.
- **Clamp + rubber band**: hard world bounds `y â‰¥ -80`, `x` clamped so shelf stays in view. While dragging past bound: `cam.y = bound + overshoot*0.25`. On release: damped spring back (`stiffness 170, damping 26`, or a 0.35s GSAP `power2.out` tween), cancelling momentum.

## Virtualization (`virtualizer.ts`)

Per frame (only when camera moved): `first = floor((cam.y - margin) / FLOOR_H)`, `last = floor((cam.y + viewportH/zoom + margin) / FLOOR_H)`, margin = 0.5*FLOOR_H. Diff against mounted set; release FloorViews outside range to a pool (cap 12; excess destroyed, textures kept in LRU), acquire+populate for new indices. FloorView population reads `floorStore.get(i)`; missing pages trigger `get_floors(i, 8)` (debounced, dedup by page) and mount placeholder "penciled outline" shelf until data lands â€” reactive via `createEffect` on the store. At LOD2 (far zoom) range can span 40+ floors: do NOT mount books â€” see LOD.

## Semantic zoom / LOD (`lod.ts`)

- **LOD0, zoom â‰¥ 0.7**: full spines â€” hi-res texture (~96Ã—440 device px) incl. baked title text, foil ornament, cloth grain. Hover enabled.
- **LOD1, 0.22 â‰¤ zoom < 0.7**: same sprites but low-res texture variant (32Ã—146), no text (illegible anyway), hover off, `eventMode:'none'` on books, floor container remains interactive for zoom-to-floor.
- **LOD2, zoom < 0.22**: each floor swaps its live container for ONE cached `RenderTexture` sprite (bake with `renderer.render({container: floorView, target: rt})` at 256px-wide resolution, LRU cap 60 floors â‰ˆ 15MB). Floors render as a strip of stamps â€” thousands of floors visible costs ~1 sprite each.
- Tier switches use hysteresis (Â±0.03 zoom) and a 120ms crossfade (alpha tween of old/new representation) to avoid popping. Mipmaps ON for all spine textures (`autoGenerateMipmaps: true`) so zoom-out never shimmers; zoom-in beyond 1.0 (max 2.5) is covered by the 2x-resolution hi-res bake so nothing blurs.

## Hand-drawn spine generation (`spineFactory.ts`) â€” the Excalidraw pattern: bake once, draw forever

`generateSpine(seed: number, book: BookMeta, scale: 1|2) â†’ Texture` via OffscreenCanvas:
1. Seeded PRNG (inline mulberry32(seed)) picks: silhouette (7 templates: straight/tapered/banded/scalloped...), palette from the amber/terracotta/moss ramp (HSL jitter Â±6Â°), 0â€“3 ornament stamps, band positions.
2. "Pencil" line: draw each edge as a polyline with per-vertex jitter (Â±1.2px, precomputed from seed â€” deterministic across regenerations), double-stroked at alpha 0.55 with 0.5px offset for the sketchy doubled-line look. This replicates Rough.js output without the dependency, and it happens ONCE per book, not per frame.
3. Watercolor wash: 2â€“3 overlapping `globalAlpha 0.25` blobby fills (quadratic-curve blobs) + `multiply` composite of one shared 256Â² paper-grain tile (a static PNG asset â€” grain is baked art, NOT feTurbulence).
4. Title: `fillText` in the embedded handwriting woff2 (load via FontFace before first bake), rotated 90Â°, only on the 2x hi-res variant.
5. `Texture.from(canvas)` â†’ cache. Two caches: lo-res permanent (300 books â‰ˆ 4MB), hi-res LRU cap 64MB (~350 books) evicting by last-visible time. Generation is chunked through `requestIdleCallback` (4 spines/idle slice) prioritized by distance to viewport, so scrolling into a new floor shows lo-res instantly and sharpens within ~100ms.

## Input & hit-testing (`input.ts`)

Pointer events on the canvas with `setPointerCapture`. Click vs drag: threshold 5px OR 250ms. On tap: `renderer.events` hit-test (books `eventMode:'static'`, `hitArea = new Rectangle(...)` covering the spine incl. 4px slop). Hover (LOD0 only): GSAP `y -= 6, rotation: -0.015, duration 0.18` on the sprite + soft baked shadow sprite fade-in â€” cheap, sprite-transform-only.

## Pull-out animation & DOM handoff

1. Tap book â†’ freeze camera input. Clone sprite into `fxLayer` (screen-space), hide original, set floor siblings' `tint` slightly dark for focus.
2. GSAP timeline (PixiPlugin): pull toward viewer â€” `scale Ã—1.35, y -= 40, skewX 0.06â†’0, drop-shadow sprite grows`, 0.45s `back.out(1.4)`.
3. At t=0.45s compute the ghost's screen rect, mount `PulledBookOverlay` (Solid `<Show>`) â€” a DOM element with the crisp SVG/HTML book cover positioned at that exact rect (`position:fixed; transform: translate(...) scale(...)`), crossfade canvas ghostâ†’DOM over 80ms, then FLIP-animate the DOM element to center stage and open into the editor route. Reverse on close. This gives GPU-smooth world motion AND DOM-crisp text/editing where it matters.

## Render-on-demand + SolidJS integration

`autoStart:false`; a `dirty` flag set by camera motion, active GSAP tweens (`gsap.ticker` piggybacks), texture arrivals, and store changes. RAF loop: if dirty â†’ `camera.update(dt); virtualizer.sync(); app.render()`; else skip (idle = 0% GPU, protects battery/memory bar). Solid owns all state (camera target, open book, floor data) in stores; Pixi objects are non-reactive mirrors mutated inside `createEffect`s â€” never diff Pixi through JSX. `onCleanup` destroys app + caches.

## Degrade mode

At startup create the WebGL context and check `WEBGL_debug_renderer_info` for 'SwiftShader'/'llvmpipe' or measure a 20-frame probe; if software: force LOD1 max textures, cap DPR at 1. Also ensure Tauri doesn't launch WebView2 with `--disable-gpu` and set `additionalBrowserArguments` to leave hardware acceleration default-on.

## Libraries
pixi.js@^8.6 (WebGL renderer; do NOT enable the WebGPU preference initially)
gsap@^3.12 + its bundled PixiPlugin (register once: gsap.registerPlugin(PixiPlugin); PixiPlugin.registerPIXI(PIXI))
no Rough.js â€” replicate the doubled-jitter stroke inline in spineFactory (one ~80-line function, avoids per-frame path cost and a dependency)
no pixi-viewport â€” custom camera (~150 lines) needed anyway for log-zoom, rubber-band, and semantic zoom-to-floor choreography

## Risks
1) WebView2 lands on a software WebGL path on some low-end machines (documented in WebView2Feedback #1919 / tauri #4891) â†’ mitigated by the SwiftShader detection + degrade mode; worst case still renders, just flatter. Verify early on a real mid-range laptop, not just dev machines. 2) Texture memory creep with hundreds of unique spines â†’ enforced budgets (lo-res permanent ~4MB, hi-res LRU 64MB, floor-bake LRU ~15MB); call `texture.destroy(true)` on evict and watch `renderer.texture.managedTextures` in a debug HUD. 3) Baked-bitmap look at zoom 2.5x could soften â†’ hi-res variants are baked at 2x world scale, covering max zoom exactly; if art direction later wants deeper zoom, add a 4x tier generated on demand for the focused floor only. 4) Canvas world is invisible to accessibility â†’ mirror visible floors/books into an offscreen DOM list (aria-labels, arrow-key navigation triggering the same zoom-to-floor/pull-out commands); budget this in, it's cheap with Solid `<For>`. 5) GSAP tweens mutating Pixi objects while Solid effects also mutate them â†’ single ownership rule: Solid effects only *start* tweens or set targets, never write mid-tween properties; camera is the only per-frame writer. 6) Chunked idle-time spine baking can starve during continuous fling â†’ cap fling velocity and always show lo-res instantly (already permanent in memory), so worst case is a briefly-soft spine, never a blank one.

