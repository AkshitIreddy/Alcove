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

## Order matters

`npx @tauri-apps/cli icon` regenerates the PNGs as plain downscales and would
clobber the close-crops. Run it FIRST, for icon.icns and the installer bitmaps,
then this script:

    npx @tauri-apps/cli icon assets/brand/alcove-1024.png
    python scripts/gen-icons.py

Usage:
    python scripts/gen-icons.py              # everything, from the master art
    python scripts/gen-icons.py --ico-only   # just repack icon.ico
    python scripts/gen-icons.py --check      # audit the committed icon.ico, exit 1 if bad
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
        return report(ICO)

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

    art.resize((1024, 1024), Image.LANCZOS).save(MASTER)
    print(f"  {MASTER.relative_to(ROOT)} (1024px)")

    for name, size in TARGETS:
        render(art, size).save(ICONS / name)
        tag = " close-crop" if size <= SMALL_AT else ""
        print(f"  {name} ({size}px){tag}")

    build_ico(art)
    build_installer_art(art)

    # icon.icns is left to `npx @tauri-apps/cli icon` — macOS only, and this
    # ships on Windows, so there is nothing here to verify it against.
    rc = report(ICO)
    print("\ndone. icon.icns still comes from `npx @tauri-apps/cli icon` (macOS "
          "only);\nrun that BEFORE this script or it overwrites the close-crops.")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
