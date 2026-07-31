"""shots-now/compare.py — the specimen and the live app, stacked.

The specimen is the reference: it is the flat vocabulary drawn straight onto a
canvas with nothing on top. The app is only finished when it looks like that.

Showing them apart is how the last round went wrong — a good specimen implied
a good app, and the app was being blown out by a lighting pass drawn after the
art. Same frame, same width, no excuses.

Usage: python shots-now/compare.py
"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError as exc:  # pragma: no cover - operator feedback
    sys.exit(f"needs pillow: {exc}")

HERE = Path(__file__).resolve().parent
PAIRS = [("specimen.png", "the drawing (specimen.html)"), ("shelf-flat.png", "the app")]
LABEL_H = 34
BG = (233, 226, 208)
INK = (79, 49, 32)


def main() -> int:
    images = []
    for name, label in PAIRS:
        path = HERE / name
        if not path.is_file():
            sys.exit(f"missing {path} — run shots-now/specimen.mjs and shots-now/shot.mjs first")
        images.append((Image.open(path).convert("RGB"), label))

    width = min(im.width for im, _ in images)
    scaled = []
    for im, label in images:
        if im.width != width:
            h = round(im.height * width / im.width)
            im = im.resize((width, h), Image.LANCZOS)
        scaled.append((im, label))

    total = sum(im.height + LABEL_H for im, _ in scaled)
    out = Image.new("RGB", (width, total), BG)
    d = ImageDraw.Draw(out)

    y = 0
    for im, label in scaled:
        d.text((12, y + 10), label, fill=INK)
        y += LABEL_H
        out.paste(im, (0, y))
        y += im.height

    dest = HERE / "compare.png"
    out.save(dest)
    print(f"{dest}  ({width}x{total})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
