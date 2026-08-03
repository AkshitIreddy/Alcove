"""Render the current app icon at the sizes Windows actually uses.

The reader: "the icon looks very pixelated probably because it has so much
detail in it". This board is the evidence for that, so the redesign starts from
what is really on screen rather than from the 1240px master nobody ever sees.

Top row: true size, on a light and a dark ground (a Start menu tile and a
taskbar are different grounds and a detailed icon fails differently on each).
Bottom row: the same pixels magnified 6x with nearest-neighbour, so we can see
exactly which shapes turn to mush.
"""
from PIL import Image, ImageDraw
import os

SRC = "assets/brand/alcove-art.png"
OUT = "shots-now/out/icon-audit.png"
SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
ZOOM = 6

src = Image.open(SRC).convert("RGBA")

# The master has a black surround; flood it away from the corners the way
# scripts/gen-icons.py does, so we judge the artwork and not its backing.
bg = Image.new("RGBA", src.size, (0, 0, 0, 0))
px = src.load()
w, h = src.size
seen = set()
stack = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
while stack:
    x, y = stack.pop()
    if (x, y) in seen or not (0 <= x < w and 0 <= y < h):
        continue
    seen.add((x, y))
    r, g, b, a = px[x, y]
    if r < 24 and g < 24 and b < 24:
        px[x, y] = (0, 0, 0, 0)
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]

cell = 128 * ZOOM // 4
pad = 26
label_h = 22
cols = len(SIZES)
board_w = pad + cols * (cell + pad)
board_h = pad + label_h + cell + pad + label_h + cell + pad * 2

board = Image.new("RGB", (board_w, board_h), (34, 30, 28))
d = ImageDraw.Draw(board)

d.text((pad, 8), "TRUE SIZE  (what Windows shows)", fill=(230, 220, 205))
y_true = pad + label_h

for i, s in enumerate(SIZES):
    x = pad + i * (cell + pad)
    small = src.resize((s, s), Image.LANCZOS)
    # Half the cell on cream, half on dark - both real grounds.
    tile = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
    td = ImageDraw.Draw(tile)
    td.rectangle([0, 0, cell // 2, cell], fill=(244, 238, 224, 255))
    td.rectangle([cell // 2, 0, cell, cell], fill=(28, 26, 25, 255))
    tile.alpha_composite(small, ((cell - s) // 2, (cell - s) // 2))
    board.paste(tile.convert("RGB"), (x, y_true))
    d.text((x, y_true + cell + 4), f"{s}px", fill=(190, 180, 168))

y_zoom = y_true + cell + label_h + pad
d.text((pad, y_zoom - label_h + 4), f"THE SAME PIXELS, MAGNIFIED {ZOOM}x", fill=(230, 220, 205))

for i, s in enumerate(SIZES):
    x = pad + i * (cell + pad)
    small = src.resize((s, s), Image.LANCZOS)
    big = small.resize((s * ZOOM, s * ZOOM), Image.NEAREST)
    tile = Image.new("RGBA", (cell, cell), (244, 238, 224, 255))
    ox = (cell - big.width) // 2
    oy = (cell - big.height) // 2
    if big.width <= cell:
        tile.alpha_composite(big, (ox, oy))
    else:
        crop = big.crop(
            (
                (big.width - cell) // 2,
                (big.height - cell) // 2,
                (big.width - cell) // 2 + cell,
                (big.height - cell) // 2 + cell,
            )
        )
        tile.alpha_composite(crop, (0, 0))
    board.paste(tile.convert("RGB"), (x, y_zoom))
    d.text((x, y_zoom + cell + 4), f"{s}px", fill=(190, 180, 168))

os.makedirs("shots-now/out", exist_ok=True)
board.save(OUT)
print(f"wrote {OUT}  {board.size[0]}x{board.size[1]}")
