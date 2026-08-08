# Design: sound

## Recommendation

Every cue in `public/sounds/` is a **real recording** under a public-domain
dedication or CC0, sliced to a single event and conditioned by
`scripts/gen-sounds.mjs`. Nothing in the shipped set is synthesized.

> That last sentence was **untrue for months**, and the way it was caught is
> worth keeping. The `pop-soft` family — the most-used role in the app by call
> count, every menu and panel — was cut from Kenney's *Interface Sounds*, which
> are synthesised game-UI blips. So this document, and the header of
> `gen-sounds.mjs`, both asserted a property the set did not have, while
> shipping the exact thing the owner had rejected twice.
>
> No one heard it. A measurement found it: those five were the only cues in all
> sixty-six with a **>4 kHz share of exactly 0.00%**. A filtered synthetic tone
> has no noise floor; a recording always has one. They are five real objects
> now — a desk drawer's stop, nested wooden dolls coming apart and seating
> home, a sprung metal lid, a peanut shell giving way — and the same
> measurement reads 6.8–19.9%.
>
> The lesson for the next pass: the set's own report is the cheapest reviewer
> it has, and a claim in prose is not a property until something checks it.
>
> The next pass took the lesson. Reading the same report row by row found
> **three more defects nobody had heard either** — the button click, the
> keystroke and one page turn — and all three are fixed below under *Three
> more the report found*. Confetti later moved from a disguised bell shimmer to
> one exact CC0 balloon-pop recording; its singleton family is deliberate,
> because fake pitch-shifted variants would make the cue worse. The set is
> **26 recordings** now, up from the 15 the
> survey counted.

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
| **freesound.org** | The best CC0 catalogue for this brief by a wide margin. Its `robots.txt` disallows `ClaudeBot` site-wide and `/search/` for every agent — re-read at the time of the `click-soft` / `typing-tick` pass and unchanged. Not used. Commons' mirrors of individual freesound CC0 uploads are a different thing and *are* used — see *Sources used* below, after the provenance note. |
| **Kenney, *UI Audio*** | CC0, 50 files, and genuinely a different pack from the synthesised *Interface Sounds* that had to be torn out of `pop-soft`: its `switch*` members measure 250–430 ms at 4400–6300 Hz with **13–73% of their energy above 4 kHz**, which is broadband the way a recording is and a filtered tone never is. Downloaded and measured rather than assumed, because assuming is how the last Kenney pack got in. Not used for a different reason: at 2–3× the length `click-soft`'s 110–210 ms window allows and 3–4× the ~1300 Hz the family sits at, warming one into the house voice takes away the thing that makes it a switch throw. A good pack for a louder app. |
| **archive.org** | Carries commercial SFX libraries (Red Library, SSE, GOLD TAPE, Valentino, Designer's Choice) and outright console-game rips re-uploaded with CC0/PD-Mark tags by people who plainly do not own them. A CC0 tag on a Nintendo sound rip is proof the tags are not trustworthy, so none of the collection was used — including the items that may well be legitimate. |
| **pixabay.com** | Behind a Cloudflare bot challenge. Not bypassed. |
| **zapsplat** | Requires an account to download. |
| **Sonniss GDC bundles** | Royalty-free and legitimate, but distributed as multi-gigabyte archives — disproportionate for 56 short cues. |

### Sources used

All verified by reading each submission's own licence field (not badge
images, which also appear in OpenGameArt sidebars for unrelated work — that
distinction caught the rain bed, filtered as CC0 but actually CC BY 4.0).

Twenty-six recordings. The table is generated-adjacent rather than
hand-maintained prose: `CREDITS.json` is rewritten from the same `SOURCES`
object on every build, so if a row here disappears from that object the
manifest says so. **Kenney's Interface Sounds is no longer in it** — that is
the `pop-soft` replacement above, and this table said otherwise for one
commit longer than it should have.

| Source | Author | Licence | Page |
| --- | --- | --- | --- |
| Old book (leafing, flicking, shutting) | cori | Public domain (`PD-author`, via pdsounds.org) | [Commons](https://commons.wikimedia.org/wiki/File:Old_book.ogg) |
| Book, Paper, Pages, assorted | stephan | Public domain (`PD-author`, via pdsounds.org) | [Commons](https://commons.wikimedia.org/wiki/File:Book_paper_pages_assorted.ogg) |
| Pencil Scratchings | gypsygirl | Public domain (`PD-author`, via pdsounds.org) | [Commons](https://commons.wikimedia.org/wiki/File:Pencil_scratchings.ogg) |
| 10 Book Page Flips | StarNinjas | CC0 1.0 | [OpenGameArt](https://opengameart.org/content/10-book-page-flips) |
| Turning a page (in a hard-cover book) | planish | Public domain (`PD-author`, via pdsounds.org) | [Commons](https://commons.wikimedia.org/wiki/File:Turning_a_page.ogg) |
| Tack tack tack (tapping a small box) | stephan | Public domain (`PD-author`, via pdsounds.org) | [Commons](https://commons.wikimedia.org/wiki/File:Tack_tack_tack.ogg) |
| Hitting a wooden pole | stephan | Public domain (`PD-author`, via pdsounds.org) | [Commons](https://commons.wikimedia.org/wiki/File:Hitting_wooden_pole.ogg) |
| Wooden cutting board set down on a table | thore | Public domain (`PD-author`, via pdsounds.org) | [Commons](https://commons.wikimedia.org/wiki/File:Wood_and_cutlery.ogg) |
| Typing, hunt and peck | teto_yasha | Public domain (`PD-author`, via pdsounds.org) | [Commons](https://commons.wikimedia.org/wiki/File:Typing_hunt_and_peck.ogg) |
| Computer keyboard (chunky-keyed, London 2008) | russiandoll | Public domain (`PD-author`, via pdsounds.org) | [Commons](https://commons.wikimedia.org/wiki/File:Computer_keyboard.ogg) |
| Wooden desk drawer | hugh | Public domain (`PD-author`, via pdsounds.org) | [Commons](https://commons.wikimedia.org/wiki/File:Wooden_desk_drawer.ogg) |
| Russian dolls opening | ezwa | Public domain (`PD-author`, via pdsounds.org) | [Commons](https://commons.wikimedia.org/wiki/File:Russian_dolls_opening.ogg) |
| Russian dolls closing | ezwa | Public domain (`PD-author`, via pdsounds.org) | [Commons](https://commons.wikimedia.org/wiki/File:Russian_dolls_closing.ogg) |
| Metal box springs open | stephan | Public domain (`PD-author`, via pdsounds.org) | [Commons](https://commons.wikimedia.org/wiki/File:Metal_box_springs_open.ogg) |
| Cracking peanuts | stephan | Public domain (`PD-author`, via pdsounds.org) | [Commons](https://commons.wikimedia.org/wiki/File:Cracking_peanuts.ogg) |
| Bell dings/chimes | PWL | CC0 1.0 | [OpenGameArt](https://opengameart.org/content/bell-dingschimes) |
| Balloon pop (from Balloon Sounds) | Gniffelbaf; curated by AntumDeluge | CC0 1.0 | [OpenGameArt](https://opengameart.org/content/balloon-sounds) |
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
entry per recording, with the cues it became). Every rebuild rewrites this
manifest from the same provenance table as the audio, including the required
CC BY flag.

## Which recording became which cue

One recorded world, the way the art is one drawn world — the interface is
made of paper, graphite, books, small struck objects, a balloon and a brass bell, not of
synthesised blips.

| Family | Comes from |
| --- | --- |
| `page-flip` ×6 | StarNinjas' flips ×4, Book/Paper/Pages ×1 and planish's single page turn ×1 — separate physical takes, so the rotation has real variety |
| `click-soft` ×4 | three objects struck: a small box tapped ×1, a wooden pole ×2, a cutting board set down ×1 |
| `book-pull` ×4 | pages riffling past each other |
| `book-return` ×4 | the same, ending on the book meeting the shelf |
| `shelf-whoosh` ×3 | a long riffle, warmed hard and kept 11 dB under everything else |
| `pop-soft` ×5 | a drawer's stop, nested dolls apart and together, a sprung metal lid, a peanut shell |
| `tick-hover` ×5 | graphite ticking on paper — the quietest thing in the app |
| `check-done` ×4 | a small bell allowed to ring out |
| `crumple-delete` ×4 | paper actually being crushed |
| `drop-thump` ×4 | a book shutting / meeting a surface |
| `confetti` | one real balloon pop; if it fails listening review, this decorative role goes silent rather than borrowing an unrelated sound |
| `pencil-scratch` | a 210 ms seamless loop of the pencil recording |
| `typing-tick` ×6 | isolated keystrokes off two keyboards — hunt-and-peck ×5, a chunky-keyed PC board ×1 |
| `chime-hour` ×3 | three or four real strikes in sequence, because an hour bell *is* a sequence |
| `ambient-*` ×10 | one field recording each — see *The soundscapes* above |

### Three more source corrections

The `pop-soft` discovery came from comparing the cue's physical source with
the role it was meant to voice. Three more cues failed that same review.
None of the three is a conditioning problem, and that is the finding worth
keeping: **each one is a cue whose SOURCE is the wrong physical event**, and no
ceiling, lid or level moves a recording from one kind of event to another.

**`click-soft` ×4 — the most-fired cue in the app.** They were sub-slices of
the Old-book *riffle*, overlapping the `book-pull` windows, and two of the four
measured a max adjacent-sample step of 3.3% and 11.6% — i.e. a cue that is
supposed to be a tap, arriving with less slew than the ambience beds (11–22%).
A riffle is **friction**; a button press is a **contact event**, which is
almost entirely attack, and the step metric is the one number in the report
that can tell them apart. Three recordings now, four takes, alternating so the
rotation crosses materials:

| | centroid | >4 kHz | max step |
| --- | --- | --- | --- |
| before (Old-book riffle ×4) | 909–1369 Hz | 0.03–0.18% | **3.3–18.5%** |
| after (box / pole / board) | **1278–1307 Hz** | 0.04–0.20% | **14.8–19.6%** |

The family got *tighter* in tone (a 29 Hz spread, from 460) while being made of
more things rather than fewer. Two candidates were measured and rejected, and
both are worth writing down. A **retractable pen** was the obvious button
sound: nine clean clicks in the take, and every one of them conditioned to
493–1198 Hz at 3–11% step — duller, and less of a contact event, than the
riffle it was meant to replace. The obvious sound and the right sound were not
the same sound. And **two taps from the same box take** passed every spectral check
and failed the family's own variety gate at 0.28 against a 0.5 floor: three
taps on one object inside one second are near-copies, which is the original
defect wearing a better hat.

**`tick-hover` ×5 and `typing-tick` ×6 were the same 60-second pencil take,
interleaved.** Measured, they were indistinguishable — 1546–1586 Hz against
1477–1601 Hz, one range inside the other — and the only thing telling a
keystroke from a hover was 9 dB of level. Within-family variety metrics cannot
catch this because each family was internally various; the defect only exists
*between* two families.

The hover keeps the pencil, which is the half worth keeping: a hover is a
near-subliminal acknowledgement and graphite on paper is exactly that. The
keystrokes moved to two real keyboards, because a key being struck is a
different physical event with a body under it.

| | centroid | max step | envelope peaks at |
| --- | --- | --- | --- |
| `tick-hover` (unchanged) | 1491–1586 Hz | 8.7–12.0% | 16–138 ms, 8–81 ms rise |
| `typing-tick` before (same pencil) | 1477–1601 Hz | 8.1–13.8% | — |
| `typing-tick` after (two keyboards) | **850–1285 Hz** | **13.1–21.5%** | **8–17 ms, 4–12 ms rise** |

They are disjoint now, ~200 Hz apart, and that is deliberate rather than lucky:
the *brightest* keystrokes measured were among the cleanest contact events in
either take and were dropped anyway, because they conditioned to 1500–1700 Hz —
straight back on top of the hover. Three of the quietest cues in the app fire
within the same second of the same gesture, so it is not enough that they come
from different objects; they have to sit in different places.

**Where the envelope peaks is worth reading off the files by hand.** A hover is
friction, so its energy is spread over the whole window and
its loudest moment is wherever the graphite happened to catch. A keystroke and
a button press are contact events, so they are loudest in the first 8–17 ms and
decay from there. That one number separates the three quiet cues more sharply
than centroid does, and it is what the waveform pictures show at a glance —
before, the typing ticks and the hover were the same picture.

**`page-flip-5` measured 1075 Hz against 1843–1860 for its five siblings** —
the thud among five sheets of paper, and the exact defect that had already got
`page-flip-1` replaced one pass earlier. It is planish's *Turning a page* now,
a recording that is nothing but one page going over in a hard-cover book, which
is why it can be sliced whole instead of hunted for inside a longer take: 1855
Hz, dead in the middle of its family. (Its recordist notes they dropped the
pitch two semitones and applied a lowpass before uploading. That is a processed
recording, not a synthesized one, and it is still a real page — but it is
recorded here because the set's one rule is that we know what everything is.)

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

## Playback backend and unlock contract

Playback uses **`@pixi/sound` 6.x**, the release line officially paired with
PixiJS 8 in the [Pixi Sound compatibility table](https://pixijs.io/sound/docs/index.html).
It gives the app one maintained audio context, decoded preload state, per-play
volume/speed options, and the public `filtersAll` bus surface. Keeping these on
public APIs matters: the intermittent static was most likely to appear at
backend lifecycle and first-sample gain seams, so the engine no longer reaches
through a library's private voice nodes or changes gain after playback begins.

The backend is a **static application dependency**, not a lazy dynamic import.
This is load-bearing with Vite: when Pixi Sound was first loaded through its
own optimized-dependency URL after the shelf's PixiJS module already existed,
Pixi's canvas extension table was evaluated a second time and threw
`canvas-system already has a handler`. No AudioContext or WAV request ever
existed in that failure mode. One initial module graph gives the shelf and
sound one Pixi extension registry. `prepareInteractionAudio()` then pre-decodes the
page-turn, book-open and book-rail click families. A cue that arrives before
decode/unlock is retained in a bounded, expiring queue and replayed once; rapid
roles have explicit cooldown and voice caps so repeated page-edge presses
cannot create an unbounded transient pile-up. Decode failures, fallback use,
unlock attempts, queue expiry and concurrency drops are exposed by
`getEngineState().backend` rather than disappearing as unexplained silence.

Page turns are stricter than ordinary controls. The recordings are 300–430ms
broadband events and Pixi mixes every live instance through one dynamics
compressor; two valid page buffers overlapping during the compressor's release
can be perceived as a burst of static. The engine never stops a live page
instance (a hard stop would create a real discontinuity). It voices the first
turn, keeps the rest of a rapid stream silent, and rearms only after 650ms of
quiet. `backend.burstDrops` makes that decision inspectable. The separate
pulled-cover → open-pages transition uses one restrained concrete page take,
not the shelf-pull cue.

Browser autoplay policy is handled literally. MDN recommends creating or
resuming an `AudioContext` from a user gesture
([Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices),
[`AudioContext.resume()`](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume)).
The engine therefore installs a capture-phase `pointerdown`/`keydown` broker
synchronously. The broker calls Pixi's empty-buffer unlock and
`resume()` inside every trusted dispatch, then releases queued BufferSources
against the suspended audio clock while resume is pending. A trusted in-app
gesture also repairs focus-derived muting (WebView2 can report
`document.hasFocus()` one turn late), but never overrides the reader's hard
mute. A closed hardware context is rebuilt through Pixi's documented `init()`
path on the next gesture and its old decoded cache is discarded.

### A set's filter is real, and it is a master bus

Pixi Sound's public [`filtersAll`](https://pixijs.io/sound/docs/SoundLibrary.html)
surface accepts `Filter` wrappers around real `BiquadFilterNode`s. A sound
set's chain is therefore genuine Web Audio processing, not baked EQ or a gain
trim. It remains per-set rather than per-role because it intentionally applies
to the complete mix. If Web Audio or filter construction is unavailable,
`filtersAll` is cleared and playback continues unfiltered; `busFilterStatus()`
reports that fallback explicitly.

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
That fallback is intentional; the browser shell must not pretend it can retain a
file URL across reloads.

## Rebuilding

```
node scripts/gen-sounds.mjs
```

Needs `ffmpeg` on `PATH` (decoding only) and, on a cold cache, network access.
Sources are cached in `os.tmpdir()/notebook-sound-sources`, deliberately
**outside** the repo: the ~130 MB of raw material is not vendored, only the
12 MB of conditioned cues under `public/sounds/`. Every run rewrites
`CREDITS.json` from the same tables that drive the audio, so
provenance cannot drift from what actually shipped.

## Contract with `src/sound/engine.ts`

66 files named exactly as `SoundName` enumerates them, 44.1 kHz / 16-bit /
mono, served from `/sounds/<name>.wav`. The `plain` / `full` split in
`VARIANT_WEIGHTS` still means "shorter take" / "longer take", so within each
family the `full` entries are cut longer.

`SOUNDSCAPE_LOOPS` is the single source of truth for the bed list: the settings
chips, the `Settings['soundscape']` validator and `ALL_SOUND_NAMES` derive from
it, so adding a bed to `gen-sounds.mjs` and to that map is the whole change.

The engine no longer plays a `SoundName`, it plays a `Cue`: a URL, a category,
a loop flag and a cache key. `/sounds/<name>.wav` is simply the shipped way of
naming one, and `shippedCue()` is the adaptor for everything that still names a
file. That indirection is what lets one of the reader's own files be played by
the same path with the same volume slider, the same jitter and the same set
gain — a reader's key carries a `|` and so cannot collide with a `SoundName` in
the decoded-sound cache. Its category comes from the **role**, derived from that role's
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

Run `npx tsc --noEmit` and `npm test`, then audition the affected gestures in the
running app. Listen for click/static defects, loudness hierarchy, per-family
variety, loop seams, and whether an imported cue actually replaces its shipped
role. The licence manifest must still match the regenerated audio table.

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
