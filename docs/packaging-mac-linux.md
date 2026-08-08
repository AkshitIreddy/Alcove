# Releasing on three platforms: what the workflow does, and what to check

`.github/workflows/release.yml` builds the Tauri bundle on Windows, macOS and
Linux and attaches every artefact to one GitHub Release. This document is the
part a workflow file cannot carry: **what a first run is expected to produce,
and what to look at when it does** — because no run has happened. Nothing below
was observed on a runner. Everything that is a prediction rather than a
measurement says so.

Two companion documents carry the parts this one deliberately does not:
[`packaging-icons.md`](packaging-icons.md) is what `icon.ico` and `icon.icns`
have to contain, and [`packaging-windows.md`](packaging-windows.md) is
everything specific to the two Windows installers — the WebView2 decision and
the numbers behind it, the uninstaller's "keep my library" page, and the drawn
setup window. This one is about the pipeline around all of it.

---

## Running it

### One-time updater setup

Before the first updater-enabled tag, add one repository secret under **GitHub
→ Settings → Secrets and variables → Actions**:

- `TAURI_SIGNING_PRIVATE_KEY` — the complete contents of the ignored local file
  `src-tauri/updater.key`.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — only if that key was generated with a
  password. An unencrypted key does not need this second secret.

Never commit or paste the private key into the workflow. The matching public
key is deliberately tracked as `src-tauri/updater.key.pub` and embedded in the
app; it can verify a release but cannot sign one. The release fails before a
bundle is built if the private-key secret is absent.

There is one unavoidable bootstrap: **v0.4.0 shipped before the updater existed.**
An installed v0.4.0 cannot discover code it does not contain, so readers must
manually install the first updater-enabled release once. From that release
onward, Alcove checks GitHub after launch, offers a newer signed version, downloads
the platform installer/archive, applies it, and relaunches.

```bash
git tag v0.2.0
git push origin v0.2.0
```

That is the whole trigger. There is also a **Run workflow** button (Actions →
Release), which takes a tag that already exists and an optional *draft*
checkbox; use it to re-run a release that failed halfway without moving the tag.
The tag is validated to start with `v` before anything else happens, so a
mistyped dispatch fails in five seconds rather than forty minutes in.

Two runs against the same tag queue rather than cancel each other. A cancelled
release job can leave a release created with half its assets, and that is worse
than waiting.

## The shape: three jobs, not one matrix

| Job | Runner | What it does |
| --- | --- | --- |
| `gates` | `ubuntu-latest` | `tsc --noEmit`, the fast logic gate (`npm test`), release-only logic (`test:release`), `spec:check`, `readme:check`, `gen-icons.py --check` |
| `build` (×3) | `windows-latest`, `macos-15`, `ubuntu-22.04` | the bundle, and nothing else |
| `release` | `ubuntu-latest` | notes, checksums, one GitHub Release |

**The gates run once.** None of `tsc`, `vitest`, the spec check, the README
check or the icon audit can fail differently on a different operating system —
they read the repository, not the host — so running them on all three runners
would triple their cost and buy nothing but three copies of the same red X.
Running them *before* the matrix also means a typo fails in about two minutes
instead of after three parallel Rust builds.

The one thing that does repeat is the frontend build: `beforeBuildCommand` in
`src-tauri/tauri.conf.json` is `npm run build`, so every runner runs
`spec:check` and `vite build` before its Rust build. That is seconds, and
shipping `dist/` between jobs as an artefact would cost more in upload and
download than it saves.

`build` uses `fail-fast: false`, so one platform breaking still tells you
whether the other two are fine. `release` needs all three, so a partial matrix
never publishes a release with a platform quietly missing.

## What a first run should produce

Seven reader-facing bundles, five updater-support files, and a checksum
manifest. The three Windows bundle rows below were built
locally and their names and sizes read off the files; **the macOS and Linux
names are still predicted from the Tauri bundler's naming rules, not read off a
run** — check those against the job log the first time, and correct this table
if the bundler disagrees.

| Platform | Artefact | Notes |
| --- | --- | --- |
| Windows x64 | `Alcove_0.2.0_x64-setup.exe` | NSIS, **16.2 MB** — measured, this one was built. `installMode: currentUser`, so no administrator prompt. The one to hand to a reader. |
| Windows updater | `Alcove_0.2.0_x64-setup.exe.sig` | Tauri updater signature for the normal NSIS setup. The offline installer is deliberately not an update target. |
| Windows x64 | `Alcove_0.2.0_x64-setup-offline.exe` | The same installer carrying the whole Edge WebView2 runtime, **217 MB**. Built by its own step and renamed. Only for a machine with no internet — see [`packaging-windows.md`](packaging-windows.md). |
| Windows x64 | `Alcove_0.2.0_x64_en-US.msi` | WiX, **19.8 MB** — also measured. For policy deployment. |
| macOS universal | `Alcove_0.2.0_universal.dmg` | Contains `Alcove.app`. Both architectures in one file — see below. |
| macOS updater | `Alcove.app.tar.gz` + `.sig` | Universal updater archive and signature; both macOS architecture entries point to this same file. |
| Linux x64 | `Alcove_0.2.0_amd64.deb` | Debian, Ubuntu, Mint. |
| Linux x64 | `Alcove-0.2.0-1.x86_64.rpm` | Fedora, openSUSE. Tauri 2 builds this with a pure-Rust packer, so the runner needs no `rpmbuild`. |
| Linux x64 | `Alcove_0.2.0_amd64.AppImage` | Runs without installing. The one to offer anybody not on a `.deb`/`.rpm` distribution. |
| Linux updater | `Alcove_0.2.0_amd64.AppImage.sig` | Signature for the AppImage updater payload. |
| updater | `latest.json` | Stable feed consumed by installed copies. It carries the release notes, immutable tag URLs, and the **contents** of each signature file. |
| all | `SHA256SUMS.txt` | Generated in the release job. |

`latest.json` maps `windows-x86_64` to the normal NSIS setup,
`linux-x86_64` to the AppImage, and both `darwin-aarch64` and
`darwin-x86_64` to the universal macOS archive. The workflow generates it only
after proving every payload and signature exists. The checksum step runs after
that, so the manifest and updater files are covered too.

`bundle.targets` is `"all"`, so each runner produces whatever its platform
supports; the workflow does not name the formats, it globs the bundle
directories and fails the upload if a glob matches nothing
(`if-no-files-found: error`). That is deliberate — the alternative is an empty
artefact and a release that publishes with a platform silently absent.

**One step breaks that rule, on purpose.** The Windows job runs `npx tauri
build` a second time with `--config` overriding `webviewInstallMode` to
`offlineInstaller`, and renames the result to `*-setup-offline.exe`. Both builds
write the same filename, so the first installer is moved aside and moved back
around the second — one extra Rust link rather than a third full build to
recreate a file that already existed. The `--config` patch is what keeps
`tauri.conf.json` the single answer to "what does the default installer do about
WebView2"; `tests/packaging.test.ts` fails if that ever becomes two answers.
[`packaging-windows.md`](packaging-windows.md) has the three measured sizes the
choice rests on.

The `.app` itself is not uploaded as a directory. It lives inside the `.dmg`
for manual installation and inside the signed `.app.tar.gz` for the updater.

## macOS: one universal binary, and it is not signed

**It builds both architectures, in one download.** The job runs on `macos-15`
(the arm64 label) with `--target universal-apple-darwin`, which builds
`aarch64-apple-darwin` and `x86_64-apple-darwin` and `lipo`s them into a single
binary — hence both targets in `rust-targets`. An Apple-silicon runner
cross-builds the Intel slice from the same SDK, so this needs no second job.

Two consequences worth knowing before reading a log:

- **The output is not under `target/release/`.** A `--target` build puts its
  bundle under `src-tauri/target/universal-apple-darwin/release/bundle/`. The
  workflow's artefact glob says so; if a future change drops the `--target`, the
  glob has to move with it or the upload fails (loudly, by design).
- **It builds the Rust twice.** A universal build is genuinely two compilations,
  so the macOS job is the slow one in the matrix, cold or warm.

**Nothing is code-signed or notarised.** There is no Apple Developer identity in
this repository and adding one is a decision with a yearly invoice attached, not
an oversight. Practically:

- macOS will refuse the first launch with *"Alcove is damaged and can't be
  opened"* or *"cannot be opened because the developer cannot be verified"*.
  The way through is right-click → **Open** → **Open**, or
  `xattr -dr com.apple.quarantine /Applications/Alcove.app`.
- The arm64 slice is still *ad-hoc* signed, because the linker does that
  automatically for arm64 Mach-O binaries and macOS will not execute one that is
  not. That is what makes it run at all; it is not what makes Gatekeeper happy.
- This is why `SHA256SUMS.txt` exists. Without a signature a reader has no other
  way to tell a good download from a truncated one.

If notarisation is wanted later, it is `APPLE_CERTIFICATE`,
`APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`,
`APPLE_PASSWORD` and `APPLE_TEAM_ID` as repository secrets, read by the Tauri
bundler directly — no workflow restructuring.

## Linux: the packages, and why each one

Tauri 2 on Linux is a system-library build. These are not interchangeable
guesses, and the first one is the classic red run:

| Package | Why |
| --- | --- |
| `libwebkit2gtk-4.1-dev` | The webview. Tauri **2** links **4.1**; `4.0` is the v1 series. Installing 4.0 out of habit is the single most common Linux CI failure for this stack, and the error it produces (`pkg-config` cannot find `webkit2gtk-4.1`) does not say so. |
| `libgtk-3-dev` | Window, native menus, file dialogs. |
| `libayatana-appindicator3-dev` | The tray icon. `src-tauri/src/tray.rs` is not optional in this app, so without this the build fails at link rather than degrading. |
| `librsvg2-dev` | Rasterises the icon into the `.desktop` entry and the AppImage. |
| `libxdo-dev` | X11 input, wanted by `tauri-plugin-global-shortcut`. |
| `libssl-dev` | OpenSSL headers for the transitive TLS stack. |
| `patchelf` | The AppImage bundler rewrites RPATHs with it. |
| `build-essential`, `curl`, `wget`, `file` | Compiler, and the fetch-and-identify tools the AppImage bundler shells out to. |

**The runner is `ubuntu-22.04` on purpose.** A `.deb` and an AppImage are linked
against the *builder's* glibc. Building on `ubuntu-latest` (24.04, glibc 2.39)
produces a package that refuses to start on a 22.04 machine (glibc 2.35) with a
`GLIBC_2.38 not found` message that reads like a bug in the app. Build on the
oldest runner you are willing to support, never the newest. When 22.04 is
retired the glibc floor moves and this line has to be revisited deliberately.

`NO_STRIP=true` is set for the build. Binutils 2.38 on 22.04 strips the AppImage
runtime in a way that breaks it; the variable is harmless on the other two
platforms, so it is set unconditionally rather than guarded, and can be dropped
once that is no longer true.

## The `.icns`, and the decision behind it

**The `.icns` is now generated by `scripts/gen-icons.py`, from the same master
as every other icon.** The alternative — running `npx @tauri-apps/cli icon` in
the macOS build job — was rejected, and the reason matters enough to write down.

The problem it fixes was real and measured. `src-tauri/icons/icon.icns` had been
written once by the Tauri CLI and never again. `assets/brand/alcove-art.png` has
changed twice since. The mean absolute channel difference between the committed
container's 1024px frame and the current master was **75/255** — not a stale
encode, a different picture. A macOS build would have shipped the artwork from
two renames ago, on the very first release that had a macOS build in it.

Why not run the CLI in the workflow:

1. **It clobbers the close-crops.** `npx @tauri-apps/cli icon` regenerates every
   PNG as a plain downscale. `gen-icons.py` deliberately does not: at 64px and
   below it crops past the scene onto the book, lifts brightness and contrast and
   re-applies a rounded mask, because straight-downscaled this illustration is a
   dark square with one red speck. That is the *first* break recorded in
   [`packaging-icons.md`](packaging-icons.md), and it is why the CLI has to run
   before that script and never after.
2. **A build would ship art the repository does not contain.** Running the CLI
   inside the job also rewrites `assets/brand/alcove-1024.png`, fifteen PNGs and
   the two NSIS bitmaps. The release and the tree would disagree, and only the
   runner would ever have had the right icon — anybody building locally on a Mac
   would still ship the old mark.
3. **It hides the failure instead of catching it.** A generated-at-build-time
   icon is never wrong in CI and always wrong on a desk. Generating it in the
   repository means `--check` can audit the committed bytes, which is a thing a
   test can fail on.

So `gen-icons.py` writes the container itself, the same way it writes
`icon.ico`, and for the same reason: the frame set is a decision, not a resize.

```bash
python scripts/gen-icons.py --icns-only   # repack just icon.icns from the master
python scripts/gen-icons.py --check       # audit BOTH containers, exit 1 if bad
```

### What is in it

Twelve chunks, matching the set the Tauri CLI emitted, so swapping the producer
changed the artwork and nothing else. macOS looks an icon up by OSType, and an
OSType is a *(point size, scale)* pair rather than a pixel size — `ic11` is
"16pt at @2x", which is 32 pixels. A type that is absent is derived by
resampling a neighbour, and a derived 16pt lands visibly soft in Finder's list
view.

| Chunks | Encoding | Covers |
| --- | --- | --- |
| `is32` + `s8mk` | 24-bit RLE + uncompressed 8-bit alpha | 16pt @1x |
| `il32` + `l8mk` | same, at 32px | 32pt @1x |
| `ic11`, `ic12` | PNG, 32px and 64px | 16pt and 32pt @2x |
| `ic07`, `ic13` | PNG, 128px and 256px | 128pt @1x and @2x |
| `ic08`, `ic14` | PNG, 256px and 512px | 256pt @1x and @2x |
| `ic09`, `ic10` | PNG, 512px and 1024px | 512pt @1x and @2x |

The two `@1x` small sizes predate PNG-in-icns and their OSTypes do not accept
one; they are a channel-planar 24-bit RLE colour frame plus a separate
uncompressed alpha frame. The run-length format is a PackBits variant with two
ranges that are silent when confused: a **run** marker is `0x80 | (count - 3)`,
so a run carries 3–130 bytes and never 1 or 2; a **literal** marker is
`count - 1`, so a literal carries 1–128. That is what keeps the marker byte
unambiguous. Encode a two-byte run as a run and the decoder reads a byte that
was never written.

### What `--check` actually checks

`verify_icns()` parses the bytes on disk — not the writer's intentions — and
reports:

- the magic, and that the declared length matches the file (the length counts
  its own 8-byte header, which is the easy one to get wrong);
- every PNG chunk's real IHDR dimensions against what its OSType promises;
- every RLE chunk **decoded back**, all three planes, with the decoded length
  and the bytes consumed both checked, so trailing junk is caught;
- every mask chunk at exactly one byte per pixel;
- every required OSType present, and none twice;
- and **that the artwork is current**, by comparing the 1024px frame against
  `assets/brand/alcove-art.png`.

That last one is the check the whole exercise exists for, and it is deliberately
a *picture* comparison rather than a byte comparison: both images are flattened
onto white, reduced to 64px and compared as a mean absolute channel difference,
because PNG output drifts between Pillow and zlib versions and a byte comparison
would go red on a CI runner for no reason. The tolerance is 20. Re-encoding the
same art scores 0.0. The stale container this was written for scores 84.6.

Two independent confirmations that the encoder is right, since no macOS is
available here to open the file:

- Pillow's own `IcnsImagePlugin` — a reader nobody involved wrote — opens the
  result and reports all ten *(size, scale)* pairs, and its decode of the
  `is32` and `il32` frames matches `render(art, 16)` and `render(art, 32)` with
  a **maximum channel difference of 0**.
- The same decoder, run against the *old* CLI-produced container, parses it
  without complaint and fails only the freshness comparison — so the check is
  not merely a mirror of the encoder that feeds it.

## Caching

Two caches, and the distinction is worth keeping straight.

- **Cargo** — `Swatinem/rust-cache@v2`, with `workspaces: src-tauri -> target`
  and a per-platform `key`, caching `~/.cargo/{registry,git}` and
  `src-tauri/target`. A cold Tauri build is several hundred crates; a warm one is
  this crate and the link. Without it the matrix is punishing, and the macOS job
  — which compiles twice — is the worst of it.
- **npm** — `actions/setup-node`'s `cache: npm`, which caches `~/.npm`, the
  *download* cache, keyed on `package-lock.json`. It deliberately does **not**
  cache `node_modules`: `npm ci` deletes that directory before it installs, so
  caching it restores something that is thrown away a second later. The download
  cache is the part that saves the network, and `--prefer-offline` is what makes
  it pay.

The first run of any new tag warms both from empty and will look slow. That is
expected, not a fault.

## What to check on a first run

> [!IMPORTANT]
> **Do not use a tag as the first test of this workflow.** Run the documented
> gates locally first, then make sure `TAURI_SIGNING_PRIVATE_KEY` is present in
> the repository's Actions secrets. A missing updater key fails before any
> platform build starts, by design.

In order, because each one only matters if the previous passed.

1. **`gates` is green.** If the icon step is the one that failed, the message
   names the file and the fix (`--icns-only`). Nothing else in the workflow can
   fail for that reason.
2. **All three `build` jobs are green.** The likely first-run failures, in
   descending order of probability:
   - **Linux, at `pkg-config`** — a webkit2gtk version mismatch. The package list
     above is the answer; check the runner did not resolve `4.0`.
   - **macOS, at the DMG step** — Tauri's DMG bundler drives Finder through
     AppleScript, and a headless runner has been known to make that hang or fail
     with *"Finder got an error"*. If it does, the `.app` still built; the
     workaround is to attach a zipped `.app` instead of a `.dmg`, and that is a
     workflow change, not a code one.
   - **Windows, at the MSI step** — WiX is downloaded by the bundler on first
     use and is not cached, so this step is a network dependency. A transient
     failure here is a re-run, not a bug.
   - **Any platform, at *Upload artefacts*** — means the build succeeded and the
     glob matched nothing, i.e. the bundler wrote somewhere this file does not
     expect. Read the *Show what was bundled* step directly above it; it prints
     every `bundle/` directory on the runner, and correct the matrix glob and the
     artefact table above.
3. **The release exists and carries thirteen assets.** Seven reader-facing
   bundles, four `.sig`/archive updater companions, `latest.json`, and
   `SHA256SUMS.txt`. If a bundle's filename differs from the table above, fix the
   table — the workflow globs and does not care, but this document is a promise
   to the next reader.
4. **`latest.json` opens from the public release URL.** Its version equals the
   tag without the leading `v`; all four platform entries have a tag-specific
   HTTPS URL and a non-empty signature. The tag gate has already proved that
   this version is also the one embedded in the installer.
5. **The notes read like notes.** `scripts/release-notes.mjs` diffs against the
   previous tag; for the *first* tag there is no previous one, so it summarises
   the entire history and will be long. That is correct behaviour and worth
   expecting rather than debugging.
6. **Then actually install one.** CI proves a bundle was produced. It proves
   nothing about whether it launches. The macOS quarantine dance above is
   expected on first open and is not a broken build.

## Known gaps, stated plainly

- **No run has happened.** Everything here is derived from the configuration and
  the bundler's documented behaviour. The artefact names in particular are
  predictions.
- **The updater payloads are signed, but the applications are not code-signed.**
  The updater signature lets Alcove reject a modified download. It is not
  Authenticode or Apple notarisation, so Windows can still show a SmartScreen
  warning and macOS can still quarantine a manual download. Those are separate
  trust systems.
- **Linux is x64 only.** `ubuntu-22.04-arm` exists as a runner label, so an arm64
  Linux bundle is one matrix entry away, but nothing has asked for it.
- **There is still no push-triggered CI.** This workflow fires on tags. `tsc`,
  `npm test`, `test:release`, `spec:check` and `readme:check` run here, and locally, and nowhere
  else — so a green release says the gates passed *at the tag*, not that they
  have passed on every commit. Wiring a push workflow is the prerequisite for
  displaying a CI badge, not the other way round.
