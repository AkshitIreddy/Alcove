# Notebook — handoff brief

Everything below is current as of commit `9469771` on `main` (private repo `AkshitIreddy/notebook`). Nothing is running; the working tree is committed and pushed.

---

## What the project is

**Notebook** is a Windows desktop note-taking app with an unusual premise: your notes live in a **hand-drawn bookshelf world**. You drag a book off a shelf, it opens into a two-page spread, and you write on the pages like a real notebook. The shelf extends endlessly downward; you pan and zoom around it like a canvas.

**Stack:** Tauri 2 (Rust backend) + SolidJS + TypeScript + Vite. PixiJS v8 (WebGL) renders the shelf world; the book pages are live DOM running a TipTap v3 block editor; page turns use a WebGL cylinder-curl shader fed by page snapshots. GSAP for animation, Howler for sound, SQLite via `tauri-plugin-sql` for storage.

**Scale:** ~48 commits, ~1,026 unit tests, a Playwright e2e suite, and a working NSIS installer. It is a large, functioning app — not a prototype.

**Key features already working:** infinite bookshelf with drag-to-pull books and semantic zoom; Notion-grade block editor (slash menu, drag handles, right-click block menu, tables, callouts, toggles, stickers, effects) with handwriting-style fonts; fixed-height pages that overflow onto the next page rather than scrolling; a custom text format ("Notebook Script") that any external AI chatbot can write, which the user pastes in to generate formatted notes; hand-drawn diagram renderers (trees, mindmaps, flowcharts, timelines); image paste/drop, link-preview cards, Openverse image fetch; full-text search + Ctrl+K quick switcher; procedurally synthesized sound effects; a settings panel with ~25 options and 4 UI themes; a guided tutorial; an export/import bundle system with restore points; backups, tray, perf HUD.

---

## The goal right now

Make the app **beautiful** — specifically, make the bookshelf look like a **high-end digital painting**, and keep it fast.

The reference image is in the repo at **`docs/design/reference/bookshelf-reference.png`** — open it and study it before touching the art.

What it actually contains, read closely:

- **Composition is the whole trick.** Foliage frames the *edges* — a vine mass down the right side, a flowering vine up the left, a garden bed along the bottom — while the **centre stays clear books**. There is real negative space. It is not uniform ground cover. (Our current build ignores this and covers everything, which is why the user said it looks like "lettuce everywhere".)
- **Books are densely packed**, shoulder to shoulder, filling each shelf completely — with widths from thin slivers to fat tomes and an irregular height skyline. Very few gaps.
- **The richness comes from light and material, not from saturated hues.** The spines are actually fairly muted — navy, oxblood, tan, cream, olive, brown — but they *read* as gorgeous because of warm raking light, gold foil catching that light, deep shadow behind, and visible material texture. This matters: the user has separately asked for "very very colorful", so the resolution is **saturated, joyful colour in the themes, but achieving depth the way this image does — through lighting, contrast and material rather than flat bright fills.**
- **Light** rakes hard from the upper right: a blown-out hot corner, visible warm rays, and a strong falloff into near-black at the upper left and in every recess.
- **Leaves** are large relative to the books (roughly a third of a book's height), heart-shaped, overlapping into masses with depth tiers.
- **Flowers** appear as concentrated clusters (pink on the left and bottom, small white ones on the right vine) — never sprinkled evenly.

(The file is a stock image and carries a small watermark; use it as art direction only, never ship any part of it.)

Their verdict on the current app art, verbatim:

> "the themes dont really look that nice, it looks very cheap, like i genuinely want it to look like a high end digital painting… the vines are so thin and the leaves are so [low] quality and tiny, and the pattern and design feels simple, flowers are barely on shelf and wallpaper just like something a child could make not some talented artist… if you notice the books in this look so much much better than the books we have, it feels way more artistic, and beautiful"

Other stated preferences:
- **Very colorful** — "i like very colorful stuff, like very very colorful rather than boring dull colours". Muted/sepia/heritage palettes read as dull and boring to them.
- Nature-forward default look: "green leaf vine, cherry, pink, flower kind of vibe"; plus playful character themes (robot, dinosaur) — "not the boring themes".
- **Shadows and lighting should serve artistic beauty, not realism.**
- Wants **living motion**: things that move gently — wind in the leaves, a butterfly crossing, a robot turning its head — themed per world.
- The app should make someone "fascinated to even just open the app… like how people say even if an anime is not that good it's worth watching for the art alone".

`docs/design/painterly-art-direction.md` contains a concrete gap analysis between the reference image and the current art (book thickness variety, page-block edges, leaf size, flower clustering, light rig, contact shadows). `docs/design/library-themes.md` defines the theme system and a per-book "Book Studio" customization model.

---

## The problems to fix (in priority order)

### 1. Startup blocks the main thread for ~118 seconds — CRITICAL
Measured directly: on first load the page becomes completely unresponsive for **117,645 ms**, then runs fine (2–3 ms eval latency, normal FPS). So this is **not** a per-frame rendering cost — it is a catastrophic one-time synchronous bake at startup. A Playwright screenshot times out at 30s because no frame can be composited.

The art pipeline is "bake once into textures, then draw sprites", which is the right architecture — but the bake got enormous during the recent art rebuild and it runs synchronously on the main thread. Modules ballooned: `src/art/spines.ts` 150KB, `caseArt.ts` 146KB, `flora.ts` 118KB, `lighting.ts` 87KB.

Likely contributors: lush flora now grows clumps of 2–4 specimens per anchor with large leaves; new multi-pass lighting (ambient occlusion, contact shadows, key light, rim light, light shafts, bloom, vignette, colour grade) applied per baked element; `ctx.filter` used in `lighting.ts` (expensive); two `getImageData/putImageData` per-pixel loops in `spines.ts`. Disk caching exists (`bakeCached` in `src/art/bake.ts`, keyed by recipe version) but a cold cache still pays the full cost.

**Needs:** chunk the bake across frames (idle callbacks / async yielding) so the app is interactive immediately with progressive refinement; and/or move baking to a worker with OffscreenCanvas; and/or cut the per-element cost. The user must never see a frozen window.

### 2. The flora reads as "lettuce everywhere"
User's words after the rebuild: *"visuals make it look pretty weird like lettuce everywhere"*. My instruction to the art agent was too blunt — I told it leaves should be 25–60px and foliage should occupy ~30% of the frame, and it applied that uniformly. The reference image has lush foliage but it is **composed**: growth is concentrated at the edges and corners, framing the shelf and draping over specific spots, with plenty of clean shelf visible. It reads as a painting with a focal point, not as uniform ground cover.

**Needs:** compositional placement (asymmetric, clustered, edge-weighted, with negative space) rather than even distribution; genuine depth tiers; and leaves that read as distinct species rather than generic green blobs. One agent was mid-fix when stopped and noted *"the flowers read as popcorn"* — that is also unresolved.

### 3. Books do not look like the reference
Ours are near-uniform rectangles with flat fills. The reference has thickness ranging from ~8px slivers to ~45px tomes, heights varying 20–30% into an irregular skyline, some books leaning or recessed, visible cream page-block edges beside every spine, real materials (cracked leather, ribbed cloth, marbled boards), raised bands casting their own shadows, and gold foil titles that catch the light. A rebuild was in progress when stopped.

### 4. Sound is rough
User: *"the sound effects are very rough low quality, like i want smoother high quality calmer options"*. All sounds are procedurally synthesized by `scripts/gen-sounds.mjs` (zero dependencies, writes WAVs directly) into `public/sounds/`. A redesign toward layered, warm, lowpassed, reverb-tailed sounds with multiple variants per effect was in progress. 4 sound tests currently fail.

### 5. UI bugs
- A card holding "new book / studio / add floor" controls **overlaps the top of the bookcase**.
- An unexplained **dark shadow band at the top** of the shelf view.
- **Page-turn animation**: content appears clipped near the end of the turn, and the back face of the turning page shows no text — it should show that leaf's reverse content, so a turn reads as physical paper. (`src/flip/` — controller, curl shader, raster cache.)
- **No randomise option** in the Book Studio; the user asked for one ("surprise me" plus per-field re-rolls).

### 6. 11 failing unit tests
`npx vitest run` → 1015 passed, 11 failed. In `tests/art.test.ts` (1), `tests/art-bookstyle.test.ts` (2), `tests/sound.test.ts` (4), `tests/art-flora.test.ts` (4). All are consequences of the half-finished art/sound rebuild — the tests encode intended invariants (e.g. "ships the six binding materials the spec names", "a blossom branch no longer dwarfs the rest of the planting"). Either satisfy them or update them deliberately.

---

## Current status

- **Builds and typechecks clean** (`npx tsc --noEmit`, `cargo check`).
- 1015/1026 unit tests pass; e2e suite exists (`npm run e2e`).
- The app **runs** — after the ~118s freeze it is responsive and functional.
- Everything is committed and pushed; a tag-triggered GitHub Actions release pipeline exists (push a `v*` tag → builds the installer, publishes a release with generated notes).

**How to run it:** `npm run dev` serves at `http://localhost:1420` (browser mode uses an in-memory stub database, so created books do not persist — fine for visual work). `npm run tauri dev` runs the real desktop app. `npm run tauri build` produces the installer.

**Verify with:** `npx tsc --noEmit`, `npx vitest run`, `cargo check --manifest-path src-tauri/Cargo.toml`, `npm run e2e`.

**Repo conventions** are in `CLAUDE.md` — read it first. Design docs live in `docs/design/`. Notable: everything hand-drawn/warm; left icon rails rather than top bars; pages never scroll (overflow flows to the next page); all art must be baked and sprite-drawn for 60fps; no live SVG filters in hot paths.

---

## Outstanding work queue (beyond the bugs above)

These were planned and specced but not built. Roughly in the order the user cares about:

1. **Add-book affordance** — *there is currently no way to create a book anywhere in the app.* The Book Studio, trash drawer and search all exist, but nothing creates a book. Needs a charming affordance on the shelf (empty slot with a pencil outline and a `+`), plus "add floor", plus a shelf right-click "New book here".
2. **Reach the studios from the shelf** — `src/views/rail/LibraryStudio.tsx` and `BookStudio.tsx` exist but nothing opens them, so the user reported "I didn't see an option to change themes". Needs a visible shelf control, theme cards rendered from the real theme art, and persistence.
3. **Living motion layer** — a shared wind field swaying leaves and drifting petals, plus per-theme scheduled events: a butterfly crossing (Blossom Grove), a robot turning its head and blinking LEDs (Robot Workshop), a pterodactyl silhouette (Dino Dig), a fish darting and caustics rippling (Coral Reef), a comet (Star Voyager). Cheap, GPU-friendly, respecting `--motion-scale`.
4. **More colorful worlds to the painterly standard** — the six new ones sketched (Blossom Grove as default, Robot Workshop, Dino Dig, Candy Shop, Coral Reef, Star Voyager) plus 2–3 backdrop variants each, and a saturation pass so none of the original eight reads as drab. See `docs/design/library-themes.md`.
5. **Saturated UI palette** — `src/styles/tokens.css` is still warm-parchment browns and creams; the user finds the chrome dull. Needs livelier accents, brighter washes (coral/turquoise/violet/lime for stickers, highlights and callouts), with contrast re-checked across all four UI themes including night.
6. **Expose import/export and tutorial replay properly** — the transfer panel currently only opens via `Ctrl+Shift+E` / `Ctrl+Shift+I`; it needs real entries in the rail or settings, plus a settings row to replay the guided tutorial.
7. **Motion design system** — unify easing/duration/choreography across the app, add page transitions, micro-interactions, spring physics, and user-facing motion customization.
8. **Notion-depth writing features** — nested toggles, columns, math, footnotes, sync blocks, backlinks, sortable tables, a selection formatting toolbar, more markdown shortcuts.
9. **Notebook Script v2 + diagnostics log** — tighten the AI-facing format into a precise mini-language (variables, reusable styles, strict-mode validation), and add an exportable diagnostics log (logic *and* visual issues) that a user can hand to their AI when something goes wrong. Current spec: `src-tauri/resources/notebook-script-spec.md`.
10. **UI/UX audit findings** — `docs/design/ui-audit.md` contains a written design critique whose fixes were only partly applied.
11. **Final installer pass** — rebuild and verify the NSIS installer once the above lands.

## What would help most

1. Kill the 118-second freeze without giving up visual richness — progressive/worker baking is probably the answer.
2. Get the shelf to genuinely resemble the reference painting: composed foliage with negative space, varied believable books, and a light rig with contact shadows that flatters rather than simulates.
3. Then the smaller fixes: chrome overlap, dark band, page-turn back face and clipping, Book Studio randomise, sound warmth, failing tests.

Please look at the reference image the user gives you before starting on the art — the specific qualities in it (light direction, contrast range, leaf scale, book silhouette variety, flower clustering) are the actual spec.
