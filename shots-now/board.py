"""shots-now/board.py — tile a run of candidate shots into one contact sheet.

Usage: python shots-now/board.py "shots-now/defaults/a-*.png" out.png [cols] [crop]
`crop` is an optional l,t,r,b box in source pixels applied before scaling.
"""
import sys, glob, os
from PIL import Image, ImageDraw

pattern = sys.argv[1]
out = sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 4
crop = [int(v) for v in sys.argv[4].split(',')] if len(sys.argv) > 4 else None

files = sorted(glob.glob(pattern))
if not files:
    raise SystemExit('no files match ' + pattern)

CELL_W = 470
LABEL = 20

thumbs = []
for f in files:
    im = Image.open(f).convert('RGB')
    if crop:
        im = im.crop(tuple(crop))
    w, h = im.size
    scale = CELL_W / w
    im = im.resize((CELL_W, max(1, int(h * scale))), Image.LANCZOS)
    thumbs.append((os.path.basename(f), im))

cell_h = max(im.size[1] for _, im in thumbs)
rows = (len(thumbs) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (CELL_W + 8) + 8, rows * (cell_h + LABEL + 8) + 8), (30, 28, 26))
d = ImageDraw.Draw(sheet)
for i, (name, im) in enumerate(thumbs):
    r, c = divmod(i, cols)
    x = 8 + c * (CELL_W + 8)
    y = 8 + r * (cell_h + LABEL + 8)
    sheet.paste(im, (x, y + LABEL))
    d.text((x + 2, y + 4), name.rsplit('.', 1)[0], fill=(240, 235, 225))
sheet.save(out)
print(out, sheet.size)
