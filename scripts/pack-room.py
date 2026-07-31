"""scripts/pack-room.py — ship the authored room surfaces.

Converts what `gen-room.mjs` produced into the WebP the app actually loads,
under `public/room/`, mirroring how `pack-spines.py` ships the spine atlas.

The wall is kept at full 1536px rather than downscaled to the 512px the old
procedural materials used. That resolution IS the fix: the pale horizontal
banding reported while panning is a small tile repeating across the viewport,
and a panel wider than the viewport never shows a seam at all.

Usage: python scripts/pack-room.py [--quality 92]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError as exc:  # pragma: no cover - operator feedback
    sys.exit(f"needs pillow: {exc}")

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "room"
OUT = ROOT / "public" / "room"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--quality", type=int, default=92)
    args = ap.parse_args()

    if not SRC.is_dir():
        sys.exit(f"no {SRC} -- run scripts/gen-room.mjs first")
    OUT.mkdir(parents=True, exist_ok=True)

    manifest: dict[str, dict[str, int]] = {}
    for path in sorted(SRC.glob("*.png")):
        img = Image.open(path).convert("RGB")
        out = OUT / f"{path.stem}.webp"
        img.save(out, quality=args.quality, method=6)
        manifest[path.stem] = {"w": img.width, "h": img.height}
        print(f"  {out.name}: {img.width}x{img.height}, {out.stat().st_size // 1024} KB")

    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print(f"\n{len(manifest)} surfaces -> public/room")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
