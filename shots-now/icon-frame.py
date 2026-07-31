"""shots-now/icon-frame.py — cut the artwork's baked-in frame to transparency.

The supplied artwork is drawn INSIDE a black rounded rectangle. An OS icon must
not carry its own frame: Windows, the taskbar and the installer all apply their
own masking, so a painted-on rounded rect ends up as a dark tile with a second
set of corners inside it. The frame has to become transparent.

Guessing the corner radius was the wrong approach — the rect spans the whole
canvas, so only the corners show surround and there is almost no straight run
to measure from. The shape is already in the file: the surround is pure black
(0,0,0) and reaches every corner, while the darkest paint INSIDE the frame
measures 11-19. So flood the black in from the four corners and whatever it
reaches is the frame. No radius, no fitting, no drift if the artwork changes.

Feathering the resulting mask by a hair matters more than it sounds: a hard
1-bit alpha edge on a rounded corner reads as stair-steps at exactly the sizes
an icon is usually seen at.
"""
from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

try:
    from PIL import Image, ImageFilter
except ImportError as exc:  # pragma: no cover
    sys.exit(f"needs pillow: {exc}")

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets/brand/bellanote-art.png"
OUT = ROOT / "assets/brand/bellanote-1024.png"

SURROUND = 6  # max channel value still counted as "the black outside"


def main() -> int:
    im = Image.open(SRC).convert("RGB")
    w, h = im.size
    px = im.load()

    outside = bytearray(w * h)
    q = deque()
    for xy in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        q.append(xy)

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

    cut = sum(outside)
    print(f"  source   {im.size}")
    print(f"  surround {cut} px ({cut / (w * h) * 100:.1f}% of the canvas)")

    mask = Image.frombytes("L", (w, h), bytes(255 if not b else 0 for b in outside))
    # Pull the mask in half a pixel and soften it, so the corner is a clean
    # curve rather than a staircase and no black fringe survives on the edge.
    mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))

    art = im.resize((1024, 1024), Image.LANCZOS)
    out = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    out.paste(art, (0, 0), mask.resize((1024, 1024), Image.LANCZOS))
    out.save(OUT)

    a = out.split()[3]
    corners = [a.getpixel(p) for p in ((2, 2), (1021, 2), (2, 1021), (1021, 1021))]
    centre = a.getpixel((512, 512))
    print(f"  wrote    {OUT.name}  corner alpha {corners} (want 0s)  centre {centre} (want 255)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
