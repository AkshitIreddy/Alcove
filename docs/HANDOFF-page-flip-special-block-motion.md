# Handoff: unresolved special-block text movement during page turns

Updated 2026-08-09. This is an **open release blocker**. The owner has retested
the latest implementation and explicitly reports that it is **not fixed**.
Do not infer success from the checked-in probes, screenshots, comments, or the
earlier TODO wording.

## The task

Stop text inside special editor blocks from moving vertically during a page
turn and then returning to its resting position. Ordinary prose on the ruled
page appears stable; the visible movement is inside things such as cards,
callouts, diagrams and other custom TipTap node views.

The most reliable reproduction supplied by the owner is:

1. Open the shipped Welcome book.
2. Navigate until **Ink between words** is the **left** page.
3. Click the **left outer page-turn edge** of that page to turn backward.
4. Watch the text inside special elements during the turn and at the landing.

This directional detail matters. Earlier work repeatedly tested the right leaf
or a different spread and produced false confidence. The owner says this exact
left-edge turn still moves the special-element text.

The owner attached a fresh screenshot named
`codex-clipboard-d39cec63-f8a3-4e6e-800b-da1add55bdf5.png`, but its temporary
Windows clipboard path no longer existed when Codex tried to read it. Ask the
owner to attach it again or place it in Downloads if the image is needed. Do
not claim that the screenshot was inspected.

## Acceptance condition

At normal speed on the owner's localhost/Tauri runtime, the text and internal
art of every special block must keep the same page-relative vertical position
from the first turn frame through the final live-DOM frame. The owner is the
acceptance authority for this motion defect. A still image, a sparse CDP
screencast, or a source-bitmap comparison alone cannot close it.

Do not change the already accepted page shadows, corner/dog-ear behavior,
paper colour, sound system, opening handoff or studio panels while solving this
bug.

## Relevant architecture

Read `AGENTS.md` and `docs/design/page-flip.md` before editing.

The reader uses live DOM while resting and a WebGL curl during motion:

- `src/flip/PageFlipController.ts` owns gesture start, face selection, hiding
  the moving live leaf, GSAP progress, and the landing handoff.
- `src/flip/curl.ts` owns the curl and ground shaders plus texture upload and
  draw order.
- `src/flip/rasterCache.ts` captures mounted page DOM.
- `src/flip/offscreenPages.ts` builds and captures unmounted adjacent pages.
- `src/flip/snapshotGeometry.ts` contains geometry-freezing work added during
  previous failed attempts.
- `src/flip/FlipSurface.tsx` exposes the development cache bridge introduced by
  commit `9c0e17b`.
- `src/styles/flip.css` switches visual ownership between live leaves and the
  canvas. `src/styles/spread.css` supplies the paper/edge proxies.
- `src/editor/nodes/` and `src/styles/editor.css` define special node views.
  The callout reproduction is in `src/editor/nodes/callout.tsx`; its CSS begins
  at `.nb-callout` in `src/styles/editor.css`.
- The relevant Welcome source is in `src/data/seed.ts`: **Lists that think**
  near line 1325, **Ink between words** near line 1357.

For a backward turn from Ink, distinguish all visual owners instead of calling
the whole thing “the page”:

- moving front texture;
- moving back texture;
- revealed-page ground texture;
- stationary live DOM leaf;
- newly mounted live DOM at landing.

The still-visible movement has not yet been assigned conclusively to one of
these owners. The last investigation assumed the green callout on **Lists that
think** was the affected element; the owner's failed retest means that
assumption must be reopened.

## What has already been tried and did not solve the owner report

Do not repeat these as unmeasured fixes:

### Snapshot block freezing

- `7efc471 fix(flip): preserve transformed block geometry`
- `17e14a5 fix(flip): preserve transformed block origins`

These changed `src/flip/snapshotGeometry.ts` to freeze measured top-level block
geometry. DOM and source-bitmap probes looked stable, but the owner still saw
the motion.

### Shader y compensation

- `b837632 fix(flip): preserve text baselines through curl`
- `edbd0f8 docs(flip): record vertical typesetting invariant`

`curl.ts` currently pre-compensates clip-space y for the perspective divide and
projects `local.y` rather than the deformed y. Held frames and source textures
appeared stable. This also did not solve the owner's exact turn.

### Custom node-view margin freezing

- `d7c02d2 fix(flip): preserve custom block geometry in snapshots`

The latest attempt measured each direct `.nb-node-view` child, absolutely
positioned it at the live border-box origin, and cleared its outer margin in
both mounted and offscreen captures. The theory was that html-to-image created
a formatting context that stopped an 8px child margin from collapsing through
the transparent wrapper. A CDP sequence appeared to keep one green callout at
the same top coordinate, but the owner's real-time retest still fails.

Treat the margin theory as disproven or incomplete. The code remains in the
tree and may be retained, revised, or carefully reverted after measuring its
actual effect. Do not revert broad commits blindly because other snapshot
fidelity corrections share this area.

### Why the previous verification was inadequate

The earlier probes established some narrower facts, not the requested outcome:

- the live Ink page and its source bitmap cross-correlated at `dy=0`;
- selected top-level DOM boxes reported equal `getBoundingClientRect()` values;
- a sparse CDP compositor capture appeared to keep one callout origin stable;
- TypeScript and smoke tests passed.

None of those proves that every submitted GPU frame samples the texture at the
same vertical coordinate, that the correct affected element was measured, or
that the WebView2/Tauri path matches the headless Chromium sample cadence.
The owner has now supplied the decisive negative result.

## High-value next hypothesis: perspective-correct varying interpolation

Investigate this before adding another DOM-freezing layer.

The vertex shader now keeps the **geometry's** screen-space y stable, but it
still declares `out vec2 vUv` and assigns `vUv = a_uv`. The fragment shader
therefore receives the default perspective-correct interpolation. Across a
curl triangle, `gl_Position.w` varies with depth. Even when the vertices are
projected onto stable screen y positions, perspective-correct interpolation can
move the sampled texture's internal y between those vertices. That can make
text slide inside an apparently stable card or diagram, which fits the owner's
description better than a top-level DOM-box shift.

Test this as a hypothesis, not as a presumed fix. Temporarily emit both
`uv * gl_Position.w` and `gl_Position.w`, interpolate both, and divide them in
the fragment shader to recover screen-linear UVs, or use an equivalent
WebGL2-compatible no-perspective construction. Compare the actual framebuffer
at identical progress values before deciding. Confirm the GLSL ES 3.00/WebGL2
compatibility rather than assuming desktop GLSL qualifiers exist.

Also inspect whether the ground pass and moving curl use different UV rules.
The defect may be an ownership/UV discontinuity when the same block changes
from a ground texture to moving/back texture or to live DOM.

## Required diagnostic method

1. Use one exclusive server and a fresh page load. Do not trust a run that
   received Vite HMR during the turn.
2. Reproduce the exact left-edge Ink turn before editing. Record direction,
   spread index, page ids, `front/back/revealed` ids, cache readiness, and
   whether the controller chose WebGL, rigid fallback, or `crossfadeNavigate`.
3. Slow the turn substantially as a temporary diagnostic so a one-frame jump
   becomes inspectable. Check the first frame, several mid-curl frames, the
   navigation commit, `is-flip-releasing`, and the first live-DOM frame.
4. Instrument the actual rendered canvas, not just source DOM. A robust probe
   should read pixels after each submitted WebGL frame/fence and associate the
   capture with `p`, direction and face ids. CDP screencast can skip the brief
   frame the owner sees.
5. Measure separate regions for the moving front, back, revealed ground and
   stationary live leaf. Within a special block, track both the container edge
   and one internal text baseline. If the edge is stable but text moves, the
   fault is sampling/interpolation, not layout.
6. Add temporary `ResizeObserver`/`MutationObserver` logging to the live custom
   node view and its inner content. This will rule in or out a real DOM reflow
   when `is-flip-gesture`, `is-flip-scene`, `is-flipping`,
   `is-flip-releasing`, or `snapshotting` changes.
7. Deliberately sabotage the suspected mechanism and confirm the probe becomes
   visibly red. A check that has not caught an injected vertical offset is not
   an adequate gate for this bug.
8. Remove all temporary probes and captures after diagnosis. Run only the
   proportionate gates: `npx tsc --noEmit`, `npm test`, `git diff --check`, then
   ask the owner to perform the exact real-time retest.

## Current repository state at handoff

The failed fix is committed locally on `main`; nothing in this batch was
pushed or released:

- `d7c02d2 fix(flip): preserve custom block geometry in snapshots`
- `b837632 fix(flip): preserve text baselines through curl`
- `17e14a5 fix(flip): preserve transformed block origins`
- `7efc471 fix(flip): preserve transformed block geometry`
- `9c0e17b test(flip): expose cached face pixels`

The separate held-cover opening fix is `db77be0` and should not be entangled
with this investigation. Port 1420 was stopped at the previous checkpoint.

The latest pre-handoff automated state was green (`npx tsc --noEmit`, 5 smoke
tests, `git diff --check`), but that is not evidence that the motion bug is
fixed.
