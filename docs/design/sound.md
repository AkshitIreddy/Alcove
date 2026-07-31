# Design: sound

## Recommendation

Every cue in `public/sounds/` is a **real recording** under a public-domain
dedication or CC0, curated from four libraries, sliced to a single event and
conditioned by `scripts/gen-sounds.mjs`. Nothing in the shipped set is
synthesized. One source (the rain bed) is CC BY 4.0 and its attribution is
carried in `public/sounds/CREDITS.json` — that credit must ship with the app.

## Why not synthesis

`scripts/gen-sounds.mjs` used to render all 56 cues from scratch: layered
noise, struck resonators, an 8-line Hadamard FDN room, raised-cosine
envelopes throughout. It was tuned twice against review feedback — first
"very rough, low quality", then "very bad… we are in need of serious
professional sound redesign".

The second pass is the informative one. It set out to fix harshness and it
succeeded on its own terms: the set measured a **779 Hz mean spectral
centroid with essentially nothing above 4 kHz**, and it was still rejected.
A theory that has comprehensively won its own argument and lost the review is
falsified, not under-tuned. What synthesis was missing was never a filter
setting — it was the irregularity of a real object being handled. No two page
turns share an envelope. A book shutting has a body resonance nobody thought
to model. A pencil stroke wanders. Those are the properties that make a sound
read as recorded, they are exactly what a parametric model smooths away, and
no third pass was going to add them.

So the tuning knobs were thrown away and the problem became a **sourcing**
problem instead.

## Licence policy (the constraint that drove sourcing)

A sound we may not ship is worth less than a mediocre one we may. Two rules
were applied, and both rejected otherwise-excellent candidates:

1. **The licence must be asserted by someone able to grant it.** Uploader-set
   licence tags are not evidence of ownership.
2. **The site must permit automated access.** Where a `robots.txt` closes the
   door, the door is closed.

### Sources rejected

| Source | Why not |
| --- | --- |
| **freesound.org** | The best CC0 catalogue for this brief by a wide margin. Its `robots.txt` disallows `ClaudeBot` site-wide and `/search/` for every agent. Not used. |
| **archive.org** | Carries commercial SFX libraries (Red Library, SSE, GOLD TAPE, Valentino, Designer's Choice) and outright console-game rips re-uploaded with CC0/PD-Mark tags by people who plainly do not own them. A CC0 tag on a Nintendo sound rip is proof the tags are not trustworthy, so none of the collection was used — including the items that may well be legitimate. |
| **pixabay.com** | Behind a Cloudflare bot challenge. Not bypassed. |
| **zapsplat** | Requires an account to download. |
| **Sonniss GDC bundles** | Royalty-free and legitimate, but distributed as multi-gigabyte archives — disproportionate for 56 short cues. |

### Sources used

All verified by reading each submission's own licence field (not badge
images, which also appear in OpenGameArt sidebars for unrelated work — that
distinction caught the rain bed, filtered as CC0 but actually CC BY 4.0).

| Source | Author | Licence | Page |
| --- | --- | --- | --- |
| Old book (leafing, flicking, shutting) | cori | Public domain (`PD-author`, via pdsounds.org) | [Commons](https://commons.wikimedia.org/wiki/File:Old_book.ogg) |
| Book, Paper, Pages, assorted | stephan | Public domain (`PD-author`, via pdsounds.org) | [Commons](https://commons.wikimedia.org/wiki/File:Book_paper_pages_assorted.ogg) |
| Pencil Scratchings | gypsygirl | Public domain (`PD-author`, via pdsounds.org) | [Commons](https://commons.wikimedia.org/wiki/File:Pencil_scratchings.ogg) |
| 10 Book Page Flips | StarNinjas | CC0 1.0 | [OpenGameArt](https://opengameart.org/content/10-book-page-flips) |
| Interface Sounds (1.0) | Kenney | CC0 1.0 | [OpenGameArt](https://opengameart.org/content/interface-sounds) |
| Bell dings/chimes | PWL | CC0 1.0 | [OpenGameArt](https://opengameart.org/content/bell-dingschimes) |
| Fireplace Sound loop | PagDev | CC0 1.0 | [OpenGameArt](https://opengameart.org/content/fireplace-sound-loop) |
| Crickets Ambient Noise | Wolfgang_ (Ted Kerr) | CC0 1.0 | [OpenGameArt](https://opengameart.org/content/crickets-ambient-noise-loopable) |
| 30 CC0 SFX loops | rubberduck | CC0 1.0 | [OpenGameArt](https://opengameart.org/content/30-cc0-sfx-loops) |
| Rain on Window Loop | alxl | **CC BY 4.0 — attribution required** | [OpenGameArt](https://opengameart.org/content/rain-on-window-loop) |

The four Commons files carry `{{PD-pdsounds.org}}` **and** `{{PD-author|…}}`:
originally from pdsounds.org, dedicated to the public domain by their
recordist, then reviewed by Commons. That is a complete provenance chain.

The rain submission is the one ambiguity in the set: its structured licence
field says CC BY 4.0 while its free-text note says "available under CC0". We
honour **the stricter of the two** and ship the credit, which satisfies either
reading.

### Attribution we must ship

> Rain on Window Loop by alxl (OpenGameArt) — CC BY 4.0

`CREDITS.json` lists this under `attributionsRequired`, so a UI credits panel
can read it rather than hard-coding a string. Kenney, StarNinjas, PagDev and
Wolfgang_ ask for credit but do not require it; crediting them anyway is
cheap and decent.

## Which recording became which cue

One recorded world, the way the art is one drawn world — the interface is
made of paper, graphite, books and a small brass bell, not of synthesised
blips.

| Family | Comes from |
| --- | --- |
| `page-flip` ×6 | Old book, Book/Paper/Pages, and StarNinjas' flips — three different books so the rotation has real variety |
| `book-pull` ×4 | pages riffling past each other |
| `book-return` ×4 | the same, ending on the book meeting the shelf |
| `shelf-whoosh` ×3 | a long riffle, warmed hard and kept 11 dB under everything else |
| `pop-soft` ×5 | Kenney interface cues |
| `tick-hover` ×5 | graphite ticking on paper — the quietest thing in the app |
| `check-done` ×4 | a small bell allowed to ring out |
| `crumple-delete` ×4 | paper actually being crushed |
| `drop-thump` ×4 | a book shutting / meeting a surface |
| `confetti` ×3 | one bell strike sounded three or four times — a shimmer, not a jingle |
| `pencil-scratch` | a 210 ms seamless loop of the pencil recording |
| `typing-tick` ×6 | six different moments of the same pencil |
| `chime-hour` ×3 | three or four real strikes in sequence, because an hour bell *is* a sequence |
| `ambient-*` | rubberduck's room tone, alxl's rain, PagDev's fire, Wolfgang_'s crickets |

## Processing: warm only as much as is needed

A close-miked page turn measures a 5–7 kHz spectral centroid. That is too
bright and too present for an app you sit inside all day. But a *fixed* warm-up
EQ is precisely how the synthesized set became a pillow: applied uniformly it
takes the same octave off a bright riffle and an already-dark book thump.

So `condition()` **solves** for the mildest treatment each cue needs:

- `fitWarmth()` bisects a high-shelf gain until the cue is under its own
  centroid ceiling, and stops there. Already-warm material is left alone.
- `fitVoicing()` walks a lowpass lid down from 9 kHz and stops at the **first**
  lid where the cue is clean. Two things go wrong when you keep a recording's
  top end and both are measurable: energy above 4 kHz reads as hiss, and the
  largest adjacent-sample jump — proportional to frequency, since a sinusoid
  slews at 2πfA/SR — reads as a click. Both fall as the lid comes down.
- `centroidMin` guards the other direction. A page turn under ~900 Hz has
  stopped sounding like paper, and the build *warns* rather than silently
  shipping it. That warning is what caught two page-flip sources whose
  transients were so sharp they could only be de-clicked by crushing them; both
  were replaced with different takes rather than accepted dull.

Filtering is zero-phase (forward + reverse), so a page turn's attack stays
exactly where the microphone found it — a one-way filter smears transients
forward, which on short percussive cues reads as softness.

Levelling happens **last**, so the loudness hierarchy is exact regardless of
what the source was recorded at: a hover tick sits 17 dB under a book pull,
and the ambience bed 12 dB under a page turn.

## Rebuilding

```
node scripts/gen-sounds.mjs
```

Needs `ffmpeg` on `PATH` (decoding only) and, on a cold cache, network access.
Sources are cached in `os.tmpdir()/notebook-sound-sources`, deliberately
**outside** the repo: the ~20 MB of raw material is not vendored, only the
6.6 MB of conditioned cues under `public/sounds/`. Every run rewrites
`CREDITS.json` and `report.txt` from the same tables that drive the audio, so
provenance cannot drift from what actually shipped.

## Contract with `src/sound/engine.ts`

Unchanged, and deliberately so — this work replaced the audio, not the API.
56 files named exactly as `SoundName` enumerates them, 44.1 kHz / 16-bit /
mono, served from `/sounds/<name>.wav`. The `plain` / `full` split in
`VARIANT_WEIGHTS` still means "shorter take" / "longer take", so within each
family the `full` entries are cut longer; `tests/sound.test.ts` measures the
actual files to keep the two in step.

## Acceptance

`tests/sound.test.ts` (238 assertions) is the gate and all of it passes on the
recorded set: format and duration bounds, warmth ceilings, the click metrics
(max adjacent-sample step ≤ 25% of peak, first 0.5 ms ≤ 4% of peak, edges at
zero), the loudness hierarchy, per-family variety, and loop seam continuity.

Two findings worth keeping:

- **Centroid and high-frequency share are weighted differently** — centroid by
  amplitude, high share by energy. A recording can carry plenty of audible air
  while almost none of its *energy* sits up there. That is why real paper fits
  under a 3% high-share ceiling far more easily than the raw centroid numbers
  suggest, and it is why the recorded set passes gates written for the
  synthesized one.
- **Loop edge fades cannot be arbitrarily short.** At 1.5 ms the steady library
  room tone was still at 14% of peak half a millisecond in, which reads as a
  soft thud on every loop restart. 5 ms puts it at ~2% and costs 10 ms of duck
  per 8 s cycle, which is inaudible in a background texture.
