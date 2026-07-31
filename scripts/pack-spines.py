"""scripts/pack-spines.py — pack cut spine sprites into shipped atlas pages.

The runtime half of the render reset. `assets/spines/` holds a few hundred
full-resolution crops; this scales them once, shelf-packs them into 2048x2048
WebP pages under `public/spines/`, and writes a manifest. At runtime the app
loads two or three images and blits sub-rectangles -- no atlas construction,
no worker pool, no idle-time chunking, no painting.

## Uniform scale, not uniform size

Every sprite is scaled by the SAME factor, never normalised to a common
height. Book heights are the whole point: a row of mixed heights is what
makes a shelf read as a shelf, and normalising would throw that away and
force the app to reconstruct it from metadata. Because the factor is shared,
the packed pixel dimensions *are* the relative proportions, and the app can
draw a sprite at (w, h) * worldScale and be correct by construction.

0.5 is chosen so the tallest book lands near 460px, which covers the app's
2x hi-res zoom without carrying resolution nothing will ever sample.

Output: public/spines/atlas-<n>.webp + public/spines/manifest.json

Usage: python scripts/pack-spines.py [--scale 0.5] [--page 2048]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError as exc:  # pragma: no cover - operator feedback
    sys.exit(f"needs pillow: {exc}")

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "spines"
OUT = ROOT / "public" / "spines"

# Sprites are named "<style>-L<layout>-<n>.png"; style is what the themes
# select on, so it has to survive into the manifest.
NAME = re.compile(r"^(?P<style>[a-z]+)-L\d+-\d+$")

PAD = 2  # keeps bilinear sampling from bleeding a neighbour into an edge


class Packer:
    """Shelf packer: rows of equal height, next row starts below the tallest.

    Spines are sorted tall-first before packing, so rows are near-uniform and
    the waste a naive shelf packer is famous for never materialises here.
    """

    def __init__(self, size: int) -> None:
        self.size = size
        self.x = PAD
        self.y = PAD
        self.row_h = 0

    def place(self, w: int, h: int) -> tuple[int, int] | None:
        if self.x + w + PAD > self.size:
            self.x = PAD
            self.y += self.row_h + PAD
            self.row_h = 0
        if self.y + h + PAD > self.size:
            return None
        pos = (self.x, self.y)
        self.x += w + PAD
        self.row_h = max(self.row_h, h)
        return pos


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scale", type=float, default=0.5)
    ap.add_argument("--page", type=int, default=2048)
    ap.add_argument("--quality", type=int, default=90)
    args = ap.parse_args()

    if not SRC.is_dir():
        sys.exit(f"no {SRC} -- run scripts/cut-spines.py first")
    OUT.mkdir(parents=True, exist_ok=True)

    sprites = []
    for path in sorted(SRC.glob("*.png")):
        m = NAME.match(path.stem)
        if not m:
            continue
        img = Image.open(path).convert("RGB")
        w = max(1, int(img.width * args.scale))
        h = max(1, int(img.height * args.scale))
        sprites.append((path.stem, m.group("style"), img.resize((w, h), Image.LANCZOS)))

    if not sprites:
        sys.exit(f"no sprites in {SRC}")

    sprites.sort(key=lambda s: -s[2].height)

    pages: list[Image.Image] = []
    frames: list[dict] = []
    packer = Packer(args.page)
    page = Image.new("RGB", (args.page, args.page), (0, 0, 0))
    pages.append(page)

    for stem, style, img in sprites:
        pos = packer.place(img.width, img.height)
        if pos is None:
            packer = Packer(args.page)
            page = Image.new("RGB", (args.page, args.page), (0, 0, 0))
            pages.append(page)
            pos = packer.place(img.width, img.height)
            if pos is None:
                print(f"  ! {stem} does not fit a page, skipped")
                continue
        page.paste(img, pos)
        frames.append({
            "id": stem,
            "style": style,
            "page": len(pages) - 1,
            "x": pos[0], "y": pos[1],
            "w": img.width, "h": img.height,
        })

    for i, p in enumerate(pages):
        p.save(OUT / f"atlas-{i}.webp", quality=args.quality, method=6)

    # Sorting by id makes the manifest a stable diff across regenerations,
    # which matters because it is checked in.
    frames.sort(key=lambda f: f["id"])
    tallest = max(f["h"] for f in frames)
    (OUT / "manifest.json").write_text(
        json.dumps({
            "pageSize": args.page,
            "pages": len(pages),
            # Every frame's height is a fraction of this, which is how the app
            # sizes a book without any per-sprite metadata of its own.
            "tallest": tallest,
            "frames": frames,
        }, indent=1),
        encoding="utf-8",
    )

    styles: dict[str, int] = {}
    for f in frames:
        styles[f["style"]] = styles.get(f["style"], 0) + 1
    total_kb = sum((OUT / f"atlas-{i}.webp").stat().st_size for i in range(len(pages))) // 1024
    print(f"{len(frames)} spines -> {len(pages)} page(s), {total_kb} KB")
    for s, n in sorted(styles.items()):
        print(f"  {s}: {n}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
