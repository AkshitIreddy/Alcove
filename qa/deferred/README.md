# Deferred lighting — visual QA harness

Renders the deferred scene-lighting pass (`src/render/`) over a flat-box test
scene and writes contact sheets to `out/`. Everything here is throwaway QA
tooling; the shipped code is `src/render/` and `src/art/lighting.ts`.

```
npx vite build --config qa/deferred/vite.config.mjs   # bundle the harness
node qa/deferred/shoot.mjs                            # render the default sheets
node qa/deferred/shoot.mjs sheetRigs sheetPixi        # or pick sheets
node qa/deferred/shoot.mjs "sheetBig:golden-hour"     # arg after the colon
node qa/deferred/shoot.mjs timing                     # ms/frame, printed
```

| sheet | what it answers |
|---|---|
| `sheetHero` | the claim: flat albedo vs the same albedo lit |
| `sheetRigs` | every shipped rig on one scene |
| `sheetAngles` | key angle sweep — shading, shadows and the frame gradient must all follow |
| `sheetElevation` | rake: elevation, shadow reach, height scale |
| `sheetDebug` | the buffers the pass reads (normals, height, AO, shadow) |
| `sheetDiagnose` | one lighting term removed per cell |
| `sheetBloom` | radius sweep — where the single-pass spiral starts to streak |
| `sheetTune` | cumulative value-structure changes |
| `sheetWrap` | terminator wrap x elevation |
| `sheetPixi` | **parity**: raw WebGL2 vs the actual PixiJS filter, plus its buffers |
| `sheetReferenceMatch` | our render at the reference image's aspect |

`sheetPixi` is the important one: it runs the real `DeferredLightingFilter`
through a real Pixi `Application`, so it catches the filter-plumbing bugs the
raw harness cannot (UV mapping, uniform blocks, texture binding).

Headless WebGL is SwiftShader, so timings are a lower bound on real hardware.
