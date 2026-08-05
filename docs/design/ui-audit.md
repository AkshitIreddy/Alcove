# UI/UX design audit — Notebook

A screenshot-driven review of every reachable surface, judged as a product
designer, colour grader and motion designer would. Every finding below was
seen in a rendered capture (1280×800 and 1920×1080, all four themes); every
contrast number is measured with the WCAG 2.1 relative-luminance formula
against the exact token pair the app actually paints.

Status key: **FIXED** — changed and re-verified in a fresh capture.
**WRITE-UP** — real, but outside this pass's ownership (another agent owns
the file); recorded here with the precise fix so the owner can land it.

Ownership boundary for this pass: `src/styles/**` (except `shelf.css` and
`rail.css`), `src/views/**` (except `views/rail/**`),
`src/features/settings/**`, `src/features/quickswitch/**`, `src/App.tsx`.

---

## P0 — correctness and accessibility

### 1. The quick switcher rendered with hard 90° corners (invalid CSS) — FIXED

**Surface** Ctrl+K command bar, every view.

**What was wrong** `search.css` declared

```css
border-radius: var(--radius-lg) var(--radius-hand) var(--radius-lg) var(--radius-hand);
```

`--radius-hand` is a *complete* `border-radius` shorthand — it carries its own
`/` separator (`255px 15px 225px 15px / 15px 225px 15px 255px`). Substituting
it into a four-value slot produces a syntactically invalid declaration, which
the browser drops entirely. The computed radius was **0 on all four corners**.

**Why it hurts** The command bar is the single most-used overlay in the app
and the one surface a user summons deliberately. A flat, sharp-cornered white
rectangle over a hand-drawn parchment world is the exact opposite of the
product promise — it looks like a browser dialog dropped into an illustration.

**Fix** Added safe per-corner wobble tokens to `tokens.css`
(`--radius-wobble-sm/md/lg`, each a complete 8-value shorthand) and switched
the bar to `--radius-wobble-lg`. Documented the footgun on `--radius-hand`
itself so the next author does not repeat it.

### 2. `--ink-sepia-soft` fails WCAG AA on every paper ground — FIXED

**Surface** Settings hints, slider readouts, cheat-sheet descriptions, quick
switcher snippets, footnotes, rail counts.

| pair | before | after |
| --- | --- | --- |
| `--ink-sepia-soft` on `--paper-aged` | **3.54:1** ✗ | 4.73:1 ✓ |
| `--ink-sepia-soft` on `--paper-cream` | **3.96:1** ✗ | 5.31:1 ✓ |

**Why it hurts** This token carries every piece of *secondary but readable*
copy in the product. AA for normal text is 4.5:1; 3.54:1 is roughly the
legibility of a light-grey watermark. It was compounded by the size problem
in finding 4.

**Fix** `--ink-sepia-soft: #8a7361 → #765f4d`, tuned against the darkest
ground it ever sits on. Still visibly a "soft" ink (the primary
`--ink-sepia` is 7.01:1), just readable.

### 3. `--ink-graphite-soft` fails AA on aged paper — FIXED

Unselected settings chips (13px), quick-switcher tabs (14px) and footer
legends, thumbnail numbers.

| pair | before | after |
| --- | --- | --- |
| on `--paper-aged` | **4.11:1** ✗ | 5.23:1 ✓ |
| on `--paper-cream` | 4.60:1 (marginal) | 5.86:1 ✓ |

**Fix** `#736c62 → #635c52`. `--ink-blue-soft` got the same treatment
(`#74879f → #5c7290`, 3.5:1 → 4.72:1) since `[data-ink='ink-blue']` remaps
`--ink-sepia-soft` onto it.

### 4. Active quick-switcher tab: 2.96:1, the worst contrast in the app — FIXED

**Surface** Ctrl+K, the lit "go to" / "search text" tab.

`--wash-amber-deep` (#a8802e) text on `--wash-amber-light` (#f7e7c2) measures
**2.96:1** — below even the 3:1 large-text floor, at 14px.

**Why it hurts** The *selected* tab was the least readable element on the
panel. Users reported mode by the border, not the word.

**Fix** Text switched to `--ink-sepia` on the same amber paper — **7.23:1** —
with the amber-deep rim promoted to a solid border plus 700 weight. The
selection signal got *stronger* while the label became readable. The wash
pigment itself is untouched (it is tuned for paint, not type).

### 5. Theme variants fail harder than the default — FIXED

Every non-default theme re-declares the soft inks, and each one drifted
further from AA.

| theme | token | before | after |
| --- | --- | --- | --- |
| pastel | `--ink-sepia-soft` | **2.89:1** ✗ | 4.78:1 ✓ |
| pastel | `--ink-graphite-soft` | **3.17:1** ✗ | 4.55:1 ✓ |
| botanical | `--ink-sepia-soft` | **3.14:1** ✗ | 4.60:1 ✓ |
| botanical | `--ink-graphite-soft` | **3.63:1** ✗ | 4.72:1 ✓ |
| night | `--ink-sepia-soft` | 4.96:1 (thin) | 6.31:1 ✓ |
| night | `--ink-graphite-soft` | **4.22:1** ✗ | 5.58:1 ✓ |

Pastel at 2.89:1 was the worst state in the product — choosing the prettiest
theme actively degraded readability, which is a trap, not a choice.

### 6. Readable copy set at 11px — FIXED

`--text-ui-xs: 11px` carried every settings hint, the quick-switcher footer
legends, and the insert-dialog parse warnings. 11px Nunito Sans at 3.5:1 is
not a design choice, it is an omission.

**Fix** Those three surfaces moved to `--text-ui` (12px), and `--text-ui-xs`
is now documented in `tokens.css` as *ornament only* — anything the user has
to read starts at 12px. Added `--text-chip: 13px` (the handwriting floor) so
chip/button/meta type stops being hardcoded in four separate files.

---

## P1 — hierarchy, craft and state

### 7. Unselected settings chips had no affordance; hover was inverted — FIXED

**Surface** Settings, every `Seg` group (theme, handwriting, ink, page style,
wood stain, wallpaper, wheel, sort, animation, soundscape, autosave, cursor).

**What was wrong** A resting chip was bare text — `border: 1.4px dashed
transparent`, no background — in the lowest-contrast ink in the palette. In
the "theme" row, only *parchment* looked like a control; *pastel*, *botanical*
and *night* read as a caption listing what parchment is not. Worse, hover
painted `--paper-deep`, a muddy brown **darker than the selected state**, so
the visual weight ran backwards: hovering an unselected chip made it look more
committed than the one actually chosen.

**Fix** Resting chips now carry a faint drawn paper edge and a 70% cream fill
so the whole group reads as one control. Hover *previews* the selected look
(amber-light + amber rim + a 1px lift). Selected wins on fill + solid rim +
700 weight + tilt + a drop shadow — four signals instead of one.

### 8. Slider rows were structurally broken — FIXED

**Surface** Settings: body size, zoom speed, and all five volume rows.

**What was wrong** Two compounding mistakes:

1. The numeric readout ("80%", "18px", "1.00×") was passed as the row's
   **hint**, so it rendered under the *label* — on the far left of a
   `justify-content: space-between` row.
2. The slider itself was a fixed `width: 170px` pinned to the far right.

The result was 120–180px of dead paper between a number and the control it
describes. `Slider` even accepted a `display` prop for exactly this purpose —
it was never passed at a single call site.

**Fix** The readout moved into the slider group as a tabular-figure chip
riding its right edge; the group now flexes (`min 150px / max 260px`) to fill
the row instead of hugging the margin. The `hint` slot was repurposed for
actual help text ("reading type on every page", "how fast the wheel travels").

### 9. Sliders had no value fill — FIXED

The track was a uniform 2px hairline on *both* sides of the thumb, so a
volume of 20% and 80% looked identical apart from pebble position. Reading a
level required locating a 16px thumb against a 5px tick comb.

**Fix** The track is now a two-stop gradient: full `--ink-sepia` up to the
thumb, `--ink-sepia-soft` hairline past it, driven by a `--nbs-fill` custom
property (0–100) computed in `SettingsPanel`'s `Slider` and inherited into
the `::-webkit-slider-runnable-track` pseudo-element. Firefox gets the same
result through `::-moz-range-progress`. Track height 2px → 3px so the fill
actually reads.

### 10. Disabled controls were illegible rather than inert — FIXED

`opacity: 0.4` on `.nbs-action-btn` (and `0.45` on `.nb-ins-button`) made
"choose…", "back up now" and the disabled "Insert" unreadable smudges.
Disabled should mean *plainly not available*, not *hidden*.

**Fix** Disabled controls keep full opacity and readable soft ink, and signal
inertness structurally instead: fill removed, border switched to dashed
`--paper-edge`, shadow dropped. The disabled toggle went 0.4 → 0.62.

### 11. Cheat-sheet columns were ragged — FIXED

**Surface** `?` overlay.

`.nb-cheat-keys` used `min-width: 92px` with `display: flex`, so short keys
(`F9`, `Esc`, `?`, `[ ]`) sat at 92px while `drag page edge` and
`click corner curl` pushed past it. The description column therefore started
at **three different x positions** inside each of the two columns — the eye
has nothing to track down.

**Fix** `.nb-cheat-row` is now `grid-template-columns: 118px minmax(0, 1fr)`.
One key column, one description edge, per column.

### 12. Cheat-sheet headings failed AA by a hair — FIXED

`--wash-terracotta-deep` as 17px type on cream measures **4.49:1** — under
the 4.5:1 bar, and 17px does not qualify for the large-text exemption
(18.66px / 14pt bold).

**Fix** Rather than shifting a *pigment* that the shelf art and ribbons also
use, added a sibling token for type: `--ink-accent: #8e4c2f` (**5.78:1** on
cream), themed per palette. The cheat-sheet headings and the error toast use
it; the wash family is untouched.

### 13. Cheat-sheet veil left the book competing with the card — FIXED

`rgba(59,44,29,0.34)` over a cream spread barely darkened it — the body text
underneath stayed fully legible and fought the card, and the card itself was
`--paper-cream` on scrimmed `--paper-cream`, so its edges dissolved.

**Fix** Veil deepened to 0.52 with a centred radial pool so warm light gathers
behind the paper; the card moved to `--paper-aged` with an inset cream hairline
so it separates from the page. Added a spring entrance (transform/opacity
only, `--motion-scale`-aware) so the card lands rather than appears.

### 14. Settings keybinding list was left-ragged — FIXED

`.nbs-keys-item` used `justify-content: space-between`, so a one-chip binding
(`escape`), a two-chip (`mod k`) and a three-chip (`mod shift e`) each began
at a different x. Six rows, six left edges.

**Fix** `display: grid; grid-template-columns: 1fr auto` with the combo cell
right-aligned — actions align left, bindings align right, one edge each. Key
caps moved 11px → 12px.

### 15. Settings header scrolled away — FIXED

The sheet holds **3261px** of content in an 800px window. The title and the
close cross scrolled off after the first section, so dismissing meant either
scrolling back to the top or knowing about Escape.

**Fix** `.nbs-header` is `position: sticky` with a paper-gradient backdrop
that fades out at its lower edge, so rows pass under it cleanly. Also gave the
sheet a self-styled 9px scrollbar — the 12px global bar read as browser chrome
against hand-drawn paper.

### 16. Settings vertical rhythm drifted — FIXED

`.nbs-section` had 12px above its dashed rule and 12px + an 8px title margin
below, so the rules crowded whatever row happened to end last and every
section opened tighter than the one before.

**Fix** 20px of air above each rule, 16px between title and first row. The
rules now read as evenly spaced staves.

### 17. The toast landed inside the book and errors looked like successes — FIXED

**Surface** Rail actions (export script, copy spec, bookmark, restore).

`bottom: var(--space-32)` puts the toast at y≈738 in an 800px window — inside
the book cover, overlapping the page curl. At 12px in `--paper-aged` on a
cream page it had almost no boundary. And "could not reach the clipboard"
was styled identically to "spec copied — paste it to your AI".

**Fix** Sized to `--text-sm` in the accent face, given a 4px inked left edge
and `--shadow-lg` so it reads as a torn note laid on top. Added an `is-error`
variant with a terracotta edge and `--ink-accent` text; `BookView`'s `notify`
now takes a tone and the two failure paths pass `'error'`. Toast markup gained
`role="status"` / `aria-live="polite"`.

*Corrected during verification:* the first attempt moved the toast to
**top-centre**, where the re-capture showed it landing squarely on the book's
Caveat title plate. Final placement is **top-right** — the only region free of
fixed furniture in both views (title plate and back arrow take top-centre and
top-left, the rail owns the left edge, the zoom pill and dev corner own the
bottom). Locked by an e2e assertion that the toast rect intersects neither the
title plate, the cover, nor the back button.

### 18. Focus mode did not actually clear the chrome — FIXED

F9 fades the rail, the back arrow and the title plate — but the settings gear
and the dev switcher are rendered by `App.tsx` as *siblings* of `BookView`, so
`.nb-book-view.is-focus-mode`'s descendant rules never reached them. In the
capture they sit at full strength over a deliberately dimmed desk.

**Fix** `body:has(.nb-book-view.is-focus-mode)` fades both to 0.1 with the
token motion curve; hover and `:focus-visible` bring them straight back, so
nothing becomes unreachable.

*Corrected during verification:* the first attempt left the dev pill at 0.45
in focus mode. Its opacity was set through an inline `style` object in
`App.tsx`, and inline styles outrank stylesheet rules — the fade could never
win. Moved the pill's whole presentation to a `.nb-dev-switcher` class in
`settings.css`; measured 0.1 in the re-capture.

### 19. Dev chrome shipped as production furniture — FIXED

A raw `shelf | book` pill was pinned bottom-right in every build, overlapping
the book cover's corner in literally every book-view capture.

**Fix** Gated behind `import.meta.env.DEV`, `?dev=1`, or a `nb-dev`
localStorage flag, so QA and the e2e suite keep it and users never see it.
When shown it now rests at 0.45 opacity in the corner and lifts to 1 on
hover, reading as a margin note rather than a toolbar.

### 20. Quick switcher showed its own mode twice — FIXED

Typing `>` switches to full-text mode *and* leaves a literal `>` in the field
while the "search text" tab lights up — two representations of one state, and
a character the user has to delete to get back.

**Fix** The prefix is now a typing shortcut only: `shown()` strips it from the
field, input re-applies it, and Backspace on an empty content query drops the
mode instead of dead-ending (the browser fires no `input` event there, so it
needed an explicit key handler).

### 21. Quick switcher row meta drifted with the title — FIXED

`book` / `p. 3` sat inline immediately after the title with an 8px gap, so it
read as part of the title and moved horizontally with every result.

**Fix** `margin-left: auto` pins meta to the row's right edge — a stable
column the eye can scan.

---

## WRITE-UPS — real findings outside this pass's ownership

### W1. `rail.css:110` has the same invalid `--radius-hand` substitution

```css
/* src/styles/rail.css:110 */
border-radius: var(--radius-lg) var(--radius-hand) var(--radius-lg) var(--radius-hand);
```

Identical footgun to finding 1: the declaration is invalid and dropped, so the
rail panel renders with square corners. **Fix:** `border-radius:
var(--radius-wobble-lg);` — the token now exists in `tokens.css`.

*Owner: rail agent (`src/styles/rail.css`).*

### W2. Rail word counts render at 10px, below the project's own floor

Measured live: `.nb-rail-counts-page` and `.nb-rail-counts-book` compute to
**`font-size: 10px`**, Nunito Sans, in `--ink-sepia-soft` on `--paper-aged`.
CLAUDE.md sets a 13px floor for handwriting and 12px is the smallest UI size
elsewhere; 10px at (previously) 3.54:1 was the least legible text in the
product. The token change lifts the contrast to 4.73:1 but the size is still
below the floor.

**Fix:** raise both to `var(--text-ui)` (12px) in `rail.css`, or drop the "w"
suffix and stack them so the extra width pays for the size.

*Owner: rail agent (`src/styles/rail.css`).*

### W3. The shelf world does not follow the theme

Two observations, an hour apart, while the bookshelf agent was working
concurrently:

- **First capture** (`before/21-theme-night.png`): switching to **night**
  while on the shelf left the entire left two-thirds of the window a flat,
  featureless dark-brown void — no case, no wall, no floors, no plates.
- **Re-capture after concurrent shelf work** (`after/21-theme-night.png`,
  `after/21-theme-pastel.png`): the void is gone, but the shelf now renders
  *identically* in all four themes — the same walnut case and warm damask
  wall sit behind a night-black settings sheet and behind a pink pastel
  sheet. The panel changes; the world does not.

So the crash is fixed and the remaining gap is that the Pixi world never
re-bakes against the new token values on a live theme switch. Picking "night"
currently produces a dark UI panel floating over a daylit library.

**Fix:** invalidate and re-bake the shelf/wall/case textures when
`settings.theme` changes (or key the world on the theme so it remounts).

*Owner: bookshelf agent (`src/features/bookshelf/**`, `src/art/**`).*

### W4. Shelf zoom pill collides with floor content

At 1920×1080 (`50-shelf-wide.png`) the bottom-centre zoom pill
(`− 80% + | fit`) sits directly on top of the "~ empty shelf ~" floor label,
and at 1280×800 it overlaps a floating pencil doodle. Both are centred at the
bottom of the viewport with no reserved gutter between them.

**Fix:** offset the pill horizontally (bottom-right, beside the dev corner) or
reserve a bottom band the floor decorations avoid.

*Owner: bookshelf agent (`src/styles/shelf.css`).*

### W5. Rail icons are optically faint

The rail glyphs are `--ink-sepia` (7:1, fine on paper) but drawn at 1.7–1.8px
stroke on a 24px box, which at 100% zoom reads as a very light pencil ghost —
the column of twelve tools is easy to miss entirely on first open. Contrast is
not the problem; *weight* is.

**Fix:** raise the icon stroke to ~2.2px, or give the resting button a faint
paper chip so the rail reads as a strip of tools.

*Owner: rail agent (`src/styles/rail.css`, `src/views/rail/icons.tsx`).*

---

## Deliberately NOT changed

- **Insert dialog "asymmetric padding" and misaligned footer buttons.** Both
  appeared in the first capture (16px vs 28px pane insets; the "Copy spec"
  button ~5px below Cancel/Insert). They are artifacts of the card's
  `transform: rotate(-0.35deg)` — a 0.35° tilt across ~800px of card width
  produces exactly ~4.9px of vertical drift. The padding and the flex
  `align-items: center` are correct. Recorded so nobody "fixes" it later.
- **Black rectangles in the bottom corners of the 1920×1080 book capture.**
  `elementsFromPoint` finds no element there, and the same regions render
  correctly on the shelf. It is a SwiftShader readback artifact of the
  headless GL path, not a product bug.
- **Wash pigments** (`--wash-*-deep`). They are tuned as paint for the shelf,
  covers, ribbons and swatches. Where one was failing *as type*, the fix was a
  new `--ink-accent` type token, not a shift to the pigment.

---

## Regression cover

`tests/e2e/visual-audit.spec.ts` (13 specs, all green) locks these in by
*measurement* — computed contrast ratios, computed radii, laid-out geometry —
rather than pixel snapshots, so they survive art changes and SwiftShader's
throttled rAF:

| spec | guards |
| --- | --- |
| secondary ink clears AA on every theme | findings 2, 3, 5 |
| the lit quick-switcher tab is readable | finding 4 |
| the bar keeps its hand-drawn corners | finding 1 |
| slider readouts sit on their control, track fills | findings 8, 9 |
| unselected chips are visibly pressable | finding 7 |
| keybinding rows share one right edge | finding 14 |
| no readable settings copy below 12px | finding 6 |
| disabled controls stay readable | finding 10 |
| cheat-sheet descriptions align per column | finding 11 |
| the toast clears the book and the title plate | finding 17 |
| focus mode fades the app-level chrome | finding 18 |
| the `>` prefix never shows in the field | finding 20 |
| result meta pins to the row edge | finding 21 |

Two geometry specs measure `offsetLeft` rather than `getBoundingClientRect`:
the cheat-sheet card and the insert dialog carry deliberate sub-degree
rotations that skew client rects by 2–5px even when layout edges are
pixel-identical (see "Deliberately NOT changed").

One pre-existing assertion changed: `search.spec.ts` expected the quick
switcher's field to read `>welcome` after a mode switch. That encoded the
defect in finding 20; it now asserts `welcome` with the reasoning inline.
