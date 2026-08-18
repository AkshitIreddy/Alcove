# Packaging: Windows

Everything specific to the two Windows installers — what they do about the Edge
WebView2 runtime, what the uninstaller offers, and why the setup window is
painted rather than stock. The companion documents are
[`packaging-mac-linux.md`](packaging-mac-linux.md) (the release workflow and the
other two platforms) and [`packaging-icons.md`](packaging-icons.md) (the .ico,
the .icns and the small-size treatment).

Everything below is configured from three files and nothing else:

| File | What it decides |
| --- | --- |
| `src-tauri/tauri.conf.json` → `bundle.windows` | the WebView2 mode, and which of the files below NSIS is told about |
| `src-tauri/installer/alcove.nsh` | the colours, the page copy, the extra uninstaller page, and the two install/uninstall hooks |
| `src-tauri/installer/English.nsh` | every string on every page, including the label on the one destructive checkbox |

`scripts/gen-icons.py` draws `installer-header.bmp` and `installer-sidebar.bmp`.
`tests/packaging.test.ts` holds all of it together — it is the only thing that
can, because an NSIS script is text until `makensis` reads it.

---

## WebView2: every mode was weighed, and the numbers decided it

Alcove renders in the Microsoft Edge WebView2 runtime. It is present on every
up-to-date Windows 11 and on most Windows 10, but not all of it, and **the app
cannot start without it** — which is what prompted this, twice:

> "i noticed that the pc needs to have microsoft edge web view2 runtime, like
> check the size with it included and maybe add it if not that big or add
> another version with it included"

> "also check how much size the webview 2 runtime takes maybe if it is small
> enough we can just give it in the installer"

**The direct answer to the second one: the runtime is not small enough, and the
thing that fetches it is.** Two different Microsoft artefacts get confused under
the one word "runtime", and the whole decision turns on the gap between them:

| Microsoft artefact | Size | What it is |
| --- | ---: | --- |
| `MicrosoftEdgeWebview2Setup.exe` (evergreen bootstrapper) | **1,695,448 B** (1.62 MiB) | A downloader. Works out what the machine needs and fetches it. |
| `MicrosoftEdgeWebView2RuntimeInstallerX64.exe` (evergreen standalone) | **209,567,440 B** (199.9 MiB) | The actual runtime, as an installer. |
| the runtime once installed, `…\Microsoft\EdgeWebView\Application\<ver>` | **889,988,421 B** (848.8 MiB, 786 files) | What ends up on disk. Measured at v150.0.4078.105. |

So "just give it in the installer" costs 200 MB in the download and 850 MB on
the reader's disk. That is the answer to why it is not the default — and the
1.6 MB downloader *is* small enough, which is the answer to what ships instead.

### What each mode actually costs

`bundle.windows.webviewInstallMode` picks between them. All five, same payload,
same art, same 0.2.0 binary — only that one field differs:

| `webviewInstallMode` | Installer | vs. the default | What it does at install time |
| --- | ---: | ---: | --- |
| `skip` | 15,365,319 B (14.65 MiB) | −10,181 B | Nothing. No check, no install. |
| `downloadBootstrapper` | 15,375,500 B (14.66 MiB) | — | Tauri's default. Fetches the 1.6 MB bootstrapper over HTTP, runs it, and *that* fetches the runtime. Two hops. |
| `embedBootstrapper` | **16,960,852 B** (16.17 MiB) | **+1,585,352 B, +10.31%** | Carries the bootstrapper inside the setup. The installer fetches nothing itself; the bootstrapper still pulls the runtime down if the machine lacks it. **← what ships** |
| `offlineInstaller` | ~227,700,000 B (~217 MiB) | **+~202 MiB, ×14.8** | Carries the whole 200 MB runtime. The only one that installs with no internet at all. |
| `fixedRuntime` | ~offline-sized, **plus 849 MiB in the install directory** | — | Pins one runtime version inside Alcove's own folder. |

**How those were measured, so the next person can redo it in a minute rather
than an afternoon.** A full `npx tauri build` per mode takes ~20 minutes and
rebuilds Rust for nothing, because the only thing that changes is three
`!define`s in the NSIS script. Tauri leaves that script, fully expanded with
absolute paths, at `src-tauri/target/release/nsis/x64/installer.nsi` after any
Windows build. Copy it, edit `INSTALLWEBVIEW2MODE`, `WEBVIEW2BOOTSTRAPPERPATH`
and `OUTFILE`, and run the `makensis.exe` that Tauri already cached under
`%LOCALAPPDATA%\tauri\NSIS\`. 25 seconds each, and everything outside the one
field is byte-identical, so the deltas are exact rather than approximately
comparable. The recompiled `downloadBootstrapper` variant lands 2,706 B from the
`Alcove_0.2.0_x64-setup.exe` an actual build produced, which is the check that
the method is sound.

Two footnotes on the two numbers that are not a straight file read:

- **`offlineInstaller` is stated approximately on purpose, because it is not a
  constant.** It embeds whatever evergreen standalone Microsoft is serving on
  the day of the build, so it moves with Edge. A real build of it at 0.2.0 came
  out at 227,660,011 B. That reconciles with today's 209,567,440 B standalone
  once you know solid LZMA *grows* an already-compressed payload rather than
  shrinking it — measured here at ×1.0208 on 20 MiB of crypto-random, and the
  standalone's implied ×1.0132 sits just under that because its PE stub and
  resources are not compressed. Do not expect to reproduce the digits; expect
  ~200 MB plus the app.
- **`fixedRuntime` is the one with a number that is not in the installer.** It
  ships the runtime *unpacked* into the install directory, so the 849 MiB above
  lands in `%LOCALAPPDATA%\Alcove` and stays there. Worse, it is pinned:
  Alcove would stop receiving the security updates Edge ships, forever, on
  every machine that took it — a browser engine frozen at install date, in an
  app that renders pasted HTML and fetches remote images. Not offered.

### What each mode means for a real machine

The mode only ever matters on a machine that lacks the runtime. `Section
WebView2` in the generated script reads `pv` out of the three `EdgeUpdate`
registry locations and jumps straight to `webview2_done` if any of them answers:

| The reader's machine | `downloadBootstrapper` | `embedBootstrapper` | `offlineInstaller` |
| --- | --- | --- | --- |
| **Windows 11** — runtime is an OS component, always present | Registry hit, section skipped. | Same, and the embedded 1.6 MB is never even extracted. | Same, and 200 MB was downloaded for nothing. |
| **Up-to-date Windows 10** — Microsoft pushed the runtime out with Edge from 2021, so usually present | Almost always a registry hit. | Same. | Same. |
| **No runtime, has internet** — a fresh or long-stale install | Two fetches, either can fail. | One fetch. | Installs offline; no fetch. |
| **No runtime, no internet** | **Aborts.** | **Aborts.** | **The only one that works.** |

That last row is the one worth being blunt about, because it is where the
intuition "embedding the bootstrapper means it works offline" is wrong: **the
bootstrapper is a downloader, not the runtime.** Embedding it removes a
download; it does not remove the need for one.

### The decision, both halves of it

- **`embedBootstrapper` is the default.** A tenth of the download buys the
  removal of one specific step, and it is worth naming precisely, because "one
  fewer network hop" undersells it. The two hops do not use the same network
  stack. The first is `NSISdl::download`, a bare-WinSock plugin with no proxy
  support, no retry and no modern TLS story — it is the step that produces
  "Error: Downloading WebView2 Failed", and it `Abort`s the entire install when
  it fails, before anything is written. The second is Microsoft's own updater,
  which honours the system proxy configuration. Embedding the bootstrapper
  deletes the worse of the two and leaves the one most likely to succeed on the
  machines that fail today: corporate networks, where NSISdl cannot see the
  proxy and the Edge updater can.

  **The honest cost:** on the large majority of machines the runtime is already
  there, so those 1.51 MiB are downloaded by everyone and executed by almost
  nobody. That is the trade — a fixed 10% on every download to remove a
  failure that only some readers would ever hit, but that leaves the ones who
  hit it with a broken install and a message they cannot act on.

  `skip` is the trap at the other end and the reason the floor is in the table
  at all: it saves 10,181 bytes, and buys a machine where setup succeeds, a
  shortcut appears, and the app then opens a window that never paints.

- **`offlineInstaller` ships as a second, separately named download.**
  ~200 MB is not "small enough"; it is fifteen times the app. So it is not what
  a reader lands on. It is built by its own step in
  `.github/workflows/release.yml` and renamed:

  | File | Take it if |
  | --- | --- |
  | `Alcove_0.2.0_x64-setup.exe` | Always, unless the one below applies. |
  | `Alcove_0.2.0_x64-setup-offline.exe` | The machine is offline, or a proxy blocks Microsoft's CDN, and the first one failed. |

  `scripts/release-notes.mjs` appends that table to every authored release body, because
  two setup.exes that differ by 200 MB and no explanation is a worse problem
  than the one being solved.

The workflow patches the mode with `--config` rather than editing
`tauri.conf.json`, so the repository keeps exactly one answer to "what is the
default". `tests/packaging.test.ts` pins that, pins `silent`, and pins that the
two builds ask for *different* modes — a workflow that patched the offline build
to the mode it already had would spend twenty minutes producing a second copy
of the first installer under a name promising something it did not do.

**The README's download size is downstream of this table.** `embedBootstrapper`
makes the shipped `x64-setup.exe` 16,960,852 B, and the install table in
`docs/readme/part-1-users.md` reads *about 16 MB* — **quote it in MiB, the way
GitHub does.** The releases page divides by 1024 twice and still writes "MB", so
a reader comparing the two sees 16.2, not the 16.96 that a decimal megabyte
would give. The offline row's "around 217 MB" is the same convention (217.2
MiB), and the two have to agree or one of them looks wrong on the page a reader
checks them against. Changing the mode changes both numbers.

---

## The uninstaller keeps your library, and says where it is

> "make the uninstall exe has an option to also to delete the all app data and
> show the user where that app data is in case they want to transfer for it"

**The option already existed and already defaulted to keeping.** Tauri's
uninstall confirm page creates a "delete the application data" checkbox,
unticked, and `RmDir /r`s `$APPDATA\<identifier>` and
`$LOCALAPPDATA\<identifier>` only if it was ticked. Alcove leaves that state
alone, so the default is still to keep every book.

Three things are added in `alcove.nsh`:

**1. A library-folder page during installation.** It defaults to the normal
Roaming app-data folder and offers a real folder browser. Passive updater runs
skip the page and retain the existing choice. The installer writes the absolute
selection to `%APPDATA%\com.alcove.app\library-location.txt`; that small pointer
stays in the predictable location even when the library is on another drive.

**2. An extra page, ahead of the uninstall question.** `UninstPage custom
un.AlcoveLibraryPage`, declared from the hook file, which puts it FIRST in the
uninstaller. It says the library is kept, shows the path in a **read-only edit
box** so it can be selected and copied (a path you cannot copy is a path you
have to retype), and offers an **Open the folder** button.

**3. Wording that names what it deletes.** Tauri's label is "Delete the
application data" — jargon, and a reader could easily take it for a cache. The
replacement in `English.nsh` names the library, and
`MUI_UNCONFIRMPAGE_TEXT_TOP` points back to the exact folder shown on the
previous page.

### Where the library actually is

By default: `%APPDATA%\com.alcove.app` — Roaming, not Local. When a reader
chooses another folder, `src-tauri/src/library.rs` resolves it before the SQL
plugin is built, and the database URL, media assets, import/export and default
backups all use that one root. On an upgrade from the default location to an
empty custom folder, the existing database, sidecars, assets and backups are
copied before the database opens; the original is retained as a safety copy.

The custom assets folder is added to Tauri's asset-protocol scope at runtime,
and bundle export reads through a path-validating Rust command instead of
granting the webview a broad drive permission.

### The path is written two ways, deliberately

`ALCOVE_LIBRARY` is `$APPDATA\com.alcove.app`: the default library and the
stable home of `library-location.txt`. `AlcoveLibrarySelection` is the resolved
runtime value shown by both installer and uninstaller. The uninstaller reads it
before Tauri can remove the pointer. If deletion was explicitly selected for a
custom folder, the hook removes only Alcove-owned database files, `assets/` and
`backups/`, then removes the folder only if it is empty; it never recursively
erases an arbitrary reader-selected directory.

### The page is on the upgrade path too, and is worded for it

Installing 0.2.1 over 0.2.0 runs the OLD uninstaller **with its full interface**
— no `/P`, no `/UPDATE`; that is Tauri's own `reinst_uninstall` branch, watched
in a real run, not assumed. So the extra page appears during upgrades, and its
paragraph says "removing Alcove — or replacing it with a newer version — leaves
your library exactly where it is", which is true either way. It still aborts
itself when `/P` or `/UPDATE` **is** present, because a page that stops on a
headless run hangs the install that is waiting on it.

---

## How the hook file gets in, and what it may not touch

`bundle.windows.nsis.installerHooks` makes Tauri `!include` the file near the
**top** of its generated `installer.nsi` — after `MUI2.nsh` and `FileFunc.nsh`,
before every page macro, and before the template declares its own variables.
Both halves of that position matter:

- Anything MUI reads at page-insert time can be set from there. That is how the
  colours, the page copy and the extra page get in **without forking Tauri's
  977-line template**, which is the thing that would rot at the next
  `@tauri-apps/cli` bump.
- Nothing declared later exists yet. `$PassiveMode`, `${BUNDLEID}` and
  `$DeleteAppDataCheckboxState` are all below the include, so a top-level
  function in the hook file cannot name them — the passive check re-reads
  `$CMDLINE`, and the identifier is spelt out and pinned against
  `tauri.conf.json` by a test.

  A macro **body** is different. `NSIS_HOOK_POSTUNINSTALL` is expanded deep
  inside `Section Uninstall`, so it may name `$DeleteAppDataCheckboxState`, and
  does — it prints which way the answer went into the uninstall log.

### The finish page has 40 dialog units, not as many as you want

`MUI_FINISHPAGE_TEXT` is drawn into a 40 du label with the two check boxes
placed 5 du under it. A longer paragraph does not scroll and does not clip — it
is painted **underneath** the check boxes, which is how the last line of that
page shipped invisible until somebody looked at a screenshot.
`MUI_FINISHPAGE_TEXT_LARGE` asks for 60 du instead and moves the boxes down with
it. Set it before you lengthen that text.

### `customLanguageFiles` replaces, it does not merge

`English.nsh` in `src-tauri/installer/` is used **instead of** the one Tauri
would write, so every `LangString` the template references has to be present or
the page renders the literal text `$(theName)`. The test pins the set, and
additionally re-derives it from `src-tauri/target/release/nsis/x64/installer.nsi`
when a local build has left one there.

Copying that file also fixed a Tauri bug in passing: Tauri writes
`{{product_name}}` into its own `English.nsh` and never renders it, so the stock
installer really does say *"{{product_name}} is running!"*. Ours uses
`${PRODUCTNAME}`, which NSIS resolves.

---

## The installer is drawn, not stamped

> "most install and unistall exe look boring make sure ours looks interesting,
> pretty like our app"

The two BMPs used to be `alcove-art.png` pasted onto a cream rectangle at two
sizes. They are now **drawn**, by `build_installer_art()` in
`scripts/gen-icons.py`, in the app's own flat vocabulary — flat colour, one ink
outline, rounded corners, edges that bow, the rules in `src/art/flat.ts`:

| File | Size | What it is | Where MUI puts it |
| --- | --- | --- | --- |
| `installer-header.bmp` | 150×57 | A shelf of books on a bracketed board, one of them tipped over | The band at the top of every interior page — **left**-aligned, with the page title beside it |
| `installer-sidebar.bmp` | 164×314 | A whole bookcase: arched crown with gilt studs, four stocked bays, plinth, papered wall, floor, contact shadow | The full left edge of the Welcome and Finish pages |

Four things about that code are load-bearing:

- **Supersampling.** Everything is drawn at 4× and downsampled once. Pillow
  antialiases nothing, and a hard edge drawn straight into a 150×57 bitmap is a
  staircase. It is also what makes the bowed edges worth having: at 1× a
  two-pixel bow rounds to no bow.
- **24-bit, no alpha.** NSIS renders these through a control that knows nothing
  about transparency; a 32-bit BMP arrives with a black box where the
  transparency was. Everything is composited onto an opaque ground first.
- **The ground is `FLAT.cream`, and so is `MUI_BGCOLOR`.** MUI paints that
  colour behind and beside the header bitmap, so the two being the same hex is
  the whole reason the art looks built into the window rather than stuck onto
  it. Change one and change the other; the test compares all three copies of it
  (TypeScript, Python, NSIS).
- **The mark is in neither.** `icon.ico` already carries it into the title bar,
  the taskbar button and Add/Remove Programs, and the register that suits a
  1024 px illustration is not the one that survives a 150×57 strip.
  `uninstallerIcon` is now set too, so `uninstall.exe` stops shipping the NSIS
  default.

MUI stretches both bitmaps to the control (`FitControl`), so at 150% display
scaling they are enlarged and slightly soft. Rendering them at 2× was tried on
paper and rejected: `LoadAndSetImage /RESIZETOFIT` does a plain stretch in both
directions, so a 2× source would look worse at 100% than the current one looks
at 150%, and 100% is the case you cannot make worse.

**Regenerate with `npm run icons`**, which rewrites both BMPs along with every
other icon from the one master. `python scripts/gen-icons.py --check` audits the
`.ico` and `.icns` only — the BMPs are checked by `tests/packaging.test.ts`
instead (size, bit depth, ground colour, and a colour-count floor that a mark
pasted on a field could not pass).

---

## Looking at it

The screenshots that closed this work were taken by driving the real installer:
launch it, `PrintWindow` each page, read the dialog's controls back with
`EnumChildWindows`. Two notes for whoever does it next:

- `PrintWindow(hwnd, dc, PW_RENDERFULLCONTENT)` rather than `CopyFromScreen` —
  the screen grab picks up whatever overlay happens to be running and needs the
  process to be DPI-aware before its coordinates mean anything.
- Dumping the control texts is worth as much as the picture. It is how you find
  that a paragraph is not missing but hidden behind a checkbox.

To see the uninstaller's pages without uninstalling anything, run
`%LOCALAPPDATA%\Alcove\uninstall.exe`, walk to the confirm page, and press
Cancel.
