"""shots-now/crop.py — magnify a region of a capture so it can be judged.

A book spine is ~30px wide on a 1500px shelf shot. Deciding whether its gilt
bands, endbands and label are actually drawn from that is guessing; blown up
with nearest-neighbour it is a fact. Also prints the median colour of the
region, because two warm reds look identical by eye and this project has
already been caught calling two browns different.

Usage: python shots-now/crop.py <src.png> <x> <y> <w> <h> [scale] [out.png]
"""
from __future__ import annotations

import statistics
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError as exc:  # pragma: no cover
    sys.exit(f"needs pillow: {exc}")


def main() -> int:
    if len(sys.argv) < 6:
        sys.exit(__doc__.strip().splitlines()[-1])
    src = Path(sys.argv[1])
    x, y, w, h = (int(v) for v in sys.argv[2:6])
    scale = int(sys.argv[6]) if len(sys.argv) > 6 else 6
    out = Path(sys.argv[7]) if len(sys.argv) > 7 else src.with_name(f"{src.stem}-crop.png")

    im = Image.open(src).convert("RGB").crop((x, y, x + w, y + h))
    px = list(im.getdata())
    med = tuple(int(statistics.median(p[k] for p in px)) for k in range(3))
    print(f"  {src.name} [{x},{y} {w}x{h}]  median rgb {med}  hex #{med[0]:02x}{med[1]:02x}{med[2]:02x}")

    im.resize((w * scale, h * scale), Image.NEAREST).save(out)
    print(f"  -> {out.name} ({w * scale}x{h * scale}, {scale}x nearest)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
