"""Contact sheet for alpha cut-outs, on a checkerboard so transparency is visible."""
from PIL import Image, ImageDraw
import glob
import os
import numpy as np

files = sorted(glob.glob("assets/cutouts/*.png"))
cell, cols = 250, 5
rows = max(1, (len(files) + cols - 1) // cols)
W, H = cols * cell, rows * (cell + 20)

sheet = Image.new("RGB", (W, H), (255, 255, 255))
draw = ImageDraw.Draw(sheet)
for y in range(0, H, 16):
    for x in range(0, W, 16):
        if (x // 16 + y // 16) % 2:
            draw.rectangle([x, y, min(x + 15, W - 1), min(y + 15, H - 1)], fill=(224, 224, 224))

for i, f in enumerate(files):
    im = Image.open(f).convert("RGBA")
    alpha = np.asarray(im)[..., 3]
    covered = float((alpha > 16).mean())
    edge_soft = float(((alpha > 16) & (alpha < 240)).mean())
    im.thumbnail((cell - 14, cell - 14), Image.LANCZOS)
    x = (i % cols) * cell + 7
    y = (i // cols) * (cell + 20) + 16
    sheet.paste(im, (x, y), im)
    label = f"{os.path.basename(f)[:-4]}  fill {covered * 100:.0f}%  soft {edge_soft * 100:.1f}%"
    draw.text((x, y - 13), label, fill=(30, 30, 30))

sheet.save("qa/sheet-cutouts.png")
print(f"{len(files)} cutouts")
