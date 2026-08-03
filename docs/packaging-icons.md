# Shipping icons on Windows: what `icon.ico` has to contain

This is the second packaging surface the icons have broken, so the rules are
written down here rather than living in one script's header.

- The **first** break: `npx @tauri-apps/cli icon` regenerates the PNGs as plain
  downscales and clobbers the close-crops, so it has to run **before**
  `scripts/gen-icons.py`, never after. Still true — see that script's header.
- The **second** break is this document: `icon.ico` was written by Pillow's ICO
  encoder, which packs a container Windows reads but no Windows tool would
  write.

Everything below was measured on this machine, not taken from a blog post. The
probes are reproducible and are described at the bottom.

## The chain, and who reads what

There are three consumers of `src-tauri/icons/icon.ico`, and they are not
equally forgiving:

| Consumer | How it gets there | What it does with the frames |
| --- | --- | --- |
| `alcove.exe` | `bundle.icon` in `tauri.conf.json` → `tauri-build` → `tauri_winres` | Splits the .ico into one `RT_ICON` per frame plus one `RT_GROUP_ICON`. **Normalises `wPlanes` to 1** on the way in. |
| The NSIS installer + `uninstall.exe` | `bundle.windows.nsis.installerIcon` → `Icon` in the generated `.nsi` | Same split, but **copies the directory entries verbatim** — including a wrong `wPlanes`. |
| The Start-menu shortcut | NSIS `CreateShortcut`, no icon argument | Stores **no** `IconLocation` at all (`LinkFlags` bit `HasIconLocation` is clear). The shell falls back to the target exe's default icon group. |

The third row is the one worth remembering: **the Start-menu shortcut has no
icon of its own.** Whatever is wrong with it is wrong with `alcove.exe`, and
there is no shortcut-side fix. `.lnk` inspection that reports `IconLocation`
as `,0` is reporting *absent*, not *index 0 of nothing*.

## The rules

An `.ico` is an `ICONDIR` header, then one 16-byte `ICONDIRENTRY` per frame,
then the frame payloads. Both halves have to be right.

**1. Carry 16, 32 and 48 at minimum.** Explorer, the Start menu, Alt-Tab and the
taskbar ask for these by name. A 256-only .ico renders blank in several shell
surfaces. We ship `16, 20, 24, 32, 40, 48, 64, 96, 128, 256`; 20 and 40 are 16
and 32 at 125% DPI, and 96 is 48 at 200% — without them Windows derives those
sizes by resampling and they land visibly soft.

**2. PNG-compress the 256 frame and nothing smaller.** PNG inside an .ico is a
Vista-era addition. By convention it is used only for 256×256, where an
uncompressed frame would cost 270 KB; below that the portable encoding is an
uncompressed BMP/DIB. Windows 11 *does* decode sub-256 PNG frames — which is
exactly why this shipped unnoticed — but downlevel shells and most third-party
icon readers do not.

**3. Every directory entry needs `wPlanes = 1`, not 0.** Windows selects a frame
with `LookupIconIdFromDirectoryEx`, which ranks candidates on
`wPlanes * wBitCount`. At `wPlanes = 0` that product is 0 for every entry and
the colour-depth half of the ranking collapses to nothing. Pillow writes 0.
`tauri_winres` quietly repairs it for the app exe; **NSIS does not**, so the
installer and uninstaller shipped a worse icon directory than the app did.

**4. A BMP/DIB frame is not a plain BMP.** Three details, all silent when wrong:

- `biHeight` is **double** the real height — the header describes the colour
  bitmap *and* the AND mask as one image.
- Rows are stored **bottom-up**.
- The AND mask is 1 bit per pixel with each row padded to a **4-byte** boundary,
  and `1` means transparent. Modern Windows reads the alpha channel and ignores
  the mask, but downlevel readers do not, and an all-zero mask makes them paint
  the transparent corners solid black.

So a correct frame is exactly `40 + 4·w·h + (((w + 31) // 32) · 4)·h` bytes.
`verify_ico()` checks that arithmetic.

**5. `bColorCount` is 0** for anything deeper than 8bpp, and `bWidth`/`bHeight`
are one byte each, so **256 is written as 0**.

## How this is enforced

`scripts/gen-icons.py` writes the container itself — `_ico()` and `_dib()` —
because Pillow's encoder cannot express "BMP below 256, PNG at 256" and always
writes `wPlanes = 0`.

    python scripts/gen-icons.py --check      # audit the committed file, exit 1 if bad
    python scripts/gen-icons.py --ico-only   # repack just icon.ico from the master art
    python scripts/gen-icons.py              # everything, including the PNG set

`--check` parses the bytes on disk rather than trusting the writer, and it is
not decorative: run against the file this document replaced it reported 13
problems. `--ico-only` exists because the container encoding and the artwork are
separate concerns that have now broken separately — a full run also rewrites
`assets/brand/alcove-1024.png` and fifteen PNGs, which is pure churn when all
that changed is how the .ico is packed.

`--check` is not yet wired into CI or vitest. Doing that is the obvious next
step and would want `"icons:check": "python scripts/gen-icons.py --check"` in
`package.json`.

## Reproducing the measurements

None of this needs `npm run tauri build`.

- **Frames actually in a .ico** — parse the `ICONDIR` directly; do not ask a
  library, because a library will hide exactly the fields that were wrong.
- **Frames actually in an exe** — walk the PE resource directory for `RT_ICON`
  (type 3) and `RT_GROUP_ICON` (type 14). This is how the `wPlanes` difference
  between `tauri_winres` and NSIS was found.
- **What the shell would draw** — `PrivateExtractIconsW(path, 0, size, size,…)`
  and `SHGetFileInfoW`, then convert the `HICON` to a bitmap and count opaque
  and non-black pixels. An icon that "loads" can still be fully transparent;
  counting pixels is what distinguishes a real icon from a blank one.
- **The installer, without building the app** — `makensis.exe` ships with the
  Tauri toolchain at `%LOCALAPPDATA%\tauri\NSIS\makensis.exe`. A four-line
  `.nsi` with `Icon "<path>"` and an empty `Section` compiles a stub in a second,
  and its resources can then be dumped like any other exe.
- **A stale shell icon cache** — test a **freshly created** shortcut rather than
  rebuilding the cache. A fresh `.lnk` has no cache entry, so if it resolves to
  a drawable icon the data is fine and only a cached blank could explain a blank
  tile.

## What this did *not* explain

The report that prompted this ("no icon in the Start menu, probably the same bug
for the installer") is not explained by the .ico. Measured on the installed
build **before** any change: all seven frames were present, `LoadImageW`,
`PrivateExtractIconsW` and `SHGetFileInfoW` each returned a fully drawable,
brightly coloured icon at 16/32/48/64/256, and a freshly created shortcut
resolved the same icon. The defects above are real and worth fixing, but they
were not fatal on Windows 11.

Two things that *are* worth knowing before chasing it again:

- The build in question was installed into
  `%LOCALAPPDATA%\Packages\Claude_…\LocalCache\Local\Alcove\` — an agent ran the
  installer inside a sandbox, so `$LOCALAPPDATA` was redirected into the package
  container. The shortcut records that physical path, so it does resolve, but
  this is not a normal install and conclusions from it travel badly.
- The icon's *own* legibility is a separate open item: the master is a rendered
  illustration and detail that survives at 256 turns to mush at 16. That is
  being redesigned with the owner and is not a packaging problem.
