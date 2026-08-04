# Alcove — the honest state, as handed back

**Date:** 2026-08-04 · **Tree:** `a173150` plus an uncommitted working set
(`.github/workflows/release.yml`, `docs/readme/img/*.png`, `README.md`,
`docs/readme/part-*.md`, deleted `.nbqa/*`, deleted `shots-now/room-rank/*`).

This is a fourth pass over three reviewers' reports. Every claim below I either
re-derived from source or re-measured against the running dev server. Where a
reviewer was wrong, it says so and why. Where two reviewers disagree, both
numbers are given. Nothing here was fixed and nothing was committed.

**Verification baseline, run by me:**

| command | result |
|---|---|
| `npx tsc --noEmit` | **exit 0**, zero output |
| `npx vitest run` (run 1) | **RED** — 7 files / 12 tests failed |
| `npx vitest run` (run 2) | **RED** — 6 files / 7 tests failed |
| failing files, re-run in isolation | **all pass except `tests/readme.test.ts`** |

All three reviewers reported the suite green ("71 files, 2351 passed"). **It is
not green on this tree**, and the count has moved to 2378. See BROKEN #2 — the
important part is that the suite is *non-deterministic*, which is a worse
problem than a red test.

Dev-server note that costs the next session an hour if unknown: the server
answers on `localhost:1420` and `http://[::1]:1420` but **`127.0.0.1:1420`
refuses the connection**. Reviewer 3 said "`localhost` fails from node/curl" —
that is wrong as stated (curl to `localhost` returns 200); the real hazard is
that anything resolving to the IPv4 loopback gets nothing.

---

## 1. What works

Stated flatly, only where I confirmed it myself.

- **Typecheck is clean.** `npx tsc --noEmit` exits 0.
- **The design-vocabulary counts in `CLAUDE.md` are accurate.** Reviewer 2
  loaded the modules and counted rather than grepping: 52 builds, 50 timber
  patterns, 113 shelf presets, 126 wallpaper presets, 189 book presets
  (`ROLLABLE_PRESETS` 164), `flat.CLOTHS` 50, `flat.HOUSE_CLOTHS` 6, 60 themes
  each with exactly 6 cloths. I spot-checked the structural claims around them
  and they hold: `DEFAULT_*`/`FALLBACK_*` genuinely split, `themeKeyOf` in
  `libraryKey.ts:60`, `spines.ts` imports no `designPrefs`, `bookDesign.ts`
  reads no `flatScheme()`, `world.ts:1762-1766` has `autoGenerateMipmaps: false`.
- **The keyboard path to opening a book is intact.** `.pulled-book` carries
  `role="button"`, `tabindex=0`, `aria-label="Open <title>"`
  (`src/features/bookshelf/PulledBookOverlay.tsx:659-675`). I focused it and
  pressed Enter; the spread opened. *(I initially concluded the opposite and was
  wrong — see the correction in §5.)*
- **The book comes forward rather than opening on one click**, with a "back to
  the shelf" control top-left. Confirmed visually in my own capture. The
  behaviour is right; the copy describing it is not (BROKEN #5).
- **The flat rule holds in the art.** Zero `shadowBlur`, `shadowColor`,
  `ctx.filter=`, `globalCompositeOperation`, Pixi `.filters=`, `BlurFilter`, or
  `backdrop-filter` anywhere in `src/`. One gradient, in `src/art/charms.ts`,
  which `CLAUDE.md` explicitly permits.
- **Probes that genuinely gate and genuinely pass:** `probe-vocabularies.mjs`,
  `probe-movebook.mjs`, `probe-taste.mjs`, `probe-groupd.mjs`,
  `welcome-bake.mjs`, `dialog-exits.mjs`, `lettering.mjs`, `underlines.mjs`,
  `preset-bakes.mjs`. `probe-vocabularies` and steps 2–3 of
  `probe-studio-wiring` poll-until-applied and throw on timeout — those are real
  gates.
- **Wallpapers, page stickers, coverings, house cloths, carpentry builds and
  block frames read richly** on the specimen boards in `shots-now/roster/`, and
  the wallpaper work survives the seam test behind a real case.
- **No component orphans.** Reviewer 2's independent AST sweep of 118
  component-shaped exports resolved every candidate to a real render site,
  including dynamic ones (`icon: BrushIcon`, `SolidNodeViewRenderer`,
  on-demand `render(...)`).

---

## 2. What is broken

Most serious first.

### 2.1 The whole fore-edge vocabulary is unreachable: 50 names, 1 picture

**The single worst defect in the tree, and worse than any reviewer stated.**

`src/art/spines.ts` defines 50 `EDGE_TREATMENTS` with full `EDGE_SPECS`
(`spines.ts:1014+`) carrying `ground`, `pattern`, `density`, `mark`, `gild` and
`cut`. The only drawer that consumes them is
**`drawBlockEdge` (`src/art/spines.ts:2896`)**, and:

```
$ grep -rn "drawBlockEdge" src/ tests/ shots-now/ scripts/
src/art/spines.ts:2896:export function drawBlockEdge(
shots-now/edges-board.mjs:82,84    <-- a QA board. That is all.
```

**`drawBlockEdge` has no caller in `src/`.** Neither does its resolver
`edgeSpec()` (`spines.ts:1246`). The rich implementation — including the
`traceBlockEdge` rough/deckle silhouette work at `spines.ts:2828-2865` — is
reachable only from a specimen board.

What the app actually paints is a *second, separate* implementation:
`paintTextBlock` in `src/art/covers.ts:1411`, which special-cases exactly
`gilt`, `speckled` and `marbled` and treats all other 47 values as plain.

Net effect for a reader:
- On a **spine**: all 50 values render identically. Proof:
  `shots-now/roster/edges-mag.png` — I looked at it; "Plain", "Gilt", "Red
  edges", "Gauffered", "Deckle", "Foxed" and 44 more are pixel-identical tiles.
- On a **cover**: 4 pictures for 50 values. "Red edges" does not paint the edge red.
- `src/views/rail/BookStudio.tsx:1183-1194` offers all fifty as text chips with
  no swatch, so the reader picks from fifty labels that mostly do nothing.

**The docblock is also false.** `spines.ts:238-241` states the specs "exist for
`art/covers.ts`, which paints the fore-edge sliver on the pull-out board — see
`edgeSpec`." `covers.ts` never calls `edgeSpec` and never reads `EDGE_SPECS`.
This is a doc asserting a wiring that does not exist.

### 2.2 The test suite is non-deterministic, and one test is genuinely red

Two consecutive full runs disagreed: **12 failures, then 7**, with a different
set each time. Duration swung 67s → 210s. Re-running each failing file in
isolation:

- `tests/book-bindings.test.ts`, `tests/bookcases.test.ts`,
  `tests/brand-consistency.test.ts`, `tests/stub-persistence.test.ts`,
  `tests/taste-onboarding.test.ts`, `tests/transfer-bookcases.test.ts` — **all
  pass in isolation.** Their full-suite failures are `Hook timed out in 10000ms`
  under parallel load.
- `tests/readme.test.ts` — **fails deterministically, at default timeouts**:

```
docs/readme/img/page-turn.png was edited after it was recorded
(shots taken at a173150+dirty) — recapture with 'node shots-now/readme-shots.mjs'
: expected [ …(5) ] to deeply equal []
```

Five README screenshots are dirty in the working tree and no longer match their
recorded provenance.

The flake is the more serious half. A suite that reports a different failure set
on every run trains everyone to re-run until green, which is exactly how a real
regression ships. **No reviewer caught this** — all three reported green, which
means all three ran it once and believed the number.

### 2.3 Every rail panel pushes the right-hand page off the window

Measured by me at 1440×900, in the running app, on the Welcome book:

| state | `--nb-panel-push` | spread | right page | `.nb-page-curl` | clipped blocks |
|---|---|---|---|---|---|
| closed | `0px` | 137→1371 | 806→1319 | 1329→1369 | 0 |
| **any panel open** | **`340px`** | 477→**1711** | 1146→**1659** | **1675→1709** | **7** |

The window is 1440px. The right page ends **219px past it**; the page-curl
corner is **entirely off-screen**; seven content blocks are clipped with their
right edge at 1651.

Confirmed on all five panels I could open — Customize this book, Page style,
Catalogue, Table of contents, Take it out. It is not one panel, it is the
mechanism: `src/views/rail/panelPush.ts` publishes `--nb-panel-push` as the
sheet's full width with **no clamp against the viewport**, and
`src/styles/rail.css:166` / `shelf.css:32` apply it as a raw translate.

I looked at the capture. Every line of the right page is truncated mid-word:
"Write the way you would anywhere e|", "callouts, diagrams, equations, stic|",
"Bold, italic, code, struck out, hig|". This also makes the page-curl gesture —
which the tour spends a whole card teaching — unreachable while any panel is open.

**Disagreement to record:** reviewer 1 measured push = **106px** with the right
page ending at 1477. I measure **340px** and 1659. Both agree the page leaves
the window; the magnitude differs by 3×. Either the panel width changed between
their run and mine, or they measured a narrower panel. Whoever fixes this should
re-measure rather than trust either number.

### 2.4 The tour's primary button is invisible in the night interface — 1.05:1

`src/styles/tutorial.css:576-579`:

```css
.nbt-btn--primary { background: var(--wash-amber); color: var(--ink-sepia); }
```

`--wash-amber` is `#e8b64c` (`tokens.css:91`) and never changes with theme. But
`settings.css:177` rebinds `--ink-sepia` to `#f2e8d4` in night, and
`settings.css:268` rebinds it again per ink choice. I computed the ratios from
the token values rather than trusting the reviewer's table:

| night ink | colour | ratio on `#e8b64c` |
|---|---|---|
| sepia | `#f2e8d4` | 1.54 |
| graphite | `#ded6c8` | 1.30 |
| **ink-blue** | **`#9fbecd`** | **1.05** |

1.05:1 is not low contrast, it is *no* contrast. This is the primary advance
control on the first screen a new reader sees, and the taste questionnaire is
what selects night + ink-blue from ordinary answers.

Two supporting details: the `back` button beside it is legible, so the least
readable thing on the card is the one you are meant to press; and
`--ink-blue: #9fbecd` at `settings.css:181` is the **only** ink token in that
block carrying no checked-ratio comment — every sibling has one. The token that
was never checked is the one that fails.

*(Minor disagreement: reviewer 1 reported day/ink-blue as 3.89, I compute 4.23.
Both are below the 4.5 threshold, so the conclusion is unchanged.)*

### 2.5 The tour and the welcome book both describe behaviour the app no longer has

A click no longer opens a book — it brings it forward as a cover. Two places
still say otherwise:

- `src/features/tutorial/steps.ts:264` — *"Click a spine and the book tips out
  of the case and opens."*
- `src/data/seed.ts:283` — *"**Pull a book off the shelf** and it opens. `Esc`
  puts it back"* — this is inside the **Welcome book**, the first page every
  reader reads.

Reviewer 1 found only the first. The seed copy is the more damaging of the two.

Compounding it: **the pulled cover carries no visible affordance for opening.**
My capture of the held book shows exactly one control, "back to the shelf". The
keyboard path exists and works (§1), and the cover is clickable, but nothing on
screen says so, and the tour task ("Take the book off the shelf and open it")
will not go green for a reader who follows the card literally.

### 2.6 The effects sweep judges 5.5% of its rows and reports "nothing flagged"

`shots-now/effects-sweep.mjs` printed `findings: []`. From its own
`report.json`, which I parsed:

- **472 rows total. 208 have `paint: undefined`** — never measured at all.
- Per-axis, counting rows that survive both the unmeasured gap and the
  `layoutMoved` exemption:

| axis | rows | layoutMoved | unmeasured | **actually judged** |
|---|---|---|---|---|
| tape | 50 | 50 | 0 | **0** |
| washi | 50 | 49 | 0 | **1** |
| shadow | 50 | 50 | 12 | **0** |
| frame | 50 | 50 | 12 | **0** |
| paper | 50 | 50 | 12 | **0** |
| underline | 50 | 25 | 0 | **25** |
| font | 50 | 47 | 50 | **0** |
| ink | 50 | 0 | 50 | **0** |
| size | 12 | 6 | 12 | **0** |
| align | 10 | 2 | 10 | **0** |
| color | 50 | 0 | 50 | **0** |

**26 of 472 rows — 5.5% — are genuinely judged.** `font`, `ink` and `color` are
100% unmeasured. Three mechanisms, all confirmed in source:

1. `:472-477` sizes the viewport from the **plain** pass, then screenshots the
   **effect** pass `fullPage` at `:481`. Effects make the board taller. In
   `diffBoard`, `H = plain.height` (`:364`) and `:381` `if (x1 <= x0 || y1 <= y0)
   continue` — every tile below the plain height is silently skipped.
2. `:516` `if (layoutMoved) continue;` discards every metric except `paint`. The
   decoration axes the sweep exists to police are 49–50/50 `layoutMoved`, so
   they are exempt from it by construction.
3. `:393` the `grown` neighbour window is ±28px, so an effect escaping further
   is invisible to it.

Reviewer 3 reports the sweep is discarding confirmed true positives —
`underline=triple` records `neighbour: 0.855`, `overText: 0.817` and is
suppressed. I did not re-derive those two numbers, but the suppression mechanism
at `:516` is exactly as described.

### 2.7 Two seam probes are broken, and both sit under ticked TODO items

Both reproduced by me.

**`shots-now/own-binding.mjs` → `FAIL — the per-axis strips are not on screen;
the book studio never opened`.** Cause is probe rot from the focus-ladder
change: the shelf a11y button is now
`aria-label="Take <title> off the shelf, floor N"` calling `world?.pullOut(...)`
(`src/features/bookshelf/BookshelfWorld.tsx:890-893`), so the probe's
`getByRole('button', {name: /dress|studio|book/i})` matches **"Put the book back
on the shelf"** and shelves the book instead of opening it. `TODO.md:454` ticks
`ROLLABLE_SHAPES`/`MATERIALS`/`DECORATIONS` citing this probe as its evidence.

**`scripts/probe-curation.mjs` crashes at step 3.** My run:
`page.waitForSelector: Timeout 8000ms exceeded waiting for '.nb-cur-menu'` at
`probe-curation.mjs:195`. Reviewer 2 saw a click timeout at `:196`. The
difference confirms their note that the failure is non-deterministic.

Root cause: `src/views/rail/DesignStrip.tsx:394-399` registers
`window.addEventListener('scroll', onScroll, true)` and closes the menu on
**any** scroll. Playwright's automatic `scrollIntoViewIfNeeded` before a
right-click fires one. The probe's own helper already knows —
`probe-curation.mjs:94-95` scrolls first with the comment *"the menu closes on
scroll; scroll first"* — but steps 3 and 4 do not use that path.

This is also a **real UI fragility, not only a probe bug**: any reader whose
right-click lands while the strip is settling loses the menu instantly.

### 2.8 Gates that cannot fail, and skips that read as passes

Four separate instruments report success while checking little or nothing.

- **`probe-curation.mjs` declares `ALL CHECKS PASSED` over two skipped
  sections.** `:300` prints *"(the house build is not in the strip head;
  skipping this half)"*, `:374` prints *"(the book studio was not reachable in
  this run; skipped)"*, and the verdict at `:381` counts only `fails.length`. A
  skip is indistinguishable from a pass. `TODO.md:252` ticks "Delete, restore,
  favourite, and add-your-own, everywhere" on this probe.
- **`probe-studio-wiring.mjs` steps 4 and 5 assert nothing** (`:149-177`) — they
  `console.log` and move on. Step 4 prints its own contradiction, `studio: true`
  after Escape, because `RailPanel` keeps children mounted and hides via
  `visibility`; that check cannot distinguish open from closed. Step 5 prints
  `scrollWidth` and `clientWidth` and never compares them. Only an uncaught page
  error can fail this script.
- **`tests/styles.test.ts:29`** scans `src/styles/*.css` only.
  `src/features/tutorial/taste.css` is the one CSS file in the tree outside that
  directory and is therefore ungated. It is clean today — this is a hole, not a
  breach. Nothing gates canvas `shadowBlur`/`globalCompositeOperation` in
  `src/art/*.ts` at all.
- **`tests/plugged-in.test.ts`** — the standing alarm for unplugged code —
  watches two directories (`:88` `WATCHED = [src/art, src/editor/effects]`) and
  its flow half only considers exports matching `:624`
  `/^(open|show|launch|start|import|export)[A-Z]/`. `src/data`, `src/features/transfer`,
  `src/sound` and `src/views` have **no vocabulary coverage**. The test's own
  docblock at `:593` says so honestly; `TODO.md:303` ticks it as *"a gate that
  every exported vocabulary / pool / gate has a real consumer in `src/`"*, which
  is far broader than what exists. Note this gate could not have caught §2.1,
  even though `drawBlockEdge` lives in `src/art` — because it is a *function*,
  not a vocabulary array.

### 2.9 The taste questionnaire outlives its tour step and covers the tour

Mechanism confirmed. `src/features/tutorial/dismiss.ts:43-58` — `DISMISSIBLE`
holds exactly five surfaces: `rail-panel`, `trash`, `settings`,
`quick-switcher`, `context-menu`. The questionnaire's root is `.nbq-layer` with
a full-screen `.nbq-scrim` (`tasteQuestionnaire.tsx:682-683`) and is **not among
them**, so `dismissStale` cannot close it when the tour advances.

Reviewer 1 drove this and reports the tour card ends up ~90% hidden behind the
sheet with the scrim covering the control the new step asks for, escapable only
via "I'll pick later". I confirmed the mechanism in source but did not reproduce
the trapped state myself.

### 2.10 The tour promises four questions; there are five

- `src/features/tutorial/steps.ts:153` — `title: 'Four questions first'`
- `steps.ts:154` — *"Before the walk proper: four questions…"*
- `steps.ts:157` — *"Answer the four questions, then press…"*
- `src/features/tutorial/tasteProfile.ts:465-471` — `TASTE_QUESTIONS` = `[ROOM,
  PITCH, PALETTE, PAPER, SOUND]`, **five**
- `tasteQuestionnaire.tsx:2` — *"five questions, asked once"*, and `:801` renders
  `question {i+1} of {TASTE_QUESTIONS.length}`

Nothing pins the copy to the array.

### 2.11 The panel the tour tells you to open closes ~1.2s later

`CELEBRATE_MS = 1500` at `src/features/tutorial/TutorialOverlay.tsx:100` fires
the auto-advance the instant the fact is observed, and the fact is "the panel is
open". Reviewer 1 sampled at 100ms and measured the Catalogue panel visible at
488ms and closed by `dismissStale` at 1696ms — **1208ms of screen time** for a
card describing "seven shelves of things to add". Affects `shelf-studio`,
`page-style`, `catalogue`, `finding-in-book`. I confirmed the constant and the
mechanism; I did not re-run the 100ms sampling.

### 2.12 Documentation asserting things the code does not do

- **`CLAUDE.md:78`** lists `src-tauri/src/` as "`media.rs`, `backup.rs`,
  `tray.rs`, `export.rs`, `import.rs` (all registered in `lib.rs`)". It **omits
  `transfer.rs`**, which exists and is registered (`lib.rs:7`, `:127-129`).
- **`docs/ROADMAP-wave2.md:246`** claims "51 unit-test files". There are **71**
  (`find tests -name "*.test.ts"`). Its "15 e2e specs" at `:248` is correct — I
  counted 15 in `tests/e2e/`.
- **`src/art/spines.ts:238-241`** claims the edge specs are consumed by
  `covers.ts` via `edgeSpec` — they are not (§2.1).
- **`TODO.md` contradicts itself.** `:320` — *"One click brings it forward out of
  the shelf; a second opens it."* `:739` — *"**Drop the 'read it / put it back'
  card.** A book that comes off the shelf just opens…"* Both ticked. The second
  points the next reader at a `PulledBookOverlay.tsx` docblock that no longer
  describes the app.
- **`TODO.md:515`** ticks the dialog-exit fix citing `shots-now/dialog-exits.mjs`
  as covering CheatSheet. That probe's four dialogs are quick switcher,
  templates gallery, export PDF and insert script — **CheatSheet is not among
  them**. The fix is real (`CheatSheet.tsx:117` has `.nb-cheat-close`); the
  named verification does not cover it.
- **Stale specifics inside ticks:** `TODO.md:441` says the split gave
  `DEFAULT_SHELF_DESIGN` = scriptorium/guilloche; it is now
  `{build:'chapel', pattern:'quatrefoil'}`. Another says
  `DEFAULT_WALLPAPER_ID = 'pin-quiet'`; it is now `'fleur-royal'`.

### 2.13 Authored-but-unreachable exports

Confirmed by me, one occurrence each — definition only, no caller anywhere in
`src/`, `tests/`, `scripts/`, `shots-now/`:

| symbol | file | what the reader loses |
|---|---|---|
| `drawBlockEdge` | `src/art/spines.ts:2896` | the entire fore-edge vocabulary (§2.1) |
| `edgeSpec` | `src/art/spines.ts:1246` | its resolver |
| `reorderPages` | `src/data/pages.ts:139` | a complete SQL page-reorder; page reordering is offered nowhere |
| `previewRevert` | `src/features/transfer/library.ts:690` | the reader reverts a restore point with no dry-run preview |
| `describePlannedBook` | `src/features/transfer/library.ts:925` | import-preview formatting |
| `clearHistory` | `src/features/transfer/store.ts:209` | there is no "clear history" control |
| `renameUserSoundSet` | `src/sound/userSoundSetStore.ts:337` | a reader cannot rename their own sound set |
| `starredIds` | `src/data/shelfOfMine.ts` | curation store API with no reader |
| `getBuild` | `src/art/shelfDesign.ts:1410` | — |

**Corrections to reviewer 2's orphan table** — these are *not* orphans; each has
a same-module caller, and listing them as "no caller" overstates the problem:

- `insertPageLinkAt` — called at `src/editor/links/extension.ts:254`
- `drawPaperWall` — called at `src/views/rail/designOptions.ts:364`
- `commitHistory` — called 3× within `src/features/transfer/store.ts` (`:171`, `:184`, `:200`)

Their real defect is a different and much milder one: over-broad `export` on a
module-private helper. Reviewer 2's own prose drew this distinction ("532 have no
consumer outside their own module; 204 have no consumer anywhere") but their
table did not, and the table is what a reader acts on.

**Also corrected:** reviewer 2 wrote that *"CLAUDE.md and TODO both name
`getBuild` as a live consumer of `FALLBACK_SHELF_DESIGN`."* **`CLAUDE.md` does
not mention `getBuild` anywhere.** Only `TODO.md:442` does. The orphan is real;
the claim about CLAUDE.md is not.

### 2.14 Vocabularies where the names outrun the pictures

From reviewer 3's specimen boards in `shots-now/roster/`. I verified the edge
board myself (§2.1) and the source-level facts below; the pixel-distance figures
are theirs.

- **Spine tooling** — ~35 of 50 indistinguishable from a plain spine at 27px.
  `label-plate` measures d=0.00 against `plain` — it draws nothing. This is
  corroborated structurally: the presets `plain-cloth` and `lettered-cloth`
  differ *only* by that decoration and are reported byte-identical. Also
  identical: `library-buckram`/`plain-buckram`, `parchment-roll`/`scroll-case`,
  `plain-wrapper`/`offprint`.
- **`bee-diaper`**, the one decoration with an all-over repeat that would make a
  spine read rich, is the only one tiered `oddity` — so `presetForSeed` never
  rolls it.
- **Spine shapes** — the ten tiered `oddity` and excluded from `ROLLABLE_SHAPES`
  are the ten most legible silhouettes (Exposed Cords, Coptic Sewing, Scroll,
  Crenellated, Spiral Wire, Comb Bound, Ring Binder…). The 40 that *are* rolled
  are dominated by rectangles differing in the top ~8px of a 186px spine. The
  curation runs backwards: it withholds the distinctive and rolls the same.
- **`titleFont`** — 50 named "hands", ~5 actual faces. Names promise Spencerian,
  Copperplate, Stencil, Blackboard, Graffiti, Crayon, Biro, Fountain, Sharpie;
  the app bundles none of them and renders italic Kalam. This is precisely the
  failure `CLAUDE.md:24` names for the cloth palette — *a name that lies is worse
  than a name you do not have*.
- **Timber patterns** — 50 names, ~25 pictures, and the pattern only reaches the
  frieze band, post inner strip and plank lip. The board face — ~70% of visible
  timber — is a flat fill, so every fine pattern collapses to a hairline.
- **`roan`** renders as a plain fill, identical to `smooth-cloth`.
- **Cursors** — `paper` and `gilt` are identical on 13 of 16 states;
  `not-allowed` is one picture across five of six sets; 11 of 16 states differ
  only by accent tint. `src/art/cursors.ts:16-20` claims *"a set's character
  comes from its SHAPE … never from tinting the body"*, which is false for most
  of the set.

### 2.15 Smaller confirmed defects

- **`.nb-book-cover` is a dead first target** on step `open-a-book`
  (`steps.ts:280`). The class exists only under `.nb-book-view`
  (`rail.css:164`, `reader.css:58`), so it cannot match while the reader is on
  the shelf. Harmless — the list falls through to `.pulled-book` — but it is a
  selector that can never match at the moment it is consulted.
- **The `first-book` nudge is declared but reported not to fire.**
  `steps.ts:188-195` declares `when: 'shelf-moved'` with the text *"the shelf can
  wait — press 'write my first one'…"*. Reviewer 1 drove a shelf drag that
  satisfied `shelf-moved` elsewhere in the same run and read back `nudge: null`.
  I confirmed the declaration exists; I did not reproduce the failure to fire.
- **Skipped steps keep a dot.** `first-book` is `skipIfMissing` and is skipped on
  every normal fresh library, but its dot stays in the progress row — a task the
  reader can never tick.
- **`block-handled` goes green on the right-click alone.** The task says
  "Right-click a block, then drag it by the handle"; no block ever has to move.
- **The greeting asserts "step 1 of 21" and draws 21 dots** before the reader has
  chosen short or full; picking the short way re-renders as 11.
- **The tooltip covers the tour card on the step that asks you to hover**
  (`shelf-dock`). The step's own instruction hides the step's own explanation.

---

## 3. What is unfinished

Deliberate, with the reason, so nobody "fixes" an intentional decision.

- **The spine does not paint the text block.** Documented at
  `spines.ts:238-241`: the binding in `art/bookDesign.ts` owns the body. The
  *decision* is sound; what is broken is that nothing else picked the job up
  (§2.1). Do not fix this by making the spine draw edges — fix the wiring.
- **Charm kinds are deliberately reduced to one ribbon on the spine.**
  `spines.ts:4157-4165` states it plainly: six competing painted objects on one
  shelf is what the flat restyle exists to stop; the *kind* survives in params
  and the pull-out draws it in full, which it does. **Reviewer 3 filed this under
  "BROKEN — 6 kinds, 1 picture". That is wrong**: it is an intentional,
  documented reduction, and the cover does render six distinct charms. The real
  complaints are the quality of those six (all teal, floating unattached, a
  wax seal drawn as a teal heptagon) and that `BookStudio.tsx:1241-1255` offers
  the six kinds without telling the reader the choice is invisible at shelf scale.
- **Room colour and interface theme are separate axes.** Switching to `night`
  repaints the DOM chrome and leaves the Pixi world in daylight. Reviewer 1
  flagged it as looking unintended. It follows from the architecture; whether
  the two should be coupled is a product decision, not a bug.
- **Two dead barrel modules**, `src/diagrams/index.ts` and
  `src/features/packs/index.ts` — every consumer imports the concrete file.
  Harmless.
- **9 open items remain in `TODO.md`** against 218 ticked. Reviewer 2 checked and
  found no open item that is actually done; the reconciliation in `39db74a` is
  sound. The problem is in the other direction — ticks that are not true (§2.12).
- **`.nb-dev-switcher` sits on the page-curl corner** and swallows corner drags
  unless `?dev=0` is passed. Dev-only, not shipping.

---

## 4. What I cannot verify

Each with the specific thing that would settle it.

- **Sound.** Nothing in this pass listened. `scripts/gen-sounds.mjs` synthesizes
  every WAV, and the taste questionnaire's fifth axis picks a sound set. *Settled
  by:* the owner playing the app with the volume up, especially the page-turn
  and the "Reading Room" set.
- **PDF export, PNG export, and the clipboard.** These need Tauri commands
  (`media.rs`, `export.rs`) that do not exist in a browser. In-browser, "Copy
  this page as script" honestly reports `"could not reach the clipboard"`, but
  "This page as a picture" produces **no toast at all** — silence that may be
  correct once `media.rs` is present, or may be a swallowed error. *Settled by:*
  `npm run tauri dev` (or a packaged build) and pressing both buttons.
- **The packaged-build "two books" race.** Reviewer 1 could not reproduce it in a
  browser: `.shelf-firstrun` never flashed across 24 samples because
  `libraryIsEmpty()` requires floor 0 to have loaded, which is instant on a dev
  server. *Settled by:* a packaged build on a cold profile, watching the first
  paint.
- **Whether the test flake is environmental or real.** My two full runs differed;
  the isolated re-runs passed. It may be this machine's load, or it may be a
  genuine race in the SQLite stub's `beforeEach`. *Settled by:* running
  `npx vitest run` five times on an idle machine and recording whether the
  failure set is stable, then `--no-file-parallelism` to isolate.
- **The questionnaire-traps-the-reader state (§2.9)** and **the 1208ms panel
  (§2.11)** and **the nudge that does not fire (§2.15)**. I confirmed all three
  mechanisms in source but reproduced none of the three end-to-end. *Settled by:*
  a scripted fresh-library tour drive that samples tour state every 100ms.
- **Reviewer 3's pixel-distance figures** (d=0.00 pairs, "4 distinct of 50",
  "35 of 50 invisible"). I independently confirmed the edge board by looking at
  it and the edge mechanism from source, which makes the method credible, but I
  did not re-run their diff on every axis. *Settled by:* re-running
  `shots-now/roster-board.mjs` after fixing `effects-sweep.mjs`, since the same
  class of measurement bug (§2.6) may affect the roster boards too.
- **Every aesthetic verdict** — "cheap", "rich", "reads as a barcode", "reads as
  a peace sign". Reviewer 3's ranking table is a considered opinion from someone
  who looked at 61 boards, and my own captures corroborate the direction (the
  chapel arches read as a coarse blue ridge at the default 80% zoom; the cover's
  lower 40% is empty flat colour with a title-plate rule that looks like a
  placeholder underscore). *Settled by:* the owner's eye, which is the only
  authority here.
- **Rust.** I did not run `cargo check`. *Settled by:*
  `cargo check --manifest-path src-tauri/Cargo.toml`.

---

## 5. The recurring failure modes

The shapes this codebase keeps producing. Counts are instances I confirmed in
this pass, not historical totals.

### A. Authored, complete, and reachable from nobody — **9 confirmed instances**

The repo's stated history is eight; this pass adds a ninth and by far the worst.

`drawBlockEdge` + `edgeSpec` (§2.1) · `reorderPages` · `previewRevert` ·
`describePlannedBook` · `clearHistory` · `renameUserSoundSet` · `starredIds` ·
`getBuild` · two dead barrels.

The tell is always the same: **a rich, carefully-commented implementation with a
specimen board that proves it draws beautifully, and no line of `src/` that
calls it.** `drawBlockEdge` has 50 hand-written specs, a torus-aware silhouette
tracer, and a comment explaining why deckle bulges past the edge — and the app
paints a different, cruder function instead.

*What breaks the pattern:* `tests/plugged-in.test.ts` was built for exactly this
and would not have caught any of the nine, because it watches two directories and
only vocabulary-shaped arrays. Widen it to *functions*, and to `src/data`,
`src/features/transfer`, `src/sound`, `src/views`.

### B. A gate that cannot fail — **5 confirmed instances**

`probe-curation.mjs` declaring `ALL CHECKS PASSED` over two self-skipped
sections (§2.8) · `probe-studio-wiring.mjs` steps 4 and 5 asserting nothing ·
`effects-sweep.mjs` judging 5.5% of rows and printing `findings: []` (§2.6) ·
`styles.test.ts` scanning one directory · `plugged-in.test.ts` watching two.

The repo's history records this twice ("a curation gate with no caller"); it is
now at five. Two sub-shapes worth naming separately:

- **The silent skip.** `console.log('(…skipping this half)')` followed by a
  verdict computed from `fails.length`. A skip must be a failure, or at minimum
  must change the verdict string.
- **The check that cannot distinguish.** `studio: true` after Escape, because the
  panel stays mounted and hides via `visibility`. The assertion was written
  against an assumption about the DOM that was never true.

### C. Docs asserting properties the code lacks — **6 confirmed instances**

The repo's history records four; this pass finds six live.

`spines.ts:238-241` (specs consumed by covers.ts via `edgeSpec` — they are not) ·
`CLAUDE.md:78` (omits `transfer.rs`) · `ROADMAP:246` ("51 unit-test files"; 71) ·
`TODO.md:320` vs `:739` (flatly contradictory, both ticked) · `TODO.md:515`
(names a probe that does not cover the thing it verifies) · `cursors.ts:16-20`
("never from tinting the body"; 11 of 16 states are exactly that).

*The tell:* the doc describes the **intent at the time of writing**, and the
implementation moved. `TODO.md:441`'s stale `scriptorium/guilloche` default is
the same shape.

### D. A ticked item whose only evidence is a broken probe — **3 instances**

`ROLLABLE_SHAPES/MATERIALS/DECORATIONS` (`TODO.md:454` → `own-binding.mjs`,
fails) · "Delete, restore, favourite… everywhere" (`:252` →
`probe-curation.mjs`, crashes) · "a standing alarm for unplugged code" (`:303` →
a test far narrower than the tick claims).

**Nothing in CI runs these probes**, so they rotted silently across `4567633`.
That is the specific gap `CLAUDE.md`'s Seam QA section exists to close, and it is
open.

### E. Fifty names, five pictures — **7 axes**

fore-edges (50→1 on the spine, 50→4 on the cover) · spine tooling (~35 of 50
invisible) · `titleFont` (50 names, ~5 faces) · timber patterns (50→~25) ·
title plates (8 names → 1 picture) · block `shadow` (50→~8) · block `paper`
(50→~10) · cursors (6 sets → ~4 distinct).

`CLAUDE.md:24` already contains the rule this violates — the house cloth palette
went to fifty *precisely because* three names painting one terracotta was judged
worse than not having the names. The lesson was learned in one module and not
carried to the others.

### F. Believing a green number you ran once — **new this pass, 3 instances**

All three reviewers reported "tsc 0, vitest 71 files / 2351 green". The suite is
red and non-deterministic on this tree (§2.2), and the test count had already
moved to 2378. Reviewer 2 came closest — they re-ran and caught a red tree — but
then attributed it entirely to another agent's in-flight edits and did not
re-check after those landed.

*The tell:* a single run treated as a property of the code rather than a sample.
Where a suite has timing-sensitive hooks, one green run means very little.

### G. The over-broad claim built on a correct observation — **1 instance**

Reviewer 2's orphan sweep was methodologically strong and found real dead code,
then presented same-module-only helpers (`insertPageLinkAt`, `drawPaperWall`,
`commitHistory`) in a table headed "no consumer anywhere". Their prose drew the
distinction; their table erased it. I made the same class of error in this pass —
I concluded the pulled book had no accessible open control because I queried
`document.querySelectorAll('button')`, which does not match
`div[role="button"]`. **Reviewer 2 was right and I was wrong**, and I only caught
it by reading the source after the measurement disagreed with it.

*The lesson for the next session:* when a measurement contradicts a docblock,
suspect the measurement first. Both times in this pass, the code was right and
the instrument was wrong.
