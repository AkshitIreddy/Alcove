"""scripts/gen-icons.py — render every shipped icon from the one master.

`assets/brand/alcove-art.png` is the source of truth for the mark. Tauri
wants a dozen sizes plus an .ico and an .icns, and hand-maintaining those is how
a brand ends up with three slightly different icons in one installer.

## Two things this does that a plain resize does not

**It cuts the frame.** The artwork is painted inside a black rounded rectangle.
An OS icon must not carry its own frame — Windows, the taskbar and the installer
all apply their own masking, so a painted-on rounded rect ships as a dark tile
with a second set of corners inside it. The surround is pure black and reaches
every corner while the darkest paint inside measures 11-19, so flooding black in
from the corners lifts the exact shape. No radius fitting, no drift if the
artwork is ever replaced.

**It treats small sizes differently.** Straight-downscaled to 32px this
illustration is a dark square with one red speck: the vines, crystals and
background survive shrinking as noise, and averaged noise is grey. Every size at
or below SMALL_AT instead crops past the scene onto the book so the silhouette
fills the tile, lifts brightness and contrast because a near-black icon on a
dark taskbar is invisible, and re-applies a rounded mask so the shape language
survives the crop. Verified by looking — see shots-now/icon-small.py, which
renders the alternatives side by side.

That treatment is also why this script writes icon.ico itself. An .ico is a
container of several sizes, and Windows picks from it for the taskbar, Explorer
and Alt-Tab — so the small-size renders have to be the ones inside it, or all
that work never reaches the surface that shows the icon most.

## The .ico is written by hand, and why

It used to be written by `Image.save(format="ICO", sizes=..., append_images=...)`.
Pillow's ICO encoder is a real one, but it makes two choices an OS icon should
not ship with, and `docs/packaging-icons.md` is the long version:

1. **It PNG-compresses every frame**, including 16/24/32/48. PNG inside an .ico
   is a Vista-era addition and is only conventionally safe at 256; below that
   the portable encoding is an uncompressed BMP/DIB. Windows 11 happens to read
   sub-256 PNG frames, so this was invisible on the machine that shipped it.
2. **It writes `wPlanes = 0`** in every directory entry. Windows picks a frame
   with `LookupIconIdFromDirectoryEx`, which ranks candidates on
   `wPlanes * wBitCount` — at 0 that product is 0 for every entry and the
   colour-depth half of the ranking collapses. `tauri_winres` silently
   normalises it to 1 when it embeds the icon in alcove.exe, but **NSIS copies
   it through verbatim**, so the installer stub shipped a worse icon directory
   than the app did. Measured, not assumed.

So `_ico()` below emits the container directly: BMP/DIB under 256, PNG at 256,
`wPlanes = 1` and `wBitCount = 32` throughout. `verify_ico()` re-reads whatever
was written and refuses to pass it silently — run `python scripts/gen-icons.py
--check` to audit the committed file without regenerating it.

## icon.icns is written here too, and why

It used to be left to `npx @tauri-apps/cli icon`, on the reasoning that macOS
was not a shipping target. CI now builds a macOS bundle, and the moment it did
the consequence showed: the committed `icon.icns` still carried the artwork from
two renames ago. Nothing regenerated it when the master changed, because nothing
in this repo knew how. Measured, not assumed — the mean absolute channel
difference between the old container's 1024px frame and the current master is
**75/255**, i.e. a different picture, not a stale encode.

The alternative was to run the Tauri CLI icon step inside the macOS build job.
That was rejected for the reason in the section below: the CLI rewrites the
close-crops, the installer bitmaps and `alcove-1024.png` as plain downscales, so
a build that ran it would ship art the repository does not contain, and only the
runner would ever have the right icon. One master, one script, one `--check`.

`build_icns()` emits the container directly for the same reason `_ico()` does:
the frame set is a decision (which OSTypes, at which sizes, with the small-size
treatment applied to the small ones) and a library that takes one image and
downscales it cannot express it. `verify_icns()` re-reads the bytes on disk,
decodes every frame — including round-tripping the run-length ones — and
compares the largest against the master, so a container that is merely *old*
fails as loudly as one that is malformed.

## Order matters

`npx @tauri-apps/cli icon` regenerates the PNGs as plain downscales and would
clobber the close-crops. There is now no reason to run it at all — this script
writes every icon Tauri names in `bundle.icon`, on Windows, macOS and Linux
alike. If you ever do run it, run it FIRST and then this script over the top:

    npx @tauri-apps/cli icon assets/brand/alcove-1024.png   # not needed any more
    python scripts/gen-icons.py

Usage:
    python scripts/gen-icons.py              # everything, from the master art
    python scripts/gen-icons.py --ico-only   # just repack icon.ico
    python scripts/gen-icons.py --icns-only  # just repack icon.icns
    python scripts/gen-icons.py --check      # audit the committed .ico AND .icns, exit 1 if bad
"""
from __future__ import annotations

import io
import struct
import sys
from collections import deque
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
except ImportError as exc:  # pragma: no cover
    sys.exit(f"needs pillow — pip install pillow ({exc})")

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets/brand/alcove-art.png"
ICONS = ROOT / "src-tauri/icons"
MASTER = ROOT / "assets/brand/alcove-1024.png"
ICO = ICONS / "icon.ico"
ICNS = ICONS / "icon.icns"

# How close a pixel must be to the corner colour to count as the surround.
# A tolerance rather than a threshold, because the surround is now DETECTED
# from the corners instead of assumed to be black — the first master had a
# black backing, the second a white one, and hard-coding either means the next
# icon swap silently ships a mark with a coloured box behind it.
SURROUND_TOL = 12
SMALL_AT = 64     # this size and below get the close-crop treatment
# Past the surround, onto the artwork. The supplied marks are a rounded badge
# that already fills most of the canvas, so this is a light trim rather than
# the deep crop the first (scene-in-an-alcove) master needed.
CROP = (0.03, 0.03, 0.97, 0.97)
RADIUS = 0.18     # rounded-mask radius as a fraction of the tile

# What goes in icon.ico. 16/32/48 are what Explorer, the Start menu and Alt-Tab
# actually ask for; 20/40 are those two at 125% DPI and Windows renders them
# blurry if it has to derive them; 24 is the small taskbar; 64/96/128 cover the
# large and extra-large views; 256 is the jumbo/Details tile.
ICO_SIZES = (16, 20, 24, 32, 40, 48, 64, 96, 128, 256)
ICO_PNG_FROM = 256   # this size and up is PNG-compressed, everything under it BMP/DIB
ICO_REQUIRED = (16, 32, 48)   # absent any of these, Explorer surfaces go blank

# What goes in icon.icns. macOS looks an icon up by OSType, and an OSType is a
# (point size, scale) pair rather than a pixel size — ic11 is "16pt at @2x",
# which is 32 pixels. A type that is absent is derived by resampling whichever
# one is present, and a derived 16pt lands visibly soft in Finder's list view
# and the Dock's smallest state. This is the same set `npx @tauri-apps/cli icon`
# emits, so replacing that step changes the artwork and nothing else.
ICNS_PNG = (
    ("ic11", 32),     # 16pt @2x
    ("ic12", 64),     # 32pt @2x
    ("ic07", 128),    # 128pt @1x
    ("ic13", 256),    # 128pt @2x
    ("ic08", 256),    # 256pt @1x
    ("ic14", 512),    # 256pt @2x
    ("ic09", 512),    # 512pt @1x
    ("ic10", 1024),   # 512pt @2x
)
# The two @1x small sizes predate PNG-in-icns and are still what the older
# lookup paths ask for. They are a 24-bit RLE colour frame plus a separate
# uncompressed 8-bit alpha frame — PNG is not accepted for these OSTypes.
ICNS_RLE = (
    ("is32", "s8mk", 16),    # 16pt @1x
    ("il32", "l8mk", 32),    # 32pt @1x
)
ICNS_REQUIRED = tuple(t for t, _ in ICNS_PNG) + tuple(
    t for pair in ((c, m) for c, m, _ in ICNS_RLE) for t in pair
)

# Freshness. Both images are flattened onto white, reduced to FRESH_AT and
# compared as a mean absolute channel difference, because the question is "is
# this the same picture" and not "are these the same bytes" — PNG output drifts
# between Pillow and zlib versions and a byte comparison would fail on a CI
# runner for no reason. The stale container this check was written for scored
# 75; a re-encode of the same art scores under 1.
FRESH_AT = 64
FRESH_TOL = 20.0

# Tauri's expected set. The Square*Logo files are the Windows Store tiles; the
# plain sizes are the Linux/dev ones. Names must match exactly — the bundler
# looks them up by filename.
TARGETS = [
    ("32x32.png", 32),
    ("64x64.png", 64),
    ("128x128.png", 128),
    ("128x128@2x.png", 256),
    ("icon.png", 512),
    ("Square30x30Logo.png", 30),
    ("Square44x44Logo.png", 44),
    ("Square71x71Logo.png", 71),
    ("Square89x89Logo.png", 89),
    ("Square107x107Logo.png", 107),
    ("Square142x142Logo.png", 142),
    ("Square150x150Logo.png", 150),
    ("Square284x284Logo.png", 284),
    ("Square310x310Logo.png", 310),
    ("StoreLogo.png", 50),
]


def unframe(im: Image.Image) -> Image.Image:
    """Flood the surround in from the corners and make it transparent.

    The surround colour is READ FROM THE CORNERS rather than assumed. The first
    master had a black backing and the second a white one; a hard-coded value
    means the next swap ships a mark with a coloured box behind it, and on a
    dark taskbar that box is the first thing anyone sees.

    Requires the four corners to agree — if they do not, the art bleeds to at
    least one edge and there is no surround to remove, so the image is returned
    untouched rather than having a hole flooded through it.
    """
    w, h = im.size
    px = im.load()
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    ref = corners[0]
    spread = max(
        abs(c[k] - ref[k]) for c in corners[1:] for k in range(3)
    )
    if spread > SURROUND_TOL:
        print(f"  corners disagree by {spread} — treating art as full-bleed, no unframe")
        return im.convert("RGBA")

    def is_surround(p) -> bool:
        return all(abs(p[k] - ref[k]) <= SURROUND_TOL for k in range(3))

    outside = bytearray(w * h)
    q = deque([(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)])

    while q:
        x, y = q.popleft()
        i = y * w + x
        if outside[i]:
            continue
        if not is_surround(px[x, y]):
            continue
        outside[i] = 1
        if x > 0:
            q.append((x - 1, y))
        if x < w - 1:
            q.append((x + 1, y))
        if y > 0:
            q.append((x, y - 1))
        if y < h - 1:
            q.append((x, y + 1))

    mask = Image.frombytes("L", (w, h), bytes(0 if b else 255 for b in outside))
    # Pull in half a pixel and soften: a hard 1-bit alpha edge on a rounded
    # corner reads as stair-steps at exactly the sizes an icon is seen at, and
    # leaves a black fringe where the frame's own stroke was.
    mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


def rounded(size: int, radius: int) -> Image.Image:
    """An antialiased rounded-rect mask, drawn 4x and downsampled."""
    s = 4
    m = Image.new("L", (size * s, size * s), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        (0, 0, size * s - 1, size * s - 1), radius=max(1, radius * s), fill=255
    )
    return m.resize((size, size), Image.LANCZOS)


def render(big: Image.Image, size: int) -> Image.Image:
    """One icon at one size, with the small-size treatment where it applies."""
    if size > SMALL_AT:
        return big.resize((size, size), Image.LANCZOS)

    w, h = big.size
    im = big.crop(
        (int(CROP[0] * w), int(CROP[1] * h), int(CROP[2] * w), int(CROP[3] * h))
    ).resize((size, size), Image.LANCZOS)

    rgb = im.convert("RGB")
    rgb = ImageEnhance.Brightness(rgb).enhance(1.45)
    rgb = ImageEnhance.Contrast(rgb).enhance(1.22)
    rgb = ImageEnhance.Color(rgb).enhance(1.18)

    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(rgb, (0, 0), rounded(size, round(size * RADIUS)))
    return out


# ---------------------------------------------------------------------------
# icon.ico — see the header, and docs/packaging-icons.md
# ---------------------------------------------------------------------------

def _dib(im: Image.Image) -> bytes:
    """One frame as an uncompressed 32-bit BMP/DIB, the way an .ico wants it.

    Three details that are easy to get wrong and silent when you do: biHeight is
    DOUBLE the real height (the header covers the colour bitmap and the AND mask
    as one image), the rows are stored bottom-up, and the AND mask rows are
    padded to a 4-byte boundary.
    """
    im = im.convert("RGBA")
    w, h = im.size
    flipped = im.transpose(Image.FLIP_TOP_BOTTOM)
    xor = flipped.tobytes("raw", "BGRA")

    # AND mask, 1 = transparent. Modern Windows reads the alpha channel and
    # ignores this, but downlevel readers do not, and an all-zero mask makes
    # them paint the transparent corners as solid black.
    alpha = flipped.getchannel("A")
    stride = ((w + 31) // 32) * 4
    mask = bytearray(stride * h)
    px = alpha.load()
    for y in range(h):
        row = y * stride
        for x in range(w):
            if px[x, y] < 128:
                mask[row + (x >> 3)] |= 0x80 >> (x & 7)

    header = struct.pack(
        "<IiiHHIIiiII",
        40,               # biSize
        w,                # biWidth
        h * 2,            # biHeight — colour bitmap plus AND mask
        1,                # biPlanes
        32,               # biBitCount
        0,                # biCompression = BI_RGB
        len(xor) + len(mask),   # biSizeImage
        0, 0,             # biX/YPelsPerMeter
        0, 0,             # biClrUsed / biClrImportant
    )
    return header + xor + bytes(mask)


def _ico(frames: dict[int, Image.Image]) -> bytes:
    """Assemble the .ico container by hand — Pillow's encoder is not usable here
    (it PNG-compresses every frame and writes wPlanes = 0; see the header)."""
    sizes = sorted(frames)
    blobs: list[bytes] = []
    for s in sizes:
        im = frames[s]
        if s >= ICO_PNG_FROM:
            buf = io.BytesIO()
            im.convert("RGBA").save(buf, format="PNG", optimize=True)
            blobs.append(buf.getvalue())
        else:
            blobs.append(_dib(im))

    out = bytearray(struct.pack("<HHH", 0, 1, len(sizes)))  # reserved, type=icon, count
    offset = 6 + 16 * len(sizes)
    for s, blob in zip(sizes, blobs):
        out += struct.pack(
            "<BBBBHHII",
            s % 256,      # bWidth  — 256 is written as 0, the field is one byte
            s % 256,      # bHeight
            0,            # bColorCount — 0 for anything deeper than 8bpp
            0,            # bReserved
            1,            # wPlanes    — NOT 0; Windows ranks on planes * bitcount
            32,           # wBitCount
            len(blob),    # dwBytesInRes
            offset,       # dwImageOffset
        )
        offset += len(blob)
    for blob in blobs:
        out += blob
    return bytes(out)


def verify_ico(path: Path) -> tuple[list[str], list[str]]:
    """Re-read a written .ico and check it against what Windows wants.

    Returns (problems, rows). Nothing here trusts the writer — it parses the
    bytes on disk, which is the only version that ships.
    """
    problems: list[str] = []
    rows: list[str] = []
    if not path.exists():
        return [f"{path} does not exist"], rows

    b = path.read_bytes()
    if len(b) < 6:
        return [f"{path.name} is {len(b)} bytes - not an .ico"], rows

    reserved, kind, count = struct.unpack_from("<HHH", b, 0)
    if reserved != 0 or kind != 1:
        problems.append(f"bad ICONDIR header: reserved={reserved} type={kind} (want 0, 1)")
    if count == 0:
        return problems + ["no frames"], rows

    seen: list[int] = []
    spans: list[tuple[int, int, int]] = []
    for i in range(count):
        off = 6 + i * 16
        if off + 16 > len(b):
            problems.append(f"entry {i}: directory runs past end of file")
            break
        w, h, ncolors, rsv, planes, bpp, nbytes, dataoff = struct.unpack_from(
            "<BBBBHHII", b, off
        )
        size = w or 256
        seen.append(size)

        if dataoff + nbytes > len(b):
            problems.append(f"{size}px: frame runs past end of file")
            continue
        spans.append((dataoff, dataoff + nbytes, size))
        data = b[dataoff:dataoff + nbytes]

        if planes != 1:
            problems.append(
                f"{size}px: wPlanes={planes}, want 1 - Windows ranks frames on "
                f"planes * bitCount and 0 flattens that to nothing"
            )
        if bpp != 32:
            problems.append(f"{size}px: wBitCount={bpp}, want 32")
        if rsv != 0:
            problems.append(f"{size}px: bReserved={rsv}, want 0")
        if (w or 256) != (h or 256):
            problems.append(f"{size}px: directory says {w or 256}x{h or 256}, want square")

        if data[:8] == b"\x89PNG\r\n\x1a\n":
            iw, ih = struct.unpack_from(">II", data, 16)
            enc = f"PNG {iw}x{ih}"
            if size < ICO_PNG_FROM:
                problems.append(
                    f"{size}px: PNG-compressed - only {ICO_PNG_FROM}px and up may be "
                    f"PNG, everything below must be BMP/DIB"
                )
            if (iw, ih) != (size, size):
                problems.append(f"{size}px: PNG payload is {iw}x{ih}, not {size}x{size}")
        elif len(data) >= 40:
            hsize, iw, ih, dplanes, dbpp = struct.unpack_from("<IiiHH", data, 0)
            enc = f"BMP {iw}x{ih // 2}"
            if size >= ICO_PNG_FROM:
                problems.append(
                    f"{size}px: uncompressed BMP at {size}px bloats the file - "
                    f"{ICO_PNG_FROM}px and up should be PNG"
                )
            if hsize != 40:
                problems.append(f"{size}px: DIB header is {hsize} bytes, want 40")
            if iw != size:
                problems.append(f"{size}px: DIB biWidth={iw}, want {size}")
            if ih != size * 2:
                problems.append(
                    f"{size}px: DIB biHeight={ih}, want {size * 2} - an icon DIB "
                    f"doubles its height to cover the AND mask"
                )
            if dplanes != 1 or dbpp != 32:
                problems.append(
                    f"{size}px: DIB planes={dplanes} bpp={dbpp}, want 1 and 32"
                )
            stride = ((size + 31) // 32) * 4
            want = 40 + size * size * 4 + stride * size
            if len(data) != want:
                problems.append(
                    f"{size}px: frame is {len(data)} bytes, want {want} "
                    f"(header + BGRA + padded AND mask)"
                )
        else:
            enc = "??"
            problems.append(f"{size}px: frame is {len(data)} bytes - not a DIB or a PNG")

        rows.append(
            f"  {size:>4}px  planes={planes} bpp={bpp:>2}  {len(data):>7} bytes  {enc}"
        )

    for need in ICO_REQUIRED:
        if need not in seen:
            problems.append(
                f"no {need}px frame - Explorer, the Start menu and Alt-Tab ask for "
                f"{'/'.join(str(s) for s in ICO_REQUIRED)} by name"
            )
    if len(set(seen)) != len(seen):
        dupes = sorted({s for s in seen if seen.count(s) > 1})
        problems.append(f"duplicate frame sizes: {dupes}")

    spans.sort()
    for (a_start, a_end, a_size), (b_start, b_end, b_size) in zip(spans, spans[1:]):
        if b_start < a_end:
            problems.append(f"frames {a_size}px and {b_size}px overlap in the file")

    return problems, rows


def report(path: Path) -> int:
    problems, rows = verify_ico(path)
    print(f"\n{path.relative_to(ROOT)} - {path.stat().st_size if path.exists() else 0} bytes")
    for r in rows:
        print(r)
    if problems:
        print(f"\n  {len(problems)} PROBLEM(S):")
        for p in problems:
            print(f"    ! {p}")
        return 1
    print("\n  ok - every frame is what Windows wants (see docs/packaging-icons.md)")
    return 0


def build_ico(art: Image.Image) -> None:
    """icon.ico, with each size rendered at its own treatment rather than one
    image downscaled inside the container. This is the file Windows reads for the
    taskbar, Explorer and the Start menu, and the one NSIS stamps into the
    installer, so it is the one that has to be right."""
    frames = {s: render(art, s) for s in ICO_SIZES}
    ICO.write_bytes(_ico(frames))
    print(f"  icon.ico ({', '.join(str(s) for s in ICO_SIZES)})")


# ---------------------------------------------------------------------------
# icon.icns — see the header, and docs/packaging-mac-linux.md
# ---------------------------------------------------------------------------

def _rle24(plane: bytes) -> bytes:
    """One 8-bit plane, run-length encoded the way an icns 24-bit frame wants.

    A PackBits variant, and the two ranges are the part that is silent when
    wrong: a RUN marker is `0x80 | (count - 3)`, so a run carries 3..130 bytes
    and never 1 or 2; a LITERAL marker is `count - 1`, so a literal carries
    1..128. That is what keeps the marker byte unambiguous — every literal
    marker is below 0x80 and every run marker is at or above it. Encode a
    two-byte run as a run and the decoder reads a byte that was never written.
    """
    out = bytearray()
    i, n = 0, len(plane)
    while i < n:
        run = 1
        while i + run < n and plane[i + run] == plane[i] and run < 130:
            run += 1
        if run >= 3:
            out.append(0x80 | (run - 3))
            out.append(plane[i])
            i += run
            continue
        start = i
        i += 1
        # A literal ends where a run worth encoding begins, or at 128 bytes.
        while i < n and i - start < 128:
            if i + 2 < n and plane[i] == plane[i + 1] == plane[i + 2]:
                break
            i += 1
        out.append(i - start - 1)
        out += plane[start:i]
    return bytes(out)


def _unrle24(blob: bytes, expected: int) -> tuple[bytes, int]:
    """Decode `expected` bytes back out. Returns (plane, bytes consumed).

    Only `verify_icns` calls this, and that is the point: an encoder that is
    checked by its own decoder is checked by nothing, so this one exists to be
    run against the file on disk and compared with the source pixels.
    """
    out = bytearray()
    i = 0
    while len(out) < expected:
        if i >= len(blob):
            raise ValueError("ran out of input")
        marker = blob[i]
        i += 1
        if marker & 0x80:
            count = (marker & 0x7F) + 3
            if i >= len(blob):
                raise ValueError("run marker with no byte after it")
            out += bytes([blob[i]]) * count
            i += 1
        else:
            count = marker + 1
            if i + count > len(blob):
                raise ValueError("literal runs past the end")
            out += blob[i:i + count]
            i += count
    return bytes(out), i


def _planes(im: Image.Image) -> tuple[bytes, bytes, bytes]:
    """R, G and B as three separate byte planes, plus nothing else.

    An icns 24-bit frame is channel-planar, not interleaved. Alpha does not
    live here at all — it goes in the paired s8mk/l8mk chunk.
    """
    rgba = im.convert("RGBA")
    r, g, b, _ = rgba.split()
    return r.tobytes(), g.tobytes(), b.tobytes()


def _icns(frames: dict[int, Image.Image]) -> bytes:
    """Assemble the .icns container by hand.

    Layout is as plain as it looks: the magic, the total length INCLUDING the
    8-byte header, then one chunk per frame of `OSType + length + data`, where
    the length again includes its own 8-byte header. Getting either length to
    exclude its header produces a file that parses far enough to look fine and
    then walks off the end.
    """
    body = bytearray()

    def chunk(ostype: str, data: bytes) -> None:
        body.extend(ostype.encode("ascii"))
        body.extend(struct.pack(">I", len(data) + 8))
        body.extend(data)

    for colour_type, mask_type, size in ICNS_RLE:
        im = frames[size].convert("RGBA")
        r, g, b = _planes(im)
        chunk(colour_type, _rle24(r) + _rle24(g) + _rle24(b))
        chunk(mask_type, im.getchannel("A").tobytes())

    for ostype, size in ICNS_PNG:
        buf = io.BytesIO()
        frames[size].convert("RGBA").save(buf, format="PNG", optimize=True)
        chunk(ostype, buf.getvalue())

    return b"icns" + struct.pack(">I", len(body) + 8) + bytes(body)


def freshness(frame: Image.Image, art: Image.Image, size: int) -> float:
    """Mean absolute channel difference between a shipped frame and the master.

    Flattened onto white first, because the transparent surround carries
    whatever RGB the encoder happened to leave there and comparing it would be
    comparing noise.
    """
    def thumb(im: Image.Image) -> list[tuple[int, int, int]]:
        rgba = im.convert("RGBA")
        flat = Image.new("RGB", rgba.size, (255, 255, 255))
        flat.paste(rgba, (0, 0), rgba)
        return list(flat.resize((FRESH_AT, FRESH_AT), Image.LANCZOS).getdata())

    a, b = thumb(frame), thumb(render(art, size))
    return sum(
        abs(x - y) for p, q in zip(a, b) for x, y in zip(p, q)
    ) / (len(a) * 3)


def verify_icns(path: Path, art: Image.Image | None = None) -> tuple[list[str], list[str]]:
    """Re-read a written .icns and check it against what macOS wants.

    Same contract as `verify_ico`: returns (problems, rows), trusts nothing the
    writer said, and parses the bytes that would actually ship. Pass `art` to
    also check the container is not simply OLD — that is the failure this file
    was written for, and it is the one a structural check cannot see.
    """
    problems: list[str] = []
    rows: list[str] = []
    if not path.exists():
        return [f"{path} does not exist"], rows

    b = path.read_bytes()
    if len(b) < 8:
        return [f"{path.name} is {len(b)} bytes - not an .icns"], rows

    magic, declared = struct.unpack_from(">4sI", b, 0)
    if magic != b"icns":
        problems.append(f"bad magic {magic!r}, want b'icns'")
    if declared != len(b):
        problems.append(
            f"header says {declared} bytes, file is {len(b)} - the length "
            f"counts the 8-byte header too"
        )

    want_png = dict(ICNS_PNG)
    want_rle = {c: s for c, _, s in ICNS_RLE}
    want_mask = {m: s for _, m, s in ICNS_RLE}

    seen: list[str] = []
    off = 8
    while off + 8 <= len(b):
        ostype_raw, length = struct.unpack_from(">4sI", b, off)
        ostype = ostype_raw.decode("ascii", "replace")
        if length < 8 or off + length > len(b):
            problems.append(f"{ostype}: chunk length {length} runs past the end of the file")
            break
        data = b[off + 8:off + length]
        seen.append(ostype)
        note = ""

        if ostype in want_png:
            size = want_png[ostype]
            if data[:8] != b"\x89PNG\r\n\x1a\n":
                problems.append(f"{ostype}: not a PNG - this OSType carries one")
            else:
                iw, ih = struct.unpack_from(">II", data, 16)
                note = f"PNG {iw}x{ih}"
                if (iw, ih) != (size, size):
                    problems.append(f"{ostype}: PNG is {iw}x{ih}, want {size}x{size}")
        elif ostype in want_rle:
            size = want_rle[ostype]
            note = f"RLE24 {size}x{size}"
            used = 0
            try:
                for channel in "RGB":
                    plane, consumed = _unrle24(data[used:], size * size)
                    if len(plane) != size * size:
                        problems.append(
                            f"{ostype}: {channel} plane decoded to {len(plane)} "
                            f"bytes, want {size * size}"
                        )
                    used += consumed
            except ValueError as exc:
                problems.append(f"{ostype}: run-length data is corrupt ({exc})")
            else:
                if used != len(data):
                    problems.append(
                        f"{ostype}: three planes decode out of {used} bytes but the "
                        f"chunk is {len(data)} - trailing junk or a fourth plane"
                    )
        elif ostype in want_mask:
            size = want_mask[ostype]
            note = f"alpha {size}x{size}"
            if len(data) != size * size:
                problems.append(
                    f"{ostype}: mask is {len(data)} bytes, want {size * size} - "
                    f"an 8-bit mask is uncompressed and one byte per pixel"
                )
        else:
            note = "unrecognised"

        rows.append(f"  {ostype}  {len(data):>8} bytes  {note}")
        off += length

    if off != len(b) and not problems:
        problems.append(f"{len(b) - off} trailing bytes after the last chunk")

    for need in ICNS_REQUIRED:
        if need not in seen:
            problems.append(f"no {need} chunk - macOS would resample a neighbour for it")
    if len(set(seen)) != len(seen):
        dupes = sorted({t for t in seen if seen.count(t) > 1})
        problems.append(f"duplicate chunk types: {dupes}")

    if art is not None and "ic10" in seen:
        off = 8
        while off + 8 <= len(b):
            ostype_raw, length = struct.unpack_from(">4sI", b, off)
            if ostype_raw == b"ic10":
                frame = Image.open(io.BytesIO(b[off + 8:off + length]))
                drift = freshness(frame, art, 1024)
                rows.append(f"  ic10 vs {SRC.name}: mean abs difference {drift:.1f}/255")
                if drift > FRESH_TOL:
                    problems.append(
                        f"ic10 differs from the master by {drift:.1f} (tolerance "
                        f"{FRESH_TOL}) - this container is STALE artwork, not a "
                        f"stale encode. Run: python scripts/gen-icons.py --icns-only"
                    )
                break
            off += length

    return problems, rows


def report_icns(path: Path, art: Image.Image | None = None) -> int:
    problems, rows = verify_icns(path, art)
    print(f"\n{path.relative_to(ROOT)} - {path.stat().st_size if path.exists() else 0} bytes")
    for r in rows:
        print(r)
    if problems:
        print(f"\n  {len(problems)} PROBLEM(S):")
        for p in problems:
            print(f"    ! {p}")
        return 1
    print("\n  ok - every chunk is what macOS wants, and the art is current")
    return 0


def build_icns(art: Image.Image) -> None:
    """icon.icns, every frame rendered at its own treatment.

    16 and 32 go through the same close-crop as their Windows counterparts:
    Finder's list view and the Dock's smallest state are exactly the sizes at
    which the full illustration averages to a grey square.
    """
    sizes = sorted({s for _, s in ICNS_PNG} | {s for _, _, s in ICNS_RLE})
    frames = {s: render(art, s) for s in sizes}
    ICNS.write_bytes(_icns(frames))
    print(f"  icon.icns ({len(ICNS_PNG) + 2 * len(ICNS_RLE)} chunks, "
          f"{', '.join(str(s) for s in sizes)}px)")


def build_installer_art(art: Image.Image) -> None:
    """The two NSIS bitmaps, drawn from the same master as everything else.

    These used to be left to the Tauri CLI, which meant they were the ONLY
    shipped surface not regenerated when the mark changed — and after two
    renames they were four days stale, still showing the previous app's
    artwork on the first screen of the installer.

    Both must be 24-bit BMP with no alpha: NSIS renders them through a control
    that has no idea what transparency is, and a 32-bit BMP comes out with a
    black box where the surround was. So the mark is composited onto the
    cream ground here rather than saved with its alpha intact.
    """
    ground = (246, 241, 230)

    def place(size: tuple[int, int], mark_h: float, at: str) -> Image.Image:
        w, h = size
        bmp = Image.new("RGB", size, ground)
        side = int(h * mark_h)
        mark = art.resize((side, side), Image.LANCZOS)
        if at == "left":
            pos = (int(h * 0.14), (h - side) // 2)
        else:
            pos = ((w - side) // 2, int(h * 0.10))
        bmp.paste(mark, pos, mark)
        return bmp

    header = place((150, 57), 0.82, "left")
    header.save(ICONS / "installer-header.bmp", "BMP")
    print("  installer-header.bmp (150x57)")

    sidebar = place((164, 314), 0.42, "top")
    sidebar.save(ICONS / "installer-sidebar.bmp", "BMP")
    print("  installer-sidebar.bmp (164x314)")


def main() -> int:
    args = sys.argv[1:]
    if "--check" in args:
        # The .icns audit needs the master to answer "is this the current
        # artwork", which is the whole reason it exists. Without the master it
        # still checks the container; it says so rather than passing silently.
        art = unframe(Image.open(SRC).convert("RGB")) if SRC.exists() else None
        if art is None:
            print(f"  note: {SRC} is missing - checking structure only, not freshness")
        return report(ICO) | report_icns(ICNS, art)

    if not SRC.exists():
        sys.exit(f"missing master: {SRC}")

    art = unframe(Image.open(SRC).convert("RGB"))
    print(f"  master {SRC.name} {art.size} - frame cut to alpha")
    ICONS.mkdir(parents=True, exist_ok=True)

    # --ico-only rebuilds the container and nothing else. The container encoding
    # and the artwork are separate concerns and have broken separately: a full
    # run also rewrites assets/brand/alcove-1024.png and fifteen PNGs, which is
    # churn (and a merge conflict) when all that changed is how the .ico is
    # packed.
    if "--ico-only" in args:
        build_ico(art)
        return report(ICO)

    if "--icns-only" in args:
        build_icns(art)
        return report_icns(ICNS, art)

    art.resize((1024, 1024), Image.LANCZOS).save(MASTER)
    print(f"  {MASTER.relative_to(ROOT)} (1024px)")

    for name, size in TARGETS:
        render(art, size).save(ICONS / name)
        tag = " close-crop" if size <= SMALL_AT else ""
        print(f"  {name} ({size}px){tag}")

    build_ico(art)
    build_icns(art)
    build_installer_art(art)

    rc = report(ICO) | report_icns(ICNS, art)
    print("\ndone. Every icon Tauri names in bundle.icon now comes from this one "
          "master;\n`npx @tauri-apps/cli icon` is no longer part of the pipeline.")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
