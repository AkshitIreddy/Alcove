"""Key the flat backdrop out of full-frame illustrations into one sprite each.

`extract-atoms.py` pulls MANY small elements out of a composition and therefore
rejects anything touching the frame edge. These LayerDiffuse illustrations are
the opposite case: one subject that legitimately fills the frame, sometimes
already carrying real alpha. So: keep the model's alpha where it is meaningful,
otherwise key the flat backdrop, then trim.

Run: python scripts/key-cutouts.py [--src assets/cutouts] [--out assets/atoms-vivid]
"""
import argparse
import glob
import os

import numpy as np
from PIL import Image
from scipy import ndimage

ap = argparse.ArgumentParser()
ap.add_argument("--src", default="assets/cutouts")
ap.add_argument("--out", default="assets/atoms-vivid")
args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)

kept = 0
for path in sorted(glob.glob(f"{args.src}/*.png")):
    im = Image.open(path).convert("RGBA")
    arr = np.asarray(im).astype(np.float32)
    rgb, alpha = arr[..., :3], arr[..., 3]
    name = os.path.splitext(os.path.basename(path))[0]

    # If the model produced genuine transparency, trust it.
    if (alpha < 200).mean() > 0.15:
        mask = alpha / 255.0
    else:
        # Otherwise key the flat backdrop sampled from the corners.
        h, w, _ = rgb.shape
        corners = np.concatenate([
            rgb[:14, :14].reshape(-1, 3), rgb[:14, -14:].reshape(-1, 3),
            rgb[-14:, :14].reshape(-1, 3), rgb[-14:, -14:].reshape(-1, 3),
        ])
        bg = np.median(corners, axis=0)
        dist = np.linalg.norm(rgb - bg, axis=2)
        # Soft threshold keeps anti-aliased edges instead of stair-stepping.
        mask = np.clip((dist - 26.0) / 34.0, 0.0, 1.0)
        # Drop specks, then keep only the largest connected subject.
        solid = mask > 0.4
        solid = ndimage.binary_opening(solid, np.ones((3, 3)))
        labels, n = ndimage.label(solid)
        if n > 1:
            sizes = ndimage.sum(solid, labels, range(1, n + 1))
            biggest = int(np.argmax(sizes)) + 1
            grown = ndimage.binary_dilation(labels == biggest, np.ones((9, 9)), iterations=3)
            mask = mask * grown

    if mask.max() <= 0.05:
        print(f"  {name}: EMPTY, skipped")
        continue

    out = np.dstack([rgb, mask * 255.0]).astype(np.uint8)
    img = Image.fromarray(out, "RGBA")
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    img.save(os.path.join(args.out, f"{name}.webp"), quality=94, method=5)
    print(f"  {name}: {img.width}x{img.height}, {float((mask > 0.06).mean()) * 100:.0f}% fill")
    kept += 1

print(f"\n{kept} sprites -> {args.out}")
