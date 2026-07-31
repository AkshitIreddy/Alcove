"""scripts/cut-spines.py — slice generated spine walls into individual sprites.

There is no image analysis here, and that is the point. An earlier version
scored columns for darkness and gradient energy to guess where one book ended
and the next began, which is a hard problem badly posed. Since
`make-spine-layout.py` *authored* the composition and ControlNet held the
generator to it, we already know where every book is: the layout JSON lists
the rectangles. Cutting is a crop.

That also makes the generated backdrop a non-issue. ControlNet fills the
negative space with whatever it likes -- velvet, plaster, shadow -- and none
of it is inside a rectangle, so none of it is ever cropped.

The one measurement that remains is a quality gate. ControlNet is a strong
hint, not a guarantee: occasionally a slot comes back as flat background
because the model merged two neighbours. A near-featureless crop is not a
book, so it is dropped rather than shipped.

Output: assets/spines/<wall>-<n>.png. Run gen-spinewall-cn.mjs first.

Usage: python scripts/cut-spines.py [--min-detail 0.020]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    import numpy as np
    from PIL import Image
except ImportError as exc:  # pragma: no cover - operator feedback
    sys.exit(f"needs numpy and pillow: {exc}")

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "spinewalls"
LAYOUTS = ROOT / "assets" / "spinelayouts"
OUT = ROOT / "assets" / "spines"

# Walls are named "<style>-L<n>.png"; the suffix names the layout to cut with.
NAME = re.compile(r"^(?P<style>[a-z]+)-L(?P<layout>\d+)$")

# The layout's stroke is 3px wide and the model paints board edges a little
# outside it, so pull in slightly: a sprite that carries a sliver of backdrop
# on one edge reads as a halo once it is composited onto a shelf.
INSET = 4


def detail_score(crop: np.ndarray) -> float:
    """How much structure is in this crop, as mean absolute local variation.

    A real spine has gilt, bands, grain and lettering and scores an order of
    magnitude above a slot the model filled with flat backdrop.
    """
    g = crop.astype(np.float32).mean(axis=2) / 255.0
    if g.shape[0] < 4 or g.shape[1] < 4:
        return 0.0
    return float(np.abs(np.diff(g, axis=0)).mean() + np.abs(np.diff(g, axis=1)).mean())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-detail", type=float, default=0.020)
    ap.add_argument("--min-width", type=int, default=30)
    args = ap.parse_args()

    if not SRC.is_dir():
        sys.exit(f"no {SRC} -- run scripts/gen-spinewall-cn.mjs first")
    OUT.mkdir(parents=True, exist_ok=True)

    layouts: dict[str, list[dict]] = {}
    total = dropped = 0

    for path in sorted(SRC.glob("*.png")):
        m = NAME.match(path.stem)
        if not m:
            print(f"  {path.name}: skipped (not a ControlNet wall)")
            continue
        key = m.group("layout")
        if key not in layouts:
            meta = LAYOUTS / f"layout-{key}.json"
            if not meta.is_file():
                print(f"  {path.name}: no {meta.name}")
                continue
            layouts[key] = json.loads(meta.read_text(encoding="utf-8"))["rects"]

        img = np.asarray(Image.open(path).convert("RGB"))
        kept = 0
        for r in layouts[key]:
            x0, y0 = r["x"] + INSET, r["y"] + INSET
            x1, y1 = r["x"] + r["w"] - INSET, r["y"] + r["h"] - INSET
            if x1 - x0 < args.min_width:
                continue
            crop = img[y0:y1, x0:x1]
            if detail_score(crop) < args.min_detail:
                dropped += 1
                continue
            kept += 1
            Image.fromarray(crop).save(OUT / f"{path.stem}-{kept:02d}.png")
        total += kept
        print(f"  {path.name}: {kept}/{len(layouts[key])} spines")

    print(f"\n{total} spines -> assets/spines ({dropped} dropped as featureless)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
