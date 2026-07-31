"""scripts/gen-icons.py — render every shipped icon from the one master.

`assets/brand/bellanote-art.png` is the source of truth for the mark. Tauri
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
that work never reaches the surface that shows the icon most. Pillow's ICO
encoder is a real one; this is not a PNG renamed.

## Order matters

`npx @tauri-apps/cli icon` regenerates the PNGs as plain downscales and would
clobber the close-crops. Run it FIRST, for icon.icns and the installer bitmaps,
then this script:

    npx @tauri-apps/cli icon assets/brand/bellanote-1024.png
    python scripts/gen-icons.py

Usage: python scripts/gen-icons.py
"""
from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
except ImportError as exc:  # pragma: no cover
    sys.exit(f"needs pillow — pip install pillow ({exc})")

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets/brand/bellanote-art.png"
ICONS = ROOT / "src-tauri/icons"
MASTER = ROOT / "assets/brand/bellanote-1024.png"

SURROUND = 6      # max channel still counted as the black outside the frame
SMALL_AT = 64     # this size and below get the close-crop treatment
CROP = (0.07, 0.06, 0.95, 0.94)   # past the scene, onto the book
RADIUS = 0.18     # rounded-mask radius as a fraction of the tile

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
    """Flood the black surround in from the corners and make it transparent."""
    w, h = im.size
    px = im.load()
    outside = bytearray(w * h)
    q = deque([(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)])

    while q:
        x, y = q.popleft()
        i = y * w + x
        if outside[i]:
            continue
        p = px[x, y]
        if p[0] > SURROUND or p[1] > SURROUND or p[2] > SURROUND:
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


def main() -> int:
    if not SRC.exists():
        sys.exit(f"missing master: {SRC}")

    art = unframe(Image.open(SRC).convert("RGB"))
    print(f"  master {SRC.name} {art.size} — frame cut to alpha")

    ICONS.mkdir(parents=True, exist_ok=True)
    art.resize((1024, 1024), Image.LANCZOS).save(MASTER)
    print(f"  {MASTER.relative_to(ROOT)} (1024px)")

    for name, size in TARGETS:
        render(art, size).save(ICONS / name)
        tag = " close-crop" if size <= SMALL_AT else ""
        print(f"  {name} ({size}px){tag}")

    # icon.ico, with each size rendered at its own treatment rather than one
    # image downscaled inside the container. This is the file Windows reads for
    # the taskbar and Explorer, so it is the one that has to be right.
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [render(art, s) for s in ico_sizes]
    frames[-1].save(ICONS / "icon.ico", format="ICO", sizes=[(s, s) for s in ico_sizes],
                    append_images=frames[:-1])
    print(f"  icon.ico ({', '.join(str(s) for s in ico_sizes)})")

    # icon.icns is left to `npx @tauri-apps/cli icon` — macOS only, and this
    # ships on Windows, so there is nothing here to verify it against.
    print("\ndone. icon.icns and the installer bitmaps come from the Tauri CLI;\n"
          "run it BEFORE this script or it overwrites the close-crops.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
