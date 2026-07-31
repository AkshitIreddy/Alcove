"""shots-now/icon-shipped.py — look at the files that actually ship.

Everything up to here inspected images held in memory mid-pipeline. This reads
the PNGs and the .ico back off disk, because the interesting failures happen in
the gap between what a generator computed and what it wrote: a container that
silently kept one size, an alpha channel flattened on save, a treatment applied
to the working copy but not the output.

Left band: the shipped PNGs, on cream and on charcoal.
Right band: every frame unpacked out of icon.ico, which is the file Windows
actually reads for the taskbar.
"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, IcoImagePlugin  # noqa: F401  (registers the plugin)
except ImportError as exc:  # pragma: no cover
    sys.exit(f"needs pillow: {exc}")

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "src-tauri/icons"
PNGS = ["Square30x30Logo.png", "32x32.png", "Square44x44Logo.png", "StoreLogo.png",
        "64x64.png", "Square89x89Logo.png", "128x128.png", "128x128@2x.png"]
GROUNDS = [(233, 226, 208), (32, 32, 38)]
PAD = 16
ROW = 200


def strip(images: list[Image.Image], ground, width: int) -> Image.Image:
    band = Image.new("RGB", (width, ROW), ground)
    x = PAD
    for im in images:
        band.paste(im, (x, 8), im)
        if im.width <= 64:  # repeat at 3x nearest so it is inspectable
            b = im.resize((im.width * 3, im.height * 3), Image.NEAREST)
            band.paste(b, (x, ROW - b.height - 8), b)
        x += max(im.width, 72) + PAD
    return band


def main() -> int:
    pngs = []
    for name in PNGS:
        p = ICONS / name
        if not p.exists():
            print(f"  MISSING {name}")
            continue
        im = Image.open(p).convert("RGBA")
        corner = im.getpixel((1, 1))[3]
        print(f"  {name:22} {im.size[0]:>3}px  corner alpha {corner}")
        pngs.append(im)

    ico = Image.open(ICONS / "icon.ico")
    have = sorted(ico.ico.sizes())
    print(f"\n  icon.ico frames: {[s[0] for s in have]}")
    frames = []
    for s in have:
        ico.size = s
        frames.append(ico.load().copy().convert("RGBA") if False else ico.ico.getimage(s).convert("RGBA"))

    width = PAD + sum(max(im.width, 72) + PAD for im in pngs)
    iwidth = PAD + sum(max(im.width, 72) + PAD for im in frames)
    sheet = Image.new("RGB", (max(width, iwidth), ROW * 4 + 24), (90, 90, 96))

    y = 0
    for ground in GROUNDS:
        sheet.paste(strip(pngs, ground, max(width, iwidth)), (0, y))
        y += ROW + 6
    for ground in GROUNDS:
        sheet.paste(strip(frames, ground, max(width, iwidth)), (0, y))
        y += ROW + 6

    out = ROOT / "shots-now/icon-shipped.png"
    sheet.save(out)
    print(f"\n{out.name}  {sheet.size}  (rows: PNGs light/dark, then .ico light/dark)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
