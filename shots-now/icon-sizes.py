"""shots-now/icon-sizes.py — does the icon survive being small?

An app icon is seen at 32px in a taskbar far more often than at 1024. Detailed
artwork can be beautiful at full size and turn to a smudge at small ones, and
the only honest way to know is to downscale it and look.

Every shipped size, on a light ground and a dark one — a dark icon on a dark
taskbar is a different question from the same icon on a light one, and Windows
users have both.

Usage: python shots-now/icon-sizes.py [master.png]
"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError as exc:  # pragma: no cover
    sys.exit(f"needs pillow: {exc}")

ROOT = Path(__file__).resolve().parent.parent
SIZES = [256, 128, 64, 48, 32, 24, 16]
GROUNDS = [("light", (233, 226, 208)), ("dark", (32, 32, 38))]
PAD = 20
ROW = 256


def band(master: Image.Image, ground: tuple[int, int, int], width: int) -> Image.Image:
    im = Image.new("RGB", (width, ROW + PAD * 2), ground)
    x = PAD
    for s in SIZES:
        icon = master.resize((s, s), Image.LANCZOS)
        im.paste(icon, (x, PAD + (ROW - s) // 2), icon)
        # and again at 3x nearest-neighbour, so the small ones are inspectable
        if s <= 48:
            blown = icon.resize((s * 3, s * 3), Image.NEAREST)
            im.paste(blown, (x + (s - s * 3) // 2, PAD + ROW - s * 3 - 4), blown)
        x += max(s, 96) + PAD
    return im


def main() -> int:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "assets/brand/bellanote-1024.png"
    master = Image.open(src).convert("RGBA")

    width = PAD + sum(max(s, 96) + PAD for s in SIZES)
    sheet = Image.new("RGB", (width, (ROW + PAD * 2) * len(GROUNDS)), (0, 0, 0))
    for i, (_, ground) in enumerate(GROUNDS):
        sheet.paste(band(master, ground, width), (0, i * (ROW + PAD * 2)))

    out = ROOT / "shots-now/icon-sizes.png"
    sheet.save(out)
    print(f"{out.name}  {sheet.size}  sizes {SIZES}  (small ones repeated 3x nearest below)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
