"""scripts/make-spine-layout.py — draw the control images for spine generation.

Three rounds of prompt-only generation established that SDXL gives us
reference-grade *material* and no *composition* at all: books came back
cropped through the head, floating at random heights, lying flat, or arranged
as an aerial jumble. No amount of adjectives fixes that, because framing is
not a semantic property.

So we stop asking and start dictating. This draws a literal diagram of the row
we want -- N rectangles of varying width and height, feet on a common
baseline, air above the tallest -- and ControlNet makes SDXL paint books into
exactly those boxes. Composition becomes a parameter; the model is left to do
only the thing it is extraordinary at, which is surface.

Feet-on-a-baseline is the one non-obvious constraint. Real books on a shelf
align at the tail, never at the head, and a row whose heights vary around a
shared bottom edge is instantly readable as a shelf; the same rectangles
centred vertically read as a floating chart.

Each layout is written twice: as a PNG for ControlNet, and as JSON listing the
rectangles. The JSON is what makes cutting trivial -- because we authored the
composition we already know where every book is, so `cut-spines.py` crops at
known coordinates instead of guessing at gutters or keying a background. That
also makes the generated backdrop irrelevant: ControlNet likes to fill the
negative space with velvet or plaster, and none of it is ever cropped.

Output: assets/spinelayouts/layout-<n>.png + layout-<n>.json

Usage: python scripts/make-spine-layout.py [--count 6] [--width 1536]
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError as exc:  # pragma: no cover - operator feedback
    sys.exit(f"needs pillow: {exc}")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "spinelayouts"

# Margins keep every book fully inside the frame, which is what stops the
# generator beheading the tall ones. The floor margin is generous so the tail
# edge and its contact shadow both have room.
MARGIN_X = 24
FLOOR = 64
CEILING = 40


def draw_layout(seed: int, width: int, height: int) -> tuple[Image.Image, list[dict]]:
    rng = random.Random(seed)
    img = Image.new("RGB", (width, height), (0, 0, 0))
    d = ImageDraw.Draw(img)
    rects: list[dict] = []

    baseline = height - FLOOR
    tallest = height - FLOOR - CEILING

    x = MARGIN_X
    limit = width - MARGIN_X
    while x < limit:
        w = rng.randint(52, 168)
        if x + w > limit:
            # Rather than emit a sliver that will cut into a half-book, widen
            # the last volume to close the row exactly.
            if limit - x < 52:
                break
            w = limit - x
        # Heights cluster tall with a long tail downward: a shelf is mostly
        # full-height volumes punctuated by the occasional short one, not a
        # uniform spread.
        h = int(tallest * (0.62 + rng.random() ** 2 * 0.38))
        top = baseline - h

        d.rectangle([x, top, x + w, baseline], outline=(255, 255, 255), width=3)
        # An interior line reads as a raised band or a label panel and gives
        # the model something to hang spine furniture on, so the results are
        # not blank slabs of leather.
        #
        # Sparingly, though. The first ControlNet pass drew a band near the
        # head of nearly every book and the model turned every one of them
        # into a gold metal cap -- fourteen identical caps in a row, which is
        # precisely the visible repetition ART-BIBLE.md forbids. A band on
        # roughly a third of the books, at a position that ranges over the
        # whole spine, gives variety instead of a motif.
        if rng.random() < 0.34:
            band = top + int(h * rng.uniform(0.14, 0.80))
            d.line([x, band, x + w, band], fill=(255, 255, 255), width=2)

        rects.append({"x": x, "y": top, "w": w, "h": baseline - top})
        x += w + rng.randint(2, 5)

    return img, rects


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=6)
    ap.add_argument("--width", type=int, default=1536)
    ap.add_argument("--height", type=int, default=1024)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for i in range(args.count):
        img, rects = draw_layout(args.seed + i * 101, args.width, args.height)
        stem = f"layout-{i + 1}"
        img.save(OUT / f"{stem}.png")
        (OUT / f"{stem}.json").write_text(
            json.dumps({"width": args.width, "height": args.height, "rects": rects}, indent=1),
            encoding="utf-8",
        )
        total += len(rects)
        print(f"  {stem}: {len(rects)} books")
    print(f"\n{args.count} layouts, {total} book slots -> assets/spinelayouts")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
