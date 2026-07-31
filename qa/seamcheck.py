"""Seam check for any folder of tiles: python qa/seamcheck.py <folder>"""
import glob
import os
import random
import statistics
import sys

from PIL import Image

random.seed(7)
folder = sys.argv[1] if len(sys.argv) > 1 else "assets/photoreal/materials"


def report(path, samples=40):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()
    col = lambda a, b: statistics.mean(abs(px[a, y][c] - px[b, y][c]) for y in range(0, h, 2) for c in range(3))
    row = lambda a, b: statistics.mean(abs(px[x, a][c] - px[x, b][c]) for x in range(0, w, 2) for c in range(3))
    lr, tb = col(w - 1, 0), row(h - 1, 0)
    cb = statistics.mean(col(x, x + 1) for x in random.sample(range(1, w - 2), samples))
    rb = statistics.mean(row(y, y + 1) for y in random.sample(range(1, h - 2), samples))
    return lr, tb, cb, rb


bad = []
for f in sorted(glob.glob(f"{folder}/*.png")):
    lr, tb, cb, rb = report(f)
    seam = lr > cb * 2.0 + 2 or tb > rb * 2.0 + 2
    if seam:
        bad.append(os.path.basename(f))
    print(f"  {'SEAM' if seam else 'OK  '} {os.path.basename(f):28s} lr={lr:5.1f}/{cb:5.1f}  tb={tb:5.1f}/{rb:5.1f}")

print("\nneeds reroll:", ", ".join(bad) if bad else "none")
