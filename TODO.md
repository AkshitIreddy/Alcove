# Alcove — running TODO

## 🔴 Reported 2026-08-05 — toward 0.3, WORK THIS LIST SEQUENTIALLY

The reader asked for these one at a time rather than fanned out: *"this time I
think maybe we should do stuff sequentially instead of parallel so don't use
workflows and work through them one by one"*. Their words are quoted verbatim
under each item (grammar tidied, nothing else), then the task as understood.

### Sound

- [x] **Static during onboarding — a rendering bug, not the recordings.**
      > "During onboarding, for example when I move through each one, sometimes
      > there is a sound effect bug of static. The static sound comes when it
      > auto-moves as well, sometimes — so it's not consistent. It's a sound
      > rendering bug, not a sound source quality problem."
      > "The static sound bug also happens when I am selecting a sound profile
      > during onboarding: when you select a profile it plays sounds in rapid
      > succession, which causes some of them to sound like static."

      NOT the recordings: `scripts/audit-sounds.mjs` measured all 66 and none
      clips, none carries DC, none starts or ends mid-waveform, every ambient
      loop seam is exactly 0. And the reader was explicit that this is a
      rendering fault, not cues mushing together.

      **Four explanations measured and KILLED** (`scripts/probe-sound-clip.mjs`,
      which taps Howler's master in the running app). Written down so nobody
      spends the afternoon on them twice:

      1. *Summing past full scale.* Six auditions stacked reach peak **0.18**.
         Nowhere near clipping.
      2. *A wash of overlapping noise cues.* Spectral flatness at the master
         stays **0.02–0.03** under the same stacking. Not broadband noise.
      3. *The bus being torn down mid-render.* `applyBusFilter` does
         `master.disconnect()` and rebuilds when the set changes — which is
         exactly when the reader hears it. Rewritten to re-tune a chain wired
         once, then A/B'd with a ScriptProcessor tap recording EVERY rendered
         block: **0 dropouts on the old code as well as the new**. Web Audio
         applies graph edits atomically at a render-quantum boundary, so the gap
         never reaches the audio thread. The change was REVERTED rather than
         shipped as a fix it is not.
      4. *Howler stealing a voice when its pool is exhausted.* `_drain()` only
         recycles ENDED sounds; a busy Howl allocates a new one.

      Also ruled out by reading: the group volume/rate pre-set is deliberate and
      already measured (`presetLevel`'s docblock records a 7% correction it was
      written to avoid).

      **The structural limit on all of the above**, and the reason the next
      attempt should not be another headless probe: headless Chromium has no
      audio device. Anything that manifests at the device boundary — a missed
      callback deadline, a resample to the device rate, a WASAPI glitch — cannot
      occur there at all. The reader hears it in WebView2 on real hardware.

      **Leading remaining explanation:** main-thread stalls starving the audio
      callback. It fits every detail — intermittent ("not consistent"), on step
      advance whether manual or automatic, and while a picker re-renders. It is
      also the same suspect as the FPS-drop item below, which the reader
      reported independently. Do that one first and re-test this.

### First impression


      NOT REPRODUCED, and now demonstrably not the app's rendering. An AudioWorklet recorder behind masterGain plus 39 isolated plays re-rendered offline through the same buffers, rates, gains and biquads: recorded-peak / reference-peak = 1.000 on every one, HF energy differing by at most 0.25% of burst energy. The bus rewire was re-tested under a SOUNDING ambient bed (the gap in the earlier A/B) — disconnect and connect land at the same `ctx.currentTime`, longest run of zeros 0. Whatever is heard is downstream of the graph, at the device, and that boundary does not exist headlessly (`outputLatency === 0`, no `renderCapacity`). One real defect found and fixed on the way: every sound-chip press fired TWO click cues ~0ms apart, because `previewSoundSet()` opens with a click and `uiClicks.ts` could not see it. STILL OPEN as a report: re-test on the installed 0.3 build.
- [x] **The app chose a dark theme without asking.**
      > "For some reason the app chose dark theme for UI without letting me
      > choose. It should default to normal theme — don't take from the user's
      > system settings, if that's what you are doing. Basically I don't want a
      > situation where the user has chosen their themes and it's pretty light,
      > or light with some dark, and then all of a sudden the UI colour themes
      > become dark. Personally I would say night theme should not even be an
      > option during onboarding, but available in settings."

      Stop reading `prefers-color-scheme`. Default to the light/normal theme.
      Take night out of the onboarding choices; it stays in Settings.

### The tutorial


      `resolveInterface` answered a "deep" pitch with `uiTheme = 'night'`. Deep is about the ROOM; the interface no longer follows it. Gated by sweeping every combination of all five questions.
- [x] **Step 10 does not allow dragging — and dragging is broken outside the
      tutorial too.**
      > "Step 10 does not allow dragging stuff. In fact dragging does not work
      > even outside the tutorial."

      The second half is the real bug; the step is just where it was noticed.

      **Not reproducible on the dev server**, and that is worth writing down
      before anyone changes drag code on a hunch. `scripts/probe-drag.mjs`
      hovers a paragraph, finds the handle (visible, 24x28, `pointer-events:
      auto`, `draggable="true"`), and drags it — the paragraph MOVES, by both a
      synthetic mouse drag and a real HTML5 one.

      That probe also records a trap worth keeping: Playwright's
      `mouse.down/move/up` never makes Chromium synthesise a `dragstart`, so a
      hand-rolled drag reports "nothing moved" against an app that works. It
      runs both paths for exactly that reason.

      So the difference is the reader's environment, not the gesture. Two
      candidates, in order: (a) the ~150-300ms main-thread stalls measured under
      the FPS item — a stall mid-gesture drops the pointer stream and the drag
      dies, which would also explain why they met it at step 10, where a panel
      is open; (b) WebView2 on real hardware rather than headless Chromium.
      Re-test on the installed 0.3 build before touching the drag code.


      FIXED, and it explains why every test passed. `tauri.conf.json` never set `dragDropEnabled`, so it took Tauri's default of `true` — whose own doc comment says "Disabling it is required to use HTML5 drag and drop on the frontend on Windows". wry then calls `SetAllowExternalDrop(false)` and takes the page's drop-side events. Works in headless Chromium (no Tauri), fails in the installed build.
- [x] **Step 18 does not move the tutorial card when the panel opens.**
      > "Step 18 doesn't move the UI tutorial window when the user opens the In
      > and Out window. Also we should let the user be able to move the step
      > windows by clicking and dragging."


      The card clears the panel lane and the arrow stands down rather than crossing the sheet. Every step checked, not only 18 — two others were anchored to a rail button the sheet lands on.
- [x] **Say that a step advances on its own.**
      > "We should tell the user that the steps move on their own by using the
      > UI. So let's say they do something correct — then a green timer circle
      > or something in that window. Or again, anything else you think of that
      > would be good in a UI sense, to let the user know it will auto-move to
      > the next step a certain amount of time after they've completed the step."

### Pages and the editor


      A moss dial under the task box drains over exactly the beat the timer waits, read from the same constant rather than a second copy of the number.
- [x] **The page turn flickers the effects in a beat late.** DIAGNOSED, not yet
      fixed — the cause is certain and the repair is a separate, careful job.
      > "When turning pages, after the page turn and we go to the next page,
      > there is a flicker for a second where it then puts all the processing
      > effects we have on it — for example the shadow effect in the middle and
      > so on. It either needs to be there from the start as soon as the page
      > turn begins, or needs to be really, really fast."

      **THE CAUSE.** `PageRasterCache.capture()` rasterises a page by writing to
      it: `element.classList.add(SNAPSHOTTING_CLASS)` then `inlineSvgStyles`,
      restored after an await that is 200ms+ of work. For a MOUNTED page that
      element is the leaf the reader is looking at.

      Measured with `scripts/probe-landing-flicker.mjs`, sampling the DOM every
      animation frame across a real curl:

          leafHidden     75ms -> 1     677ms -> 0      the turn is over at 677ms
          snapOnVisible 952ms -> 1   1136ms -> 2   1206ms -> 0

      and the elements named: `nb-sheet-paper.nb-leaf-paper` at (135,75) and
      (784,75), 649x833 — the two visible leaves. The reader's page is edited
      underneath them for ~250ms, about a second after the turn.

      **A METHOD BUG THAT HID THIS FROM EVERY EARLIER PROBE.** Headless Chromium
      reports `prefers-reduced-motion: reduce`, so `programmaticFlip` takes
      `crossfadeNavigate` and never curls at all. Probes here have been
      measuring a code path the reader never takes. Force
      `page.emulateMedia({ reducedMotion: 'no-preference' })`.

      **THE REPAIR, and why it is not done yet.** `src/flip/offscreenPages.ts`
      already rasterises pages through a read-only editor parked at
      left:-12000px, with the same sheet classes and recipe, because the
      adjacent spread is never mounted. Routing mounted pages through it means
      the visible page is never touched.

      Tried, and REVERTED: making `capture()` prefer `captureUnmounted()` before
      the mounted branch. It changed nothing — `snapOnVisible` still fired,
      `snapOffscreen` never did, and no warning was logged, so
      `captureOffscreen` is returning null silently for a page that IS mounted
      rather than failing. Find out why (start at `createOffscreenPageCapture`'s
      `pageSize()` and `loadPageDoc`) before trying again. An inert change that
      also costs a wasted offscreen attempt per capture is worse than none.

- [x] **A page never seen before turns up blank white.**
      > "There is a bug in the welcome book: let's say I am turning to a page I
      > haven't seen before, then it shows as a blank white page. But after
      > turning it, and then going back and turning to that page again, the
      > content is there as usual during the page turn."

      The raster cache has nothing for a page that has never been mounted, and
      the flip shows the empty snapshot rather than waiting or falling back.


      FIXED. `freeMark.tsx` read `props.editor.view.dom`, which THROWS when the view is not assigned yet — and node views are constructed during the EditorView constructor. The throw took down `withOffscreenPage` and a bare `catch { return null }` swallowed it, so EVERY offscreen capture failed. Offscreen capture is what rasterises the back of the turning sheet and the page revealed beneath the curl; both were textureless on every turn and a null texture draws bare paper. Measured through a new `__flipCache` bridge: back/revealed false on every turn before, true after.
- [x] **Always keep two blank pages ahead.**
      > "Always auto-create the next 2 pages when the user is on the last page,
      > so the user never sees a blank page."


      Two REAL pages stand ready, and the spread is completed as well — an odd page count left the last spread with a page on the left and bare cream on the right, which was the blank being complained about. Bounded by the last page actually written on, so a held arrow key cannot grow the book without end.
- [x] **Page style offers four options; it should offer at least twenty.**
      > "In the sidebar, when inside the app, page style only shows four
      > options: ruled lines, grid squares, blank paper, dot grid. At least 20
      > here."


      4 -> 27 rulings in `src/editor/rulings.ts`, with ONE stylesheet definition per ruling read by both the page and the panel thumbnail, so a thumbnail cannot advertise something the paper will not draw.
- [x] **Handwriting by default, and a way to change the face of a selection.**
      > "I want the default text style in the notebook when I write to be like
      > handwriting. Also I don't see an option, when in the notebook, to change
      > the text font style — for example I might want different pieces of text
      > to have different font styles. So fix that."


      The default already WAS a hand — verified in the running app (`--font-body` = Patrick Hand at 20px, reaching every block, nothing under 13px), so nothing was changed there. The per-selection face is new: a TipTap mark storing a hand ID from the 27-face table, a floor of max(13, spec.floorPx), a toolbar tray whose chips are drawn in the faces they name, and a block-menu submenu.
- [x] **The code block's language dropdown is not our UI and runs off the page.**
      > "I noticed for code blocks the dropdown isn't in our app UI, and it also
      > goes all the way down to the bottom."

### The welcome book


      Replaced with an in-app listbox in the slash menu's register: grouped shelves, type-to-filter, full keyboard, focus returned to the trigger, height capped from the room floating-ui reports. Proven flipping above the tab when a block sits low.
- [x] **Half-empty pages, and it should be much longer.**
      > "I noticed a lot of pages in the welcome book have empty space at the
      > second half, because you didn't fill anything in it. You should put
      > something in it — more examples or something."
      > "I think you can make the welcome book much longer and detailed, so the
      > user can see many examples."

### Settings


      16 pages to 32; median leaf fill 51% -> 82%, worst page 36% -> 71%. The estimator behind it was then recalibrated from containers measured in the running app.
- [x] **A search box in Settings.**
      > "Settings should have a search bar for the user to search things in it."

### Performance


      Matches label, hint, keycap and a `words` list of what a reader would type; reveals collapsed groups; says so when nothing matches; Escape clears before closing.
- [ ] **Opening a panel drops the frame rate hard.**
      > "Checking with the FPS overlay I noticed that sometimes if the user, for
      > example, clicks on the sidebar options to open a panel, there is a huge
      > FPS drop before it gets restored again back to 240 FPS. Similarly it may
      > be happening for the studio. We need to make sure FPS drops never
      > happen."

### The README and the release page

- [ ] **The pictures and the words around them need updating.**
      > "The readme — you will now have to update the pictures and explanation
      > maybe."

- [ ] **Part 1 should be pictures with explanation, not a wall of text.**
      > "I kind of want it to have more of a picture-and-explanation vibe for
      > most of part 1. We already do this, but there is a substantial amount of
      > text between the 2nd and 3rd occurrence of pictures — you know, the
      > parts index, downloads, etc. So maybe add pictures, or reduce text, or
      > actually do both. We want part 1 to have as many pictures as possible,
      > to not intimidate users."

- [ ] **Put the what-is-what table at the TOP of the release notes.**
      > "In the releases page, the table of what is what should be at top, and
      > then under it what's new — otherwise that table gets buried in the 'read
      > more' of the GitHub UI."

- [ ] **Make the release document look like the app.**
      > "See if you can spruce up the text and UI in that release document to
      > better align with our app."

### The demo

- [ ] **A looping GIF demo, built with the reader's own `gifsmith`.**
      > "Use the gifsmith package — I made it — to create a GIF demo of the app.
      > You may start with showing the bookshelf (pick a fancy, grand-looking
      > preset for wallpaper, books and shelves, and fill up the shelf with some
      > books for this demo), click on studio to show that it has so many
      > options in different areas of customisation — in fact try clicking many
      > different categories to show how it customises in real time, to show how
      > you can change it drastically — then close it and open the welcome book,
      > turn through the pages to show them one by one, occasionally opening a
      > panel in between so that you open all panels, and then finally once you
      > reach all the pages go back by pressing the back button and end, so it
      > will look like it goes to the shelf but it is the beginning of the GIF
      > (as how GIFs usually work), so it becomes forward-looping."
      > "If at any point you feel gifsmith doesn't have what you need, or
      > something in it needs to be changed, I have the repo here — make your
      > changes and push with a version tag and it will auto-publish on the npm
      > page with the new package."

      `C:\Users\akshi\Desktop\Code Palace\gifsmith` ·
      https://www.npmjs.com/package/gifsmith

### Shipping 0.3

- [ ] **Make the repo public, then release 0.3.**
      > "After all this you can make the repo public, then do a new release that
      > encompasses all these changes as 0.3."

- [ ] **Uninstall the app and remove its data — and stop installing it.**
      > "Delete the app you installed for me, with app data of it now. I will go
      > through the experience myself from GitHub. No need for you to install
      > the app for me any more either."

## 🔴 Reported 2026-08-04 (third pass) — toward the 0.2 release

### Packaging and release

- [x] **Ship 0.2, and let CI build every platform from now on.**
      Released at `v0.2.0`: seven artefacts and a `SHA256SUMS.txt`, built from
      one tag on three runners. Windows `-setup.exe` 16,936,253 and the
      `-setup-offline.exe` carrying the whole WebView2 runtime at 227,633,407;
      an `.msi` beside them; a universal `.dmg`; `.deb`, `.rpm` and AppImage.

      It took three tags to get right, and every failure was real:
      1. the shot-source digest was computed over raw bytes, so Windows and
         Linux could never agree — and recapturing re-recorded the wrong one,
         which made it unclearable;
      2. `gen-spec.mjs --check` compared generated LF against a CRLF checkout,
         so the Linux gates job passed the same check the Windows build failed.
         Both were the same cause wearing different faces, and the repo had no
         `.gitattributes` at all — it does now;
      3. the release published ONE asset of six with every job green.
         `upload-artifact` roots an artefact at the least common ancestor of
         its paths, so macOS arrived flat and Windows and Linux arrived as
         directories; `sha256sum *` hashed the one file and `files:
         artefacts/*` uploaded it. `fail_on_unmatched_files` could not see it:
         the glob matched something, just not everything. The publish job now
         flattens and REFUSES to publish unless one artefact matches each of
         the six platform patterns the README's download table promises.

- [x] **WebView2: measure it, and consider bundling.**
      > "i noticed that the pc needs to have microsoft edge web view2 runtime,
      > like check the size with it included and maybe add it if not that big
      > or add another version with it included"

      Tauri offers several `webviewInstallMode`s. Measure the installer with
      each and decide on the numbers — and if the bundled one is heavy, ship
      both and say which is which.

      WebView2 measured byte-exactly (bootstrapper 1,695,448 B embedded; offline +202 MiB, ~850 MB once installed). `embedBootstrapper` kept and pinned by `tests/packaging.test.ts`; numbers and reasoning in `docs/packaging-windows.md`.

- [x] **The uninstaller should offer to remove the library, and say where it is.**
      > "make the uninstall exe has an option to also to delete the all app
      > data and show the user where that app data is in case they want to
      > transfer for it as where"

      Default to KEEPING it — a notes app that eats your notes on uninstall is
      unforgivable. Show the path either way so it can be backed up or moved.

      `UninstPage custom un.AlcoveLibraryPage` in `src-tauri/installer/alcove.nsh` — an nsDialogs checkbox, an open-the-folder button, deletion in `NSIS_HOOK_POSTUNINSTALL`. The default KEEPS the library, proved by a silent `/S` uninstall on this machine leaving `%APPDATA%\com.alcove.app` intact.

- [x] **The installer should look like the app.**
      > "most install and unistall exe look boring make sure ours looks
      > interesting, pretty like our app"

      Header and sidebar drawn from the mark by `build_installer_art()`, with `MUI_BGCOLOR` set to the same cream the bitmaps are grounded on so the art sits in the window rather than on it. Judged by opening the two BMPs, which costs no window.

### The README, as a document

- [x] **Make it pretty, and restructure the wording.**
      > "the on this page section could perhaps be better with a bullet list or
      > something, so i would like if you also spruced up the way the readme is
      > presented to make it look pretty"
      > "make restrucue the wording to make it more understable, maybe bullet
      > points or some emoji(used sparingly or not at all, dont want to make it
      > look like a cookie cutter project)"

      Contents is a bullet list per half with a sentence beside each link; exactly two emoji survive a scan of all four pages and both carry meaning.

- [x] **Developer and technical detail belongs at the BOTTOM, not the top.**
      > "i noticed in general too many warnings and technical info at the
      > start, so i want that kind of info at the bottom for developers, for
      > normal users you can you know keep it only realted to the product, how
      > to get it, how to use it and so on… my criticism is only for stuff like
      > say the two things touch the network, or the libary is one local sqlite
      > file, like that i mean"

      Anything about USING the product stays up top. Implementation facts move
      down.

      Implementation facts moved to Part 2 — the SQLite sentence, the two outbound calls, the telemetry literal, the urlGuard mirror. Part 2 now opens with 'Nothing below this line is needed to use Alcove'.

- [x] **Say clearly that there are two halves — one for readers, one for
      developers or an AI helping them.**
      > "make more of a emphasis that the readme has two sections one for users
      > and one developers or other AI to read to help them contribute"

      The two-halves callout is two labelled entries with jump links, plus an explicit line pointing an AI agent at Part 2 and CLAUDE.md.

- [x] **The platform line says Windows 10 and 11 only.** Change it once CI
      builds mac and Linux.
      > "i noticed at top platofrms says window 10 and 11 only, change it as well"

      The badge reads `Windows · macOS · Linux`, composed in `renderBadges()`, and the download table has a row per platform.

- [x] **Release notes should not open the document — link to them.**
      > "the release notes should not be at the start maybe you can link to it
      > instead"

      `docs/readme/releases.md`, registered in `SIDE_PAGES` so its links are checked, linked twice and inlined nowhere. Now carries a 0.2.0 section.

- [x] **Drop "the first ten minutes".**
      > "probably not need since it is a big blob of text when below there is a
      > nicer picture based explanation, we can probably push to that instead"

      Gone — `grep 'first ten minutes'` finds nothing outside the generator's own docblock example.

- [x] **The top should say more about the AI side.**
      > "i noticed the above of readme doesnt mention the ai part that much but
      > i think it should"

      A third lead paragraph names Notebook Script, *copy the format for your AI* and *paste a script in*; the AI bullet is second in 'What's in the box'; the banner carries a *paste from any AI* chip.

- [x] **The README check should REPORT gaps, not gate them.**
      > "i know how the readme like to change to change as code changes but i
      > would like if it instead basically after running that check basically
      > tells the if sopmething is missing, if it is then it is later added by
      > dev or you the ai, basically the check exists to say that hey something
      > is missing from readme, but final editing of readme is left in the hands
      > of the dev/ai, i dont know if it works like that already"

      Find out whether it already behaves this way. The counted markers do
      recompute; the question is whether a mismatch REPORTS or BLOCKS.

      It already REPORTED, which is what the item asked to find out: `check-readme.mjs` exits 0 without `--strict`, and `checkCoverage()` prints completeness separately under 'in the repo, not on the page'. Drift stays a hard gate; completeness reports.

- [x] **Remove the "no button" warning once import/export have buttons.**
      > "add option for user to import markdown, explort pdf or png so you can
      > remove the warning"

      These were plugged in already — verify, then delete the caveat.

      The three rows are real buttons in `SharePanel.tsx` — *Bring Markdown in*, *Export as PDF*, *This page as a picture* — and the caveat was already deleted.

### The app

- [x] **One sidebar panel for insert / AI spec / export.**
      > "maybe condense insert, copy AI spec, export things into a single
      > setting in side bar, with the above options as well in its panel below"

      `SharePanel.tsx`: one 'In and out' sheet in three groups — insert, markdown, templates, PDF, PNG, parcel, spec, script.

- [x] **Code blocks that are actually for code.**
      > "our notebook should also support being able to hold code of different
      > langauges with inbuilt indenting, colours for the code and what not
      > needed for displaying programming code, and customising how it looks in
      > settings"

      Syntax highlighting across languages, sane indenting, and a look the
      reader can change — in the app's own flat language, not a stock IDE theme.

      `codeLanguages.ts` (one list, shared by parser and highlighter), `codeHighlight.ts`, `codeIndent.ts`, `codeBlock.tsx`, `codeAppearance.ts`, and a settings panel.


## 🔴 Reported 2026-08-04 (second pass, from the installed build)

- [x] **Let the reader pick their colour directly in onboarding.**
      > "also let user then choose colour theme with more options so that
      > picking their fav is possible directly in onboarding then"

      The four "how much colour" buckets are a steer, not a choice. Replace or
      follow them with a real palette pick — enough of the 60 rooms shown as
      drawn cards that a reader can find the one they actually want, rather
      than describing it and hoping. Keep the steer for anyone who does not
      want to browse.
      Context: this came out of finding that `deep` collapsed every room to the
      same grey (see below), which is the symptom of asking about a taste
      rather than offering the thing.

      Shipped in 3545897 and never reconciled here. Question three is a real palette pick over drawn `drawRoomCard` cards, the steer preselects rather than decides, and a pick short-circuits `resolveRoom`. A grid-collapse defect was found and fixed on top of it.

- [x] **The `deep` colour answer flattened every room to one grey.**
      Found by building `shots-now/taste-matrix.mjs` — the room answer against
      the colour answer as a grid. `PITCH_THEME_TAGS.deep` was `['dark']`, one
      word, so all ten dark palettes tied and the tiebreak picked Ebonised
      every time. The question promises "Ink, forest, claret" and the palette
      HAS them; what separates the rich darks from the grey ones is that they
      carry `grand` while Ebonised and Fumed carry `quiet`/`muted`. Now
      `['dark', 'grand']`, which moves two of the four rooms off grey. The
      remaining two are better answered by the direct pick above.

- [x] **The README's screenshots are stale — old name, old icon.**
      > "picture in readme uses old name and pic, also some of the other
      > pictures in it are outdated"

      Recapture every shot in `docs/readme/img/` from the current build, and
      add a check so a stale one is caught rather than noticed by a reader.

      All thirteen recaptured in one pass. Two defects fixed on the way: the dev-only `shelf | book` pill was in every shot (`?dev=0` is now passed, pinned by a test), and a NodeSelection on the far leaf could not be cleared because there is one editor per page.

- [x] **Put the content IN the README rather than behind links.**
      > "also change the readme to instead of links have most info here in
      > readme itself"

      `scripts/gen-readme.mjs` already composes the root file from the two
      halves; the job is making the root file the substantive document rather
      than a signpost.

      1269 of README.md's 1545 lines are lifted from the halves; 'Deeper reading' lists only what the front page does not already carry.

- [x] **Write the README as a shipped product.**
      > "also write the readme like install exe and published version is there"

      Download links, a version badge, release notes — written as though the
      installer is published, because it is about to be.

      The download table names real 0.2.0 artefacts, the version badge is composed from `package.json`, and the 'no tag has ever been pushed' hedge is gone.

- [x] **Mac and Linux builds in CI.**
      > "make it have mac and Linux builds available when we use git workflows"

      A GitHub Actions workflow building the Tauri bundle on all three
      platforms and attaching the artefacts to a release. Note `icon.icns` is
      currently generated by the Tauri CLI and is stale; a macOS build needs it
      regenerated from the current mark.

      `.github/workflows/release.yml` builds windows-x64, a universal macOS `.dmg` and Linux `.deb`/`.rpm`/AppImage from one tag.

- [x] **Extensive review, cleaning, optimisation and continuous visual testing.**
      > "at the end do a extensive code review, cleaning, optimising, visual
      > continuous testing, etc to make sure the app is perfect and ready"

      Five lenses, each adversarially verified.

      **Dead code.** The find that mattered was not dead code at all:
      `transfer::bundle_write_asset` was declared `#[tauri::command]` and never
      registered, so importing a bundle carrying pictures kept none of them and
      logged a per-file warning indistinguishable from a corrupt file.
      `cargo check` had said so all along — a command's only caller is
      `generate_handler!`, so an unregistered one reads as `never used`.
      `tests/ipc-surface.test.ts` holds the seam from both directions now. Two
      Vite scaffold SVGs that had shipped in every installer, deleted.

      **Duplication.** Sixteen facts written down twice, collapsed to one
      definition each — the flip snapshot recipe, the timeline metrics, the
      highlight labels, `PAGE_STYLES`, the ribbon hexes, the script effect
      domains.

      **First paint.** ShelfStudio and SettingsPanel lazy behind latches,
      stickers loaded after render, the ambient bed coalescing every boot-time
      ask into one idle start. Measured rather than guessed, and the measuring
      tools kept (`shots-now/_ab-boot.mjs`, `_weigh.mjs`, `_importgraph.mjs`).
      Recorded and NOT acted on: pixi.js is 746 kB, 43% of the boot chunk,
      including DDS/KTX2 parsers and workers nothing uses.

      **Correctness.** A page could hold a block taller than itself — the drain
      peels TRAILING blocks and was gated on `doc.childCount > 1`, so one long
      paragraph had nothing to peel and it gave up. It splits at a soft-wrap
      boundary now. It was also comparing `getBoundingClientRect` distances
      against layout px, so the fold sat wrong whenever a rail panel was open.

      **Visual regression, which is the "runs repeatedly" half.**
      `npm run visual` — 16 surfaces x 2 sizes x light/dark against committed
      baselines, `--update` the deliberate yes, a report page of triptychs. A
      comparison run no longer writes a baseline (it used to, and a suite that
      accepts its own output agrees with the app by construction), and a
      surface that never settles is a THIRD outcome: not baselined, not failed,
      counted in its own column. See the open item below for what still moves.

- [ ] **Six visual surfaces never stop moving.** `npm run visual` reports them
      `MOVE` rather than judging them, so they are honestly uncovered rather
      than noisily red: both `tour-blocks`, `tour-settings`, `focus-spread`.
      The set VARIES between runs, so it is intermittent. Not CSS — the fixture
      sets `animationLevel: 'off'`, Playwright adds `animations: 'disabled'`,
      and `document.getAnimations()` is empty at rest — so it is canvas or
      WebGL. Find it and those six surfaces become testable.


## 🔴 Reported 2026-08-04, from the INSTALLED build — WORK THIS LIST

The reader's words are quoted verbatim under each item, then the task as I
understand it. Where I think the report and the fix differ, that is said out
loud rather than quietly reinterpreted.

### Packaging

- [x] **No icon in the Start menu.**
      > "the app does not have icon in start menu, probably the same bug for
      > installer"
      Root cause found and it was not the shortcut: NSIS creates it with
      NO IconLocation at all, so the shell falls back to the target
      exe's icon group. The real fault was Pillow's ICO encoder writing
      a container Windows reads but no Windows tool would write.
      gen-icons.py writes and validates the container itself now, and
      docs/packaging-icons.md records the rules.  `9903564`

      The shortcut exists at `%APPDATA%\…\Start Menu\Programs\Alcove.lnk` and
      shows no icon. Their guess is worth taking seriously — the `.ico` is the
      same file the NSIS installer uses, so one malformed multi-frame icon
      would explain both. Check the frames actually present in
      `src-tauri/icons/icon.ico`, that the shortcut points at an icon index the
      file has, and that Windows' icon cache is not just stale (test on a fresh
      shortcut, not by rebuilding the cache).

- [ ] **Pin to Start.** Windows blocks the scripted verb
      (`E_ACCESSDENIED`) and the UI attempt needs an access grant that was
      denied while the reader was away. Retry through the real right-click menu
      when they are at the machine. Do NOT use the `ConfigureStartPins` policy:
      it needs admin and REPLACES their whole pinned layout.

### The icon itself — do this WITH the reader, not in an agent

- [x] **The icon is too detailed and reads pixelated.**
      > "also btw the icon looks very pixelated probably because it has so much
      > detail in it, so help me craft a new icon as well"
      > "the icon thing do it with me dont hand it to a agent, we do together ,
      > if i like then you update it"
      Replaced with the reader's own cute red notebook, drafted together
      over two rounds. Verified by reading frames back OUT of icon.ico
      rather than downscaling the master: a red book at 16px, spiral
      rings by 24, the face from 32. The surround is detected from the
      corners now instead of assumed black, so the next swap cannot ship
      an opaque box behind the mark.  `9903564`

      Their diagnosis is almost certainly right: `alcove-art.png` is a rendered
      illustration downsampled to 16/32/48px, and detail that survives at 256
      turns to mush at 16. Draft options together, iterate on their call, and
      only then regenerate the icon set. **Not delegated.**

### Defaults and first impression

- [x] **The out-of-the-box room looks weird.**
      > "the default bookshelf colour, wallpaper colour and design looks weird,
      > try to hand pick the best one to make it good out of the box when user
      > first opens the app"
      The opening room is hand-picked as one composed choice - scheme,
      carpentry and paper judged together on a first-run screen rather
      than each on its own merits.  `138ef8a`

      Hand-pick the opening scheme + carpentry + wallpaper as one composed
      room, judged by looking at the first-run screen, not by picking each axis
      on its own merits.

- [x] **Presets are weighted bland; the interesting ones should lead.**
      > "i liked the studio preset called the counting house, cardroom, chapter
      > house, minister, snowline, sawmill etc because of interesting it is,
      > presets like that should be first, and possibly take inspiration from it
      > when making the default, also i noticed a lot of presets while they look
      > good physically on the colour side seem to be to be bland, which is not
      > bad but it sohuld be balanced with presets that are vivid too right?"
      69 rooms now, each declaring a tier (34 signature, 28 shelf, 10
      plain) with the order DERIVED from it. Antique leads because three
      of the six rooms the reader named are Antique; Quiet, deliberately
      the plainest, brings up the rear. Vivid rooms added so the set is
      balanced rather than uniformly muted.  `138ef8a`

      Two jobs: re-rank so the characterful presets lead their families, and
      ADD vivid ones so the set is balanced rather than uniformly muted. Bland
      is not wrong — unbalanced is.

- [x] **Onboarding should choose the reader's whole look for them.**
      > "during onboarding ask thee user whether they like bland or vivid, what
      > kind of pattern and style they like(make it sound better) and then auto
      > pick their colour profile, from the preset to how their shelf, wlecome
      > book, wallpapper, etc etc etc, as well as their sound profile , the
      > colour profile on the settings icons and other app ui icons etc"
      Four questions early in the tour, every option a REAL drawing
      rather than an adjective, then it writes the room preset,
      carpentry, wallpaper, welcome binding, sound set and UI colour
      profile. The word "vivid" appears nowhere in the copy - a test
      enforces that, since the reader asked for it to "sound better".  `138ef8a`

      A short taste questionnaire early in the tour that writes: room preset,
      shelf carpentry, wallpaper, welcome-book binding, sound set, and the UI
      icon colour profile. Phrase the questions in the app's own voice, not as
      "bland or vivid".

### Onboarding

- [x] **Step 2 has no guard: dragging before clicking skips the step.**
      > "in onboading step 2 it doesnt tell user to click on the pop up that
      > says write my first one before dragging on shelf, so if user drags on
      > shelf before clicking write my first, it goes to step 3, there should be
      > safety here"
      A first-book gate that only exists when the case is genuinely
      empty, and that a shelf drag cannot satisfy. Steps can now name a
      gesture that will NOT satisfy them plus what to do instead.  `fe1fac7`

- [x] **"Write my first" creates TWO books, and the new one is white.**
      > "when i click on write m y first, it creates two books, basially the
      > welcome book popups along with my new book, also for some reason the new
      > book is white"
      Both halves fixed; the white book was the same unbaked-spine
      family as the welcome book bug, on the create path rather than the
      startup one.  `fe1fac7`

      Two bugs in one action. The white book is the same family as the
      unbaked-welcome-book defect: a spine that never got its bake.

- [x] **Step 6's drop target is too small, and the cursor says no.**
      > "in step 6 the highlighted box is too small to allow for draggin, it
      > works but the user might get confused to move the below the higlighted
      > box especially if it shows stop sign on his cursor when he is donig it"
      The spotlight is the whole editable column with zero padding, so
      every lit pixel is a legal drop and following the tour never
      produces the not-allowed cursor.  `fe1fac7`

- [x] **Steps 10 and 12 do not close the panel the previous step opened.**
      > "step 10 it goes to explainig the next thing without auto closing the
      > customise book thing that was opened in step 9"
      > "same when going to step 12 from 11"
      Fixed generally rather than as two special cases: on entering a
      step, every open surface closes unless one of that step's own
      targets resolves inside it. A step declares what it is about once
      and both the spotlight and the tidy-up read that declaration.  `fe1fac7`

- [x] **The task-complete sound is wrong.**
      > "the sound effects for onboarding when completing a task is very weird,
      > its like a metal tong"
      It was literally a struck metal bell - the same file the hour
      chime uses. Metal is the one material this room does not own. The
      house sets voice it as a wooden tap that settles; the bell files
      are untouched and the cloister set still rings.  `b088004`

- [x] **The tour does not cover the rails.**
      > "the tutorial did not show all the stuff in the sidebar in the notebook
      > and also did not show the option in sidebar when bookshelf is open"
      13 steps to 20, covering the shelf dock and studio and the book's
      page-style, catalogue, finding and rail actions.  `fe1fac7`

- [x] **Offer a short tour and a long one.**
      > "it fine if the onboarding is very big"
      > "in fact at the start of onboarding ask user if they want bare minimum
      > or full the rundown, like that we show them information accordingly"
      Asked at the start. Both derive from ONE tagged list, so the short
      tour is a real subset rather than a second script that can drift.  `fe1fac7`

### Sound

- [x] **MAJOR: cues degrade into "jittery sand paper".**
      > "i have just discovered a major ting, a lot of time i said bad but
      > actually there is a sound bug that turns that sound effects into jitterry
      > sand paper , for example when i click on studio its a nice tap when i
      > click again to close it becomes jittery sand paper(happens like maybe 2
      > times every 3 times)"
      Recorded rather than listened to: an AudioWorklet spliced into
      howler's master bus caught 137 plays and EVERY ONE started at gain
      1.000 and was pulled down afterwards. The level was being set
      after play() returned; howler copies the group volume onto a fresh
      voice one statement before the buffer starts, so two writes at the
      same AudioContext time cancel silently and one quantum apart the
      cue opens 2-4x too loud and steps mid-attack. Also disabled
      autoSuspend, whose resume path deferred the play AND queued
      volume/rate behind it. Three other suspects measured and ruled out
      in writing.  `b088004`

      **This reframes months of "the sound is bad" feedback.** A cue that is
      fine on one play and gritty on the next is not a sourcing problem — it is
      playback: overlapping voices on one Howl, a rate/detune jitter, a sprite
      window cutting into the next take, or the new filter node resonating.
      Reproduce it by TOGGLING the studio repeatedly and capturing the actual
      output, not by listening.

### Customisation — the big one

- [x] **Delete, restore, favourite, and add-your-own, everywhere.**
      > "we should also give the user to delete stuff in the customisation in
      > all possible areas with option to restore it again by right clicking its
      > menu which then opens up the list of deleted ones with checkbox style
      > options to restore what they want, along with option for user to favorite
      > stuff which then puts it in first in its category or sub cateofry
      > depending favorite level the user sets for it, and option for user to add
      > their own customisation options like textures or effects or sound
      > whatever, when uploading for category it will open a popup with upload
      > button information on how to do it along with a custom ai prompt they
      > give to an ai that will tell it the specifications of how to build and
      > package it for the user to upload it here"
      One mechanism (src/data/shelfOfMine.ts) across 33 axes: hide,
      restore from a right-click drawer with checkboxes, and stars where
      one tops a family and two top the axis. Wired into all seven
      library strips and all six book strips. A removed entry leaves the
      roll pool too - and one you are currently WEARING still shows, or
      the strip would read as having forgotten.  `138ef8a`

      Four capabilities across EVERY vocabulary, as one shared mechanism:
      hide/delete an entry; restore from a right-click list with checkboxes;
      favourite with a level; and import your own. The upload dialog carries
      instructions AND a copyable AI prompt describing the exact format, so a
      reader can have a model build a pack for them.

- [x] **Save the current room as a preset, and star it.**
      > "give the user the option to save their current room as preset and also
      > star it simuntaosuly to make sure it stays up top, ( single star to pin
      > it to top of a subcateogyr while double star for it to be at top within
      > the category as a whole , this notation for pretty much anything)"
      Name and stars in one action, joining the same list as the house
      presets and deletable through the same drawer.  `138ef8a`

      The star notation is the same favourite-level mechanism as above and must
      share it, not be a second implementation.

- [x] **Appearance offers 4 themes; handwriting, ink and paper are thin too.**
      > "in appearance i noticed only 4 themes, are there fix it to atleat have
      > 20, same bug for handwriting, you know what though i feel you have
      > already done this thouhg and the option is not showing but anyway might
      > be worth to check the code for stuff that may have been written but not
      > plugged"
      > "btw same issue for ink, paper type , atleast 20 options"
      The reader's instinct was right again. 30 app themes, 34 inks, 24
      papers and 27 handwriting faces now, each tiered and
      family-grouped.  `138ef8a`

      Their instinct is right and this has happened four times already (the
      colour axis, the lettering shelf, the underlines, the wallpaper roll
      gate). Find the written-but-unplugged surfaces and plug them.

- [x] **A standing alarm for written-but-unplugged code.**
      > "perhaps even a safety clever functionality sort of like alarm to every
      > part of the code to basically spit out errors if it isn't plugged in"
      tests/plugged-in.test.ts. It missed six things on its first outing
      - including a component that was imported but never RENDERED - and
      was widened until every one of them would have failed it.  `138ef8a`

      Generalise `tests/roll-gates.test.ts`: a gate that every exported
      vocabulary / pool / gate has a real consumer in `src/`, failing loudly
      when something is authored and reachable by nobody.

### Book, page and editor

- [x] **A click should bring the book forward, not open it.**
      > "the book is auto opening when i click it should isntead just come in
      > foreview and only if user clicks on it does it go inside , with a back
      > button on top left"
      One click brings it forward out of the shelf; a second opens it.
      Back is top-left. Drag-out still works.  `138ef8a`

- [x] **The page changes colour mid-turn.**
      > "i noticed when turining the page the colour of page changes before
      > going back to original colour"
      src/flip/paperTone.ts - the snapshot and the live DOM now agree
      about the paper.  `138ef8a`

- [x] **Stickers and effects should be placeable anywhere.**
      > "give user the option to drag and place stickers or any effects, like i
      > mean click on it and put it anywhere on the page, not caring about where
      > lines are"
      Free placement, dragged with the pointer and persisted with the
      page, with the reflow behaviour decided deliberately rather than
      left to chance.  `138ef8a`

- [x] **Merge the bookmark button into Ribbons.**
      > "there should be an option for user to make their own custom bookmarks,
      > right now it just places a bokomark when i click on bookmark button, i
      > feel you may have written code for this but not plugged in, oh wait never
      > mind you just have it as options in sidebar called ribbon, maybe it might
      > be worth merging those two instead having a seperate button"
      One control: bookmark this page and choose which ribbon does it,
      with a one-press default so it stays fast.  `138ef8a`

- [x] **Focus mode should be a range, not a switch.**
      > "focus mode should allow user to basically zoom in and also even just
      > get into full page mode where the book isnt even visible and it just page
      > and even go as far just making one page visible, so basically it should
      > be controllable by user"
      Four rungs - off, spread, page, single leaf - plus a zoom the
      reader controls and a leaf chooser, on a plate under the top-left
      exit.  `138ef8a`

- [x] **Rework the welcome book to show everything off.**
      > "completely rework the welcome book content to showcase all the
      > different possiblities, also i hope you added math latex options etc"
      > "make the welcome book very detailed and beautofil and playful and fun
      > showing what all can be done like adding images, banenrs, also ithink the
      > code even shows how to add random images based on a search query, so
      > maybe add some cute kittens"
      Rewritten as a real showcase, and yes - there are kittens.  `138ef8a`

- [x] **More shortcuts.**
      > "more shortcuts would be nice"
      Widened across the shelf, the panels, the book and focus mode, all
      through the central map so every one is rebindable and appears in
      the cheat sheet.  `138ef8a`

### Art quality

- [x] **Some spine designs are still too weird for the dice.**
      > "we might need to do a purge or atleast remove the randomise/new book
      > creator some new book designs on spine and perhaps elsewhere because they
      > too weird like look at how weird this is"
      Re-judged on a real dice-rolled SHELF at the zoom the app opens on
      rather than on a specimen board - the reason the first pass
      under-demoted. Nothing deleted; all still pickable.  `138ef8a`

      They attached a shelf shot. Note this is now the SECOND pass on the same
      complaint, so the tiering is not demoting enough — re-judge against what
      they actually see on a shelf, not on a board.

- [x] **An effect renders wrongly.**
      > "fix and verify the effects, for example look at how weird this effect
      > is"
      Found and fixed, then all 472 effect values swept on a real page
      at real size to catch the others.  `138ef8a`

      They attached a page shot: a washi/tape strip sitting across the text
      rather than behind or above it.

- [x] **Custom cursors.**
      > "add custom cursor states and cursor icons wiht customisation options
      > for the user pick"
      Drawn cursor sets the reader picks between, with hotspots verified
      by clicking small targets. `system` stays available and Windows
      High Contrast hands it back on its own.  `138ef8a`

## 🏷️ Rename to **Alcove** — DEFERRED until the running workflows land

Held back on purpose: two workflows are editing this tree, and a rename touching
nineteen files across four languages during that is how work gets clobbered.

The icon is already safe — moved (not copied) out of Downloads to
`assets/brand/incoming/alcove-art.png`. A classical alcove: arch, columns, a
shelf of books, an open book, a quill. It carries the same baked black frame the
last one did, which `scripts/gen-icons.py` flood-fills to alpha already.

**Tooling is in place so this and every future rename is one command:**

- `brand.json` — the name, slug, identifier, repo, welcome-book title, the art
  master, and the strings a rename must NEVER touch.
- `npm run rename Alcove --art assets/brand/incoming/alcove-art.png`
  (`--dry` first; the dry run currently reports 19 files).
- `tests/brand-consistency.test.ts` — 13 checks that every surface agrees with
  `brand.json`. It exists because the last rename left `main.rs` calling
  `notebook_lib::run()` after the crate became `bellanote`: **the Rust binary
  did not compile for several commits** while tsc and 1,480 tests stayed green,
  because neither of them can see Rust.

**Still by hand after the script runs, and the script prints all four:**

1. Seed migration — bump `SEED_VERSION`, extend the retitle. Without it every
   existing reader gets a SECOND welcome book, because the title is also the
   identity check that stops one being seeded.
2. Icons, in this order — the Tauri CLI overwrites the close-cropped small
   sizes, so it must run first:
   `npx @tauri-apps/cli icon <master>` then `python scripts/gen-icons.py`.
3. `gh repo rename alcove` + `git remote set-url origin`.
4. **`cargo check --manifest-path src-tauri/Cargo.toml`** — the toolchain the
   last rename broke and the only one that would have noticed.

## ⏭️ Left over after the 2026-08-03 workflows

Both waves landed and are green (tsc 0, 1660 tests). These are the gaps the
agents reported honestly, plus the seams between them that I closed by hand.

**Still open:**

- [x] `DEFAULT_SHELF_DESIGN` did two jobs — the opening carpentry AND the
      unknown-id fallback for `resolveShelfDesign`/`getBuild`. Split into
      `DEFAULT_SHELF_DESIGN` (scriptorium/guilloche) and
      `FALLBACK_SHELF_DESIGN` (plank/none), like `DEFAULT_WALLPAPER_ID` before
      it. `d8e4bf3`
- [x] Applying a room preset is two independent store writes (colour to the
      bookcase's room blob, design to the studio's settings key), so the world
      reacted twice and re-baked twice on one click. `queueApplyLibrary` folds
      every notification in a task into one application. End-of-task, not a
      microtask — the microtask version still measured two, because each save
      awaits its own store's load() and those resolve a different number of
      ticks apart. `shots-now/preset-bakes.mjs` reads the new bake counter:
      +2 each before, +1 each after. `360a8c1`
- [x] `ROLLABLE_SHAPES` / `ROLLABLE_MATERIALS` / `ROLLABLE_DECORATIONS` are
      exported and gated but have no consumer. **They have one now**: the book
      studio's "bind it yourself" section picks each axis on its own, every
      strip holding the other two still.
      A composed binding is an id — `own:shape/material/decoration/gilt` — so
      it rides the existing `Record<bookId, BookPresetId>` with no migration
      and no new axis for `bookDesignTag` or the spine factory's params key to
      forget. Gilt is its own segment because the preset table says it must be:
      only 134 of 189 rows agree with "gilt iff the decoration is a gilt one",
      so it is a choice, not a derivation.
      `shots-now/own-binding.mjs` drives the real strips and checks the trap
      that matters — picking one axis KEEPS the other three — then reloads.
- [x] ~~No "add your own set" for sound, and no runtime filtering in a set's
      levers (Howler exposes rate and volume per play, not a filter node).~~ —
      **one half was wrong, the other half is half right.** Both delivered
      honestly; `docs/design/sound.md` § *Sets: the two levers that were
      written off* is the long version.
      **Add your own set: built.** `sound/userSoundSets.ts` (pure registry, the
      engine reads it on the play path) + `userSoundSetStore.ts` (dialog,
      bytes, one `settings` row), following `templates/userStickers.ts`
      exactly — `user:` id, bytes through `storeImageBytes` into
      `$APPDATA/assets/images/`, which is the only asset-protocol scope a Web
      Audio fetch inside the app can reach. A reader's set is a shipped BASE
      plus overrides, so one typewriter sample makes a working set instead of
      needing thirteen, and everything unfilled keeps the mastered loudness
      hierarchy. Their file beats the base's substitution AND its silences; the
      swap follows a layer; an unrecognisable file name is reported back rather
      than assigned to whichever role was free.
      **Runtime filtering: real, and per-SET not per-role.** `Howl` has no tone
      control — that part was right. But `Howler.ctx` and `Howler.masterGain`
      are public (both in `@types/howler`), so `sound/filter.ts` cuts the
      `masterGain → destination` hop and splices real `BiquadFilterNode`s into
      howler's own graph. `scripts/probe-sound-bus.mjs` MEASURES it in the
      running app rather than asserting we called `createBiquadFilter`: a tone
      into `masterGain`, an `AnalyserNode` either side, `far-room` −30.6 dB at
      8 kHz and `music-box` −25.2 dB at 120 Hz / +3.1 dB at 3.2 kHz, each
      agreeing with the wired node's own `getFrequencyResponse()` to 0.1 dB.
      **What is still genuinely impossible, and why:** a PER-ROLE filter.
      Everything reaches `masterGain` already mixed, and the only per-sound
      node is `howl._sounds[i]._node` — private, undocumented, re-created per
      play; a lever built on it would break on a howler patch release and break
      silently. Also unavailable with `usingWebAudio === false` (HTML5 mode),
      where `getEngineState().filter` reports `installed: false` with the
      reason instead of pretending. And nothing conditions the reader's own
      files: the warmth fit / lowpass lid / levelling are a `gen-sounds.mjs`
      build step over ffmpeg-decoded float, not a runtime pass — the settings
      panel says so where the buttons are.
      `tests/sound-own.test.ts` (37) + `scripts/probe-own-sounds.mjs`.
- [x] `docs/design/page-flip.md` specified the shadow/lighting model that was
      removed — warm crest highlight, pre-fold darkening, self-shadow. Doc
      corrected; `tests/flip.test.ts` gates their absence. `2cf330e`
- [x] `CLAUDE.md` said "a library theme is a colour scheme" with no mention
      that presets bundle colour + carpentry + paper. Corrected. `2cf330e`
      (`docs/ROADMAP-wave2.md` still unreviewed — see below.)
- [x] `UserStickersSection`'s imported-sticker grid is capped now. `8cba847`
- [x] `tutorial.css`'s `.nbt-card` is its own scroller with the actions and
      progress dots at the bottom — same family as the reported scroll bug,
      inverted. Both pinned with `position: sticky`; `shots-now/tour-footer.mjs`
      measures a 223px scroll at a 400px window and refuses to pass on less
      than 120px of overflow, because at a normal window the worst step
      overflows by 3px and such a run proves nothing. `cab49e7`
- [x] CheatSheet, QuickSwitcher, TemplatesGallery and ExportPdfDialog had NO
      visible way out — Escape or the scrim only. All four have a top-left
      close now, one shared drawn-ring look (`.nb-ins-close` serves the three
      `.nb-ins-card` dialogs). Dropped two duplicate exits while there: the
      gallery's bottom-right "Close" and the PDF sheet's "Cancel", both of
      which were the same action in the wrong corner.
      `shots-now/dialog-exits.mjs` opens all four through their real triggers
      and measures the close is inside the card, left half, top half.
- [x] The settings seal (bottom-left) rendered ABOVE the pulled-book scrim, so
      it stayed lit while the room dimmed. Dropped to just under the scrim,
      with `shots-now/seal-layer.mjs` confirming it is still the topmost thing
      at its own coordinates on a resting shelf. `cab49e7`
- [x] Max zoom on a 2× display is the one soft spot left: 0.80 texels per device
      pixel at zoom 2.5. **Two corrections, one decision unchanged.**
      It is not "on a 2× display": `spineBakeScale` already multiplies by dpr,
      so sampling is `HI_SCALE_BASE / zoom` and the dpr cancels — 0.80 at max
      zoom on every display alike.
      And sharpening it does not cost "6.25× the bake area" as the comment in
      `spineScale.ts` and `spine-resolution.test.ts` both claimed. That figure
      came from `HI_SCALE_BASE = 5`, which double-counts the dpr. Covering zoom
      2.5 needs 2.5, i.e. **1.56×** the area.
      Still not taken, now for the real reason: 1.56× the texels is 1.56× the
      CPU in every hi bake on every launch, and at dpr 2 a page drops from ~32
      spines to ~20 so the 121-book worst case needs 7 pages instead of 5
      (~33MB more atlas). The shelf RESTS at zoom 0.8, where the hi bucket
      already gives 2.5 texels per device pixel. Documented as a one-constant
      change if max zoom ever becomes somewhere readers spend time, and the
      dpr-cancelling arithmetic is now pinned by a test rather than by prose.
- [x] Spines are not disk-cached, so every launch shows the lo bake until the hi
      one lands. **Measured, and not worth doing.** `shots-now/spine-transient.mjs`
      polls the factory's two buckets against the visible books: every visible
      spine is at the hi tier **846ms after the shelf appears**, on SwiftShader
      — the slowest renderer this app ever runs on. It is also not the lo bake:
      at the one sample where anything was unsettled, 5 of 6 spines were on the
      placeholder tint and 1 on lo, so the moment is placeholder → hi.
      A disk cache would buy less than a second there, and `art/bake.ts` has a
      measured header explaining why the disk cache was REMOVED: the PNG encode
      costs more than redrawing flat art, the encode was awaited on the
      critical path, and the read was awaited ahead of every producer on a
      miss. Re-adding one for spines would repeat that with more objects.
      Closing this rather than leaving it to be picked up as if it were free.
      (While checking: `CLAUDE.md` still claimed bakes are "persisted to
      appCacheDir as PNG" and warned that "the disk cache validates nothing
      about a hit" — both stale since the removal, and both would have sent the
      next reader the wrong way. Corrected, including a note that re-adding it
      has already been tried and reverted.)
- [x] In the lettering shelf every `hand` specimen renders a visually identical
      "Aa". It was a real bug, and far bigger than the specimen: the WHOLE
      lettering shelf had no CSS. `BlockEffects` wrote `data-font`, `data-ink`,
      `data-size` and `data-align` exactly as designed and nothing read them,
      so all 122 values were inert on the page as well as in the picker.
      Chasing it turned up a fourth: `[data-underline]` set `position:
      relative` for a pseudo-element nobody ever wrote, so all 50 marks did
      nothing either.
      Generated (`scripts/gen-lettering.mjs`, `scripts/gen-underlines.mjs`) the
      way `gen-tints.mjs` already generates the axis this happened to FIRST.
      `tests/catalogue-reach.test.ts` now gates the last link — every value of
      every axis must be named by a selector — which is what would have caught
      all three at the time.
      Verified by measurement, not by looking: `shots-now/lettering.mjs` and
      `shots-now/underlines.mjs` count distinct rendered signatures (50/50,
      50/50, 12/12, 10/10, 50/50) and check the 13px handwriting floor.

## 🔴 Reported 2026-08-03 (second pass)

- [x] **Some book shapes are bizarre** — "some of them are literally pencil
      shape or other just bizarre shapes". Same for any shelf or paper that
      looks weird, bad or cheap. **Do not be cruel and do not delete**: rank
      them so the good ones and good categories come FIRST in their list and the
      odd ones sit at the bottom, and **omit the odd ones from randomise** so
      the average reader is never handed one — while they stay pickable for
      anyone who wants them.
      **BOOKS: done.** Nothing deleted. Every binding declares a `group` and a
      `tier` (signature / shelf / niche / oddity) and TypeScript refuses one
      that does not; the exported order is DERIVED from them, so a good binding
      cannot drift down the list by accident. The dice walk `ROLLABLE_PRESETS`
      only — all 189 stay pickable. `tests/book-bindings.test.ts`, 31 checks.
      **WALLPAPERS: tiered, and the gate was unplugged.** `WALLPAPER_ROLL`
      existed, was tested, and had no caller anywhere in `src/`, so the
      studio's surprise still rolled all 126 including the demoted ones. Now
      wired, with `tests/roll-gates.test.ts` checking the CALLER rather than
      the pool — verified to fail against the old line. `c2aa7d8`
      **CARPENTRY: not started.** This tick was premature and is corrected in
      the item below — `src/art/shelfDesign.ts` has no tier axis at all, and
      the studio rolls the full `BUILD_IDS` / `PATTERN_IDS`.
- [x] **The shelf carpentry has no tier axis.** The books and the papers both
      rank their weak entries to the bottom and keep them out of the dice;
      `src/art/shelfDesign.ts` has nothing of the kind — 52 builds, 50 timber
      patterns and 113 presets in hand order, and `LibraryStudio`'s surprise
      rolls all of them. Mirror `wallpaperDesign.ts`: a REQUIRED tier on
      `BuildSpec` and `PatternSpec` so TypeScript refuses an untiered entry,
      the exported order derived from family → tier → authored order, and a
      `ROLLABLE_*` pool the studio rolls. Decide the tiers BY LOOKING — a probe
      that renders every build at the pitch the shelf actually shows.
      `FALLBACK_SHELF_DESIGN` (plank/none) must be excluded from the dice for
      the same reason `plain-parchment` is.
      Done. Tier is REQUIRED on BuildSpec and PatternSpec, the order
      is derived from family then tier, and surprise() reads
      ROLLABLE_BUILDS / ROLLABLE_PATTERNS. Five builds and three
      patterns demoted against a board rendered at real shelf pitch,
      nothing deleted. The gate test checks the CALLER and its teeth
      were proven: reverting surprise() to the ungated form leaves tsc
      clean and fails exactly the two caller assertions.  `6c17456`

- [x] **Go through every design and refine it by looking.** Not just the
      outliers — visual inspection and improvement across the whole vocabulary.
      Then the same for everything else in the app.
      Split into bounded passes, because as written this can never be ticked —
      and all four are now done. **Every customisation axis in the app has had
      a board rendered at the size it actually appears, read, and acted on.**
      That is the claim worth keeping: not that everything is beautiful, but
      that nothing is unexamined. What looking found, that no amount of
      reasoning would have: three silhouettes genuinely broken (a spike, an
      arrowhead, a wall plug), five builds that were another build with a
      feature switched off, and two timber patterns that read as dirt on the
      screen.
      Axes that HAVE had the pass and left a board: wallpapers, book
      silhouettes, covers, lettering, underlines, and now these four:
      - [x] the 52 shelf builds and 50 timber patterns (no probe exists)
            Board rendered, read, and acted on.
            scripts/probe-shelf-builds.mjs.  `6c17456`
      - [x] the ~20 book silhouettes this file already admits cluster into
            "plain rectangle with a slightly different top" at shelf scale
            Distinct rendered signatures went 29/50 to 48/50. Three were
            genuinely BROKEN rather than merely alike: cushioned and rolled
            grew a spike from a fillet cap, round-cap tail was a downward
            arrowhead, and crenellated rendered as the two-pin wall plug its
            own comment claimed to have fixed.  `6a4c1b6`
      - [x] `art/spines.ts` ornaments / title plates / edge treatments (50 each)
            First board ever rendered for these three axes, at the size they
            appear on a spine.  `6a4c1b6`
      - [x] the 472 block-effect values not yet measured for distinctness
            Measured for distinctness, with the probe left behind to re-run.  `6a4c1b6`
- [x] **The README, properly.** Long, and clever about what it pulls in: the
      code should carry the documentation and the README should draw from it
      rather than duplicate it. Check current best practice. Two halves:
      - **For readers** — what it is, how to use it, releases/version badges,
        download links, screenshots, in a custom UI that matches the app.
      - **For developers** — the stack, how it works, what it uses and WHY,
        how to add a feature, the architecture docs, the conventions, the
        gates. Add whatever further sections earn their place.
      Both halves shipped: `docs/readme/part-1-users.md` and
      `part-2-developers.md`, with 13 screenshots captured from the running app
      under `docs/readme/img/`.
      The "draw from the code rather than duplicate it" part is the bit worth
      keeping honest, and it is enforced: every counted claim is wrapped in a
      `<!--f:name-->N<!--/f-->` marker and `tests/readme.test.ts` recomputes all
      nineteen from the tree — source files, docstring lines, unit tests, e2e
      specs, probes, design docs, Rust commands, and each vocabulary's size.
      It has already caught this session's prose drifting twice, which is the
      whole point: a README that quotes numbers is a README that goes stale
      silently.

## 🔴 Reported 2026-08-03 — WORK THIS LIST

- [x] **Colour choosers are still ~8 wide.** Everywhere colour is an option it
      offers about eight. At least 20, plus a way for the reader to enter their
      own.
      `OwnColour` brings a reader's own mixed colour to the book's cloth
      and the room's timber and wall — it persists like any other pick and
      is in the bake key, or the case would serve the old pigment forever.
      Breadth was already 50.  `fd69ca1`
- [x] **Books read as low resolution on the shelf.** Look at the spine atlas /
      LOD scale, not just the drawing. The cause was the unit: bake scales were
      world-px constants while a sprite is drawn at `world px × zoom ×
      renderer.resolution`, so any display above resolution 1 asked for twice
      the texels the bake had. `spineScale.ts` sizes in DEVICE px now and
      `tests/spine-resolution.test.ts` pins the arithmetic.
      Max zoom (2.5) sits at 0.80 texels/devpx and stays there deliberately —
      see the item above for the corrected cost of closing it, and for the two
      wrong claims that were justifying it.
- [x] **The back button scrolls away.** In any panel with a long submenu, scroll
      down and there is no way back until you scroll fully up. Header must stay.
      The rail panel header is pinned and the body is the only scroller.
      `shots-now/panel-header.mjs` scrolls a genuinely overflowing panel
      to the bottom and checks the close is still in the visible box — and
      refuses to pass on one that does not overflow.  `e245e27`
- [x] **"Rooms" do not change the bookcase or the wall**, which is what a room
      is for. Rename the axis to **presets**, and make them real, classified
      presets that set carpentry + paper + colour together. Use the mood tags
      (formal, refined, fancy, goofy…) to generate candidates, then FINE-TUNE BY
      LOOKING. The studio's top axis is "Room preset" now (`getRoomPreset` /
      `roomPresetOptions`), and one click sets colour + build + pattern +
      wallpaper together — measured end to end by
      `shots-now/preset-bakes.mjs`, which also proved it costs one bake rather
      than two.
- [x] **Default shelf, wallpaper and welcome book look bland / cheap.** Pick
      refined, elegant defaults — including the ambience (fireplace) and the UI
      colour profile. The reader must still be able to change all of it.
      Case and paper are chosen (`scriptorium.guilloche`, `pin-quiet`) and read
      well in `shots-now/out/first-run.png`. **But the welcome book was not
      bland — it was UNBAKED.** On a fresh library the one book on the shelf
      rendered as a flat placeholder rectangle indefinitely: measured
      `hi:false, lo:false, queued:0` after 30s, and a manual
      `factory.request()` baked it instantly, so nothing was ever asking.
      Adding a second book was what finally baked the first.
      Cause (found by tracing the real startup, after two wrong guesses):
      `SpineFactory.paintOffThread` DROPPED a bake whose room changed while it
      was in flight. The item is already out of `queue` and out of `inFlight`
      by then, so nothing remembered the book wanted a spine — unlike the
      adjacent `paint === null` branch, which puts it back. The room is dressed
      once at startup, which bumps the epoch, and on a one-book library nothing
      ever re-requests. On a stocked shelf any pan healed it, which is why it
      hid for so long. Fixed by re-queueing on epoch mismatch;
      `shots-now/welcome-bake.mjs` is the regression test and deliberately
      checks the ONE-book case, since seeding a second book is exactly what
      used to paper over it.
      AMBIENCE: `soundscape` has said `'fireplace'` since the beds were built
      and `ambientLoop` defaulted to FALSE, so nobody ever heard it without
      going to look — a default that names an atmosphere and then does not play
      it is a preference with a nice name. The fire is lit on arrival now, at
      0.35 under a 0.8 master, held by the webview's autoplay policy until the
      reader's first click so the app never makes noise at somebody who has not
      touched it. One switch turns it off; `reducedSound` and `muteAll` still
      win.
      THE EMPTY SHELF, closed rather than left hanging: I noted "nine-tenths
      empty — one book in ten bays" as a defect. It is not one. Shipping
      exactly one Welcome book is a stated product rule (CLAUDE.md), and ten
      floors is the documented default. A new case with one book and the
      add-a-book ghost beside it reads as room to grow, which is what it is.
      Inventing books to fill somebody's library would be the actual mistake.
      OLD NOTE, superseded: the shelf is nine-tenths empty on first run — one book in
      ten bays — which is the other half of "bland", and a separate decision
      about what a new library should ship with.
- [x] **Drop the "read it / put it back" card.** A book that comes off the shelf
      just opens. Put a tasteful back control top-left that fades once used.
      `PulledBookOverlay.tsx` documents the removal: the flight runs straight
      into the book view, and `.nb-back-button` is the top-left way out (pinned
      by `tests/top-left-exits.test.ts`).
- [x] **Page-turn artefact:** mid-turn, the bottom half of the ruled page shows
      a shadowy band. Reproduce it and look.
      **DOES NOT REPRODUCE, and that is measured rather than asserted.**
      `shots-now/flip-band.mjs` freezes the curl at sixteen points — six along
      an edge drag, three at a corner, three on the previous-page leaf, and
      five mid-tween — and samples 24 horizontal bands across the leaf each
      time. Every band on every frame lands between 241.2 and 242.13 luminance:
      a worst-case spread of **0.93 out of 255**, against a control strip that
      reads 202–228. There is no band.
      Consistent with the cause: the shadow and lighting model was deliberately
      removed from the curl shader, and `tests/flip.test.ts` gates its absence
      (no `pow()`, no self-shadow term). The report is kept at
      `shots-now/flip-band/report.json` so nobody has to take this on trust —
      and so a future regression has a baseline to fail against.
- [x] **Cap every long option list at ~20 + "N more".** The catalogue's tape and
      trim shelves show a hundred at once. Applies app-wide, and it is a
      performance fix as much as a layout one. One `Capped` helper does it;
      `UserStickersSection` was the last uncapped grid and the only one whose
      length the READER decides. `8cba847`
- [x] **Bookmarks want customising** — a wide variety, like the other axes.
      It is a real vocabulary now, in `src/views/bookmarks.ts`: ribbon
      materials, cloths, weights, tails and charms composed into **40** presets
      across 8 named families (5 each), offered through the rail's Ribbons panel
      with the same strip-plus-"N more" pattern every other axis uses.
      *(This said 400 for a long time — off by a factor of ten. `RIBBON_PRESETS`
      holds 40 `preset(...)` rows and `RIBBON_FAMILIES` holds 8, which is what
      the drawer renders. 40 is still in the range the other axes sit in, so the
      vocabulary is fine and only the number written here was wrong.)*
- [x] **"Leave focus mode" sits top-right; it belongs top-left.** Audit EVERY
      control of that kind — back, close, leave — and put them all top-left.
      `tests/top-left-exits.test.ts` is the mechanical sweep (it fails any
      exit-ish selector anchored `right:` or `bottom:`), and the four dialogs
      it could not see — cheat-sheet, quick switcher, templates gallery, PDF
      export, script insert — got visible top-left closes with one shared
      drawn-ring look. `shots-now/dialog-exits.mjs` opens each through its real
      trigger and measures the close is inside the card, left half, top half.
- [x] **Sound presets:** the reader picks a set (clicks and the rest), the same
      way they pick a binding or a room. `src/sound/soundSets.ts` +
      `soundSetPrefs.ts`, offered from the settings sheet. (The remaining
      half — importing your OWN set — is the open item further up this file.)
- [x] **Tooltips are the browser's grey bubble.** They need the app's own UI.
      `src/views/Tooltip.tsx` is the app's own, and 22 controls were still
      handing the job back to the OS with a native `title=` — thumbnails,
      ribbon markers, every design-picker card and strip tile, the callout
      swatches, image/link tools, spoiler, diagram editor, two settings rows,
      the cloth chips and reroll buttons, theme swatches, a bookcase name, the
      clone chip, the sound credits, the tour dots. All converted.
      `tests/tooltips.test.ts` gates it — `title=` on a lowercase tag only, so
      `<RailPanel title=…>` (a prop, not a label) stays untouched, and it
      proves its own matcher fires before trusting an empty result. `ea5198c`
- [x] **Onboarding should say how open the customisation is.** The tour's
      sign-off says it in real numbers — 113 bookcases, 126 papers, 189
      bindings — read out of the vocabularies rather than typed, so the claim
      cannot go stale. `5d1fea2`
- [x] Throughout: fast and smooth, without giving up fidelity. Be clever rather
      than cheap. A standing brief rather than a task, so here is the ledger of
      what was actually bought this pass, each measured rather than asserted:
      one room-preset click now costs ONE case+wall bake instead of two
      (`shots-now/preset-bakes.mjs` reads a real counter: +2 → +1); every long
      option list is capped at ~20 with "N more", which is a render-cost fix as
      much as a layout one; the disk cache stayed OUT after measuring the
      transient it would have shortened (846ms, on the slowest renderer this
      app runs on); and max zoom stayed at 0.80 texels/devpx after correcting
      the cost of closing it from a wrong 6.25× to a true 1.56× — a change that
      would be paid on every launch by every reader for the top sliver of the
      zoom range.
      The one place cleverness actually won something back: a spine whose room
      changed mid-bake used to be thrown away and re-painted from scratch on
      the next request. It is re-queued now, which is both faster and the fix
      for a book that never got painted at all.

## ⏭️ NEXT UP (2026-08-01, end of session)

Eight of the nine items from the "fifty of everything + fix all" pass are done
and pushed.

- [x] ~~**Ship readiness**~~ — and it was worse than the list said: `main.rs`
      still called `notebook_lib::run()` after the crate became `bellanote`, so
      **the Rust binary did not compile at all**. tsc and vitest were green
      through the entire rename and neither could see it. Both installers now
      build and carry the right identity, verified off the binary itself
      (`ProductName: Bellanote`, `com.bellanote.app`):
      `Bellanote_0.1.0_x64-setup.exe` (14.5 MB) and
      `Bellanote_0.1.0_x64_en-US.msi` (16.5 MB). Stale `Notebook_*` artifacts
      deleted from `target/` so nobody ships one by mistake.
- [x] ~~The cover collapses coverings to a binary~~ — PARTLY. It reads each
      covering's `body` tone from the same table the spine uses instead of a
      two-item set, so `paper` is now a washed wrapper distinct from `vellum`'s
      cream half-bound board: three board treatments where there were two.
      **Still open below** — five of the seven remain identical.
- [x] **Five coverings still share one board.** leather, cloth, linen, silk and
      marbled all carry `body: 'cloth'`, so `boardFor` correctly gives them the
      same colour — what separates them on the SPINE is grain (twill, laid
      lines, ribbed, moiré), and the cover has no grain painter at all. Giving
      it one is the remaining half of this item.
      The cover has a grain painter now. leather, cloth, linen, silk and
      marbled all resolved to one colour correctly - what separates them
      is grain, and the board a reader actually holds had none while the
      spine did.  `770a1d7`
- [x] **Split `DEFAULT_WALLPAPER_ID` before repointing it.** It is doing two
      jobs: the wall a library opens with, AND the fallback an unknown id
      resolves to. Pointing it at a patterned paper to show the fifty off also
      makes a corrupt setting silently paint stripes — four tests pin "junk
      gives you the plain wall", and they are right to. Split the constants,
      then give a new library a wall that shows the feature exists.
      Done: `FALLBACK_WALLPAPER_ID = 'plain-parchment'` (what junk resolves to)
      and `DEFAULT_WALLPAPER_ID = 'pin-quiet'` (what a new library opens on),
      with `getWallpaper` pointed at the fallback. The same split was later
      made for the carpentry — see `DEFAULT_SHELF_DESIGN` /
      `FALLBACK_SHELF_DESIGN` above.

Also open, from the same pass:

- [x] The studio's card axes use `DesignStrip` + `DesignPicker` ("more…"); the
      two `ColourRow`s now expand in place. Still unmeasured: whether a grid of
      fifty CANVAS cards re-bakes on every open. `designOptions.ts` holds the
      card cache key — measure before assuming.
      The colour rows use the same strip-plus-more treatment as every
      other axis now, so the sheet reads as one control vocabulary.  `fd69ca1`
- [x] ~~Right-clicking a shelf inside the library tab should offer book
      options~~ — `BookcaseMenu` in `features/bookshelf/ShelfMenu.tsx`, which
      is now three customers of ONE card: the spine's menu, the bare-plank
      menu and this. Right-click a case card in the studio's library tab for
      stand-in / rename / clone / add a floor / delete, with the confirm
      naming the books that go with it.
- [x] `docs/design/library-themes.md` still describes four rooms.
      Rewritten against the code: 60 schemes plus three orthogonal
      vocabularies (113 shelf presets, 126 papers, 189 bindings).  `e92b475`

## ✅ Fifty of everything (2026-08-01)

Delivered, counted by loading the modules rather than grepping:

| axis | was | now |
| --- | --- | --- |
| `flat.CLOTHS` | 6 | **50** |
| `spines.PIGMENT_COUNT` | 20 | **50** |
| `spines.ORNAMENT_COUNT` | 12 | **50** |
| `spines.TITLE_PLATES` | 4 | **50** |
| `spines.EDGE_TREATMENTS` | 4 | **50** |
| `bookDesign.SPINE_SHAPES` | 10 | **50** |
| `bookDesign.MATERIAL_LOOKS` | 10 | **50** |
| `bookDesign.DECORATIONS` | 12 | **50** |
| `bookDesign.BOOK_PRESETS` | 62 | **189** |
| `wallpaper.WALLPAPER_PATTERNS` | 22 | **50** |
| `wallpaper.WALLPAPER_TONES` | 8 | **50** |
| `wallpaper.WALLPAPER_PRESETS` | 50 | **126** |
| `stickers.STICKER_IDS` | 8 | **50** |

Already at or past 50 and left alone: shelf builds (52), timber patterns (50),
shelf presets (113), colour schemes (60).

### Still short of fifty

- [x] `blockEffects.BLOCK_EFFECT_TYPES` reached **27**, not 50 — the page-side
      agent was stopped mid-run.
      **This was filed wrong and should not be acted on.** It is not a
      vocabulary: it is the list of NODE TYPES the effect attributes are
      installed on (paragraph, heading, table, callout, diagram). Fifty would
      mean inventing twenty-nine block types nobody asked for. The fifty live
      on the other axis — the effect VALUES, 472 across eleven axes, guarded by
      `tests/catalogue-reach.test.ts`.
      The property that DOES matter is coverage, and it is now gated:
      `tests/block-effect-coverage.test.ts` fails if any block-level node under
      `src/editor/nodes` is missing from the list, since a forgotten one takes
      no tape, no paper, no frame and no hand while the catalogue's chips
      silently do nothing on it — the same shape as the three inert axes found
      this session. It passes: the only exclusions are `sticker` (inline, no
      box to dress) and `col` (may only live inside `columns`, which is itself
      dressable), and the test refuses an exclusion for a node that no longer
      exists.
- [x] The COVER's own vocabularies were never expanded: `COVER_TEXTURES` 3,
      `COVER_FONTS` 3, `COVER_FRAME_COUNT` 4, `COVER_MEDALLION_COUNT` 8. The
      spine got fifty of everything and the board a reader actually holds did
      not
      COVER_TEXTURES is the spine's fifty MATERIAL_LOOKS now, derived
      rather than restated, so a book's board and its spine agree about
      what it is made of. COVER_FONTS took the same treatment as the
      lettering shelf.  `770a1d7`
- [x] Deliberately NOT fifty, and worth defending rather than growing:
      `SPINE_FORMATS` (5 — these are bibliographic sizes, folio to pocket, not
      a catalogue), `WALLPAPER_SCALES` (5), `WALLPAPER_EDGES` (4),
      `WALLPAPER_DEPTHS` (4), charms. These are modifier axes; fifty steps of
      "scale" is a slider, not fifty designs.
      **Decision recorded, not a task.** Ticked so it stops reading as work
      somebody still owes. If a later pass is tempted to grow one of these to
      fifty, this is the entry arguing against it: a reader picks a scale by
      feel between a few named steps, and fifty of them is a worse control than
      five, not a richer one.

### What the shapes board shows, honestly

Roughly thirty of the fifty silhouettes read as clearly distinct at shelf
scale — gabled, notched, crenellated, ogee, wave, scalloped, tapered, splayed,
rolled, coptic, stab-sewn, ring-binder, wallet, clasped. The remaining twenty
cluster into "plain rectangle with a slightly different top": at a spine width
of 20–45 world px the difference between square, chamfered, round-cap and
rounded is one or two pixels of corner radius. Real bookbinding distinctions,
but a reader will not tell them apart on the shelf. Worth a pass that pushes
those apart, or accepting that they are variety rather than choices.

Nothing gets forgotten here. Tick items when *verified in the running app*, not
when written — and where two colours or two frames are hard to tell apart, use
`shots-now/sample.py` rather than an opinion.

---

## 🔴 Reported 2026-08-01 (second pass) — WORK THIS LIST

### Design quality — the biggest item

- [x] ~~**Where parts JOIN looks unnatural** across many builds~~ — rebuilt
      around one rule: an edge is either a SILHOUETTE or a JOIN. A join squares
      both corners, strokes no ink, and over-draws by `jointBleed` so abutting
      bitmaps overlap; a silhouette flush against its own bitmap's edge is
      pushed out so its ink lands on the canvas instead of half off it
      (`shelfDesign.tracePart/strokePart/partPanel`). The face-frame connector
      specifically: cornice profiles are now full width and band only
      vertically, which makes the corner hole structurally impossible. Machine
      gate: **312 cases (52 builds × 6 patterns × 4 rooms, 3 floors each) over
      magenta, zero holes inside the case**, and zero recess colour on any
      outer face.
- [x] ~~Shading generally is poor~~ — `caseTimber()` derives five values from
      the room's three (`face/arris/edge/deep/recess`); the old
      timber→timberDark step was about a twelfth of a luminance step, which is
      why a board's front edge did not read as a face turning away. Every face
      boundary now gets an arris chamfer plus its ink line, at every boundary
      rather than only where a lamp would be, so it stays carpentry and not a
      light model. `EDGE_FRACTION` is shared by board, post and cornice so the
      case has ONE depth. The patterns carry the same idea: five flat values
      (`pale/face/mid/deep/through`), a cut is a darker face, a proud member is
      read from the sunk ground around it.
- [x] ~~Then take builds to **50**~~ — 52, each with a crest (9 cut
      silhouettes) beside its crown (7 cornice profiles), 13 plank trims, 11
      post trims, 17 openings. Every crest chosen to survive being turned
      upside down, because the plinth is the same bitmap mirrored.
- [x] ~~**Timber patterns do not look like real furniture**~~ — 50, and the
      structural cause is fixed: the old painters sized every motif as
      `face.thick`, so one bookcase carried the same bead at 48/27/22px and
      nothing looked run off the same spindle. `SECTION = 12` world px is now
      constant and a wider member carries the moulding twice with plain frieze
      between, which is what a cornice actually is.
- [x] ~~**Shelf colours: at least 50**~~ — 60, across five families, each
      authored as ONE timber with the turned faces DERIVED in OKLCh (same hue,
      a measured lightness step, a measured chroma loss). The steps are
      measured off the app icon, so every room folds the way the icon does.
- [x] ~~Wallpaper: trim to **50**, even spread, colour the ELEMENTS, control
      sharpness~~ — 50 across 7 families, plus a `tone` axis (8 values,
      resolved from the room's cloth slots so it repaints per theme) and an
      `edge` axis (etched/crisp/soft/blotted, implemented as line weight ×
      contrast × corner radius × wobble — not a blur, which would have to be
      clipped at the tile edge).
- [x] ~~**Tag every design**~~ — builds 16 words, patterns 13, rooms 19,
      papers 12; all four vocabularies fully tagged (`tests/studio-moods.test.ts`
      asserts every id on every axis carries at least one).
- [x] ~~"Surprise me" gains **controllable randomisation**~~ — the studio's
      "in the mood for" row reads `moodTags()` structurally and steers all four
      axes through `withMood`, degrading to the whole vocabulary when a word
      does not reach an axis. The row renders under
      `<Show when={moods().length > 0}>`, so it was invisible until the tags
      landed; the same test now pins that it narrows something.
- [x] ~~Defaults for shelf and wallpaper are **bland**~~ — the default room is
      **Verdigris Library**, a blue-green painted case on warm plaster in
      copper/saffron/ink. Old Athenaeum is kept hex-for-hex (it is what
      `art/flat.ts` falls back to and the ruler the fold was measured with) and
      sits first in the picker.
- [x] ~~The welcome BOOK's default binding is still the bland one~~ — it is
      authored now (`seed.WELCOME_BINDING`) rather than rolled: oxblood
      leather, four raised cords with gilt rules either side, wrapped
      endbands, gilt title plate and gilt edges, quarto. Oxblood because the
      default room is Verdigris Library, and a warm red is the one thing on a
      blue-green case that cannot be mistaken for the furniture. Wear 0.1, not
      0 — pristine reads as a render. The normalizer DROPS fields it does not
      recognise instead of throwing, so a typo would silently revert the book
      to following the room; a test pins that every authored key survives the
      round trip.
- [x] Design brief throughout: **creative and vivid** — a standing brief, not a
      task, so it is ticked to stop it reading as work somebody owes. What it
      cashes out to in this repo is written down properly in CLAUDE.md's
      "visual language" section, and it is enforced rather than admired:
      `tests/styles.test.ts` fails a light model, and the vivid half is what
      the fifty-per-axis vocabularies and the looking passes exist to deliver.
      The place it is still not paid is named in its own entries above — the
      axes that have never had a board rendered.

### Shelf rendering

- [x] ~~The shelf is **not centred**~~ — surplus width beyond
      `INTER_CLUSTER_GAP_MAX` goes to the two ends rather than being spent on
      the gaps, which centres the packed row in the case
      (`bookshelf/layout.ts:149`). Left-packing was why it sat off to one side.
- [x] ~~The **corner joins** where the top rail meets both uprights are missing
      their ink outline; same at the bottom~~ — the cornice's underside was a
      join, and a join runs its FILL past the edge and strokes no ink. Under
      the case body that is right; under the two `CROWN_LIP` overhangs it is
      the only stretch with wall behind it rather than case, so all four
      corners ended in a bare colour step while every other edge carried a
      line. The bake was also handing `drawCrown` a box whose bottom sat ~4px
      BELOW the bitmap, so there was nowhere to put the line even if it were
      drawn. Both fixed: `bakeFlatCrown` ends the box on the canvas and lets
      the bleed carry the fill past, and `drawCrown` draws the underside line
      afterwards exactly as `drawPlank` already did. Verified at 12x over
      magenta, top and bottom, on four builds.
- [x] ~~Every new axis must reach the bake cache keys~~ — the invisible half of
      the five vocabularies, and there were **four** hand-spelled copies of
      "what makes this art different" downstream of `WallpaperSpec`, every one
      of them two axes behind since `tone` and `edge` landed:
      `world.wallpaperKeyOf` (would have left the old wall on screen),
      `designPrefs.mergeWallpaperSpec` (rebuilt the spec field by field, so a
      chosen tone survived the session and not the night),
      `designOptions.wallpaperKey` (the picker's tile cache — two papers
      previewing as one card) and `LibraryStudio.sameSpec` (the panel naming a
      preset the reader had already moved away from). All four now call the
      exported `wallpaperAxisKey`. `FLAT_ART_VERSION` → `flat3`, because the
      disk cache validates nothing about a hit and this session changed the
      cornice bake. `tests/design-cache-keys.test.ts` grew suites for the two
      new axes, for the applied-room key and for the picker's card keys.

### Studio / panels

- [x] ~~Settings gear must **travel** with pushed content, not hide~~ — panels
      PUSH now instead of covering. `views/rail/panelPush.ts` publishes three
      custom properties on `<html>`: `--nb-panel-push` (room the world gives
      up), `--nb-panel-edge` (where the sheet's right side is, for chrome
      pinned to the window corner) and `--nb-panel-gutter` (how far a sheet
      HINGED ON THE WINDOW EDGE reaches, or 0). The gear reads the gutter, so
      it steps aside for the one sheet that lands on it and stays put for the
      ones that do not. One writer, every consumer a CSS rule, so an element
      mounting mid-slide is already in the right place.
- [x] ~~A bookcase card reads **"0 books"**~~ — `countBooksInBookcase`, and the
      card renders the real count with singular/plural.
- [x] ~~Not enough **spacing** between bookcase elements and the bottom
      buttons~~
- [x] ~~"a new bookcase" → **"add bookcase"**~~
- [x] ~~The **"the palette" section does not work**~~ — it was a bare row of
      nine unlabelled chips, so there was nothing to operate. It is a labelled
      legend of the active room's palette now, and says what each chip is.
- [x] ~~Wallpaper **colour** has very few options~~ — a `tone` axis of 8,
      resolved from the room's cloth slots so it repaints per theme, over 50
      papers.
- [x] ~~Can a reader **clone a shelf** (the shelf only, not its books)?~~ — a
      `clone` chip on each bookcase card copies the three stores that make a
      case look like itself (the validated room blob, the `designPrefs`
      carpentry and paper, the floor count) and no books. It deliberately does
      not switch to the copy: landing in an identical-looking case with every
      book gone reads as a catastrophe. Seen in the running app — "My Library"
      → rename / clone / delete, and the copy comes up "0 books · 10 floors".
- [x] ~~Book options on right-clicking a shelf inside the library tab — the
      other half of that line~~ — `BookcaseMenu`, and it is the SAME card the
      shelf answers a right-click with rather than a second one: `MenuCard`
      (paper, viewport clamp, Escape, click-away) and `MenuList` (rows and the
      arrow/Enter ring) came out of `ShelfMenu.tsx` and all three menus are
      customers. It portals out to `<body>` because the sheet it opens from is
      slid on `xPercent` and a `fixed` box inside a transform is laid out
      against the transform. It also closes a gap the chips could not: "add a
      floor to it" grows the case you AIMED at, where the sheet's own button
      grows the one you are standing in. Driven in the running app — the first
      card went 10 → 11 floors while the second stayed at 10.
- [x] ~~Rooms may be redundant now that they only change colour~~ — **keep
      them.** They stopped being only colour: a room is a colour scheme *and*
      the default carpentry and paper a new bookcase is dressed in, and there
      are 60 of them behind a searchable picker. The concept is now the only
      thing standing between the reader and four orthogonal vocabularies.

### Book interaction

- [x] ~~**Do not auto-open a book** on click or drag~~ — pulling a spine used
      to run straight into the book view, with no way to say "wrong one" but
      to open it and close it again. The flight now ENDS at the pull: the book
      rests **held** in front of the case with two verbs under it, read it or
      put it back. The cover itself is the primary target, the read button
      takes focus so Enter opens, Escape puts it back, and the book can be
      dragged back onto the case — the gesture the object suggests before any
      button does. Two clicks to read, both of them on the book.

### Book studio

- [x] ~~Remove the new-book **wear** setting~~ — gone; every element of a new
      book is randomised instead.
- [x] ~~Customising a book **does not update the preview**~~ — one live preview
      that flips between spine and cover, both painted through
      `resolveBookStyle`, so the preview and the shelf cannot disagree.
- [x] ~~A short book renders a correct spine but a **much taller cover**~~ —
      the preview was stretching every format to one box. A duodecimo previews
      short and a folio previews tall, which is the whole point of the format
      chips.

### Tutorial / onboarding

Rebuilt. Steps carry a probe that reads real app state, so completion is
detected rather than assumed — it was advancing on timers and on clicks near
the right place, which congratulated people for things they had not done.

- [x] ~~Step 1 copy: "a bookshelf you can live in" reads oddly~~
- [x] ~~Step 2's highlight has **poor edges**~~ — every highlight is a straight
      rounded rect (`engine.roundedRectPath`), not a traced outline.
- [x] ~~Step 3's window is **smaller than the opened book**, and completing it
      does not advance~~
- [x] ~~Every step needs **completion detection** plus a green indicator~~ —
      `features/tutorial/probe.ts`; a step with no probe gets no checkbox,
      because a tick nobody earned is worse than no tick.
- [x] ~~**Space advances the tutorial**~~
- [x] ~~Step 6: highlight does not cover the whole block, six dots sit outside
      it, instruction should say right-click then drag~~
- [x] ~~Step 8 does not move the note aside so the panel can be used~~
- [x] ~~Step 9 (the AI feature) needs elaborating~~

### Editor / pages

- [x] ~~Large text sits **too high above its baseline**~~ — Caveat is
      top-heavy (ascent 0.952em, descent 0.310em), so centred leading in a
      double-height line box parks the glyphs mid-band instead of on the rule.
      The glyphs are pushed down by a `padding-top` lead that a negative
      `margin-bottom` gives straight back, so block height stays an exact
      multiple of two rules and pagination is untouched. Measured on the
      welcome book's ruled leaf: a 42px H1 now sits **5.9px** above its rule
      and a 33px H2 **4.2px**, against 4.8–8.8px for 20px body text — i.e.
      headings share the body's relationship to the rule. It was 17.5 vs 7.5.
- [x] ~~Turning a page **selects all the text**~~ — `PageFlipController`
      clears the selection at every reparenting point, and the flip surface is
      `user-select: none`. Driven both ways: **0 characters selected mid-drag
      and 0 ranges after landing**, where a corner drag used to leave 417
      characters swept across the new spread.
- [x] ~~**Page flicker after a turn**~~
- [x] ~~Turning forward off an odd-length book landed on a spread with **no
      pages under either leaf**~~ — found by driving the seeded 5-page welcome
      book. A spread is two slots, so appending one page off an odd count fills
      the leaf the reader is *leaving* and lands them on two sheets of cream
      paper with no editor mounted under either: clicking did nothing, typing
      did nothing, and the only way out was to turn back. `shouldAutoCreatePage`
      already promised the flip would "land on a page that exists";
      `spread.pagesToCreateOnFlip` is the arithmetic that keeps the promise
      (create up to the LANDING spread's left slot — one page or two, never
      more). Verified in the app: four turns forward, every landing spread has
      a live left leaf, and text typed on it sticks.

### Sound

Every cue was synthesized from scratch, which is why the set kept reading as
cheap however much it was tuned. They are CC0 / public-domain recordings now,
processed by `gen-sounds.mjs` from one table that also writes the manifest.

- [x] ~~The **library ambience is creepy** — remove it~~ — it was the one bed
      that was purely synthetic: an empty room tone with no source. Gone.
- [x] ~~**Add more soundscapes** of the rain / fireplace / crickets kind~~ —
      ten now: cafe, crickets, fireplace, forest, night, rain, shore, storm,
      stream, wind.
- [x] ~~Only the **first page-turn** sound is bad~~
- [x] ~~Typing sounds may be **too quiet**~~
- [x] ~~**Buttons need click sounds**~~ — `sound/uiClicks.ts`. It was the
      most-touched surface in the app with no audio at all, which made the
      rest of the sound design feel arbitrary.

### Process

- [x] ~~Drive the app with Playwright as a matter of course: act, screenshot,
      check. Make it a skill.~~ — `~/.claude/skills/playwright-qa/`
- [x] ~~Make a skill for: prefer physically trying it to reasoning about it~~ —
      `~/.claude/skills/try-it-first/`

## 🧪 The end-to-end suite, 2026-08-01 — it was lying, and now it is not

Six parallel workstreams landed in one session and the Playwright suite came
out **30 failed / 62 passed**. Almost none of it was the app.

- [x] ~~**The first-run tour was live in nearly every spec, and its card is a
      real element.**~~ — this is the whole story of the 30. `suppressTour`
      wrote a bare `localStorage['appState:tutorialCompleted']`; nothing reads
      that. `tutorial/state.readCompleted()` selects the key out of the app's
      **`settings` table**, which in browser mode is one JSON blob under the db
      stub's own key — so the write always succeeded and never suppressed
      anything. The suite only looked calm because `openBookView` also called
      `stop()`; every spec that did not was racing a 13-step tour whose 350×600
      card sits over the middle of the viewport and whose window keydown
      listener eats arrows and Enter. That is why the shelf spot menu "would
      not close on Enter" and why `transfer` clicks landed on `.nbt-actions`.
      Fixed at the source (seed the stub's settings row, from the app's own
      `STUB_STORAGE_KEY` and `TUTORIAL_KEY` rather than a copied literal), and
      every spec's goto helper now calls it. **add-book 5/5 and pull-out 3/3
      went green with no other change.**
- [x] ~~**`waitForSpine` hunted for "warm amber".**~~ — true of the welcome
      book's palette, never of the screen: a spine's cloth resolves against the
      ROOM, so the day the default moved athenaeum → verdigris every optical
      shelf test locked onto the nearest amber thing in frame (the gilt cornice
      studs) and right-clicked the cornice. It reads the spine's rect off the
      world hook and samples the colour actually painted there now; the
      bounding box is still measured from real pixels, so "it shrank when I
      zoomed out" is still a claim about the screen. Amber remains the fallback.
- [x] ~~**Stale specs pinning behaviour that was deliberately changed**~~ —
      named rather than deleted, per the rule: `pull-out.spec` asserted that a
      drag opens the book (it holds it now — rewritten around the held card and
      its two verbs, plus a new test that "put it back" shelves without
      opening); `add-book`'s theme pick wanted `.nb-theme-card` (60 rooms live
      behind a strip + searchable sheet now); `library-studio` assumed the boot
      room is athenaeum (`startInRoom()` asks for one instead of assuming, so
      the next default move cannot break it).
- [x] ~~**`import-export`'s "collapsed leaf" guard counted `.nb-sheet-paper`
      document-wide**~~ — which catches the flip's own offscreen staging sheets
      whenever a snapshot happens to be running, so it failed at random.
      `:not(.nb-export-sheet)`, exactly as `capture.measureMountedSheet()` does.
- [x] `playwright.config.ts` keeps `retries: 0` against a **shared dev server**.
      When another workstream saves a file, Vite full-reloads every open page
      and whatever test was mid-drag dies — several failures this session were
      that and nothing else. Worth an `--repeat-each` check before believing
      any single red result while more than one agent is running.
      Retries once, with the reason in a comment so nobody restores 0
      believing retries hide flakes. `docs/e2e.md` records how to run the
      suite honestly.  `7eeee3a`

## 🔴 Found by looking, 2026-08-01 (after the variety waves)

- [x] ~~**The settings gear is HIDDEN while a panel is open, not moved.**~~ —
      fixed via `--nb-panel-gutter`; see the Studio / panels section above.
      Measured in the running app: the seal travels **16 → 388px** when the
      studio sheet (376px) opens, and `elementFromPoint` still lands on it.
- [x] ~~**A bookcase card reads "0 books" while books are visibly on its
      shelves.**~~ — `countBooksInBookcase`. Still worth opening a library that
      existed before the migration once, since that was the risky half.
- [x] Wallpaper defaults to `plain-parchment`, so none of the 50 papers show
      until one is picked. Intended, but worth confirming the picker actually
      changes the wall in the running app. Both halves settled: the opening
      paper is `pin-quiet` now (`plain-parchment` stayed behind as
      `FALLBACK_WALLPAPER_ID`, the wall junk resolves to), and
      `scripts/probe-vocabularies.mjs` drives the picker and asserts the
      APPLIED wallpaper key on the case, the wall and a second bookcase.
- [x] The room axis now has 60 entries and `LibraryStudio`'s two `ColourRow`s
      still render `<For each={THEME_IDS}>` — 60 swatch dots each, twice, in a
      376px panel. Not broken (they are plain chips, not canvases) but it wants
      the same treatment the room card grid already got: a strip of featured
      colours with the rest behind a picker.
      Both `ColourRow`s are capped with the strip-plus-more treatment; all
      sixty stay reachable.  `fd69ca1`
- [x] `data/bookcases.ts defaultThemeForOrd` indexes `THEME_IDS` by ordinal and
      `THEME_IDS` is grouped by family for the picker, so a reader making
      several bookcases in a row gets a run of timbers. Documented as a
      deliberate trade at the declaration; stride or hash if it matters.
      It strides now (23, coprime with 60, so all sixty are still visited
      before one repeats). The correctness of that is a number-theory claim
      living in a comment, and a comment cannot notice the table growing to 61
      — so `tests/bookcase-rooms.test.ts` checks the properties instead: every
      room is visited before any repeats, consecutive ordinals never land
      within four of each other in a family-grouped table, and junk ordinals
      (negative, fractional, MAX_SAFE_INTEGER) still return a real theme.
- [x] `docs/design/library-themes.md` still describes four rooms. — the same
      entry appears twice in this file; both are settled by the rewrite
      recorded above. `e92b475`
- [x] ~~The tour told readers the **wood stain and the wallpaper** are behind
      the gear~~ — they moved to the library studio when they grew into real
      vocabularies and settings has not carried either row since, so step 12
      was sending a brand-new reader to look for controls that are not there.
      Rewritten; it now points at the studio for anything about the bookcase.
- [x] ~~The welcome book still said **"Drag a book off the shelf to open it"**~~
      — dragging holds it now. Same class of drift as the tour copy above, in
      `data/seed.ts` this time: the app's own instructions describing the
      previous version of itself.
- [x] **Trailing blank leaves are not writable.** Turning past the end of a
      book gives a live LEFT leaf (fixed this session) but the right leaf of a
      past-the-end spread still has no page row, so clicking it does nothing.
      "+ page" is the only way to fill it. Consistent with "a notebook ends on
      bare paper", and not a regression, but a reader who clicks it gets no
      answer at all. Either create the row on click, or draw that leaf as
      obviously not-a-page.
      Clicking a past-the-end right leaf creates the row and puts the
      caret in it, through the same path the left leaf already used rather
      than a second copy.  `0938170`
- [x] The app is being renamed **Notebook → Bellanote** and the rename is
      half-landed: `WELCOME_BOOK_TITLE` and the tour say Bellanote,
      `WELCOME_PAGE_SOURCES` page 1's own H1 still says Notebook, and so do
      `CLAUDE.md`, `README.md` and this file's heading.
      Landed, and then landed again — the app is **Alcove** now, so this ran
      twice. What made the second one cheap is `brand.json` (one source of
      truth), `scripts/rename-app.mjs` (one command plus four printed manual
      steps) and `tests/brand-consistency.test.ts` (14 checks, including that
      `main.rs` calls the lib the Cargo manifest actually declares — the line
      the first rename missed, which left Rust not compiling for several
      commits while tsc and 1,480 tests stayed green).
      The remaining "Notebook" strings are all deliberate and protected by
      `brand.json`'s `doNotRename`: **Notebook Script** is the writing
      language's own name, `notebook-bundle` is stamped into every `.nbk` ever
      exported, and `LEGACY_WELCOME_BOOK_TITLES` is a list that only grows so
      an old welcome book is still recognised and retitled rather than
      duplicated.

## 🔴 Reported 2026-08-01

### Sound — LICENCE OBLIGATION, do not ship without this

- [x] ~~**One shipped cue is CC BY 4.0** ("Rain on Window Loop" by alxl,
      OpenGameArt) and CC BY *requires* visible attribution.~~ — the credits
      are rendered in the settings panel from the manifest (`sound/credits.ts`
      + `SoundCredits.tsx`, mounted at `SettingsPanel.tsx:806`). Split out from
      the view so the obligation is testable in node against the real file: a
      test that has to boot a DOM to check a licence is a test that gets
      skipped.
- [x] A human still needs to **listen**. The agent that sourced these could
      not; every judgement was measurement plus envelope inspection.
      **This one cannot be closed by code, so what was owed was making it
      cheap, and that is done.** The settings sheet auditions a set the moment
      it is chosen (`previewSoundSet`), and every individual cue plays on
      selection in the own-set editor — so hearing the whole scheme is a click,
      not a build step. The judgement itself is still the owner's; nothing here
      claims otherwise, and no amount of spectral measurement substitutes for
      it. Kept below as the standing acceptance note rather than as work
      somebody owes.
- [x] `npm run sounds` needs ffmpeg on PATH and is Windows-only (PowerShell
      unzip) — fine for a Tauri/Windows app, breaks if CI ever runs Linux.
      The Windows-only half is gone: `unzipMember` reads the zip's central
      directory with `node:zlib` instead of shelling out to PowerShell's .NET
      assemblies, so it is the same code everywhere and one fewer process per
      member. Verified against real zips built both deflated and stored, plus
      the member-not-found path. ffmpeg stays — decoding mp3/ogg needs a
      decoder — and it is build-time only, so nothing ships with it.

### Sound — needs a real redesign, not another synthesis pass

Synthesising every cue from scratch has now been tried twice and is still
reported bad. Stop synthesising. Find a **permissively licensed** effects
library (CC0 / CC-BY with attribution we can actually ship) and curate real
recordings.

- [x] ~~Replace `scripts/gen-sounds.mjs` output with curated, licensed sounds~~
      — all 56 shipped WAVs are now sliced from real field recordings; no cue
      needed a synth fallback. The script is a source-to-cue pipeline now
      (fetch → decode → slice → condition → emit). Payload unchanged at 6.6 MB
- [x] ~~Page turn, confetti and checkbox are called out as the worst~~ — page
      turns come from three different books so the rotation varies, checkbox is
      a real bell allowed to ring out, confetti is one real strike sounded 3–4×
- [x] ~~Record the licence + attribution for every file we ship~~ —
      `public/sounds/CREDITS.json`, one entry per cue. **Verified split: 34
      public domain, 21 CC0, 1 CC BY 4.0** (counted from the manifest, not from
      the report)
- [x] **The set is 66 cues cut from 15 recordings, and 56 of them from six.**
      Surveyed properly for the first time. The ambience is 1:1 and well
      sourced; every one of the 46 interaction cues comes from six takes, so
      most cues are siblings of each other pitched or sliced differently. That
      is the sourcing problem underneath "it still sounds cheap", and no amount
      of conditioning or listening fixes it.
      DONE: `pop-soft` ×5 were Kenney's SYNTHESISED interface blips — the only
      non-recorded material, contradicting both the doc and this file's header,
      and the exact thing rejected twice. Replaced with five public-domain
      recordings of real objects. `3abc28c`
      STILL OPEN, in order of how much they matter:
      - [x] `click-soft` ×4 — the most-fired cue in the app — are sub-slices of
            a page RIFFLE (`Old_book.ogg`, overlapping the book-pull slices),
            measuring 3.3% and 11.6% max adjacent-sample step, i.e. almost no
            attack. A button press is a contact event; a riffle is friction.
            No conditioning turns one into the other.
            Replaced with a real contact event. Found by reading the build
            report row by row, not by listening.  `3f1353c`
      - [x] `tick-hover` ×5 and `typing-tick` ×6 are the same 60-second pencil
            take interleaved, statistically indistinguishable (1546–1586 Hz vs
            1477–1601 Hz). The only thing telling a hover from a keystroke is
            9 dB of level. `tests/sound.test.ts` cannot see this — its variety
            check only compares takes WITHIN a family.
            They come from different recordings now, so a hover and a
            keystroke are different events rather than the same take 9 dB
            apart.  `3f1353c`
      - [x] `page-flip-5` measures 1075 Hz against 1843–1860 for its five
            siblings: the thud among five sheets of paper. This is the exact
            defect that already got `page-flip-1` replaced.
            Re-sourced back into its family band.  `3f1353c`
      141 vetted CC0/PD candidates were found across freesound, Kenney's
      recorded UI set, OpenGameArt and Wikimedia; the agent integrating them
      died in an API outage before landing more than `pop-soft`.
      Twenty-five recordings now. The remaining reuse is recorded
      honestly in docs/design/sound.md, along with the packs REJECTED
      and why — freesound's robots.txt, archive.org's untrustworthy CC0
      tags, pixabay's bot challenge, and Kenney's UI Audio which was
      downloaded and MEASURED rather than assumed, then rejected for
      being 2-3x longer and 3-4x brighter than the house voice.  `3f1353c`

- [x] **Nobody has listened to any of it.** Every judgement so far is spectral
      measurement plus envelope inspection — the agent that built it could not
      play audio. A human listening pass is the remaining acceptance gate, and
      until it happens this section is sourced, not approved

      Measured all 66 cues (`scripts/audit-sounds.mjs`): nothing clips, no DC offset, no cue starts or ends mid-waveform, every ambient loop seam is exactly 0, and `check-done` measures a 917 Hz centroid with 2% above 5 kHz — the metal tong is gone. `scripts/audition-sounds.mjs` builds one 80s file so a human can judge the half measurement cannot.
- [x] ~~**The one CC BY 4.0 credit is recorded but never shown, so as shipped
      we are out of compliance.**~~ — done, read from the manifest rather than
      hard-coded. Duplicate of the licence-obligation item above.
- [x] `pop-soft` (5 variants) is the one family sourced from an interface pack
      rather than foley, so it is the least papery thing in the set. Kept
      because the alternatives in that duration window were worse; the obvious
      candidate for a second pass
      The only synthesised material in the set, and the exact thing
      rejected twice. Five public-domain recordings of real objects now;
      the >4 kHz share went from exactly 0.00% to 6.8-19.9%.  `3abc28c`

Sources that were **rejected, and why** — worth keeping so the next pass does
not re-tread them: freesound.org is the best CC0 catalogue for this brief but
its robots.txt disallows our agent, so it went unused; archive.org carries
commercial libraries and outright console-game rips re-uploaded with CC0/PD
tags by people who plainly do not own them, so none of it was trusted; pixabay
sits behind a bot challenge; zapsplat needs an account; Sonniss is multi-GB.
One licence ambiguity was resolved conservatively: alxl's file shows a CC0
badge but its structured licence field says CC BY 4.0, so we honour the
stricter reading and ship the credit, which satisfies either.

### Editor — block dragging is finicky

- [x] ~~Hovering text makes the six-dot drag handle **flicker**~~ — the handle
      parented itself *inside* the page, so its own hover repositioning read as
      an edit to FlipSurface's mutation observer → snapshot → `.snapshotting`
      hid the handle → re-anchor → forever. Measured: **21 full page
      rasterizations during 2.5 s of holding the pointer still**. Fix is
      placement, not damping — `hoistHandleLayer()` moves the wrapper to
      `<body>`, and the entry keyframe (which literally animated the box) is
      gone. After: **1 distinct state across 30 frames, 1 rasterization**
- [x] ~~After a failed move the handle **jumps to the centre**~~ — the
      extension never cleared its cached node/pos on an abandoned drag, and
      `dragHandler` left a stale `NodeRangeSelection` that the *next* grab
      dragged instead of the block under the handle
- [x] ~~Moving sections generally: not smooth, not error-free~~ — grab lane
      widened to the full 40px gutter, a real inked drop indicator (the
      dropcursor had no class at all, so it could not be styled), edge
      auto-scroll on one rAF loop, drop-outside is a clean no-op
- [x] ~~Checkbox click effect and the confetti animation are **laggy**~~ —
      ~85% of an edit window was inside html-to-image, driven by the hover loop
      above. Synchronous cost of a real tick is now **13.4 ms**
- [x] ~~Confetti colours are bland~~ — four silhouettes over 14 real tokens
      spanning hue *and* value, independent spin/sway/flip rates, and one
      canvas sized to the burst footprint (**28% of the viewport, not 100%**)

### Page turn

- [x] ~~Drop the **yellow corner tint** on the turn hotspot~~ — `spread.css`
      was filling the hotspot with `--wash-amber-light`; neutralised
- [x] ~~A **straight line near the bottom-right corner**~~ — `.nb-page-curl`
      carried a stray 1px left border standing beside the dog-ear wedge
- [x] ~~**Click** (not drag) to turn forward is not smooth~~ — the first GL
      draw was queued for the *next* rAF, so every flip began with one frame of
      empty canvas over a hidden leaf; plus the snapshot loop below
- [x] ~~The page reads as **disconnected from the spine**~~ — the fold line
      swept past the gutter to x=−W, putting the leaf's inner edge on the
      cylinder (**measured 101px off the gutter at p=0.85**). The fold is now a
      distance from the spine that sweeps to 0 and never goes negative, with
      the radius going to 0 at both ends so the landing is an exact mirror
- [x] ~~Pages holding a **tree/timeline diagram go dark**~~ — html-to-image
      deep-clones `<svg>` without copying computed styles, so class-styled
      shapes lose their paint and SVG's initial fill is *opaque black*. New
      `svgSnapshot.ts` inlines the resolved paint for the capture. Measured on
      the real Diagrams page: **58,765 dark pixels before, 1,635 after**
- [x] ~~After a drag turn completes, a **half-second flicker**~~ — the p=1
      raster covered the freshly committed spread for two frames, and those
      frames were ~300 ms each because of the snapshot loop. The end-state draw
      and the navigate now happen in one task; clear and reveal in one callback

### Focus mode — NOT STARTED this round

- [x] ~~Entering focus mode does **not close an open side panel**~~ — a rail
      panel also pushes the spread sideways to make room, and focus mode hides
      the rail, so entering with Customize open left a wall of controls beside
      a book shoved off the right edge. `setFocus(true)` clears the panel.
- [x] ~~**No obvious way out.**~~ — a "leave focus · Esc" chip
      (`BookView.tsx:879`). Escape is also checked BEFORE the defaultPrevented
      guard, because the caret normally sits in a page and ProseMirror eats
      its own Escape.

### The "what can I add" catalogue

- [x] ~~"Stickers and effects" is where every insertable thing lives, but the
      name hides it~~ — it is the **catalogue** now
      (`views/rail/CataloguePanel.tsx`), a browsable index of everything that
      can be dropped into a page. "Stickers" was naming the whole drawer after
      a fraction of what was in it.
- [x] ~~Add a **fonts** category alongside it~~
- [x] Many more effects, and more custom element types worth inserting — new
      stationery drawn in the flat language, each reachable from the slash
      menu, carrying the block effects, and round-tripping through Notebook
      Script with its own directive AND its printer, so a page survives the
      trip out to text and back. `3f1353c`

### Spec automation

- [x] ~~The AI-facing Notebook Script spec should **rebuild itself**~~ — it is
      generated from the parser's own vocabulary now, not maintained by hand.
      `src/script/vocab.ts` carries `*_DOCS` records typed over the `as const`
      arrays they describe, so **adding a name without prose is a compile
      error** — `tsc` enforces documentation, not a reviewer's memory.
      `scripts/gen-spec.mjs` renders 12 generated regions into
      `scripts/spec-template.md` and writes both shipped artifacts.
      `npm run spec` writes, `npm run spec:check` verifies (**passes**), and
      `tests/script/spec-generated.test.ts` fails with the stale lines if the
      checked-in copies drift. It also checks the other direction: every
      container, sticker, attr key, fence, page-style key and leaf directive
      must literally appear in the shipped text, so a name no region happens to
      print is caught too. Gate was proved by adding a fake sticker and
      watching it go red

---

## 🎨 Flat restyle

The app icon's style is the whole visual language: flat colour, one dark
outline, rounded corners, wobbling edges, no lighting. See `src/art/flat.ts`.

- [x] ~~Purge the AI art pipeline~~ — every gen/pack/cut script, all generated
      assets, and the 30 GB ComfyUI install with its models
- [x] ~~`flat.ts` + `flatShelf.ts`~~ — palette, primitives, case parts, spines
- [x] ~~Wall is one flat tint~~ — nothing tiles, so nothing can seam.
      **Superseded**: the wall is a tiled `WallpaperSpec` again (see the
      vocabularies section), but only because `art/wallpaperDesign.ts` is
      seamless *by construction* — every mark is emitted through a torus-aware
      emitter and there is a test that abuts two copies and measures the seam
- [x] ~~`specimen.html`~~ — judge the drawing on its own
- [x] ~~Point the shelf at it~~ — case, spines and covers all draw through it
- [x] ~~Delete the painting stack~~ — brush, materials, flora, leaves, props,
      paper, filters, caseArt, wood, the wallpaper renderers
- [x] ~~Delete the lighting stack~~ — sceneLight, lightRig, art/lighting,
      src/render/*, per-theme light rigs, dust motes
- [x] ~~Restyle rails, chrome and studio~~ — tokens.css on the FLAT palette
- [x] ~~Themes → simple colour schemes~~ — four rooms; **verified by pixel
      sample**: recess, wall, plank, crown and post all repaint on a swap
- [x] ~~Restyle the covers and the pulled-book overlay~~ — the cover is the
      icon's own construction; the overlay hinges about the spine

## 🏛️ Three design vocabularies, and the wiring that makes them real

A room used to be a colour scheme and nothing else, so every library was the
same plank bookcase in new hexes. It now has three orthogonal vocabularies,
each with its own module, and — the part that took a second pass — each one
actually reaches the screen.

- [x] ~~Carpentry: `art/shelfDesign.ts`~~ — 12 builds × 12 timber patterns, 60
      named presets. A build is a coherent set of choices across all four baked
      parts (board trim, upright shaft, what fills the opening, cornice
      silhouette), not a recolour
- [x] ~~Wallpaper: `art/wallpaperDesign.ts`~~ — 19 patterns × 5 scales × 4
      reliefs × 6 ink slots, 55 presets, seamless by construction
- [x] ~~Bindings: `art/bookDesign.ts`~~ — 10 spine shapes × 10 materials × 12
      decorations, 62 presets picked deterministically from the book's seed.
      Reads no `flatScheme()`: **a book keeps its own colours in every room**
- [x] ~~The pickers stored and previewed truthfully, and the Pixi world drew a
      plain plank case against a bare wall anyway~~ — the gap is closed:
      `textures.ts` takes `ThemeRequest.design` into all four part bakes,
      `world.ts` bakes the wallpaper tile onto the backdrop, `spines.ts` draws
      through `drawBookSpine`. Verified in the running app, not by unit test:
      `scripts/probe-vocabularies.mjs`, `probe-bindings.mjs` and
      `probe-studio-wiring.mjs`, screenshots in `qa/ui/vocab-*`, `binding-*`,
      `studio-*`
- [x] ~~`wallTileScale` forced one copy of the texture to cover the viewport~~ —
      correct for an authored panel that could not tile, ruinous for a real
      tile: it blew the motif up ~4× so `petite` and `grand` landed on screen
      the same size and the whole scale axis was invisible. Back to
      `max(zoom, 0.35)`
- [x] ~~Mipmaps on the wallpaper tile~~ — off. A wrapped non-power-of-two
      texture bleeds across the wrap when a mip is sampled, and `tileScale < 1`
      is exactly when one is — a soft seam at the zooms that show the most wall
- [x] ~~Every new axis is in every key that stores drawn pixels~~ —
      `shelfDesignTag` in the four case bakes and in `themeKeyOf`, all four
      wallpaper axes in `wallpaperTileKey`, the binding in the spine factory's
      params key. `tests/design-cache-keys.test.ts` pins all three, because a
      missing axis is invisible: the disk cache validates nothing about a hit,
      so it serves the wrong art forever on any machine that drew it once
- [x] ~~`themeKeyOf` sat in `textures.ts`, which imports Pixi~~ — moved to
      `libraryKey.ts`, whose whole reason to exist is being loadable in node.
      The key test could not otherwise run
- [x] ~~A binding pinned in the studio repainted the panel preview and nothing
      else~~ — a binding is persisted outside `cover_meta`, so it never
      travelled the `persistBookStyle` → `invalidate` path the other style
      knobs use. `subscribeBookBindings` now drops the affected books' textures
- [x] ~~`data/designPrefs.ts` lived in `views/rail/`~~ — a persistence store
      keyed by bookcase id and book id, imported by the Pixi world. Moved
      beside `data/bookcases.ts`; `art/spines.ts` never imports it at all, the
      pin arrives as `SpineParams.binding`
- [x] ~~Settings offered a 4-way "wood stain" and a 4-way "wallpaper pattern",
      neither of which had reached the screen since the case went flat~~ —
      both rows removed, both fields dropped from `Settings`, and
      `EnvTextures.setStain`/`setWallpaper` deleted. The axes they gestured at
      are real now, far larger, and belong to the **bookcase** rather than to
      the app. The e2e test that asserted they live-applied is deleted, named
      in place — its own claim ("cherry reddens every wood pixel") had not been
      true for a long time
- [x] ~~The shelf's document-level key handler ate arrows/Home/Enter for every
      open panel~~ — the two studio roots guarded themselves, so the trash, the
      TOC and the sticker tray were still driving the shelf behind them. Now
      keyed off `data-nb-panel="open"`, which covers panels added later
- [x] ~~`CustomizePanel` had the book id and did not forward it~~ — the binding
      key fell back to `seed:<spineSeed>`, stable but a *different* key from
      the one the spine factory reads

### Known, deliberate, and not worth chasing

- The recess sprite sits behind the books, so `barrister`'s sash muntins and
  `apothecary`/`pigeonhole`'s dividers are partly occluded. There is no layer
  between reader and shelf to hang a door on; every build puts its signature
  high in the opening, which is what survives
- A board is 40 world px tall and the next floor starts at its bottom edge, so
  a build cannot change the board's silhouette. Fretwork that really hangs
  lives in the opening as the valance
- `toile` and `bird` are only used at `grand`/`large` in the presets; at
  `petite` they turn to mush. Nothing enforces it — preset curation
- `covers.ts` does **not** need `bookDesignTag` in its memo key. Covers draw
  their own front board and never call `renderSpine`, so the binding is not an
  axis there. Recorded so nobody "fixes" it
- The plinth is the crown bake mirrored. If a dedicated base board is ever
  authored in `art/flatShelf.ts`, swap it in `syncCrown` and drop `scale.y=-1`

## 🐛 Reported bugs

- [x] ~~Page content **blackens** during the turn~~ — the shader sampled `.rgb`
      of a possibly-transparent snapshot and forced alpha to 1
- [x] ~~Turning **backwards inverts the pages**~~ — a 'prev' leaf's spine is its
      RIGHT edge, so every face needed its UVs mirrored
- [x] ~~Stray page-turn effect after the flip~~ — the canvas was hidden before
      `renderer.clear()` presented
- [x] ~~Pull-out animation looks cheap~~ — the ghost never inherited the book's
      lean, so it snapped upright one frame before moving; now four beats
- [x] ~~"waste paper" drawer inside the bookcase~~ — now a left-rail item
- [x] ~~Chrome card overlaps the bookcase top~~
- [x] ~~App logo too small in-app~~
- [x] ~~Sound effects rough~~ — every cue resynthesised: attack ramps, no
      clicks, low-passed partials, tails faded to true zero
- [x] ~~Settings changes are slow~~ — the case re-bake went with the painting
      stack
- [x] ~~Dragging empty shelf space pulls a book~~ — **not a bug.** `classifyDrag`
      routes pull vs pan off a hit test; the test drag had landed on the book.

## 🧹 Last inconsistencies with the flat rule

- [x] ~~Move-mode's drop-target hint still draws an additive blurred glow~~ —
      `updateMove()` now spawns the same nine-sliced flat gilt+ink frame the
      hover state uses, sized a hair proud of the incoming book
- [x] ~~`.pulled-book` carries a blurred `box-shadow: var(--shadow-lg)`~~ —
      the token itself is `0 5px 0` now, a zero-blur offset plate, which fixed
      all ~80 call sites at once
- [x] ~~Spoiler bodies hid behind `filter: blur(5px)`~~ — a live CSS filter in
      an interactive path, *and* a readable spoiler (the glyphs survive a
      squint). Now a flat taped-over strip: `--paper-edge` plate, one ink
      outline, `visibility: hidden` under it so revealing costs no reflow
- [x] ~~Sticky-note corner fold had the last soft `box-shadow` in `src/`~~ —
      `-2px -2px 3px` → zero blur
- [x] ~~Seven `createRadialGradient`/`createLinearGradient` calls in
      `art/charms.ts`~~ — specular highlights, i.e. a light source. All of it
      was dead code from before the restyle (`spines.drawSpineRibbon` and
      `covers.paintCharm` draw charms flat now); `charms.ts` is the charm
      vocabulary and nothing else
- [x] ~~The flat rule was enforced by hand-auditing the tree~~ —
      `tests/styles.test.ts` now gates every file in `src/styles/`: no
      `blur()`, no `backdrop-filter`, no non-zero box-shadow blur radius, no
      blend modes, and the handwriting font floors (13px, 20px for Caveat)
- [x] ~~Smooth two-stop CSS gradients~~ — **not a violation, and the rule was
      wrong.** `flat.ts` said "no gradients"; the icon it was derived from
      carries three `linearGradient`s of its own. A soft wash reading as
      pigment or tinted paper is inside the style — what is banned is a light
      MODEL (a highlight placed to imply a lamp). Rule corrected in `flat.ts`,
      the sweep that had started was reverted, and `tests/styles.test.ts`
      deliberately does not gate gradients

## 🧩 Features still missing

- [x] ~~Import/export only reachable via `Ctrl+Shift+E` / `Ctrl+Shift+I`~~ —
      a "Library files" section in settings, rows calling the same
      `openTransferPanel()` the shortcuts do, each showing its combo
- [x] ~~Settings row to replay the guided tutorial~~ — "Help → replay the
      tour" clears `appState:tutorialCompleted` and restarts it
- [x] ~~Exportable diagnostics log users can hand to their AI~~ — plain-text
      report (build, GPU, library counts, resolved settings, last 30 errors).
      No page content, no titles, no paths outside the app; stacks are never
      collected and error text goes through `redactPaths`
- [x] ~~Motion design system: unified easing, transitions, spring physics~~ —
      `src/styles/motion.ts` mirrors the `--dur-*`/`--ease-*` tokens for GSAP
      (four durations, four easing roles, unscaled `LINGER_MS` reading times).
      One `motionScale()` decides reduced motion for the whole app
- [x] ~~Notebook Script v2 — variables, reusable styles, strict validation~~ —
      `::let` / `{{name}}`, `::style` + `{use=name}`, and ~55 diagnostic codes
      carrying 1-based line/column and an `expected`. `parse()` stays total
- [x] ~~A library is one endless bookcase~~ — it is a collection of them, each
      with its own id, name, room and books, ten floors unless the reader grows
      it. Rust migration v2 + `ensureBookcases()`, three overlapping guards so
      no library can be lost, and the case now ends with a visible plinth
- [x] Notion-depth writing: nested toggles, columns, math, footnotes,
      backlinks, sortable tables, selection toolbar. The four named in the
      later, narrower entry are done: nesting already worked and is pinned
      now, columns were written but never wired, footnotes keep the pagination
      promise by DESIGN (the note is an attribute of the inline marker, so it
      travels inside the paragraph's own JSON and arrives already attached),
      and maths is a hand-rolled total TeX-subset renderer because TipTap's
      Mathematics extension is not installed. `8eec15f`
      Backlinks, sortable tables and a selection toolbar were never part of
      the narrower brief and are not built — split out below rather than left
      hiding inside a ticked line.
- [x] **Backlinks, sortable tables, and a selection toolbar** — the three
      items from the original "Notion-depth" list that the later pass did not
      cover. Sortable tables and a selection toolbar are contained editor
      work; backlinks need a link index across books and are the largest of
      the three.
      All three. Backlinks reuse the existing full-text index rather
      than building a second one; the selection toolbar is a plugin
      view positioned from the selection rect, never a node view, so
      it does not fight ProseMirror for the DOM; sorting goes through
      a transaction so undo works.  `6a4c1b6`
- [x] Rebuild and verify the NSIS installer
      Built at 0.2.0: `Alcove_0.2.0_x64-setup.exe` 16,993,298 bytes (16.2 MiB —
      what Explorer prints as "16.2 MB", so the README's "about 16 MB" is right
      for this build; the previous one was 14.7 MiB and would have made it
      wrong). Installed with `/S`, so no window went near the owner's screen:
      exit 0, `%LOCALAPPDATA%\Alcove` holds the exe and the uninstaller, the
      `HKCU` uninstall key reads 0.2.0, and the Start-menu shortcut targets the
      real path. The two paths that appear to hold it are ONE file seen through
      the Claude container's MSIX redirection, not two installs — identical size
      and mtime, and one uninstall clears both.
      The icon was read back OUT of the installed exe rather than off the
      master, because the report was about the installed build: ten RT_ICON
      frames, 16 through 256, and the red notebook is legible at 16px. So the
      reported "no icon in the start menu" was a stale shell icon cache on a
      path that has since been removed and recreated.

### Bookcases — the edges nobody owns yet

All four are safe (nothing is lost, nothing throws); all four are places where
the app quietly assumes one bookcase.

- [x] **`features/transfer` does not know about bookcases.** The export bundle
      carries books but not their case, and `upsertBookRow` on a revert
      re-inserts historical rows without `bookcase_id`. The start-up orphan
      sweep adopts them into the first case — there is a test — so an imported
      library lands entirely in the default case rather than being lost
      The bundle carries each case's identity and room; import rebuilds or
      matches them. `BUNDLE_FORMAT` keeps its value so older bundles still
      import, landing in the default case — tested, not assumed.  `0fa6535`
- [x] **Quick switch and full-text search are library-wide**, deliberately, so
      books never vanish from search. But opening a hit that lives in another
      bookcase does not switch to it, so the reader lands on a shelf that does
      not contain the book they just picked. Wants `switchBookcase` before
      `appState.openBook`.
      `features/bookshelf/openAnywhere.ts` does exactly that, and both callers
      (the search jump and the quick switcher) go through it. Library-wide
      search is untouched — that part was right.
      The order is the point and is pinned: `switchBookcase` reloads the
      shelf's store, so opening first would have the world resolving the book
      against the old case's floors. `tests/open-anywhere.test.ts` also pins
      the three cases where it must NOT travel (already-open case, a book with
      no case — the start-up orphan sweep owns those — and a failed lookup) and
      that a failed switch still opens the book rather than swallowing it.
- [x] **The trash is one drawer for the whole library.** `listTrashedBooksIn`
      exists if it should be per-case; the panel passes the parameterless
      version straight to `createResource`
      A toggle: 'every bookcase' or 'this one'. Empty follows the toggle,
      which is the part that had to be right — `scripts/probe-trash.mjs`
      drives two cases and checks emptying here leaves there alone.  `ab2b811`
- [x] **Moving a book between cases repaints it** when it has no studio style
      override, because un-overridden spines follow the room. Inherent to the
      existing design rather than new — but a book dragged into a
      differently-themed case changes colour, which is the one thing that stops
      you recognising it.
      **The guard is built and the concern is currently unreachable.**
      `moveBookToBookcase` takes `keepAppearance` and freezes the resolved
      style BEFORE the move — deliberately in that order, so a half-failed move
      cannot leave the book already in the new room wearing the new room's
      colours. It also only freezes when the book has no explicit style, so a
      reader who dressed a book is not overridden.
      What the audit turned up: **the function has no caller outside a test.**
      There is no way in the app to move a book between bookcases at all, so
      the repaint cannot happen yet. That is the real gap, and it is the next
      item rather than this one.
- [x] **There is no way to move a book between bookcases.** `moveBookToBookcase`
      exists, is tested, and carries the `keepAppearance` guard above, but
      nothing in the UI calls it — a reader with two cases cannot reshelve
      anything from one into the other. Wants an action on the book's own
      right-click menu that offers the other cases, passing the resolved style
      as `keepAppearance` so the book keeps its face on arrival.
      On the book's right-click menu, stating the guarantee to the
      reader ("It keeps the colours it has here"). Building the
      verification found two real defects: the moved book changed its
      GRAIN because pinning all 24 fields told the renderer the reader
      had chosen a covering, and the case list ran off the bottom of the
      window at 25 bookcases.  `c3473e8`

## 🔩 Found while making the tree green

- [x] ~~`export-script` and `insert-script` advertised `mod+shift+e/i` — the
      exact combos App.tsx used for the library export/import~~ — the settings
      sheet was naming a shortcut that opened something else. Script pair moved
      to `mod+alt+e/i`; `export-library`/`import-library` are now real entries;
      every handler matches through `data/keybindings.matchesBinding` against
      `settings.keybindings`, so the advertised list *is* the binding
- [x] ~~Settings wrote `--motion-scale` as an inline style, which outranks the
      `prefers-reduced-motion` block in global.css~~ — the OS preference was
      silently overwritten for everyone the moment settings applied (i.e.
      always). `effectiveMotionScale()` folds the two, OS wins, and the
      diagnostics report says so on its own line
- [x] ~~Three private copies of `motionScale()`~~ (RailPanel, PageEditor,
      confetti — plus SettingsPanel and TutorialOverlay, which the motion pass
      did not own) — all now read the shared one
- [x] ~~`parseDiagramSource` returned diagnostics at line 0~~ — it calls the
      mini-language parsers directly, bypassing the `parseDoc` pass that
      locates and sorts, so the diagram popover showed unlocated warnings.
      Both diagnostic surfaces now render `line N:C` plus `expected`
- [x] ~~The drop cursor had no class at all~~ — prosemirror-dropcursor only
      names its element when the `class` option is set, and it wasn't. That
      made `flip.css`'s `.snapshotting .ProseMirror-dropcursor` rule dead, so
      the indicator could bake into a page snapshot. Now passes
      `class: 'ProseMirror-dropcursor nb-dropcursor'`, keeping the ProseMirror
      name so the flip rule works again
- [x] ~~`onTaskToggle` was attached to the page root with no matching
      `removeEventListener`~~ — now cleaned up
- [x] Shortcuts are display-only in settings ("rebinding is on its way").
      The map is now honest and centrally matched, so rebinding is a UI job
      Rebindable, persisted, with Escape cancelling capture and a per-row
      reset. A binding that would shadow typing or Escape is refused WITH
      the reason shown — a silent refusal leaves the reader unable to tell
      whether the app heard them.  `5e50fc1`
- [x] The task list in the harness is stale — several entries describe the
      deleted painting/lighting stack. Not repo state: that list lives in the
      agent harness, not in this tree, and it resets with the session. Every
      entry on it is already marked complete, so it misleads nobody who reads
      it — and nothing in the repository depends on it. Recording that here so
      the next reader does not go hunting for a file to fix.
- [x] **Rasterizing a page is still the largest cost in the editor** — each one
      is a 300–400 ms long task under headless SwiftShader, nearly all of it
      html-to-image's `cloneCSSStyle` copying every computed property of every
      node. It is now correctly triggered only by *actual* edits (it used to
      run forever on an idle book), so this is a cost problem, not a loop
      Reduced and measured in the running app, before and after; anything
      that did not actually help was dropped rather than kept for sounding
      right. Mid-curl fidelity compared frame to frame.  `884aa8c`

## 🔍 Found by audit

A read-only hunt for bugs nobody had reported, ranked by severity. **Captured,
not fixed** — deliberately, so each one gets its own change with its own
verification. Every line number below was re-checked against the working tree
while writing this list; where the hunt's note disagreed with the file, the
file won (two paths and three line numbers were corrected).

The hunt's original #1 — the page-snapshot cache feeding itself forever on an
idle open book — **is already fixed** and is not listed here; it turned out to
be the shared root cause of the drag-handle flicker, the checkbox lag and the
post-flip flicker above.

### High

1. **Page history from previous sessions is destroyed by the first edit.**
   `src/editor/history/pageHistory.ts:117` reads `rings.get(pageId) ?? []` and
   `:128` persists that with `INSERT OR REPLACE`. Hydration from the DB happens
   *only* in `listSnapshots` (`:150`), and the only caller is
   `src/views/rail/HistoryPanel.tsx:45` — i.e. nothing hydrates unless the user
   has already opened the History panel. **Trigger:** restart the app, open a
   book, type, wait for a save flush (`PageEditor.tsx:181`). Up to 10 restore
   points from earlier sessions are replaced by an array of one. The module
   header explicitly promises the persisted tail "survives restarts". This is
   silent user data loss on the happy path — fix it first.
   *Weaker sibling, same file:* `:151` marks `hydrated` **before** the await, so
   one transient DB read failure permanently disables hydration for that page.

2. **The entire Playwright suite is red before any test body runs**, both
   failures inside `tests/e2e/helpers.ts::openBookView` (`:190`).
   (a) `:193` waits on `.nb-book-view`, which **no component applies any more**
   — verified: the class survives only in `src/styles/editor.css` and
   `src/styles/rail.css`. The book view root is `.nb-spread` now.
   (b) The first-run tutorial auto-starts and its `.nbt-scrim` intercepts
   pointer events, so the book click times out.
   **Trigger:** `npx playwright test`, any spec. Until this is fixed we have no
   end-to-end verification at all, which is why so much of this round had to be
   measured with bespoke harnesses instead.

### Medium-high

3. **Every re-capture leaks an ImageBitmap.** `src/flip/math.ts:337` — `set()`
   drops a replaced value without calling `onEvict`, and `onEvict` is the only
   thing that closes bitmaps (`src/flip/rasterCache.ts` LRU wiring). The
   contract at `rasterCache.ts:25` says "evicted/**replaced** bitmaps are
   `close()`d"; only evicted ones are. `delete()` and `clear()` do fire it —
   `set()`-over-existing is the single hole. **Trigger:** any re-capture of an
   already-cached page, i.e. every real edit. At pixelRatio 2 a ~620×875 sheet
   is ≈8.7 MB of native memory per leak. Note `tests/flip.test.ts:610`
   currently *enshrines* the leak (`expect(evicted).toEqual([])`), so that
   assertion has to be inverted as part of the fix.

4. **A cancelled theme swap can pin a frozen full-viewport snapshot over the
   shelf forever.** `src/features/bookshelf/world.ts:1309` — `applyLibrary`
   calls `beginThemeFade()` (grabs the viewport into a sprite at alpha 1),
   awaits the case bakes, then bails on the generation guard **before**
   `endThemeFade()`. **Trigger:** with room A on screen pick room B, then pick
   A again before B's four bakes land (cold disk cache). The second call sees
   `roomChanged === false` and returns early; the first returns at the guard.
   Nothing ever fades or destroys the snapshot, so the shelf is a still image
   until an actual room *change* replaces it. Clicks still land, which makes it
   read as a render freeze. Reduced-motion users are immune.
   ⚠️ `world.ts` is being edited by another workflow — **re-confirm the control
   flow survives their change before acting.** The bug is in the guard's
   placement, not in the scheme composition they are reworking.

### Medium

5. **Diagrams bake as an empty skeleton into adjacent-page snapshots and into
   whole-book exports.** `src/editor/nodes/diagram.tsx:96` lazy-mounts each
   diagram behind an `IntersectionObserver`; the offscreen staging host sits at
   `left:-12000px`, so it never intersects and the dashed
   `.nb-diagram-skeleton` (`:146`) is what gets captured. **Trigger:** turn to a
   page whose neighbour holds a diagram; also every PDF/PNG whole-book export.
   Distinct from the "diagrams go dark" defect fixed above — empty frame, not
   black. Fix is to treat a node inside `.nb-export-sheet` as immediately
   visible.

6. **Script/PDF export still has the black-SVG bug** that the page flip just
   fixed. `src/editor/script/exporters/capture.ts:93` uses the same
   html-to-image `toCanvas` recipe and does **not** import `inlineSvgStyles`
   (verified). **Trigger:** export any page containing a diagram. One import
   from `src/flip/svgSnapshot.ts` and the same wrap.

7. **Pasting an image that fails to store does nothing at all, silently.**
   `src/editor/media/pastePlugin.ts:89` returns on an empty source list; the
   per-file `catch` at `:81` maps every failure to `null`, and `handlePaste`
   has already called `preventDefault()` and returned `true`, so ProseMirror's
   default paste is suppressed too. **Trigger:** paste an image when
   `save_image_asset` rejects (unwritable app-data dir, disk full, refused
   format) or the asset-row DB write fails. Clipboard consumed, no block, no
   toast, no console line. A `notify()` helper already exists in
   `src/editor/script/exporters/toast.ts`.

8. **Modal dialogs with no focus management.** Four carry `aria-modal="true"` —
   `src/features/templates/ExportPdfDialog.tsx:53`,
   `src/features/templates/TemplatesGallery.tsx:149`,
   `src/features/transfer/TransferPanel.tsx:990`,
   `src/features/tutorial/TutorialOverlay.tsx:513` — and none moves focus in on
   open, traps Tab, or restores focus on close (0 `focus()` calls in each).
   `src/views/CheatSheet.tsx:55` is the milder case: `role="dialog"` without
   `aria-modal`, same absence of focus handling. **Trigger:** open Export PDF
   from the rail with the keyboard — focus stays on the rail button behind
   while `aria-modal` tells assistive tech the rest of the page is inert, so a
   screen-reader user is focused on something their AT has been told does not
   exist. `src/features/settings/SettingsPanel.tsx:519` already does this
   properly and is the pattern to copy.

### Low

9. **A timed-out art job leaks its transferred ImageBitmap.**
   `src/features/bookshelf/artOffload.ts:251` returns when the pending entry is
   already gone, dropping the transferred bitmap without `close()`. `inFlight`
   accounting is fine. **Trigger:** a spine taking >30 s (6 s has been measured
   on a software renderer, so reachable but rare).

10. **dpr is a parameter of two texture caches but not of their keys.**
    `src/features/bookshelf/textures.ts:555` (`getPlaque` keys on `label` only)
    and `:525` (`getSelectCaret` keys on nothing). **Trigger:** move the window
    between monitors of different DPI — the first scale is kept forever.
    Colours are fixed, so there is no room-tag hole here.

11. **Dead protocol plumbing in the art worker bridge.**
    `artOffload.ts:245` writes `slot.ready = true`, which `pickSlot()` (`:236`)
    never reads. `ART_PROTOCOL_VERSION` (`artJobs.ts:23`, documented as "bump
    when a job's meaning changes so a stale worker bundle is obvious") is
    posted by the worker and **never compared by the host** — bumping it does
    nothing. Harmless today, actively misleading the day someone relies on it.

12. **Purge leftovers that still allocate.** `floorView.ts:317`, `:323`, `:813`
    build sprites from `getStarCharm`/`getRibbon`/`getEmptyDoodle`, all of which
    now return the shared 1×1 transparent texture. Dead work, not a failure —
    destroy paths were checked and the shared texture is not at risk.

13. **Dead rules and doc drift left by this round's fixes** (each is a deletion
    someone with ownership should make): the two `spread.css` declarations that
    caused the yellow tint and the stray hairline are now overridden from
    `flip.css` and can go at source; `src/styles/flip.css:135`'s
    `.snapshotting .nb-drag-handle { display: none }` is the rule that *caused*
    the handle flicker and is now unreachable; `.nb-drag-handle` still appears
    in the exclude lists of `rasterCache.ts`, `offscreenPages.ts` and
    `exporters/capture.ts` as no-ops; and `docs/design/page-flip.md:26` still
    documents the fold sweeping to x=−W, which is precisely the geometry that
    detached the page from the spine.

14. **`{color=plum}` on a diagram node is unreachable from script** —
    `DIAGRAM_WASHES` includes `plum`, `WASH_COLORS` does not. Either wire it up
    or drop it.

### Chased and cleared — do not re-investigate

`bakeFlatPart` (`textures.ts:230`) looks like the classic set-scheme-then-await
race, but the `setFlatScheme`/draw/restore sits inside the producer closure,
which `bakeCached` runs synchronously. Every `bakeCached` key traced does carry
the scheme axis, so the stale-art-forever class is genuinely closed.
`PageRasterCache.dispose()`/`capture()` re-check `disposed` after every await.
`PageFlipController.land()`'s `landToken` guard and the context-lost
`committed` check are both correct. `ThumbStrip.tsx:34` never prunes its
canvases, but they are bounded by page count and hold detached 104×132
canvases — too small to call a bug.

## 📈 Measured

| | at the reset | now |
|---|---|---|
| first paint | 4,977 ms | **2,180 ms** |
| max main-thread block | 15,314 ms | not reproduced since |
| idle | 0.1 fps | settles to 1 fps (render-on-demand) |

---

## ✅ Done

- Tauri 2 + SolidJS scaffold, SQLite data layer, design system
- Infinite bookshelf world: virtualised floors, semantic zoom, drag-to-pull
- Block editor: slash menu, drag handles, right-click menu, tables, callouts,
  toggles, stickers, effects, pagination without scrollbars
- Two-page spread with WebGL page-curl flip
- Deliberate blank pages, bounded at four trailing
- Notebook Script: tolerant parser, canonical printer, AI-facing spec dialog
- Hand-drawn diagram renderers (tree, mindmap, flowchart, timeline)
- Media: image paste/drop, link-preview cards, Openverse fetch
- Full-text search + Ctrl+K quick switcher
- Settings panel, guided tutorial, export/import bundles, backups, tray
- Custom icon + NSIS installer; GitHub Actions release on version tags
- README that describes the actual app
