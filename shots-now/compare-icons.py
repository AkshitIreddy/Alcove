"""shots-now/compare-icons.py — is the screenshot really bluer, or does it look it?

The reader saw the same artwork rendered two ways and said one was "cooler,
sharper, bluer". Two images that differ only in how a viewer rendered them
would be a colour-profile story; two that differ in their actual pixels is a
different fix. Measuring settles it in one run — the eye is famously bad at
absolute colour, and this exact question has already been got wrong once in
this project by comparing two browns by eye.
"""
from __future__ import annotations

import statistics
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError as exc:  # pragma: no cover
    sys.exit(f"needs pillow: {exc}")


def stats(im: Image.Image, name: str) -> None:
    px = list(im.convert("RGB").resize((64, 64)).getdata())
    r = statistics.mean(p[0] for p in px)
    g = statistics.mean(p[1] for p in px)
    b = statistics.mean(p[2] for p in px)
    peak = max(max(p) for p in px)
    print(f"  {name:12} mean rgb {r:5.1f} {g:5.1f} {b:5.1f}   blue-red {b - r:+5.1f}   peak {peak}")


def main() -> int:
    if len(sys.argv) < 3:
        sys.exit("usage: compare-icons.py <a.png> <b.png>")
    a = Image.open(Path(sys.argv[1])).convert("RGB")
    b = Image.open(Path(sys.argv[2])).convert("RGB")

    print(f"  sizes: {a.size} vs {b.size}")
    stats(a, "first")
    stats(b, "second")

    print("\n  same relative points:")
    for fx, fy in [(0.50, 0.42), (0.22, 0.35), (0.62, 0.30), (0.50, 0.72), (0.80, 0.18)]:
        pa = a.getpixel((int(fx * a.width), int(fy * a.height)))
        pb = b.getpixel((int(fx * b.width), int(fy * b.height)))
        print(f"    {fx:.2f},{fy:.2f}  {str(pa):>18}  {str(pb):>18}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
