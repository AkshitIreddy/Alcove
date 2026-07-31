"""hardedge.py — find the straight, hard tonal steps a translucent sprite leaves.

A blurred shadow never changes by more than a level or two between neighbouring
pixels. A sprite that ends at full opacity changes by a lot, at exactly one x
(or y), all the way down its edge. So: for every column boundary, count the rows
whose |delta| exceeds a threshold; a boundary where most rows jump is an
artifact edge, and the count says how long it runs.

    python qa/_probes/hardedge.py qa/halo/after-tl.png [threshold]
"""
import sys
from PIL import Image

path = sys.argv[1]
thr = int(sys.argv[2]) if len(sys.argv) > 2 else 9
im = Image.open(path).convert('RGB')
w, h = im.size
px = im.load()


def lum(c):
    return (c[0] * 299 + c[1] * 587 + c[2] * 114) // 1000


cols = []
for x in range(1, w):
    n = 0
    for y in range(0, h, 2):
        if abs(lum(px[x, y]) - lum(px[x - 1, y])) > thr:
            n += 1
    cols.append((n * 2 * 100 // h, x))
rows = []
for y in range(1, h):
    n = 0
    for x in range(0, w, 2):
        if abs(lum(px[x, y]) - lum(px[x, y - 1])) > thr:
            n += 1
    rows.append((n * 2 * 100 // w, y))

cols.sort(reverse=True)
rows.sort(reverse=True)
print(f'{path}  ({w}x{h}, threshold {thr})')
print('  worst vertical edges (%% of column height that steps, x):  ' +
      '  '.join(f'{p}%@x={x}' for p, x in cols[:6]))
print('  worst horizontal edges (%% of row width that steps, y):    ' +
      '  '.join(f'{p}%@y={y}' for p, y in rows[:6]))
