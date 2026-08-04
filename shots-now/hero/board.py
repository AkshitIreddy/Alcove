"""shots-now/hero/board.py — contact sheet of first-run candidates.

usage: python shots-now/hero/board.py <dir> <out.png> [cols]
"""
import sys, os, glob
from PIL import Image, ImageDraw

src = sys.argv[1]
out = sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 4
cell_w = int(sys.argv[4]) if len(sys.argv) > 4 else 430

files = sorted(glob.glob(os.path.join(src, "*.png")))
if not files:
    raise SystemExit("no pngs in " + src)

thumbs = []
for f in files:
    im = Image.open(f).convert("RGB")
    h = int(im.height * cell_w / im.width)
    thumbs.append((os.path.basename(f)[:-4], im.resize((cell_w, h), Image.LANCZOS)))

cell_h = max(t.height for _, t in thumbs)
LAB = 20
rows = (len(thumbs) + cols - 1) // cols
board = Image.new("RGB", (cols * cell_w, rows * (cell_h + LAB)), (26, 26, 26))
d = ImageDraw.Draw(board)
for i, (name, t) in enumerate(thumbs):
    x = (i % cols) * cell_w
    y = (i // cols) * (cell_h + LAB)
    board.paste(t, (x, y))
    d.text((x + 6, y + cell_h + 4), name, fill=(255, 235, 200))
board.save(out)
print(out, board.size, len(thumbs), "cells")
