"""Extract individual foliage atoms from generated compositions.

Why this exists: SDXL will not reliably produce an isolated specimen on an
empty background — across 24 candidates with four different prompt strategies,
zero came back as a single centred subject with margin. The model wants to
compose a picture that fills the frame.

So we stop fighting it. The compositions are full of beautiful individual
leaves and flowers; this script keys out the flat background, labels the
connected regions, and saves each well-formed region as its own transparent
sprite. Working *with* the model's bias yields more atoms per generation than
fighting it would.

Output: assets/atoms/<source>-<n>.webp, trimmed to the alpha bounding box.
Run:    python scripts/extract-atoms.py [--min-area 9000] [--src foliage]
"""
import argparse
import glob
import os

import numpy as np
from PIL import Image
from scipy import ndimage

ap = argparse.ArgumentParser()
ap.add_argument("--src", default="foliage")
ap.add_argument("--min-area", type=int, default=9000)
ap.add_argument("--max-frac", type=float, default=0.45, help="reject blobs covering more than this fraction of the frame")
ap.add_argument("--out", default="assets/atoms")
args = ap.parse_args()

os.makedirs(args.out, exist_ok=True)


def background_mask(rgb: np.ndarray) -> np.ndarray:
    """True where the pixel belongs to the flat backdrop.

    The backdrops are near-flat and light (white / cream / pale grey / sage).
    Sample the four corners, then key anything close to those colours AND
    low-saturation, which keeps pale petals from being eaten.
    """
    h, w, _ = rgb.shape
    patch = np.concatenate([
        rgb[:12, :12].reshape(-1, 3), rgb[:12, -12:].reshape(-1, 3),
        rgb[-12:, :12].reshape(-1, 3), rgb[-12:, -12:].reshape(-1, 3),
    ])
    bg = np.median(patch, axis=0)
    dist = np.linalg.norm(rgb.astype(np.int16) - bg.astype(np.int16), axis=2)
    mx = rgb.max(axis=2).astype(np.int16)
    mn = rgb.min(axis=2).astype(np.int16)
    sat = mx - mn
    return (dist < 42) & (sat < 46)


total = 0
for path in sorted(glob.glob(f"assets/generated/{args.src}/*.png")):
    src = Image.open(path).convert("RGB")
    rgb = np.asarray(src)
    h, w, _ = rgb.shape

    fg = ~background_mask(rgb)
    # Clean speckle, then close small gaps so a leaf and its stalk stay one blob.
    fg = ndimage.binary_opening(fg, np.ones((3, 3)), iterations=1)
    fg = ndimage.binary_closing(fg, np.ones((7, 7)), iterations=2)

    labels, n = ndimage.label(fg)
    if n == 0:
        continue

    base = os.path.splitext(os.path.basename(path))[0]
    kept = 0
    for idx, sl in enumerate(ndimage.find_objects(labels), start=1):
        blob = labels[sl] == idx
        area = int(blob.sum())
        if area < args.min_area or area > h * w * args.max_frac:
            continue

        ys, xs = sl
        # Reject anything touching the frame edge — it is a cropped fragment.
        if ys.start == 0 or xs.start == 0 or ys.stop >= h or xs.stop >= w:
            continue
        # Reject extreme slivers.
        bh, bw = ys.stop - ys.start, xs.stop - xs.start
        if bh < 40 or bw < 40 or max(bh / bw, bw / bh) > 6:
            continue

        rgba = np.zeros((bh, bw, 4), dtype=np.uint8)
        rgba[..., :3] = rgb[sl]
        alpha = (blob * 255).astype(np.uint8)
        # Feather one pixel so the cut edge is not razor-hard against the page.
        alpha = ndimage.uniform_filter(alpha, size=3)
        rgba[..., 3] = alpha

        kept += 1
        out = os.path.join(args.out, f"{base}-{kept}.webp")
        Image.fromarray(rgba, "RGBA").save(out, quality=92, method=5)

    if kept:
        print(f"  {base}: {kept} atoms")
        total += kept

print(f"\n{total} atoms -> {args.out}")
