# Design: sound

## Recommendation

Every cue in `public/sounds/` is a **real recording** under a public-domain
dedication or CC0, sliced to a single event and conditioned by
`scripts/gen-sounds.mjs`. Nothing in the shipped set is synthesized.

One source (the rain bed) is CC BY 4.0. **The obligation is discharged in the
UI, not by dropping the source**: Settings → Sound → *sound credits* opens a
panel that fetches `public/sounds/CREDITS.json` at runtime and renders every
recording, author and licence, with the required attributions in a filled
block at the top. Nothing about that panel is hard-coded — the manifest is
rewritten from the same table that drives the audio on every build, so a
credit cannot drift from what actually shipped. Replacing the rain with a CC0
substitute was the alternative and was rejected: review named that bed as one
of the good ones, and a credits view is the general answer for every source
added after this one.

## The soundscapes

Ten beds, up from four, each a single continuous field recording (`night` is
two, layered). The bed that was called **`library` is gone** — it was the only
one built from a synthesized loop rather than a recording, and the review word
for it was *creepy*. Stored settings still naming it fall through to `rain`.

| Bed | What it is |
| --- | --- |
| `rain` | rain on the window |
| `storm` | light rain, thunder a long way off |
| `fireplace` | a fire in the grate |
| `crickets` | a field full of crickets |
| `night` | crickets, with wind in the far trees |
| `wind` | wind around the building |
| `stream` | water over stones |
| `forest` | woodland, midday, nobody about |
| `shore` | small waves on a pebble beach |
| `cafe` | the far end of a busy room |

Loop windows are **chosen by measurement, not by ear-guessing**. Every
candidate window in a recording is scored on the spread of its 250 ms RMS (a
bed has to be steady or the loop point announces itself) and on its head/tail
level ratio (a crossfade hides a small mismatch, not a big one). The winners
run 5–17% coefficient of variation. Two findings worth keeping:

- **`shore` is the exception at ~39%, and gets 12 seconds instead of 8.** Waves
  *are* the variation; squeeze them into eight seconds and the swell becomes a
  pulse you can set a metronome to. `night` is 12 s for the same reason —
  two layers repeat more audibly than one.
- **The steadiest window is not always the right one.** `wind`'s was at 34 s
  and held a 921 Hz resonance 17 dB above its neighbours — a building
  whistling. A whistle that survives an 8 s loop is a kettle. So every window
  was also scored on its strongest *narrow* peak; the winner at 104 s puts its
  peak at 5.4 kHz instead, where the 950 Hz centroid fit buries it.

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
| Rain on Window Loop | alxl | **CC BY 4.0 — attribution required** | [OpenGameArt](https://opengameart.org/content/rain-on-window-loop) |
| Howling wind | Tvabutzku1234 | CC0 1.0 | [Commons](https://commons.wikimedia.org/wiki/File:Howling_wind.ogg) |
| Light Rain Distant Thunder July 5th 2016 | kvgarlic | CC0 1.0 | [Commons](https://commons.wikimedia.org/wiki/File:Light_Rain_Distant_Thunder_July_5th_2016.wav) |
| Stream / river water up close | jackthemurray | CC0 1.0 | [Commons](https://commons.wikimedia.org/wiki/File:433589_jackthemurray_stream-river-water-up-close.wav) |
| Grunewald (woodland ambience) | dbspin | CC0 1.0 | [Commons](https://commons.wikimedia.org/wiki/File:245286_dbspin_grunewald.wav) |
| Restaurant ambience | stephan | Public domain (`PD-author`, via pdsounds.org) | [Commons](https://commons.wikimedia.org/wiki/File:Restaurant_ambience.ogg) |
| On a pebble beach | earthcalling | Public domain (`PD-author`, via pdsounds.org) | [Commons](https://commons.wikimedia.org/wiki/File:On_a_pebble_beach.ogg) |

The pdsounds files on Commons carry `{{PD-pdsounds.org}}` **and**
`{{PD-author|…}}`: originally from pdsounds.org, dedicated to the public domain
by their recordist, then reviewed by Commons. That is a complete provenance
chain.

Three of the new beds (`storm`, `stream`, `forest`) are freesound uploads
mirrored to Commons. That is deliberate and is *not* a way around the
robots.txt above: the file is fetched from `upload.wikimedia.org`, freesound
itself is never touched, and Commons carries its own reviewed CC0 template on
top of the CC0 the recordist chose. Commons asks automated clients to identify
themselves — the build sends a descriptive User-Agent, sleeps 1.2 s between
files and backs off on a 429, because a browser-shaped UA gets rate-limited off
the CDN by the third file.

### Sources dropped

| Source | Why |
| --- | --- |
| **30 CC0 SFX loops** (rubberduck) | Its `ambient_01` loop was the `library` bed. It is a synthesized texture, not a recording, and review called the result creepy. Nothing else in the set used this source, so it left with the bed. |

The rain submission is the one ambiguity in the set: its structured licence
field says CC BY 4.0 while its free-text note says "available under CC0". We
honour **the stricter of the two** and ship the credit, which satisfies either
reading.

### Attribution we must ship, and where it ships

> Rain on Window Loop by alxl (OpenGameArt) — CC BY 4.0

`CREDITS.json` lists this under `attributionsRequired`, and
`src/sound/SoundCredits.tsx` renders that array in a filled block at the top of
the credits panel, above the full per-recording list. Kenney, StarNinjas,
PagDev, Wolfgang_ and every recordist behind the new beds ask for credit but do
not require it; the panel credits them anyway, which is cheap and decent.

The manifest's `sounds` map is **an array per cue**, because a layered bed is
built from more than one recording — `ambient-night` credits both the crickets
and the wind. `src/sound/credits.ts` regroups it the other way for display (one
entry per recording, with the cues it became) and is unit-tested against the
real file: `tests/sound.test.ts` asserts every shipped cue has provenance, that
`attributionsRequired` matches what the per-cue flags say, and that anything
whose licence string contains "CC BY" is flagged. A rebuild that quietly lost
the credit fails there rather than in a licence complaint.

## Which recording became which cue

One recorded world, the way the art is one drawn world — the interface is
made of paper, graphite, books and a small brass bell, not of synthesised
blips.

| Family | Comes from |
| --- | --- |
| `page-flip` ×6 | StarNinjas' flips ×4 and Book/Paper/Pages ×2 — separate physical takes, so the rotation has real variety |
| `click-soft` ×4 | real taps off the Old-book recording: what every button in the app now says |
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
| `ambient-*` ×10 | one field recording each — see *The soundscapes* above |

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
and the ambience bed 8–11 dB under a page turn.

Sources are decoded to **32-bit float**, not to the 16 bits the cues ship at.
The field recordings behind the new beds are quiet — the stream measures
−59 dBFS RMS, the woodland −47 — and quantizing those before conditioning
leaves five or six usable bits, which the 25 dB of make-up gain `normalizeTo`
then applies would bring up as hiss along with the water. Float costs disk in a
cache that gets thrown away and nothing else.

### Peak is the wrong dial to judge a short cue by

Review reported the typing ticks as inaudible while they were peak-levelled
only 7 dB under `pop-soft`. Measured differently they were 9 dB under it, and
the engine's velocity scaling put the soft end of the range another 7 dB down
from there: a 140 ms tick simply carries far less perceived loudness than its
peak suggests. The fix was two changes worth ~3.9 dB together — the file peak
from −21 to −18, and the keystroke velocity floor from 0.45 to 0.6 — which
lands a tick just under a page turn instead of under the room. The same
arithmetic set `click-soft` at −19: 5 dB beneath `pop-soft`, so pressing a
button stays smaller than opening a panel.

## Rebuilding

```
node scripts/gen-sounds.mjs
```

Needs `ffmpeg` on `PATH` (decoding only) and, on a cold cache, network access.
Sources are cached in `os.tmpdir()/notebook-sound-sources`, deliberately
**outside** the repo: the ~130 MB of raw material is not vendored, only the
12 MB of conditioned cues under `public/sounds/`. Every run rewrites
`CREDITS.json` and `report.txt` from the same tables that drive the audio, so
provenance cannot drift from what actually shipped.

## Contract with `src/sound/engine.ts`

66 files named exactly as `SoundName` enumerates them, 44.1 kHz / 16-bit /
mono, served from `/sounds/<name>.wav`. The `plain` / `full` split in
`VARIANT_WEIGHTS` still means "shorter take" / "longer take", so within each
family the `full` entries are cut longer; `tests/sound.test.ts` measures the
actual files to keep the two in step.

`SOUNDSCAPE_LOOPS` is the single source of truth for the bed list: the settings
chips, the `Settings['soundscape']` validator, `ALL_SOUND_NAMES` and the test
suite all derive from it, so adding a bed to `gen-sounds.mjs` and to that map
is the whole change.

### Buttons: one delegated listener, not fifty call sites

`src/sound/uiClicks.ts` installs a single `click` listener on `document` and
lets the DOM say what a button is (`button`, `[role=button|switch|tab|
menuitem|option]`, minus anything `disabled`, `aria-disabled` or marked
`data-nb-silent`). Two rules make that safe:

- **`click`, not `pointerdown`.** Press-time feels better by 60–100 ms, but a
  delegated handler cannot know in advance which controls already voice
  themselves. By the bubble phase the element's own handler has run, so
  `msSinceVoicedPlay()` answers "did this control just make a sound?" and the
  click steps aside for the 180 ms that follow one. Verified in the running
  app: pressing the rail's *studio* button fetches `pop-soft` and no click;
  pressing the gear, which was silent, fetches `click-soft`.
- **`click` covers keyboard activation for free** — Enter and Space on a
  `<button>` both fire it.

## Acceptance

`tests/sound.test.ts` (286 assertions) is the gate and all of it passes on the
recorded set: format and duration bounds, warmth ceilings, the click metrics
(max adjacent-sample step ≤ 25% of peak, first 0.5 ms ≤ 4% of peak, edges at
zero), the loudness hierarchy, per-family variety, loop seam continuity, the
button-click delegation rules, and the licence manifest itself.

Two findings worth keeping:

- **Centroid and high-frequency share are weighted differently** — centroid by
  amplitude, high share by energy. A recording can carry plenty of audible air
  while almost none of its *energy* sits up there. That is why real paper fits
  under a 3% high-share ceiling far more easily than the raw centroid numbers
  suggest, and it is why the recorded set passes gates written for the
  synthesized one.
- **Loop edge fades cannot be arbitrarily short.** At 1.5 ms a steady bed was
  still at 14% of peak half a millisecond in, which reads as a soft thud on
  every loop restart. 5 ms puts it at ~2% and costs 10 ms of duck per 8 s
  cycle, which is inaudible in a background texture.
- **The ambient centroid ceiling had to come up, from 1400 Hz to 1650.** It was
  calibrated on four beds; running water and woodland carry genuine air, and
  pulling a stream under 1400 Hz stops it being water and makes it a hum. The
  gate that actually catches hiss is the 3% high-share ceiling, which every bed
  clears by an order of magnitude (0.16–0.57%); the per-bed `centroidMax` in
  `gen-sounds.mjs` remains the tight, individual limit.
