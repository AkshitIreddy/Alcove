"""shots-now/icon-small.py — try three ways of saving the icon at 16-48px.

Downscaling the full illustration to 32px produced a dark square with one red
speck. The scene is the problem, not the book: vines, crystals and background
survive shrinking as noise, and noise averaged together is grey. So test
treatments that spend the few pixels available on the subject instead.

  plain    straight LANCZOS downscale — the baseline that failed
  crop     zoom past the scene onto the book, so the silhouette fills the tile
  lift     crop, then raise brightness and contrast, because a very dark icon
           on a dark taskbar is invisible no matter how sharp it is

Writes one sheet with all three at every small size, on both grounds. The point
is to look at it, not to reason about it.
"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageEnhance
except ImportError as exc:  # pragma: no cover
    sys.exit(f"needs pillow: {exc}")

ROOT = Path(__file__).resolve().parent.parent
SIZES = [64, 48, 32, 24, 16]
GROUNDS = [(233, 226, 208), (32, 32, 38)]
PAD = 18
CELL = 150

# The book sits centre-left; the crystals and vines that turn to mush are in
# the outer margin. Fractions of the master, measured off the 1024 render.
CROP = (0.07, 0.06, 0.95, 0.94)


def treat(master: Image.Image, mode: str, size: int) -> Image.Image:
    im = master
    if mode != "plain":
        w, h = im.size
        im = im.crop((int(CROP[0] * w), int(CROP[1] * h), int(CROP[2] * w), int(CROP[3] * h)))
    im = im.resize((size, size), Image.LANCZOS)
    if mode == "lift":
        rgb, a = im.convert("RGB"), im.split()[3]
        rgb = ImageEnhance.Brightness(rgb).enhance(1.45)
        rgb = ImageEnhance.Contrast(rgb).enhance(1.22)
        rgb = ImageEnhance.Color(rgb).enhance(1.18)
        im = rgb.convert("RGBA")
        im.putalpha(a)
    return im


def main() -> int:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "assets/brand/bellanote-1024.png"
    master = Image.open(src).convert("RGBA")
    modes = ["plain", "crop", "lift"]

    width = PAD + len(SIZES) * (CELL + PAD)
    height = len(GROUNDS) * len(modes) * (CELL + PAD) + PAD
    sheet = Image.new("RGB", (width, height), (90, 90, 96))

    y = PAD
    for ground in GROUNDS:
        for mode in modes:
            row = Image.new("RGB", (width, CELL), ground)
            x = PAD
            for s in SIZES:
                icon = treat(master, mode, s)
                # actual size, then 3x nearest so it is inspectable on screen
                row.paste(icon, (x, 6), icon)
                blown = icon.resize((s * 3, s * 3), Image.NEAREST)
                row.paste(blown, (x, CELL - s * 3 - 6), blown)
                x += CELL + PAD
            sheet.paste(row, (0, y))
            y += CELL + PAD

    out = ROOT / "shots-now/icon-small.png"
    sheet.save(out)
    print(f"{out.name}  {sheet.size}")
    print(f"  rows: light[{', '.join(modes)}] then dark[{', '.join(modes)}]")
    print(f"  cols: {SIZES}   (true size top-left, 3x nearest below)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
