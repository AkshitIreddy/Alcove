"""Batch review for generated assets: robust seam measurement + contact sheets.

The seam test compares the wrap-around discontinuity against a BASELINE of many
random adjacent interior pairs, not a single one. A single interior sample is
far too noisy on textures with large features — it produced both false alarms
and false passes on the first pass.
"""
from PIL import Image
import os, glob, random, statistics

random.seed(7)


def seam_report(path, samples=40):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()

    def col_diff(a, b):
        return statistics.mean(abs(px[a, y][c] - px[b, y][c]) for y in range(0, h, 2) for c in range(3))

    def row_diff(a, b):
        return statistics.mean(abs(px[x, a][c] - px[x, b][c]) for x in range(0, w, 2) for c in range(3))

    # wrap-around: last column against first, last row against first
    lr = col_diff(w - 1, 0)
    tb = row_diff(h - 1, 0)

    # baseline: typical difference between neighbouring interior columns/rows
    col_base = statistics.mean(col_diff(x, x + 1) for x in random.sample(range(1, w - 2), samples))
    row_base = statistics.mean(row_diff(y, y + 1) for y in random.sample(range(1, h - 2), samples))

    return lr, tb, col_base, row_base


def sheet(folder, cols, out, cell=340):
    files = sorted(glob.glob(f"assets/generated/{folder}/*.png"))
    if not files:
        return []
    rows = (len(files) + cols - 1) // cols
    sh = Image.new("RGB", (cols * cell, rows * (cell + 22)), (26, 24, 22))
    for i, f in enumerate(files):
        im = Image.open(f).convert("RGB").resize((cell - 8, cell - 8), Image.LANCZOS)
        sh.paste(im, ((i % cols) * cell + 4, (i // cols) * (cell + 22) + 18))
    sh.save(out)
    return files


def check(folder):
    print(f"== {folder} ==")
    bad = []
    for f in sorted(glob.glob(f"assets/generated/{folder}/*.png")):
        lr, tb, cb, rb = seam_report(f)
        # A genuine seam shows as a wrap difference well above the natural
        # neighbour-to-neighbour variation of that same image.
        lr_bad = lr > cb * 2.0 + 2
        tb_bad = tb > rb * 2.0 + 2
        tag = "SEAM" if (lr_bad or tb_bad) else "OK  "
        if lr_bad or tb_bad:
            bad.append(os.path.basename(f))
        print(f"  {tag} {os.path.basename(f):24s} lr={lr:5.1f}/{cb:5.1f}  tb={tb:5.1f}/{rb:5.1f}")
    return bad


bad = check("materials") + check("wallpaper")
sheet("materials", 5, "qa/sheet-materials.png")
sheet("wallpaper", 4, "qa/sheet-wallpaper.png")
sheet("foliage", 3, "qa/sheet-foliage.png")
print("\nneeds reroll:", ", ".join(bad) if bad else "none")
