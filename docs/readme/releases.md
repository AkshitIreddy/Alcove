<p align="right"><i>
  <a href="../../README.md">← Alcove</a> ·
  <a href="part-1-users.md">Part 1 — Using Alcove</a> ·
  <a href="part-2-developers.md">Part 2 — Building Alcove</a>
</i></p>

# Release notes

What changed, newest first. This is a page of its own rather than the opening of
the front page, because somebody arriving at the front page has not installed
anything yet and a changelog is the wrong first thing to hand them.

The definitive list for a given build is the
[GitHub Release](https://github.com/AkshitIreddy/Alcove/releases) it is attached
to. Each future release carries an explicitly authored, version-matched note
under [`release-notes/`](../../release-notes/README.md). The tag workflow
validates that prose and [`scripts/release-notes.mjs`](../../scripts/release-notes.mjs)
adds only stable branding, history links and download guidance. This page is
the longer human summary beside it.

Every number below is read out of the module that defines it and wrapped in a
marker `npm test` recomputes, exactly as on the other three pages.

## 0.7.8 — steadier image-assisted pages

**Picture requests recover cleanly from malformed or incomplete provider
replies.** Alcove requests one corrected complete draft, preserves normal
rate-limit and network retries, and never stores truncated output. Brief image
tasks remain grounded in the supplied picture and keep their reviewed preview
available while you ask a follow-up question.

**The reader guide is complete again.** It leads with customizable shelves,
books, pages, wallpaper, writing desks, sound and local ownership, followed by
the full illustrated feature tour and a compact download section.

## 0.7.7 — smoother notebook editing

**Everyday block actions are more dependable.** The context menu now has a
normal Paste action, any block can move back one page when it fits, and rail
panels keep their complete outline while their contents scroll.

**The Agent stops turning one answer into another interview.** After a reader
answers a clarification, the task continues without advertising another
question in the same turn. The reader guide is also much shorter, with a small
download section placed before the feature tour.

## 0.7.6 — reliable image-assisted Agent flow

**Image requests stay grounded end-to-end.** Attached visuals are now kept with the
agent draft and review evidence, malformed image inputs are handled safely, and
image-led requests no longer fall through to placeholder or empty preview states.

**Conversation and preview are separated.** A follow-up question no longer steals a
pending insertion attempt; pending previews remain visible and re-usable, while UI
controls in the notebook area were hardened so focus, scroll, and wheel behavior are
more predictable.

## 0.7.5 — steadier picture requests

**Picture requests no longer stop on harmless Cohere stream variations.** The
Agent accepts valid headerless events and stream terminators while keeping tool
calls, completion and approval strictly validated.

**Attached images remain exact and predictable.** Common malformed attachment
syntax is corrected locally, duplicates are removed, full-page requests produce
one image page plus concise notes without an empty trailing page, and malformed
extra media cannot take down localhost.

The six-dot block handle also stays beside the page during panel and book-size
changes. Release messages are shorter from this version onward.

## 0.7.4 — reliable image-led Agent pages

**An attached picture now stays authoritative from the request through the
reviewed preview.** The Agent accepts files dropped onto either composer,
grounds a vague “add to my book” request in the staged picture, corrects common
image-script mistakes, and refuses to present a blank, receipt-only or
missing-media page. A compact image request defaults to one useful page instead
of turning a dense infographic into a chapter.

**The Agent now spends model calls on judgment rather than bookkeeping.** Safe,
deterministic inspection, source reading, validation, rendering and preview
presentation remain audited tools but run locally. Cohere authors the page and
reviews its native pixels; malformed routing receives bounded recovery with
structured diagnostics. Final insertion still requires the reader's explicit
approval.

**Writing-desk zoom is deliberate.** A wheel gesture changes the book scale
only immediately after a click on the empty desk. Hover, panel scrolling,
typing, pointer travel, focus changes and expired clicks cannot resize the book
in the background, and the stored page geometry remains unchanged.

Release messages are now written for each completed version rather than
generated from commit subjects. The workflow validates that authored note
before building installers.

## 0.7.3 — update checks that answer back

**A brief startup failure no longer makes an update disappear for the whole
session.** Alcove retries the signed release check twice on a bounded schedule,
and coming back online accelerates only a retry that was already pending.
Background failures are retained in diagnostics instead of being silently
indistinguishable from “already current.”

**Settings now has a manual update check.** The System section shows the
installed version and a **check now** action that reports whether Alcove is
current, a newer signed edition is ready, or the release service could not be
reached. The installed version also appears in the Settings footer.

The existing screenshots and demo remain representative. They are intentionally
reused for this updater-only patch rather than being regenerated.

## 0.7.2 — a softer writing desk around the book

**The open book can now sit on a writing desk chosen by the reader.** Settings
and first-run onboarding share 25 light, individually authored colours, with
Linen presented first and soft blush, coral and rose choices close beside it.
The colour belongs only to the field around the book: it never changes the
paper, stored page geometry, wrapping or pagination.

**The empty desk is also a camera control.** A plain wheel over the field makes
the complete bound book larger or smaller while a wheel over the paper remains
available to the editor. The familiar back arrow stays compact on hover instead
of growing a redundant “back to shelf” label.

**Cohere connection checks are more reliable and more useful when they fail.**
The native empty POST now declares its body length, matching the localhost path,
and safe serialized desktop errors reach the setup panel instead of collapsing
into a generic connection message.

The 0.7.0 screenshots and demo still accurately represent the book, Agent and
library. They are intentionally reused for this small patch rather than being
regenerated.

## 0.7.1 — a larger open book without page reflow

**Open books make better use of roomy displays.** The reader camera can now
magnify the complete bound book beyond its old ceiling, filling more of the
desk on high-resolution windows instead of leaving a wide unused border. The
redundant visible title strip above the book is gone; the name remains available
to screen readers.

**The pages themselves do not resize or reflow.** This is a camera-only fit over
the same canonical cover, paper and editor geometry, so changing window size,
opening a rail panel, or returning to a larger viewport cannot move writing,
change pagination or persist a different document. The 0.7.0 screenshots and
demo still accurately represent this patch release and remain the release media.

## 0.7.0 — an Agent that writes real notebook pages

**The AI Agent now lives inside every open book.** Ask a normal question, attach
material when it matters, or ask Alcove to turn the current conversation into
pages. The Agent can inspect the active notebook, search relevant sources,
compose with the native page catalogue, render the result through Alcove's real
editor and review that render before presenting one immutable preview. Nothing
enters the live book until the reader presses **Insert into book**.

**Conversation and notebook work share one durable thread without becoming the
same thing.** Ordinary questions receive ordinary answers and do not trigger
retrieval merely because an old source exists. A later “add that to my book”
receives the settled chat history, while clarifying questions and exact replies
remain visible once answered. Tool loops, repeated repairs and provider retries
are bounded and accounted; Retry resumes from the durable failed checkpoint
instead of silently doing nothing.

**Grounded work is explicit and privacy remains local-first.** Exact-content
embeddings are cached across tasks and restarts, changed pages alone are
re-embedded, and source capabilities stay scoped to the current task. A local
Text veil can replace recognizable private text before a provider call and
restore it only after review. Preserve-all PDF work remains fail-closed when a
page cannot be visually verified; embedded JPEG figures are supporting evidence
and there is no OCR.

**Reviewed page insertion is fast, exact and recoverable.** The approved render,
target and page documents travel together as a durable receipt. Large books
settle only the affected run, so inserting reviewed pages no longer freezes the
whole notebook or falls into an apply/refresh loop. One book-level undo restores
the exact pre-insertion structure, and provider or renderer failures cannot
overwrite a cancellation or manufacture a successful mutation.

**Editing near a page boundary now behaves as one book operation.** `Ctrl+Z`
returns blocks displaced by pagination as well as removing the edit that pushed
them forward. Multi-block moves remain ordered and atomic, the writing caret
stays clear of ruled lines, inline art uses its own baseline contract, and maths
and special blocks keep their geometry across page movement and fitted scales.

**Contents are searchable and recovery is protected by default.** The open-book
Contents panel filters headings and page aliases from the keyboard, while page
history keeps dense recent versions plus progressively spaced recovery points
and whole-book checkpoints. The first-run tour, public screenshots and complete
demo now cover the native Agent without making provider setup an onboarding
requirement.

## 0.6.6 — safer pictures and whole-import undo

**One undo can put back an entire book before a script import.** Alcove now
captures the exact page rows, authored page boundaries, source provenance and
starting spread before inserting a Notebook Script. After a successful import,
one `Ctrl+Z` restores that book-level checkpoint and removes only the leaves
created by the insertion. Once the reader makes a new page edit, undo returns
to the active editor as usual instead of retaining a stale whole-book action.

**Pictures stop growing before they would displace the page.** Dragging an
image resize handle now has a live ceiling derived from the room remaining on
that leaf and the writing below it. The handle visibly stops at the largest
safe display size rather than committing an oversized block and asking
pagination to move surrounding content afterwards. Only the displayed width
is limited; Alcove keeps the original image bytes and intrinsic resolution.

**The large-image viewer shows the whole original before zooming.** Tall and
wide pictures are fitted against the viewer's real content box at 100%, then
remain zoomable and draggable. The image tools use centred, single-ink Alcove
line drawings instead of platform glyphs whose baselines varied between
systems. Right-click works directly on a picture and across the unused part of
a narrow picture's writing row, so the normal block menu is always reachable.

**Moving a block backwards is now one durable move.** When the source is the
left leaf of the following spread, Alcove records its deletion before
navigating to the destination. Returning to the old leaf can no longer rebuild
the stale document and leave a second copy behind.

**Trash has a deliberate dock menu.** Right-clicking the trash button offers
**Open trash** and **Empty trash…** without changing the ordinary left-click or
drag-to-trash behavior. Permanent emptying uses a second confirmation inside
the same Alcove-styled context card and refreshes the shelf only after the
operation succeeds.

## 0.6.5 — safer imported pages and books that stay put

**Long script imports no longer repeat entire sections.** Alcove now preserves
the newest in-memory document while protected page boundaries reorder the
durable rows, closing the debounce race that could resurrect already-moved
content and emit it again. Before the insert dialog closes, every populated
spread is mounted through the real editor and allowed to settle; the reader
returns to the original spread only after pagination is stable.

**Large pictures protect the writing around them.** Image dimensions are read
before insertion and the page chooses a conservative initial display width from
its remaining capacity. An oversized upload therefore shrinks on the paper
instead of immediately pushing a chain of neighbouring blocks onto later
pages. Alcove keeps the original bytes and intrinsic resolution intact for the
zoomable full-screen viewer, and the reader can still resize the page copy.

**Pages and blocks can be reorganised where they are read.** The right-click
menu can add a blank page immediately before or after the current leaf, while
the first block of a following page can move back into available room on the
previous one. Native drag-and-drop now crosses the two independent page editors
for both text and media rather than silently refusing the move.

**Book placement and duplication preserve the reader's choices.** Moving a
book stores its exact visual shelf anchor and generated neighbours yield around
it, so a refresh cannot pull it back toward the nearest cluster. Duplicate now
asks for either the complete book or its cover with blank pages; both choices
retain the source's procedural seed, emblem, cover metadata and binding instead
of rerolling everything except colour.

**AI-requested images arrive in the right shape.** The downloadable Notebook
Script guide tells assistants to give their image-generation counterpart a
role, orientation, exact aspect ratio and approximate pixel dimensions. It
offers practical landscape, square and portrait examples without prescribing
the subject or limiting the assistant's creative direction.

**Inline emoji clear the page rules.** Emoji sequences receive a small
display-only lift so symbols sit with Alcove's handwriting just above a ruled
line instead of cutting through it. Stored TipTap JSON, Notebook Script and all
exports remain unchanged.

## 0.6.4 — cleaner AI notes and more faithful page typography

**AI-written formulae now accept ordinary TeX spacing.** Alcove already
understood `\bar`, `\text` and the surrounding maths, but treated TeX's
standard backslash-space command as an unknown macro. Expressions such as
`\bar{L} = 2.15\ \text{bits per sound}` now render as one complete equation
without a red error fragment. The downloadable guide documents the spacing
forms assistants are likely to use.

**Emoji sit with the handwriting instead of below it.** Complete Unicode emoji
sequences—including flags, keycaps, skin-tone modifiers and joined emoji—are
given a display-only baseline correction. The stored TipTap document and every
export remain unchanged. Creative Direction's old geometric diamond is also
replaced with a monochrome Alcove-styled sparkle, optically centred inside its
amber paper seal rather than inheriting a colourful platform emoji.

**The table of contents describes the book rather than its empty stock.** A
heading-less spill leaf now says which section it continues, intentional blank
leaves inside authored material remain reachable, and unused blank leaves after
the last content page are omitted. This removes redundant rows such as
“page 5 · p.5” and the run of empty page numbers at the end of a fresh book.

**The AI guide is stricter about visual page units.** Its mandatory second pass
must budget a heading, short setup sentence and introduced diagram, table,
equation or image together. If the complete unit cannot fit, the assistant is
told to move the protected boundary before the heading rather than strand a
title on one page and its visual on the next. Alcove deliberately does not
guess this relationship from arbitrary prose and unexpectedly repaginate a
reader's existing note.

**GitHub release notes now explain their bullets.** What's new and What's fixed
remain the first reader-facing sections, but each Conventional Commit may add
its first explanatory paragraph beneath the summary. This keeps releases
scannable while documenting the behaviour and reason behind a change instead
of publishing a wall of terse commit subjects.

## 0.6.3 — AI pages with an art director and steadier paper

**The AI guide now knows the whole studio.** Creative Direction adds seven
carefully written moods plus a full custom-brief editor before downloading or
copying the guide. The generated specification lists all fifty stickers, every
page paper and the live cards, callouts, lettering, diagram and trim domains;
it explicitly treats them as a palette rather than repeating tape or one easy
sticker. The Paste Script dialog stays focused on opening, previewing and
inserting the assistant's attached `.md` file, and its diagnostics can be
copied back to the chat in one press.

**Pictures behave like durable page objects.** Filling a large AI placeholder
now reflows the surviving text onto following pages after the image decodes.
Local development pictures survive reloads like the shipped app, and every
image can open in a large viewer with button or wheel zoom plus drag-to-pan.
Notebook Script may request a relevant open image search; an unavailable
network becomes a named upload card rather than broken prose.

**Long imported notes keep their intended structure.** Scripts land on the
leaf that opened the dialog, reuse a fresh book's blank leaves, preserve
document-wide variables and styles across `::page` boundaries, and remain on
the starting spread instead of jumping to page three. Overflow carries short
headings and colon-ended lead-ins with the lists, tables or diagrams they
introduce. Display equations fit the paper, compact TeX fractions and ceiling
symbols render correctly, and page-turn snapshots preserve table geometry.

**Small authoring tools are easier to reuse.** Book Studio colour wells can
copy and paste exact colours between roles. The release page itself now opens
with **What's new** and **What's fixed**, and the Windows offline bundle reuses
the already compiled app instead of rebuilding it a second time.

## 0.6.2 — page boundaries that stay out of the page

**Page deletion now lives where the page does.** Right-click a leaf and choose
**Delete this page**; the dedicated rail button is gone, and the option does
not appear for the only surviving page in a book.

**Protected AI page boundaries no longer touch document formatting.** The
`::page` anchor is stored as page metadata rather than a TipTap document
attribute, and Alcove automatically migrates boundaries created by 0.6.1.
Boundary-looking text inside code fences or containers stays literal. This
keeps the Welcome book and ordinary page styles intact while still inserting
overflow pages before deliberately anchored sections.

**Dropping a book into trash stays quiet.** The book is moved to trash without
opening the trash drawer. The Notebook Script checklist also now repeats its
own leading instruction correctly: assistants should return a downloadable
`.md` attachment, not browser-rendered text that may lose formatting.

## 0.6.1 — steadier AI pages and quicker library control

**Notebook Script now survives richer AI output.** Common TeX constructions
including `\bar`, `\overline` and `\boxed` render directly. The format guide
asks assistants to return a downloadable `.md` attachment instead of browser
text that can lose escapes, and Insert Script opens that file directly.

**Authored page alignment can be protected.** A `::page` boundary starts a
deliberate page. If an earlier large image or long section overflows, Alcove
inserts spill pages before that boundary instead of cascading the displacement
through the rest of the book.

**Pages and books are easier to remove.** The book rail can delete the current
page with a deliberate second press while preserving the last page of a book.
On the shelf, a pulled book can now be carried onto the trash dock as well as
sent there through its menu.

**Finding things respects where you are.** `Ctrl+K` searches only the open book
while reading, keeps whole-library scope on the shelf, and can find and run UI
commands alongside books, headings and content. Page-history snapshot counts
now say “words” in full instead of the ambiguous `w` abbreviation.

## 0.6.0 — books rebuilt from the boards out

This release replaces Alcove's generated-book vocabulary rather than carrying
forward shapes and decorations that stopped reading as books at shelf size.

**Every active spine is unmistakably a book.** The new system has three
straight silhouettes, eighteen construction-led materials, 59 authored spine
programmes and 67 named bindings. Spine names and empty title furniture are
gone; complete titles remain on the cover. Old stored book appearances migrate
onto the rebuilt vocabulary while pages, book identity, shelf placement,
bookcases, carpentry and wallpaper stay untouched.

**Book Studio composes instead of piling on.** Covers offer sixteen unified
shelf-legible emblems, twelve continuous frames, fifteen complete title
treatments, ten lettering hands, six genuinely painted page-edge finishes and
three endband constructions. Charms, hardware, corner protectors, inset plates
and repeated wallpaper-like symbol fields are retired. Surprise me searches eight directions
under one focal-programme budget, with 24 locks for keeping the decisions that
already work.

**Welcome is a Grand-blue Gilt Quarto.** Its deep blue spine is clean and
titleless, with two cords and one broad foliate lozenge; its cover
carries an Engraved direct-gilt title, Renaissance panel and the same formal
binder's tool. Settings
adds a default-off “Keep Welcome book current” choice for readers who want a
future edition even after editing the guide; the consequence is stated beside
the switch and replacement remains version-gated.

**Local pictures and video travel with selected pages.** Library parcels carry
only referenced assets, strip machine-specific library roots, and rebuild both
lossless JSON and script-only media against the destination library. Notebook
Script preserves exported video as `media=video` plus its durable `asset` path.
AI-authored empty image placeholders can be filled in place, and the native
AI-format save path has the scoped write permission it needs.

**The last rough seams were removed.** Dragged books no longer show a duplicate
orange backing, long cover titles fit without ellipses, and updater release
notes render as real headings, lists, emphasis and links instead of raw GitHub
markup.

## 0.5.1 — page turns with room to move

This patch is the owner-tested repair pass immediately after 0.5.0. It keeps
the new updater path and product surface unchanged while correcting five
visible or lifecycle defects found in ordinary use.

**Corner turns can leave the book.** The curl renderer previously calculated a
real two-dimensional cylinder position and then discarded its vertical
coordinate at projection time. A larger canvas therefore contained only empty
space while the paper still looked squeezed into the settled cover. Corner
turns now project the actual tilted silhouette, reserve framebuffer room
relative to the leaf height, and keep camera strength independent of that
overscan. The depth-only baseline compensation remains, so ordinary edge turns
retain the accepted `Esc`, list-marker and special-block stability. The owner
confirmed the corrected corner can cross the title panel naturally.

**Links within the open book remain in the reader.** Welcome-page links and the
three “Need a way back?” actions no longer reopen the already-open book, reset
reader readiness, flash the shelf, or leave its focus rectangle visible. They
now consume the pending page target directly inside the mounted reader.

**Book Studio previews the binding that is actually on the shelf.** The preview
now receives the book's persisted binding id instead of falling back to the
seed's plainer treatment, so ornaments, bands and reserved label space match
the spine readers see in the room.

**The New book mark stays centred.** Its plus no longer rotates around the font
glyph's uneven typographic centre on hover; it keeps the same upright optical
centre and uses only the small existing scale lift.

**Putting Alcove in the tray puts its ambience away.** A successful desktop
hide now retires the current ambient voice without clearing the reader's chosen
soundscape, and restoring the window resumes it. This is the default for both
new and existing settings blobs. Readers who deliberately want continuous
ambience can enable “ambience in the tray” in Sound settings. Pending starts,
rapid hide/show transitions and the opt-in path are covered by focused race
tests.

Existing 0.5.0 desktop installations can discover 0.5.1 through Alcove's
signed in-app updater after the release workflow publishes `latest.json`.

## 0.5.0 — steadier pages, deeper rooms, calmer focus

This release is the accumulated owner-tested product pass after 0.4.0: the
reader now holds its exact shape throughout a page turn, the library and book
studios expose their choices more clearly, focus mode has one compact control
rail, and the desktop build gains a signed update path. It also includes the
expanded Welcome book, media and Notebook Script work, sound lifecycle repairs,
and a deliberately quieter completion effect.

**The desktop build can update itself from signed GitHub Releases.** A new
release is checked from inside the installed executable, shown as an explicit
download/install choice, and handed to Tauri's signed updater. Existing 0.4.0
installations still need one manual bootstrap installer before they can use
that path. The release workflow emits signed updater metadata, checksums and
complete Windows, macOS and Linux installers; the signing private key remains
outside the repository and is installed only as a GitHub Actions secret.

**Installation and ownership are clearer.** Windows setup can choose the
library-data folder, the running app resolves that location consistently for
the database, media and backups, close-to-tray is wired end to end, and the
uninstaller continues to preserve the library unless the reader explicitly
chooses otherwise.

**The Welcome book became the complete product tour.** Its forty-eight authored
leaves demonstrate ordinary writing, pagination, the catalogue, cards and
keepsakes, images and local video, hand-drawn diagrams, mathematics, code,
links, history, sharing and customization. The source was re-cut around real
page capacity, and the book now carries an authored cover/ribbon treatment
rather than inheriting a generic rectangle.

**Notebook Script and media travel further.** The AI-format sheet can be copied
or downloaded as a Markdown file, with an honest warning that the full grammar
can exceed a chat paste limit. Images and videos share one insertion path;
drag/drop, paste, file choice and the block context menu all reach stored local
media without turning a page into a cloud upload.

**Reading and editing received the accumulated owner-test repair pass.** Blank
destination spreads are prepared before a turn, page turns use complete staged
snapshots, page links/backlinks/free marks survive capture, table and special
block structure is retained, page-local ribbons do not follow the reader to
another leaf, and arbitrary trailing blank pages remain reachable. Page-turn
audio is isolated from the busy Pixi/WebGL path and uses one measured clean
recording; the owner confirmed the static is gone. Confetti is now deliberately
silent, while its visual paper burst remains.

**The moving leaf no longer re-typesets itself when a turn begins.** Snapshot
capture carries the mounted page's exact inline widths, line breaks, list-row
advance and marker styling into the inert image. That keeps the Welcome
book's `Esc` keycap whole and its numbered steps visually unchanged. Cards,
callouts, diagrams and other custom blocks keep their page-relative origin;
top-level placement is applied after node-view geometry, fixing the reported
rightward jump. Snapshot freshness is keyed to the mounted page presentation,
so revisiting a side cannot briefly resurrect an older raster. The owner
confirmed all three visible defects are gone.

**Focus mode has one purpose-built left rail.** It replaces the large floating
corner panel and separate exit chip while retaining the existing Book, Pages,
One page, zoom, leaf and centre controls. Settings and Leave focus live in the
same rail, and the ordinary settings button is hidden while focused so there is
only one route to each action.

**Ambient sound now obeys the latest choice.** Rapid soundscape changes retire
superseded loops even when an older `play()` is still loading, and disabling
Play ambience stops every active or pending bed. A short 32ms de-click avoids
pops without letting cached switches accumulate overlapping rooms. Focused race
tests cover out-of-order starts, turning ambience off during load, rapid cached
selection and cleanup of already-overlapping voices.

**Confetti is silent and lighter.** A visual celebration never dispatches the
former party sound, while completion without a visual burst retains the quiet
checkbox cue. Rendering is limited to one replaceable 28-particle, 760ms burst,
caps its backing resolution at 1.25×, reuses pointer coordinates without a
layout read, and creates no canvas when reduced motion is requested.

**The old catch-all QA repository was retired.** Thousands of historical unit,
Playwright, waveform, baseline and one-off probe files had become a second
product whose results no longer matched owner acceptance. The everyday gate is
now TypeScript plus five high-signal parser/pagination/version smoke checks;
release and visual judgement remain deliberate activities rather than an
automatic claim that rendered pixels or sound are correct.

**The stationary leaf remains live DOM for the whole turn.** Only the moving
leaf transfers to WebGL. Mounted textures clone the exact rendered page rather
than rebuilding a second editor, and measured block/list boxes are frozen in
the inert capture. The open-book backing is two symmetric boards with the same
50% hinge as the page gutter, replacing a stretched closed-cover picture whose
decorative spine sat on a different axis.

The same pass restores both top panel-corner outlines, moves and explains the
two customization dice at the start of the book panel, moves the library's
Surprise Me action to the top, and carries a saved book appearance through a DB
re-read into an immediate shelf-spine rebake. A new library opens in brown
walnut with a columned Egg & Dart case, carved Gilt Damask and vivid rose app
chrome; plain corrupt-data fallbacks remain independent. Seed v12 gives only an
untouched Welcome book a solid square case, removes the outer ribbon and striped
endbands, and keeps one broad blue ribbon between the pages.

The full demo keeps the complete existing tour, reaches Card Room through the
real full picker, shows Lapis-blue then Garnet-red shelf-only colour, and
returns to the House Room for its loop. The owner accepted the rendered demo
and explicitly waived a second automated browser review for this final render.

## 0.4.0 — the previous build

**Reading a book no longer rewrites it.** Opening the Welcome book and turning
through it used to DUPLICATE its content — nothing typed, reading was enough.
Both leaves of a spread mount and drain inside one synchronous flush, but a
drain published its removal to the store on a microtask while it handed the
blocks up synchronously; so the left leaf's carry read the right page's
pre-drain document, put back blocks that page had already given away, and the
remount then drained the same tail a second time. Measured from the stored
documents: three blocks on two pages each and three twice on one page, now zero
and zero. A first fix took the same measurement to zero and **lost typed text**
— 22 lines typed past the foot of a page, 10 stored — and was thrown away. The
one that shipped was re-done with its regression probes written first and proved
to fail against the discarded attempt.

**And the tour stops growing when you open it.** Thirty-two leaves became
forty-six the first time anybody read them — pagination doing exactly its job on
pages that did not fit. The pages were written against a leaf holding 25.66
lines, measured in a 1600x1000 window; the app opens at 1280x800, where a leaf
holds 19.41 and the prose column narrows from 592px to 434px, so the same
sentences wrap half again as often. Both losses compound and every page cost
136% of the leaf it landed on.

Two things changed together. The budget is now DERIVED from the window rather
than written down beside one, off two facts measured at five sizes: the chrome
above and below a leaf is a constant 179px whatever the width, and the 32px rule
grid does not scale with the frame — which is what makes a small window
expensive rather than merely smaller. And the Welcome book was re-cut for the
window it opens in: the same thirty-two leaves on the same subjects, said in
fewer words, with the second card dropped from the pages that carried two. They
average 81% of the default leaf in the splitter (the dearest is 85%); measured
in the running app, the named leaves average 88% and the dearest reaches 97%.
They read as generously margined on a larger screen.

It is cut for the size the app OPENS at rather than the smallest it allows.
Cutting for the minimum would guarantee nothing ever reflowed at any window —
and would put the splitter's page ceiling at 52% of the leaf a new reader is actually
handed, which is the half-empty pages already complained about once. Shrink the
frame past the default and the tail flows onward, which is what the owner asked
for in the first place: *"just make it work like any other book — if it's too
big it goes to the next page."*

A footnote went with it. Notes sit on an absolutely-positioned rail at the foot
of a page, so they cannot push anything out of the way; the only thing keeping
prose off them is a padding the drain re-reads on every pass, and a page five
times taller than its paper defeats that. Nothing overprints now, at either
window size — checked with a probe that can be made to fail on demand, because a
check only ever seen passing is not evidence.

**A turn no longer goes blank halfway across.** 0.3.0's notes claimed this and
were written one commit too early — the fix was cut after that build was. The
curl used to start on the front face alone, reasoning in a comment that the
other two *"only matter once it is part-way over, by which time an idle capture
has usually landed"*. Usually is the problem: `revealed` is the page you are
turning TOWARDS and the largest thing on screen for most of the gesture, so when
its bitmap has not landed the shader samples nothing and the spread draws bare
paper for the rest of the turn. Both big faces are required now, and when the
answer is no the turn takes the rigid CSS fold, whose faces are the live leaves
— a plainer turn with the real words on it beats a blank one. No probe had ever
seen it because they all measure the DOM, and during a curl the leaves are
`visibility: hidden` with their text still in them: every leaf reads as inked
while the reader is looking at an empty canvas.

**And closing a book stopped showing a hole.** Eleven frames — three quarters of
a second — of the dock and the zoom pill floating on blank cream, every time.
`.shelf-root` painted nothing, so between the book view unmounting and the Pixi
world's first frame the page background was all there was. It is the wall colour
now, which reads as a room whose furniture has not arrived yet rather than as
nothing at all.

**The room stops tearing itself apart while it repaints.** Changing a design
used to blank the whole bookcase for half a second, repaint the case in two
halves — new shelf ledges over an old carcass — and drop every book to a flat
untextured slab. One cause underneath: every spine texture was destroyed
synchronously before a replacement existed, and a live sprite handed a dead
texture takes the whole stage down for a frame. Case parts now stage and commit
together (`caseSpreadMs` 97/77/20 → 0), and the shelf keeps its art until the
new art is ready.

**Back to the shelf returns to the room you left.** The shelf was unmounted for
the whole time a book was open, so pressing back did not return to a room, it
BUILT one — a fresh PixiJS application and a re-bake of everything. Three blank
frames and a 236ms window with no room at all, now none, with your camera and
zoom where you left them.

**Custom timber could serve you another room's woodwork.** The case bakes were
filed under a 32-bit hash. The sixty authored rooms never collide — but a
reader-typed timber colour is folded into the scheme, so the real input space is
millions wide. Sweeping 400,000 of them found six collision pairs: navy
`#0043a9` and teal `#006b82` share a tag, and whichever room asked second got
the other's plank, recess, post and cornice. The bakes are filed under the whole
room description now rather than a hash of it, so a colour you typed yourself
gets the woodwork you asked for.

**The body-size slider moves the page.** It said "reading type on every page"
and changed everything except the page, which was pinned at a hardcoded 20px.
Now the page follows it, the rule grid is derived from the type so the words
keep sitting on the lines at every size, and a full leaf holds 22 lines at 15px
against 16 at 21px.

**Smaller things, all of them found by looking at the app rather than at the
code**: a key cap no longer breaks across two lines into half-open pills; a
postcard no longer cuts its own last line; a finished diagram no longer reverts
to its loading placeholder as the page turns; the way back stays legible while a
panel is open; "opening the book…" no longer holds a bare window for a second
and a bit; and the first page of the Welcome book is ruled paper, which is what
its own first callout has always told you to click on.

**Arrow keys no longer turn pages, and this is a removal on purpose.** The
Welcome book's first page told you to click the ruled lines and start typing,
and then, four lines later, that arrow keys turn pages. Do the first and the
second stops being true: once the caret is in the page an arrow key moves the
caret, because an arrow key belongs to the text before it belongs to the book.
So the shortcut only worked in a state you were rarely in, and could not be
described in one honest line — which is exactly what its own page proved by
having to teach both.

Turning a page was never the arrow key's job anyway. **Click the outer edge of a
page to turn it, or drag it** — a strip down each outer edge, with the folded
corner drawn on every leaf, and both work whether or not you are in the middle
of a sentence. The table of contents and the thumbnail strip still open with a
key and still move you between pages.

**Two labels stopped lying.** The same clipboard was called *Copy the format for
your AI* in one place and *Copy spec for your AI* in another — it is the first
everywhere now, and "spec" was jargon the app used nowhere else a reader could
see it. And the parcel desk no longer offers to save your library as
`notebook-library.nbk`, a filename left over from two renames ago.

**Under it**: two Tauri permissions the app never used — clipboard and global
shortcut — are no longer requested. 469 MB of capture leftovers and refutation
scratch stopped being tracked, and 88 MB of dead scripts, dependencies and
reports were deleted outright — which takes a fresh checkout from 448 MB to
about 64. It does not shrink a clone: git still holds every old copy, and
rewriting the history of a public repository is a separate decision.

## 0.3.0 — the one before it

**Pages behave.** Three defects in the page-turn machinery turned out to be one
bug and two of its symptoms. A node view read `editor.view.dom` on a staged
editor — which THROWS while the view is being constructed — and a bare `catch`
swallowed it, so **every offscreen page capture had been failing silently**.
That is what drew a page you had never seen as blank white paper: the back of
the turning sheet and the page revealed under the curl both had no texture, and
a null texture draws bare paper. With the capture path working again, the
landing flicker went too — the rasteriser had been editing the two leaves you
were looking at, and now stages a copy off-screen instead.

**Two blank pages always stand ready** at the end of a book, and the spread is
completed as well — an odd page count used to leave the last spread with a page
on the left and bare cream on the right, which was the blank being complained
about. Bounded by the last page you actually wrote on, so repeated turns cannot
grow a book without end.

**Dragging works on Windows.** `dragDropEnabled` was never set in the Tauri
config, so it took the default of `true` — whose own documentation says
disabling it is *required* for HTML5 drag and drop on Windows. Every test
passed, because headless Chromium is not Tauri.

**Panels do not cost frames any more.** Two causes, both found by blaming a
profile on the nearest line in `src/` rather than on the native function it
bottoms out in. `fitSpread` resolved one custom property through
`getComputedStyle(document.documentElement)` on every frame of the panel slide —
227ms per open, because that recomputes every property on `<html>` first. And a
studio design change missed every cached preview tile at once and redrew them
all in one frame: 1337ms. Studio open is 215ms → 70ms, a design change 124ms →
0ms of blocked main thread.

**Writing.** Page style went from 4 rulings to 27, each with one stylesheet
definition read by both the paper and the panel thumbnail, so a thumbnail cannot
advertise something the page will not draw. The code block's language dropdown
is ours now — grouped, type-to-filter, full keyboard — instead of a native
`<select>` that ran off the page. Any selection can be set in any of the 27
handwriting faces, with a floor that keeps a hand legible. Settings has a search
box that reveals collapsed groups.

**Onboarding.** A "deep" answer to the taste questions used to darken the whole
interface; it dresses the ROOM now and leaves the app alone. The tour card
steps out of the way when a panel opens, and a moss dial under the task shows
how long a step will wait before advancing on its own — read from the same
constant the timer uses, rather than a second copy of the number.

**The Welcome book is longer and fuller** — 16 pages to 32, median leaf fill 51%
to 82% — and the release page you are reading now leads with the download table
instead of burying it under the changelog.

## 0.2.0 — the first one on the Releases page

The first build made for **Windows, macOS and Linux from a single tag** — one
release, three platforms, and a `SHA256SUMS.txt` line for every file in it.

**Installing it asks less of you.** The Windows setup now carries Microsoft's
WebView2 bootstrapper inside itself instead of fetching one, so an ordinary
install reaches for nothing; and there is a second file,
`Alcove_0.2.0_x64-setup-offline.exe`, carrying the entire runtime for a machine
with no internet at all. Either way it installs for the current user, so Windows
never asks for an administrator.

**The uninstaller tells you where your books are.** Before it asks anything, it
shows you the library folder and offers to open it — and it leaves that folder
alone unless you tick the box. An app whose uninstaller quietly takes your
library with it is unforgivable, so keeping them is the default.

**Both installers look like the app.** The same cream ground, the same ink, the
mark on the header and down the sidebar, rather than a grey wizard from 1998.

**One sheet for everything going in and out.** Four flows had been finished,
tested and left with no button anywhere — the PDF chooser, the page picture, the
Markdown import and the templates gallery. They have buttons now, and rather
than four more icons they joined the three script tools on one rail sheet,
**In and out**: paste a script · bring Markdown in · start from a template ·
export as PDF · this page as a picture · the parcel desk · copy the format for
your AI · copy this page as script. The rail is down from fourteen icons to ten,
every shortcut is the one it always was, and each row shows its own key cap.

**Books fit the bookcase they stand in.** A carpentry build now declares how
much headroom its opening leaves, and the clear height varies across a bay —
taller under an arch crown than at the pier. Before this, a tall book on an
arched case ran straight up through the arch head. A book that still will not
fit is trimmed to the opening, and the book studio says so rather than doing it
behind your back.

**Two smaller ones worth naming.** The taste questions on first launch actually
vary the room now — one answer had been collapsing every room to the same grey —
and the guided tour's *next* button, which was measuring 1.05:1 against its own
background, was fixed along with the whole class of control it belonged to.

**Hiding and starring reaches everything now.** Right-click any entry in any
picker to remove it, star it, or star it twice; removed entries stop being
offered *and* stop being rolled by the dice. It used to reach about half the
lists — the mechanism named thirty-three of them and only seventeen were
actually wired to it. Three of the thirty-three named no picker at all and were
dropped rather than given an invented one.

**Tape, washi, frames, scraps and doodles go anywhere on the page.** Free
placement had only ever worked for stickers; the other <!--f:placeableValues-->205<!--/f-->
pieces of trim were stuck to whichever block your caret happened to be in. Drag
them where you like, stretch, tilt, and they stay put when the text around them
reflows — they belong to the page, not to the paragraph.

**And a handful of things that were quietly drawing nothing.** One of the fifty
frames had never painted a pixel in its life; three of the fifty tapes painted
nothing when placed freely; and the dashed outline that marks an entry you have
removed but are still wearing was being overwritten before it reached the
screen. Importing a transfer bundle that carried pictures kept none of them —
the command that writes them had never been registered, and the failure looked
exactly like a corrupt file. A single paragraph longer than the page could
overflow it rather than flowing onto the next, which is the one thing the
pagination contract does not allow.

### Known edges in this release

- **Nothing is signed on any platform.** Windows shows a SmartScreen warning the
  first time; macOS quarantines the first launch, so the first open is
  right-click → *Open*. The release carries a `SHA256SUMS.txt` for exactly this
  reason.
- **No CI badge.** The only workflow fires on a version tag, so nothing runs
  `tsc` or `vitest` on an ordinary push yet. The gates run locally, and again at
  the tag.

## 0.1.0 — the shape of the app

Cut and never published: 0.2.0 is the first build on the Releases page, and all
of this is in it. It keeps an entry of its own because it is far more of what
Alcove *is* than any single release note — the shelf, the editor, the script
language, the two studios, the backups and the transfer bundles were finished
and in daily use before the version number moved at all.

**The room.** A WebGL bookshelf you pan and zoom through, with as many bookcases
as you care to build. Books drag out of the shelf, move between cases, and carry
their own binding wherever they go. The customisation is the point of the
release: <!--f:roomPresets-->69<!--/f--> named rooms,
<!--f:shelfPresets-->113<!--/f--> bookcase carpentries,
<!--f:wallpaperPapers-->126<!--/f--> wallpapers and
<!--f:bookPresets-->189<!--/f--> bindings, plus
<!--f:roomThemes-->60<!--/f--> colour schemes on their own — and every long list
takes a hex code of your own, stars what you like and hides what you do not.

**The pages.** A block editor with <!--f:slashCommands-->110<!--/f--> slash
commands, <!--f:stickers-->50<!--/f--> stickers and
<!--f:effectAxes-->11<!--/f--> axes of block decoration carrying
<!--f:effectValues-->472<!--/f--> values. Pages are fixed leaves that never
scroll: fill one and the trailing blocks flow onto the next, carrying your caret
with them. The turn is a real page turn — live DOM at rest, a WebGL cylinder
curl during the gesture.

**Notebook Script.** A Markdown dialect small enough that a chatbot writes it
correctly first time, with <!--f:scriptContainers-->24<!--/f--> containers and
<!--f:scriptDiagrams-->5<!--/f--> kinds of drawn diagram. *Copy the format for
your AI* puts the whole generated grammar on your clipboard; *paste a script in*
previews what it recognised before it lands.

**The quiet infrastructure.** Full-text search and a `Ctrl+K` switcher across
every bookcase, scheduled ZIP backups, `.nbk` bundles that import additively
with a restore point, Markdown in and out, PDF and PNG export, tray quick
capture, and <!--f:soundSets-->28<!--/f--> sound sets over
<!--f:ambienceBeds-->10<!--/f--> ambience beds.
<!--f:settingsOptions-->42<!--/f--> settings and
<!--f:rebindableKeys-->24<!--/f--> rebindable shortcuts.

Its known edges were the two listed above, and both are still open.
