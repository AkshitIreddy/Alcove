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
[GitHub Release](https://github.com/AkshitIreddy/alcove/releases) it is attached
to — those notes are generated at the tag by
[`scripts/release-notes.mjs`](../../scripts/release-notes.mjs), which diffs
against the previous one. This page is the human summary beside it.

Every number below is read out of the module that defines it and wrapped in a
marker `npx vitest run` recomputes, exactly as on the other three pages.

## 0.3.0 — the current build

**Pages behave.** Three defects in the page-turn machinery turned out to be one
bug and two of its symptoms. A node view read `editor.view.dom` on a staged
editor — which THROWS while the view is being constructed — and a bare `catch`
swallowed it, so **every offscreen page capture had been failing silently**.
That is what drew a page you had never seen as blank white paper: the back of
the turning sheet and the page revealed under the curl both had no texture, and
a null texture draws bare paper. With the capture path working again, the
landing flicker went too — the rasteriser had been editing the two leaves you
were looking at, and now stages a copy off-screen instead. And a turn that finds
no bitmap falls back to the rigid fold, whose front face is the live leaf, so
there is no way left to land on a blank sheet.

**Two blank pages always stand ready** at the end of a book, and the spread is
completed as well — an odd page count used to leave the last spread with a page
on the left and bare cream on the right, which was the blank being complained
about. Bounded by the last page you actually wrote on, so a held arrow key
cannot grow a book without end.

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

## 0.2.0 — the published build

The version on the download button, and the first one built for **Windows, macOS
and Linux from a single tag** — one release, three platforms, and a
`SHA256SUMS.txt` line for every file in it.

**Installing it asks less of you.** The Windows setup now carries Microsoft's
WebView2 bootstrapper inside itself instead of fetching one, so an ordinary
install reaches for nothing; and there is a second file,
`Alcove_0.2.0_x64-setup-offline.exe`, carrying the entire runtime for a machine
with no internet at all. Either way it installs for the current user, so Windows
never asks for an administrator.

**The uninstaller tells you where your books are.** Before it asks anything, it
shows you the library folder and offers to open it — and it leaves that folder
alone unless you tick the box. A notes app whose uninstaller quietly takes the
notes with it is unforgivable, so keeping them is the default.

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
<!--f:settingsOptions-->40<!--/f--> settings and
<!--f:rebindableKeys-->24<!--/f--> rebindable shortcuts.

Its known edges were the two listed above, and both are still open.
