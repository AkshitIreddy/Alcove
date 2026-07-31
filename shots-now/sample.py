"""shots-now/sample.py — did switching rooms actually repaint the case?

Reading two screenshots side by side is how the last mistake happened: two
warm browns look identical to the eye and are not, and a genuinely unchanged
surface looks plausible next to three that changed. Sampling the pixels
answers it in a way looking cannot.

Usage: python shots-now/sample.py <before.png> <after.png>
"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError as exc:  # pragma: no cover - operator feedback
    sys.exit(f"needs pillow: {exc}")

HERE = Path(__file__).resolve().parent

# Points chosen to sit on one flat surface each, clear of books and chrome.
POINTS = {
    "recess": (1000, 700),
    "wall": (1400, 500),
    "plank": (1000, 817),
    "crown": (1000, 33),
    "post": (1210, 500),
}


def main() -> int:
    if len(sys.argv) < 3:
        sys.exit("usage: sample.py <before.png> <after.png>")
    a = Image.open(HERE.parent / sys.argv[1]).convert("RGB")
    b = Image.open(HERE.parent / sys.argv[2]).convert("RGB")

    for name, xy in POINTS.items():
        pa = a.getpixel(xy)
        pb = b.getpixel(xy)
        delta = sum(abs(x - y) for x, y in zip(pa, pb))
        verdict = "UNCHANGED" if delta <= 6 else f"changed (d={delta})"
        print(f"  {name:8} {pa} -> {pb}  {verdict}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
