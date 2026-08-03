"""Look at the frames that are actually INSIDE icon.ico.

Not a downscale of the master — the real frames Windows will pick from, read
back out of the file. A generator can write a perfectly valid .ico full of
mush, and the only way to know is to open it and look.

Each cell: true size on cream (a Start-menu ground) and on dark (a taskbar),
then the same pixels magnified so the detail loss is visible.
"""
from PIL import Image, ImageDraw
import os

ICO = "src-tauri/icons/icon.ico"
SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
ZOOM = 6

frames = {}
for s in SIZES:
    im = Image.open(ICO)
    try:
        im.size = (s, s)          # PIL selects the matching frame
        frames[s] = im.convert("RGBA").copy()
    except Exception as e:        # noqa: BLE001 - report and carry on
        print(f"  {s}px MISSING: {e}")

cell = 190
pad = 16
head = 28
board_w = pad + len(SIZES) * (cell + pad)
board_h = head + (cell + 20) + (cell + 20) + pad
board = Image.new("RGB", (board_w, board_h), (34, 30, 28))
d = ImageDraw.Draw(board)
d.text((pad, 8), "icon.ico — the real frames. Top: true size on cream / dark. Bottom: magnified.",
       fill=(232, 222, 208))

y1 = head
y2 = head + cell + 20

for i, s in enumerate(SIZES):
    x = pad + i * (cell + pad)
    im = frames.get(s)
    if im is None:
        continue

    t = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
    td = ImageDraw.Draw(t)
    td.rectangle([0, 0, cell // 2, cell], fill=(246, 241, 230, 255))
    td.rectangle([cell // 2, 0, cell, cell], fill=(30, 28, 27, 255))
    # one on each ground, so both readings are visible at once
    t.alpha_composite(im, (cell // 4 - s // 2, (cell - s) // 2))
    t.alpha_composite(im, (3 * cell // 4 - s // 2, (cell - s) // 2))
    board.paste(t.convert("RGB"), (x, y1))
    d.text((x, y1 + cell + 3), f"{s}px", fill=(196, 186, 172))

    z = im.resize((s * ZOOM, s * ZOOM), Image.NEAREST)
    zt = Image.new("RGBA", (cell, cell), (246, 241, 230, 255))
    if z.width <= cell:
        zt.alpha_composite(z, ((cell - z.width) // 2, (cell - z.height) // 2))
    else:
        off = (z.width - cell) // 2
        zt.alpha_composite(z.crop((off, off, off + cell, off + cell)), (0, 0))
    board.paste(zt.convert("RGB"), (x, y2))
    d.text((x, y2 + cell + 3), f"{s}px x{ZOOM}", fill=(196, 186, 172))

os.makedirs("shots-now/out", exist_ok=True)
board.save("shots-now/out/icon-verify.png")
print("wrote shots-now/out/icon-verify.png", board.size)

# Alpha sanity: a surround left opaque is the bug that shows as a white box.
for s in (16, 32, 48):
    im = frames.get(s)
    if im is None:
        continue
    a = im.getchannel("A")
    corners = [a.getpixel(p) for p in [(0, 0), (s - 1, 0), (0, s - 1), (s - 1, s - 1)]]
    print(f"  {s}px corner alpha: {corners}  (0 = transparent, good)")
