"""shots-now/sharpness.py — an objective number for "is this crisp?".

Mean absolute Laplacian over a crop. Two captures of the SAME pixels at the
same zoom differ only in how the sampler read the texture, so a higher number
is strictly more edge energy — i.e. less blur. Guessing from a magnified crop
is how "it looks a bit sharper to me" gets shipped.

Usage: python shots-now/sharpness.py <x> <y> <w> <h> <src.png> [src.png ...]
"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image, ImageFilter
except ImportError as exc:  # pragma: no cover
    sys.exit(f"needs pillow: {exc}")


def score(path: Path, box: tuple[int, int, int, int]) -> float:
    im = Image.open(path).convert("L").crop(box)
    lap = im.filter(ImageFilter.Kernel((3, 3), (0, 1, 0, 1, -4, 1, 0, 1, 0), scale=1, offset=128))
    px = list(lap.getdata())
    return sum(abs(v - 128) for v in px) / len(px)


def main() -> int:
    if len(sys.argv) < 6:
        sys.exit(__doc__.strip().splitlines()[-1])
    x, y, w, h = (int(v) for v in sys.argv[1:5])
    box = (x, y, x + w, y + h)
    base = None
    for name in sys.argv[5:]:
        s = score(Path(name), box)
        if base is None:
            base = s
        print(f"  {Path(name).name:28s} edge energy {s:7.3f}   {s / base * 100:6.1f}% of first")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
