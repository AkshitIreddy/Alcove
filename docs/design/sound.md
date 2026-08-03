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

## Sets: the two levers that were written off

`TODO.md` carried one line about the sound sets for a long time:

> No "add your own set" for sound, and no runtime filtering in a set's levers
> (Howler exposes rate and volume per play, not a filter node).

Both halves have now been taken seriously and they did not come out the same
way. **One was wrong and is now built. The other is half right, and the half
that is right is a real, permanent limit** — written down below in the exact
shape it takes, because the interesting thing about a "no" is where it stops.

### A set's filter is real, and it is a master bus

The parenthetical is true about `Howl`: it has `rate()` and `volume()` per
play and no tone control of any kind. It is not true about **`Howler`**, the
namespace beside it. Two of its fields are public, documented in
`@types/howler`, and described by howler's own source as being there for
"plugins or advanced usage":

- `Howler.ctx` — the `AudioContext`
- `Howler.masterGain` — the `GainNode` every playing sound connects to

Every sound in the app is already mixed into `masterGain`, and `masterGain`
connects to `ctx.destination`. That last hop is a seam, and `src/sound/filter.ts`
cuts it:

```
masterGain ──▶ destination                            howler's own wiring
masterGain ──▶ biquad ──▶ [biquad] ──▶ destination    ours
```

So a set's `filter` is a chain of **real `BiquadFilterNode`s in the browser's
own Web Audio graph**. It is not an EQ baked into a file, and it is not a gain
trim dressed up as a filter. `scripts/probe-sound-bus.mjs` proves that by
measurement rather than by assertion: it feeds a tone into `Howler.masterGain`
in the running app, reads an `AnalyserNode` either side of the installed chain,
and compares the difference against what the wired node's own
`getFrequencyResponse()` predicts. Measured, on the dev server:

| Set | Chain | Tone | Measured | The node's own maths |
| --- | --- | --- | --- | --- |
| `house` | *none* | 300 Hz / 8 kHz | 0.0 dB | 0.0 dB |
| `far-room` | lowpass 1500 Hz | 300 Hz | +0.2 dB | +0.2 dB |
| `far-room` | lowpass 1500 Hz | 8 kHz | **−30.6 dB** | −30.6 dB |
| `music-box` | highpass 520 + peak 3.2 k | 120 Hz | **−25.2 dB** | −25.2 dB |
| `music-box` | highpass 520 + peak 3.2 k | 3.2 kHz | **+3.1 dB** | +3.1 dB |
| `drafting-table` | *inherited from its group* | 60 Hz | **−20.5 dB** | −20.5 dB |

Two things about that table are worth stating rather than leaving to be
rediscovered:

**The `house` row is 0.0 dB by construction, not by measurement.** With no
chain installed there is no tail to tap, so both analysers sit on the same
`masterGain` and the difference can only be zero. What that row actually
proves is the thing next to it — `installed: false` and an empty node list,
i.e. howler's own `masterGain → destination` hop is still what the audio
passes through. The probe asserts it in those terms.

**The probe waits on the audio clock, never on the wall clock.** A freshly
built `AudioContext` reports `state === 'running'` before its render thread has
produced a single quantum — measured here, `ctx.currentTime` advanced 0.011 s
across a 500 ms `setTimeout` — and an `AnalyserNode` that has never been fed
returns `-Infinity` in every bin, which subtracts to `NaN`. Sleeping on
`setTimeout` therefore made the probe fail the very claim it exists to confirm,
on exactly the runs where the context was newest. It now polls
`ctx.currentTime` (which only moves when audio has really been rendered) and
reports a silent analyser as a **rig failure** rather than as a filter result.
If a future edit reintroduces a wall-clock sleep, the first two or three sets
measured will start failing intermittently and the filter will look broken when
it is not.

#### What it genuinely cannot do, and why

1. **It is per-SET, never per-ROLE.** The seam is the master bus, and
   everything arrives there already mixed — including the ambient bed. A
   per-role filter would mean reaching into one playing sound's own gain node,
   which lives at `howl._sounds[i]._node`: private, undocumented, and
   re-created on every play. A voicing lever built on that would break on a
   howler patch release and break *silently*, which is worse than not having
   it. A set's filter is therefore a property of the room the app is heard in
   — which is the only thing any of the sets wanted to say anyway.
2. **It needs the Web Audio backend.** With `Howler.usingWebAudio === false`
   (no `AudioContext`, or a `Howl` opted into HTML5 streaming) there is no
   master gain to cut into, no filter is installed, and `busFilterStatus()`
   says exactly that rather than pretending. `getEngineState().filter` carries
   `installed`, `supported` and a `reason`, and QA is expected to read them.
3. **The context can be replaced under us.** `Howler.unload()` closes the
   `AudioContext` and builds a fresh `masterGain` wired straight to the new
   destination, throwing our chain away. `applyBusFilter` is therefore cheap
   and idempotent — it compares the context identity and the requested chain
   and returns immediately when neither moved — so the engine can simply call
   it on the play path instead of trying to predict howler's lifecycle.
4. **Failure is never allowed to be silence.** Every rewire runs inside a
   `try`/`catch` whose recovery is `masterGain.connect(destination)`, the exact
   wiring howler shipped. The worst case is an unfiltered app, not a
   disconnected one. `tests/sound-own.test.ts` drives a context whose
   `createBiquadFilter` throws and asserts the master gain comes back.

Only a minority of the twenty-eight sets carry a filter, and that is a
judgement rather than a limit. The cues are already conditioned once against
measured centroid and high-share ceilings, so a filter on top is worth its risk
only where the set's blurb promises a tone that rate and gain cannot deliver —
*"as if it were all happening in the next room"* is a lowpass and nothing else,
and quieter-and-slower had been failing to say it for the whole life of that
set. A set's own chain **replaces** its group's rather than compounding with
it: two lowpasses in series is not "a bit more lowpass", it is a 24 dB/oct
slope at a corner neither table chose.

### The reader's own set

`src/sound/userSoundSets.ts` (the pure registry) and `userSoundSetStore.ts`
(the dialog, the bytes, the row in `settings`). It follows
`features/templates/userStickers.ts` exactly: a `user:`-prefixed id, bytes
through the existing asset store, and a registry the rest of the app reads
without knowing where the bytes came from.

**A reader's set is a base plus overrides**, not a whole set:

```
{ base: 'far-room', cues: { 'click-soft': <their file>, … } }
```

Every role they did not fill is voiced by the base exactly as before, and the
base's rate, gain, layering, pool, jitter and bus filter still apply to the
ones they did. That is the difference between a feature someone can finish and
one they abandon: a reader with a single typewriter sample gets a working set
out of *one* file rather than thirteen, and everything they did not record
still keeps the mastered loudness hierarchy above.

Four decisions worth keeping:

- **Their file beats the base's substitution.** `loose-leaf` voices the button
  role with a typing tick; a reader who imports a click and hears a page turn
  has no way to explain it. It is also heard where the base *silences* the role
  (`almost-nothing` voices no buttons at all) — importing a click and getting
  silence with nothing on screen to say why would be indefensible. The reader's
  three own preferences are still absolute over it (mute, reduced sound,
  minimal character), because those are answers to questions they asked more
  recently.
- **The swap follows a layer too.** `reading-room` puts a `drop-thump` 140 ms
  under a book coming off the shelf. A reader who recorded one thump should not
  have to discover there were two places it went.
- **An unrecognisable file name is reported, not guessed at.** The bulk import
  matches on the file name — the family name, a shipped take name, or one of a
  small alias list, longest match first so `book-return.wav` cannot be captured
  by `book-pull`'s shorter alias. Anything else is listed back as unmatched.
  Handing leftovers to whichever roles happened to be free would make the same
  folder import differently depending on what was already in the set, and there
  would be no way to predict or undo it. The per-role buttons in the settings
  panel are the exact, unambiguous alternative.
- **A `user:` choice is honoured only while the set is registered.** "The
  reader deleted their set" and "the settings row came back from a restore the
  assets did not" then become the same survivable case, and it resolves to the
  house set the way any unknown id does.

#### What is NOT done to their files, and where the bytes live

**Nothing conditions them.** `condition()` above — the warmth fit, the lowpass
lid, the levelling that makes the loudness hierarchy exact — is a build step in
`gen-sounds.mjs` over ffmpeg-decoded 32-bit float. It is not something the app
can do to bytes at import time. A cue mastered 12 dB hotter than `pop-soft`
will be 12 dB hotter than `pop-soft`. The settings panel says so on the row
with the buttons, which is the only place anyone will read it.

The bytes go straight through the existing asset store — `storeImageBytes` →
`save_image_asset` → `app_data_dir/assets/images/<contenthash>.<ext>`. Three
things make that the right pipe rather than a lazy one: the Rust command is a
byte sink that sniffs magic bytes, finds nothing it recognises in a WAV or an
Ogg and falls back to the extension it was handed; `$APPDATA/assets/**` is the
only path in `tauri.conf.json`'s asset-protocol scope, so it is the only place
on disk a Web Audio fetch inside the app can reach at all; and content hashing
de-duplicates the same thump assigned to three roles down to one file. The
honest wart is that the row lands with `kind = 'image'` — `recordAssetRow`
hard-codes it. The rows are told apart by `meta.soundCue`, and
`loadUserStickers()`, which scans exactly these rows, keys off
`meta.customSticker` and skips them.

**One environment limit:** in the plain-`vite` browser shell there is no
filesystem, so an imported cue is an object URL and `devObjectUrls` is a
module-scope map a reload empties. `hydrate` therefore *drops* a cue whose file
no longer resolves rather than registering a dead `src` — a dropped cue falls
through to the base and the reader hears the app, where a registered-but-broken
one would be one role silent forever with nothing on screen to say why.
`scripts/probe-own-sounds.mjs` asserts that fallback rather than pretending the
dev shell can do what the packaged app does.

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

The engine no longer plays a `SoundName`, it plays a `Cue`: a URL, a category,
a loop flag and a cache key. `/sounds/<name>.wav` is simply the shipped way of
naming one, and `shippedCue()` is the adaptor for everything that still names a
file. That indirection is what lets one of the reader's own files be played by
the same path with the same volume slider, the same jitter and the same set
gain — a reader's key carries a `|` and so cannot collide with a `SoundName` in
the Howl cache. Its category comes from the **role**, derived from that role's
own first take, so a page turn they recorded still moves with the pages slider
and no new mapping has to be maintained.

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

`tests/sound-sets.test.ts` covers the named voicings; `tests/sound-own.test.ts`
covers the two levers above. The split of what each kind of check can settle is
deliberate and is stated in that file's header:

- A **stub graph** answers what is connected to what — a chain built and never
  connected, a master gain left disconnected after a throw, a re-wire running
  on every play. It cannot answer whether a filter filters, because nothing in
  it processes a sample.
- **`scripts/probe-sound-bus.mjs`** answers that, in a real `AudioContext`, by
  measurement (the table above).
- **`scripts/probe-own-sounds.mjs`** answers the other seam — whether a
  reader's file is actually *played* — from the network, because howler fetches
  the URL it was handed. The seeded cue is a shipped WAV under a query string
  no other code path in the app would ever request, so a request for it is
  unambiguous. A panel, a registry and a store can all agree that a file is
  assigned to a role while the app still plays the shipped cue, since the
  decision is made inside `playRole`, below all three.

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
